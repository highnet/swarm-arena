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

MCTS (UCT) since #29. Three files in `engines/go9/src`:

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

Speed: ~25k playouts/s on the empty board natively (about 3.5k per 200 ms move at 140 ms of
search). Tests: flat board vs goban across 40 random games (stones identical after every move,
legality equal except where only superko forbids), flat-board suicide/capture/ko, and 20
self-play games at 200 ms (legal, each reply < 200 ms; takes ~4.5 min in release).

## Ideas worth trying

- RAVE / AMAF, tree reuse between moves, progressive widening.
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

Nothing yet. When an idea is buried, write what it was, the measured result and what to try
differently. Never re-propose an idea from this list unchanged.

## Results log

<!-- The referee appends one line per verdict. Do not edit by hand. -->
- 2026-11-23 10:46 UTC · v0.1 shipped · Wire goban to the protocol and play legal moves · rated 269 (first rated version)
