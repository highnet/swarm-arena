---
name: othello-playbook
description: Playbook for the Swarm Arena Othello engine (engines/othello). Load it before changing that engine or planning its next task. Holds the rules-library notes, the engine's current architecture, ideas that worked or failed, and the referee's results log. The swarm keeps it up to date.
---

# Othello playbook

Read this before touching `engines/othello`. Update it in the same session: the engine and this
playbook are both yours to edit. The referee appends every verdict to the results log below and
keeps your playbook edits even when the idea is buried.
Describe a candidate change under a "Candidate (not shipped)" note or in "Ideas worth trying"
until the referee passes it, and move it into "Architecture now" only once it lands: a burial must
not leave "Architecture now" describing reverted code.

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
  No transposition table and no inner-node history (a TT was tried and buried, task #44 below).
- `evaluate()` (side to move): 30 × corner difference + 4 × mobility difference − 18 per own
  X-square and − 8 per own C-square next to a still-empty corner (symmetric for the opponent).
  Weights are hand-picked, not tuned.
- v0.3 (task #67, shipped as #82) adds two symmetric terms to `evaluate()`:
  - **Potential mobility**: empty squares 8-adjacent to the opponent's discs minus those adjacent
    to ours (`empty & neighbours(other)`, a 3-shift bitboard dilation with column-a/h masks against
    wrap-around), weight 2 × empties / 60 so it fades as the board fills.
  - **Edge-anchored stable discs**: from each owned corner the contiguous run of own discs along
    both its edges, plus every disc of a completely filled edge (bitboard flood along rows 1/8 and
    columns a/h); flat 2 per disc. Interior stability is not counted.
  Tuning record (weights tried, depth/node cost) is under "What failed" → task #67 tuning.
- Measured: v0.2 vs greedy v0.1: +10 −0 =0. v0.3 vs v0.2 locally (`arena versus --pairs 20`):
  +35 −4 =1. **Referee (#82): v0.3 1265 ± 108 vs Edax level 4 (18–22); main v0.2 re-rated on the
  same rung at 1173 ± 115** (v0.2's stored 1459 was an Edax-1 sweep lower bound). Judge the next
  Othello candidate (the #44 transposition table first) against v0.3's Edax-4 1265, not 1459.

- **Exact endgame solver (task #94).** At `SOLVE_EMPTIES` = 14 empties or fewer, `best_move()`
  first runs the normal midgame search for 10% of `go <ms>` (the fallback move, also the root's
  first move), then `solve_root()` solves to the end until 80% of the budget. Its own negamax
  (`Solver::solve`) on the final disc difference, empties to the winner, no `evaluate()` calls;
  two passes end the game as in the midgame terminal. Fail-soft alpha-beta in [-64, 64] with PVS
  (null window after the first child, root included). Order: fastest-first (fewest opponent
  replies) with an odd-quadrant parity tiebreak; from 6 empties down parity only; the last empty
  is a special case (mover, else opponent, else nobody). Shares the 1024-node clock check. An
  unfinished solve still plays its best root move once the first root move is exact (any later
  replacement was proven better); otherwise the midgame move. No TT inside the solve. About 45 M
  nodes/s here.
- Solve-time table (`solve_report` ignored test, 8 seeded positions per empty count, release,
  wall clock, 2 s cap per position; "<=100" counts solves within half a go-200 budget):

  | empties | plain (no order) | fastest+parity | fastest+parity+PVS (shipped) |
  | --- | --- | --- | --- |
  | 12 | median 22 ms, max 162, 7/8 | 7.4 / 15.5, 8/8 | 6.8 / 19.1, 8/8, 0.34 M nodes |
  | 13 | 47 / 473, 6/8 | 16.0 / 24.9, 8/8 | 13.0 / 28.3, 8/8, 0.70 M |
  | 14 | 82 / 2000+, 5/8 | 37.1 / 77.7, 8/8 | 33.7 / 55.7, 8/8, 1.37 M |
  | 15 | - | 94 / 432, 5/8 | 64 / 368, 5/8, 5.0 M |
  | 16 | - | 256 / 333, 0/8 | 162 / 382, 1/8, 8.8 M |
  | 17 | - | 745 / 2000+, 0/8 | 646 / 2000+, 0/8 |
  | 18-20 | - | 2000+ (cap) | 2000+ (cap) |

  Fastest-first is the big win (5-15× fewer nodes than plain at 12-14); parity alone halves
  nodes, on top of fastest-first it adds ~10%; PVS another 15-30%. Each extra empty costs ~3×.
  N = 14 is the largest count with every position under 100 ms. Re-measured for #112 (shipped
  config, median / max ms): 14 empties 18.2 / 31.7, 15 empties 36.7 / 194.7 (7/8 <= 100), 16
  90.3 / 187.2 (5/8): about 2× faster hardware, yet one 15-empty position still overruns the
  ~140 ms solve window of a go-200 move, so N stays 14. The spec's "16-20 empties in
  200 ms" needs a TT and/or faster move generation than the crate's `make_move` per child.

## Candidate (not shipped): self-generated opening book (task #109)

Move into "Architecture now" only once the referee passes it.

- `src/book.rs`. `best_move()` probes the book first and plays the stored move instantly; a miss
  falls back to the normal search. The book is embedded with `include_bytes!` from
  `book/othello-book.bin` (19-byte records sorted by position: me u64, opp u64, move u8,
  score i16; binary search, no allocation). Every probe result is checked against
  `available_moves()`.
- **Keyed by canonical position**, not move sequence: the smallest (me, opp) pair over the
  board's 8 symmetries (rank flip = `swap_bytes`, file flip, a1-h8 transpose, and their
  compositions; tested against a square-by-square reference). Transpositions and mirrored
  openings share one entry; the stored move is mapped back through the same symmetry.
- **What it covers.** Two parts. (1) A tree built for #103's 4-ply random openings: all
  **382 canonical positions** at plies 4-5, *every* opponent reply after each book move (2237),
  then the **2 best replies by our own depth-6 search** up to ply 9 (`replies_followed`,
  `MAX_PLY`): 6971 entries. (2) Since #125 the gate plays 6-ply lines from the balanced suite
  (`shared/src/openings/othello.txt`), so the engine first moves at ply 6 (Black) or 7 (White),
  which part (1) mostly misses (it only holds ply-6/7 positions reached through its own book
  moves). So the book also stores **every canonical position at plies 6 and 7** as a leaf
  (`COVER_PLIES`: 1773 + 10649, no follow-ups): any 6-ply opening, not just the suite's 200,
  gets an instant first move. Nothing comes from Edax or an external book: replies are ranked
  and moves chosen by this engine's search only.
- **How it was built** (regenerate with `othello/book/generate.sh [shards]` from `engines/`):
  `fixed_depth()` = the engine's own iterative-deepening negamax and `evaluate()`, no clock.
  Tree depth 12 at plies 4-5 (`book_depth`), 11 below; cover-only positions 11 at ply 6, 10 at
  ply 7 (`cover_depth`); a `go 200` search reaches 8-9 there. `book frontier` prints each
  missing position with its depth, so the book is deterministic whatever the shard count. Cost
  on this machine (4 shards as separate processes; the crate may not use threads): depth 10
  0.35 s/position, 11 ~1.4 s alone (~2 s with 4 shards running), 12 ~4.6 s. Tree: 382 roots
  ~7 min, 2237 ~20 min, 4352 ~40 min; cover: 10185 new positions ~40 min. `book/entries.txt`
  is the readable source (me, opp hex, move index, score, depth); the script resumes from it.
  Size: 17156 entries (6971 tree + 10185 cover-only), 325 964 bytes embedded.
- **Rebuild after packing**: the book is `include_bytes!`, so a binary built before `pack` still
  plays the old book (one local match was wasted that way; `generate.sh` now rebuilds last).
- Hit rate: `othello-engine book stats [opening plies]` (default 6) reads `b|w move…` game lines
  and reports the engine's in-book plies per game and its first out-of-book ply. Local, suite
  openings, seed 109, 40 games each (not referee evidence): vs main +21 −17 =2, vs Edax 4
  +19 −19 =2; **1.2 in-book plies per game** (every game's first move, then the tree sometimes);
  first out-of-book ply 8-9 in 32 of 40 games, 10-11 in the rest. With the pre-cover book
  (6971 entries) the same games gave 0.4 per game and 16-22 vs Edax 4. Deeper coverage after
  ply 7 is the obvious next step but costs ~6x per extra ply (67 245 canonical positions at ply 8).

## Candidate (not shipped): transposition table in the midgame search (task #153)

Move into "Architecture now" only once the referee passes it. A rebuild of #44's idea on v0.5
(book + solver), with chess's shipped TT scheme (#63), not commit 361cce7 (gone with its branch).

- `Tt` in `main.rs`: 2^20 slots × 16 B = 16 MB (`key` u64, `score` i32, `mv` u8 with 64 = none,
  `depth` u8, `meta` = generation << 2 | bound). Key: two splitmix64 mixes of the (mover,
  opponent) pair, the second rotated, so a pass (swapped pair) is a different key and no pass
  flag is needed. No ply adjustment of scores (disc-count terminals, no repetitions).
- **Replacement** as chess: `new_search()` bumps a 6-bit generation every `go`; a slot from an
  older generation is always replaced; within one generation a shallower result never replaces
  a deeper one.
- **Use**: probe at every inner node with depth ≥ 1; cut on EXACT, LOWER ≥ beta, UPPER ≤ alpha
  when the stored depth ≥ the remaining depth; otherwise the stored move goes first in
  `ordered()` (which only accepts it if legal). The root stores its result every completed
  iteration, and the first iteration's root order starts with the stored move.
- **Lifetime**: a `thread_local` kept across `go` calls, allocated lazily on the first search
  and freed by `game` (so a new game starts empty). The endgame solver does not use it; the
  short midgame search before the solve does. The book generator (`fixed_depth`) searches
  without a table, so the book stays reproducible.
- Tests: `tt_search_matches_plain_search_at_fixed_depth` (32 seeded positions × depths 3-6:
  same root score as plain alpha-beta with a fresh table, the TT's move scores that value under
  plain search, fewer nodes overall), `tt_replacement_keeps_deeper_within_a_generation`,
  `tt_survives_go_calls_and_clears_on_game`.
- `depth_report` (8 seeded positions per band; depth is wall clock at a 120 ms deadline, so
  ±1 ply noise; nodes at fixed depth 7 are deterministic), plain → TT:

  | empties | go-200 depth | depth-7 nodes |
  | --- | --- | --- |
  | ≤50 | 7-9 → 9-10 | 742 069 → 196 503 (−74%) |
  | ≤40 | 7-8 → 8-9 | 1 248 925 → 434 223 (−65%) |
  | ≤30 | 7-10 → 9-11 | 748 329 → 193 281 (−74%) |
  | ≤20 | 8-10 → 10-12 | 354 435 → 106 151 (−70%) |

  #44 measured −45% at depths 3/4/6 on v0.2's eval; here the cut is larger at depth 7 (deeper
  trees transpose more). Nodes per second fall by about a third to a half (a probe and store per
  node, cache misses over 16 MB, and the report allocates a fresh table per position), so wall
  time at depth 7 falls ~35-55%, not 70%.
- Local `arena versus othello --pairs 30` vs main v0.5 (balanced suite openings, `go 200`):
  **+34 −23 =3 (seed 357568262)**, 59% (not referee evidence).
- Not tried: probing the table inside the exact solver (~10 empties up), the issue's optional
  part; measure it separately.

## Candidate (not shipped): spend the clock (task #275)

Move into "Architecture now" only once the referee passes it. The concept is chess #186/#208's
time management (merged as chess v0.10, +116 vs main), written for Othello's search.

- `Clock { start, hard, soft, predict, partial }` in `main.rs`; the budget counts from when the
  `go` arrived (`handle` takes the `Instant` before `replay`). `Clock::for_budget`: `hard` =
  `go` minus `budget_margin` (a tenth, 15-100 ms, never more than half: go 20 → 10 ms, 60 → 45,
  200 → 180, 3000 → 2900). Before: abort at 60%, start no depth after a third of that (20% of
  `go`), so a go-200 midgame search used a median 60-70 ms.
- **Start rule** (`next_fits`): start depth d+1 only if `elapsed + 0.4 × last × growth ≤ hard`,
  growth = last iteration's time / the one before (clamped 1.5-8; 3 until two iterations above
  300 µs were timed). **Partial iterations**: a stopped iteration's best still plays once its
  first root move (the previous best) finished, since any move that replaced it was proven better
  at the deeper depth. 0.4 is chess's share, not tuned here.
- **Endgame**: the 10% fallback midgame search now uses the same predicting clock (cut-off at 10%),
  and the exact solve runs to `hard` instead of 80% (go 200: 180 ms instead of 160).
  `SOLVE_EMPTIES` stays 14.
- The old rule survives as `Clock::fixed` behind `search_with` / `search_limited` (tests, reports);
  the book generator has no clock at all, so the book is unchanged.
- Tests: `replies_well_within_go_20_60_200_on_slow_positions` (wide midgames at 44/34/24 empties
  with ≥ 8-9 moves, and 16/15/14 empties around the solver; each `best_move` under its budget; an
  overrun is re-measured once on a fresh table, because a timing test at the budget can flake
  under the parallel test runner, as #210's go9 clock did, msg#484),
  `clock_spends_most_of_the_budget_in_the_midgame` (> 100 ms of go 200), `next_fits_predicts_from_the_measured_growth`,
  `a_cut_short_iteration_keeps_a_legal_move` (cut-offs of 0-3000 µs).
- `clock_report` (ignored test; `report_positions`, 8 per band, fresh table; wall clock, run
  beside a local match so noisy), old rule → clock, depth completed (mean) and ms median / max:

  | band | go 200 depth | go 200 ms | go 1000 depth | go 1000 ms |
  | --- | --- | --- | --- | --- |
  | ≤50 | 8-10 (9.4) → 9-11 (10.0) | 60/90 → 180/180 | 10-12 (11.0) → 10-12 (11.4) | 306/502 → 900/900 |
  | ≤40 | 8-9 (8.6) → 8-10 (8.9) | 67/120 → 180/180 | 9-11 (9.9) → 10-11 (10.5) | 600/600 → 722/900 |
  | ≤30 | 9-11 (9.6) → 9-12 (10.2) | 70/120 → 156/180 | 10-13 (11.2) → 11-13 (11.8) | 500/600 → 662/900 |
  | ≤20 | 10-12 (10.8) → 11-13 (11.8) | 64/82 → 143/180 | 12-14 (12.6) → 12-15 (13.1) | 288/600 → 900/900 |

  2.5× the time buys +0.3 to +1.0 completed ply (each ply costs ~3-5× here), plus a partial
  deeper iteration in most moves.
- Local `arena versus othello` vs main v0.6 (balanced suite, `go 200`; not referee evidence):
  **+48 −29 =3 over 80 games (seed 275001)**, 62%; an earlier 10-game check +7 −3 (seed
  652866370). Part of the 80 games ran beside the test suite and `clock_report` on 4 cores, which
  slows both sides alike.

## Candidate (not shipped): phase-bucketed self-play fit of the evaluation weights (task #295)

Move into "Architecture now" only once the referee passes it. Concept: learned evaluation. The
search, book bytes, TT, clock and solver are v0.7's; only `evaluate()`'s weights change.

- **Eval refactor**: `features(g)` returns v0.7's six terms, each "mine minus the opponent's"
  (corner, mobility, X-square and C-square next to an empty corner, potential mobility, edge
  stable discs); `weighted(f, w, empties)` applies one weight set (potential mobility still
  × empties / 60); `PHASES` holds the weights per empties bucket. `V07_WEIGHTS` = [30, 4, −18,
  −8, 2, 2] reproduces v0.7 exactly (`v07_weights_reproduce_the_old_evaluation`).
- **Positions** (`othello-engine tune gen`, `othello/tune/generate.sh`, seed 295, ~11 min on 4
  shards): 24 000 self-play games, opening i = suite line i mod 200, v0.7's search at fixed depth
  6 with the TT and v0.7's weights (`SELF_PLAY_V07`, so the set reproduces whatever `PHASES`
  holds), 10% uniformly random moves, in-book plies played but not recorded. 1 234 438 positions,
  934 649 distinct (repeats merged with their mean label). Deterministic whatever the shard
  count (checked: a re-run reproduces shard 0 byte for byte). Not checked in (≈ 50 MB).
- **Labels**: from 14 empties down every position is solved exactly (the solver also picks the
  move there, 10% random moves still apply), and its own exact result is its label (334 255
  positions). Earlier positions get the game's result under exact play from the first solved
  position (= the final result). Fitted on win/draw/loss (1 / ½ / 0), not the margin: the rating
  only counts results, and a least-squares fit on the disc margin (`tune fit --margin`) gave
  the same shape (ratios within ~20%).
- **Fit** (`tune fit <bounds> <files>`): logistic regression without an intercept (the score
  must stay antisymmetric) by Newton's method, ridge 1e-4, 100 = one logit; ~1 s for all
  positions. Per bucket, fitted vs v0.7 (v0.7's weights at their best-fit scale), log-loss:

  | empties | n | corner | mobility | X | C | potmob | stable | loss | v0.7 loss |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | 60-50 | 2 904 | 55 | 2 | −123 | −39 | 2 | 86 | 0.672 | 0.683 |
  | 49-45 | 28 760 | 85 | 2 | −111 | −31 | 4 | 47 | 0.661 | 0.672 |
  | 44-40 | 59 511 | 96 | 4 | −95 | −10 | 5 | 24 | 0.642 | 0.651 |
  | 39-35 | 82 445 | 100 | 7 | −89 | −7 | 6 | 16 | 0.611 | 0.618 |
  | 34-30 | 97 201 | 83 | 9 | −80 | −7 | 7 | 17 | 0.573 | 0.579 |
  | 29-25 | 106 557 | 78 | 11 | −73 | −9 | 10 | 15 | 0.522 | 0.527 |
  | 24-20 | 112 198 | 70 | 16 | −68 | −16 | 10 | 15 | 0.458 | 0.465 |
  | 19-15 | 115 559 | 63 | 30 | −57 | −27 | −2 | 17 | 0.375 | 0.395 |
  | 14-10 | 117 503 | 47 | 55 | −47 | −39 | −46 | 21 | 0.282 | 0.340 |
  | 9-5 | 118 472 | 14 | 68 | −20 | −31 | −104 | 21 | 0.262 | 0.342 |
  | 4-0 | 93 539 | −16 | 89 | 28 | −14 | −170 | 24 | 0.255 | 0.353 |

  v0.7's shape is close to the fit from 45 to 20 empties: the fit gains almost nothing there.
  It differs in the late game, where mobility takes over from corners (corner/mobility 47:55 at
  14-10 empties against v0.7's fixed 30:4) and potential mobility turns negative. The 14-0 rows
  matter even though the solver takes over at 14: they score the leaves of every search from
  15-28 empties.
- **Variants, local `arena versus othello --pairs 40` vs main v0.7 (go 200, balanced suite; not
  referee evidence)**:
  - one bucket for all phases (the control; [32, 21, −63, −25, −3, 18]): **+41 −36 =3 (seed 295001)**;
  - the spec's 4 buckets 60-45 / 44-30 / 29-15 / 14-0 ([84, 2, −112, −32, 3, 48], [92, 8, −87,
    −7, 6, 16], [67, 20, −65, −21, 3, 15], [7, 60, −26, −33, −68, 23]): **+42 −36 =2 (seed
    295001), +42 −35 =3 (seed 295002)**, 54%;
  - **11 buckets of 5 empties (the table above, submitted): +47 −29 =4 (seed 295001), +50 −26 =4
    (seed 295002), +56 −22 =2 (seed 295003)**: 153−77−10 over 240 games, 66%, about +115 Elo.
  So the fit alone (one bucket) is flat and the 4-bucket split is small: the gain is in the
  phase resolution, mostly late, where the weights change fastest. Step buckets, no
  interpolation (the leaves of one search all sit at about the same empties).
- **Cost**: same features, so the same nodes per second; `clock_report` at go 200: median
  137-180 ms used, depth means 9.9 / 9.1 / 10.1 / 11.1 in the ≤50/40/30/20 bands. One wide
  44-empties position now stops after depth 9 at ~85 ms (depth 10 predicted not to fit), so
  `clock_spends_most_of_the_budget_in_the_midgame` checks the median of six midgame positions.
- **Book**: `book/othello-book.bin` is unchanged (searched with v0.7's eval; its stored moves
  stay valid and the book tests pass). A rebuild with the fitted eval costs ~2 h on 4 cores and
  touches only the first 1-2 plies after the opening; worth a follow-up only after this lands,
  measured head-to-head.
- Next levers: finer still (one bucket per 2-3 empties, or weights linear in empties fitted
  jointly); a second round of self-play with the fitted weights; new features (edge patterns,
  parity) in their own task, fitted the same way.

## Buried twice: #160's solver table resubmitted unchanged on the sequential gate (task #209)

**Referee (#195 sequential head-to-head vs main v0.6, go 200, balanced suite): first run
inconclusive at the 200-game cap, 91–98–11 (48.3%, −12 Elo, LLR −1.62 in [−2.89, 2.25], seed
9956026); resubmitted once with fresh openings and buried, 78–93–15 over 186 games (46.0%,
−28 Elo, LLR −3.01, seed 265856593).** Together 169–191–26 over 386 games (47.2%). Not in the
engine. The submitted `engines/othello/src` was commit 7024682 byte for byte (`SolveTt`
2^18 × 16 B, `SOLVE_EMPTIES` 15, `SOLVE_TT_MIN` 6; design and measurements in the #160 note
below; the build is on branch `agent/209-resubmit-160-unchanged-on-the-sequential-g`, commit
81abcec, and may vanish with it). Only `src/` was restored: main's release-please bump
(`CHANGELOG.md`, `Cargo.toml` 0.3.0) postdates 7024682, so `git checkout 7024682 --
engines/othello` would have reverted it.

What it says: the old gate's burial (1413 vs 1427) was not a noise artefact; at go 200 this
build is neutral to slightly worse than v0.6. A plausible cost: `SOLVE_EMPTIES` 15 starts the
exact solve one empty earlier, where one 15-empty position in 48 still overruns the ~140 ms
solve window, and the 10% midgame fallback search is then all the move gets. **Do not resubmit
it unchanged.** If revisited, separate the two changes: the table at `SOLVE_EMPTIES` 14 (pure
speedup, expect neutral), or the table as the base of a win/loss/draw solve or of N scaled with
the site's 0.5–3 s budgets, measured at those budgets rather than at go 200.

## Buried: history heuristic + PVS in the midgame search (task #190, lesson PR #194)

**Referee: rated 1295 ± 138 vs Edax level 6 (40 games, seed 102195233), not above v0.6's 1427**;
local matches were flat too. Not in the engine. Code: commit 81450ae on branch
`agent/190-pvs-and-history-heuristic-move-ordering-in` (may vanish with the branch; the design
below is enough to rebuild it). Port of chess v0.5's ordering pair
(minus LMR and killers) to v0.6's TT midgame negamax; the exact solver is unchanged.

- `Opts { history, pvs }` on `Search`; `Opts::PLAIN` is v0.6 (tests, reports, the book generator
  `fixed_depth`, so the book stays reproducible), `Opts::ENGINE` (both on) is what `go` plays.
- **History**: `[[u64; 64]; 2]` indexed by side relative to the root (0 = the root's mover; a
  pass flips it) and square; a beta cutoff adds depth². A `thread_local` kept across `go` calls,
  halved at the start of every root search (`search_opts`), zeroed by `game`.
  `ordered_by_history`: TT/previous-best move, corners (index order), then every other move by
  history, highest first, with v0.6's class order (plain, C, X) as the stable-sort tiebreak.
  The root uses it too. No killers (no capture/quiet split; not measured).
- **PVS**: full window on the first child, null window (−α−1, −α) on the rest, full re-search on
  a fail-high inside (α, β); at the root too (re-search on v > α). No LMR.
- Clock rules (60% cap, 1/3 "don't start") unchanged.
- Tests: `history_and_pvs_match_plain_search_at_fixed_depth` (32 seeded positions × depths 3-6
  × {history, pvs, both} × {no TT, fresh TT}, one history table carried across: root score equals
  plain alpha-beta's and the chosen move scores it), `history_order_puts_the_stored_move_and_corners_first`,
  `history_is_aged_each_search_and_cleared_on_game`.
- `ordering_report` (ignored test; fresh TT per position, history carried across a band's 8
  positions; nodes deterministic, depth is wall clock at 120 ms). Nodes to depth 9, v0.6 →
  history / pvs / both:

  | empties | v0.6 | history | pvs | both | go-200 depth v0.6 → both |
  | --- | --- | --- | --- | --- | --- |
  | ≤50 | 1 599 955 | 1 583 520 (−1%) | 1 415 093 (−12%) | 1 388 422 (−13%) | 8-10 → 9-10 |
  | ≤40 | 5 118 986 | 4 066 953 (−21%) | 4 352 274 (−15%) | 3 470 306 (−32%) | 8-10 → 8-10 |
  | ≤30 | 1 818 560 | 1 651 672 (−9%) | 1 690 270 (−7%) | 1 597 730 (−12%) | 9-11 → 9-11 |
  | ≤20 | 655 663 | 590 641 (−10%) | 617 143 (−6%) | 547 351 (−17%) | 10-13 → 10-13 |

  Depth 7: both −25% / −24% / −11% / −14%. History alone plays v0.6's move at depth 9 on 32/32
  positions (depth 7: 28/32, ties). Each extra ply costs ~3-5× here, so −10-30% nodes is a
  fraction of a ply: depth at go 200 is unchanged within its ±1 noise.
- Local `arena versus othello --pairs 40` vs main v0.6 (balanced suite, go 200; not referee
  evidence): **both +37 −38 =5 (seed 190001), +36 −40 =4 (seed 190002)**; history alone
  +33 −44 =3 (seed 190001); PVS alone +40 −35 =5 (seed 190001). Flat.
- Why it is weak here (and was +28 in chess): v0.6's TT move plus the static class order
  (corners first, X/C last) already orders Othello well, and with branching ~10 and no
  capture/quiet split there is little left for history to find; the cutoffs PVS saves are
  mostly at nodes the TT already orders. Chess gained from PVS + LMR together; LMR (the depth
  win) is the part not ported, and in Othello it risks missing a corner tempo. If revisited,
  measure LMR on late non-corner moves as its own variant, or spend the budget better (the
  60% / one-third rules leave much of go 200 unused).

## Buried: transposition table inside the exact solver (task #160, lesson PR #188)

**Referee: 12–27–1 vs Edax level 6, rated 1413 ± 116, not above v0.6's 1427** (inside the
error bar; local matches below were flat too). Not in the engine. Code: commit 7024682 on branch
`agent/160-transposition-table-inside-the-exact-endga` (may vanish with the branch; the design
below is enough to rebuild it). The table is correct and fast; it did not buy strength at go 200.
What to try differently: keep it as the base for a win/loss/draw solve from 16-18 empties, or
for N scaled with the site's 0.5-3 s budgets, and measure those instead of N = 15 at go 200.

- `SolveTt` in `main.rs`, **separate from the midgame `Tt`** so a final margin is never read as a
  heuristic score or the reverse: 2^18 slots × 16 B = 4 MB (`key` u64 from the same `tt_key`,
  `lo`/`hi` i8 = proven bounds on the exact final disc margin, `mv` u8 best move or 64,
  `empties` u8). Buckets of two: a preferred slot (most empties = largest subtree) and an
  always-replace slot; an entry with more empties than the current root is unreachable and
  yields. No generations: bounds on a final margin never go stale, so the table lives for the
  whole game (`thread_local`, cleared by `game`) and each move's solve reuses the last one's.
- **Use** in `Solver::solve` at nodes with ≥ `SOLVE_TT_MIN` = 6 empties: return at once on
  `lo >= beta`, `hi <= alpha` or `lo == hi` (any depth: the values are exact); otherwise the
  stored move goes first. The window is *not* narrowed by the stored bounds (keeps fail-soft
  results valid bounds on the caller's window). Store after the child loop, only if not stopped:
  `best <= alpha0` → (−64, best), `best >= beta` → (best, 64), else exact; bounds intersect with
  any already held for the key. The root (`solve_root`) does not probe/store itself.
- **Threshold sweep** (`solve_report`, 8 positions, nodes at 14 / 15 / 16 / 17 empties): MIN 14
  1.37 M / 4.96 M / 8.74 M / 36.0 M (= no table); 12: 1.37 / 4.65 / 7.95 / 31.4; 10: 1.28 /
  4.11 / 6.77 / 27.0; 8: 1.11 / 3.53 / 5.83 / 22.7; 7: 1.04 / 3.29 / 5.43 / 20.7; **6: 0.96 /
  3.04 / 5.07 / 19.2**; 5: 0.90 / 2.87 / 4.81 / 18.2; 4: 0.84 / 2.72 / 4.57 / 17.2. Lower is
  better in nodes all the way down; wall time is flat between 4 and 6, so 6 (= `SHALLOW`, where
  fastest-first ordering stops). The spec's "from about 10 up" guess left half the gain unused.
- Solve-time table, 48 seeded positions per count (`count` in `solve_report`, median / max ms,
  within 100 / within 140 ms = the go-200 solve window, nodes), no table → table:

  | empties | no table (v0.6) | with table |
  | --- | --- | --- |
  | 14 | 19.4 / 99.2, 48/48, 48/48, 11.4 M | 11.7 / 56.2, 48/48, 48/48, 7.2 M (−37%) |
  | 15 | 52.5 / 478.3, 42/48, 44/48, 36.0 M | 36.4 / 256.7, 43/48, 47/48, 21.4 M (−41%) |
  | 16 | 93.5 / 1159.8, 25/48, 29/48, 80.2 M | 61.7 / 473.9, 32/48, 41/48, 43.7 M (−45%) |

  So 15 empties now fits (47/48 inside 140 ms; the one overrun still plays its partial root
  result or the midgame move) and 16 does not (41/48): **`SOLVE_EMPTIES` raised 14 → 15**.
  The report's table is fresh per position; in a game it also carries the previous move's work.
- Local `arena versus othello` vs main v0.6 (balanced suite, `go 200`; not referee evidence):
  table at N = 14: **+27 −30 =3 (seed 160014)**; N = 15: **+38 −38 =4 (seed 160015)**; N = 16:
  +38 −40 =2 (seed 160015). Flat. At N = 14 both sides solve the same positions exactly, so the
  speedup only frees unused time. At 15-16 empties v0.6's midgame search already reaches depth
  10-12 in its 120 ms, close to the end of the game with a disc-count terminal, so one more
  exact ply rarely changes the move. **Expect this to be neutral on the gate**; its value is
  the headroom (a win/loss/draw solve, or N scaled with the site's 0.5-3 s budgets).
- First submit was buried unmeasured by the referee's static rule: `std::env::var` anywhere in
  `src/` (here only knobs for the ignored `solve_report` test) counts as an engine reading its
  environment. Knobs are now plain locals in the test; the engine is otherwise unchanged.
- Tests: `solver_table_gives_the_same_results_as_no_table` (8-14 empties, ~60 seeds each, one
  table shared across all positions as across a game's moves: same root score, the chosen move
  scores it, and fail-low / fail-high / exact agree with the plain solver on four windows).

## Ideas worth trying

- The #44 transposition table is rebuilt on v0.5 as task #153 (Candidate note above).
- History heuristic + PVS was task #190 (buried flat, note above); killers and LMR
  untried; aspiration windows at the root.
- Use more of the budget: task #275 (Candidate note above).
- Tune the eval weights (corner/mobility/X/C) by self-play: task #295 (Candidate note above).
  Local matches need opening variety
  (a few random plies or an opening list) before small weight differences can be read: without
  one, repeats of the same setting differed by ±10 games out of 40. `arena versus` has seeded
  openings since #104 (quote its seed); `arena play` still has none.
- Evaluation: edge patterns (an edge-configuration table), interior stability, parity.
- Endgame solver follow-ups (#94's plain solver at N = 14, resubmitted in #112): the TT inside
  the solve was task #160 (buried flat, and again on the sequential gate as #209, notes above; it cuts nodes from 6 empties up, not 10); scale N with the budget (each
  empty ~3×: N 15 at ~0.6 s, 16 at ~1.8 s, the site's 0.5-3 s); a win/loss/draw null-window
  solve (-1, 1) one or two empties beyond N, since only the result counts for the rating;
  start the solve one or two empties early and keep its partial root result; cheaper child
  generation (one `available_moves` per child is most of the cost).
- Quiescence follow-ups (#59 was buried flat): extend on *new* corner access only (corner
  became legal on the last ply) instead of any corner on offer; or drop stand-pat when the
  opponent's only threat is a corner and the mover has fewer than 3 moves; or spend the nodes on
  an exact endgame solve instead, which is where a horizon really bites in Othello.

## Novel experiments

Ideas the swarm invented here rather than learned from an existing engine. Add each one with
what it is, why it might work, and its verdict. Never fill this from another engine's source.

- None yet.

## What failed and why

When an idea is buried, write what it was, the measured result and what to try differently.
Never re-propose an idea from this list unchanged. A burial means the gate decided no gain. An
idea the referee reported **inconclusive** (a reference failure, or a sequential test that hit its
cap undecided) is not a failure and may be resubmitted unchanged; so may an idea buried before
#195, when the gate was a 40-game rating against a stored number, if its lesson says the result was
within the noise.

- **Transposition table with stored best-move ordering (task #44, PR #45 lesson).** Code is on
  the history of branch `agent/44-transposition-table-with-stored-best-move-` (commit 361cce7).
  Design: 2^20 × 16 B = 16 MB table in a `thread_local`, reused across moves; key = mixed hash of
  the (mover, opponent) pair (no pass flag needed: a pass swaps the pair); depth-preferred within
  a search, always replace older generations; probe/cut on bounds, stored move first at inner
  nodes. Same move and score as plain search at fixed depth, 45% fewer nodes
  (208 705 → 115 085 over 12 positions × depths 3/4/6); depth at `go 200` about +1 ply
  (≤50 empties 9–11, ≤40 9–11, ≤30 8–11, ≤20 10–12). Local `arena versus` vs v0.2: +7 −3.
  **Referee:** rated 1059 ± 135 over 40 games vs Edax level 4, "not above 1459". Read it with
  care: v0.2's 1459 came from a 40–0 sweep of Edax level 1 (± 485, really a lower bound), and
  v0.2 itself was never played against Edax 4, so this verdict says the gate's two ratings come
  from different opponents, not that the TT is weaker than v0.2. Before retrying unchanged, get
  v0.2's own rating against Edax 4 (or a head-to-head gate); if v0.2 also lands near 1050, the
  TT is a gain and should be resubmitted with that evidence.
- **Corner quiescence at the leaves (task #59, PR #61 lesson).** Code: commit 8c8d920 on
  branch `agent/59-experiment-corner-quiescence-at-the-alpha-` (may vanish when the branch is
  deleted; the design below is enough to rebuild it). At depth 0 `negamax` calls `quiesce()`: stand pat
  on `evaluate()`; if the side to move has corner placements, search only those (a side forced to
  pass hands over, and the opponent's corners are followed); hard cap `MAX_QPLY = 4`. `qnodes`
  counts nodes past the horizon and shares the 1024-node clock check. `search_with(.., qsearch)`
  toggles it for tests. Unit test `quiescence_sees_a_corner_at_the_horizon`: a 24-empties
  position where plain depth 2 ties a3 with c1 (−40 each) and plays c1; quiescence scores a3 −26
  (deep d8: −18 vs c1 −44) and plays a3, as plain depth 8 does.
  `depth_report` (ignored test, 8 seeded positions per band), plain → quiescence: go-200 depth
  ≤50 empties 8–9 → 8–9, ≤40 8–9 → 7–9, ≤30 7–10 → 7–10, ≤20 9–11 → 8–11; fixed depth 6
  nodes +2% / +22% / +28% / +7% with a qnode share of 1% / 8% / 12% / 11%. Most of the extra cost
  is lost cutoffs from changed leaf scores, not the qnodes themselves.
  Local `arena versus` vs main (v0.2): +5 −5 over 10 games, +20 −20 over 40: no measurable gain.
  Why it is weak here: `evaluate()` already counts mobility (which includes corner moves) and the
  X/C-square penalty, so the "corner on offer" is partly priced in already; and Othello moves are
  not optional, so standing pat is a loose bound, unlike a quiet move in chess.
  **Referee:** rated 962 ± 163 over 40 games vs Edax level 4, "not above 1459". Same caveat as
  the TT above: v0.2 was never rated against Edax 4, so the gate compares different opponents;
  but here the head-to-head vs v0.2 was also flat, so unlike the TT there is no sign of a gain.
  Chess's quiescence (+65, +82) did not transfer as-is: captures are optional and swing material,
  while an Othello corner is one move among the mandatory ones and the eval already sees it.
- **Potential mobility + edge-anchored stability in evaluate() (task #67 burial, overturned:
  shipped as v0.3 via #82; see "Architecture now").** Kept here for the tuning record. Original
  commit f605788. v0.2's eval and search unchanged, plus two terms, symmetric:
  - **Potential mobility** (chosen over frontier-disc count): empty squares 8-adjacent to the
    opponent's discs minus those adjacent to ours, `empty & neighbours(other)` with a 3-shift
    bitboard dilation (column-a/h masks stop wrap-around). Weight 2 × empties / 60, so it fades
    out as the board fills.
  - **Edge-anchored stable discs**: from each owned corner, the contiguous run of own discs along
    both its edges, plus every disc of a completely filled edge; a bitboard flood along rows 1/8
    and columns a/h. Flat 2 per disc (a corner is 30 + 2). Interior stability is not counted.
  No disc-count term before the terminal score.
  Weights tried (local `arena play` vs v0.2, 20 or 40 games each, no opening book so games vary
  only by timing; a repeat of one setting moved by ±10 games, so read single runs loosely):
  frontier discs 6×empties/60 + stable 8+(60−e)/4: +5 −8 =7; frontier 3 + same stable: +8 −12;
  frontier 10 + stable 12+(60−e)/4: +10 −9; stable only 8+(60−e)/4: +14 −24; frontier only 6: +17
  −23; frontier 2 + stable 4+(60−e)/12: +18 −21; frontier 3 + stable 12+…: +15 −25; frontier 1 +
  stable 2+(60−e)/12: +23 −15; stable only 2+(60−e)/12: +14 −26; potential mobility 2 + stable
  2+(60−e)/12: +25 −15; potential mobility 2 alone: +27 −13 and +29 −11; potential mobility 3
  alone: +9 −28; potential mobility 2 + flat stable 1: +17 −20; **potential mobility 2 + flat
  stable 2: +36 −3 and +33 −4 (chosen)**. Pattern: potential mobility at a small weight is the
  gain; stability helps only as a small flat tie-breaker and hurts as soon as it is large or grows
  with the phase (it then outbids mobility for edge runs).
  Cost (`depth_report` ignored test, 8 seeded positions per band, wall-clock so ±1 ply noise):
  go-200 depth v0.2 → #67: ≤50 empties 8–9 → 7–9, ≤40 7–8 → 7–9, ≤30 7–10 → 7–10, ≤20 9–11 → 8–11.
  Nodes per second about the same (5.6–9.7 M v0.2, 7.2–8.4 M now; the machine is noisy). Fixed
  depth 7 needs 13–50% more nodes (593 527 → 742 069, 834 477 → 1 248 925, 639 524 → 748 329,
  267 591 → 354 435): changed leaf scores change cutoffs, not eval cost. Under one ply everywhere.
  The X-square test allowed an X-square with its corner legal only when the opponent cannot
  take that corner in reply (a seeded position where g2 next to h1 stays ours to take; depth
  5–11 all rate g2 ≥ h1).
  Measured (#67): `arena versus othello --pairs 20` vs v0.2: +35 −4 =1. On the gate's yardstick,
  locally vs Edax level 4, 10 pairs: v0.2 +8 −12 =0, candidate +10 −7 =3.
  **Referee:** rated 1309 ± 108 over 40 games vs Edax level 4, "not above 1459". The third
  Othello idea judged against v0.2's Edax-1 lower bound (±485). This one has the strongest
  counter-evidence yet: +35 −4 head-to-head vs v0.2 and, locally on the same Edax-4 yardstick,
  v0.2 +8 −12 vs candidate +10 −7 =3. **Resubmit it unchanged once v0.2 has an Edax-4 rating**
  (or the gate compares head-to-head); it is not a failed idea, it is an unmeasured one.
  **Resubmitted unchanged as task #82** after #85 made the referee rate main on the gate's own
  rung: v0.3 1265 ± 108 vs v0.2 1173 ± 115, both on Edax 4. Passed. The burial was a rating
  artefact; a lower bound from a sweep of an easier rung is not a yardstick.
- **Large or phase-growing edge stability (task #67 tuning, not buried; kept small).** Stable
  discs weighted 8–23 per disc (growing as the board fills) lost to v0.2 alone (+14 −24) and with
  any frontier term; even 2+(60−e)/12 alone lost (+14 −26). Kept only as a flat 2 per disc.
  Frontier-disc count (own discs touching an empty square) never beat v0.2 at any weight tried;
  potential mobility did. Stability being Othello's "material" did not show at search depth 8:
  the search already sees corner and edge captures, and a big stability bonus makes it trade
  mobility for edge runs.
- **TT in Othello vs chess** (for the chess TT task): no repetitions or 50-move rule, so no
  graph-history problems; terminal scores are not ply-relative, so no mate-distance adjustment.
  Discs only get added, so transpositions come from move-order permutations inside a ply band
  (plus passes). With branching ~10 the gain showed as ordering (earlier cutoffs, −45% nodes)
  more than as direct cut-off hits.
- **Exact endgame solver (task #94, PR #100 lesson; buried, not shipped).** Code: commits
  8ab673e and e2b240a on branch `agent/94-exact-endgame-solver-search-to-the-final-d` (may vanish
  with the branch; the design below is enough to rebuild it). At `SOLVE_EMPTIES` = 14 empties or fewer, `best_move()`
  first runs the normal midgame search for 10% of `go <ms>` (the fallback move, also the root's
  first move), then `solve_root()` solves to the end until 80% of the budget. Its own negamax
  (`Solver::solve`) on the final disc difference, empties to the winner, no `evaluate()` calls;
  two passes end the game as in the midgame terminal. Fail-soft alpha-beta in [-64, 64] with PVS
  (null window after the first child, root included). Order: fastest-first (fewest opponent
  replies) with an odd-quadrant parity tiebreak; from 6 empties down parity only; the last empty
  is a special case (mover, else opponent, else nobody). Shares the 1024-node clock check. An
  unfinished solve still plays its best root move once the first root move is exact (any later
  replacement was proven better); otherwise the midgame move. No TT inside the solve. About 45 M
  nodes/s here.
- Solve-time table (`solve_report` ignored test, 8 seeded positions per empty count, release,
  wall clock, 2 s cap per position; "<=100" counts solves within half a go-200 budget):

  | empties | plain (no order) | fastest+parity | fastest+parity+PVS (submitted) |
  | --- | --- | --- | --- |
  | 12 | median 22 ms, max 162, 7/8 | 7.4 / 15.5, 8/8 | 6.8 / 19.1, 8/8, 0.34 M nodes |
  | 13 | 47 / 473, 6/8 | 16.0 / 24.9, 8/8 | 13.0 / 28.3, 8/8, 0.70 M |
  | 14 | 82 / 2000+, 5/8 | 37.1 / 77.7, 8/8 | 33.7 / 55.7, 8/8, 1.37 M |
  | 15 | - | 94 / 432, 5/8 | 64 / 368, 5/8, 5.0 M |
  | 16 | - | 256 / 333, 0/8 | 162 / 382, 1/8, 8.8 M |
  | 17 | - | 745 / 2000+, 0/8 | 646 / 2000+, 0/8 |
  | 18-20 | - | 2000+ (cap) | 2000+ (cap) |

  Fastest-first is the big win (5-15× fewer nodes than plain at 12-14); parity alone halves
  nodes, on top of fastest-first it adds ~10%; PVS another 15-30%. Each extra empty costs ~3×.
  N = 14 is the largest count with every position under 100 ms. Re-measured for #112 (shipped
  config, median / max ms): 14 empties 18.2 / 31.7, 15 empties 36.7 / 194.7 (7/8 <= 100), 16
  90.3 / 187.2 (5/8): about 2× faster hardware, yet one 15-empty position still overruns the
  ~140 ms solve window of a go-200 move, so N stays 14. The spec's "16-20 empties in
  200 ms" needs a TT and/or faster move generation than the crate's `make_move` per child.
- Measured (#94): `arena versus othello --pairs 20` vs main v0.3: +20 −20, but every game was
  won by the second player: with no opening variety each colour pair replays one game, so it
  says nothing. Local `arena play … edax-4 --pairs 10` is just as deterministic: main v0.3 and
  the solver both +1 −19 (the referee's gate is nearly as deterministic, below). **Use a
  seeded random-opening driver instead**: 80 games vs main, 6 random opening plies per pair, both
  colours, `go 200`: **+46 −32 =2** (59%, about +60 Elo), slowest reply 143 ms. Tests: the solve
  matches full-width minimax on 40+ endgames (4-10 empties and a hand-built 9-empty position),
  handles forced passes, and self-play from a solved 12-empty position ends at the solved score.
- **Referee (#94):** 0–40 vs Edax level 4, rated 541 ± 485, "not above 1265". Read it with care:
  the 40 gate games held only **4 distinct move sequences**, so the gate measured about 2 games
  per colour, repeated. The gate has almost no opening variety on this rung: v0.3 alone has
  scored 8–32, 5–35, 19–18–3 and 18–22 there. Locally main v0.3 also goes +1 −19 against the
  same Edax 4. Against v0.3 on 80 varied games the solver scored +46 −32 =2. Before retrying,
  the gate needs opening variety (seeded random opening plies, as in the head-to-head above);
  then resubmit unchanged. A solver can only help after the midgame reaches 14 empties, and in
  these Edax games the midgame was already lost.

## Results log

<!-- The referee appends one line per verdict. Do not edit by hand. -->
- 2026-11-23 11:51 UTC · v0.1 passed the referee · Wire the othello crate to the protocol and play legal moves · rated 241 (first rated version)
- 2026-11-23 13:35 UTC · v0.2 passed the referee · Alpha-beta with iterative deepening and X/C-square evaluation · rated 1459 (+1218)
- 2026-11-23 15:00 UTC · buried · Transposition table with stored best move ordering every inner node · Rated 1059 ± 135, not above 1459.
- 2026-11-23 16:32 UTC · buried · Experiment: corner quiescence at the alpha-beta leaves · Rated 962 ± 163, not above 1459.
- 2026-11-23 17:28 UTC · buried · Frontier (potential mobility) and edge-anchored stable discs in the Othello evaluation · Rated 1309 ± 108, not above 1459.
- 2026-11-23 18:29 UTC · v0.3 passed the referee · Resubmit #67: potential mobility + edge-anchored stable discs, measured on the fixed gate · rated 1265 (+92 vs v0.2 on the same rung)
- 2026-11-23 19:34 UTC · buried · Exact endgame solver: search to the final disc count once few empties remain · Rated 541 ± 485, not above 1265.
- 2026-11-23 20:14 UTC · v0.4 passed the referee · Resubmit #94's exact endgame solver on the varied-opening gate · rated 1317 (+52)
- 2026-11-24 08:50 UTC · v0.5 passed the referee · Self-generated opening book: the engine's own long searches over the first moves, probed instantly · rated 1274 (+81 vs v0.4 on the same rung)
- 2026-11-24 10:59 UTC · v0.6 passed the referee · Transposition table in the midgame search, ported from chess's shipped TT and judged against v0.5 · rated 1427 (+153)
- 2026-11-24 14:38 UTC · buried · Transposition table inside the exact endgame solver, then raise SOLVE_EMPTIES if the saving buys a ply · Rated 1413 ± 116, not above 1427.
- 2026-11-24 15:35 UTC · buried · PVS and history-heuristic move ordering in the Othello midgame search, ported from chess v0.5 · Rated 1295 ± 138, not above 1427.
- 2026-11-25 13:33 UTC · buried · Resubmit #160 unchanged on the sequential gate: transposition table in the exact endgame solver (commit 7024682) · The sequential test against v0.6 decided no gain: 93 pairs (186 games), score 46.0% (-28 Elo vs main), LLR -3.01 in [-2.89, 2.25], H0 -20 vs H1 +30, α = 0.1, β = 0.05.
- 2026-11-26 08:34 UTC · v0.7 passed the referee · Spend the clock: search to go minus a safety margin instead of the 1/3 'don't start' rule · rated 1281 (-146)
- 2026-11-26 14:21 UTC · v0.8 passed the referee · Phase-bucketed self-play fit of the Othello evaluation weights (corner, mobility, X/C, potential mobility, stable discs) · rated 1371 (+90)
