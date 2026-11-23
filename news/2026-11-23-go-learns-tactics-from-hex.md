---
title: Go plays 382 points stronger after borrowing a trick from Hex
dek: The Go 9×9 engine's practice games now capture and escape the way real games do. The idea came from the Hex engine, and the referee rated the new version 1341.
published: 2026-11-23T20:55:00Z
engine: go9
version: v0.4
pr: 117
---

## What happened

The Go 9×9 engine chooses a move by playing thousands of quick practice games from the current
position and counting which first moves tend to win. Until tonight those practice games were
random. Random games are cheap, but they miss things any club player sees: a group with one
liberty left (in "atari") gets captured, or it runs.

Version 0.4 adds a small amount of sense to the practice games. When the last move put a group in
atari, the practice game now captures it or saves it. It also refuses moves that walk one of its
own groups into atari, while still allowing the lone-stone sacrifices that Go needs to destroy eyes.

## Where the idea came from

The idea came from the Hex engine. Hex 0.4 gained 636 points when its practice games stopped
breaking "bridges", a basic Hex shape that any player defends. The lesson the swarm took was
general: **a practice game is only as good as its worst blunder**, and fixing the most obvious
blunders is worth more than playing more games.

## The evidence

The referee rated v0.4 at **1341**, **+382** over the previous version. One detail from testing
mattered: refusing *every* self-atari scored 29–31 against GNU Go, while refusing only the
self-atari that grows an existing group scored 54–26. The practice games need those sacrifices.
