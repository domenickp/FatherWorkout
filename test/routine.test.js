'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseCsv, buildRoutine, slugify } = require('../tools/export-routine.js');

const root = path.resolve(__dirname, '..');
const csvPath = path.join(root, 'data', 'expanded-routine.csv');
const jsonPath = path.join(root, 'data', 'routine.json');
const script = path.join(root, 'tools', 'export-routine.js');
const routine = buildRoutine(fs.readFileSync(csvPath, 'utf8'));
const all = routine.days.flatMap((d) => d.exercises);
const byId = (id) => all.find((e) => e.id === id);

test('parseCsv: quoted commas, escaped quotes, blank trailing fields', () => {
  assert.deepStrictEqual(parseCsv('a,"b, c",d\n'), [['a', 'b, c', 'd']]);
  assert.deepStrictEqual(parseCsv('"say ""hi""",x'), [['say "hi"', 'x']]);
  assert.deepStrictEqual(parseCsv('1,,,\r\n2,,\r\n'), [['1', '', '', ''], ['2', '', '']]);
  assert.deepStrictEqual(parseCsv('"multi\nline",z'), [['multi\nline', 'z']]);
  assert.deepStrictEqual(parseCsv('a,b'), [['a', 'b']]);
});

test('slugify', () => {
  assert.strictEqual(slugify('Warm Up: Stationary Bike'), 'warm-up-stationary-bike');
  assert.strictEqual(slugify('  Single-Leg Calf Raise! '), 'single-leg-calf-raise');
});

test('structure: 4 days, 38 exercises, areas', () => {
  assert.strictEqual(routine.schemaVersion, 1);
  assert.deepStrictEqual(routine.source, {
    tab: 'Expanded Routine',
  });
  assert.deepStrictEqual(routine.days.map((d) => d.day), [1, 2, 3, 4]);
  assert.deepStrictEqual(routine.days.map((d) => d.areas),
    ['Chest, Triceps', 'Legs', 'Back, Biceps', 'Shoulders, Abs']);
  assert.strictEqual(all.length, 38);
});

test('every exercise has the contract keys and types; ids unique and well-formed', () => {
  const keys = ['id', 'name', 'warmup', 'sets', 'reps', 'weightLb', 'timeMin', 'timeSec', 'rest', 'notes'];
  const num = (v) => v === null || (typeof v === 'number' && Number.isFinite(v));
  const str = (v) => v === null || (typeof v === 'string' && v === v.trim() && v !== '');
  for (const e of all) {
    assert.deepStrictEqual(Object.keys(e), keys);
    assert.strictEqual(typeof e.id, 'string');
    assert.strictEqual(typeof e.name, 'string');
    assert.strictEqual(typeof e.warmup, 'boolean');
    assert.ok(num(e.sets) && num(e.reps) && num(e.weightLb) && num(e.timeMin) && num(e.timeSec), e.id);
    assert.ok(str(e.rest) && str(e.notes), e.id);
    assert.match(e.id, /^d[1-4]-[a-z0-9]+(-[a-z0-9]+)*$/);
  }
  assert.strictEqual(new Set(all.map((e) => e.id)).size, all.length);
  for (const d of routine.days) for (const e of d.exercises) assert.ok(e.id.startsWith(`d${d.day}-`));
});

test('spot checks', () => {
  assert.strictEqual(byId('d2-bulgarian-split-squat').weightLb, 17.5);
  const hang = byId('d3-dead-hangs');
  assert.strictEqual(hang.reps, null);
  assert.strictEqual(hang.timeMin, null);
  assert.strictEqual(hang.timeSec, 60);
  assert.strictEqual(hang.rest, '60 sec');
  assert.strictEqual(byId('d1-dumbbell-flys').rest, '60–90 sec');
  const bike = byId('d1-warm-up-stationary-bike');
  assert.strictEqual(bike.warmup, true);
  assert.strictEqual(bike.timeMin, 10);
  assert.strictEqual(bike.sets, 1);
  assert.ok(byId('d2-dumbbell-romanian-deadlift').notes.startsWith('Weight is per hand.'));
  const press = byId('d4-warm-up-shoulder-press');
  assert.strictEqual(press.reps, 25);
  assert.strictEqual(press.weightLb, null);
  assert.strictEqual(byId('d1-dumbbell-press').warmup, false);
});

test('duplicate names within a day get -2, -3 suffixes', () => {
  const r = buildRoutine('Day,Areas,Exercise,Sets,Reps per set,Weight (pounds),Time (minutes),Rest between sets,Notes\n' +
    '1,A,Curl,3,10,,,,\n1,A,Curl,3,10,,,,\n1,A,curl!,3,10,,,,\n');
  assert.deepStrictEqual(r.days[0].exercises.map((e) => e.id), ['d1-curl', 'd1-curl-2', 'd1-curl-3']);
});

test('committed routine.json matches generator and re-runs are byte-identical', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-'));
  try {
    const a = path.join(tmp, 'a.json');
    const b = path.join(tmp, 'b.json');
    // Absolute paths resolve as-is, independent of cwd.
    execFileSync(process.execPath, [script, csvPath, a, path.join(tmp, 'a.js')], { cwd: tmp });
    execFileSync(process.execPath, [script, csvPath, b, path.join(tmp, 'b.js')], { cwd: tmp });
    const bufA = fs.readFileSync(a);
    assert.ok(bufA.equals(fs.readFileSync(b)));
    assert.ok(bufA.equals(fs.readFileSync(jsonPath)), 'data/routine.json is stale; re-run the exporter');
    const text = bufA.toString('utf8');
    assert.ok(text.endsWith('}\n'));
    assert.ok(text.includes('60–90 sec'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('src/Routine.js bundles exactly data/routine.json', () => {
  const { routineScript } = require(path.join(__dirname, '..', 'tools', 'export-routine.js'));
  const bundled = fs.readFileSync(path.join(__dirname, '..', 'src', 'Routine.js'), 'utf8');
  assert.strictEqual(bundled.replace(/\r\n/g, '\n'), routineScript(routine), 'regenerate with: node tools/export-routine.js');
});

test('Time (seconds) column: present, absent, and both-values error', () => {
  const head = 'Day,Areas,Exercise,Sets,Reps per set,Weight (pounds),Time (minutes),';
  const tail = 'Rest between sets,Notes';
  const withCol = head + 'Time (seconds),' + tail + '\n1,A,Hang,3,,,,60,60 sec,\n1,A,Bike,1,,,10,,,\n';
  const r1 = buildRoutine(withCol).days[0].exercises;
  assert.deepStrictEqual([r1[0].timeMin, r1[0].timeSec], [null, 60]);
  assert.deepStrictEqual([r1[1].timeMin, r1[1].timeSec], [10, null]);
  assert.deepStrictEqual(Object.keys(r1[0]).slice(6, 8), ['timeMin', 'timeSec']);
  const noCol = head + tail + '\n1,A,Bike,1,,,10,,\n';
  const r2 = buildRoutine(noCol).days[0].exercises;
  assert.deepStrictEqual([r2[0].timeMin, r2[0].timeSec], [10, null]);
  const both = head + 'Time (seconds),' + tail + '\n1,A,Oops,1,,,1,30,,\n';
  assert.throws(() => buildRoutine(both), /both Time \(minutes\) and Time \(seconds\)/);
});
