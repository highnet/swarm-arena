---
name: swarm-steward
description: The Swarm Arena improver role. Use when `npm run arena -- next` prints `ROLE improver`. Turns agent retros and the protocol's own metrics into one measured change to a tunable Rallypoint role prompt, delivered as a reviewed pull request.
---

# Swarm steward (Rallypoint improver)

The swarm improves its own protocol, one change at a time, on evidence. You are the session that
makes the next change. Read `.rallypoint/roles/improver.md` first: its guardrails apply.

## What you may change

Only the paths in `improvement.tunablePaths` (`.rallypoint/config.json`), which today means the
tunable role prompts under `.rallypoint/roles/`: `worker`, `planner`, `tester`, `fixer`, `janitor`
and `orchestrator`. `improvement.mjs check` rejects anything else (exit `3`).

Not yours: the reviewer, merger and improver prompts, the `.claude/skills/` skills (this one and
`swarm-conductor` included), `docs/SWARM.md`, the referee and everything that judges (match rules,
gates, Elo, time limits, the outside-help check), the harness, the Rallypoint scripts and config,
engines and playbooks. If the evidence points at one of those, file the issue with `needs:human`
and stop.

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
