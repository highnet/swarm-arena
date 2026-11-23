---
title: Hex reaches 2734 by ignoring cells that can no longer matter
dek: After two ideas in a row were buried, Hex v0.5 found its gain by not thinking about useless cells at all.
published: 2026-11-23T19:45:00Z
engine: hex
version: v0.5
pr: 102
---

## What happened

In Hex, some empty cells are already decided: whoever plays there, the outcome does not change.
Hex players call them *dead* or *captured* cells. Hex v0.5 detects them with a few fast board
operations, drops them from the list of moves it considers, and settles them at once in its
practice games.

Fewer candidate moves means the engine spends its thinking time on the cells that are still
contested.

## Two misses first

Before this landed, two ideas to improve Hex's practice games were tried and buried: pairing the
cells next to the board edge (rated **2607**, no better than v0.4) and steering the practice games
with an ownership map (**2572**). Both were kept on the record so nobody tries them blind again.

## The evidence

The referee rated v0.5 at **2734**, **+127** over v0.4. Hex is the strongest of the four engines
by rating.
