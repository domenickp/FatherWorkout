// Runs src/Routine.js + src/Lib.js + src/Code.js together against a small in-memory fake
// of the Apps Script services they use (DriveApp, PropertiesService, Logger), one fake per
// user, to check the multi-user server behaviour without deploying.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sources = ['src/Routine.js', 'src/Lib.js', 'src/Code.js']
  .map(f => [f, fs.readFileSync(path.join(root, f), 'utf8')]);

function iter(list) {
  let i = 0;
  return { hasNext: () => i < list.length, next: () => list[i++] };
}

// One Google user: their own Drive root and their own User Properties.
function fakeUser() {
  const byId = {};
  let n = 0;
  function folder(name) {
    const f = {
      id: 'folder' + (++n), name, folders: [], files: [],
      getId() { return this.id; }, getName() { return this.name; }, isTrashed() { return false; },
      getFoldersByName(x) { return iter(this.folders.filter(c => c.name === x)); },
      createFolder(x) { const c = folder(x); this.folders.push(c); return c; },
      getFilesByName(x) { return iter(this.files.filter(c => c.name === x)); },
      getFiles() { return iter(this.files.slice()); },
      createFile(x, content) {
        const file = {
          name: x, content,
          getName() { return this.name; }, isTrashed() { return false; },
          setContent(c) { this.content = c; },
          getBlob() { const self = this; return { getDataAsString: () => self.content }; }
        };
        this.files.push(file);
        return file;
      }
    };
    byId[f.id] = f;
    return f;
  }
  const driveRoot = folder('My Drive');
  const userProps = {};
  const ctx = vm.createContext({
    DriveApp: {
      getRootFolder: () => driveRoot,
      getFolderById: (id) => { if (!byId[id]) throw new Error('No item with the given ID'); return byId[id]; }
    },
    PropertiesService: {
      getUserProperties: () => ({ getProperty: k => userProps[k] || null, setProperty: (k, v) => { userProps[k] = v; } }),
      getScriptProperties: () => { throw new Error('Script Properties are shared by all users; must not be used'); }
    },
    Logger: { log() {} }
  });
  for (const [file, code] of sources) vm.runInContext(code, ctx, { filename: file });
  return { ctx, driveRoot, userProps, call: (expr) => JSON.parse(JSON.stringify(vm.runInContext(expr, ctx))) };
}

function sessionFor(routine, id, day, startedAt) {
  const ex = routine.days.find(d => d.day === day).exercises[2];
  return {
    schemaVersion: 1, id, day, startedAt, completedAt: startedAt.replace('T10', 'T11'), notes: null,
    entries: [{ exerciseId: ex.id, name: ex.name, notes: null, sets: [{ reps: 12, weightLb: 40, timeMin: null, done: true }] }]
  };
}

test('first visit: bundled routine, empty history, data folder created in the user\'s Drive', () => {
  const u = fakeUser();
  const data = u.call('getAppData()');
  assert.strictEqual(data.routine.days.length, 4);
  assert.deepStrictEqual(data.recent, []);
  assert.deepStrictEqual(Object.values(data.lastByDay), [null, null, null, null]);
  assert.deepStrictEqual(u.driveRoot.folders.map(f => f.name), ['FatherWorkout Data']);
  assert.ok(u.userProps.DATA_FOLDER_ID, 'folder id cached in User Properties');
});

test('save then reload: history, lastByDay and getSession come from the user\'s own files', () => {
  const u = fakeUser();
  const routine = u.call('ROUTINE_');
  u.ctx.__s = sessionFor(routine, '11111111-2222-4333-8444-555555555555', 2, '2026-10-12T10:00:00.000Z');
  const res = u.call('saveSession(__s)');
  assert.strictEqual(res.fileName, '2026-10-12T100000Z_d2_11111111.json');
  const data = u.call('getAppData()');
  assert.strictEqual(data.recent.length, 1);
  assert.strictEqual(data.lastByDay['2'].id, '11111111-2222-4333-8444-555555555555');
  assert.strictEqual(u.call('getSession("11111111-2222-4333-8444-555555555555")').day, 2);
  assert.throws(() => u.call('getSession("99999999-0000-4000-8000-000000000000")'), /Session not found/);
});

test('invalid sessions are rejected against the bundled routine', () => {
  const u = fakeUser();
  const routine = u.call('ROUTINE_');
  u.ctx.__s = { ...sessionFor(routine, '11111111-2222-4333-8444-555555555555', 2, '2026-10-12T10:00:00.000Z'), day: 9 };
  assert.throws(() => u.call('saveSession(__s)'), /Invalid session: day 9 is not in the routine/);
});

test('two users are fully isolated', () => {
  const a = fakeUser();
  const b = fakeUser();
  const routine = a.call('ROUTINE_');
  a.ctx.__s = sessionFor(routine, 'aaaaaaaa-2222-4333-8444-555555555555', 1, '2026-10-12T10:00:00.000Z');
  a.call('saveSession(__s)');
  assert.strictEqual(a.call('getAppData()').recent.length, 1);
  assert.strictEqual(b.call('getAppData()').recent.length, 0);
  assert.notStrictEqual(a.userProps.DATA_FOLDER_ID, undefined);
  assert.notStrictEqual(b.userProps.DATA_FOLDER_ID, undefined);
});

test('cached folder id is reused, not re-created', () => {
  const u = fakeUser();
  u.call('getAppData()');
  u.call('getAppData()');
  assert.strictEqual(u.driveRoot.folders.length, 1);
});
