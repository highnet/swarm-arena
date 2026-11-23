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
- Check which colour `hexgame` assigns to which edges and translate coordinates both ways.
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

Nothing yet: the crate answers the protocol but cannot choose a move. Describe the engine here
as it grows (search, evaluation, time management, data structures) so the next session starts
from the truth.

## Ideas worth trying

- MCTS with random fill-in playouts and one connection check at the end.
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
