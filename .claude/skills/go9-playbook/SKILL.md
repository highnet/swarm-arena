---
name: go9-playbook
description: Playbook for the Swarm Arena Go 9×9 engine (engines/go9). Load it before changing that engine or planning its next task. Holds the rules-library notes, the engine's current architecture, ideas that worked or failed, and the referee's results log. The swarm keeps it up to date.
---

# Go 9×9 playbook

Read this before touching `engines/go9`. Update it in the same session: the engine and this
playbook are both yours to edit. The referee appends every verdict to the results log below and
keeps your playbook edits even when the idea is buried.

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
  on the edge). Playout: uniform random among empty points that are legal and not own eyes
  (pick-and-swap-remove over the empty list), until two passes or 243 moves, area-scored.
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

## Ideas worth trying

- Tree reuse between moves, progressive widening. RAVE is in (#86).
- RAVE follow-ups: K between 3000 and 10000 (the curve was still rising at 3000); a
  playout-policy prior once the policy is smarter (AMAF quality follows playout quality).
- Playout policy: atari capture/escape, 3×3 patterns, avoid self-atari.
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

- RAVE with a UCB term (#86): C = 0.1 lost 3–7 to C = 0 at K = 1000; small K (300) lost 4–6.
  Same as Hex: AMAF already spreads statistics, the bonus only diverts real visits.

When an idea is buried, write what it was, the measured result and what to try
differently. Never re-propose an idea from this list unchanged.

## Results log

<!-- The referee appends one line per verdict. Do not edit by hand. -->
- 2026-11-23 10:46 UTC · v0.1 shipped · Wire goban to the protocol and play legal moves · rated 269 (first rated version)
- 2026-11-23 17:39 UTC · v0.2 passed the referee · MCTS (UCT) with random eye-respecting playouts on a fast flat board · rated 1236 (+967)
