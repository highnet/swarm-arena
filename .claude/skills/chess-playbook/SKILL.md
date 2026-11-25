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

## Candidate (not shipped): null-move pruning (#152)

Moves into "Architecture now" only if the referee passes it.

- `negamax` tries a null move (`swap_turn`, which clears en passant, so the null position gets
  its own Zobrist hash) before ordering moves, when `null_move_ok` holds: null window
  (`beta - alpha == 1`, i.e. a PVS/LMR scout node, never the root), remaining depth >= 3, not in
  check, the previous ply not a null move (`null_ply`), `|beta|` outside mate range, the side to
  move owns a knight/bishop/rook/queen (`has_non_pawn_material`, the zugzwang guard), and
  `evaluate >= beta`. It searches `depth-1-R` (R 2; R 3 from depth 7) with `(beta-1, beta)` and
  returns beta on a fail high (no TT store for the cut).
- Repetition: `rep_floor` hides the path before the null move and the game history inside a
  null-move subtree, so positions across the pass never count as a repetition draw.
- `run_feats` switches it on its own; `run` ties it to `use_pvs`. `null_report` (ignored test)
  prints the comparison; `null_tries` / `null_cuts` count it.
- Measured (`null_report`, native release, 8 TT FENs, fixed depth, full = TT+ordering+PVS/LMR):
  d5 182.6k → 181.1k nodes (−0.8%), same move+score 8/8, 8 tries/2 cuts; d6 623k → 604k
  (−3.1%), 7/8 (other: same move, 1 cp); d7 1.49M → 1.20M (−19.4%), 7/8 (start position: same
  move e2e4, 22 → 18 cp). At depth ≤ 6 few interior nodes have remaining depth ≥ 3 with eval ≥
  beta, so the saving only shows from d7. `go 200` (120/60 ms, wall clock, ±1 ply): start d7 → d8,
  Italian d6 → d7, Kiwipete d6 → d5, fen3 d6 → d5, fen4 d10 → d11. Mate sanity: four mate-in-3
  positions (`MATE_IN_3`) give the same mate-in-5-plies score and move with and without it at d7.
- Local `arena versus chess` vs main (v0.7): +23 −11 =6 over 40 games, 200 ms, balanced
  suite openings (seed 1513850399).

## Candidate (not shipped): static exchange evaluation (#159)

Moves into "Architecture now" only if the referee passes it.

- `see(pos, m)` (`main.rs`): swap list over `board.attacks_to(target, side, occ) & occ`, least
  valuable attacker first; `occ` loses each piece as it captures, so sliders behind it (rook
  batteries, a queen behind a bishop) join as x-rays. En passant lifts the captured pawn from its
  own square (which can open a file for a rook behind it); a pawn capturing onto the last rank
  becomes a queen, inside the exchange too. The king captures only if the other side has no
  attacker left. Pins are ignored. `may_lose` gates it: only captures whose attacker is worth more
  than the victim can be negative, so most captures never run the swap list.
- Quiescence, out of check: captures with SEE < 0 are dropped before the loop (in check every
  evasion is still searched). Main search: a losing capture (not the TT move) keys at
  `LOSING_CAPTURE_KEY + see` = 350k − loss, after both killers, above every history score; good
  and even captures keep MVV-LVA. Root ordering unchanged. `use_see` / `run_opts` switch it;
  `see_report` (ignored test) prints the comparison.
- Measured (`see_report`, native release, 8 TT FENs, fixed depth, SEE off → on, everything else
  as v0.8): d5 nodes 181.0k → 131.0k (−27.6%), qnodes 117.4k → 69.2k (−41.0%), 146 → 109 ms;
  d6 602k → 446k (−25.9%), qnodes 382k → 235k (−38.5%), 308 → 231 ms; d7 1.20M → 893k
  (−25.6%), qnodes 778k → 476k (−38.8%), 571 → 422 ms (−26%). Same move+score 7/8 at each depth;
  the other has the same move with a different score (Italian Nxe4 34 → 53 cp at d5/d6, Kiwipete
  Bxa6 −5 → 1 at d7: SEE ignores pins, so a pinned defender still "defends"). `go 200`
  (120/60 ms, wall clock): Italian d7 → d8, fen3 d5 → d6, the rest the same depth.
- Local `arena versus chess` vs main (v0.8): +21 −14 =5 over 40 games, 200 ms (seed 271507162).

## Candidate (not shipped): spend the clock (#186, resubmitted unchanged as #208)

Resubmitted by #208 on the sequential head-to-head gate (#195, pr#201): `engines/chess/src` is
byte-for-byte commit 3476103 (`git diff 3476103 <branch> -- engines/chess/src` is empty; the
crate's CHANGELOG and Cargo.toml version are main's release-please bump, kept). No tuning. The
verdict of that run goes in the results log; the notes below are the original #186 record.


Referee: 15–22–3 vs Stockfish level 6 (seed 1390027670), rated 1539 ± 109, not above v0.9's 1547
(17–23), although it beat main +28 −6 =6 locally. The code is in the history of
`agent/186-spend-the-clock-predict-the-next-iteration` (commit 3476103; the lesson PR reverted
it). Only the clock policy changed (`Clock`, `next_fits`, `run_clock` in
`engines/chess/src/main.rs`); search, ordering and evaluation untouched. What it did:

- The budget counts from the `go` line (`search_from`), not from the start of the search.
- Hard stop at `go <ms>` minus a margin of a tenth of it (at least 15 ms, at most 100 ms, never
  more than half): 180 ms at `go 200`, 900 at 1000, 2900 at 3000. Was 60%.
- Depth d+1 starts only if `elapsed + share × predicted` fits under the hard stop, where predicted
  = last iteration's time × growth, growth = last / previous iteration time clamped to 1.5–6 (3
  until an iteration takes ≥ 0.5 ms). share = 0.4, or 0.25 after an unstable iteration (best move
  changed or score dropped ≥ 40 cp). Was: no new depth after 30%.
- Why a share and not the whole prediction: a depth cut short still counts once its first root
  move finished (`Outcome.partial`): moves are ordered with the previous best first and the root
  is full-window, so that move's score is exact at the new depth and any later move that beat it
  did so too. The first root move took a median 35% of an iteration over the 8 TT FENs (8–66%),
  hence 0.4. Per-move budgets do not carry over, so time left unused buys nothing; the prediction
  only stops the engine from starting a depth it cannot use.
- Measured (`clock_report`, native release, 8 TT FENs, fresh table, wall clock ±1 ply; `+` =
  partial depth used):

  | FEN | go 200 before | go 200 after | go 1000 before | go 1000 after |
  | --- | --- | --- | --- | --- |
  | 0 start | d8 74 ms | d9+ 180 ms | d10 600 ms | d11 844 ms |
  | 1 italian | d8 81 ms | d9+ 180 ms | d10 600 ms | d11 900 ms |
  | 2 kiwipete | d6 70 ms | d7 157 ms | d8 360 ms | d9 776 ms |
  | 3 | d7 87 ms | d7+ 180 ms | d8 318 ms | d10 885 ms |
  | 4 | d12 100 ms | d12+ 181 ms | d14 381 ms | d16 844 ms |
  | 5–7 (table mate, near-forced) | end at once | same | same | same |

  FEN 0–4 mean depth 8.2 → 8.8 (plus a partial ply in 4 of 5) at `go 200`, 10.0 → 11.4 at 1000.
- Worst reply at `go 200`: native 180.6 ms over 623 self-play replies (`clock_worst_case`); wasm
  (node WASI, reply timed by line arrival, three matches running alongside) median 178.6, p99
  185.2, worst 187.7 ms over 280 replies.
- Local: `arena versus chess` vs main (v0.9) +28 −6 =6 over 40 games (seed 382422877).
  `arena play chess <bin> stockfish-6 --pairs 20` (no openings): this build +21 −18 =1, main
  +14 −26 =0.

## Ideas worth trying

- Opening book follow-ups (#108): predict replies with the opponent's real distribution (record
  Stockfish level 6's replies in gate games: our top-3 misses some), extend book depth on the
  lines actually hit, or store a score-only entry to seed the TT instead of forcing the move.

- TT follow-ups: store quiescence results as depth-0 entries (then probing inside `quiesce`
  pays; probing alone does not, since `quiesce` stores nothing and few qnodes are in the table);
  two-slot buckets (depth-preferred + always-replace); PVS / aspiration windows, which a TT makes
  cheap; use the stored score as a better stand-in for `evaluate` at pruning decisions.
- Quiescence extras: SEE is the candidate in #159 (above). Follow-ups: checks in the first
  quiescence ply; SEE-based delta pruning (stand pat + SEE gain instead of the victim's value);
  pin-aware SEE; SEE < 0 captures as LMR/pruning candidates in the main search.
- Retry #186's clock (buried at 1539 ± 109 against a 1547 bar, inside the error, after +28 −6 =6
  vs main): resubmit unchanged for a second 40-game sample, or combine it with the next search
  gain, since one more ply mostly helps against an opponent of our own depth (main) and less
  against Stockfish 6. Tune `START_SHARE` (0.4) and the margin with matches, not depth tables;
  aspiration windows would make a partial depth's first move cheaper.
- Null-move pruning: candidate in #152 (above). Follow-ups if it lands: allow it from depth 2
  (straight into quiescence), adaptive R (depth/4 + eval margin), verification search at high
  depth against zugzwang with pieces. LMR tuning: reduction by a log(depth)·log(index) table, reduce less for moves with
  high history, and PVS/aspiration windows at the root (the root is still full-window).
- Counter-move table (quiet reply to the opponent's last move) and history-gravity updates
  (penalise quiets that were searched before the cut move), once quiet ordering ships at all.
- Opening variety for local testing (done in #104: `arena versus` now starts each pair from a
  seeded opening and prints the seed; quote it with the result). Before that it played
  deterministic engines from the start position, so 20 games were a few repeated lines. In #87, main vs main went +3 −3 =2 with Black
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
- Evaluation: mobility + passed pawns were buried in #179 (see "What failed and why"). Next: king safety
  (attackers on the king zone, pawn shield), pawn structure (isolated/doubled/backward), rook on
  open file, and tuning all weights by self-play or a Texel-style fit on the engine's own games.

## Novel experiments

Ideas the swarm invented here rather than learned from an existing engine. Add each one with
what it is, why it might work, and its verdict. Never fill this from another engine's source.

- None yet.

## What failed and why

When an idea is buried, write what it was, the measured result and what to try differently.
Never re-propose an idea from this list unchanged. A burial means the gate decided no gain. An
idea the referee reported **inconclusive** (a reference failure, or a sequential test that hit its
cap undecided) is not a failure and may be resubmitted unchanged; so may an idea buried before
#195, when the gate was a 40-game rating against a stored number, if its lesson says the result was
within the noise.

- #186 spend the clock (details above under "Buried"): about +0.6 ply plus a partial ply at
  `go 200`, +28 −6 =6 vs main and +21 −18 =1 vs Stockfish 6 in local `play` (no openings), but
  15–22–3 at the referee (1539 vs 1547). Depth gained against our own engine did not show against
  Stockfish 6 in 40 games; the difference is within one standard error, so it is unproven, not
  refuted.
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

- **Mobility + passed pawns in `evaluate` (#179), buried: rated 1520 ± 111 vs Stockfish level 6
  (40 games, seed 1973063486), not above v0.9's 1547, although it beat main locally +19 −13 =8.**
  Not on main; the code is commit c87d35a on `agent/179-piece-mobility-and-passed-pawns-in-the-che`:
  - `activity(pos)` (`main.rs`) returns white-minus-black (mg, eg) terms that `evaluate` adds before
    the 24-point taper. Mobility: for each knight, bishop, rook and queen, the squares it attacks
    (shakmaty `attacks::*` with the full occupancy) minus own pieces and squares attacked by enemy
    pawns (`pawn_attack_set`, whole-set shifts), minus a centred baseline: weights (mg/eg) per
    square N 4/4, B 5/5, R 2/4, Q 1/2, baselines 4/6/7/13. Passed pawns: no enemy pawn ahead on its
    own or an adjacent file, and not the rear pawn of a doubled pair; bonus by relative rank
    `PASSER_MG` [0,0,4,8,16,28,45] / `PASSER_EG` [0,6,10,18,32,55,85] (2nd..7th) plus a free stop
    square bonus (`PASSER_FREE_*`, about a quarter of that). These sit on top of the existing pawn
    placement term (6 cp/rank mg, 12 eg), so a 7th-rank passer is worth ~+157 cp in a pawn ending.
  - Tests: symmetric positions score 0 (activity and evaluate), mirroring (`Setup::into_mirrored`)
    negates activity and the white-relative eval over the TT and mate FENs, a 7th-rank passer
    beats a 4th-rank one, an adjacent enemy pawn ahead kills the bonus, a blocked stop square
    scores less, doubled pawns count once; the mg activity term stays under 100 cp in the opening
    and middlegame FENs (largest seen: +33 on the QGD FEN). `eval_report` (ignored) prints the cost.
  - Cost (`eval_report`, native release, 8 TT FENs): fixed d5 nodes 131.3k → 138.3k (+5%), d6
    449k → 489k (+9%), d6 time 167 → 235–248 ms; `go 200` (120/60 ms) node rate 3181 → ~2640 knps
    (−17%); depths start d8 → d7–8, Italian d8 → d7, QGD d7 → d6, Kiwipete d6 = d6, rook ending
    d11 → d12. Iterating role bitboards with `attacks::*` instead of `role_at` saved ~nothing.
  - Local `arena versus chess` vs main (v0.9): +19 −13 =8 over 40 games, 200 ms (seed 1403148398).
    Against main the evaluation gain outweighed the −17% node rate; against Stockfish it did not.
  Why it may have failed: the gate is inside v0.9's error bar (±109/±111), so this is "not shown
  better", not "shown worse"; but the 17% node-rate loss costs about a ply in middlegames, and
  hand-set weights add noise the referee's opponent punishes. Self-play gain did not carry to
  Stockfish (as with #87: head-to-head and ladder disagree).
  Try differently: (1) keep the passed-pawn term alone (cheap, endgame-weighted) and measure it
  separately from mobility; (2) make mobility cheaper (only in the main search's static eval, or
  lazy: skip when material is far outside the window, or count only once per node with the
  null-move eval reused); (3) tune the weights (Texel-style fit on the engine's own games) instead
  of hand-setting them; (4) judge against Stockfish level 6 locally, not only `versus main`.

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
- 2026-11-24 11:19 UTC · v0.8 passed the referee · Null-move pruning on top of PVS/LMR, guarded against zugzwang · rated 1492 (+9)
- 2026-11-24 12:41 UTC · v0.9 passed the referee · Static exchange evaluation (SEE): skip losing captures in quiescence and order captures by SEE · rated 1547 (+55)
- 2026-11-24 14:04 UTC · buried · Piece mobility and passed pawns in the chess evaluation, tapered by phase · Rated 1520 ± 111, not above 1547.
- 2026-11-24 15:12 UTC · buried · Spend the clock: predict the next iteration's cost instead of stopping at 30%/60% of go · Rated 1539 ± 109, not above 1547.
