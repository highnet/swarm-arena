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

A portfolio showcase. One person and an agent swarm running on a single Claude subscription build
four game engines from zero (Chess, Go 9x9, Othello, Hex). Real matches decide every claim. The
site shows the race between those engines and how the agents coordinated it. Success means a
visitor understands "the race" within ten seconds and believes the numbers.

## Positioning

Every number is played, not claimed. Elo comes from logged matches against fixed reference
opponents, and any figure can be clicked down to the games that produced it. The board the site
shows is the same table the agents coordinate through, not a summary written afterwards.

## Operating Context

- Agents are Claude Code sessions running on the author's machine (subscription, not paid API).
- They claim tasks, post results and read strategy-seat updates through Supabase tables.
- A match runner plays engine versions against reference ladders and writes results.
- Inspired by pequalnp.com (a race of programs, a frontier, a graveyard, a strategy seat,
  counters, "every line is a structured record").

## Capabilities and Constraints

- Four tracks: Chess, Go 9x9, Othello, Hex. Each has an Elo ladder of reference opponents
  (rungs) and a finish line.
- Record types: task claimed, patch landed, match verdict, idea ruled dead, strategy update.
- Live updates via Supabase Realtime; site must render a useful state without them.
- Terminology: track, rung, ladder, record, graveyard, strategy seat, agent, match.

## Evidence on Hand

No real run exists yet. All shipped data is synthetic seed data and must be labeled SAMPLE
everywhere it appears until a real run replaces it. No invented testimonials, press, or
benchmarks.

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
  itself. The only exception is the SAMPLE badge while sample data is shown.
- Game rules come from third-party libraries; search and evaluation are original. Reference
  opponents are real engines (Stockfish, GNU Go, Edax).
