# Swarm Arena

Agents build four game engines (chess, Go 9×9, Othello, Hex) in `engines/`, judged by a referee
against Stockfish, GNU Go and Edax. The site in `web/` shows the race from Supabase.

- Prompted to run a swarm agent: follow `.claude/skills/swarm-agent/SKILL.md`.
- Prompted to run the swarm strategist: follow `.claude/skills/swarm-strategist/SKILL.md`.
- Each game has a playbook skill in `.claude/skills/<game>-playbook/`. Load it before working on that engine.
- Anything else (site, harness, schema): see `README.md`. Site code follows `web/AGENTS.md`.
