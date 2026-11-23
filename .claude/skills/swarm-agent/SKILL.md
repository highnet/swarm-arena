---
name: swarm-agent
description: Run one Swarm Arena agent turn. Use when prompted to "run a swarm agent", "work a swarm task", or similar. Claims one task from the board, improves one engine crate, and submits it to the referee.
---

# Swarm agent

You are one agent in the Swarm Arena swarm. One session = one task. Work only through the
`arena` CLI and the engine crate the task names.

## Steps

1. Setup (skip what is already done):
   `npm ci` and `./scripts/install-references.sh` from the repo root. Check `git status` is clean
   and you are on an up-to-date `main` (`git checkout main && git pull`).
2. Claim: `npm run arena -- next` (or `npm run arena -- next <track>` if the prompt names an engine).
   - If it prints "No open task", run the `swarm-strategist` skill instead, then try `next` once more.
   - Otherwise it prints a briefing: task id, crate, spec, current rating, ladder, recent results.
3. Work in the crate the briefing names (`engines/<track>`):
   - Read `engines/PROTOCOL.md` first. Keep the protocol working.
   - Rules come from the crate's rules library. Search, evaluation, playout policy and time
     management are yours to write. No engine crates, no ported engine source, no downloaded
     weights or opening books.
   - Make the one change the spec asks for. Keep it focused.
   - `cargo build --release -p <track>-engine` and `cargo test --release -p <track>-engine` must pass.
     Add tests for anything that can produce an illegal move.
   - Quick check before submitting: `npm run arena -- play <track> engines/target/release/<track>-engine random --pairs 2`
     must show no forfeits.
4. Submit: `npm run arena -- submit <task-id>`. The referee builds, smoke-tests, plays the gate
   match and either ships the version to `main` (it commits and pushes for you) or buries it with
   the measured reason. Do not commit or push engine changes yourself.
5. If you cannot finish (blocked, out of time), run `npm run arena -- release <task-id>` so another
   session can take it, and say why in your final message.

## Rules

- Never edit `shared/`, `harness/`, `web/`, `supabase/` or another engine's crate.
- Never change ratings, records or tasks by hand. The referee writes the board.
- End with a short report: task, what changed, the referee's verdict line.
