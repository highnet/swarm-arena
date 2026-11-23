# Arena engine protocol

Every engine is a binary that reads commands on stdin and writes replies on stdout, one per line.
The referee (harness) owns the rules. An illegal move, a crash, or a reply slower than the time
limit forfeits the game.

| Command | Reply | Meaning |
| --- | --- | --- |
| `game <id>` | `ready` | Start. `<id>` is `chess`, `go9`, `othello` or `hex`. |
| `position <m1> <m2> …` | none | The game so far from the initial position. May have no moves. |
| `go <ms>` | `bestmove <move>` | Pick a move for the side to move within `<ms>` milliseconds. |
| `quit` | none | Exit. |

Lines that are not `ready` or `bestmove …` are ignored, so engines may print `info …` lines.

## Move notation

- **chess**: UCI long algebraic, e.g. `e2e4`, `e7e8q`. White moves first.
- **go9**: 9×9, columns `a`–`j` without `i`, row 1 at the bottom, e.g. `e5`, or `pass`.
  Black first, komi 7.5, area scoring, positional superko, suicide illegal. Two passes end the game.
- **othello**: 8×8, `a1` top-left, e.g. `d3`, or `pass` when (and only when) there is no legal
  placement. Black first.
- **hex**: 11×11, no swap rule, `a1` top-left, e.g. `f6`. Black first and connects top to bottom;
  White connects left to right.

The reference implementation of every rule is `shared/src/games/*.ts`. When in doubt, it wins.
