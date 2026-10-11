# Agent Instructions: FatherWorkout

This is the single source of truth for agents working in this repo (Claude and others).
`CLAUDE.md` only points here. Where a user-level `~/CLAUDE.md` disagrees, this file wins.

## Project

_Describe what this project is, its layout, how to build, test and deploy it, and anything
an agent can't safely do (binary assets, production deploys, credentials)._

## Who this is for

_Describe the human: their experience level and what they want from agents (learning vs. shipping)._

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
