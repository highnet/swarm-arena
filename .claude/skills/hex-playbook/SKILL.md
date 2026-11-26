---
name: hex-playbook
description: Playbook for the Swarm Arena Hex 11×11 engine (engines/hex). Load it before changing that engine or planning its next task. Holds the rules-library notes, the engine's current architecture, ideas that worked or failed, and the referee's results log. The swarm keeps it up to date.
---

# Hex 11×11 playbook

Read this before touching `engines/hex`. Update it in the same session: the engine and this
playbook are both yours to edit. The referee appends every verdict to the results log below and
keeps your playbook edits even when the idea is buried.
Describe a candidate change under a "Candidate (not shipped)" note or in "Ideas worth trying"
until the referee passes it, and move it into "Architecture now" only once it lands: a burial must
not leave "Architecture now" describing reverted code.

## Rules library: `hexgame`

- Referee: 11×11, no swap rule, `a1` top-left; Black moves first and joins top to bottom,
  White joins left to right.
- `hexgame` 0.1 matches the referee exactly: `Coords { row, column }` zero-based from the top
  left, `Display`/`FromStr` use the same `c4` form (`a1` top-left, letters a–k, no skipped `i`),
  Black owns `Edge::Top`/`Edge::Bottom`, White `Edge::Left`/`Edge::Right`, and the six neighbours
  of (r, c) are (r, c±1), (r−1, c), (r−1, c+1), (r+1, c), (r+1, c−1) as in `hex.ts`. The engine
  still parses moves itself (`to_coords`, strict `a1`–`k11`) and tests the round trip, the
  neighbour set and both win directions.
- `Board::play(coords, color)` places either colour (handy for "would the opponent win here");
  `Game::play` uses the side to move. `Board` is cheap to clone (union-find inside).
- There are no draws; a full board always has a winner.

## Use the engine

- Build: `cargo build --release -p hex-engine` (from `engines/`).
- Play it: `npm run arena -- play hex engines/target/release/hex-engine random --pairs 2`.
- Protocol: `engines/PROTOCOL.md`. Search and evaluation must be original code; never copy an
  open-source engine.

## Limits

One thread, modest memory, and every reply within the `go <ms>` budget (200 ms in gate matches,
0.5–3 s on the site). No network, processes, services or threads. It must also build for
`wasm32-wasip1`: `cargo build --release --target wasm32-wasip1 -p hex-engine`.

## Architecture now

MCTS (UCT) since #42, with RAVE since #50. Three files in `engines/hex/src`:

- `main.rs`: protocol, coordinates, `hexgame` replay (the authority for legality), and `choose`:
  1. plays a cell that wins at once (checked with `hexgame`), else
  2. blocks a cell where the opponent would win at once, else
  3. on the empty board plays f6 (no swap rule: the centre is strongest), else
  4. converts the board to bitboards and runs UCT until 80% of `go <ms>`, playing the
     most-visited root child. Prints `info playouts N winrate W` on stderr.
  The search seed is a hash of the moves so far: a position always searches the same way.
- `board.rs`: own flat board, one `u128` per colour (index `row * 11 + column`). `grow` is the
  six-neighbour dilation with column masks (±1, ±11, +10, −10). Connection = flood fill from the
  start edge with `grow`, then test the far edge. Playout: list the empty cells, partial
  Fisher–Yates picks ⌈k/2⌉ of them for the side to move, the rest go to the other side, one
  connection check for Black (a full board has exactly one winner). No per-move win checks.
  `fill` returns Black's final board (White owns the rest); `playout` = `fill` + the check.
  **Bridge pairing (#60, `BRIDGE_PAIRING = true`):** before the split, `fill_bridges` finds
  every bridge of either colour with an empty carrier (three downward directions from the upper
  stone, offsets +12/+21/+9 with column masks, as bitboard ANDs), visits them in random order and,
  when both carrier cells are still unassigned, gives one (at random) to each colour. The rest
  are split ⌈k/2⌉/⌊k/2⌋ as before (k keeps the parity of all empties, so the per-colour counts
  match the uniform fill). `fill_uniform` is kept for the switch and the tests. Only interior
  bridges: edge templates were tried and buried (#73, below), no ladders.
- `search.rs`: node arena (`Vec<Node>`, 32 bytes a node since v0.6, children contiguous and shuffled at
  expansion), expand a leaf on its 2nd visit, tree capped at 2M nodes (64 MB), clock checked
  every 64 playouts. `Limit::Playouts(n)` makes it deterministic for tests; `Limit::Time` is
  for `go`.
  **Inferior-move pruning (#95, `PRUNE_EXPANSION = true`):** `candidates` gives a node children
  only on empty cells that are neither dead nor captured by the opponent of its mover (falls back
  to every empty cell if that leaves none; the immediate win/block checks in `choose` run first).
  The detector is `board::inferior`, all bitboard ANDs on the u128 boards: each cell's six
  neighbours in cyclic order (slots up, up-right, right, down, down-left, left: offsets −11,
  −10, +1, +11, +10, −1), an off-board slot counting as a stone of that edge's owner (k1's
  up-right and a11's down-left corner slots count as Black). **Dead** = four consecutive slots of
  one colour. **Captured pair** (a, b) for X = adjacent empties where a has a four-run of X
  slots once b counts as X and vice versa (e.g. f5 g5 f7 g7 around f6–g6, or a lone
  second-row stone and its two edge cells). Patterns use stones only, so they hold whatever the
  other empties become. Tests prove both over >5000 random completions each (flip a dead cell:
  same winner; capturer owning both = owning either one), check every slot and edge against
  `hexgame`, and hand-build edge and corner cases.
  **Inferior fill-in (`board::FILL_INFERIOR = false`, measured worse):** `fill_inferior` gives
  each captured pair to its capturer (counted as one move each, as in play: intrusion and
  reply), splits dead cells evenly, then runs the bridge pairing on the rest. Kept for the
  switch; see the measurements below.
  **RAVE:** each node has `amaf` (visits low 32 bits, wins high 32). After a playout, every
  child of every path node whose cell its mover owns on the final board gets one AMAF visit
  (and a win if that mover won); tree moves are on the final board too, so no move lists.
  The update builds two 128-entry per-cell increment tables (one per colour) once per playout,
  so each child costs one table load and one add. Selection is greedy on
  `(1 − β)·Q + β·Q_amaf`, **β = sqrt(K / (3n + K)), K = 1000, no UCB term (C = 0)**; a child
  with no real visits uses Q_amaf, one with neither uses FPU = 1.1. Test
  `amaf_counts_on_a_hand_built_path` checks the counts on a hand-built tree.
  Since v0.6 (#187/#276, below) `backup` caches Q and β per node (node 24 → 32 bytes, tree cap
  64 MB), `select` returns the first child with no real and no AMAF visits at once (FPU), and
  the two AMAF increment tables are written in one branch-free pass; `same_search_as_v0_5` pins
  the search bit for bit to v0.5's.

**Exact cheaper RAVE (v0.6, #187 then #276, landed in 5f7291d at 2754, +20).** First buried
  on the old 40-game gate (#187, 2717 ± 108: the referee went 19–21 vs v0.5, after 58–62
  locally against a 55–65 control); resubmitted unchanged (49ce146) it passed the sequential
  gate in #276: 94–84 over 178 games vs v0.5 (seed 1131152920), LLR 2.30, pr#296. Same search, bit for bit: K = 1000, C = 0, fill-in and pruning
  untouched. Profile first (callgrind, mid-game,
  v0.5): `select` ~56% of instructions, `backup` (AMAF) ~16%, fill-in ~8%; `select`'s cost is
  the per-child value, two divisions and a square root on every child of every path node, and
  its `visits == 0` branch is ~74% of all mispredictions. Three exact changes:
  (1) Q = wins/visits and β = sqrt(K/(3n+K)) depend only on a child's real counts, which change
  only on the path (one node per level), so `backup` caches them in the node (`q`, `beta`; node
  24 → 32 bytes, tree cap 48 → 64 MB) and `select` keeps one division per child (Q_amaf);
  (2) a child with no real and no AMAF visits is worth FPU = 1.1, above every win rate, so
  `select` returns the first such child at once; (3) the two 128-entry AMAF increment tables
  are written in one branch-free pass instead of zeroing 2 KB and walking each colour's bits.
  Test `same_search_as_v0_5` pins 12 searches (4 positions × 3 seeds, 20k–100k playouts) to the
  move and win-rate bits main gave; `amaf_counts_on_a_hand_built_path` is unchanged.
  Fixed work (`search` with `Limit::Playouts`, best of 5, k playouts/s; 3-stone position at
  50k/300k, then a 20-stone mid-game at 50k/300k): v0.5 392/431–460, 508/646–654; (1) alone
  433/557, 533/758; (1)+(2) 451/554, 554/770; (1)+(2)+(3) 453–468/540–572, 573–580/797–806,
  i.e. **+15–25%** on the same tree. Wall clock (native, 4-core Xeon, 4 runs each,
  main → candidate, medians): `go 200` f6 e7 g5 59k → 63k, mid-game 1 (`c3 h9 e7 f4 c8 d5 g4
  g3 h3 f6 b10 h5 e5 f5 e4 f2 d3 d7 e6 d4`) 56k → 75k, mid-game 2 (`b9 e4 g5 e7 f7 h4 g4 e8 f8
  e9 f9 g3 h3 f6 g6 i1 j2 i2 i3 e11`) 54k → 58k; `go 1000` f6 e7 g5 371k → 521k (+40%),
  mid 1 555k → 752k (+36%), mid 2 304k → 384k (+26%). `go 200` is noisy (single runs 46–76k).
  **Measured slower and dropped:** structure-of-arrays trees. Full SoA (one vector per field)
  with a branch-free, vectorised value (`divps`/`sqrtps`; LLVM only vectorised it once the
  float selects were written as bit masks, it turns `if` back into branches) ran at 284k/376k
  on the fixed work, below v0.5: mispredictions fell ~10× but SSE `divps` at 3 divisions + 1
  sqrt per lane costs more than v0.5's mostly-one scalar division, and every descent step then
  touches 5–7 separate arrays. SoA with `q`/`beta` cached and only Q_amaf vectorised: 347k/393k,
  still slower than array-of-nodes; a 16-byte stats + 8-byte header split: no better.
  `std::hint::select_unpredictable` on the `visits == 0` choice and a branch-free argmax: no
  change (real hardware hides those mispredictions far better than callgrind's model).
  The one 32-byte node per child, read as a single prefetch-friendly stream, beats several
  streams here. Not tried: skipping the AMAF update deep in the tree (not exact).
  Strength at 200 ms, `arena versus hex`, 40 games a seed, four or three runs in parallel on the
  4-core machine (which compresses the speed gain): candidate vs main 18–22 (seed 18701), 17–23
  (18702), 23–17 (18703), **58–62**; control main vs main 18–22, 19–21, 18–22, **55–65**.
  K = 3000 (with the faster code) vs main 17–23 (18701), so K stays 1000. As expected for an
  identical search with 10–35% more playouts at `go 200`: the gain, if any, is far below what
  120 games resolve; the speed is the measured result.
  Lesson: this was a provably identical search with 26–40% more playouts per `go 1000` (less at
  `go 200`), and it rated inside the error bar like the five tree/policy changes before it. So
  at 200 ms, +30% playouts is worth well under the ~±110 a 40-game gate resolves; RAVE at
  K = 1000 is not playout-starved. Speed alone will not clear the gate; reapply 49ce146 (it is
  free strength, exact) together with a change that needs the time, or once the gate resolves
  smaller gains. Next speed idea if wanted: the fill-in and the select descent, not the AMAF
  update (only ~16% of instructions).
  **Shipped as v0.6 (#276, pr#296, 5f7291d).** 49ce146's
  engines/hex diff reapplies cleanly to main (no hex engine commit landed since its parent) and
  is byte-identical to it. Exactness re-checked beyond the pinned test: a scratch probe hashing
  every tree node's (move, visits, wins, AMAF) plus every root child's visit count matched main on
  all 12 `same_search_as_v0_5` searches. `go 200` here (5 rounds of f6 / f6 e7 d5 / c3 i9 f6 e5,
  main and candidate interleaved): 975k → 1149k playouts in all, **+18%**. Move this entry to
  (Moved here from 'What failed' in #297, once v0.6 landed.)

Inferior cells (#95) at f6 e7 g5, 3 runs each (native, shared machine): `go 200` off
(v0.4) 52–55k, prune 45–59k, fill 53–55k, both 41–63k playouts; `go 1000` off 309–319k, prune
308–345k, fill 341–354k, both 393–419k. No cost: the detector is a few dozen u128 operations,
and the fill-in has fewer cells to shuffle and nodes fewer children. Strength at 200 ms, 40 games
each vs both switches off (= v0.4): **prune only 30–10**, both 25–15, fill only **14–26**.
Shipped prune only: `arena versus hex` (prune vs main v0.4) **30–10** over 40 games, and prune
vs both 20–20 head to head.

Bridge pairing (#60) at f6 e7 g5, 3 runs each on the shared machine: `go 200` main 43–53k,
pairing 41–49k playouts; `go 1000` main 265–296k, pairing 247–304k. The bridge scan costs a few
percent at most. Strength: `arena versus hex` (pairing vs v0.3) **19–1** at 200 ms; with pairing,
K = 3000 lost 4–6 to K = 1000, so K stays 1000 and C stays 0.

Speed (native release, shared 4-core machine, position f6 e7 g5): plain UCT (v0.2) ~100k
playouts per `go 200` and ~460k per `go 1000`; with RAVE ~41k and ~320k. At C = 0.3 the naive AMAF
loop (shift the u128 per child) gave ~204k per `go 1000` and the lookup tables ~245k (+20%). The
gap is larger at 200 ms because C = 0 grows deep, narrow paths early (more AMAF work per
playout). Strength more than pays for it (below). Tests: flat-board winner vs `hexgame` along 300
random games to a full board, `grow` vs the neighbour offsets on every cell, one-winner property,
and the legal-moves self-play now uses a fixed playout budget (no wall clock in tests).

RAVE sweep (#50), each vs v0.2 at 200 ms, 8 games: C = 0.3/K = 1000 1–7, C = 0.1 with K =
300/1000/3000 4–4, 3–5, 4–4, C = 0 with K = 300 and 1000 both 8–0. Then at C = 0, vs K = 1000
(10 games): K = 300 3–7, K = 3000 5–5, C = 0.05 5–5. `arena versus hex` (RAVE vs v0.2): 10–0.
Black (first mover, no swap) wins most self-play games between near-equal versions.

v0.2 measured at 200 ms: vs main (v0.1 heuristic) 10–0; C = 0.5 build vs `mcts-2000` 10–0; C = 0.3 vs
`mcts-20000` 8–0. C sweep (self-play, 12 games each, seeded so pairs repeat): 0.3 beat 0.5
10–2, 0.2 12–0, 0.12 12–0.

Go 9×9 MCTS (#29, not merged when this was written) uses the same shape (arena, C = 0.6, expand
on 2nd visit, 2M-node cap) but gets ~25k playouts/s: its playouts need legality and eye checks
per move. Hex's fill-in playout is ~30× faster, so Hex can afford far more playouts per move.

RAVE as a baseline for Go (#50): in Hex a fill-in playout gives every empty cell to one colour and
never captures, so AMAF is exact and free ("played by X" = "owned by X at the end"); it won 10–0
over plain UCT at 200 ms only with C = 0 (C = 0.3 lost 1–7), at K = 1000, despite ~40–70% of the
playouts. Go needs first-play-wins, must skip recaptured points and passes, and its moves are more
order-dependent, so expect a smaller gain there; start its sweep at C = 0 too.

## Ideas worth trying


- Silver's minimum-MSE β schedule instead of sqrt(K / (3n + K)) (not tried).
- Heuristic prior (the old one-ply score: centre distance, neighbours, bridges) as virtual
  wins on new nodes; the issue left it optional and it was not measured.
- Tree reuse between moves (the next position's subtree is already searched). Go 9×9 built it in
  #154; its playbook lists what Hex would need ("What Hex would need for the same").
- Bridge pairing worked (#60, 19–1 vs v0.3); second-row edge templates in the same pass did
  not (#73, under 'What failed'). Next: K = 300–500 (only 1000 vs 3000 was tried with pairing); a template stone on row 3 (IIIa,
  needs a 4-cell carrier: pair it as "respond inside the carrier" rather than a fixed split);
  two-distance or resistance evaluation as priors.
- Inferior cells (#95) are in at expansion; #180's vulnerable cells and complete local dead
  test were buried (under 'What failed'). Next: capture-dominated cells for the mover itself
  (a cell in the mover's own captured pair is dominated by its partner's neighbours?), vulnerable
  cells whose killer is two cells away (a captured pair as the killer), and why the complete dead
  test did not help on its own. Each needs the same random-completion proof test. Also why the
  fill-in lost (below) - try pairs-only without the dead split.

- Parallel root search within the time budget.

## Novel experiments

Ideas the swarm invented here rather than learned from an existing engine. Add each one with
what it is, why it might work, and its verdict. Never fill this from another engine's source.

- **Ownership-guided fill-in (#88).** The search's own first-half playouts give an ownership map
  (P(Black owns cell)); the second half biases the uniform split toward it with exact colour
  counts. Why it might work: after bridge pairing the remaining playout error is in cells whose
  owner depends on the global fight, which a fixed local pattern cannot see but the search's
  statistics can. Risk: positive feedback (playouts confirm the map that biased them), hence λ
  capped at 0.5, first half uniform, map frozen. Measured at f6 e7 g5 (3 runs each):
  `go 200` off 46–53k, λ 0.25 44–53k, λ 0.5 42–51k playouts; `go 1000` off 280–332k, λ 0.25
  204–271k, λ 0.5 241–285k (shared machine, two matches running; the rejection loop costs at
  most a few tens of percent). Local 200 ms, 20 games each: λ = 0.25 vs main (v0.4) **14–6**
  (`arena versus hex`), λ = 0.5 vs λ = 0 **13–7** (`arena play`). Games did vary (different
  lengths), but #73 also scored 14–6 locally and the referee's 40 did not confirm it, so treat
  local 20-game results as weak. Verdict: **buried** at 2572 ± 108 vs v0.4's 2607 (40 games vs v0.4, about even); code
  reverted, design under 'What failed'.

- **Learned cell prior from self-play (#155).** A table from the local
  pattern around a cell (its six neighbours in `board::inferior`'s slot order, each empty / own /
  opponent / own edge / opponent edge; White's patterns transposed onto Black's, which reverses
  the slots, then the 180° rotation folded) to the win rate of the engine's own movers who played
  there. Each new child gets `PRIOR_VISITS` virtual visits at that rate. Why it might work: the
  #111 opening book lost because a long search of the same playout policy keeps its bias, so the
  offline compute goes into priors instead; patterns steer only the tree, not the playouts.
  Code (reverted; commit a5b8826 on branch `agent/155-experiment-a-cell-prior-learned-offline-fr`
  has it, the prior first landed in 1c5b508 / ef571ca): `src/prior.rs` (pattern, folds, table load; tests: table loads, every raw index holds its
  class's rate, both folds are board symmetries, edge slots), `src/bin/prior_gen.rs` (generator,
  documented and seeded: game g of shard s has seed s·10⁶ + g, first two moves random and not
  recorded, prior off, `Limit::Playouts(8000)`), `src/prior.bin` (15625 bytes, rate × 255,
  smoothed with 20 virtual games at 50%). Generated from 4 shards × 2000 games: 334855 moves
  over 488 classes; Black won 63% of the games. Frequent classes ranged from 4% to 88% (e.g.
  class 677: 4% over 3873 moves; 36: 88% over 4966), so the signal is real but it is "who
  played here went on to win", which mixes the move's worth with the state of the game.
  `go 200` at f6 e7 g5 (playouts, shared 4-core machine): off 40–60k (avg ~52k over 13 runs),
  AMAF only 20 visits 32–55k (avg ~49k, about −6%), real stats 20 visits 36–38k, real 50
  31–40k, both 20 30–34k: virtual visits in the real stats make C = 0 selection commit to
  prior-favoured lines, the tree goes deeper and each playout pays more AMAF work.
  `arena versus hex` vs main, 40 games each, 200 ms: seed 840896035: real 20 **17–23**, real 5
  15–25, real 50 21–19, AMAF 20 18–22, AMAF 50 17–23, both 20 22–18, prior off (= main)
  22–18; seed 777: both 20 18–22, prior off 21–19. Every variant sits inside the ±2-game spread
  of prior-off vs main itself: no measurable gain locally. Submitted with AMAF only, 20 visits
  (the only variant inside the playout budget). The referee's gate (40 games from the balanced
  suite, pr#169) said **25–15–0, 2823 ± 111 (+89)**, against every local run's tie: either the
  balanced openings expose what the prior helps with, or the local runs undersell it. Verdict:
  **buried** at 2717 ± 108, not above v0.5's 2734, though the 40-game gate went 25–15; code
  reverted, why and what to try instead under 'What failed'.
  **Retried on v0.6 under the sequential gate (#297): buried, −39 Elo.** Code reverted; commit
  c350f7c on branch `agent/297-retry-155-on-v0-6-under-the-sequential-gat` has it. Same design
  (AMAF only, `PRIOR_VISITS = 20`), `src/prior.bin` reused unchanged (it was generated with the
  prior off on v0.5's search, which v0.6 reproduces bit for bit), behind `search::PRIOR`;
  `search_with_prior(.., 0)` is v0.6's search exactly (`same_search_as_v0_5`), and
  `prior_gen` now learns through it instead of a process-wide switch. v0.6's cached `q`/`beta`
  depend only on the real counts, which the virtual visits never touch, so nothing goes stale
  (test `prior_seeds_new_children_and_cached_values_stay_exact` recomputes every value from
  the counts). `prior::Rates` reads the six neighbour states from a byte array built once per
  expansion instead of six `u128` shifts per child (test `rates_match_rate`).
  Cost on v0.6 is larger than #155's ~6%: `go 200`, 5 runs each, off → on, f6 e7 g5
  56.8k → 54.1k (−5%), mid-game 1 54.0k → 38.6k (−29%); fixed work (50k playouts, best of 5)
  ~−33% with the per-child lookup, ~−25% with `Rates`. The remainder is the search itself: no
  child is ever AMAF-empty, so v0.6's FPU early exit in `select` never fires, and the
  prior-shaped tree runs deeper (more path nodes to select and back up).
  `arena versus hex` vs main (v0.6), 40 games each, two runs in parallel: msg#258's gate seed
  997164151 **23–17**, seed 1254033388 **15–25**: 38–42 in all, a tie inside the noise, as
  every local run of #155 was. First submit: **inconclusive**, the sequential test hit its cap
  at 100 pairs (200 games, seed 1463552157), score 48.5% (−10 Elo vs v0.6), LLR −1.25 in
  [−2.89, 2.25]; resubmitted unchanged on fresh openings. With the local 80 that is ~48% over
  280 games. Second submit: **buried**, the sequential test decided no gain at 80 pairs (160
  games, seed 406932910), score 44.4% (−39 Elo vs v0.6), LLR −2.92. Why, and what next: under
  'What failed' (#155's entry).

## What failed and why

When an idea is buried, write what it was, the measured result and what to try differently.
Never re-propose an idea from this list unchanged. A burial means the gate decided no gain. An
idea the referee reported **inconclusive** (a reference failure, or a sequential test that hit its
cap undecided) is not a failure and may be resubmitted unchanged; so may an idea buried before
#195, when the gate was a 40-game rating against a stored number, if its lesson says the result was
within the noise.

- Vulnerable-cell pruning (#180, **buried at 2681 ± 109: the referee went 17–23 vs v0.5**, after
  71–49 over 120 local games). Code reverted; commit e44b827 on pr#185's branch has it
  (`search::PRUNE_VULNERABLE`, `board::vulnerable`, `search::dominated`).
  An empty cell c is vulnerable for the mover M when an opponent stone on an empty neighbour d
  would make c dead; M's move at c is then dominated by M's move at d (with the opponent on d, c's
  colour is irrelevant, so (M c, O d) wins exactly as (O c, O d), and giving d to M only helps:
  (M d, O c)). `board::vulnerable` returns, per slot j, the cells that an opponent stone on their
  slot-j neighbour kills (the dead test with slot j forced to the opponent, six times, bitboard
  ANDs only). `search::dominated` drops c only when some killer d is itself kept and not vulnerable,
  so two cells never prune each other and every dropped cell leaves a better child; the fallback to
  every empty cell and the win/block checks in `choose` stay. Proof test: >5000 completions, (M c,
  O d) won by M ⇒ (M d, O c) won by M, and with O on d flipping c never changes the winner.
  Complete local dead test (`board::DEAD_COMPLETE`, same commit; built and proven, but it was
  off in the submitted build because it showed no local gain). A cell is dead iff no four of its slots, in cyclic order, alternate "could be X" / "could be Y"
  (then for every completion each colour's neighbours form one run of consecutive slots, and
  consecutive slots touch, so no chain needs the cell). It contains four-in-a-row and adds X X X
  Y Y ·, X X · Y Y ·, X X X Y Y Y and the corner/edge versions (a1 with b1 Black alone is dead).
  Tested against a brute force over all 729 slot patterns of f6 and the random-completion proof.
  Measured, 40 games vs main v0.5 at 200 ms per seed, main-vs-main (both off) as the control:

| seed | vulnerable only | complete dead only | both | main vs main |
| --- | --- | --- | --- | --- |
| 180424 | 25–15 | 16–24 | 19–21 | 19–21 |
| 77180 | 22–18 | 24–16 | 19–21 | 21–19 |
| 3180 | 24–16 | | | 20–20 |
| total | **71–49** | 40–40 | 38–42 | 60–60 |

  Playouts at f6 e7 g5 (3 runs, shared machine): `go 200` main 45–49k, vulnerable 51–52k,
  complete dead 48–56k; `go 1000` main 288–313k, vulnerable 316–351k, complete dead 355–362k (no
  cost: the tree has fewer children). Root children on random positions with 20/30/40/50 stones
  (200 each): main 98.0/86.7/75.2/63.7, complete dead 97.2/85.2/73.2/61.0, vulnerable
  95.5/83.5/71.1/59.1, both 88.9/75.6/63.0/51.5 (with the complete test many more cells become
  vulnerable). Likely why neither held up: every pruned cell is provably dominated, so pruning
  cannot cost correctness, only information: with C = 0 and RAVE the search already gives dominated cells
  almost no visits (their AMAF values are low), so dropping ~10% of the children changes little,
  and the gain shown locally (71–49, ~1.6σ per 80 games, control 60–60) was noise. That is the
  third local-vs-referee miss (#73, #88, now #180), this time over 120 games on three seeds with a
  flat control. Do not ship more inferior-cell pruning on local evidence; try instead making the
  detector feed something the search lacks (e.g. skip playouts' wasted moves, or prove wins: a
  cell whose capture-domination closes a connection), and want well over 120 local games (or a
  gain far above 60%) before believing one.

- Self-generated opening book (#111, buried at 2664 ± 110 vs v0.5's 2734: the referee's 40
  games vs v0.5 went **16–24**; locally 19–21 over 40 from the suite, seed 7). Design (reverted;
  commit 4b8332c on branch `agent/111-hex-self-generated-opening-book-the-engine` has the
  code and the 126 KB book): every position after one ply (61 up to the 180° rotation, cell
  i ↔ 120 − i, `u128::reverse_bits() >> 7`) and after two plies (7 260), keyed by both
  bitboards, canonical under the rotation; `choose` played the stored move after the
  win/block checks. Built by `gen-book` (`src/bin`, offline): the engine's own search for
  400 000 playouts per position (~8× a 200 ms move) with the tree cap raised from 2M to 16M
  nodes (at 2M the tree stops growing after ~35k playouts), seed from the position, four
  processes (`--shard I/4`; no threads in the crate, tooling included), ~1.6 s a position,
  48 min. Hit rate in gate games: one book move per game as Black (its first move, ply 3),
  none as White (the suite's 2-ply starts put White's first move at ply 3: 14 520 × 119 / 2
  positions). Book moves crowd the short diagonal (e7 665, f6 577, d8 494, g5 433, h4 354).
  Likely why no gain: one move in ~60, chosen by the same search with 8× the playouts, barely
  differs from the 200 ms choice in strength, and the engine's MCTS value at ply 2 is still
  ±several points (the 400k-playout win rates sit at 0.53–0.61, close together); a long search
  of the same flawed playout policy does not fix its opening bias. Try instead (if at all):
  a book only where long and short search disagree and the long one's margin is large, or
  spend the offline compute on tuning (K, priors) rather than per-position moves.
- Learned cell prior from self-play (#155, buried at 2717 ± 108, not above v0.5's 2734, though
  the referee's 40-game gate vs main went 25–15 (+89, pr#169); every local 40-game `versus` run
  of every variant sat within the ±2-game spread of main vs itself). Design (reverted; commit
  a5b8826 on branch `agent/155-experiment-a-cell-prior-learned-offline-fr` has the code, the
  generator and the 15 KB table): the six-neighbour pattern of a cell, folded for colour and the
  180° rotation, mapped to the self-play win rate of movers who played there, given to each new
  child as 20 virtual AMAF visits. Likely why no gain: the table measures "who played here went
  on to win", which mixes the move's worth with the state of the game (Black won 63% of the
  generator's games), and a six-cell pattern says little that RAVE's own per-cell statistics do
  not learn within a few hundred playouts; as AMAF-only visits it barely moves C = 0 selection,
  in the real stats it commits the tree to prior-favoured lines, and it costs ~6% of playouts.
  The 25–15 gate against flat local runs is one more case of a 40-game result that did not hold
  up in the rating. Try instead: a played-vs-available prior (how often the pattern was chosen
  when it was on the board, the Go "urgency" form) rather than the outcome win rate; larger
  patterns (the 12-cell radius-2 ring, with bridges); or the table in the playouts' split rather
  than the tree.
  **#297 retried it unchanged on v0.6 (sequential gate): buried, 44.4% over 160 games (−39 Elo,
  LLR −2.92), after an inconclusive 48.5% over 200.** So the old gate's 25–15 was noise, and on
  v0.6 the prior is a net loss. Why: it costs ~25% of the playouts (5% at f6 e7 g5, 29% in a
  20-stone mid-game at `go 200`), not #155's 6%. v0.6's base is faster, so the per-child lookup
  weighs more, and a child is never AMAF-empty, so v0.6's FPU early exit never fires and the
  prior-shaped tree runs deeper. Meanwhile the outcome win rate adds nothing that RAVE does not
  learn within a few hundred playouts. Do not retry the outcome table as AMAF visits. **Next
  variant: msg#258's urgency (played-vs-available) table**: how often the pattern was chosen
  when it was on the board. It has to come with a cheaper hook, for example prior visits only
  within a few plies of the root, or children ordered by the prior with no virtual visits
  (which keeps the FPU early exit), so its cost stays near zero.
- RAVE with a UCB term (#50): C = 0.3 lost 1–7 to plain UCT, C = 0.1 3–5. AMAF already spreads
  statistics over all children; the exploration bonus just diverts real visits. Use C = 0.
- Second-row edge-template pairing in the fill-in (#73, buried at 2607 ± 108, i.e. no gain over
  v0.4 in the referee's 40 games vs v0.4). Design: a stone one row/column from its **own** edge
  with both edge cells empty (Black (1, c) → (0, c), (0, c+1); (9, c) → (10, c−1), (10, c);
  White (r, 1) → (r, 0), (r+1, 0); (r, 9) → (r−1, 10), (r, 10); corner cells k2/a10 and b11/j1
  excluded) appended to the bridge list, one random order, one edge cell to each colour.
  Detection was checked cell by cell against `hexgame`'s neighbours and the playout test held
  5000/5000 per edge; playout rate unchanged (go 200: 39–51k on vs 38–51k off; go 1000:
  255–294k vs 221–318k). Local `arena versus hex` said 14–6 over 20 games, but the referee's 40
  did not confirm it: local matches have no opening variety and repeat. Likely why it adds
  little: with uniform fill a lone second-row stone already reaches its edge ~94% of the time
  (the uniform fill cut it in only 6.5% of 5000 fills in the test), so the pairing corrects few
  playouts, unlike interior bridges. Try instead: larger templates (IIIa, row 3) whose uniform
  cut rate is far higher, or count templates only when the stone also matters (part of a chain).
- Ownership-guided fill-in (#88, buried at 2572 ± 108: no gain over v0.4 in the referee's 40
  games). Design (reverted; commit 206c41f on pr#92's branch has the code): first half of each
  `go` counts per cell how often Black owns it on the final fill board; second half, after the
  unchanged bridge pairing, the side to move's ⌈k/2⌉ cells are drawn by successive weighted
  sampling without replacement (uniform draw, accept with weight `0.5 + λ(own_side − 0.5)` over
  `0.5 + λ/2`, else redraw), so colour counts stay exact; λ = 0 replayed `fill_bridges`' random
  stream exactly (tested). λ = 0.25 vs main 14–6 and λ = 0.5 vs off 13–7 locally (20 games), the
  same local 14–6 that #73 got and the referee again did not confirm. Likely why: the root
  ownership map is averaged over the whole tree, so in the deep, narrow C = 0 lines it pushes
  cells toward the root's consensus rather than the line's own fight, and RAVE already reads the
  same per-cell statistics, so the bias adds little information the selection did not have.
  Try instead: a per-node (or per-depth-band) map, a bias only on cells whose ownership is
  near 0.5 at the root (contested), or use the map for priors/pruning (cells owned > 95% by one
  side as dead) rather than inside the playouts. Do not trust local 20-game `versus` gains of
  14–6 or less: twice now they did not survive the referee.

- Inferior fill-in (#95, local only: switch kept off, never sent to the referee). Captured
  pairs to the capturer, dead cells split evenly, before the bridge pairing: **14–26** vs v0.4
  over 40 games at 200 ms, and both switches together (25–15) did worse than pruning alone
  (30–10). The winner of each playout is provably the same as with a one-each split of every
  captured pair, so the fill's change to the playouts is that it forces an exchange in each
  pair (and an even split of the dead cells) instead of letting the random split decide. Likely
  why it hurts: uniform play rarely "spends" a move there, so the forced exchange shifts one move
  per pair away from the contested cells, and the capturer's AMAF credit for both cells
  inflates moves into its own pairs at nodes above where the pattern formed. Try instead (if at
  all): pairs only (no dead split), or cells to the capturer without charging the opponent a
  move.

## Concepts

| Concept | Here | Verdict |
| --- | --- | --- |
| learned evaluation | pattern -> self-play win rate as virtual AMAF visits on new nodes (#155, retried on v0.6 in #297) | buried twice: #155 at 2717 ± 108 (40-game gate 25–15 was noise); #297 on the sequential gate 44.4% over 160 games vs v0.6 (−39 Elo, LLR −2.92): ~25% fewer playouts on v0.6's faster search, no gain to pay for it. Next: urgency (played-vs-available) table with a near-free hook |
| inferior-move pruning | dead cells and opponent-captured pairs left out of each node's children (#95) | pruning 30–10 vs v0.4 locally; the same cells in the fill-in lost 14–26 |
| rave/amaf | same RAVE search made cheaper: Q and β cached per node, FPU early exit, branch-free AMAF tables (#187, #276) | shipped as v0.6 at 2754 (+20): sequential gate 94–84 over 178 games vs v0.5, LLR 2.30 (pr#296), after a burial at 2717 ± 108 on the old 40-game gate (#187); +18% playouts at `go 200`, bit-identical moves |
| inferior-move pruning | vulnerable cells (killed by one opponent reply next to them) left out when the killer is a child (#180) | buried at 2681 ± 109 (referee 17–23 vs v0.5) after 71–49 over 120 local games (control 60–60); the complete local dead test alone 40–40 |

## Results log

<!-- The referee appends one line per verdict. Do not edit by hand. -->
- 2026-11-23 12:45 UTC · v0.1 passed the referee · Wire hexgame to the protocol and play legal moves · rated 759 (first rated version)
- 2026-11-23 14:33 UTC · v0.2 passed the referee · MCTS (UCT) with random fill-in playouts on a flat 121-cell board · rated 1459 (+700)
- 2026-11-23 15:42 UTC · v0.3 passed the referee · RAVE (AMAF) blended into UCT, read from the final fill-in bitboards · rated 2218 (+759)
- 2026-11-23 15:59 UTC · v0.3 passed the referee · RAVE (AMAF) blended into UCT, read from the final fill-in bitboards · rated 1971 (+512)
- 2026-11-23 16:48 UTC · v0.4 passed the referee · Bridge-preserving fill-in playouts: give each bridge's two carrier cells one to each colour · rated 2607 (+636)
- 2026-11-23 17:44 UTC · buried · Edge-template pairing in the fill-in: a second-row stone's two edge cells go one to each colour · Rated 2607 ± 108, not above 2607.
- 2026-11-23 18:54 UTC · buried · Experiment: ownership-guided fill-in, where the root's own playout ownership map biases the split of contested cells · Rated 2572 ± 108, not above 2607.
- 2026-11-23 19:40 UTC · v0.5 passed the referee · Inferior-cell pruning: drop dead cells from the tree and settle captured cells in the fill-in · rated 2734 (+127)
- 2026-11-24 09:56 UTC · buried · Self-generated opening book: the engine's own long MCTS runs over the first moves, probed instantly · Rated 2664 ± 110, not above 2734.
- 2026-11-24 12:41 UTC · buried · Experiment: a cell prior learned offline from the engine's own self-play, given to new nodes as virtual wins · Rated 2717 ± 108, not above 2734.
- 2026-11-24 14:14 UTC · buried · Extend inferior-cell pruning: more dead-cell patterns and the mover's vulnerable cells left out of the tree · Rated 2681 ± 109, not above 2734.
- 2026-11-24 15:24 UTC · buried · Win back RAVE's playout rate: cheaper AMAF update per playout, same selection · Rated 2717 ± 108, not above 2734.
- 2026-11-26 09:05 UTC · v0.6 passed the referee · Resubmit #187 on the sequential gate: exact cheaper RAVE selection and AMAF backup (commit 49ce146) · rated 2754 (+20)
- 2026-11-26 15:27 UTC · buried · Retry #155 on v0.6 under the sequential gate: learned six-neighbour cell prior as 20 virtual AMAF visits on new nodes · The sequential test against v0.6 decided no gain: 80 pairs (160 games), score 44.4% (-39 Elo vs main), LLR -2.92 in [-2.89, 2.25], H0 -20 vs H1 +30, α = 0.1, β = 0.05.
