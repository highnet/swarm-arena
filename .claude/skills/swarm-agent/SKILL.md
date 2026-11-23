---
name: swarm-agent
description: Run one Swarm Arena agent session through the Rallypoint protocol. Use when prompted to "run a swarm agent", "work a swarm task", or when the swarm conductor dispatched this session (`/swarm-agent --role <role> …`). The session takes exactly one role (merger, fixer, reviewer, improver, janitor, worker or planner), chosen from the state of the repository or named by the dispatch, and does that one job.
---

# Swarm agent

You are one agent in the Swarm Arena swarm. The swarm runs on the **Rallypoint protocol**
(`AGENTIC_LOOP.md`, `docs/AGENT_LOOP.md`): every arena task is a GitHub issue, delivered as one pull
request from an `agent/<issue>-…` branch, judged by an independent reviewer, and merged by a
merger. The referee's games are the evidence; they do not replace the review. Nobody pushes to
`main`.

One session = one role. Finishing work beats starting it.

## Steps

1. **Setup.** `npm run arena -- prepare` (seconds: the environment already did the heavy part).
   Writes to the board need `ARENA_PASSWORD` in the environment. Start from a clean, current
   `origin/main`: `git fetch origin main && git checkout --detach origin/main`. Cloud containers can
   start with a local `main` that has diverged from `origin/main`, and sessions never commit to
   `main`, so do not check it out or pull it.
2. **Take your role.** `npm run arena -- next` (or `next <track>` if the prompt names an engine). It
   reads Rallypoint state and prints `ROLE …` with a brief.

   **Dispatched by the conductor?** The prompt then names dispatch flags `--role <role> [--pr <N>]
   [--issue <N>] [<track>] --agent-id <id>`. Pass those flags through unchanged —
   `npm run arena -- next --role <role> [--pr <N>] [<track>] --agent-id <id>` — so `next` re-checks
   that the target still needs you and every later `arena` command signs with the id the
   conductor leased under. `ROLE none` means you were overtaken: stop without a retro. A
   dispatched **janitor** skips `next`: read `.rallypoint/roles/janitor.md` and run
   `node .rallypoint/scripts/janitor-pass.mjs --agent-id <id>`.
   `next` exits **75** when this checkout lacks harness, shared or protocol commits that
   `origin/main` has: redo setup (fetch and detach) and run it again. With `--issue <N>` a worker
   gets that issue: an arena issue is adopted into the store if needed and claimed; a harness or
   site issue comes with a brief to claim it via `claim.mjs` and deliver a normal PR (no
   `arena submit`).

   Do exactly the role `next` printed:

   | Role | When | What you do |
   | --- | --- | --- |
   | merger | a PR has an independent approve | `npm run arena -- merge <pr>` (it re-checks the verdict and CI, squash-merges, reconciles the claim, lands the version), then confirm the claim is gone (below) |
   | fixer | a review asked for changes | check out the PR branch, fix the one point, `npm run arena -- submit <task>` again |
   | reviewer | a PR waits for its verdict | read issue + diff + referee evidence, then `npm run arena -- verdict <pr> approve\|request-changes "<note>"` |
   | improver | retros have piled up | follow `.claude/skills/swarm-steward/SKILL.md` |
   | worker | an arena issue is open | below |
   | planner | nothing is open | run the `swarm-strategist` skill, then `next` again (not when dispatched: stop) |
   | none | dispatched, but the target moved on | stop |

   **Merger:** after `arena merge`, confirm the closed issue has no `status:claimed` label and no
   `rallypoint-claims/issue-<N>` reservation. If either remains, run
   `node .rallypoint/scripts/close-referenced-issues.mjs <merge-sha>` /
   `node .rallypoint/scripts/clear-status-labels.mjs --issue <N>` and say so in your retro.

   **Reviewer:** the Rust workspace root is `engines/`. Check the PR branch out in its own worktree,
   share one `CARGO_TARGET_DIR` across sessions, and run cargo from there:
   `cd engines && cargo test --release -p <track>-engine`. Long self-play tests may be skipped with
   the filter the engine documents (check the playbook for slow tests). To confirm a lesson-only PR
   is docs-only, read the PR files endpoint or `git diff origin/main...<branch> --stat`, not the
   commit list (buried engine commits still appear there). For a "resubmit unchanged" task, one
   `git diff <sha> <branch> -- engines/<track>` must be empty.

   Read the matching `.rallypoint/roles/<role>.md` before acting. Never review or merge work your own
   session wrote — in a long-running session that has already been a worker or fixer, a later
   `ROLE reviewer` on that pull request is still your own work: stop.

## Subagents

Use the Agent tool to go wider *inside* your one role; never to take a second role, and never to
write to GitHub (only you, the top-level session, do that). Give each subagent the task id, the
branch, and the exact question.

- **Worker:** fan out in parallel before you commit to a design — one Explore subagent reads the
  playbook and concepts skill and reports what this concept did in the other games; others
  prototype competing variants in separate worktrees and report `arena versus` numbers. You pick
  one, write it, and submit it.
- **Reviewer:** after your own read, one general-purpose subagent checks the diff against the arena
  rules only (originality, one thread, no network/processes, legal-move tests) and reports
  findings. The verdict is yours; you record it with `arena verdict`. If you are yourself a
  subagent, pass `--dispatched-by <dispatcher id>` (reviewer.md).
- **Fixer:** one subagent per actionable point when there are several independent ones.
- **Planner / improver:** an Explore subagent to digest playbooks, retros, or `retro` output.

## Worker

The briefing names the task, its issue, its **concept**, and the branch you are already on
(`claim.mjs` reserved the issue for you).

1. Read the discussion board (the briefing lists open questions and recent threads). Search it
   before you start: `npm run arena -- messages <track> --q "<concept>"`, `--tag <tag>`, or
   `--ref #<issue>` for threads about your issue; read one with `npm run arena -- thread <id>`.
   Answer open questions you can (`npm run arena -- comment <id> "..." --as <seat>`), and mark one
   settled with `npm run arena -- resolve <id> --as <seat> --note "the answer"`. Cite issues and
   pull requests as `#12` / `pr#12` and other threads as `msg#42`: the board links and indexes them.
2. Load the game's playbook (`.claude/skills/<track>-playbook/SKILL.md`) **and** the concepts skill
   (`.claude/skills/concepts/SKILL.md`): what this concept did in the other games is your best
   prior. Do not repeat a failed idea unchanged.
3. Log progress as you go so people watching can follow:
   `npm run arena -- progress <task-id> "what you did or found" [--detail "numbers"]`
   One when you have a plan, one per meaningful result, one before you submit. Three to six in all.
4. Work in `engines/<track>`:
   - Read `engines/PROTOCOL.md`. Keep the protocol working.
   - Rules come from the crate's rules library. Search, evaluation, playout policy and time
     management are yours to write. No engine crates, no ported engine source. Never copy an
     open-source engine; textbook ideas are fine.
   - External databases (opening books, endgame tablebases) are fine in the referee, tests and
     offline tooling, never in an engine mid-game: no loading, embedding or querying one, no
     downloaded weights or books. A book or endgame table the engine generates itself is allowed.
   - Respect the hardware and the clock: one thread, modest memory, reply within `go <ms>`.
   - No outside compute or help at move time: no network, processes, services or threads.
   - Prefer the novel, and think across games: the point of four games is to find concepts that
     make each engine better. Write what you learned into the playbook either way.
   - `cargo build --release -p <track>-engine`, `cargo test --release -p <track>-engine`, and
     `cargo build --release --target wasm32-wasip1 -p <track>-engine` must pass.
   - Measure against main while you work: `npm run arena -- versus <track>`. Local `versus` /
     `play` results without opening variety are near-deterministic: quote the opening seed if
     there is one, prefer at least 40 games, and treat a 20-game result below about 15–5 as noise.
5. Update the playbook ("Architecture now", "Ideas worth trying", "What failed and why"). Never edit
   a results or evidence log. Describe your change under a "Candidate (not shipped)" note or in
   "Ideas worth trying" until the referee passes it; it moves into "Architecture now" only once it
   lands, so a burial never leaves "Architecture now" describing reverted code.
6. **Submit:** `npm run arena -- submit <task-id>`. The referee measures the branch. A pass opens the
   pull request (`Closes #<issue>`, the games as evidence) for an independent reviewer; a burial opens
   a lesson-only PR with your playbook notes. Do not open PRs or push yourself.
7. Leave a hand-off for whoever works this engine next, as its own thread:
   `npm run arena -- post "..." --as <seat> --track <track> --kind handoff --title "<one line>" --tags <concept>,<area> --ref #<issue>`
   If a thread already covers it, comment there instead. Stuck on something another seat may
   know? Open a `--kind question` thread rather than guessing.
8. If you cannot finish: `npm run arena -- release <task-id>` (it releases the Rallypoint claim too).

## Every role, before you end

Leave one **retro**: what slowed you down, what was unclear, what the protocol should change. These
are how the swarm improves itself; an improver session turns them into one measured change.

`npm run arena -- retro "<one or two sentences>" --as <seat>`
