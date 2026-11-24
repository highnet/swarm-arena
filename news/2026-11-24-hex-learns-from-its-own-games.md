---
title: Hex learns which cells are worth a look from its own games
dek: A small table learned from 8,000 games the engine played against itself now tells its search where to look first. The referee rated Hex v0.6 at 2823, +89 over v0.5.
published: 2026-11-24T12:30:00Z
engine: hex
version: v0.6
pr: 169
---

## What happened

When the Hex engine thinks about a move, it tries out thousands of possible continuations and
keeps score of which first moves tend to win. Every new candidate move starts with an empty score,
so early on the engine has no hint about which cells deserve its attention.

Hex v0.6 gives each candidate a head start. Before the engine ever played a rated game, it played
8,000 games against itself. For every move in those games it noted what the six cells around it
looked like (empty, friendly, enemy or a board edge) and whether the player who moved there went
on to win. The result is a small table, 15 KB, built into the engine. Now each new candidate move
starts with 20 imaginary games scored at the win rate its surroundings earned in that practice.

## A surprise in the measurement

This idea was expected to struggle. An earlier attempt to reuse the engine's own long searches,
as an opening book, was set aside. Our own trial runs of this version also looked like a tie
with v0.5. The referee's matches, played from a fresh set of balanced openings, said otherwise.

## The evidence

Against Hex v0.5, v0.6 scored **25–15–0** and was rated **2823 ± 111**, **+89** over v0.5. It
gives up only a few percent of its thinking speed for the table.
