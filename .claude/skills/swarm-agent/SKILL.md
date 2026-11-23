---
name: swarm-agent
description: Run one Swarm Arena agent turn. Use when prompted to "run a swarm agent", "work a swarm task", or similar. Claims one task from the board, improves one engine and its playbook, and submits them to the referee.
---

# Swarm agent

You are one agent in the Swarm Arena swarm. One session = one task. Each game has two things the
swarm owns and edits: its engine (`engines/<track>`) and its playbook skill
(`.claude/skills/<track>-playbook/SKILL.md`). Work only through the `arena` CLI, that engine and
that playbook.

## Steps

1. Setup (skip what is already done):
   `npm ci` and `./scripts/install-references.sh` from the repo root. Check `git status` is clean
   and you are on an up-to-date `main` (`git checkout main && git pull`).
2. Claim: `npm run arena -- next` (or `npm run arena -- next <track>` if the prompt names an engine).
   - If it prints "No open task", run the `swarm-strategist` skill instead, then try `next` once more.
   - Otherwise it prints a briefing: task id, crate, spec, current rating, ladder, recent results.
3. Load the game's playbook skill (`.claude/skills/<track>-playbook/SKILL.md`) and read it fully:
   architecture, ideas, what failed, results log. Do not repeat a failed idea unchanged.
4. Work in the crate the briefing names (`engines/<track>`):
   - Read `engines/PROTOCOL.md`. Keep the protocol working.
   - Rules come from the crate's rules library. Search, evaluation, playout policy and time
     management are yours to write. No engine crates, no ported engine source, no downloaded
     weights or opening books.
   - Never copy an open-source engine (Stockfish, GNU Go, Edax, Leela, KataGo, MoHex…): don't read
     their code to reproduce it, don't translate it, don't lift their tables or tuned constants.
     Textbook ideas are fine; implementations must come from you.
   - Respect the hardware and the clock: one thread, modest memory, and a reply within the `go <ms>`
     budget (the briefing states both). A stronger engine that misses its time limit forfeits.
   - No outside compute or help at move time: no network, no other processes or engines, no
     services, no threads. The referee rejects these and requires the `wasm32-wasip1` build.
   - Prefer the novel. When the spec leaves room, try something you have not seen in an engine:
     a new evaluation feature, an unusual search shape, a learned or self-tuned component built
     here. Write the idea and its outcome into the playbook so the swarm learns either way.
   - Make the one change the spec asks for. Keep it focused.
   - `cargo build --release -p <track>-engine` and `cargo test --release -p <track>-engine` must pass.
     Add tests for anything that can produce an illegal move.
   - Check the browser build too: `cargo build --release --target wasm32-wasip1 -p <track>-engine`.
   - Quick check before submitting: `npm run arena -- play <track> engines/target/release/<track>-engine random --pairs 2`
     must show no forfeits.
5. Update the playbook before submitting: correct "Architecture now", add what you learned to
   "Ideas worth trying" or "What failed and why". Keep it short and true. Never edit the results log.
6. Submit: `npm run arena -- submit <task-id>`. The referee builds, smoke-tests, plays the gate
   match and either ships engine and playbook to `main` (it commits and pushes for you) or buries
   the engine change with the measured reason, keeping your playbook notes. Do not commit or push
   yourself.
7. If you cannot finish (blocked, out of time), run `npm run arena -- release <task-id>` so another
   session can take it, and say why in your final message.

## Rules

- Never edit `shared/`, `harness/`, `web/`, `supabase/`, or another game's engine or playbook.
- Never change ratings, records or tasks by hand. The referee writes the board.
- End with a short report: task, what changed, the referee's verdict line.
