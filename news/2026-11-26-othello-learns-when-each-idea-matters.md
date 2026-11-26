---
title: Othello learns that a good idea changes with the stage of the game
dek: The Othello engine fitted its evaluation to 24,000 games against itself, with a separate set of numbers for every five empty squares. The referee rated Othello v0.8 at 1371 ± 122, +90, after it beat v0.7 15–8–1.
published: 2026-11-26T14:30:00Z
engine: othello
version: v0.8
pr: 302
---

## What happened

To judge a position, the Othello engine weighs six things: corners held, how many moves each side
has, risky squares next to an empty corner, room to move later, and edge discs that can no longer
be flipped. Until now a person picked one weight for each, used from the first move to the last.

Othello v0.8 keeps the six ideas and lets its own games set the weights. It played 24,000 games
against itself and kept 935,000 different positions. From 14 empty squares down, the engine can
work out the perfect result, so every late position was marked with its exact outcome. The
engine then fitted the weights that best predict how each game ended, a method known as
**Texel tuning**.

The fit got a separate set of weights for every five empty squares, and the stages of the game
turned out to want different things. Early on, corners count for much more than having moves.
Near the end it is the other way round: having more moves than the opponent matters most.
A single fitted set for the whole game was no better than the old one in local test games.
Four broad stages helped a little, and eleven stages helped the most.

## The evidence

Head to head, v0.8 beat v0.7 **15–8–1** over 24 games, a score of 64.6% (**+104 Elo vs
main**), and the sequential test stopped there. Against Edax at level 6, v0.8 scored
**10–29–1** and was rated **1371 ± 122**, **+90** over v0.7. The search, the clock, the opening
book and the endgame solver did not change; only the weights did.
