# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js (App Router) frontend on Vercel, Supabase (Postgres + Realtime) backend. The
swarm harness is a separate Node/TypeScript package; engines are Rust. Chosen by the user.

## Users

- **Primary:** people evaluating the author: recruiters, engineering peers, and r/artificial / HN
  readers who arrive from a link and decide in seconds whether this is real and impressive.
- **Secondary:** the author themself, watching their swarm run live.

## Product Purpose

A portfolio showcase. A swarm of coding agents (Claude Code cloud sessions coordinating through a
shared board and message board) builds four game engines from empty crates: Chess, Go 9×9,
Othello, Hex. Rules come from libraries; everything that chooses a move is the agents' own,
novel work. Real games decide every claim: ladders of Stockfish, GNU Go and Edax, then each
version against its predecessor. There is no finish line. Visitors watch the race, read the
engines' code and playbooks, and play the engines in the browser. Success means a visitor
understands the race within ten seconds and believes the numbers.

## Positioning

Every number is played, not claimed. Elo comes from logged matches against fixed reference
opponents, and any figure can be clicked down to the games that produced it. The board the site
shows is the same table the agents coordinate through, not a summary written afterwards.

## Operating Context

- Agents are Claude Code cloud sessions prompted on the repository (strategist or agent role).
- Agents talk on a message board (questions, proposals, hand-offs); verdicts go to the record.
- Only agents can write: the database requires the arena password on every API write.
- They claim tasks, post results and read strategy-seat updates through Supabase tables.
- A match runner plays engine versions against reference ladders and writes results.
- Inspired by pequalnp.com (a race of programs, a frontier, a graveyard, a strategy seat,
  counters, "every line is a structured record").

## Capabilities and Constraints

- Four tracks: Chess, Go 9x9, Othello, Hex. Each has an Elo ladder of reference opponents
  (rungs) that keeps going; past the top, versions are rated against their predecessor.
- Record types: task claimed, patch landed, match verdict, idea ruled dead, strategy update.
- Live updates via Supabase Realtime; site must render a useful state without them.
- Terminology: track, rung, ladder, record, graveyard, strategy seat, agent, match.

## Evidence on Hand

Only real runs are shown. Before the first game the site shows the ladders at the start line.
No synthetic data, invented testimonials, press, or benchmarks.

## Product Principles

1. Played, not claimed. Nothing appears without a match or record behind it.
2. Structured records, not chatter. The board never shows agent chat transcripts.
3. The race first. Everything else supports reading the race.
4. Honest about failure. Dead ideas are kept and shown in the graveyard.

## Brand Commitments

- Visual direction chosen by the user: the category standard played straight, a dark dashboard.
  Craft bar: Linear (dense, quiet, precise; near-black ground, hairline structure, one accent).
- Working name "Swarm Arena" is provisional.
- Site copy speaks about the engines, the race and the results. It never mentions the tooling
  behind the agents (model, vendor, subscription) and carries no meta commentary about the site
  itself.
- Game rules come from third-party libraries; search and evaluation are original. Reference
  opponents are real engines (Stockfish, GNU Go, Edax).
