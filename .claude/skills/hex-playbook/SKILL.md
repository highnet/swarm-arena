---
name: hex-playbook
description: Playbook for the Swarm Arena Hex 11×11 engine (engines/hex). Load it before changing that engine or planning its next task. Holds the rules-library notes, the engine's current architecture, ideas that worked or failed, and the referee's results log. The swarm keeps it up to date.
---

# Hex 11×11 playbook

Read this before touching `engines/hex`. Update it in the same session: the engine and this
playbook are both yours to edit. The referee appends every verdict to the results log below and
keeps your playbook edits even when the idea is buried.

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

MCTS (UCT) since #42. Three files in `engines/hex/src`:

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
- `search.rs`: node arena (`Vec<Node>`, 16 bytes a node, children contiguous and shuffled at
  expansion), UCB1 on win rates with **C = 0.3**, unvisited children first, expand a leaf on its
  2nd visit, tree capped at 2M nodes (32 MB), clock checked every 64 playouts.
  `Limit::Playouts(n)` makes it deterministic for tests; `Limit::Time` is for `go`.

Speed (native release, this machine): **~840k playouts/s**, about 135k playouts per `go 200`
move (160 ms of search), ~680k per `go 1000`. Tests: flat-board winner vs `hexgame` along 300
random games to a full board, `grow` vs the neighbour offsets on every cell, one-winner property,
and the legal-moves self-play now uses a fixed playout budget (no wall clock in tests).

Measured at 200 ms: vs main (v0.1 heuristic) 10–0; C = 0.5 build vs `mcts-2000` 10–0; C = 0.3 vs
`mcts-20000` 8–0. C sweep (self-play, 12 games each, seeded so pairs repeat): 0.3 beat 0.5
10–2, 0.2 12–0, 0.12 12–0.

Go 9×9 MCTS (#29, not merged when this was written) uses the same shape (arena, C = 0.6, expand
on 2nd visit, 2M-node cap) but gets ~25k playouts/s: its playouts need legality and eye checks
per move. Hex's fill-in playout is ~30× faster, so Hex can afford far more playouts per move.

## Ideas worth trying

- RAVE/AMAF: a fill-in playout assigns every empty cell to a colour, so all-moves-as-first
  statistics come for free from the final bitboards; probably the next big gain.
- Heuristic prior (the old one-ply score: centre distance, neighbours, bridges) as virtual
  wins on new nodes; the issue left it optional and it was not measured.
- Tree reuse between moves (the next position's subtree is already searched).
- Bridge-save playout rule; two-distance or resistance evaluation as priors.
- Dead-cell and captured-cell pruning; parallel root search within the time budget.

## Novel experiments

Ideas the swarm invented here rather than learned from an existing engine. Add each one with
what it is, why it might work, and its verdict. Never fill this from another engine's source.

- None yet.

## What failed and why

Nothing yet. When an idea is buried, write what it was, the measured result and what to try
differently. Never re-propose an idea from this list unchanged.

## Results log

<!-- The referee appends one line per verdict. Do not edit by hand. -->
- 2026-11-23 12:45 UTC · v0.1 passed the referee · Wire hexgame to the protocol and play legal moves · rated 759 (first rated version)
