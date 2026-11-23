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
work is in this checkout); otherwise `git checkout -q main && git pull -q --ff-only origin main`.

### 1. Survey once

```bash
node .rallypoint/scripts/report.mjs
node .rallypoint/scripts/improvement.mjs status
npm run arena -- status
```

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
| planner | no claimable arena issue, no worker running, and at least one engine has nothing open | at most one |

Then apply the caps: at most **`CONCURRENCY` sessions running at once** (default 4, counting
ones still open in the ledger), mergers first and workers last when the cap bites. Anything cut is
simply next tick's work.

Never dispatch for an issue or PR carrying `needs:human`, and never more than one session per
target.

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
   pass the engine as the track for a worker):

   ```text
   /swarm-agent --role <role> [--pr <N>] [<track>] --agent-id <id>
   You were dispatched by the swarm conductor under the operator's standing authority. Do exactly
   this one role on this one target, then end. Work on the branch Rallypoint prescribes
   (agent/<issue>-…) or the PR's own branch — never a session default branch, never main. If
   `arena next` prints ROLE none, stop: you were overtaken, which is normal.
   ```

   An improver or janitor prompt says `--role improver` / `--role janitor` instead; a janitor runs
   `.rallypoint/roles/janitor.md` (`janitor-pass.mjs --agent-id <id>`) rather than `arena next`.
4. Write the ledger entry.

### 5. Report and pace

End the tick with a short snapshot: the survey time, what you dispatched (role → target →
session link), what you released, and what is **escalated** — every `needs:human`, every
`unknown` source, every target a session reported impossible. Escalations go to the operator,
never into a retry. If `PushNotification` is available, send one only when something new was
escalated.

Under `/loop` without an interval, pace with `ScheduleWakeup`: **600 s** while any session you
started is running, **1800 s** when the board is idle (nothing dispatched, nothing running), and
stop the loop (`stop: true`) only when the operator asked for a bounded run and it is done.

## Hard limits (every tick)

- The conductor's only writes: leases it holds, sessions it starts, its own ledger, and archiving
  or releasing what it started. Nothing on `main`, no labels, no comments, no verdicts, no merges.
- One role, one target, one session. Never two sessions on one target.
- `unknown` is never free; `needs:human` is never dispatched around.
- Under `maxOpenPullRequests` or not, a jammed review queue gets reviewers and mergers, not workers.
- The operator stops the swarm by stopping the loop; any session you started finishes its one job.
