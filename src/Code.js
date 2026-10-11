/**
 * Apps Script server (contracts §3-§4). Thin Drive I/O; decisions live in Lib.js.
 * Functions ending in "_" are private and not callable from the client.
 *
 * Multi-user: the web app runs as the person visiting it, with only the drive.file scope,
 * so every user's history lives in their own Drive in a folder this app created, and the
 * app can't see any other file. The routine is bundled (src/Routine.js) and the same for all.
 *
 * Why the Drive REST API through UrlFetchApp instead of DriveApp: DriveApp requires the
 * full drive (or drive.readonly) scope for every method, and the Advanced Drive service
 * can't download file content (alt=media). The REST API works with drive.file, using the
 * visitor's own token (ScriptApp.getOAuthToken). That needs script.external_request.
 */

var DATA_FOLDER_NAME_ = 'FatherWorkout Data';
var SESSIONS_FOLDER_NAME_ = 'sessions';
var FOLDER_ID_PROP_ = 'DATA_FOLDER_ID';
var FOLDER_MIME_ = 'application/vnd.google-apps.folder';
var DRIVE_API_ = 'https://www.googleapis.com/drive/v3/files';
var DRIVE_UPLOAD_ = 'https://www.googleapis.com/upload/drive/v3/files';

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
  var folderId = getSessionsFolderId_();
  var existing = driveList_("name = '" + fileName + "' and '" + folderId + "' in parents and trashed = false");
  var fileId = existing.length
    ? existing[0].id
    : driveCreate_({ name: fileName, mimeType: 'application/json', parents: [folderId] });
  driveWriteContent_(fileId, content);
  return { id: session.id, fileName: fileName, savedAt: session.savedAt };
}

function listSessions(limit) {
  var n = (typeof limit === 'number' && limit > 0) ? Math.floor(limit) : 50;
  return sortSessionsNewestFirst(readAllSessions_()).slice(0, n).map(summarizeSession);
}

function getSession(id) {
  var suffix = '_' + String(id).slice(0, 8) + '.json';
  var files = sessionFiles_().filter(function (f) {
    return f.name.length >= suffix.length && f.name.slice(-suffix.length) === suffix;
  });
  var sessions = readJsonFiles_(files);
  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i] && sessions[i].id === id) return sessions[i];
  }
  throw new Error('Session not found: ' + id);
}

// ---- folders ----

function getDataFolderId_() {
  // Per-user: each visitor's folder id is stored in their own User Properties.
  var props = PropertiesService.getUserProperties();
  var cachedId = props.getProperty(FOLDER_ID_PROP_);
  if (cachedId) {
    try {
      var meta = driveGet_(cachedId, 'id,trashed');
      if (!meta.trashed) return cachedId;
    } catch (err) {
      Logger.log('Cached data folder unavailable: ' + err);
    }
  }
  var id = findOrCreateFolder_(DATA_FOLDER_NAME_, 'root');
  props.setProperty(FOLDER_ID_PROP_, id);
  return id;
}

function getSessionsFolderId_() {
  return findOrCreateFolder_(SESSIONS_FOLDER_NAME_, getDataFolderId_());
}

// With drive.file, list only returns folders this app created, so a same-named folder made
// by the user (or another app) is never picked up by mistake.
function findOrCreateFolder_(name, parentId) {
  var found = driveList_("name = '" + name + "' and mimeType = '" + FOLDER_MIME_ +
    "' and '" + parentId + "' in parents and trashed = false");
  if (found.length) return found[0].id;
  return driveCreate_({ name: name, mimeType: FOLDER_MIME_, parents: [parentId] });
}

// ---- sessions ----

function sessionFiles_() {
  return driveList_("'" + getSessionsFolderId_() + "' in parents and trashed = false and mimeType != '" + FOLDER_MIME_ + "'")
    .filter(function (f) { return /\.json$/.test(f.name); });
}

function readAllSessions_() {
  return readJsonFiles_(sessionFiles_()).filter(function (s, i) {
    if (s && typeof s === 'object' && typeof s.startedAt === 'string' && Array.isArray(s.entries)) return true;
    if (s) Logger.log('Skipping malformed session file #' + i);
    return false;
  });
}

// Downloads files in parallel. Unparseable or unreadable files become null (logged, never fatal).
function readJsonFiles_(files) {
  if (!files.length) return [];
  var token = ScriptApp.getOAuthToken();
  var responses = UrlFetchApp.fetchAll(files.map(function (f) {
    return {
      url: DRIVE_API_ + '/' + encodeURIComponent(f.id) + '?alt=media',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    };
  }));
  return responses.map(function (res, i) {
    if (res.getResponseCode() !== 200) {
      Logger.log('Skipping unreadable session file ' + files[i].name + ': HTTP ' + res.getResponseCode());
      return null;
    }
    try {
      return JSON.parse(res.getContentText('UTF-8'));
    } catch (err) {
      Logger.log('Skipping unparseable session file ' + files[i].name + ': ' + err);
      return null;
    }
  });
}

// ---- Drive REST (v3) ----

function driveRequest_(method, url, payload, contentType) {
  var options = {
    method: method,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  };
  if (payload !== undefined) {
    options.payload = payload;
    options.contentType = contentType;
  }
  var res = UrlFetchApp.fetch(url, options);
  var code = res.getResponseCode();
  var text = res.getContentText('UTF-8');
  if (code < 200 || code >= 300) {
    var msg = text;
    try { msg = JSON.parse(text).error.message; } catch (e) { /* keep raw text */ }
    throw new Error('Drive ' + method.toUpperCase() + ' failed (HTTP ' + code + '): ' + msg);
  }
  return text ? JSON.parse(text) : {};
}

// Returns [{ id, name }] for every match (follows pagination).
function driveList_(q) {
  var out = [];
  var pageToken = '';
  do {
    var url = DRIVE_API_ + '?q=' + encodeURIComponent(q) +
      '&fields=' + encodeURIComponent('nextPageToken,files(id,name)') +
      '&pageSize=1000&spaces=drive' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    var page = driveRequest_('get', url);
    out = out.concat(page.files || []);
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return out;
}

function driveGet_(id, fields) {
  return driveRequest_('get', DRIVE_API_ + '/' + encodeURIComponent(id) + '?fields=' + encodeURIComponent(fields));
}

// Creates a file or folder from metadata; returns its id.
function driveCreate_(metadata) {
  return driveRequest_('post', DRIVE_API_ + '?fields=id', JSON.stringify(metadata), 'application/json').id;
}

function driveWriteContent_(id, content) {
  driveRequest_('patch', DRIVE_UPLOAD_ + '/' + encodeURIComponent(id) + '?uploadType=media&fields=id',
    content, 'application/json');
}
