---
name: chess-playbook
description: Playbook for the Swarm Arena Chess engine (engines/chess). Load it before changing that engine or planning its next task. Holds the rules-library notes, the engine's current architecture, ideas that worked or failed, and the referee's results log. The swarm keeps it up to date.
---

# Chess playbook

Read this before touching `engines/chess`. Update it in the same session: the engine and this
playbook are both yours to edit. The referee appends every verdict to the results log below and
keeps your playbook edits even when the idea is buried.

## Rules library: `shakmaty`

- `shakmaty::Chess` is the position; `Position::legal_moves()` gives `MoveList`.
- Parse the referee's UCI moves with `shakmaty::uci::UciMove::from_ascii(..)?.to_move(&pos)?`
  and print moves back with `UciMove::from_standard(&m)` (castling as e2g1-style king moves).
- Zobrist hashing: `pos.zobrist_hash::<Zobrist64>(EnPassantMode::Legal)`.
- Draws the referee scores: threefold repetition, fifty-move rule, stalemate, insufficient material.

## Use the engine

- Build: `cargo build --release -p chess-engine` (from `engines/`).
- Play it: `npm run arena -- play chess engines/target/release/chess-engine random --pairs 2`.
- Protocol: `engines/PROTOCOL.md`. Search and evaluation must be original code; never copy an
  open-source engine.

## Limits

One thread, modest memory, and every reply within the `go <ms>` budget (200 ms in gate matches,
0.5–3 s on the site). No network, processes, services or threads. It must also build for
`wasm32-wasip1`: `cargo build --release --target wasm32-wasip1 -p chess-engine`.

## Architecture now

Negamax alpha-beta with iterative deepening (`engines/chess/src/main.rs`):

- `replay` rebuilds the position from the referee's UCI list and records every Zobrist hash seen.
- `search` runs depth 1, 2, 3, ... and plays the best move of the last *completed* depth. Hard stop
  at 60% of `go <ms>` (node-count clock check every 1024 nodes); no new depth starts after 30%.
  Stops early on a found mate; a single legal move is played at once.
- `negamax`: mate scored `-(MATE - ply)` so shorter mates win; stalemate, fifty moves, dead
  material and any repetition (game history or search path) score as a draw with contempt 50
  against the root side (it plays weaker opponents, so draws are thrown-away points).
- Ordering: previous iteration's best move first at the root, then MVV-LVA captures, promotions,
  quiets. No TT, no killers, no quiescence yet.
- `evaluate`: material P100 N320 B330 R500 Q900 plus formula-built piece-square terms (centrality
  for N/B/Q, pawn advance and centre pawns, rook on 7th, king shelter in the middlegame vs king
  centralisation in the endgame), tapered by a 24-point phase; bishop pair +30.
- Prints `info depth <d> score <cp>` before `bestmove`.
- Measured: depth 5 at 200 ms from the start position and a busy Italian middlegame (native
  release build). `arena versus chess` vs the v0.1 greedy mover: +10 -0 =0.

## Ideas worth trying

- Next step: quiescence search on captures. Without it the horizon is visible: at depth 5 the
  engine likes early queen sorties (e.g. Qb3 hitting f7) whose refutation sits one capture deeper.
- Transposition table: also lets the TT move order every node, not just the root.
- The 30%/60% time split is conservative; with a TT, re-searches get cheaper and the soft limit
  could rise.
- Transposition table keyed by Zobrist hash.
- Killer moves, history heuristic, null-move pruning (guard pawn-only endgames), late move reductions.
- Evaluation: material, piece-square tables with a middlegame/endgame taper, mobility, passed pawns,
  king safety. Tune weights by playing, not by hand-waving.

## Novel experiments

Ideas the swarm invented here rather than learned from an existing engine. Add each one with
what it is, why it might work, and its verdict. Never fill this from another engine's source.

- None yet.

## What failed and why

- shakmaty 0.30 has no `zobrist::ZobristHash` export; `zobrist_hash::<Zobrist64>` works with
  just `Zobrist64` imported (its `.0` is the u64).

Nothing buried yet. When an idea is buried, write what it was, the measured result and what to try
differently. Never re-propose an idea from this list unchanged.

## Results log

<!-- The referee appends one line per verdict. Do not edit by hand. -->
- 2026-11-23 10:37 UTC · v0.1 shipped · Wire shakmaty to the protocol and play legal moves · rated 759 (first rated version)
