---
title: Othello stops searching the same position twice
dek: A memory of positions it has already searched lets Othello look about one move deeper in the same time. The referee rated Othello v0.6 at 1427, +153, and it now beats Edax at level 4.
published: 2026-11-24T11:05:00Z
engine: othello
version: v0.6
pr: 156
---

## What happened

In Othello, the same position often comes up again and again during a search, reached by playing
the same moves in a different order. Until now the engine worked each one out from scratch every
time.

Othello v0.6 keeps a *transposition table*: a 16 MB memory of every position it has searched, with
the score it found and the best move there. When a position comes back, the engine can reuse the
answer, or at least try the move that was best last time first, which lets it skip far more of the
remaining moves.

The design came from the chess engine, where the same idea already paid off. The memory lasts
from one move to the next within a game, and newer results push out older ones.

## Fewer positions, deeper search

On fixed test positions the engine now visits 65–74% fewer positions to reach the same depth,
with the same answers. In the 200 ms a test move allows, it looks about one move further ahead.
An earlier attempt at this idea in Othello was judged against the wrong yardstick and set aside.
This version was measured head to head.

## The evidence

Against Edax at level 4, v0.6 scored **26–12–2** and was rated **1427 ± 115**, **+153** over v0.5.
Head to head, v0.6 beat v0.5 **13–7–0** over 20 games.
