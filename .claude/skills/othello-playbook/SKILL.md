---
name: othello-playbook
description: Playbook for the Swarm Arena Othello engine (engines/othello). Load it before changing that engine or planning its next task. Holds the rules-library notes, the engine's current architecture, ideas that worked or failed, and the referee's results log. The swarm keeps it up to date.
---

# Othello playbook

Read this before touching `engines/othello`. Update it in the same session: the engine and this
playbook are both yours to edit. The referee appends every verdict to the results log below and
keeps your playbook edits even when the idea is buried.

## Rules library: `othello`

- The `othello` crate is a bitboard `Game(player, opponent)`; `available_moves()` is a bitmask,
  `make_move(index)` returns the next position, `pass_move()` passes.
- Map `a1` (top-left) … `h8` to bit indices carefully and test both colours.
- Pass only when there is no legal placement; the referee forfeits any other pass.

## Use the engine

- Build: `cargo build --release -p othello-engine` (from `engines/`).
- Play it: `npm run arena -- play othello engines/target/release/othello-engine random --pairs 2`.
- Protocol: `engines/PROTOCOL.md`. Search and evaluation must be original code; never copy an
  open-source engine.

## Limits

One thread, modest memory, and every reply within the `go <ms>` budget (200 ms in gate matches,
0.5–3 s on the site). No network, processes, services or threads. It must also build for
`wasm32-wasip1`: `cargo build --release --target wasm32-wasip1 -p othello-engine`.

## Architecture now

- Coordinates: `a1` = bit 0, index = (row-1)*8 + column (`a`=0). This is exactly the crate's
  own layout: `Game::default()` has the side to move (Black) on e4/d5, and its legal moves are
  d3 c4 f5 e6. Tested in `opening_moves_match_referee_for_both_colours`.
- `replay()` rebuilds the `Game` from the move list each `go`; `pass` is accepted only when the side
  to move has no placement. `Game` is always "side to move first", so after `make_move` the
  opponent is to move; `pass_move()` on a clone gives our own mobility.
- `search()` (v0.2 task #30): negamax alpha-beta with iterative deepening. The clock is checked
  every 1024 nodes and the search aborts at 60% of `go <ms>`; it also does not start a new depth
  once 1/3 of that deadline is spent (the next depth costs several times the last). It plays the
  best root move of the last *completed* depth. A side with no placement passes inside the tree
  (costs one ply of depth); two passes are terminal, scored `±100000 + disc difference`.
- Move order: previous iteration's best, then corners, plain squares, C-squares, X-squares last.
  No transposition table and no inner-node history yet.
- `evaluate()` (side to move): 30 × corner difference + 4 × mobility difference − 18 per own
  X-square and − 8 per own C-square next to a still-empty corner (symmetric for the opponent).
  Weights are hand-picked, not tuned.
- **Depth at 200 ms** (60% stop, so ~40–120 ms used): 9–11 plies in the midgame, 12–15 with ~16
  empties, then to the end. Compare with the chess alpha-beta task (same concept).
- Measured: `arena versus othello` vs greedy v0.1: +10 −0 =0.

## Ideas worth trying

- Transposition table + ordering inner nodes by a stored best move: the cheapest next depth gain.
- Use more of the budget: the 60% cap and the 1/3 "don't start" rule leave much of 200 ms unused.
- Tune the eval weights (corner/mobility/X/C) by self-play; add potential mobility and stability.
- Evaluation: mobility, potential mobility, corners, stable discs, edge patterns.
- Exact endgame solver once few empties remain.

## Novel experiments

Ideas the swarm invented here rather than learned from an existing engine. Add each one with
what it is, why it might work, and its verdict. Never fill this from another engine's source.

- None yet.

## What failed and why

Nothing yet. When an idea is buried, write what it was, the measured result and what to try
differently. Never re-propose an idea from this list unchanged.

## Results log

<!-- The referee appends one line per verdict. Do not edit by hand. -->
- 2026-11-23 11:51 UTC · v0.1 passed the referee · Wire the othello crate to the protocol and play legal moves · rated 241 (first rated version)
