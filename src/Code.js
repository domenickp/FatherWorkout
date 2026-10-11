/**
 * Apps Script server (contracts §3-§4). Thin Drive I/O; decisions live in Lib.js.
 * Functions ending in "_" are private and not callable from the client.
 *
 * Multi-user: the web app runs as the person visiting it, with the drive.file scope,
 * so every user's history lives in their own Drive in a folder this app created.
 * The routine is bundled (src/Routine.js) and is the same for everyone.
 */

var DATA_FOLDER_NAME_ = 'FatherWorkout Data';
var SESSIONS_FOLDER_NAME_ = 'sessions';
var FOLDER_ID_PROP_ = 'DATA_FOLDER_ID';

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Father Workout')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getAppData() {
  var routine = ROUTINE_;
  var sessions = sortSessionsNewestFirst(readAllSessions_());
  var days = routine.days.map(function (d) { return d.day; });
  return {
    routine: routine,
    recent: sessions.slice(0, 20).map(summarizeSession),
    lastByDay: latestCompletedByDay(sessions, days)
  };
}

function saveSession(session) {
  var routine = ROUTINE_;
  var errors = validateSession(session, routine);
  if (errors.length) throw new Error('Invalid session: ' + errors.join('; '));

  session.savedAt = new Date().toISOString();
  var fileName = sessionFileName(session);
  var content = JSON.stringify(session, null, 2);
  var folder = getSessionsFolder_();
  var files = folder.getFilesByName(fileName);
  if (files.hasNext()) {
    files.next().setContent(content);
  } else {
    folder.createFile(fileName, content, 'application/json');
  }
  return { id: session.id, fileName: fileName, savedAt: session.savedAt };
}

function listSessions(limit) {
  var n = (typeof limit === 'number' && limit > 0) ? Math.floor(limit) : 50;
  return sortSessionsNewestFirst(readAllSessions_()).slice(0, n).map(summarizeSession);
}

function getSession(id) {
  var suffix = '_' + String(id).slice(0, 8) + '.json';
  var files = getSessionsFolder_().getFiles();
  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName();
    if (name.length < suffix.length || name.slice(-suffix.length) !== suffix) continue;
    var session = parseSessionFile_(file);
    if (session && session.id === id) return session;
  }
  throw new Error('Session not found: ' + id);
}

// ---- private helpers ----

function getDataFolder_() {
  // Per-user: each visitor's folder id is stored in their own User Properties.
  var props = PropertiesService.getUserProperties();
  var cachedId = props.getProperty(FOLDER_ID_PROP_);
  if (cachedId) {
    try {
      var cached = DriveApp.getFolderById(cachedId);
      if (!cached.isTrashed()) return cached;
    } catch (err) {
      Logger.log('Cached data folder unavailable: ' + err);
    }
  }
  var root = DriveApp.getRootFolder();
  var found = root.getFoldersByName(DATA_FOLDER_NAME_);
  var folder = null;
  while (found.hasNext()) {
    var f = found.next();
    if (!f.isTrashed()) { folder = f; break; }
  }
  if (!folder) folder = root.createFolder(DATA_FOLDER_NAME_);
  props.setProperty(FOLDER_ID_PROP_, folder.getId());
  return folder;
}

function getSessionsFolder_() {
  var data = getDataFolder_();
  var found = data.getFoldersByName(SESSIONS_FOLDER_NAME_);
  while (found.hasNext()) {
    var f = found.next();
    if (!f.isTrashed()) return f;
  }
  return data.createFolder(SESSIONS_FOLDER_NAME_);
}

function parseSessionFile_(file) {
  try {
    return JSON.parse(file.getBlob().getDataAsString('UTF-8'));
  } catch (err) {
    Logger.log('Skipping unparseable session file ' + file.getName() + ': ' + err);
    return null;
  }
}

function readAllSessions_() {
  var sessions = [];
  var files = getSessionsFolder_().getFiles();
  while (files.hasNext()) {
    var file = files.next();
    if (!/\.json$/.test(file.getName())) continue;
    var s = parseSessionFile_(file);
    if (s && typeof s === 'object' && typeof s.startedAt === 'string' && Array.isArray(s.entries)) {
      sessions.push(s);
    } else if (s) {
      Logger.log('Skipping malformed session file ' + file.getName());
    }
  }
  return sessions;
}
