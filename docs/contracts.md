# Contracts: Workout tracker v1

Every builder codes against this file. Don't change a name, type or signature here without
the coordinator's approval. If something seems wrong, implement it as written and report it.

## Runtime and layout

- **Server:** Google Apps Script (V8 runtime). All `src/*.js` files share one global scope in
  Apps Script, and clasp uploads them as `.gs`. Don't use `import`/`require` in `src/`.
- **Local tests:** Node 24, built-ins only (`node:test`, `node:assert`). No npm dependencies.
  `npm test` runs `node --test test/`.
- **Node interop:** a `src/` file whose functions are tested in Node ends with
  `if (typeof module !== 'undefined') module.exports = { ... };`. Apps Script ignores this.

| Path | Owner | Purpose |
|---|---|---|
| `docs/contracts.md`, `package.json`, `data/expanded-routine.csv` | coordinator | contracts, test runner, sheet snapshot (input) |
| `tools/export-routine.js`, `data/routine.json`, `src/Routine.js`, `test/routine.test.js` | **routine builder** (fw-o2k.3) | CSV → routine.json + bundled `src/Routine.js` |
| `src/Lib.js`, `src/Code.js`, `test/lib.test.js` | **backend builder** (fw-o2k.4) | pure logic + Apps Script server |
| `src/index.html`, `dev/`, `test/ui.test.js` | **UI builder** (fw-o2k.5) | mobile page + local preview |
| `src/appsscript.json`, `tools/release.js`, `test/server.test.js`, `*.example` | coordinator | deploy config, release, multi-user server test |

## 1. `routine.json`

Generated from `data/expanded-routine.csv`. The same routine is bundled into the server as
`src/Routine.js` (`var ROUTINE_ = …`); every user gets this routine, and it is not stored in
anyone's Drive.

```json
{
  "schemaVersion": 1,
  "source": { "tab": "Expanded Routine" },
  "days": [
    {
      "day": 1,
      "areas": "Chest, Triceps",
      "exercises": [
        {
          "id": "d1-warm-up-stationary-bike",
          "name": "Warm Up: Stationary Bike",
          "warmup": true,
          "sets": 1,
          "reps": null,
          "weightLb": null,
          "timeMin": 10,
          "rest": null,
          "notes": null
        },
        {
          "id": "d1-incline-dumbbell-press",
          "name": "Incline Dumbbell Press",
          "warmup": false,
          "sets": 3,
          "reps": 12,
          "weightLb": 40,
          "timeMin": null,
          "rest": "2 min",
          "notes": "Bench at about 30 degrees. Targets upper chest."
        }
      ]
    }
  ]
}
```

Rules:
- `days` are sorted by `day` ascending. `exercises` keep the sheet's row order.
- `id` = `d<day>-<slug(name)>`. The slug is lower-case, with runs of non-alphanumeric
  characters replaced by `-` and no leading or trailing `-`. Ids must be unique across the
  file; if a name repeats within a day, add `-2`, `-3`, and so on.
- `warmup` is true when the name starts with `Warm Up:` (case-insensitive).
- `sets`, `reps`, `weightLb` and `timeMin` are numbers (decimals allowed, e.g. `17.5`), or
  `null` when the cell is blank. `rest` and `notes` are trimmed strings, or `null` when blank.
  Keep `rest` text as written (e.g. `"60–90 sec"` with the en dash).
- The `Week 1`–`Week 6` columns are ignored in v1.
- Don't add an export timestamp: the output must be byte-identical when re-run on the same CSV.

## 2. Session (one workout, one file)

```json
{
  "schemaVersion": 1,
  "id": "0b9c6a8e-3f2d-4c1e-9a77-2f6f1d2c4b10",
  "day": 1,
  "startedAt": "2026-10-11T14:30:00.000Z",
  "completedAt": "2026-10-11T15:25:00.000Z",
  "entries": [
    {
      "exerciseId": "d1-incline-dumbbell-press",
      "name": "Incline Dumbbell Press",
      "sets": [
        { "reps": 12, "weightLb": 40, "timeMin": null, "done": true },
        { "reps": 10, "weightLb": 40, "timeMin": null, "done": true },
        { "reps": null, "weightLb": null, "timeMin": null, "done": false }
      ],
      "notes": "Felt heavy on set 2"
    }
  ],
  "notes": null
}
```

Rules:
- The client creates `id` (`crypto.randomUUID()`) and `startedAt` (ISO 8601 UTC) when the
  workout starts. `completedAt` is an ISO string when the user finishes, or `null` for a
  partial save.
- `day` is an integer that matches a `routine.days[].day`.
- `entries`: one per exercise the user touched, in routine order. `exerciseId` must exist
  in the routine for that day. `name` is copied from the routine, so history stays readable
  if the routine changes later.
- Each set's `reps`, `weightLb` and `timeMin` are numbers ≥ 0 or `null`. `done` is a boolean.
  Every entry has at least one set.
- `notes` (entry level and session level) are strings or `null`.
- The server adds `"savedAt"` (ISO string) when it writes the file. The client never sends
  `savedAt`; the server overwrites it if present.

**Validation** is `validateSession(session, routine)` in `src/Lib.js`. It returns an array of
human-readable error strings, empty when the session is valid. It checks every rule above,
and `exerciseId`/`day` against `routine` when `routine` is given.

## 3. Drive layout (per user)

The web app runs **as the person visiting it** (`executeAs: USER_ACCESSING`, access: anyone
with a Google account) with only the `drive.file` scope. Each user's history lives in their own
Drive, in a folder this app created; the app can't see any other file in their Drive.

```
<the visitor's> My Drive/
└── FatherWorkout Data/            created on first visit; id cached in User Property DATA_FOLDER_ID
    └── sessions/
        └── 2026-10-11T143000Z_d1_0b9c6a8e.json
```

- **Folder lookup:** use the **User** Property `DATA_FOLDER_ID` (per user, per script; never
  Script Properties, which are shared by every user) if it's set and the folder exists.
  Otherwise find a non-trashed folder named `FatherWorkout Data` in My Drive root (with
  `drive.file`, only app-created folders are visible) and cache its id. If there isn't one,
  create it and cache the id. Create `sessions/` the same way (by name, inside the data folder).
- **Session file name:** `sessionFileName(session)` returns
  `<startedAt with ':' removed from the time part, milliseconds dropped, ending in 'Z'>_d<day>_<first 8 chars of id>.json`.
  Example: `"2026-10-11T14:30:00.000Z"` → `2026-10-11T143000Z_d1_0b9c6a8e.json`. Colons are
  removed so the name is safe on every OS, and names sort by time.
- **Saving:** if a file with that name exists, overwrite its content (the same session saved
  again). Otherwise create it. One file per session means two devices never write the same file.

## 4. Server API (`src/Code.js`, called with `google.script.run`)

Every function returns plain JSON-serializable objects (no `Date` objects; use ISO strings)
and throws an `Error` with a readable message on failure. The client receives that through
`withFailureHandler`.

| Function | Returns |
|---|---|
| `doGet(e)` | `HtmlService.createHtmlOutputFromFile('index')`, `.setTitle('Father Workout')`, `.addMetaTag('viewport', 'width=device-width, initial-scale=1')` |
| `getAppData()` | `{ routine` (the bundled `ROUTINE_`)`, recent: SessionSummary[], lastByDay: { "1": Session\|null, "2": …, "3": …, "4": … } }`. `recent` is the 20 newest summaries, newest first. `lastByDay[d]` is the newest *completed* session for day `d` (full object), or `null` |
| `saveSession(session)` | Validates with `validateSession(session, routine)` and throws `Error('Invalid session: ' + errors.join('; '))` on failure. Writes the file. Returns `{ id, fileName, savedAt }` |
| `listSessions(limit)` | `SessionSummary[]`, newest first. `limit` defaults to 50 |
| `getSession(id)` | Full `Session` (including `savedAt`) for that id, or throws `Error('Session not found: ' + id)` |

`SessionSummary` = `{ id, day, startedAt, completedAt, exerciseCount, setsDone }`.
`exerciseCount` = number of entries; `setsDone` = number of sets with `done: true`.

### Pure functions in `src/Lib.js` (Node-tested; no Apps Script APIs)

```
slugify(name) -> string
validateSession(session, routine?) -> string[]
sessionFileName(session) -> string
summarizeSession(session) -> SessionSummary
latestCompletedByDay(sessions, days) -> { [day: string]: Session|null }   // days: number[]
sortSessionsNewestFirst(sessions) -> Session[]                          // by startedAt, new array
```

`tools/export-routine.js` (routine builder) must produce ids matching `slugify` exactly. To
keep the tools independent it implements its own copy of the slug rule in §1 rather than
importing `src/Lib.js`. `test/routine.test.js` checks the two agree on every name in the CSV.

## 5. UI behaviour (`src/index.html`)

One self-contained HTML file: inline CSS and JS, no external scripts, fonts or images
(Apps Script serves it inside a sandboxed iframe).

- **Load:** call `getAppData()` once and show a loading state, or an error with a Retry
  button if the call fails.
- **Day picker:** buttons for days 1–4, labelled `Day N · <areas>`. The default is the day
  after the newest completed session's day (4 wraps to 1), or day 1 if there's no history.
- **Workout view** for the chosen day, one card per exercise in routine order:
  - Name, a "warm-up" tag when `warmup`, the target line (e.g. `3 × 12 @ 45 lb · rest 2 min`,
    `10 min`, `3 × 20`), and `notes` when present.
  - "Last time" line from `lastByDay[day]`: that exercise's done sets, e.g. `12×40, 12×40, 10×40`,
    or `—` if there isn't one.
  - One row per target set (`sets` rows): numeric inputs for reps and weight (or minutes for
    `timeMin` exercises), plus a Done toggle. Prefill from last time's matching set if it
    exists, otherwise from the target. Fields left blank in the routine stay blank.
  - An "add set" control appends a row.
  - Optional per-exercise notes field.
- **Rest timer:** marking a set done starts a countdown banner from the exercise's `rest`
  (use the upper bound of a range: `"60–90 sec"` → 90 s, `"2 min"` → 120 s). It can be
  dismissed. No timer if `rest` is null.
- **Saving:** a sticky "Finish workout" button builds the Session (§2), including only
  exercises with at least one done set or a note, sets `completedAt`, and calls
  `saveSession`. On success, show a confirmation and switch to History. While a workout is in
  progress, mirror the draft to `localStorage` (key `fw-draft`, in try/catch) and offer to
  resume it on reload.
- **History view:** list `recent` (date, `Day N · areas`, `setsDone` sets). Tapping one calls
  `getSession(id)` and shows it read-only.
- **Layout:** mobile-first; must work at 360 px width with no horizontal scroll. Tap targets
  ≥ 44 px. Follows the system light/dark preference.
- **Local preview:** `dev/` contains a way to open the page in a normal browser with a mock
  `google.script.run` backed by `data/routine.json`. The mock must use the same names and
  return shapes as §4 and keep sessions in memory. `index.html` itself must contain no mock
  code paths beyond using `google.script.run`.
