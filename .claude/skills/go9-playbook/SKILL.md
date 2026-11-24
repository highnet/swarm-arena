---
name: go9-playbook
description: Playbook for the Swarm Arena Go 9×9 engine (engines/go9). Load it before changing that engine or planning its next task. Holds the rules-library notes, the engine's current architecture, ideas that worked or failed, and the referee's results log. The swarm keeps it up to date.
---

# Go 9×9 playbook

Read this before touching `engines/go9`. Update it in the same session: the engine and this
playbook are both yours to edit. The referee appends every verdict to the results log below and
keeps your playbook edits even when the idea is buried.
Describe a candidate change under a "Candidate (not shipped)" note or in "Ideas worth trying"
until the referee passes it, and move it into "Architecture now" only once it lands: a burial must
not leave "Architecture now" describing reverted code.

## Rules library: `goban`

- Referee rules: area scoring, komi 7.5, positional superko, suicide illegal, two passes end it.
- Coordinates are GTP style: columns a–j without i, row 1 at the bottom; `pass` is a move.
- Check `goban`'s ko/superko and scoring settings against the referee; mismatches forfeit games.
- goban 0.20 coords: `(row, col)`, row 0 = top = rank 9; GTP `e5` -> `(4, 4)`, `a9` -> `(0, 0)`.
- goban's own superko is incomplete: `check_super_ko` only runs for capturing moves and skips
  when its history has <= 2 boards. The engine keeps its own `HashSet<Goban>` of every board seen
  (Goban's `Eq` compares every point, `Hash` is zobrist) and rejects any move whose
  `play_for_verification` result is in it. Use `check_point_by(c, IllegalRules::SUICIDE)` for
  occupied/suicide, then the set for superko.
- `play_for_verification` passes the suicide flag inverted (removes a dead added chain under
  CHINESE). Harmless after the suicide check above; do not rely on it for suicide.
- `Game::play(Move::Pass)` asserts fewer than two passes; call `resume()` first if replaying.
- `check_eye` (goban) is a heuristic true-eye test for the side to move; fine for playouts.

## Use the engine

- Build: `cargo build --release -p go9-engine` (from `engines/`).
- Play it: `npm run arena -- play go9 engines/target/release/go9-engine random --pairs 2`.
- Protocol: `engines/PROTOCOL.md`. Search and evaluation must be original code; never copy an
  open-source engine.

## Limits

One thread, modest memory, and every reply within the `go <ms>` budget (200 ms in gate matches,
0.5–3 s on the site). No network, processes, services or threads. It must also build for
`wasm32-wasip1`: `cargo build --release --target wasm32-wasip1 -p go9-engine`.

## Architecture now

MCTS (UCT) since #29, with RAVE since #86. Three files in `engines/go9/src`:

- `main.rs`: protocol, `Position` (goban `Game` with CHINESE rules + own seen-board set for
  positional superko) as the legality oracle at the root, and `choose`:
  - If the opponent just passed and Tromp-Taylor area (komi 7.5) already wins, pass.
  - Root moves = goban/superko-legal moves that are not own eyes on the flat board. None:
    pass. One: play it. Otherwise UCT until 70% of `go <ms>`, play the most-visited child.
  - Prints `info playouts N winrate W` on stderr.
- `board.rs`: own flat 81-cell board. Chains are circular linked lists with a head per stone;
  per-chain pseudo-liberties (one per stone/empty adjacency, zero iff no liberty) and size;
  simple-ko point; no superko. Eye = all 4 neighbours own and at most one enemy diagonal (none
  on the edge). Empty points kept as an incremental list (`empty`/`epos`, swap-remove on
  `put`, append on capture) so a playout move no longer rescans 81 cells; `last` = last move.
  **Playout policy (#99)**, `policy_move`: (1) `tactical_move` — for each own chain next to the
  last move that is in atari, capture an adjacent enemy chain in atari (largest first), else
  extend on its liberty if that leaves >= 2 liberties (`libs_after`, a capture counts as 2);
  then (2) capture the last move's chain if it is in atari. Every returned move is legal.
  (3) Otherwise uniform random among legal non-eye points, redrawing (up to 4 times) a move that
  **joins an own chain** and leaves it with one liberty without capturing (`is_self_atari`);
  when only such moves remain the first rejected one is played, never a pass. Exact liberties:
  `atari_lib` walks the chain only when pseudo-libs <= 4 and stops at the second distinct
  liberty; `is_self_atari` counts exactly only when p has <= 1 empty neighbour. Playouts go to
  two passes or 243 moves, area-scored.

  Policy numbers (#99), go 200, 5 runs: playouts empty board v0.3 5.2–5.6k, now 5.2k; after
  e5 c3 g7 c7 g3 d5 v0.3 5.6–5.9k, now 5.3k (−5..−10%; raw playout bench `board::bench` 44k/s
  → 39k/s from the empty board, ~105 moves per playout). The policy alone cost ~50% per move
  before the empty list and the early-exit liberty walks won most of it back.
  Local `arena play` vs GNU Go level 1, 200 ms: v0.3 10–30 and 9–11; policy rejecting every
  self-atari (A) 29–31 over 60; joins-own-chain only (B, shipped) 54–26 over 80. `arena versus`
  vs v0.3 (A): 15–5.
- `search.rs`: node arena (`Vec<Node>`, children contiguous, shuffled at expansion), UCB1 with
  C = 0.6 on win rates, unvisited children first, expand a leaf on its 2nd visit, pass child only
  when a node has no other move, tree capped at 2M nodes. Binary win/loss backed up.
  **RAVE (#86):** each node also has `amaf_visits`/`amaf_wins`. Every simulation records its
  whole move sequence from the root (tree moves, then the playout via `playout_recorded`,
  passes included; colours alternate from the root mover). `amaf_update` walks the sequence
  backwards keeping `first[p]` = colour of the first play on p at or after index i, so a point
  replayed after a capture counts only for whoever played it first; at each expanded path node
  i, every child whose point was first played by the colour to move there gets an AMAF visit
  (and a win if that colour won). Passes never count. Selection is greedy on
  `(1 − β)·Q + β·Q_amaf`, **β = sqrt(K / (3n + K)), K = 3000, C = 0**; no real visits → Q_amaf,
  neither → FPU 1.1. Tests: `amaf_counts_on_a_hand_built_path` (recaptured point, colours,
  win/loss), `passes_never_count`, `unvisited_children_use_amaf_then_fpu`.

  RAVE sweep (#86), 200 ms, shared 4-core machine with matches in parallel. Vs main (v0.2),
  8 games each: C = 0 with K = 300 7–1, K = 1000 8–0, K = 3000 8–0; C = 0.1/K = 1000 8–0.
  Head-to-head vs C = 0/K = 1000 (10 games each): C = 0.1 3–7, K = 300 4–6, K = 3000 6–4 and
  again 6–4 (12–8 over 20), so K = 3000. `arena versus go9` (K = 3000 vs v0.2): **10–0**.
  Playouts (go 200 / go 1000, under load): empty board main 5.8k / 29k, RAVE 5.4k / 24k;
  after e5 c3 g7 c7 g3 d5 main 5.6k / 27k, RAVE 4.6k / 23k. RAVE costs ~10–20% of the playout
  rate here (vs 40–70% in Hex: Go playouts are slower, so the AMAF walk is relatively cheaper).

Speed: ~25k playouts/s on the empty board natively (about 3.5k per 200 ms move at 140 ms of
search). Tests: flat board vs goban across 40 random games (stones identical after every move,
legality equal except where only superko forbids), flat-board suicide/capture/ko, and 20
self-play games at 200 ms (legal, each reply < 200 ms; takes ~4.5 min in release).

## Buried, not shipped: Benson-settled regions + exact endgame solve (#116)

Not in the engine. Code: commit 7b37ee1 on branch
`agent/116-go-9-9-exact-endgame-without-tablebases-be` (`src/benson.rs`, `src/solve.rs`, and the
`forbid` field in `board.rs`; may vanish with the branch, the design below is enough to rebuild
it). Verdict and why in "What failed and why".

- `benson.rs`: Benson's unconditional life per colour on the flat cells (u128 masks; chains and
  regions by flood fill; drop chains with < 2 vital regions among regions enclosed by kept
  chains until stable). **Settled** area = a region with no stones at all, all bordering chains
  alive, every point touching them. Regions holding dead enemy stones stay unsettled on purpose:
  the referee scores Tromp-Taylor with no dead-stone removal, so those stones must be captured.
  `unsettled_points` = 81 − alive stones − settled points (stones of non-alive chains count:
  capturing them opens new points; counting only empties made the solver explode).
- `Board::forbid` = settled points of both colours. Root moves, tree expansion
  (`playout_moves`), `random_move` and the tactical reply all skip it, so settled points also
  score exactly in every playout at no cost.
- `solve.rs`: negamax alpha-beta to two passes on the TT area score (half points, komi 7.5),
  moves = non-forbidden legal non-own-eye points + pass (last); ordering: TT move, captures
  (by size), saving an own chain in atari, next to the last move, self-atari last. TT 2^18
  × 16 B (4 MB) keyed on stones/side/ko/passes with bounds and plies-left. Ply cap
  3·unsettled + 20. Superko beyond simple ko not modelled (root moves come from the oracle).
- `main.rs`: when `unsettled_points` ≤ 16 (18 from `go 1000`), a **null-window win/loss solve**
  (−1, 1) until 50% of the budget; a proven win plays that move (pass included); a proven loss
  or timeout falls back to MCTS to 70% (swindles vs an imperfect opponent). No legal
  non-settled move → pass.
- Solve-time table (`solve_report` ignored test, 8 random endings per row from a settled
  top/bottom base, release, 2 s cap; "≤100" = within half a go-200 budget):

  | unsettled ≤ | full window median / max | win/loss median / max (shipped) | win/loss ≤100 ms |
  | --- | --- | --- | --- |
  | 10 | 0.6 / 6.3 ms | 0.4 / 1.3 ms | 8/8 |
  | 12 | 1.4 / 11.5 ms | 0.7 / 4.8 ms | 8/8 |
  | 14 | 21.7 / 1226 ms | 5.2 / 16.1 ms | 8/8 |
  | 16 | 13.5 / >2000 ms | 4.6 / 58.5 ms | 8/8 |
  | 18 | 109 / >2000 ms | 11.9 / 265 ms | 7/8 |
  | 20 | >2000 / >2000 ms | 77 / 680 ms | 5/8 |
  | 24 | timeouts | 2000 / 2000 ms | 2/8 |

  Null-window is 5–30× cheaper than the exact margin; only the result matters for rating.
- How often it fires: in 20 local games vs GNU Go 1 at 200 ms, only 8 of ~730 moves had
  ≤ 16 unsettled points (85% of moves > 60): GNU Go resigns or the game ends before the board
  settles under Benson's strict test. The 4 solves that ran all proved a loss. So the gain, if
  any, comes from the forbid mask (no moves inside settled areas in tree and playouts).
- Local results, 200 ms: vs GNU Go 1 candidate 13–7 and 15–5 (28–12) against main 12–8 in the
  same run, about noise; `arena versus go9 --pairs 10` vs main v0.4: **14–6** (no opening
  seed, so treat as weak evidence). Tests: Benson (two eyes, one eye, false eye, seki, dead stone in an
  eye, big open area, finished board), solver = plain minimax on 30 random endings (full and
  null window, root move), takes the last dame, captures a dead stone before passing.
- Next: a looser "settled" test that fires earlier (e.g. regions an enemy cannot live in by
  size/shape, or Benson plus one-move safety), so the exact solve reaches real gate endgames.

## Candidate (not shipped): self-generated opening book (#110)

Move into "Architecture now" only once the referee passes it.

- `src/book.rs`. `choose()` probes the book after the pass/one-move checks and before the search,
  and plays the stored move instantly (`info book <move>` on stderr) if it is among the root moves.
  The book is only consulted while the game has at most 4 moves, no pass and no capture (stones on
  the board = moves played), so stones + side to move are the whole position (no ko/superko).
- **Keyed by canonical position**, not move order: black and white stones as two 81-bit masks,
  minimised over the board's 8 symmetries (`sym`: transpose, row flip, column flip). The stored
  move is in the canonical frame and mapped back with `unsym`. Transpositions and mirrored
  openings share one entry.
- **What it covers** (`book::frontier`): with the region R = c3–g7 (where #105's suite draws
  its 2-ply lines): the empty board; every 1- and 2-stone position in R (plies 1–2: our first
  move as Black after any suite opening); every ply-2 R position plus any third black stone in R
  (ply 3: our first move as White); every ply-2 position plus its own book move plus any white
  reply in R (ply 4: our second move as Black). 996 + 1324 = **2320 canonical positions**.
  No ply-5 entries (White's second move): that frontier would be ~20x larger.
- **How it was built** (regenerate from `engines/`: `go9/book/generate.sh [shards] [playouts]`):
  `search::search_limited` = the engine's own UCT+RAVE with a fixed **100 000 playouts** per
  position and no clock (vs ~3.5k in a go-200 move, ~28x), RNG seeded from the position key and
  seed 110, so the book is deterministic whatever the shard count or machine. Rounds repeat
  until the frontier is empty (round 2 needs the ply-2 book moves). Cost: ~3 s per position
  with 4 shard processes; 29 min wall for the whole book. Source and embedded form are the
  same file, `book/go9-book.txt` (`black\twhite\tmove\tplayouts\twinrate`, canonical
  GTP points), 62 KB, `include_str!`, parsed once into a HashMap.
- **Rebuild after generating**: the book is `include_str!`, so a binary built before the last
  round plays the old book (`generate.sh` rebuilds last).
- Hit rate: `go9-engine book stats` reads game lines (`b|w <moves…>`, the colour the engine
  played) on stdin and prints in-book plies per game and the first out-of-book ply.
- Tests: every entry legal (goban + superko oracle, not an own eye) in its position and stone
  counts consistent; all 146 suite openings in book; the generator's search reproducible;
  probe skipped after a pass and beyond ply 4.
- Local results: local, 200 ms, suite openings (`playMatch` with `loadSuite("go9")`,
  not referee evidence): vs main (v0.4) **35–45** over 80 (seed 110: 16–24, seed 111: 19–21);
  vs GNU Go 5 candidate **32–28** over 60 against main **35–25** on the same openings (seeds
  112/113/114: 9–11, 9–11, 14–6 vs 13–7, 10–10, 12–8). Within noise of main, if anything
  slightly behind. Hit rate (`book stats`, 47 games): **1.5 in-book plies per game**, every
  targeted ply hit: as Black plies 2 and 4 in book, first out-of-book ply 6; as White ply 3 in
  book, first out-of-book ply 5.
- Why the gain is small, measured: at 3.5k playouts (one go-200 move) the root choice is very
  unstable: on 20 frontier positions six seeds agreed with the 100k-playout move only 22% of
  the time (and rarely with each other); at 100k four seeds agree ~75% (the empty board still
  varies: e4/e6/f6/e5). So the book does change the opening moves; it just does not show that
  100k-playout UCT+RAVE (C = 0) picks *better* opening moves than 3.5k. Next, if this is
  buried: score candidate book moves by long self-play from the position (many games at go 200
  per candidate, a search of the move's outcome rather than one search's most-visited child),
  or average several seeds' visit counts; and cover ply 5.

## Candidate (not shipped): MCTS tree reuse between moves (#154)

Move into "Architecture now" only once the referee passes it.

- `search::Tree` = the node arena plus the root board. `search_tree(&mut Tree, …)` grows it
  (`search_limited`, used by the book generator, builds a fresh one: the book stays
  deterministic). `main.rs` keeps a process-local `Reuse` (the game record at the last search's
  root and its tree) between `go` calls; `game` clears it, and so does every `go` answered
  without a search (pass rule, no/one legal move, book move).
- On `go`: if the new record extends the saved one, the moves since (ours, then the reply;
  any number, passes as PASS) are walked through the tree. `Tree::advance` re-roots at the node
  reached when every move is a child, that node is **expanded**, and the replayed flat board
  equals the real one (cells and side to move). It **compacts** the arena: breadth-first copy of
  that subtree into a new `Vec`, children still contiguous, visits/wins/AMAF untouched, so the
  2M-node cap applies to live nodes only. Root children: the old children the goban/superko
  oracle still allows (others pruned with their subtrees), plus any oracle move the tree lacked
  (added unvisited). Anything else starts a fresh tree. The search's root board is always the
  real position's flat board, as before.
- `info playouts N reused R winrate W` on stderr (R = root visits inherited).
- Tests: `reroot_keeps_the_grandchild` (search 20k playouts after e5 c3 g7 c7 g3 d5, re-root
  after the principal pair: root visits = grandchild visits, an oracle-rejected child is
  pruned, root children = oracle moves exactly, searching on adds to the inherited visits);
  `unexpected_reply_starts_fresh` (a reply with < 2 visits, a record that does not extend the
  saved one, and `game` all give a fresh tree; the expected reply through the same entry point
  reuses). The 200 ms self-play test now keeps one `Reuse` per side, as two processes would.
- Measured, `cargo test --release reuse_report -- --ignored --nocapture` (self-play, go 200,
  4 games each, one cache per side, this 4-core box):

  | | moves | reused | median inherited | median playouts | median root visits |
  | --- | --- | --- | --- | --- | --- |
  | off, plies 0–39 | 140 | 0 | 0 | 5792 | 5792 |
  | on, plies 0–39 | 140 | 125 | 865 | 5600 | 6790 |
  | off, plies 40+ | 254 | 0 | 0 | 41776 | 41776 |
  | on, plies 40+ | 243 | 84 | 0 | 43136 | 44160 |

  Early on the tree is reused on ~90% of moves and gives ~+15% root visits (the reply was
  usually one we searched a few hundred times); playouts per move drop ~3% (compaction and a
  deeper tree). Late (fast playouts, 40k a move) most replies landed on a node we never
  expanded, so reuse rarely fires. A diagnostic run found no board mismatches: every miss was
  an unexpanded reply node or a move answered without a search.
- Local `arena versus go9` vs main (v0.5), 200 ms, balanced suite: **16–24 (seed 976117434)**
  and **20–20 (seed 1672814187)**, 36–44 over 80: no measurable gain, within noise of main.
  Expected from the numbers above: +15% root visits early (and little late) is worth a few Elo
  at most, below what 80 games can resolve. Reuse is free in the protocol (one process per game,
  `position` carries the whole record), so it fires in real matches. If buried: the cheap next
  step is to make the inherited part larger, e.g. keep searching the predicted reply's subtree
  (ponder is off-limits: no work outside `go`), spend part of a book move's budget searching so
  the tree survives the book, or a time policy that spends less when the root already holds many
  visits.

### What Hex would need for the same

`engines/hex/src/search.rs` builds `Vec<Node>` inside `search(black, white, black_to_move,
limit, seed)` and drops it. To reuse: (1) move the arena and the root bitboards into a struct
returned to `main.rs` and kept between `go` calls (cleared on `game`); (2) walk our move and
the reply (`mv` = cell index) through `first..first+count`, re-root only at an expanded node,
and check the replayed bitboards against `replay(moves)`; (3) compact breadth-first as here
(`count: u8`, children contiguous) and re-check the root children against `candidates(black,
white, to_move)` at the new root (no superko in Hex, so that is the only filter); (4) Hex's
search is seeded from the move list and `search_is_deterministic` asserts that a position
always searches the same way: with reuse the result also depends on the previous search, so
that test must build fresh trees (as the go9 book generator does). The win-in-one/block
shortcuts in `choose` answer without a search and should clear the saved tree.

## Ideas worth trying

- Progressive widening. RAVE is in (#86); tree reuse is the #154 candidate above.
- Tree reuse follow-ups (#154): keep the tree also across book moves (search the book
  position briefly) and extend late-game reuse (most late replies land on unexpanded nodes).
- RAVE follow-ups: K between 3000 and 10000 (the curve was still rising at 3000); a
  playout-policy prior once the policy is smarter (AMAF quality follows playout quality).
- Playout policy follow-ups (#99 is in): 3×3 patterns around the last move; ladder reading
  for the escape (extending in a ladder still dies); nakade awareness; a policy prior in the
  tree (AMAF quality follows playout quality, so revisit RAVE K now).
- Time management: spend more early and in fights; pass when the board is settled.
- Playout speed: `random_move` rescans all 81 cells per move and `is_suicide` rescans
  neighbours per chain; an incremental empty list and a cheaper legality test should give
  2x. More playouts at 200 ms is the cheapest Elo here.
- Score-aware backup (small bonus for margin) to stop aimless endgames once the result is won.

## Novel experiments

Ideas the swarm invented here rather than learned from an existing engine. Add each one with
what it is, why it might work, and its verdict. Never fill this from another engine's source.

- None yet.

## What failed and why

- Benson forbid mask + null-window endgame solve (#116): referee rated it 1569 ± 142 vs
  GNU Go level 5, against v0.4's 1682 ± 179 on the same rung, so it was buried. Read that with
  care: **the burial rests on a broken reference on both sides.** GNU Go timeouts broke both
  matches. In the candidate's match (run-001-go9-mwtsgnd9, 33–7) games 21–40 are all GNU Go
  timeouts at 2–3 plies (g21 at 31); in v0.4's baseline (run-001-go9-mwtsjytf, 36–4) games
  18–40 are the same (one crash, the rest timeouts). Counting only games that ended by the
  rules, the candidate went 13–7 over 20 games and v0.4 went 13–4 over 17, so neither 1569 nor
  1682 measures an engine. The referee bug is tracked in a separate harness issue. Locally the candidate was level or better: versus main 14–6, vs GNU Go 1 28–12 (main
  12–8). And the solve almost never fired (8 of ~730 moves at <= 16 unsettled points), so
  this gate could hardly have measured the solver. Before retrying, check that GNU Go at level 5
  answers every move on the gate machine. Then resubmit with a looser "settled" test, so the
  solve reaches real endgames.

- Rejecting *every* non-capturing self-atari in playouts (#99, variant A): 29–31 vs GNU Go 1
  against 54–26 when lone-stone self-ataris (throw-ins, nakade shapes) are allowed. The
  playouts need those moves to kill eyes; reject only self-atari that grows an own chain.
- RAVE with a UCB term (#86): C = 0.1 lost 3–7 to C = 0 at K = 1000; small K (300) lost 4–6.
  Same as Hex: AMAF already spreads statistics, the bonus only diverts real visits.

When an idea is buried, write what it was, the measured result and what to try
differently. Never re-propose an idea from this list unchanged.

## Results log

<!-- The referee appends one line per verdict. Do not edit by hand. -->
- 2026-11-23 10:46 UTC · v0.1 shipped · Wire goban to the protocol and play legal moves · rated 269 (first rated version)
- 2026-11-23 17:39 UTC · v0.2 passed the referee · MCTS (UCT) with random eye-respecting playouts on a fast flat board · rated 1236 (+967)
- 2026-11-23 19:00 UTC · v0.3 passed the referee · RAVE (AMAF) blended into UCT, ported from Hex v0.3 · rated 959 (+24 vs v0.2 on the same rung)
- 2026-11-23 20:39 UTC · v0.4 passed the referee · Tactical playout policy: capture or escape atari near the last move, and refuse self-atari, ported from Hex's bridge-preserving fill-in · rated 1341 (+382)
- 2026-11-23 21:44 UTC · buried · Exact endgame without tablebases: Benson-settled regions plus an alpha-beta solve of the unsettled points · Rated 1569 ± 142 vs GNU Go level 5; v0.4 rated 1682 ± 179 on the same rung.
- 2026-11-24 10:16 UTC · v0.5 passed the referee · Self-generated opening book: the engine's own long MCTS runs over the first moves, probed instantly · rated 1447 (+58 vs v0.4 on the same rung)
- 2026-11-24 11:34 UTC · buried · MCTS tree reuse between moves: keep the subtree of the position actually reached · Referee error: Error: gnugo-8 timeout in game 2 on 4 attempts in a row: aborting the match (Error: timeout)
