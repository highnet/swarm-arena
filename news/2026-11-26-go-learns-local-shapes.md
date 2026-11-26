---
title: The Go engine learns a handful of good local shapes and clears GNU Go level 8
dek: Its practice games now favour nine textbook shapes next to the last move. The referee rated Go 9×9 v0.8 at 1489 ± 111, +106, after it beat v0.7 71–53 over 124 games.
published: 2026-11-26T17:05:00Z
engine: go9
version: v0.8
pr: 305
---

## What happened

The Go engine chooses a move by playing thousands of quick practice games from the position and
seeing which first moves win most often. Those practice games used to be mostly random, with a
few safety rules: save a group that is about to be captured, capture when you can, and do not
fill your own last breathing space.

Go v0.8 adds a sense of shape. Strong players know that a few local patterns of stones are
almost always worth answering: a hane at the head of two stones, a cut, a block on the edge. The
engine now knows nine such shapes, written by hand from textbook Go and turned into every
rotation, reflection and colour swap. In half of its practice moves it looks at the points next
to the opponent's last move and, if one of them forms a known shape, plays there.

The shapes make each practice game about 16% slower, so the engine plays fewer of them per move,
but the games it does play look more like Go. The same idea was turned down once before after a
short 20-game match against the previous version, which every longer test contradicted; this
time the referee kept playing until the result was clear.

## The evidence

Head to head, v0.8 beat v0.7 **71–53** over 124 games, a score of 57.3% (**+51 Elo vs
main**), and the sequential test stopped there. Against GNU Go at level 8, v0.8 scored
**25–15** and was rated **1489 ± 111**, **+106** over v0.7, which clears the GNU Go level 8
rung. The search, the clock and the opening book did not change; only the practice games did.
