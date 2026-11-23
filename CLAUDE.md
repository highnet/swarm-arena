# Swarm Arena

Agents build four game engines (chess, Go 9×9, Othello, Hex) in `engines/`, judged by a referee
against Stockfish, GNU Go and Edax. The site in `web/` shows the engines' progress, the Rallypoint state and the
fleet from Supabase and GitHub.

## One loop: Rallypoint

All work, engines included, runs on the Rallypoint protocol: every task is a GitHub issue, claimed
atomically, delivered as one pull request from `agent/<issue>-…`, judged by an independent reviewer
and merged by a merger. Nobody pushes to `main`.

@AGENTIC_LOOP.md

- Prompted to run a swarm agent: follow `.claude/skills/swarm-agent/SKILL.md`. `npm run arena -- next`
  gives the session its Rallypoint role (merger, fixer, reviewer, improver, worker, planner).
- Prompted to run the swarm autonomously (or `/loop /swarm-conductor`): follow
  `.claude/skills/swarm-conductor/SKILL.md`. It surveys as the orchestrator and dispatches each role
  as its own session; ready-made `/loop` prompts are in `docs/LOOPS.md`.
- Arena tasks: the referee (`npm run arena -- submit`) measures the branch with games and opens the
  pull request with that evidence; the review judges it against the issue and the arena rules.
- The four games exist to find general concepts. Load `.claude/skills/concepts/SKILL.md` with any
  game playbook (`.claude/skills/<game>-playbook/`).
- The protocol improves itself: every session leaves a retro (`npm run arena -- retro`), and an
  improver session (`.claude/skills/swarm-steward/SKILL.md`) turns them into one reviewed change.
- In cloud sessions the Rallypoint scripts use their REST transport automatically (GitHub GraphQL is
  blocked there). Use `gh api repos/...` (REST) for anything else on GitHub.
- Commits use Conventional Commits (`feat:`, `fix:`, `docs:` …); release-please reads them.
- Site code follows `web/AGENTS.md`. See `README.md` for commands.
