# CLAUDE.md

**Read [AGENTS.md](./AGENTS.md).** It is the single source of truth for FatherWorkout. This file
exists only so Claude-specific tooling finds it.

## The things most likely to waste your time

1. **Issue sync is `bd export` / `bd import` against `.beads/issues.jsonl`**, not
   `bd dolt push`. There is no Dolt remote, and the database itself is gitignored. Run
   `bd import` after every `git pull`.
2. **As coordinator, you own bd.** Builder subagents never write to it.

## Note on the user-level CLAUDE.md

A personal `~/CLAUDE.md` may also load on some machines. Where the two disagree, this repo's
`AGENTS.md` wins: it travels with the code and reflects how this project is actually set up.
