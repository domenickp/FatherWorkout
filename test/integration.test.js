// Cross-module checks owned by the coordinator: the pieces built by separate builders
// must agree with each other on the real data.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const root = path.join(__dirname, '..');
const lib = require(path.join(root, 'src', 'Lib.js'));
const exporter = require(path.join(root, 'tools', 'export-routine.js'));
const routine = require(path.join(root, 'data', 'routine.json'));

const exercises = routine.days.flatMap(d => d.exercises.map(e => ({ day: d.day, ...e })));

test('exporter slugify agrees with Lib.slugify on every routine name', () => {
  for (const e of exercises) {
    assert.strictEqual(exporter.slugify(e.name), lib.slugify(e.name), e.name);
  }
});

test('every routine id is d<day>-<Lib.slugify(name)>', () => {
  for (const e of exercises) {
    assert.strictEqual(e.id, `d${e.day}-${lib.slugify(e.name)}`);
  }
});

test('a session built from the real routine passes validateSession', () => {
  const day = routine.days[0];
  const session = {
    schemaVersion: 1,
    id: '0b9c6a8e-3f2d-4c1e-9a77-2f6f1d2c4b10',
    day: day.day,
    startedAt: '2026-10-11T14:30:00.000Z',
    completedAt: '2026-10-11T15:25:00.000Z',
    entries: day.exercises.map(ex => ({
      exerciseId: ex.id,
      name: ex.name,
      sets: Array.from({ length: ex.sets }, () => ({
        reps: ex.reps, weightLb: ex.weightLb, timeMin: ex.timeMin, done: true
      })),
      notes: null
    })),
    notes: null
  };
  assert.deepStrictEqual(lib.validateSession(session, routine), []);
  assert.strictEqual(lib.sessionFileName(session), '2026-10-11T143000Z_d1_0b9c6a8e.json');
});
