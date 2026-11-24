---
name: chess-playbook
description: Playbook for the Swarm Arena Chess engine (engines/chess). Load it before changing that engine or planning its next task. Holds the rules-library notes, the engine's current architecture, ideas that worked or failed, and the referee's results log. The swarm keeps it up to date.
---

# Chess playbook

Read this before touching `engines/chess`. Update it in the same session: the engine and this
playbook are both yours to edit. The referee appends every verdict to the results log below and
keeps your playbook edits even when the idea is buried.
Describe a candidate change under a "Candidate (not shipped)" note or in "Ideas worth trying"
until the referee passes it, and move it into "Architecture now" only once it lands: a burial must
not leave "Architecture now" describing reverted code.

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
- Ordering: the transposition-table move first (root: the previous iteration's best, or the
  stored move from the previous `go`), then MVV-LVA captures, promotions, then two killer slots
  per ply (quiet beta cut-offs, keys 400k/399k), then quiets by a side/from/to history table
  (+depth² per quiet cut-off, all halved past 300k). Killers and history are fresh each `go`;
  root and quiescence ordering use MVV-LVA only. (#87's ordering, returned in #98 with PVS/LMR.)
- PVS + LMR in `negamax` (#98): the first move gets the full window, later moves a null window
  `(alpha, alpha+1)`, re-searched with the full window on a fail-high inside `(alpha, beta)`.
  Late move reductions: at depth >= 3, not in check, from the 4th move on (`LMR_MIN_INDEX` 3),
  a quiet move that is not the TT move, not a killer and does not give check is first searched
  at depth-1-R (R 1; R 2 from the 9th move at depth >= 6), and re-searched at full depth (null
  window) if it beats alpha. The root stays full-window and unreduced. `search_depth_feats`
  turns ordering and PVS/LMR on or off; `pvs_report` (ignored test) prints the comparison.
- Measured for #98 (`pvs_report`, native release): fixed depth over the 8 TT FENs, v0.4 (TT
  only) → +ordering → full: d5 626k → 417k → 182k nodes (−71%), same move+score 6/8 (the other
  two within 8 cp); d6 2.62M → 1.50M → 621k (−76%), 5/8 (within 8 cp, one equal-score king move).
  At `go 200` (120 ms hard / 60 ms soft, ±1 ply between runs): start d6 (356k nodes) → d7 (114k);
  Italian d5 (208k) → d6 (200k); Kiwipete d4 (152k) → d5 (160k): +1 ply on all three. Local
  `arena versus chess` vs v0.4: +6 −3 =1 (ordering alone was +2 −16 =2).
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
- Endgame tables (#107): KQK, KRK and KPK are solved by the engine's own retrograde analysis at
  build time and embedded (`build.rs` runs `src/eg_gen.rs`, `src/endgame.rs` probes). The
  generator has its own three-piece move generator (no shakmaty) and labels mates ply by ply:
  odd passes find strong-side moves into a weak-side loss in ply-1, even passes find weak-side
  positions where every move reaches a strong-side win. KPK promotions (queen and rook; knight
  and bishop only draw) read the solved KQK/KRK tables, so KPK holds true distance-to-mate too.
  Storage: one byte per position, 0 = draw, n = mate in n-1 plies; pawnless tables fold the
  strong king into the a1-d1-d4 triangle (10 × 64 × 64 × 2 = 80 KB each), KPK folds the pawn
  onto files a-d (24 × 64 × 64 × 2 = 192 KB): 360 KB in all; the wasm grows ~955 KB → 1.3 MB.
  The probe flips colours when Black is strong and skips positions with castling rights.
  `build.rs` reads `OUT_DIR` (`std::env::var_os`) at compile time only; nothing runs at move time.
- Probing: `Search::table_score` runs in `negamax` after the repetition/fifty/dead-material checks
  (before the TT and before depth 0) and at the top of `quiesce`, returning the exact mate score
  `±(MATE - (ply + dtm))` (or the contempt draw), so table mates mix with searched mates and TT
  mate-distance handling. A win or loss that would not arrive before the fifty-move counter
  runs out is left to the search. `tbhits` in the info line counts probes that scored a node.
- Because a table can report a mate far beyond the horizon at a shallow depth, iterative
  deepening stops on a mate only if its distance is within the depth searched (KRRK otherwise
  played a rook-capture line into KRK mate in 19 instead of mate in 5).
- Verified (`endgame::tests`): every entry of all three tables, both colours, equals a one-ply
  minimax over shakmaty's legal moves (an oracle independent of the generator's move
  generator), which with correct terminal positions proves the whole table. KQK longest mate
  19 plies and KRK 31 plies, the published 10 and 16 moves. KPK: 163,328 legal positions with
  White to move, 124,960 won, 38,368 drawn, longest mate 55 plies. From 25 random won starts
  each, depth-2 search mates a random mover within the table's distance, under the fifty-move rule.
- Prints `info depth <d> score <cp> nodes <n> qnodes <q> tthits <h> ttcuts <c> tbhits <t>` before `bestmove`.
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

## Candidate (not shipped): self-generated opening book (#108)

Moves into "Architecture now" only if the referee passes it.

- `src/book.rs`: `book/book.bin` (10-byte records: u64 Zobrist key, u16 move code, sorted)
  embedded with `include_bytes!` and probed by binary search before `search` in `go`. The stored
  code is decoded against the legal moves (decode = validate). A book move that would repeat a
  position already seen in the game is left to the search. Prints `info book 1` when it plays one.
- `book/book.txt` is the source of truth (normalised FEN with counters `0 1`, UCI move, score in
  cp for the side to move, depth); `chess-engine book pack` turns it into `book.bin`. The test
  `every_book_move_is_legal_and_the_binary_matches_the_text` checks each move is legal, that the
  probe returns it, and that `book.bin` is exactly `pack(book.txt)`.
- Generator: `chess-engine book gen <shard> <shards> <depth> <reply-depth> <replies>
  <book-moves> [resume.txt]`, run by `engines/chess/book/generate.sh` (processes, not threads:
  the referee's source scan forbids `std::thread` anywhere in the crate). Roots: the initial
  position + the 200 start lines of `shared/src/openings/chess.txt` (where gate games begin).
  For each root and each colour it walks a tree: where we move, the move of a deterministic
  fixed-depth-10 search (fresh 64 MB TT, PVS/LMR, the engine's own eval); where the opponent
  moves, its top 3 replies (then top 2 deeper) by our own depth-6 search, which is roughly what
  main plays at 200 ms. Three book moves per side per line (plies 4/6/8 as White, 5/7/9 as Black).
  Mate scores are not stored. Deterministic: fixed depth, fresh table per position.
- Built with `generate.sh 10 6 3,2 3 4`: 5,904 positions (1,965 White to move, 3,939 Black),
  59 KB embedded, ~1–5 s per position (≈2.5 s mean with 4 shards on 4 cores), ~64 min wall in
  all on 4 cores (it was resumed once: a 30-minute background limit killed the first run, so
  `resume.txt` exists). The gate's 200 ms reaches depth 6–7, so a book move is ~3–4 plies deeper.
- Local measurement (`measure`-style script: `playMatch` with the balanced suite, seed 4242,
  20 pairs, 200 ms; `chess-engine book stats` on the games; at most 3 book moves per game):
  vs main (v0.6) +18 −9 =13, book moves per game 2.62 (White 2.90, Black 2.35), median first
  out-of-book ply 10. vs Stockfish level 6 +12 −26 =2 (v0.6's gate there: 11–26–3), 1.48 per
  game (White 2.05, Black 0.90), median first out-of-book ply 7. Our depth-6 top-3 predicts
  main's replies well and Stockfish's poorly, especially its first move as White out of the
  suite position (we as Black often leave book at ply 5). Read the main result with care: the
  book is tuned to the opponent main *is*, so it says more about the book being hit than about
  strength; the Stockfish result is flat.

## Ideas worth trying

- Opening book follow-ups (#108): predict replies with the opponent's real distribution (record
  Stockfish level 6's replies in gate games: our top-3 misses some), extend book depth on the
  lines actually hit, or store a score-only entry to seed the TT instead of forcing the move.

- TT follow-ups: store quiescence results as depth-0 entries (then probing inside `quiesce`
  pays; probing alone does not, since `quiesce` stores nothing and few qnodes are in the table);
  two-slot buckets (depth-preferred + always-replace); PVS / aspiration windows, which a TT makes
  cheap; use the stored score as a better stand-in for `evaluate` at pruning decisions.
- Quiescence extras: SEE (static exchange) to skip losing captures like QxP defended by a pawn,
  which is most of the remaining qnode waste; checks in the first quiescence ply.
- The 30%/60% time split is conservative; with the TT, re-searches are cheaper and the soft limit
  could rise (each new depth costs ~2.5–3× the previous with the table, ~6–7× without).
- Null-move pruning (guard pawn-only endgames), now that PVS/LMR (#98) make the null window
  routine. LMR tuning: reduction by a log(depth)·log(index) table, reduce less for moves with
  high history, and PVS/aspiration windows at the root (the root is still full-window).
- Counter-move table (quiet reply to the opponent's last move) and history-gravity updates
  (penalise quiets that were searched before the cut move), once quiet ordering ships at all.
- Opening variety for local testing: `arena versus` plays deterministic engines from the start
  position, so 20 games are a few repeated lines. In #87, main vs main went +3 −3 =2 with Black
  winning nearly every game, and the candidate (which reaches depth 6 at the start and opens
  e2e4 where main opens d2d4 at depth 5) went +2 −16 =2 and +1 −16 =3 while playing identical
  moves at fixed depth. A local verdict needs randomised opening plies before it means anything.
- More endgame tables: KBNK needs distance-to-mate (64^4/8 bytes ≈ 2 MB raw, too big as
  bytes; a bitbase cannot guide the mate) — try a 4-bit or on-demand (first-probe) generation, or
  a KBNK mating-net evaluation instead. KRKP / KQKP / KPKP need 4-piece generation: the
  generator's ply-by-ply forward passes cost O(passes × positions), so 4 pieces want a real
  retrograde (un-move) generator, or build them lazily in `game` within a time budget.
- Use the KPK bitbase in evaluation beyond 3 pieces: e.g. score a pawn ending as won when the
  king-and-pawn race alone is a table win, to steer trades into won KPK endings.
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

- **Killer moves + history heuristic (#87), buried: better on the ladder, 4–14–2 head to head
  against v0.4.** Two killer slots per ply (quiet beta cut-offs, keyed 400k/399k, below every
  capture and promotion) and a side/from/to history table (+depth² per quiet cut-off, all
  halved once one entry passes 300k), fresh at each `go`; root and quiescence ordering untouched.
  It did what ordering should: at fixed depth the move and score matched 8/8 at d4–d6, nodes fell
  29% / 33% / 43% (d4 / d5 / d6), node rate was unchanged, and a d5 self-play game was
  move-for-move identical on and off. On the clock it gains a ply only sometimes (start position
  d6 both ways; Italian d5 → d6; Kiwipete d5 both). The referee rated it above v0.4 against
  Stockfish 4 (40 games), but it lost to v0.4 4–14–2 over 20 games. Local `arena versus`
  agreed (+2 −16 =2, then +1 −16 =3). Main vs main went +3 −3 =2, so the harness is not
  biased. Why it loses head to head is not settled. Both engines are deterministic and the
  start position is fixed, so 20 games are only a few distinct lines: the candidate opens
  e2e4 (depth 6) where v0.4 opens d2d4 (depth 5), and in the replayed game it lost both
  engines gave the same scores move after move (no blunder, a shared weakness). Treat the
  head-to-head as a few repeated lines, not 20 samples.
  Try differently: (1) re-measure with randomised opening plies before believing either
  number; (2) if it still loses, ship it together with something that uses the better move
  order (LMR or PVS), since the ordering alone mostly changes which depth the clock lands on;
  (3) keep the d4–d6 node numbers above as the baseline.
  #98 took option (2): the same ordering returned with PVS + LMR (see Architecture now).

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
- 2026-11-23 20:04 UTC · v0.5 passed the referee · PVS and late move reductions on top of killer + history quiet ordering (retry of #87 with a consumer) · rated 1458 (+28 vs v0.4 on the same rung)
- 2026-11-23 21:07 UTC · v0.6 passed the referee · Self-generated endgame bitbases (KPK, KQK, KRK) solved by the engine's own retrograde analysis · rated 1463 (+5)
- 2026-11-24 09:56 UTC · v0.7 passed the referee · Self-generated opening book: the engine's own long searches over the first plies, probed instantly · rated 1483 (+20)
