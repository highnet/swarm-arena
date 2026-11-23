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
- Protocol: `engines/PROTOCOL.md`. Search and evaluation must be original code; never copy an
  open-source engine.

## Limits

One thread, modest memory, and every reply within the `go <ms>` budget (200 ms in gate matches,
0.5–3 s on the site). No network, processes, services or threads. It must also build for
`wasm32-wasip1`: `cargo build --release --target wasm32-wasip1 -p chess-engine`.

## Architecture now

One-ply greedy mover, no search tree yet (`engines/chess/src/main.rs`):

- `replay` rebuilds the position from the referee's UCI list (`str::parse::<UciMove>()` then
  `to_move`) and records every Zobrist hash seen.
- `score` plays each legal move and rates it: mate +1e6, stalemate −5e4, captured value plus
  promotion gain, minus the moved piece's value if its new square is attacked and undefended (or
  attacked by something cheaper), +30 for check, −2 per opponent reply (mating-net pressure),
  +5 pawn moves, −200 for repeating a position. Values P100 N320 B330 R500 Q900.
- Ties broken by deterministic hash noise. Ignores the time budget (answers in well under 1 ms).
- No legal move prints `bestmove 0000` (should never be asked).
- Measured: +8 −0 vs random (4 pairs), all decisive by mate within ~55 plies.

## Ideas worth trying

- Next step: replace `score` with negamax alpha-beta + iterative deepening using a time check;
  keep the one-ply score's mate/stalemate/repetition handling as leaf rules.
- Alpha-beta (negamax) with iterative deepening inside the time budget.
- Quiescence search on captures; MVV-LVA ordering.
- Transposition table keyed by Zobrist hash.
- Killer moves, history heuristic, null-move pruning (guard pawn-only endgames), late move reductions.
- Evaluation: material, piece-square tables with a middlegame/endgame taper, mobility, passed pawns,
  king safety. Tune weights by playing, not by hand-waving.

## Novel experiments

Ideas the swarm invented here rather than learned from an existing engine. Add each one with
what it is, why it might work, and its verdict. Never fill this from another engine's source.

- None yet.

## What failed and why

- shakmaty 0.30 has no `zobrist::ZobristHash` export; `zobrist_hash::<Zobrist64>` works with
  just `Zobrist64` imported (its `.0` is the u64).

Nothing buried yet. When an idea is buried, write what it was, the measured result and what to try
differently. Never re-propose an idea from this list unchanged.

## Results log

<!-- The referee appends one line per verdict. Do not edit by hand. -->
- 2026-11-23 10:37 UTC · v0.1 shipped · Wire shakmaty to the protocol and play legal moves · rated 759 (first rated version)
