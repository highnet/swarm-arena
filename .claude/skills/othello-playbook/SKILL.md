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
- Move order: root uses the previous iteration's best; inner nodes use the transposition table's
  stored best move; then corners, plain squares, C-squares, X-squares last. No history heuristic.
- **Transposition table** (task #44): 2^20 slots × 16 bytes = 16 MB, allocated once in a
  `thread_local` and reused across `go` commands. Key = a mixed 64-bit hash of the
  (side to move, opponent) bitboard pair, stored in full as the verification key. No pass flag:
  a `Game` *is* that pair, and a pass swaps it, so the same pair always means the same position
  and mover. Entry: key, score, depth, bound (exact/lower/upper), best move, generation.
  Probe after the leaf/pass checks and cut on a deep-enough bound; store after the move loop
  (never after an aborted search). Replacement: **depth-preferred within a search, always replace
  an entry from an older search** (generation bumped per `go`). Terminal scores are not
  ply-relative (`±100000 + discs`), so stored scores need no distance adjustment.
- `evaluate()` (side to move): 30 × corner difference + 4 × mobility difference − 18 per own
  X-square and − 8 per own C-square next to a still-empty corner (symmetric for the opponent).
  Weights are hand-picked, not tuned.
- **Depth at 200 ms** (60% stop, so ~40–120 ms used), from the ignored `depth_report` test on 8
  seeded positions per band (same machine, before → after the TT):
  - ≤50 empties: 7–10 → 9–11; ≤40: 8–10 → 9–11; ≤30: 7–11 → 8–11; ≤20: 9–11 → 10–12.
  About one ply more. At fixed depth (3/4/6 over 12 positions) the TT search returns the same move
  and score as plain search with 45% fewer nodes (208 705 → 115 085).
- **TT in Othello vs chess** (for the chess TT task): Othello has no repetition or 50-move rule,
  so there are no graph-history problems and any stored exact score is reusable. Discs only get
  added, so transpositions come from move-order permutations inside a ply band (plus passes,
  which keep the disc count but shift ply). Branching is ~10, so the gain shows mostly as
  better ordering (stored best move first → earlier cutoffs) rather than as many direct cut-off
  hits. Chess has more transpositions and needs mate-distance and repetition care.
- Measured: `arena versus othello` vs greedy v0.1: +10 −0 =0 (v0.2). TT vs v0.2: +7 −3 =0.

## Ideas worth trying

- Use the TT at the root too (and an aspiration window around last depth's score).
- History heuristic or killer moves for nodes the TT has not seen; enhanced transposition cutoff.
- Two-slot buckets (one depth-preferred, one always-replace) if the 2^20 table fills on 3 s moves.
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
- 2026-11-23 13:35 UTC · v0.2 passed the referee · Alpha-beta with iterative deepening and X/C-square evaluation · rated 1459 (+1218)
- 2026-11-23 15:00 UTC · buried · Transposition table with stored best move ordering every inner node · Rated 1059 ± 135, not above 1459.
