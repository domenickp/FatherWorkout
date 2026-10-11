// Runs src/Routine.js + src/Lib.js + src/Code.js together against an in-memory fake of the
// Apps Script services they may use, one fake per Google user, to check the multi-user
// server without deploying.
//
// The fake models the deployed permission set (drive.file + script.external_request):
//  - DriveApp throws exactly like production, because every DriveApp method needs the
//    full drive (or drive.readonly) scope. An earlier fake allowed DriveApp, and the
//    first multi-user release failed in production with this error.
//  - Drive is reached through the REST API via UrlFetchApp with the user's own token, and
//    list only returns files this app created (drive.file semantics).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sources = ['src/Routine.js', 'src/Lib.js', 'src/Code.js']
  .map(f => [f, fs.readFileSync(path.join(root, f), 'utf8')]);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src', 'appsscript.json'), 'utf8'));

const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';

function response(code, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { getResponseCode: () => code, getContentText: () => text };
}

// Minimal Drive v3 query evaluator for the clauses the server uses, joined by " and ".
function matches(file, q) {
  return q.split(' and ').every(clause => {
    let m;
    if ((m = /^name = '(.*)'$/.exec(clause))) return file.name === m[1];
    if ((m = /^mimeType = '(.*)'$/.exec(clause))) return file.mimeType === m[1];
    if ((m = /^mimeType != '(.*)'$/.exec(clause))) return file.mimeType !== m[1];
    if ((m = /^'(.*)' in parents$/.exec(clause))) return file.parents.includes(m[1]);
    if (clause === 'trashed = false') return !file.trashed;
    throw new Error('fake Drive: unsupported query clause: ' + clause);
  });
}

// One Google user: their own Drive, User Properties and OAuth token.
function fakeUser(label) {
  const token = 'token-' + label;
  const files = {};           // id -> { id, name, mimeType, parents, trashed, content, byApp }
  let n = 0;
  const userProps = {};
  const calls = [];

  function handle(url, opts = {}) {
    const method = (opts.method || 'get').toLowerCase();
    calls.push(method.toUpperCase() + ' ' + url.split('?')[0]);
    if ((opts.headers || {}).Authorization !== 'Bearer ' + token) return response(401, { error: { message: 'bad token' } });
    const [base, qs = ''] = url.split('?');
    const params = new URLSearchParams(qs);
    if (method === 'get' && base === API) {
      const visible = Object.values(files).filter(f => f.byApp);   // drive.file: app-created only
      return response(200, { files: visible.filter(f => matches(f, params.get('q'))).map(f => ({ id: f.id, name: f.name })) });
    }
    if (method === 'post' && base === API) {
      const meta = JSON.parse(opts.payload);
      const id = 'id' + (++n);
      files[id] = { id, name: meta.name, mimeType: meta.mimeType, parents: meta.parents || ['root'], trashed: false, content: '', byApp: true };
      return response(200, { id });
    }
    if (method === 'get' && base.startsWith(API + '/')) {
      const f = files[decodeURIComponent(base.slice(API.length + 1))];
      if (!f || !f.byApp) return response(404, { error: { message: 'File not found' } });
      if (params.get('alt') === 'media') return response(200, f.content);
      return response(200, { id: f.id, trashed: f.trashed });
    }
    if (method === 'patch' && base.startsWith(UPLOAD + '/')) {
      const f = files[decodeURIComponent(base.slice(UPLOAD.length + 1))];
      if (!f || !f.byApp) return response(404, { error: { message: 'File not found' } });
      f.content = opts.payload;
      return response(200, { id: f.id });
    }
    return response(400, { error: { message: 'fake Drive: unexpected ' + method + ' ' + url } });
  }

  const driveAppError = () => {
    throw new Error('Exception: Specified permissions are not sufficient to call DriveApp. Required permissions: ' +
      '(https://www.googleapis.com/auth/drive.readonly || https://www.googleapis.com/auth/drive)');
  };
  const ctx = vm.createContext({
    DriveApp: new Proxy({}, { get: () => driveAppError }),
    ScriptApp: { getOAuthToken: () => token },
    UrlFetchApp: {
      fetch: (url, opts) => handle(url, opts),
      fetchAll: (reqs) => reqs.map(r => handle(r.url, r))
    },
    PropertiesService: {
      getUserProperties: () => ({ getProperty: k => userProps[k] || null, setProperty: (k, v) => { userProps[k] = v; } }),
      getScriptProperties: () => { throw new Error('Script Properties are shared by all users; must not be used'); }
    },
    Logger: { log() {} }
  });
  for (const [file, code] of sources) vm.runInContext(code, ctx, { filename: file });
  return {
    ctx, files, userProps, calls,
    call: (expr) => JSON.parse(JSON.stringify(vm.runInContext(expr, ctx))),
    // A file the user made themselves (not by this app): invisible under drive.file.
    addUserFile(name, mimeType, parents) {
      const id = 'user' + (++n);
      files[id] = { id, name, mimeType, parents, trashed: false, content: '', byApp: false };
      return id;
    }
  };
}

function sessionFor(routine, id, day, startedAt) {
  const ex = routine.days.find(d => d.day === day).exercises[2];
  return {
    schemaVersion: 1, id, day, startedAt, completedAt: startedAt.replace('T10', 'T11'), notes: null,
    entries: [{ exerciseId: ex.id, name: ex.name, notes: null, sets: [{ reps: 12, weightLb: 40, timeMin: null, done: true }] }]
  };
}

test('manifest: drive.file + external_request only, runs as the visitor, open to Google users', () => {
  assert.deepStrictEqual(manifest.oauthScopes.slice().sort(), [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/script.external_request'
  ]);
  assert.deepStrictEqual(manifest.webapp, { executeAs: 'USER_ACCESSING', access: 'ANYONE' });
});

test('server never uses DriveApp (needs a broader scope than the manifest grants)', () => {
  const code = sources.map(([, c]) => c.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')).join('\n');
  assert.doesNotMatch(code, /\bDriveApp\s*\./);
});

test('first visit: bundled routine, empty history, data folder + sessions folder created by the app', () => {
  const u = fakeUser('a');
  const data = u.call('getAppData()');
  assert.strictEqual(data.routine.days.length, 4);
  assert.deepStrictEqual(data.recent, []);
  assert.deepStrictEqual(Object.values(data.lastByDay), [null, null, null, null]);
  const folders = Object.values(u.files).filter(f => f.mimeType === FOLDER).map(f => f.name).sort();
  assert.deepStrictEqual(folders, ['FatherWorkout Data', 'sessions']);
  assert.ok(u.userProps.DATA_FOLDER_ID, 'folder id cached in User Properties');
});

test('save then reload: history, lastByDay and getSession come from the user\'s own files', () => {
  const u = fakeUser('a');
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

test('saving the same session again overwrites its file instead of duplicating it', () => {
  const u = fakeUser('a');
  const routine = u.call('ROUTINE_');
  u.ctx.__s = sessionFor(routine, '11111111-2222-4333-8444-555555555555', 2, '2026-10-12T10:00:00.000Z');
  u.call('saveSession(__s)');
  u.ctx.__s.notes = 'second save';
  u.call('saveSession(__s)');
  const sessionFiles = Object.values(u.files).filter(f => f.mimeType === 'application/json');
  assert.strictEqual(sessionFiles.length, 1);
  assert.strictEqual(JSON.parse(sessionFiles[0].content).notes, 'second save');
});

test('invalid sessions are rejected against the bundled routine', () => {
  const u = fakeUser('a');
  const routine = u.call('ROUTINE_');
  u.ctx.__s = { ...sessionFor(routine, '11111111-2222-4333-8444-555555555555', 2, '2026-10-12T10:00:00.000Z'), day: 9 };
  assert.throws(() => u.call('saveSession(__s)'), /Invalid session: day 9 is not in the routine/);
});

test('two users are fully isolated', () => {
  const a = fakeUser('a');
  const b = fakeUser('b');
  const routine = a.call('ROUTINE_');
  a.ctx.__s = sessionFor(routine, 'aaaaaaaa-2222-4333-8444-555555555555', 1, '2026-10-12T10:00:00.000Z');
  a.call('saveSession(__s)');
  assert.strictEqual(a.call('getAppData()').recent.length, 1);
  assert.strictEqual(b.call('getAppData()').recent.length, 0);
});

test('a same-named folder the user made themselves is ignored (drive.file)', () => {
  const u = fakeUser('a');
  u.addUserFile('FatherWorkout Data', FOLDER, ['root']);
  u.call('getAppData()');
  const appFolder = Object.values(u.files).find(f => f.byApp && f.name === 'FatherWorkout Data');
  assert.ok(appFolder, 'app created its own folder');
  assert.strictEqual(u.userProps.DATA_FOLDER_ID, appFolder.id);
});

test('cached folder id is reused; a trashed or deleted cached folder is replaced', () => {
  const u = fakeUser('a');
  u.call('getAppData()');
  u.call('getAppData()');
  assert.strictEqual(Object.values(u.files).filter(f => f.name === 'FatherWorkout Data').length, 1);
  u.files[u.userProps.DATA_FOLDER_ID].trashed = true;
  u.call('getAppData()');
  const live = Object.values(u.files).filter(f => f.name === 'FatherWorkout Data' && !f.trashed);
  assert.strictEqual(live.length, 1);
  assert.strictEqual(u.userProps.DATA_FOLDER_ID, live[0].id);
});

test('an unparseable session file is skipped, not fatal', () => {
  const u = fakeUser('a');
  const routine = u.call('ROUTINE_');
  u.ctx.__s = sessionFor(routine, '11111111-2222-4333-8444-555555555555', 2, '2026-10-12T10:00:00.000Z');
  u.call('saveSession(__s)');
  const sessionsFolder = Object.values(u.files).find(f => f.name === 'sessions');
  const id = 'broken';
  u.files[id] = { id, name: 'broken.json', mimeType: 'application/json', parents: [sessionsFolder.id], trashed: false, content: '{nope', byApp: true };
  assert.strictEqual(u.call('getAppData()').recent.length, 1);
});
