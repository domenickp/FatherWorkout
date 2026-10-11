// Mock of google.script.run for the local preview. Same names and return shapes as
// docs/contracts.md section 4; sessions live in memory. Expects globalThis.__FW_ROUTINE__.
(function (root) {
  'use strict';
  var LATENCY = 300;
  var routine = root.__FW_ROUTINE__;
  var sessions = [];

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function summarize(s) {
    var done = 0;
    s.entries.forEach(function (e) { e.sets.forEach(function (x) { if (x.done) done++; }); });
    return { id: s.id, day: s.day, startedAt: s.startedAt, completedAt: s.completedAt, exerciseCount: s.entries.length, setsDone: done };
  }
  function newestFirst() {
    return sessions.slice().sort(function (a, b) { return a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0; });
  }

  // Seed two past sessions so "last time" and history have something to show.
  function seed(dayNum, daysAgo, bump) {
    var day = routine.days.filter(function (d) { return d.day === dayNum; })[0];
    if (!day) return;
    var start = new Date(Date.now() - daysAgo * 86400000);
    var entries = day.exercises.filter(function (e) { return !e.warmup; }).slice(0, 4).map(function (ex) {
      var sets = [];
      for (var i = 0; i < (ex.sets || 1); i++) {
        sets.push({
          reps: ex.reps === null ? null : ex.reps - (i === 2 ? 2 : 0),
          weightLb: ex.weightLb === null ? null : ex.weightLb + bump,
          timeMin: ex.reps === null ? ex.timeMin : null,
          done: true
        });
      }
      return { exerciseId: ex.id, name: ex.name, sets: sets, notes: null };
    });
    sessions.push({
      schemaVersion: 1, id: 'seed-' + dayNum + '-' + daysAgo, day: dayNum, startedAt: start.toISOString(),
      completedAt: new Date(start.getTime() + 50 * 60000).toISOString(), entries: entries, notes: null,
      savedAt: new Date(start.getTime() + 51 * 60000).toISOString()
    });
  }
  seed(1, 4, 0);
  seed(2, 2, 0);

  var api = {
    getAppData: function () {
      var lastByDay = {};
      routine.days.forEach(function (d) {
        var hit = newestFirst().filter(function (s) { return s.day === d.day && s.completedAt; })[0];
        lastByDay[String(d.day)] = hit ? clone(hit) : null;
      });
      return { routine: clone(routine), recent: newestFirst().slice(0, 20).map(summarize), lastByDay: lastByDay };
    },
    saveSession: function (session) {
      if (!session || !session.id || !Array.isArray(session.entries)) throw new Error('Invalid session: malformed');
      var saved = clone(session);
      saved.savedAt = new Date().toISOString();
      sessions = sessions.filter(function (s) { return s.id !== saved.id; });
      sessions.push(saved);
      var t = saved.startedAt.replace(/\.\d+Z$/, 'Z').replace(/:/g, '');
      return { id: saved.id, fileName: t + '_d' + saved.day + '_' + saved.id.slice(0, 8) + '.json', savedAt: saved.savedAt };
    },
    listSessions: function (limit) {
      return newestFirst().slice(0, limit || 50).map(summarize);
    },
    getSession: function (id) {
      var hit = sessions.filter(function (s) { return s.id === id; })[0];
      if (!hit) throw new Error('Session not found: ' + id);
      return clone(hit);
    }
  };

  // Chainable builder, like the real google.script.run. Add ?fail=getAppData to the URL
  // (or ?fail=saveSession) to exercise the error paths.
  function failing(name) {
    try { return new RegExp('[?&]fail=' + name + '(&|$)').test(root.location.search); } catch (e) { return false; }
  }
  function builder(ok, bad) {
    var b = {
      withSuccessHandler: function (fn) { return builder(fn, bad); },
      withFailureHandler: function (fn) { return builder(ok, fn); }
    };
    Object.keys(api).forEach(function (name) {
      b[name] = function () {
        var args = Array.prototype.slice.call(arguments);
        setTimeout(function () {
          var result;
          try {
            if (failing(name)) throw new Error('Simulated ' + name + ' failure');
            result = api[name].apply(null, args);
          } catch (e) {
            if (bad) bad({ message: e.message });
            return;
          }
          if (ok) ok(result);
        }, LATENCY);
      };
    });
    return b;
  }
  root.google = { script: { run: builder(null, null) } };
})(typeof window !== 'undefined' ? window : globalThis);
