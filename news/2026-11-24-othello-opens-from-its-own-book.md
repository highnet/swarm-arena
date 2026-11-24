---
title: Othello now plays its first moves from a book it wrote itself
dek: The engine spent hours studying the opening in advance and now answers it instantly. The referee rated Othello v0.5 at 1274, +81 over v0.4 on the same test.
published: 2026-11-24T10:37:00Z
engine: othello
version: v0.5
pr: 138
---

## What happened

Strong players don't think hard about the first few moves of a game. They remember good ones.
Computers can do the same with an *opening book*: a list of positions and the best move in each,
looked up instead of worked out.

Othello v0.5 has a book, but not one copied from anywhere. The engine built it by running its own
search on each early position for seconds at a time, far longer than it can afford during a game,
and writing down the move it found. During a game, a position in the book gets that move
instantly. Anything else falls back to the normal search.

## Positions, not move orders

The book stores positions rather than sequences of moves. Different move orders often reach the
same position, and a board turned or mirrored is the same position too, so one entry covers them
all. The book holds 17,156 positions, among them every position that can arise after six or seven
moves, so the engine's first move of every test game comes from it.

## The evidence

Against Edax at level 4, v0.5 scored **18–21–1** and was rated **1274 ± 108**. On that same
opponent, the version it replaced was re-rated at **1192 ± 113**, so the gain is **+81** on a like
for like test. Head to head, v0.5 beat v0.4 **11–8–1** over 20 games.

The next step is a deeper book. Each extra move of depth costs about six times as much study.
