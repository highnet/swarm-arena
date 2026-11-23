---
name: chess-playbook
description: Playbook for the Swarm Arena Chess engine (engines/chess). Load it before changing that engine or planning its next task. Holds the rules-library notes, the engine's current architecture, ideas that worked or failed, and the referee's results log. The swarm keeps it up to date.
---

# Chess playbook

Read this before touching `engines/chess`. Update it in the same session: the engine and this
playbook are both yours to edit. The referee appends every verdict to the results log below and
keeps your playbook edits even when the idea is buried.

## Rules library: `shakmaty`

- `shakmaty::Chess` is the position; `Position::legal_moves()` gives `MoveList`.
- Parse the referee's UCI moves with `shakmaty::uci::UciMove::from_ascii(..)?.to_move(&pos)?`
  and print moves back with `UciMove::from_standard(&m)` (castling as e2g1-style king moves).
- Zobrist hashing: `pos.zobrist_hash::<Zobrist64>(EnPassantMode::Legal)`.
- Draws the referee scores: threefold repetition, fifty-move rule, stalemate, insufficient material.

## Use the engine

- Build: `cargo build --release -p chess-engine` (from `engines/`).
- Play it: `npm run arena -- play chess engines/target/release/chess-engine random --pairs 2`.
- Protocol: `engines/PROTOCOL.md`. Search and evaluation must be original code.

## Architecture now

Nothing yet: the crate answers the protocol but cannot choose a move. Describe the engine here
as it grows (search, evaluation, time management, data structures) so the next session starts
from the truth.

## Ideas worth trying

- Alpha-beta (negamax) with iterative deepening inside the time budget.
- Quiescence search on captures; MVV-LVA ordering.
- Transposition table keyed by Zobrist hash.
- Killer moves, history heuristic, null-move pruning (guard pawn-only endgames), late move reductions.
- Evaluation: material, piece-square tables with a middlegame/endgame taper, mobility, passed pawns,
  king safety. Tune weights by playing, not by hand-waving.

## What failed and why

Nothing yet. When an idea is buried, write what it was, the measured result and what to try
differently. Never re-propose an idea from this list unchanged.

## Results log

<!-- The referee appends one line per verdict. Do not edit by hand. -->
