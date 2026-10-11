# Agent Instructions: FatherWorkout

This is the single source of truth for agents working in this repo (Claude and others).
`CLAUDE.md` only points here. Where a user-level `~/CLAUDE.md` disagrees, this file wins.

## Project

A mobile-friendly workout tracker. It shows the user's current routine and logs progress from
one workout to the next, syncing across phone and desktop.

**Architecture (decided):** a **Google Apps Script web app** running under the user's Google
account. The script serves the HTML page and reads/writes **JSON files in a Google Drive
folder**. There is no separate server, Google Cloud project or OAuth client. The page can be
added to the phone's home screen. It needs a connection while logging (no offline mode in v1).

Rejected alternative, for context: a locally saved HTML page reading Drive JSON by file path.
Browsers block `file://` pages from reading other local files, and the mobile Drive apps don't
expose a synced folder, so it can't work on phones.

**Data:**
- Source routine: Google Sheet "Father Workout" (`1vfiCFaBWlTc-K-sxayqttrKzbzbo45z-y4GoTqgkQwk`),
  tab **"Expanded Routine"** (98 rows × 15 columns). It is exported once to `routine.json`.
- Workout history: **one JSON file per session** (not one growing file), so two devices
  can't overwrite each other's writes.
- Exact schemas live in `docs/contracts.md` (to be written; see the bd epic).

**Tooling:** Apps Script code lives in this repo and is pushed with **clasp**
(`npm i -g @google/clasp`). Pure logic is unit-tested locally with Node. Drive access and
the web page can only be tested after a deploy.

**Agents must not:** run `clasp login`, enable the Apps Script API, change deployment
access settings, or `clasp deploy` to the live web-app URL without the human's go-ahead.
These steps are `[human]` issues. `clasp push` to the dev head is fine for the coordinator.
Builders never push or deploy.

## Who this is for

The user is comfortable with code and is using this small project for two things: a working
workout tracker for personal use, and **a trial of the coordinator/builder agent workflow**
before using it on larger projects. Notes on how the workflow performed (what briefs worked,
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
