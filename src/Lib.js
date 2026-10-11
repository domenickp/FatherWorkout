/**
 * Pure logic for the workout tracker (contracts §2-§4).
 * No Apps Script APIs here; this file is unit-tested in Node (test/lib.test.js).
 */

var ISO_RE_ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isIsoString_(v) {
  return typeof v === 'string' && ISO_RE_.test(v) && !isNaN(Date.parse(v));
}

function isObject_(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isNonNegNumber_(v) {
  return typeof v === 'number' && isFinite(v) && v >= 0;
}

/** Returns an array of human-readable error strings; empty when valid. */
function validateSession(session, routine) {
  var errors = [];
  if (!isObject_(session)) return ['session must be an object'];

  if (typeof session.id !== 'string' || session.id.trim() === '') {
    errors.push('id must be a non-empty string');
  }

  var dayDef = null;
  if (typeof session.day !== 'number' || !isFinite(session.day) || Math.floor(session.day) !== session.day) {
    errors.push('day must be an integer');
  } else if (routine && Array.isArray(routine.days)) {
    for (var i = 0; i < routine.days.length; i++) {
      if (routine.days[i].day === session.day) { dayDef = routine.days[i]; break; }
    }
    if (!dayDef) errors.push('day ' + session.day + ' is not in the routine');
  }

  if (!isIsoString_(session.startedAt)) {
    errors.push('startedAt must be an ISO 8601 date string');
  }
  if (session.completedAt !== null && !isIsoString_(session.completedAt)) {
    errors.push('completedAt must be an ISO 8601 date string or null');
  }

  if (session.notes !== null && session.notes !== undefined && typeof session.notes !== 'string') {
    errors.push('notes must be a string or null');
  }

  if (!Array.isArray(session.entries) || session.entries.length === 0) {
    errors.push('entries must be a non-empty array');
    return errors;
  }

  var known = null;
  if (dayDef && Array.isArray(dayDef.exercises)) {
    known = {};
    dayDef.exercises.forEach(function (ex) { known[ex.id] = true; });
  }

  session.entries.forEach(function (entry, ei) {
    var p = 'entries[' + ei + ']';
    if (!isObject_(entry)) { errors.push(p + ' must be an object'); return; }
    if (typeof entry.exerciseId !== 'string' || entry.exerciseId === '') {
      errors.push(p + '.exerciseId must be a non-empty string');
    } else if (known && !known[entry.exerciseId]) {
      errors.push(p + '.exerciseId "' + entry.exerciseId + '" is not in the routine for day ' + session.day);
    }
    if (typeof entry.name !== 'string' || entry.name === '') {
      errors.push(p + '.name must be a non-empty string');
    }
    if (entry.notes !== null && entry.notes !== undefined && typeof entry.notes !== 'string') {
      errors.push(p + '.notes must be a string or null');
    }
    if (!Array.isArray(entry.sets) || entry.sets.length === 0) {
      errors.push(p + '.sets must be a non-empty array');
      return;
    }
    entry.sets.forEach(function (set, si) {
      var sp = p + '.sets[' + si + ']';
      if (!isObject_(set)) { errors.push(sp + ' must be an object'); return; }
      ['reps', 'weightLb', 'timeMin'].forEach(function (f) {
        if (set[f] !== null && !isNonNegNumber_(set[f])) {
          errors.push(sp + '.' + f + ' must be a number >= 0 or null');
        }
      });
      if (typeof set.done !== 'boolean') errors.push(sp + '.done must be a boolean');
    });
  });

  return errors;
}

/** `2026-10-11T143000Z_d1_0b9c6a8e.json` */
function sessionFileName(session) {
  var m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(session.startedAt);
  if (!m) throw new Error('Invalid startedAt: ' + session.startedAt);
  return m[1] + 'T' + m[2] + m[3] + m[4] + 'Z_d' + session.day + '_' + String(session.id).slice(0, 8) + '.json';
}

function summarizeSession(session) {
  var setsDone = 0;
  session.entries.forEach(function (e) {
    e.sets.forEach(function (s) { if (s.done === true) setsDone++; });
  });
  return {
    id: session.id,
    day: session.day,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    exerciseCount: session.entries.length,
    setsDone: setsDone
  };
}

function sortSessionsNewestFirst(sessions) {
  return sessions.slice().sort(function (a, b) {
    return a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0;
  });
}

/** days: number[]. Returns { "<day>": newest completed Session | null }. */
function latestCompletedByDay(sessions, days) {
  var out = {};
  days.forEach(function (d) { out[String(d)] = null; });
  sortSessionsNewestFirst(sessions).forEach(function (s) {
    var key = String(s.day);
    if (s.completedAt && Object.prototype.hasOwnProperty.call(out, key) && out[key] === null) {
      out[key] = s;
    }
  });
  return out;
}

if (typeof module !== 'undefined') {
  module.exports = {
    slugify: slugify,
    validateSession: validateSession,
    sessionFileName: sessionFileName,
    summarizeSession: summarizeSession,
    latestCompletedByDay: latestCompletedByDay,
    sortSessionsNewestFirst: sortSessionsNewestFirst
  };
}
