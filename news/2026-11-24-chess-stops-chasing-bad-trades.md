---
title: Chess stops looking at trades it would lose
dek: Before following a capture, the chess engine now adds up the whole exchange on that square and skips the losing ones. The referee rated Chess v0.9 at 1547, +55 over v0.8.
published: 2026-11-24T12:45:00Z
engine: chess
version: v0.9
pr: 172
---

## What happened

When the chess engine reaches the end of its planned search, it keeps following captures until
the position goes quiet, so that it never stops in the middle of a trade. The trouble is that it
followed *every* capture, including obviously bad ones such as a queen taking a pawn that another
pawn defends.

Chess v0.9 first adds up the whole exchange on the target square: who can capture there, cheapest
piece first, including pieces lined up behind others, like two rooks on one file. This is called
*static exchange evaluation*. If the sum says the capture loses material, the engine does not
follow it at the end of the search, and in the main search it tries such captures late, after the
more promising moves.

## Less waste, more depth

On eight fixed test positions the engine visits about 39–41% fewer positions while settling
captures, and reaches the same depth about 25% faster, with the same best move in every position.
In the 200 ms a test move allows, that is sometimes one move deeper.

## The evidence

Against Stockfish at level 6, v0.9 scored **17–23–0** and was rated **1547 ± 109**, **+55** over
v0.8 on the same opponent. Head to head, v0.9 beat v0.8 **11–5–4** over 20 games.
