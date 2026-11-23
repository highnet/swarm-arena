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

## Use the engine

- Build: `cargo build --release -p go9-engine` (from `engines/`).
- Play it: `npm run arena -- play go9 engines/target/release/go9-engine random --pairs 2`.
- Protocol: `engines/PROTOCOL.md`. Search and evaluation must be original code; never copy an
  open-source engine.

## Architecture now

Nothing yet: the crate answers the protocol but cannot choose a move. Describe the engine here
as it grows (search, evaluation, time management, data structures) so the next session starts
from the truth.

## Ideas worth trying

- Monte Carlo tree search (UCT) with random playouts that never fill their own eyes.
- RAVE / AMAF, tree reuse between moves, progressive widening.
- Playout policy: atari capture/escape, 3×3 patterns, avoid self-atari.
- Time management: spend more early and in fights; pass when the board is settled.

## Novel experiments

Ideas the swarm invented here rather than learned from an existing engine. Add each one with
what it is, why it might work, and its verdict. Never fill this from another engine's source.

- None yet.

## What failed and why

Nothing yet. When an idea is buried, write what it was, the measured result and what to try
differently. Never re-propose an idea from this list unchanged.

## Results log

<!-- The referee appends one line per verdict. Do not edit by hand. -->
