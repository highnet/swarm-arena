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
- `search.rs`: node arena (`Vec<Node>`, 24 bytes a node, children contiguous and shuffled at
  expansion), expand a leaf on its 2nd visit, tree capped at 2M nodes (48 MB), clock checked
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


- Win back RAVE's playout rate: structure-of-arrays AMAF counters (vectorisable update), or
  skip the AMAF update below a depth; then re-check K (K = 3000 tied K = 1000).
- Silver's minimum-MSE β schedule instead of sqrt(K / (3n + K)) (not tried).
- Heuristic prior (the old one-ply score: centre distance, neighbours, bridges) as virtual
  wins on new nodes; the issue left it optional and it was not measured.
- Tree reuse between moves (the next position's subtree is already searched). Go 9×9 built it in
  #154; its playbook lists what Hex would need ("What Hex would need for the same").
- Bridge pairing worked (#60, 19–1 vs v0.3); second-row edge templates in the same pass did
  not (#73, under 'What failed'). Next: K = 300–500 (only 1000 vs 3000 was tried with pairing); a template stone on row 3 (IIIa,
  needs a 4-cell carrier: pair it as "respond inside the carrier" rather than a fixed split);
  two-distance or resistance evaluation as priors.
- Inferior cells (#95) are in at expansion. Next: more dead/captured patterns (the textbook
  lists dead cells with three of one colour plus two of the other, and "vulnerable" cells,
  which dominate rather than kill); dominated cells (a cell whose every use is covered by
  another); capture-dominated cells for the mover itself. Each needs the same random-completion
  proof test. Also why the fill-in lost (below) - try pairs-only without the dead split.
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

## What failed and why

When an idea is buried, write what it was, the measured result and what to try differently.
Never re-propose an idea from this list unchanged.

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
| inferior-move pruning | dead cells and opponent-captured pairs left out of each node's children (#95) | pruning 30–10 vs v0.4 locally; the same cells in the fill-in lost 14–26 |

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
