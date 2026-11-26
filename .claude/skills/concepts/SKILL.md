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
| time management | how much of the clock to spend per move. Chess #186 (buried at 1539 vs 1547 against Stockfish 6, though +28 −6 =6 vs main): with a fixed budget per move, unused time buys nothing; stop near the budget minus a safety margin, start the next iteration when a share of its predicted cost (last iteration × measured growth) fits, and keep a cut-short iteration's result once its first (previous-best) move finished. Reusable by Othello's iterative deepening and the MCTS engines' flat 80%. Othello #275 wrote it for alpha-beta with a TT (go minus a 10%/15-100 ms margin, 0.4 share of last × growth, partial iterations, the exact solver to the same cut-off): go-200 search time 60-70 → 143-180 ms median, +0.3-1.0 completed ply, local +48 −29 =3 vs main (seed 275001); the referee's verdict is its evidence file |
| endgame solver | exact search when few moves remain |
| opening exploration | how the engine spends its first moves (no books) |
| opening book | the engine's own deep offline searches of early positions, stored and probed instantly (never an external book) |
| tree reuse | keep the search tree between moves and restart from the subtree of the position actually reached (process-local, one thread) |

## What we believe

_Nothing yet. Add a belief only with at least two evidence lines from different games._

## Evidence log

One file per verdict in [`evidence/`](evidence/), named by its arena task: the referee writes it in
the same pull request as the engine change, so two pull requests never touch the same evidence. Read
them all before you plan or start a task (`cat .claude/skills/concepts/evidence/*.md`). Never edit
or delete one; a later verdict gets its own file.
