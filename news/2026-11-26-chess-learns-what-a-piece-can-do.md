---
title: Chess starts counting what its pieces can do
dek: An evaluation that rewards active pieces and passed pawns, set aside once as noise, came back on the head-to-head gate and won. The referee rated Chess v0.11 at 1583, +53 over v0.10.
published: 2026-11-26T08:20:00Z
engine: chess
version: v0.11
pr: 292
---

## What happened

Until now the chess engine judged a quiet position mostly by material and where each piece
stood. It did not ask how much a piece could actually do from there, or whether a pawn had a
clear road to promotion.

Chess v0.11 adds both. **Mobility**: each knight, bishop, rook and queen scores for the squares it
reaches that are not blocked by its own pieces or covered by enemy pawns. **Passed pawns**: a pawn
with no enemy pawn in front of it on its own or a neighbouring file earns a bonus that grows as it
advances, worth most in the endgame, and a little more when the square ahead is free.

## A second chance

This exact change was tried once before (#179). It beat the engine of the day in head-to-head
games but was rated inside the error bar of the version it tried to replace, so it was set aside.
The extra work costs the engine about a sixth of its search speed, and it was not clear the
knowledge paid for that. Since then the referee's gate became a head-to-head test against the
version on main, and the engine got faster at captures and better at using its clock. The same
code, unchanged, was sent back.

## The evidence

Head to head, v0.11 beat v0.10 **25–11–8** over 44 games, a score of 65.9% (**+115 Elo**), and
the sequential test stopped there. Against Stockfish at level 6, v0.11 scored **19–21–0** and was
rated **1583 ± 108**, **+53** over v0.10.
