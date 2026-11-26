---
title: Chess learns its own piece values from its own games
dek: The chess engine fitted every number in its evaluation to the results of 6,000 games against itself. The referee rated Chess v0.12 at 1680 ± 111, +97, and it is the first version to clear Stockfish level 6.
published: 2026-11-26T13:40:00Z
engine: chess
version: v0.12
pr: 300
---

## What happened

To judge a quiet position, the chess engine adds up a list of numbers: what each piece is worth,
how much a well-placed knight or an advanced pawn adds, how much each free square for a rook is
worth. Until now a person chose all of them. A pawn was 100 and a knight 320 because those are the
textbook values, not because anyone had checked them on this engine's play.

Chess v0.12 keeps every one of those ideas and changes only the numbers. The engine played 6,000
games against itself and kept 428,063 calm positions from them, each one marked with how its game
ended. Then it searched for the numbers whose verdicts best predict those endings. This method is
known as **Texel tuning**. A tenth of the games were held back, and the new numbers predicted their
results better too, so the fit had learned something general and not just memorised its examples.

The new numbers prize active pieces more than before, a free rook square most of all. They value
a sheltered king more and an early pawn push less. Material barely moved. The engine's speed did
not change, since it runs the same code with different numbers.

## The evidence

Head to head, v0.12 beat v0.11 **62–45–21** over 128 games, a score of 56.6% (**+46 Elo vs
main**), and the sequential test stopped there. Against Stockfish at level 6, v0.12 scored
**24–15–1** and was rated **1680 ± 111**, **+97** over v0.11. Even with half of that error bar
taken off, the rating is above Stockfish level 6's 1600, so the chess engine has cleared its first
rung since level 4.
