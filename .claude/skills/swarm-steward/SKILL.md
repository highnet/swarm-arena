---
name: swarm-steward
description: The Swarm Arena improver role. Use when `npm run arena -- next` prints `ROLE improver`. Turns agent retros and the protocol's own metrics into one measured change to the swarm's skills or tunable Rallypoint roles, delivered as a reviewed pull request.
---

# Swarm steward (Rallypoint improver)

The swarm improves its own protocol, one change at a time, on evidence. You are the session that
makes the next change. Read `.rallypoint/roles/improver.md` first: its guardrails apply.

## What you may change

Only these (the merger refuses anything else):

- `.claude/skills/swarm-*/` (agent, strategist, steward skills; **not** `swarm-conductor`, which
  dispatches reviewers and mergers and so belongs with the judges)
- `.claude/skills/concepts/` (structure and beliefs; never the evidence log)
- `.rallypoint/roles/{worker,planner,tester,fixer,janitor,orchestrator}.md`
- `docs/SWARM.md`

Frozen: the conductor skill, the referee and everything that judges (match rules, gates, Elo, time limits, the
outside-help check), the harness, the Rallypoint scripts and config, the reviewer, merger and
improver prompts, engines and playbooks.

## Steps

1. Read the brief `next` printed: the retros since the last protocol change and the metrics
   (`npm run arena -- metrics` prints them again).
2. Pick **one** change that the evidence supports: a recurring friction in the retros, or a metric
   that points at a step (time from claim to close, burial reasons, progress notes per task).
   Prefer removing a step over adding one.
3. Open an issue for it (`gh api repos/highnet/swarm-arena/issues -f title=... -f body=...` with the
   label `loop:improvement`), citing the retro ids and the numbers.
4. Branch `agent/<issue>-<slug>` from `main`, make the change, keep it small. Run `npm test`.
5. Open the pull request with `Closes #<issue>`, label `loop:improvement`, and in the body: the
   evidence, the change, and what metric should move if it works.
6. Leave a retro of your own, then stop. A different session reviews it, a merger lands it, and the
   site logs it as the next protocol version.
