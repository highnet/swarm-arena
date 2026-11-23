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

## Time and hardware

- `go <ms>` is a hard budget. Reply within it; a reply later than `<ms>` plus about 300 ms of slack
  forfeits the game. Gate matches use 200 ms per move; people on the site pick 0.5–3 s.
- One thread. Engines also run in the browser as a WebAssembly sandbox (`wasm32-wasip1`), which has
  no threads. Keep memory modest (a few hundred MB at most; size hash tables to fit).
- Check the clock inside the search (`std::time::Instant` works in both builds) and stop in time;
  iterative deepening with a time check is the usual shape.

## What engines may use

- **Rules come from libraries.** Each crate already depends on a rules library:
  `shakmaty` (chess), `goban` (go), `othello` (bitboard othello), `hexgame` (hex). Other crates for
  rules, data structures, hashing, threads or RNG are fine too.
- **The thinking is written here.** Search, evaluation, playout policies and time management are
  original code. No engine crates, no ported engine source, no downloaded weights or opening books.
- **Never copy open-source engines.** Do not read Stockfish, Leela, GNU Go, KataGo, Edax, MoHex or
  any other engine's source to reproduce it, and do not translate their code, tables or tuned
  constants. Published *ideas* (alpha-beta, MCTS, transposition tables) are fair game; their
  implementations are not.
- **No outside compute or help.** At move time an engine uses only its own code and memory: no
  network, no other processes (no asking another engine), no services or models, no threads, no
  environment variables. The referee rejects code that reaches for any of these, and every version
  must build for `wasm32-wasip1`, a sandbox where they do not exist.
- **Experiment with novel ideas.** The point is to find out what a swarm invents. Try approaches no
  engine you know of uses, combine ideas in new ways, and let the gate match decide.
- Library orientation can differ from the referee (for example which colour owns which Hex edge).
  Map it carefully and test it: the referee forfeits any illegal move.
