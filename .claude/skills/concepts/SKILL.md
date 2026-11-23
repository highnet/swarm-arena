---
name: concepts
description: Cross-game concepts for Swarm Arena. Load before planning or claiming any engine task. The four games (chess, Go 9×9, Othello, Hex) exist to find general ideas that make each engine better; this is the evidence of which ideas transferred, which did not, and why.
---

# Cross-game concepts

The swarm builds four engines so that ideas can be tested more than once. A concept that gains Elo
in one game is a hypothesis for the other three; a concept that fails in one game is a warning, not a
verdict. The goal is a shared understanding of game-playing, not four separate bags of tricks.

## How to use this

- **Strategist:** name the `concept` of every task. Prefer porting a concept that already gained
  Elo somewhere to an engine that has not tried it. Note what should differ between games
  (branching factor, game length, how tactical it is, whether evaluation is cheap).
- **Worker:** before you start, read every evidence line for your task's concept. Reuse the idea, not
  the code: each engine implements it in its own crate, for its own rules library.
- **Everyone:** the referee writes one evidence file per verdict (see the evidence log). Write the *why* in the game's
  playbook, and if you see a pattern across games, add it under "What we believe" with the
  evidence lines it rests on.

## Concept vocabulary

Use these names so evidence lines up; add a new one when nothing fits.

| Concept | Idea |
| --- | --- |
| alpha-beta | depth-limited minimax with pruning |
| iterative deepening | search depth 1, 2, 3… until the clock says stop |
| move ordering | try likely-best moves first (captures, killers, history) |
| transposition table | remember positions already searched |
| quiescence | extend search through unstable (capturing) lines |
| mcts | Monte Carlo tree search with UCT |
| playout policy | smarter-than-random simulations for MCTS |
| rave/amaf | share move statistics across a playout |
| evaluation features | hand-built terms: material, mobility, corners, territory, connectivity |
| learned evaluation | weights tuned here, by self-play, from the engine's own games |
| time management | how much of the clock to spend per move |
| endgame solver | exact search when few moves remain |
| opening exploration | how the engine spends its first moves (no books) |

## What we believe

_Nothing yet. Add a belief only with at least two evidence lines from different games._

## Evidence log

One file per verdict in [`evidence/`](evidence/), named by its arena task: the referee writes it in
the same pull request as the engine change, so two pull requests never touch the same evidence. Read
them all before you plan or start a task (`cat .claude/skills/concepts/evidence/*.md`). Never edit
or delete one; a later verdict gets its own file.
