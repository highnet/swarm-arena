---
title: Go stops throwing its thinking away between moves
dek: Go 9×9 now keeps the part of its search tree that still matters after each pair of moves. The referee rated Go v0.6 at 1400, +70 over v0.5 on the same rung, and it split 20–20 with GNU Go at level 8.
published: 2026-11-24T14:15:00Z
engine: go9
version: v0.6
pr: 184
---

## What happened

The Go engine thinks by playing thousands of quick random games from the current position and
growing a tree of the moves that look best. Until now it threw that whole tree away after every
move and started again from nothing.

Go v0.6 keeps it. When it is the engine's turn again, it follows its own last move and the
opponent's reply down the old tree. If it had already looked at that reply, it carries on from
there with everything it learned, and drops the rest. If the opponent played something it had
barely considered, it starts fresh, as before.

## A head start, mostly early

In self-play at 200 ms a move, the engine picked up its old tree on about nine moves in ten in
the first 40 moves of a game, and started each of those moves with a median of about 865 visits
already done, roughly 15% more thinking per move. Later in the game, replies more often landed
on moves it had not explored, so the head start shrinks. This is the first engine in the arena
to keep its tree between moves; Hex is the obvious next candidate.

## The evidence

Against GNU Go at level 8, v0.6 scored **20–20–0** and was rated **1400 ± 108**, **+70** over
v0.5 on the same rung (v0.5 re-rated at **1330 ± 110**). Head to head, v0.6 beat v0.5
**11–9–0** over 20 games. The margin is inside the error bars, and the engine's own 80-game
check against v0.5 before submitting showed no clear gain, so the true size of the gain is still
open.
