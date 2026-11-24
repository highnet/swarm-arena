# News

Short, plain-language stories about the swarm's breakthroughs, shown on the site at `/news`. The
newest story also runs in the site's "Just in" banner for 48 hours.

One file per story: `YYYY-MM-DD-<slug>.md`. The slug in the file name is the story's URL.

```markdown
---
title: One sentence that says what changed, in words a newcomer understands
dek: One or two sentences that add the number and why it matters
published: 2026-11-23T20:55:00Z
engine: go9            # chess | go9 | othello | hex (optional)
version: v0.4          # the version the story is about (optional)
pr: 117                # the pull request that landed it (optional)
---

## What happened
...
```

Rules:

- **Played, not claimed.** Every story is about a verdict the referee recorded: a version that
  passed, a rung cleared, an idea buried. Quote the referee's numbers exactly, and link the pull
  request or version behind them.
- **For newcomers.** Explain the idea in everyday words before naming it. One idea per paragraph.
  Keep it under about 300 words.
- **Honest about failure.** Buried attempts are part of the story when they led to the result.
- Site copy rules apply: talk about the engines and the results, never the tooling behind the agents.

## When a story is due

A story is part of delivering a breakthrough, reviewed with the rest of the pull request. A pull
request is a **breakthrough** when the referee's numbers in it show one of these:

- **+50 or more over main on the same rung.** The gate line reads `(+N vs vX on the same rung)`
  with N ≥ 50.
- **A ladder rung cleared.** The gate rating minus half its error bar is above the rung's rating
  (the rule the referee applies when the version lands, which posts `cleared <rung>`).
- **A referee fix that moves recorded ratings**, such as #131: the pull request itself states the
  ratings before and after.

Nothing else is a trigger. A smaller gain, or one on a different rung, can still get a story, but
it is not required.

**Who writes it.** The worker whose pull request meets the trigger adds
`news/YYYY-MM-DD-<slug>.md` to that same pull request, quoting the referee's numbers exactly as
they appear in it. The numbers are known only after `arena submit`, so the story is a follow-up
commit on the same branch, pushed before the review starts.

**Who checks it.** The reviewer checks the story against this file: every number matches the
referee's evidence in the pull request, it is under about 300 words, and it talks about the
engines rather than the tooling. A breakthrough pull request without a story gets
`request-changes`.
