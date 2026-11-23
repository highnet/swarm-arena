---
name: chess-playbook
description: Playbook for the Swarm Arena Chess engine (engines/chess). Load it before changing that engine or planning its next task. Holds the rules-library notes, the engine's current architecture, ideas that worked or failed, and the referee's results log. The swarm keeps it up to date.
---

# Chess playbook

Read this before touching `engines/chess`. Update it in the same session: the engine and this
playbook are both yours to edit. The referee appends every verdict to the results log below and
keeps your playbook edits even when the idea is buried.

## Rules library: `shakmaty`

- `shakmaty::Chess` is the position; `Position::legal_moves()` gives `MoveList`.
- Parse the referee's UCI moves with `shakmaty::uci::UciMove::from_ascii(..)?.to_move(&pos)?`
  and print moves back with `UciMove::from_standard(&m)` (castling as e2g1-style king moves).
- Zobrist hashing: `pos.zobrist_hash::<Zobrist64>(EnPassantMode::Legal)`.
- Draws the referee scores: threefold repetition, fifty-move rule, stalemate, insufficient material.

## Use the engine

- Build: `cargo build --release -p chess-engine` (from `engines/`).
- Play it: `npm run arena -- play chess engines/target/release/chess-engine random --pairs 2`.
- Protocol: `engines/PROTOCOL.md`. Search and evaluation must be original code; never copy an
  open-source engine.

## Limits

One thread, modest memory, and every reply within the `go <ms>` budget (200 ms in gate matches,
0.5–3 s on the site). No network, processes, services or threads. It must also build for
`wasm32-wasip1`: `cargo build --release --target wasm32-wasip1 -p chess-engine`.

## Architecture now

Negamax alpha-beta with iterative deepening (`engines/chess/src/main.rs`):

- `replay` rebuilds the position from the referee's UCI list and records every Zobrist hash seen.
- `search` runs depth 1, 2, 3, ... and plays the best move of the last *completed* depth. Hard stop
  at 60% of `go <ms>` (node-count clock check every 1024 nodes); no new depth starts after 30%.
  Stops early on a found mate; a single legal move is played at once.
- `negamax`: mate scored `-(MATE - ply)` so shorter mates win; stalemate, fifty moves, dead
  material and any repetition (game history or search path) score as a draw with contempt 50
  against the root side (it plays weaker opponents, so draws are thrown-away points).
- Ordering (`order_key` + `Ordering`, task #87): the transposition-table move first (root: the
  previous iteration's best, or the stored move from the previous `go`), then MVV-LVA captures,
  promotions, then two killer slots per ply (quiet moves that caused a beta cut-off at that ply),
  then the remaining quiets by a history score `history[side][from][to]`, which grows by
  depth² on every quiet beta cut-off and is halved for all entries once one passes 300k (so it
  never climbs into the killer keys 400k/399k). Killers and history are fresh at each `go`
  (kept across that go's iterations). The root's own order is unchanged (TT/previous best,
  then `order_key`); quiescence ordering is unchanged (MVV-LVA only).
  Measured (`order_report`, fixed depth, TT on both sides, 8 TT FENs): same move and score 8/8
  at d4, d5, d6; nodes −29% at d4, −33% at d5, −43% at d6 (2.62M → 1.50M). The saving grows
  with depth, as killers and history need cut-offs to learn from. `go 200` (120/60 ms): start
  depth 6 both ways, Italian depth 5 → 6, Kiwipete depth 5 both (−21% nodes to get there).
  Node rate is unchanged within noise (cached-key sort, 32 KB history per `go`). A fixed-depth
  (d5) 80-ply self-play game is move-for-move identical with ordering on and off, with 32% fewer
  nodes: ordering changes cost, never the minimax result.
- Transposition table (`Tt`, task #63): 2^20 × 16 B = 16 MB, one slot per index, full 64-bit
  Zobrist key stored to reject collisions. Entry: key, score, compact move (from/to/promotion,
  top bit set so 0 = none), depth, generation (6 bits) + bound (exact/lower/upper). A
  `thread_local` keeps it across `go` calls within the game; `game` clears it, and so does a
  change of the side the engine searches for (draw scores carry contempt against the root side,
  so they are only valid for one side). Each `go` bumps the generation; an older generation's slot
  is always replaced, within a generation the deeper result stays.
  Probed at every negamax node with depth > 0, *after* the repetition (game history + search
  path), fifty-move, insufficient-material and mate/stalemate checks, so a stored score never
  hides a path-dependent draw at the node itself. A stored move is used only if it matches a
  legal move (decode = validate). An entry with enough depth cuts off on its bound; the root is
  never cut off (it always returns a searched move). Mate scores are stored node-relative
  (`score ± ply`) and read back root-relative. Quiescence does not probe or store.
  Residual graph-history risk accepted: a score that contains a repetition draw on one path can
  be reused through a transposition reached by another path. Contempt makes those scores ±50,
  not 0, which limits the damage; no fix (e.g. not storing draw-influenced scores) was tried.
- `search` uses the game table; `search_depth` uses a fresh 1 MB table (deterministic);
  `search_depth_with(.., tt, use_tt)` compares on/off. `tt_report` (ignored test) prints the
  comparison.
- `quiesce` replaces the static eval at depth 0: stand pat on `evaluate` (fail high at beta), then
  captures and queen promotions only, MVV-LVA first. Delta pruning skips a capture whose victim
  (+ promotion gain) + 200 cp cannot reach alpha, except at phase <= 6 (late endgames). In check
  it searches every evasion instead of standing pat, so a mated leaf scores as mate. A 32-ply
  quiescence cap guards check-evasion chains. The node-count clock check runs inside it too.
- `search_depth` runs the same iterative deepening to a fixed depth with no clock: use it for
  deterministic tests (never a wall-clock budget for an assertion about the chosen move).
- `evaluate`: material P100 N320 B330 R500 Q900 plus formula-built piece-square terms (centrality
  for N/B/Q, pawn advance and centre pawns, rook on 7th, king shelter in the middlegame vs king
  centralisation in the endgame), tapered by a 24-point phase; bishop pair +30.
- Prints `info depth <d> score <cp> nodes <n> qnodes <q> tthits <h> ttcuts <c>` before `bestmove`.
- Measured at `go 200` with the TT (`tt_report`, native release, 120 ms hard / 60 ms soft; wall
  clock, so ±1 ply between runs): start position depth 6, ~356k nodes, 6.5k TT hits, 4.4k TT cuts
  (TT off: depth 5, ~330k); Italian middlegame after 6.O-O depth 6, ~333k nodes, 9.3k hits, 5.8k
  cuts (off: depth 5, ~363k); Kiwipete middlegame depth 5, ~226k nodes, 3.1k hits, 1.1k cuts (off:
  depth 4, ~364k; the review's run saw depth 4 both ways). Fixed depth over the 8 TT test FENs:
  same move and score 8/8, nodes -17% at d3, -47% at d4, -60% at d5.
- Before the TT (quiescence only): start depth 4, ~300k nodes of which ~150k quiescence; Italian
  depth 4, ~294k nodes, ~200k quiescence. Without quiescence it reached depth 5 but scored that
  middlegame +239 for b2b4 — horizon optimism. Quiescence costs one ply of nominal depth and buys
  honest leaf scores. `arena versus chess` vs main (v0.2, no quiescence): +7 -2 =1.

## Ideas worth trying

- TT follow-ups: store quiescence results as depth-0 entries (then probing inside `quiesce`
  pays; probing alone does not, since `quiesce` stores nothing and few qnodes are in the table);
  two-slot buckets (depth-preferred + always-replace); PVS / aspiration windows, which a TT makes
  cheap; use the stored score as a better stand-in for `evaluate` at pruning decisions.
- Quiescence extras: SEE (static exchange) to skip losing captures like QxP defended by a pawn,
  which is most of the remaining qnode waste; checks in the first quiescence ply.
- The 30%/60% time split is conservative; with the TT, re-searches are cheaper and the soft limit
  could rise (each new depth costs ~2.5–3× the previous with the table, ~6–7× without).
- Null-move pruning (guard pawn-only endgames), late move reductions, PVS: killers + history
  (#87) now put the likely cut move first, which is what LMR and PVS rely on to be safe.
- Counter-move table (quiet reply to the opponent's last move) and history-gravity updates
  (penalise quiets that were searched before the cut move) are the natural next ordering steps.
- Opening variety for local testing: `arena versus` plays deterministic engines from the start
  position, so 20 games are a few repeated lines. In #87, main vs main went +3 −3 =2 with Black
  winning nearly every game, and the candidate (which reaches depth 6 at the start and opens
  e2e4 where main opens d2d4 at depth 5) went +2 −16 =2 and +1 −16 =3 while playing identical
  moves at fixed depth. A local verdict needs randomised opening plies before it means anything.
- Evaluation: material, piece-square tables with a middlegame/endgame taper, mobility, passed pawns,
  king safety. Tune weights by playing, not by hand-waving.

## Novel experiments

Ideas the swarm invented here rather than learned from an existing engine. Add each one with
what it is, why it might work, and its verdict. Never fill this from another engine's source.

- None yet.

## What failed and why

- shakmaty 0.30 has no `zobrist::ZobristHash` export; `zobrist_hash::<Zobrist64>` works with
  just `Zobrist64` imported (its `.0` is the u64).

- **Lesson carried over from Othello's buried TT (#44/#45), and what differs here.** Othello's TT
  showed −45% nodes and ~+1 ply, then was buried against a mismatched yardstick (a candidate
  rated vs Edax 4 compared to v0.2's Edax-1 lower bound), not on merit. The node saving
  reproduces here (−47% at depth 4, −60% at depth 5: chess transposes more, through move-order
  permutations of quiet moves). What chess needed that Othello did not: repetition and
  fifty-move draws are path-dependent (checks stay ahead of the probe, residual graph-history
  risk accepted, see Architecture), mate scores are ply-relative (stored node-relative), and
  contempt makes draw scores side-dependent (table cleared if the engine's side changes). If
  the referee buries this, check first whether the gate compared like with like.

When an idea is buried, write what it was, the measured result and what to try
differently. Never re-propose an idea from this list unchanged.

## Results log

<!-- The referee appends one line per verdict. Do not edit by hand. -->
- 2026-11-23 10:37 UTC · v0.1 shipped · Wire shakmaty to the protocol and play legal moves · rated 759 (first rated version)
- 2026-11-23 13:40 UTC · v0.2 passed the referee · Negamax alpha-beta with iterative deepening inside the go budget · rated 1259 (+500)
- 2026-11-23 16:13 UTC · v0.3 passed the referee · Quiescence search on captures and promotions (third submit, with the fixed merge-based harness) · rated 1306 (+47)
- 2026-11-23 17:17 UTC · v0.4 passed the referee · Transposition table keyed by Zobrist hash: TT move ordering every node, bound cut-offs, mate-distance-safe scores · rated 1420 (+114)
- 2026-11-23 17:48 UTC · v0.4 passed the referee · Transposition table keyed by Zobrist hash: TT move ordering every node, bound cut-offs, mate-distance-safe scores · rated 1376 (+70)
- 2026-11-23 19:07 UTC · buried · Killer moves and history heuristic for quiet-move ordering · Rated higher on the ladder but lost to v0.4 head to head (4–14–2).
