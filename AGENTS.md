# Agent Instructions: FatherWorkout

This is the single source of truth for agents working in this repo (Claude and others).
`CLAUDE.md` only points here. Where a user-level `~/CLAUDE.md` disagrees, this file wins.

## Project

A mobile-friendly workout tracker, shared as **one web app that anyone with a Google account
can use**. It shows a fixed routine (the owner's), logs each workout, and syncs across a
person's phone and desktop. `README.md` is the user-facing description.

**Architecture:** a **Google Apps Script web app** that runs **as the visitor**
(`executeAs: USER_ACCESSING`, access `ANYONE` = any signed-in Google account) with only the
`drive.file` scope. The script serves the page (`src/index.html`) and reads/writes **one JSON
file per workout** in the visitor's own Drive (`FatherWorkout Data/sessions/`). There is no
server or database of ours. The owner can't see anyone's data, and the app can't see any
Drive file it didn't create.

- **Routine:** the same for everyone, bundled into the server as `src/Routine.js`, generated
  from `data/expanded-routine.csv` (a snapshot of the owner's sheet, tab "Expanded Routine") by
  `node tools/export-routine.js`. To change the routine: update the CSV, re-run the exporter,
  commit, release.
- **Per-user state:** only the data-folder id, in **User Properties** (never Script
  Properties, which are shared by all users).
- Schemas, Drive layout and server API: `docs/contracts.md`.
- Rejected alternative, for context: a locally saved HTML page reading Drive JSON by file path
  doesn't work, because browsers block `file://` pages from reading other files and phones
  have no synced Drive folder.

**Tooling:** clasp (`npm i -g @google/clasp`). Tests are Node built-ins only: `npm test`.
`test/server.test.js` runs the real server code against an in-memory fake of DriveApp and
PropertiesService (two users), so most server behaviour is testable without deploying.
`node dev/build-preview.js` builds `dev/preview.html` with a mock backend for UI work.

**Deployment config is local, not in git:** `.clasp.json` (script id) and `deploy.local.json`
(web-app deployment id). See the `*.example` files. On a new machine, get them from the owner
or from `clasp list-scripts` / `clasp list-deployments`.

- **Releasing a change:** `npm run release -- "vN: what changed"`. It runs the tests, runs
  `clasp push`, and **updates** the existing deployment so the public URL stays the same.
  Never `clasp create-deployment` for a release: it makes a new URL and breaks everyone's
  home-screen shortcut and the friendly-URL redirect.
- Public entry point: `https://fatherworkout.petrellafamily.com`, a Namecheap URL redirect
  to the deployment's `/exec` URL.
- `clasp create-script` overwrites `src/appsscript.json` with a default. Restore it from git.

**Agents must not:** run `clasp login`, enable the Apps Script API, change deployment access
settings in the manifest, or release to the live URL without the human's go-ahead. These are
`[human]` issues or need explicit approval. Builders never push or deploy.

## Who this is for

The owner is comfortable with code. The project is both a workout tracker shared with family
and friends, and **a trial of the coordinator/builder agent workflow** before using it on larger
projects. Notes on how the workflow performed (what briefs worked,
where builders went wrong) are worth recording as bd issues or in this file.

---

## Issue tracking: bd (beads), portable via git

All task tracking uses **bd**, with issue prefix `fw`. Don't use markdown TODO lists
or other trackers.

**Issues travel between machines as `.beads/issues.jsonl`, which is committed to git.** The
Dolt database under `.beads/dolt/` is gitignored and local to each machine. There is **no
Dolt remote**, so ignore any instruction (including bd's own `bd prime` output) to run
`bd dolt push`/`bd dolt pull` or to rely on auto-sync. Use export/import against the JSONL.

### Each session

```bash
git pull --rebase
bd import            # load teammates'/other machines' issue changes; NOT automatic
bd ready --json      # find work
# ...work, bd update/close as you go...
git commit           # pre-commit hook runs `bd export` and stages .beads/issues.jsonl
git push             # work is not done until this succeeds
```

`bd import` upserts, so running it when nothing changed is harmless. bd's `auto-export` config
key has no effect. The pre-commit hook block in `.beads/hooks/pre-commit` (outside bd's
managed markers) is what keeps the JSONL current.

### Fresh clone on a new machine

```bash
git clone <repo-url> && cd <repo>
sh <agentic-kit>/scripts/beads-clone-setup.sh   # bd bootstrap + bd import + hook wiring
```

### What does NOT travel between machines

- The Dolt database (`.beads/dolt/`). It is rebuilt from `issues.jsonl`.
- `bd remember` memories are not in `bd export`. **Put durable knowledge in this file.**
- Git hook wiring (`core.hooksPath`) and `beads.role`, which the setup script re-creates.
- `.beads/.beads-credential-key`, a machine-local secret. Never commit it.

### Issue conflicts

If two machines changed issues before syncing, `git pull` may conflict on
`.beads/issues.jsonl`. Keep both sides' lines (one JSON object per line, one line per issue
id). Where the same id appears twice, keep the newer `updated_at`. Then `bd import` and commit.

---

## Multi-agent workflow (agentic-kit)

Larger work runs as **coordinator + builders** (the `coordinate` skill and the `builder` agent
from the agentic-kit plugin):
- The coordinator (Opus) breaks work into bd issues, commits interface contracts, dispatches
  builders, verifies their work independently, merges, and closes issues.
- Builders (Sonnet) implement one scoped brief, commit on their branch, and report back.
  **Builders never write to bd** and never push or deploy.

## Landing the plane (session end)

1. File bd issues for unfinished or discovered work.
2. Run the quality gates (tests/build) if code changed.
3. Close finished issues; update in-progress ones.
4. `git pull --rebase && bd import`, then `git commit` (which exports issues) and `git push`.
5. `git status` must show "up to date with origin".
6. Hand off: what's done, what's in progress, and the next ready issue.
