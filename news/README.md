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
