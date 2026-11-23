# Brief: Swarm Arena (working name)

## Core
A portfolio showcase. A single person and an agent swarm running on one Claude subscription
build **four game engines from zero** (Chess, Go 9x9, Othello, Hex). Real matches decide every
claim. The website shows that race in the style of pequalnp.com: a message board of structured
records, program tracks with rungs, a graveyard and strategy-seat updates.

## The real challenge
Proving the swarm is *real*. A recruiter or Reddit reader should believe within seconds that
these engines exist, that they got stronger, and that the agents coordinated it all. That's
why Elo from logged matches is the only judge.

## Picture (first 10 seconds)
**The race.** Four tracks side by side, one per game. Each shows Elo climbing toward its finish
line, with rungs that light up as reference engines are beaten, and a live board replaying the
latest game. Below them: the board feed (task claimed → patch landed → match verdict), the
graveyard of dead ideas, strategy-seat updates and counters (games played, agents working,
ideas ruled dead).

## References
- pequalnp.com: the format (race, frontier, graveyard, strategy seat, counters, "every line is
  a structured record").
- The r/artificial swarm post (message board as coordination medium). I couldn't open it from here.

## Must NOT be
- Fake or inflated results. Every Elo number links to real match logs; sample data is labeled.
- A generic AI-dashboard look (no purple gradients/glass/slop). Designed with Impeccable.
- A chat-transcript dump. The board shows structured records, not agent chatter.

## Success
- Homepage passes the 10-second test: the race is understood without reading.
- Any number on the site can be clicked down to the games that produced it.
- At least one engine climbs measurably on a real run.

## Stack / constraints (decided)
- **Frontend:** Next.js. **Backend:** Supabase (Postgres + Realtime), so the site updates live
  while the swarm runs.
- **Compute:** one Claude subscription → agents run as Claude Code sessions on the user's
  machine, not via paid API calls from the server.
- Lives in a new folder `swarm-arena/` in the `highnet/config` repo.
- Design via Impeccable (`npx impeccable install`, `/impeccable init`).

## Assumptions (confirm or correct)
1. **The board is the real coordination medium.** Agents claim tasks, post results and read the
   strategy seat through Supabase tables. The site renders the same rows.
2. Harness = a small Node/TS orchestrator that launches headless `claude -p` workers per track
   and a match runner (cutechess-cli for chess/UCI; a custom referee for Go GTP, Othello, Hex).
3. Elo ladders anchored to reference opponents: Stockfish skill levels (chess), GnuGo (Go 9x9),
   Edax levels (Othello), and a baseline MCTS ladder for Hex, plus random/greedy baselines in
   every game.
4. Engines written in Rust (fast and self-contained); one crate per game, no borrowed engine code.
5. Until the first real run, the site ships with seed data that is clearly marked **SAMPLE**.
6. Deploy to Vercel; one Supabase project.

## Suggested first step
Supabase schema (tracks, rungs, tasks, records, matches, agents) → Next.js race page reading it
→ harness writes into the same tables.
