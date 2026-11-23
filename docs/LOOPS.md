# Running the swarm unattended

Paste one of these into a Claude Code session on this repository. `/loop` without an interval lets
the session pace itself; with one (`/loop 20m …`) it fires on a fixed clock. Stop any of them by
stopping the loop: a session already dispatched finishes its one job.

Before the first run: the environment needs what `README.md` → "The swarm" lists (setup script,
network, `SUPABASE_URL`, `ARENA_RUN`, `ARENA_PASSWORD`), and `npm run arena -- init` must have run
once for the run.

## 1. Conductor — the whole loop, end to end (recommended)

One session surveys the Rallypoint board every tick and starts a separate top-level session per
role and target: mergers, fixers, reviewers, a janitor, an improver, workers and a planner. Each
dispatched session does one job and ends. Needs the remote-session tools (a claude.ai/code cloud
session); locally it falls back to headless `claude -p` runs in worktrees.

```text
/loop /swarm-conductor I am the operator and confirm every round in advance for this run. CONCURRENCY=4. Dispatch only through separate sessions; escalate needs:human and unknown sources to me instead of working around them.
```

A bounded run (the conductor stops itself when the budget is spent):

```text
/loop /swarm-conductor Standing authority for at most 12 dispatched sessions, CONCURRENCY=3. Stop the loop once 12 have been started and all have ended, then summarise what merged, what was buried, and what is escalated.
```

One engine only:

```text
/loop /swarm-conductor Standing authority for this run, CONCURRENCY=3, workers on the go9 track only; every other role as usual.
```

## 2. Builder and judge — two loops, no remote sessions

When you cannot start sessions from a session, run two loops in two terminals (or two cloud
sessions). The builder writes; the judge reviews and merges. Neither ever judges its own work,
because a session only ever holds one side.

Builder:

```text
/loop 20m /swarm-agent Take your role with `npm run arena -- next --only worker,fixer,planner,improver` and do that one role to the end. ROLE none means nothing to build this tick: stop.
```

Judge:

```text
/loop 10m /swarm-agent Take your role with `npm run arena -- next --only merger,reviewer` and do that one role. Never review a pull request this session pushed to. ROLE none means the queue is clear: stop.
```

## 3. Maintenance loops (optional, alongside either setup)

Janitor, hourly:

```text
/loop 60m Act as the Rallypoint janitor: read .rallypoint/roles/janitor.md, acquire the janitor lease (`node .rallypoint/scripts/lease.mjs --role janitor --agent-id janitor-loop`; exit 2 means another is running: stop), run `node .rallypoint/scripts/janitor-pass.mjs --agent-id janitor-loop`, release the lease, and report only what changed.
```

Orchestrator report, read-only, for a human watching:

```text
/loop 30m Act as the Rallypoint orchestrator (.rallypoint/roles/orchestrator.md): survey once with report.mjs and improvement.mjs status, and print the dispatch table. Start nothing.
```

## How the pieces fit

| Piece | Where | Does |
| --- | --- | --- |
| Orchestrator | `.rallypoint/roles/orchestrator.md` | read-only survey, a dispatch table |
| Conductor | `.claude/skills/swarm-conductor/SKILL.md` | orchestrator + the operator's two writes: lease, start a session |
| Role session | `.claude/skills/swarm-agent/SKILL.md` | `arena next --role … --agent-id …`, one role, subagents inside it |
| Picker | `npm run arena -- next [--only …]` | chooses a role from the board when nobody dispatched one |

Subagents (the Agent tool) work *inside* one role session — parallel research, competing
prototypes, a second read of a diff. They never take a role of their own and never write to
GitHub: `AGENTIC_LOOP.md` keeps that to top-level sessions, which is what keeps reviews independent.
