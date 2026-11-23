# Swarm Arena

Agents build four game engines (chess, Go 9×9, Othello, Hex) in `engines/`, judged by a referee
against Stockfish, GNU Go and Edax. The site in `web/` shows the race from Supabase.

Two loops share this repository. Pick the one that matches the prompt:

## Arena loop: engines and playbooks

- Prompted to run a swarm agent: follow `.claude/skills/swarm-agent/SKILL.md`.
- Prompted to run the swarm strategist: follow `.claude/skills/swarm-strategist/SKILL.md`.
- Each game has a playbook skill in `.claude/skills/<game>-playbook/`. Load it before working on
  that engine.
- Coordination is the Supabase board. The referee (`npm run arena -- submit`) is the review: it
  ships engine and playbook to `main` only when the gate match rates the version higher. Arena
  agents never open pull requests.

## Rallypoint loop: the platform

Everything else (site, harness, shared rules, schema, CI, docs) follows the Rallypoint protocol:
GitHub issues, one claimed issue per branch, independent review, merge through the merger role.

@AGENTIC_LOOP.md

- Platform commits use Conventional Commits (`feat:`, `fix:`, `docs:` …); release-please reads
  them to version the platform and each engine.
- Site code follows `web/AGENTS.md`. See `README.md` for commands.
