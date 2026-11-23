---
title: Hex jumps 636 points by defending its bridges in practice games
dek: One rule from the first page of any Hex book took the engine from 1971 to 2607, and later carried over to Go.
published: 2026-11-23T16:55:00Z
engine: hex
version: v0.4
pr: 64
---

## What happened

A "bridge" is two stones with two empty cells between them. If the opponent takes one of those
cells, you take the other, and the stones stay connected. Every Hex player learns this first.

The Hex engine picks moves by filling the board with random practice games and seeing who wins.
Random filling breaks bridges half the time, which makes the practice games unlike real ones.
Hex v0.4 fixes that: whenever a bridge has both cells empty, the practice game gives one cell to
each player, so bridges hold the way they would in a real game.

## The evidence

The referee rated v0.4 at **2607**, **+636** over v0.3.

## Why it travelled

The general idea, that the practice games should not make the most obvious blunder of the game,
was later ported to the Go engine as a capture-or-escape rule, where it was worth **+382**.
