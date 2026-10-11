const test = require('node:test');
const assert = require('node:assert');
const {
  slugify, validateSession, sessionFileName, summarizeSession,
  latestCompletedByDay, sortSessionsNewestFirst
} = require('../src/Lib.js');

const routine = {
  schemaVersion: 1,
  days: [
    { day: 1, areas: 'Chest', exercises: [
      { id: 'd1-bike', name: 'Warm Up: Bike' },
      { id: 'd1-press', name: 'Incline Dumbbell Press' }
    ] },
    { day: 2, areas: 'Back', exercises: [
      { id: 'd2-row', name: 'Chest-Supported Incline Row' }
    ] },
    { day: 3, areas: 'Legs', exercises: [
      { id: 'd3-calf', name: 'Single-Leg Calf Raise' }
    ] }
  ]
};

function valid() {
  return {
    schemaVersion: 1,
    id: '0b9c6a8e-3f2d-4c1e-9a77-2f6f1d2c4b10',
    day: 1,
    startedAt: '2026-10-11T14:30:00.000Z',
    completedAt: '2026-10-11T15:25:00.000Z',
    entries: [{
      exerciseId: 'd1-press',
      name: 'Incline Dumbbell Press',
      sets: [
        { reps: 12, weightLb: 40, timeMin: null, done: true },
        { reps: null, weightLb: null, timeMin: null, done: false }
      ],
      notes: 'heavy'
    }],
    notes: null
  };
}

test('slugify', () => {
  assert.strictEqual(slugify('Warm Up: Stationary Bike'), 'warm-up-stationary-bike');
  assert.strictEqual(slugify('Chest-Supported Incline Row'), 'chest-supported-incline-row');
  assert.strictEqual(slugify('Single-Leg Calf Raise'), 'single-leg-calf-raise');
  assert.strictEqual(slugify('  --Hello,   World!--  '), 'hello-world');
});

test('sessionFileName matches contract example', () => {
  assert.strictEqual(
    sessionFileName({ startedAt: '2026-10-11T14:30:00.000Z', day: 1, id: '0b9c6a8e-3f2d-4c1e-9a77-2f6f1d2c4b10' }),
    '2026-10-11T143000Z_d1_0b9c6a8e.json'
  );
  assert.strictEqual(
    sessionFileName({ startedAt: '2026-10-11T14:30:00Z', day: 4, id: 'abcdefghij' }),
    '2026-10-11T143000Z_d4_abcdefgh.json'
  );
});

test('validateSession: valid session', () => {
  assert.deepStrictEqual(validateSession(valid(), routine), []);
  assert.deepStrictEqual(validateSession(valid()), []);
  const partial = valid(); partial.completedAt = null;
  assert.deepStrictEqual(validateSession(partial, routine), []);
});

function expectError(mutate, pattern, rt = routine) {
  const s = valid();
  mutate(s);
  const errs = validateSession(s, rt);
  assert.ok(errs.length > 0, 'expected errors');
  assert.ok(errs.some(e => pattern.test(e)), `no error matching ${pattern}: ${JSON.stringify(errs)}`);
}

test('validateSession: broken rules', () => {
  expectError(s => { delete s.id; }, /id/);
  expectError(s => { s.id = '   '; }, /id/);
  expectError(s => { s.day = 1.5; }, /day must be an integer/);
  expectError(s => { s.day = '1'; }, /day must be an integer/);
  expectError(s => { s.day = 9; }, /not in the routine/);
  expectError(s => { s.startedAt = 'yesterday'; }, /startedAt/);
  expectError(s => { delete s.startedAt; }, /startedAt/);
  expectError(s => { s.completedAt = 'nope'; }, /completedAt/);
  expectError(s => { delete s.completedAt; }, /completedAt/);
  expectError(s => { s.entries = []; }, /entries/);
  expectError(s => { s.entries = null; }, /entries/);
  expectError(s => { s.entries[0].exerciseId = 'd1-nope'; }, /not in the routine/);
  expectError(s => { s.entries[0].exerciseId = 'd2-row'; }, /not in the routine/);
  expectError(s => { s.entries[0].sets = []; }, /sets must be a non-empty array/);
  expectError(s => { s.entries[0].sets[0].reps = -1; }, /reps/);
  expectError(s => { s.entries[0].sets[0].weightLb = '40'; }, /weightLb/);
  expectError(s => { s.entries[0].sets[0].timeMin = NaN; }, /timeMin/);
  expectError(s => { s.entries[0].sets[0].done = 'yes'; }, /done must be a boolean/);
  expectError(s => { s.entries[0].notes = 5; }, /entries\[0\]\.notes/);
  expectError(s => { s.notes = 5; }, /^notes/);
});

test('validateSession: non-object input', () => {
  assert.ok(validateSession(null, routine).length > 0);
  assert.ok(validateSession('x', routine).length > 0);
});

test('validateSession: without routine skips routine checks', () => {
  const s = valid(); s.day = 9; s.entries[0].exerciseId = 'whatever';
  assert.deepStrictEqual(validateSession(s), []);
});

test('summarizeSession', () => {
  const s = valid();
  s.entries.push({ exerciseId: 'd1-bike', name: 'Warm Up: Bike', sets: [{ reps: null, weightLb: null, timeMin: 10, done: true }], notes: null });
  assert.deepStrictEqual(summarizeSession(s), {
    id: s.id, day: 1, startedAt: s.startedAt, completedAt: s.completedAt,
    exerciseCount: 2, setsDone: 2
  });
});

function mk(id, day, startedAt, completedAt) {
  return { id, day, startedAt, completedAt, entries: [] };
}

test('sortSessionsNewestFirst does not mutate', () => {
  const input = [mk('a', 1, '2026-01-01T10:00:00.000Z', null), mk('b', 1, '2026-03-01T10:00:00.000Z', null), mk('c', 2, '2026-02-01T10:00:00.000Z', null)];
  const copy = input.slice();
  const out = sortSessionsNewestFirst(input);
  assert.deepStrictEqual(out.map(s => s.id), ['b', 'c', 'a']);
  assert.deepStrictEqual(input, copy);
  assert.notStrictEqual(out, input);
});

test('latestCompletedByDay', () => {
  const sessions = [
    mk('old1', 1, '2026-01-01T10:00:00.000Z', '2026-01-01T11:00:00.000Z'),
    mk('new1', 1, '2026-02-01T10:00:00.000Z', '2026-02-01T11:00:00.000Z'),
    mk('partial1', 1, '2026-03-01T10:00:00.000Z', null),
    mk('partial2', 2, '2026-03-02T10:00:00.000Z', null),
    mk('d3', 3, '2026-01-05T10:00:00.000Z', '2026-01-05T11:00:00.000Z')
  ];
  const out = latestCompletedByDay(sessions, [1, 2, 3, 4]);
  assert.deepStrictEqual(Object.keys(out), ['1', '2', '3', '4']);
  assert.strictEqual(out['1'].id, 'new1');
  assert.strictEqual(out['2'], null);
  assert.strictEqual(out['3'].id, 'd3');
  assert.strictEqual(out['4'], null);
});
