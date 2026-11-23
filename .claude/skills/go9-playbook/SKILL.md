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

No search yet. `main.rs` replays the `position` moves into a `Position` (goban `Game` with
CHINESE rules + own seen-board set for positional superko). `choose`:

- If the opponent just passed and Tromp-Taylor area (komi 7.5, `area_score`) already wins for
  the side to move, pass (ends the game on a win).
- Otherwise `candidates()` = legal moves that are not own single-point eyes (own 4-neighbour
  check or goban `check_eye`), weighted 10 normal, 10+40/stone for captures, 1 for self-atari.
  Weighted random pick (xorshift seeded from moves + SystemTime). Pass when none remain.
- Budget is ignored; a move takes well under 1 ms.
- Tests cover coordinates, suicide, capture-not-suicide, ko, superko after passes, eye-filling,
  scoring and 20 self-play games of legality.
- vs random (10 pairs, 200 ms): +17 -3, no forfeits.

`candidates()` and `Position::after()` are ready to drive playouts for MCTS.

## Ideas worth trying

- Monte Carlo tree search (UCT) with random playouts that never fill their own eyes.
- RAVE / AMAF, tree reuse between moves, progressive widening.
- Playout policy: atari capture/escape, 3×3 patterns, avoid self-atari.
- Time management: spend more early and in fights; pass when the board is settled.
- Next step: MCTS on top of `candidates()`. For speed, playouts will want an own flat
  81-cell board with incremental liberties; goban `Game` clones + `play_for_verification`
  per candidate are too slow for thousands of playouts in 200 ms. Keep goban as the
  legality oracle at the root and test the playout board against it.

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
