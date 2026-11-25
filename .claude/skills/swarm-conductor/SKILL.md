---
name: swarm-conductor
description: Run the Swarm Arena swarm autonomously. One tick of the Rallypoint orchestrator survey, then — under the operator's standing authority — lease each target and dispatch one separate session per role (merger, fixer, reviewer, janitor, improver, worker, planner). Use when prompted to "conduct the swarm", "run the swarm autonomously", or from `/loop /swarm-conductor`.
---

# Swarm conductor

You are the swarm's dispatcher. Each tick you do two jobs that the Rallypoint protocol keeps
apart, in this order, and never a third:

1. **Orchestrator** (`.rallypoint/roles/orchestrator.md`): survey once, read-only, and work out
   what each target needs.
2. **Operator, under standing authority**: the person who started this loop has confirmed every
   round in advance, so you take the operator's two actions yourself — **write the lease** for a
   target and **start the session** for it. That is the whole of your write access.

You never do role work. You do not claim, edit code, review, record a verdict, merge, plan, or
fix coordination state. A conductor that does the work itself is a session reviewing its own
dispatch, and the independence the protocol is built on is gone.

## Run parameters

The loop prompt (the builder on the site's Protocol page writes it) sets these; anything missing
takes its default.

| Line | Default | Effect |
| --- | --- | --- |
| `Concurrency: at most N` | 4 | `CONCURRENCY` in step 3 |
| `Engines: dispatch workers on …` | all four | workers only on those tracks; every other role as usual |
| `Budget: stop the loop after N dispatched sessions have ended` | unbounded | count every session you start; at N stop dispatching, let the running ones end, summarise, then `ScheduleWakeup` with `stop: true` |
| `Focus: …` | none | pass the line verbatim into every planner and improver prompt you dispatch |
| `Dispatched sessions run at high effort` | default | `effort: "high"` on `create_session` (the operator asked for it) |
| `… with a push notification` | off | send `PushNotification` when something new is escalated |

## Why each role is a separate session, not a subagent

`AGENTIC_LOOP.md`: only a top-level agent mutates GitHub, and nothing a session dispatched may
review its own work. Every role session therefore runs as its **own top-level session** with its
own Rallypoint id. Subagents (the Agent tool) are for work *inside* one role session — research,
ablations, a second read of a diff — never for the role itself. The conductor may use an Explore
subagent to read history it needs, and nothing more.

How to start a session, in order of preference:

- **Cloud (claude.ai/code):** `mcp__claude-code-remote__create_session` with
  `source_url: https://github.com/highnet/swarm-arena`, a `title` of `swarm · <role> · <target>`,
  tag `swarm:<tick>`, and the prompt below. Leave `environment_id` unset so it inherits this
  environment (and its `ARENA_PASSWORD`).
- **Local CLI:** one git worktree per session, then a background headless run:
  `git worktree add ../arena-<id> origin/main && cd ../arena-<id> && claude -p "<prompt>"`
  (Bash `run_in_background: true`). Remove the worktree once its session ends.
- **Neither available:** stop and say so. Do not fall back to running roles in this session.

## One tick

### 0. State

Keep the dispatch ledger at `.arena/conductor.json` (gitignored): one entry per session you
started — `{ id, role, target, session, lease, tick, at }`. If it is missing, start a new one; the
board is the truth, the ledger only tells you what *you* started.

Start from current `main`: if `git status --porcelain` is not empty, stop and report it (somebody's
work is in this checkout); otherwise `git fetch -q origin main && git checkout -q --detach origin/main`
(a cloud container's local `main` can have diverged from `origin/main`, and nothing here commits to it).

### 1. Survey once

```bash
node .rallypoint/scripts/report.mjs
node .rallypoint/scripts/improvement.mjs status
npm run arena -- status
npm run arena -- messages --unanswered --older 60
```

The last line is the board's backlog: questions and proposals open for over an hour with no reply,
and hand-offs no later session acknowledged. List them in the tick's report. Reply on one for the
operator only when the operator has answered it (quote them); otherwise the role it waits on
answers it (a planner for questions, the next worker on that engine for a hand-off).

Read them exactly as `orchestrator.md` says: the claimable pool, each open pull request's
`review.mjs check` code, the session leases (`<role>=covered|free|unknown`), the disagreement
counts, the improver status. Do not re-run anything to get a "consistent" read. Note the time.

### 2. Follow through on the last tick

For every ledger entry still open, look at its session (`get_session` → `status_bucket`; local:
the background task) **and** at the trigger it was sent for, per orchestrator.md "Follow through":

- trigger resolved → release its lease
  (`node .rallypoint/scripts/lease.mjs --release --role <r> --pr <n> --agent-id <id>`), archive the
  session if it is idle (`archive_session`), close the entry;
- session still `working` and the lease live → leave it alone;
- session `failed`, idle with the trigger unresolved, or gone → release the lease, close the
  entry, and let step 3 re-dispatch the target fresh. Read the session's last result first
  (`list_events` with `kinds: ["result"]`): if it says the target is impossible (a frozen path, an
  operator decision), that target is **escalated**, not re-dispatched;
- a session that claims it is "waiting in the background" is checked against the branch, not
  believed (orchestrator.md).

### 3. Decide this tick's dispatches

Work down this list; finishing work beats starting it. Every PR-bound line also needs the
report to say that role is `free` at the PR's head — `covered` means it is already running,
`unknown` means report it and skip.

| Role | Dispatch when | How many |
| --- | --- | --- |
| merger | `check` is `0`, `10` or `13` (the merger reads CI itself) | one per such PR |
| fixer | `check` `11`, or a request-changes at the head (`needsFixer`) | one per such PR |
| reviewer | an arena or `loop:improvement` PR with no verdict at its head, not in `wouldFailRecord` | one per such PR |
| janitor | `janitorCandidate` or another disagreement count is nonzero | at most one |
| improver | `improvement.mjs status` exits `0` or `2`, and open PRs are under `maxOpenPullRequests` | at most one |
| worker | claimable arena issues exist and open PRs are under `maxOpenPullRequests` | at most one per engine with nothing in progress or in review, never more than the claimable count |
| planner | an engine in the run has no claimable issue, no claim and no open pull request (other engines' workers running is no reason to wait) | at most one, naming every such engine |

Then apply the caps: at most **`CONCURRENCY` sessions running at once** (default 4, counting
ones still open in the ledger), mergers first and workers last when the cap bites. **Workers never
take the last slot**: at most `CONCURRENCY - 1` workers run at once (at least one), so a pull request
that a worker opens is reviewed and merged at once instead of waiting hours for a long referee gate
to free a slot. Anything cut is simply next tick's work.

Never dispatch for an issue or PR carrying `needs:human`, and never more than one session per
target. An issue filed by hand (outside `arena plan`) has no arena `tasks` row: dispatch its worker
with `--issue <N>` (`next --issue` adopts an arena issue, and briefs a harness or site issue as a
normal PR), or run `npm run arena -- adopt <N>` first. A worker for a specific issue always gets
`--issue <N>` in its dispatch flags.

### 4. Dispatch

For each dispatch, in order:

1. Make its id: `cd-<tick>-<role>-<target>` (e.g. `cd-0412-reviewer-pr17`, `cd-0412-worker-chess`),
   `[A-Za-z0-9._-]`, at most 64 characters. It is the session's Rallypoint id for its whole life.
2. Lease it, except workers (`claim.mjs` is their lock):

   ```bash
   node .rallypoint/scripts/lease.mjs --role <reviewer|fixer|merger> --pr <N> --agent-id <id>
   node .rallypoint/scripts/lease.mjs --role <janitor|planner> --agent-id <id>
   ```

   Exit `2`: somebody else is already on it — skip, it is the loop working. Exit `3`: unknown,
   report it and skip. Any other non-zero: report and skip.
3. Start the session with this prompt (fill the brackets; drop `--pr` for targetless roles and
   pass the engine as the track for a worker). It opens with words, not `/swarm-agent`:
   `create_session` refuses a prompt that opens with `/`.

   ```text
   First run: git fetch origin main && git checkout --detach origin/main (your local main may have
   diverged from origin/main; never commit to main).
   Run a swarm agent dispatched by the swarm conductor. Follow .claude/skills/swarm-agent/SKILL.md
   with these dispatch flags: --role <role> [--pr <N>] [<track>] --agent-id <id> (that is:
   npm run arena -- next --role <role> [--pr <N>] [<track>] --agent-id <id>).
   You were dispatched under the operator's standing authority. Do exactly this one role on this
   one target, then end. Work on the branch Rallypoint prescribes (agent/<issue>-…) or the PR's
   own branch — never a session default branch, never main. If `arena next` prints ROLE none,
   stop: you were overtaken, which is normal.
   ```

   A planner prompt names the engines it plans for (the ones that matched the planner line).

   An improver prompt adds: if the evidence does not yet support one specific change, propose
   nothing, leave a retro saying so, and end. A janitor prompt says `--role janitor` and runs
   `.rallypoint/roles/janitor.md` (`janitor-pass.mjs --agent-id <id>`) rather than `arena next`.
   Re-read `report.mjs` right before dispatching a janitor, and if you name findings in its prompt,
   call them hints to verify, not work owed: they are often stale by the time it boots.
4. Write the ledger entry.

### 5. Report and pace

End the tick with a short snapshot: the survey time, what you dispatched (role → target →
session link), what you released, and what is **escalated** — every `needs:human`, every
`unknown` source, every target a session reported impossible. Escalations go to the operator,
never into a retry. If the run asked for a push notification and `PushNotification` is
available, send one only when something new was escalated.

Handoffs are the swarm's bottleneck: a review ends in 2-3 minutes, and the merger must not wait
for a heartbeat. So end every tick that leaves a session running by starting the **board watcher**
in this session, in the background (Bash `run_in_background: true`, timeout 30 minutes, after
stopping any watcher still running from an earlier tick):

```bash
.claude/skills/swarm-conductor/watch-board.sh 30 1800
```

It polls open pull requests, open issues and `main` every 30 s and exits on the first change (a
verdict label, a merge, a new pull request or issue, a claim), and that exit's notification starts
the next tick at once. Role sessions need no tool of their own for it: the conductor watches the
board they write to. The heartbeat below stays as the fallback for a watcher lost to a container
restart. Arm exactly one heartbeat: delete any pending conductor `send_later` first, then arm the
next. **4 minutes** while a reviewer, merger, fixer,
janitor or planner is running; **15 minutes** while only workers are; **30 minutes** when the
board is idle. Under `/loop` without an interval, pace with `ScheduleWakeup` on the same clock
(240 s / 900 s / 1800 s), and
stop the loop (`stop: true`) only when the operator asked for a bounded run and it is done.

## Hard limits (every tick)

- The conductor's only writes: leases it holds, sessions it starts, its own ledger, and archiving
  or releasing what it started. Nothing on `main`, no labels, no GitHub comments, no verdicts, no
  merges. On the discussion board, only a reply that relays an answer the operator gave.
- One role, one target, one session. Never two sessions on one target.
- `unknown` is never free; `needs:human` is never dispatched around.
- Under `maxOpenPullRequests` or not, a jammed review queue gets reviewers and mergers, not workers.
- The operator stops the swarm by stopping the loop; any session you started finishes its one job.
