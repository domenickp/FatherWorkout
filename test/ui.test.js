const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');

function loadLogic() {
  const m = html.match(/<script id="fw-logic">([\s\S]*?)<\/script>/);
  assert.ok(m, 'fw-logic script block exists');
  const ctx = vm.createContext({});
  vm.runInContext(m[1], ctx);
  return ctx.FW;
}
const FW = loadLogic();
// Objects built inside the vm have a different Object prototype; compare via JSON.
const plain = (x) => JSON.parse(JSON.stringify(x));

const routine = JSON.parse(fs.readFileSync(path.join(root, 'dev', 'fixture-routine.json'), 'utf8'));
const ex = (id, over) => Object.assign({ id, name: id, warmup: false, sets: 3, reps: 12, weightLb: 40, timeMin: null, rest: '2 min', notes: null }, over);

test('page is self-contained', () => {
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /google\.script\.run\s*=/);
  assert.doesNotMatch(html, /__FW_ROUTINE__/);
});

test('fixture covers 4 days and 38 exercises', () => {
  assert.deepStrictEqual(routine.days.map((d) => d.day), [1, 2, 3, 4]);
  assert.strictEqual(routine.days.reduce((n, d) => n + d.exercises.length, 0), 38);
});

test('parseRestSeconds', () => {
  assert.strictEqual(FW.parseRestSeconds('2 min'), 120);
  assert.strictEqual(FW.parseRestSeconds('60–90 sec'), 90); // en dash
  assert.strictEqual(FW.parseRestSeconds('60-90 sec'), 90); // hyphen
  assert.strictEqual(FW.parseRestSeconds('90 sec'), 90);
  assert.strictEqual(FW.parseRestSeconds('60 sec'), 60);
  assert.strictEqual(FW.parseRestSeconds('1-2 min'), 120);
  assert.strictEqual(FW.parseRestSeconds(null), null);
  assert.strictEqual(FW.parseRestSeconds(''), null);
  assert.strictEqual(FW.parseRestSeconds('as needed'), null);
});

test('formatTarget', () => {
  assert.strictEqual(FW.formatTarget(ex('a', { weightLb: 45 })), '3 × 12 @ 45 lb · rest 2 min');
  assert.strictEqual(FW.formatTarget(ex('b', { sets: 1, reps: null, weightLb: null, timeMin: 10, rest: null })), '10 min');
  assert.strictEqual(FW.formatTarget(ex('c', { reps: 20, weightLb: null, rest: null })), '3 × 20');
  assert.strictEqual(FW.formatTarget(ex('d', { reps: null, weightLb: null, timeMin: 1, rest: '60 sec' })), '3 × 1 min · rest 60 sec');
  assert.strictEqual(FW.formatTarget(ex('e', { weightLb: 17.5, rest: '60–90 sec' })), '3 × 12 @ 17.5 lb · rest 60–90 sec');
});

test('formatTarget renders every real exercise without empty output', () => {
  for (const d of routine.days) for (const e of d.exercises) assert.ok(FW.formatTarget(e).length > 0, e.id);
});

test('defaultDay', () => {
  const r = { days: [1, 2, 3, 4].map((day) => ({ day })) };
  const s = (day, startedAt, completedAt) => ({ day, startedAt, completedAt });
  assert.strictEqual(FW.defaultDay(r, []), 1);
  assert.strictEqual(FW.defaultDay(r, [s(1, '2026-10-01T10:00:00.000Z', '2026-10-01T11:00:00.000Z')]), 2);
  assert.strictEqual(FW.defaultDay(r, [s(4, '2026-10-02T10:00:00.000Z', '2026-10-02T11:00:00.000Z')]), 1);
  // newest first; a newer partial session is ignored
  assert.strictEqual(FW.defaultDay(r, [
    s(3, '2026-10-05T10:00:00.000Z', null),
    s(2, '2026-10-04T10:00:00.000Z', '2026-10-04T11:00:00.000Z'),
    s(1, '2026-10-03T10:00:00.000Z', '2026-10-03T11:00:00.000Z'),
  ]), 3);
  // only partials: behaves like no history
  assert.strictEqual(FW.defaultDay(r, [s(3, '2026-10-05T10:00:00.000Z', null)]), 1);
  // does not rely on array order
  assert.strictEqual(FW.defaultDay(r, [
    s(1, '2026-10-03T10:00:00.000Z', '2026-10-03T11:00:00.000Z'),
    s(2, '2026-10-04T10:00:00.000Z', '2026-10-04T11:00:00.000Z'),
  ]), 3);
});

test('formatLastTime', () => {
  const sets = [
    { reps: 12, weightLb: 40, timeMin: null, done: true },
    { reps: 12, weightLb: 40, timeMin: null, done: true },
    { reps: 10, weightLb: 40, timeMin: null, done: true },
    { reps: 8, weightLb: 40, timeMin: null, done: false },
  ];
  assert.strictEqual(FW.formatLastTime({ sets }), '12×40, 12×40, 10×40');
  assert.strictEqual(FW.formatLastTime(null), '—');
  assert.strictEqual(FW.formatLastTime(undefined), '—');
  assert.strictEqual(FW.formatLastTime({ sets: [{ reps: 8, weightLb: 40, timeMin: null, done: false }] }), '—');
  assert.strictEqual(FW.formatLastTime({ sets: [{ reps: 20, weightLb: null, timeMin: null, done: true }] }), '20');
  assert.strictEqual(FW.formatLastTime({ sets: [{ reps: 12, weightLb: 17.5, timeMin: null, done: true }] }), '12×17.5');
  assert.strictEqual(FW.formatLastTime({ sets: [{ reps: null, weightLb: null, timeMin: 10, done: true }] }), '10 min');
});

test('initialSets prefills from last time, else target', () => {
  const e = ex('x', { sets: 3, reps: 12, weightLb: 40 });
  const last = { sets: [
    { reps: 12, weightLb: 45, timeMin: null, done: true },
    { reps: 10, weightLb: 45, timeMin: null, done: true },
  ] };
  assert.deepStrictEqual(plain(FW.initialSets(e, last)), [
    { reps: 12, weightLb: 45, timeMin: null, done: false },
    { reps: 10, weightLb: 45, timeMin: null, done: false },
    { reps: 12, weightLb: 40, timeMin: null, done: false },
  ]);
  assert.strictEqual(FW.initialSets(e, null).length, 3);
  const bw = ex('bw', { reps: 20, weightLb: null });
  assert.deepStrictEqual(plain(FW.initialSets(bw, null)[0]), { reps: 20, weightLb: null, timeMin: null, done: false });
  const timed = ex('t', { sets: 1, reps: null, weightLb: null, timeMin: 10 });
  assert.deepStrictEqual(plain(FW.initialSets(timed, null)), [{ reps: null, weightLb: null, timeMin: 10, done: false }]);
});

function checkSession(s) {
  const isNum = (v) => v === null || (typeof v === 'number' && v >= 0);
  assert.deepStrictEqual(Object.keys(s).sort(), ['completedAt', 'day', 'entries', 'id', 'notes', 'schemaVersion', 'startedAt']);
  assert.strictEqual(s.schemaVersion, 1);
  assert.strictEqual(typeof s.id, 'string');
  assert.ok(Number.isInteger(s.day));
  assert.ok(!isNaN(Date.parse(s.startedAt)));
  assert.ok(s.completedAt === null || !isNaN(Date.parse(s.completedAt)));
  assert.ok(s.notes === null || typeof s.notes === 'string');
  assert.ok(Array.isArray(s.entries));
  for (const e of s.entries) {
    assert.deepStrictEqual(Object.keys(e).sort(), ['exerciseId', 'name', 'notes', 'sets']);
    assert.strictEqual(typeof e.exerciseId, 'string');
    assert.strictEqual(typeof e.name, 'string');
    assert.ok(e.notes === null || typeof e.notes === 'string');
    assert.ok(e.sets.length >= 1);
    for (const st of e.sets) {
      assert.deepStrictEqual(Object.keys(st).sort(), ['done', 'reps', 'timeMin', 'weightLb']);
      assert.ok(isNum(st.reps) && isNum(st.weightLb) && isNum(st.timeMin));
      assert.strictEqual(typeof st.done, 'boolean');
    }
  }
  assert.ok(!('savedAt' in s));
}

test('buildSession includes only touched exercises and matches contract shape', () => {
  const day = routine.days[0];
  const [a, b, c, d] = day.exercises;
  const state = {
    id: '0b9c6a8e-3f2d-4c1e-9a77-2f6f1d2c4b10', day: 1,
    startedAt: '2026-10-11T14:30:00.000Z', completedAt: '2026-10-11T15:25:00.000Z',
    notes: '  good session ', exercises: day.exercises,
    log: {
      [a.id]: { sets: [{ reps: null, weightLb: null, timeMin: 10, done: true }], notes: '' },
      [b.id]: { sets: [{ reps: 12, weightLb: 25, timeMin: null, done: false }], notes: '' }, // untouched
      [c.id]: { sets: [
        { reps: '12', weightLb: '45', timeMin: null, done: true },
        { reps: 10, weightLb: 45, timeMin: null, done: true },
        { reps: '', weightLb: '', timeMin: null, done: false },
      ], notes: ' Felt heavy ' },
      [d.id]: { sets: [{ reps: 12, weightLb: 40, timeMin: null, done: false }], notes: 'skipped, shoulder' }, // note only
    },
  };
  const s = plain(FW.buildSession(state));
  checkSession(s);
  assert.deepStrictEqual(s.entries.map((e) => e.exerciseId), [a.id, c.id, d.id]); // routine order
  assert.strictEqual(s.entries[1].name, c.name);
  assert.deepStrictEqual(s.entries[1].sets[0], { reps: 12, weightLb: 45, timeMin: null, done: true });
  assert.deepStrictEqual(s.entries[1].sets[2], { reps: null, weightLb: null, timeMin: null, done: false });
  assert.strictEqual(s.entries[1].notes, 'Felt heavy');
  assert.strictEqual(s.entries[0].notes, null);
  assert.strictEqual(s.notes, 'good session');
  assert.strictEqual(s.completedAt, '2026-10-11T15:25:00.000Z');
});

test('buildSession: empty workout has no entries; partial save keeps null completedAt; bad numbers become null', () => {
  const day = routine.days[1];
  const log = {};
  for (const e of day.exercises) log[e.id] = { sets: [{ reps: 5, weightLb: 5, timeMin: null, done: false }], notes: '' };
  const none = plain(FW.buildSession({ id: 'i', day: 2, startedAt: '2026-10-11T14:30:00.000Z', completedAt: null, notes: '', exercises: day.exercises, log }));
  checkSession(none);
  assert.deepStrictEqual(none.entries, []);
  assert.strictEqual(none.completedAt, null);
  assert.strictEqual(none.notes, null);

  log[day.exercises[0].id] = { sets: [{ reps: -3, weightLb: 'abc', timeMin: NaN, done: true }], notes: null };
  const bad = plain(FW.buildSession({ id: 'i', day: 2, startedAt: '2026-10-11T14:30:00.000Z', completedAt: null, notes: null, exercises: day.exercises, log }));
  checkSession(bad);
  assert.deepStrictEqual(bad.entries[0].sets[0], { reps: null, weightLb: null, timeMin: null, done: true });
});

test('summarize, countDone, formatClock, toNum', () => {
  const s = FW.buildSession({
    id: 'i', day: 1, startedAt: '2026-10-11T14:30:00.000Z', completedAt: '2026-10-11T15:00:00.000Z', notes: null,
    exercises: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    log: { a: { sets: [{ reps: 1, weightLb: 1, timeMin: null, done: true }, { reps: 1, weightLb: 1, timeMin: null, done: true }], notes: '' },
           b: { sets: [{ reps: 1, weightLb: 1, timeMin: null, done: false }], notes: 'n' } },
  });
  assert.deepStrictEqual(plain(FW.summarize(s)), { id: 'i', day: 1, startedAt: '2026-10-11T14:30:00.000Z', completedAt: '2026-10-11T15:00:00.000Z', exerciseCount: 2, setsDone: 2 });
  assert.strictEqual(FW.countDone({ a: { sets: [{ done: true }, { done: false }] }, b: { sets: [{ done: true }] } }), 2);
  assert.strictEqual(FW.formatClock(125), '2:05');
  assert.strictEqual(FW.formatClock(0), '0:00');
  assert.strictEqual(FW.formatClock(59.2), '1:00');
  assert.strictEqual(FW.toNum(''), null);
  assert.strictEqual(FW.toNum('17.5'), 17.5);
  assert.strictEqual(FW.toNum(0), 0);
  assert.strictEqual(FW.toNum(-1), null);
});

test('preview builds and mock backend follows section 4 shapes', async () => {
  const { build } = require('../dev/build-preview.js');
  const { html: preview } = build();
  assert.ok(preview.includes('fw-dev-mock') && preview.includes('id="fw-logic"'));

  const ctx = vm.createContext({ setTimeout, JSON, Error, Date });
  ctx.globalThis = ctx;
  ctx.__FW_ROUTINE__ = routine;
  vm.runInContext(fs.readFileSync(path.join(root, 'dev', 'mock-gas.js'), 'utf8'), ctx);
  const call = (name, ...args) => new Promise((res, rej) => {
    ctx.google.script.run.withSuccessHandler(res).withFailureHandler(rej)[name](...args);
  });
  const data = plain(await call('getAppData'));
  assert.deepStrictEqual(Object.keys(data).sort(), ['lastByDay', 'recent', 'routine']);
  assert.deepStrictEqual(Object.keys(data.lastByDay), ['1', '2', '3', '4']);
  assert.strictEqual(data.lastByDay['3'], null);
  const session = {
    schemaVersion: 1, id: 'abcdef12-0000-4000-8000-000000000000', day: 3, startedAt: '2026-10-11T14:30:00.000Z',
    completedAt: '2026-10-11T15:00:00.000Z', notes: null,
    entries: [{ exerciseId: 'd3-dumbbell-row', name: 'Dumbbell Row', sets: [{ reps: 15, weightLb: 52.5, timeMin: null, done: true }], notes: null }],
  };
  const saved = plain(await call('saveSession', session));
  assert.strictEqual(saved.fileName, '2026-10-11T143000Z_d3_abcdef12.json');
  const back = plain(await call('getSession', session.id));
  assert.ok(back.savedAt);
  await assert.rejects(call('getSession', 'nope'), (e) => /Session not found: nope/.test(e.message));
  const list = plain(await call('listSessions', 50));
  assert.ok(list.some((s) => s.id === session.id && s.setsDone === 1 && s.exerciseCount === 1));
});

test('removeSetAt removes one set, keeps at least one, never mutates', () => {
  const sets = [{ reps: 1 }, { reps: 2 }, { reps: 3 }];
  assert.deepStrictEqual(plain(FW.removeSetAt(sets, 1)), [{ reps: 1 }, { reps: 3 }]);
  assert.deepStrictEqual(plain(FW.removeSetAt(sets, 0)), [{ reps: 2 }, { reps: 3 }]);
  assert.deepStrictEqual(plain(FW.removeSetAt(sets, 2)), [{ reps: 1 }, { reps: 2 }]);
  assert.strictEqual(sets.length, 3, 'input not mutated');
  assert.deepStrictEqual(plain(FW.removeSetAt([{ reps: 9 }], 0)), [{ reps: 9 }], 'last set is kept');
  assert.deepStrictEqual(plain(FW.removeSetAt(sets, 5)), plain(sets), 'out of range is a no-op');
  assert.deepStrictEqual(plain(FW.removeSetAt(sets, -1)), plain(sets), 'negative index is a no-op');
});
