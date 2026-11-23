//! chess engine for Swarm Arena.
//! Rules: the `shakmaty` crate. Search and evaluation: written by the swarm.
//! Protocol and library policy: ../PROTOCOL.md.

mod endgame;

use endgame::Tb;
use shakmaty::uci::UciMove;
use shakmaty::zobrist::Zobrist64;
use shakmaty::{Chess, Color, EnPassantMode, Move, Position, Role};
use std::cell::RefCell;
use std::collections::HashSet;
use std::io::{self, BufRead, Write};
use std::time::{Duration, Instant};

fn value(role: Role) -> i32 {
    match role {
        Role::Pawn => 100,
        Role::Knight => 320,
        Role::Bishop => 330,
        Role::Rook => 500,
        Role::Queen => 900,
        Role::King => 0,
    }
}

fn hash(pos: &Chess) -> u64 {
    pos.zobrist_hash::<Zobrist64>(EnPassantMode::Legal).0
}

/// Replays the referee's UCI moves from the initial position. Returns the position and the
/// hashes of every position seen (for repetition avoidance), or None on an unparsable move.
fn replay(moves: &[String]) -> Option<(Chess, HashSet<u64>)> {
    let mut pos = Chess::default();
    let mut seen = HashSet::new();
    seen.insert(hash(&pos));
    for s in moves {
        let m = s.parse::<UciMove>().ok()?.to_move(&pos).ok()?;
        pos.play_unchecked(m);
        seen.insert(hash(&pos));
    }
    Some((pos, seen))
}

const MATE: i32 = 1_000_000;
const INF: i32 = 2_000_000;
/// Scores above this are forced mates (mate is scored MATE - plies, so shorter mates win).
const MATE_BOUND: i32 = MATE - 1_000;
/// Draws (repetition, stalemate, fifty moves, dead material) cost the engine this much: it plays
/// weaker opponents, so a draw is usually a half point thrown away.
const CONTEMPT: i32 = 50;
const MAX_DEPTH: u32 = 64;
/// Delta-pruning margin: a capture whose victim plus this cannot lift the stand-pat score to
/// alpha is skipped in quiescence.
const DELTA_MARGIN: i32 = 200;
/// At or below this game phase (24 = all pieces, 0 = bare kings and pawns) delta pruning is off:
/// in late endgames a single capture can decide the game beyond its material value.
const ENDGAME_PHASE: i32 = 6;
/// Plies of quiescence beyond which a node is scored statically (guards check-evasion chains).
const MAX_QPLY: i32 = 32;

/// Transposition-table size: 2^20 entries of 16 bytes = 16 MB.
const TT_BITS: u32 = 20;
const EXACT: u8 = 0;
const LOWER: u8 = 1;
const UPPER: u8 = 2;

/// One table slot (16 bytes). `meta` packs the generation (high 6 bits) and the bound (low 2).
#[derive(Clone, Copy, Default)]
struct Entry {
    key: u64,
    score: i32,
    mv: u16,
    depth: u8,
    meta: u8,
}

impl Entry {
    fn bound(&self) -> u8 {
        self.meta & 3
    }
    fn generation(&self) -> u8 {
        self.meta >> 2
    }
}

/// Fixed-size, always-indexed table keyed by the full Zobrist key (the stored key rejects index
/// collisions). It lives across `go` calls within a game: each search bumps the generation, a
/// slot from an older generation is always replaced, and within a generation the deeper result
/// stays.
struct Tt {
    entries: Vec<Entry>,
    mask: usize,
    generation: u8,
    /// The side the engine searched for last; draw scores carry contempt against it, so a change of
    /// side clears the table.
    root_turn: Option<Color>,
}

impl Tt {
    fn new(bits: u32) -> Tt {
        Tt { entries: vec![Entry::default(); 1 << bits], mask: (1 << bits) - 1, generation: 0, root_turn: None }
    }

    fn clear(&mut self) {
        self.entries.iter_mut().for_each(|e| *e = Entry::default());
        self.generation = 0;
        self.root_turn = None;
    }

    fn new_search(&mut self, turn: Color) {
        if self.root_turn != Some(turn) {
            self.clear();
            self.root_turn = Some(turn);
        }
        self.generation = (self.generation + 1) & 63;
    }

    fn probe(&self, key: u64) -> Option<Entry> {
        let e = self.entries[key as usize & self.mask];
        // An empty slot has key 0; a real position hashing to exactly 0 is not worth a flag bit.
        (e.key == key && key != 0).then_some(e)
    }

    fn store(&mut self, key: u64, depth: u32, ply: i32, score: i32, bound: u8, mv: Option<Move>) {
        let slot = &mut self.entries[key as usize & self.mask];
        if slot.generation() == self.generation && depth < slot.depth as u32 {
            return;
        }
        *slot = Entry {
            key,
            score: to_tt(score, ply),
            mv: mv.map_or(0, |m| encode(&m)),
            depth: depth.min(255) as u8,
            meta: (self.generation << 2) | bound,
        };
    }
}

thread_local! {
    /// The game's table, kept between `go` calls and cleared by `game`.
    static TT: RefCell<Tt> = RefCell::new(Tt::new(TT_BITS));
}

/// Mate scores are stored relative to the node (distance from it), not the root, so a mate found
/// through a transposition at another ply still reports its true distance.
fn to_tt(score: i32, ply: i32) -> i32 {
    if score > MATE_BOUND {
        score + ply
    } else if score < -MATE_BOUND {
        score - ply
    } else {
        score
    }
}

fn from_tt(score: i32, ply: i32) -> i32 {
    if score > MATE_BOUND {
        score - ply
    } else if score < -MATE_BOUND {
        score + ply
    } else {
        score
    }
}

/// Compact move: from (6 bits), to (6 bits), promotion role (3 bits), and a set top bit so a
/// stored move is never 0.
fn encode(m: &Move) -> u16 {
    let from = m.from().map_or(0, |s| s as u16);
    let to = m.to() as u16;
    let promo = m.promotion().map_or(0, |r| r as u16);
    0x8000 | from | (to << 6) | (promo << 12)
}

/// The legal move matching a stored code, if any: this both decodes and validates it.
fn decode(code: u16, moves: &[Move]) -> Option<Move> {
    if code == 0 {
        return None;
    }
    moves.iter().find(|m| encode(m) == code).copied()
}

/// Game phase from the pieces on the board, 0 (pawn endgame) to 24 (all pieces).
fn phase(pos: &Chess) -> i32 {
    let b = pos.board();
    let minors = (b.knights() | b.bishops()).count() as i32;
    (minors + 2 * b.rooks().count() as i32 + 4 * b.queens().count() as i32).min(24)
}

/// Distance-to-centre score of a square, 0 (corner) to 14 (the four centre squares).
fn centrality(file: i32, rank: i32) -> i32 {
    (7 - (2 * file - 7).abs()) + (7 - (2 * rank - 7).abs())
}

/// Piece-square bonus for a piece of `role` on (file, rank), rank seen from its owner's side.
/// Returns (middlegame, endgame). Formula-built rather than tabulated, so the shape is legible.
fn placement(role: Role, file: i32, rank: i32) -> (i32, i32) {
    let c = centrality(file, rank);
    match role {
        Role::Pawn => {
            let advance = 6 * (rank - 1);
            let centre = if (3..=4).contains(&file) { [0, -8, 4, 14, 16, 10, 0, 0][rank as usize] } else { 0 };
            (advance + centre, 2 * advance)
        }
        Role::Knight => (3 * c - 21, 2 * c - 14),
        Role::Bishop => (2 * c - 12 + if rank == 0 { -6 } else { 0 }, c - 7),
        Role::Rook => {
            let seventh = if rank == 6 { 16 } else { 0 };
            let central = if (2..=5).contains(&file) && rank == 0 { 4 } else { 0 };
            (seventh + central, seventh / 2)
        }
        Role::Queen => (c - 7 + if rank == 0 { 0 } else { -2 }, 2 * c - 14),
        Role::King => {
            let shelter = if rank == 0 {
                if matches!(file, 0..=2 | 6 | 7) { 18 } else { 0 }
            } else {
                -14 * rank
            };
            (shelter, 4 * c - 28)
        }
    }
}

/// Static evaluation from the side to move's point of view: material, tapered placement, and a
/// bishop-pair bonus.
fn evaluate(pos: &Chess) -> i32 {
    let board = pos.board();
    let (mut mg, mut eg, mut phase) = (0i32, 0i32, 0i32);
    let mut bishops = [0; 2];
    for (sq, piece) in board.iter() {
        let sign = if piece.color == Color::White { 1 } else { -1 };
        let file = sq.file().to_usize() as i32;
        let raw = sq.rank().to_usize() as i32;
        let rank = if piece.color == Color::White { raw } else { 7 - raw };
        let (pm, pe) = placement(piece.role, file, rank);
        let v = value(piece.role);
        mg += sign * (v + pm);
        eg += sign * (v + pe);
        phase += match piece.role {
            Role::Knight | Role::Bishop => 1,
            Role::Rook => 2,
            Role::Queen => 4,
            _ => 0,
        };
        if piece.role == Role::Bishop {
            bishops[piece.color as usize] += 1;
        }
    }
    let phase = phase.min(24);
    let mut s = (mg * phase + eg * (24 - phase)) / 24;
    if bishops[Color::White as usize] >= 2 {
        s += 30;
    }
    if bishops[Color::Black as usize] >= 2 {
        s -= 30;
    }
    if pos.turn() == Color::White {
        s
    } else {
        -s
    }
}

/// Ordering key: the previous iteration's best move first, then captures by MVV-LVA (most
/// valuable victim, cheapest attacker), then promotions, then quiet moves.
fn order_key(m: &Move, best: Option<Move>) -> i32 {
    if Some(*m) == best {
        return i32::MAX;
    }
    let mut k = 0;
    if let Some(victim) = m.capture() {
        k += 1_000_000 + 16 * value(victim) - value(m.role()) / 10;
    }
    if let Some(p) = m.promotion() {
        k += 500_000 + value(p);
    }
    k
}

/// A quiet move: neither a capture nor a promotion. Only quiets go into the killer slots and the
/// history table; captures and promotions already have their own ordering.
fn is_quiet(m: &Move) -> bool {
    !m.is_capture() && m.promotion().is_none()
}

/// Ordering keys for the two killer slots: below every capture and promotion, above every quiet
/// move's history score (which `HISTORY_MAX` keeps under them).
const KILLER_KEY: [i32; 2] = [400_000, 399_000];
/// History scores are halved once any entry passes this, so they never reach the killer keys.
const HISTORY_MAX: i32 = 300_000;

/// Killer slots (two per ply) and the history table for quiet-move ordering. Fresh at each `go`.
struct Ordering {
    killers: Vec<[Option<Move>; 2]>,
    /// history[side][from][to]: grows by depth*depth whenever that quiet move causes a beta cut-off.
    history: Vec<[[i32; 64]; 64]>,
}

impl Ordering {
    fn new() -> Ordering {
        Ordering { killers: vec![[None; 2]; MAX_DEPTH as usize + 2], history: vec![[[0; 64]; 64]; 2] }
    }

    fn slot(m: &Move) -> (usize, usize) {
        (m.from().map_or(0, |s| s as usize), m.to() as usize)
    }

    /// Ordering key for a move at `ply`: the TT move, captures and promotions as `order_key`, then
    /// the two killers, then quiet moves by history score.
    fn key(&self, m: &Move, tt_move: Option<Move>, side: Color, ply: i32) -> i32 {
        if Some(*m) == tt_move || !is_quiet(m) {
            return order_key(m, tt_move);
        }
        if let Some(k) = self.killers.get(ply as usize) {
            if k[0] == Some(*m) {
                return KILLER_KEY[0];
            }
            if k[1] == Some(*m) {
                return KILLER_KEY[1];
            }
        }
        let (from, to) = Self::slot(m);
        self.history[side as usize][from][to]
    }

    /// Whether `m` sits in one of the two killer slots at `ply`.
    fn is_killer(&self, m: &Move, ply: i32) -> bool {
        self.killers.get(ply as usize).is_some_and(|k| k[0] == Some(*m) || k[1] == Some(*m))
    }

    /// Records a quiet move that caused a beta cut-off at `ply` with `depth` plies left.
    fn cutoff(&mut self, m: &Move, side: Color, ply: i32, depth: u32) {
        if let Some(k) = self.killers.get_mut(ply as usize) {
            if k[0] != Some(*m) {
                k[1] = k[0];
                k[0] = Some(*m);
            }
        }
        let (from, to) = Self::slot(m);
        let h = &mut self.history[side as usize][from][to];
        *h += (depth * depth) as i32;
        if *h > HISTORY_MAX {
            self.history.iter_mut().flatten().flatten().for_each(|v| *v /= 2);
        }
    }
}

/// Late move reductions apply from this remaining depth on, after this many moves have been
/// searched at the node; from `LMR_LATE_INDEX` on (at depth >= 6) the reduction is two plies.
const LMR_MIN_DEPTH: u32 = 3;
const LMR_MIN_INDEX: usize = 3;
const LMR_LATE_INDEX: usize = 8;

struct Search<'a> {
    seen: &'a HashSet<u64>,
    tt: &'a mut Tt,
    use_tt: bool,
    /// Killer moves and history ordering for quiet moves (off: quiets in generation order).
    order: Ordering,
    use_order: bool,
    /// Principal variation search (null windows after the first move) with late move reductions.
    use_pvs: bool,
    /// Probes that found this position's entry, and those that cut the node off.
    tt_hits: u64,
    tt_cuts: u64,
    /// Positions scored exactly by the endgame tables.
    tb_hits: u64,
    path: Vec<u64>,
    root_turn: Color,
    deadline: Instant,
    /// All nodes visited, quiescence included (drives the clock check).
    nodes: u64,
    /// Quiescence nodes only.
    qnodes: u64,
    stopped: bool,
}

impl Search<'_> {
    fn draw(&self, turn: Color) -> i32 {
        if turn == self.root_turn {
            -CONTEMPT
        } else {
            CONTEMPT
        }
    }

    /// The exact score of a KQK, KRK or KPK position from the engine's own tables, mate-distance
    /// relative to the root like every mate score. None outside the tables, or when the mate
    /// would not arrive before the fifty-move rule (then the search decides).
    fn table_score(&mut self, pos: &Chess, ply: i32) -> Option<i32> {
        let tb = endgame::probe(pos)?;
        let room = 100 - pos.halfmoves().min(100);
        let s = match tb {
            Tb::Win(d) | Tb::Loss(d) if d >= room => return None,
            Tb::Win(d) => MATE - (ply + d as i32),
            Tb::Loss(d) => -(MATE - (ply + d as i32)),
            Tb::Draw => self.draw(pos.turn()),
        };
        self.tb_hits += 1;
        Some(s)
    }

    fn out_of_time(&mut self) -> bool {
        if !self.stopped && self.nodes & 1023 == 0 && Instant::now() >= self.deadline {
            self.stopped = true;
        }
        self.stopped
    }

    /// Negamax alpha-beta. Scores are from the side to move's point of view.
    fn negamax(&mut self, pos: &Chess, depth: u32, ply: i32, mut alpha: i32, beta: i32) -> i32 {
        self.nodes += 1;
        if self.out_of_time() {
            return 0;
        }
        let h = hash(pos);
        if self.seen.contains(&h) || self.path.contains(&h) {
            return self.draw(pos.turn());
        }
        let mut moves = pos.legal_moves();
        if moves.is_empty() {
            return if pos.is_check() { -(MATE - ply) } else { self.draw(pos.turn()) };
        }
        if pos.halfmoves() >= 100 || pos.is_insufficient_material() {
            return self.draw(pos.turn());
        }
        if let Some(s) = self.table_score(pos, ply) {
            return s;
        }
        if depth == 0 {
            return self.quiesce(pos, ply, 0, alpha, beta);
        }
        // The repetition, fifty-move and mate checks above run before the probe, so a stored
        // score never hides a path-dependent draw at this node.
        let mut tt_move = None;
        if self.use_tt {
            if let Some(e) = self.tt.probe(h) {
                self.tt_hits += 1;
                tt_move = decode(e.mv, &moves);
                if e.depth as u32 >= depth {
                    let s = from_tt(e.score, ply);
                    let cut = match e.bound() {
                        EXACT => true,
                        LOWER => s >= beta,
                        _ => s <= alpha,
                    };
                    if cut {
                        self.tt_cuts += 1;
                        return s;
                    }
                }
            }
        }
        let alpha0 = alpha;
        if self.use_order {
            let side = pos.turn();
            let order = &self.order;
            moves.sort_by_cached_key(|m| -order.key(m, tt_move, side, ply));
        } else {
            moves.sort_unstable_by_key(|m| -order_key(m, tt_move));
        }
        self.path.push(h);
        let in_check = pos.is_check();
        let mut best = -INF;
        let mut best_move = None;
        for (i, m) in moves.iter().enumerate() {
            let mut child = pos.clone();
            child.play_unchecked(*m);
            let s = if i == 0 || !self.use_pvs {
                -self.negamax(&child, depth - 1, ply + 1, -beta, -alpha)
            } else {
                // Principal variation search: a later move only has to prove it is no better
                // than alpha, so it gets a null window; a fail-high inside (alpha, beta) is
                // re-searched with the full window. Late quiet moves are first searched shallower.
                let r = if self.use_pvs
                    && depth >= LMR_MIN_DEPTH
                    && !in_check
                    && i >= LMR_MIN_INDEX
                    && is_quiet(m)
                    && Some(*m) != tt_move
                    && !self.order.is_killer(m, ply)
                    && !child.is_check()
                {
                    if depth >= 6 && i >= LMR_LATE_INDEX {
                        2
                    } else {
                        1
                    }
                } else {
                    0
                };
                let mut v = -self.negamax(&child, depth - 1 - r, ply + 1, -alpha - 1, -alpha);
                if r > 0 && v > alpha && !self.stopped {
                    v = -self.negamax(&child, depth - 1, ply + 1, -alpha - 1, -alpha);
                }
                if v > alpha && v < beta && !self.stopped {
                    v = -self.negamax(&child, depth - 1, ply + 1, -beta, -alpha);
                }
                v
            };
            if self.stopped {
                break;
            }
            if s > best {
                best = s;
                best_move = Some(*m);
                if s > alpha {
                    alpha = s;
                    if alpha >= beta {
                        if self.use_order && is_quiet(m) {
                            self.order.cutoff(m, pos.turn(), ply, depth);
                        }
                        break;
                    }
                }
            }
        }
        self.path.pop();
        if self.use_tt && !self.stopped {
            let bound = if best <= alpha0 {
                UPPER
            } else if best >= beta {
                LOWER
            } else {
                EXACT
            };
            self.tt.store(h, depth, ply, best, bound, best_move);
        }
        best
    }

    /// Quiescence search at the alpha-beta leaves: settle captures before trusting the static
    /// evaluation. Out of check the side to move may stand pat on `evaluate`; then only captures
    /// and queen promotions are searched, MVV-LVA first, with delta pruning outside late
    /// endgames. In check there is no standing pat: every evasion is searched so mates are seen.
    fn quiesce(&mut self, pos: &Chess, ply: i32, qply: i32, mut alpha: i32, beta: i32) -> i32 {
        self.nodes += 1;
        self.qnodes += 1;
        if self.out_of_time() {
            return 0;
        }
        if let Some(s) = self.table_score(pos, ply) {
            return s;
        }
        let in_check = pos.is_check();
        if qply >= MAX_QPLY {
            return evaluate(pos);
        }
        let mut moves = pos.legal_moves();
        if in_check && moves.is_empty() {
            return -(MATE - ply);
        }
        let mut best = -INF;
        let mut stand = -INF;
        if !in_check {
            if pos.is_insufficient_material() {
                return self.draw(pos.turn());
            }
            stand = evaluate(pos);
            if stand >= beta {
                return stand;
            }
            best = stand;
            alpha = alpha.max(stand);
            moves.retain(|m| match m.promotion() {
                Some(p) => p == Role::Queen,
                None => m.is_capture(),
            });
        }
        moves.sort_unstable_by_key(|m| -order_key(m, None));
        let delta = !in_check && phase(pos) > ENDGAME_PHASE;
        for m in &moves {
            if delta {
                let gain = m.capture().map_or(0, value)
                    + m.promotion().map_or(0, |p| value(p) - value(Role::Pawn));
                if stand + gain + DELTA_MARGIN < alpha {
                    continue;
                }
            }
            let mut child = pos.clone();
            child.play_unchecked(*m);
            let s = -self.quiesce(&child, ply + 1, qply + 1, -beta, -alpha);
            if self.stopped {
                break;
            }
            if s > best {
                best = s;
                if s > alpha {
                    alpha = s;
                    if alpha >= beta {
                        break;
                    }
                }
            }
        }
        best
    }

    /// One full-width iteration at the root. Returns the best move and its score, or None if the
    /// clock ran out before the iteration finished.
    fn root(&mut self, pos: &Chess, moves: &[Move], depth: u32) -> Option<(Move, i32)> {
        let mut alpha = -INF;
        let mut best = None;
        self.path.push(hash(pos));
        for m in moves {
            let mut child = pos.clone();
            child.play_unchecked(*m);
            let s = -self.negamax(&child, depth - 1, 1, -INF, -alpha);
            if self.stopped {
                break;
            }
            if s > alpha {
                alpha = s;
                best = Some((*m, s));
            }
        }
        self.path.pop();
        if self.stopped {
            None
        } else {
            best
        }
    }
}

/// Result of a search: the move to play, its score, and the deepest completed depth.
struct Outcome {
    best: Move,
    score: i32,
    depth: u32,
    nodes: u64,
    qnodes: u64,
    tt_hits: u64,
    tt_cuts: u64,
    tb_hits: u64,
}

/// Iterative deepening: depth 1, 2, 3, ... until the clock says stop. Always returns the best move
/// of the last completed depth. Stops searching by 60% of the budget, and does not start a depth it
/// is unlikely to finish.
fn search(pos: &Chess, seen: &HashSet<u64>, budget_ms: u64) -> Option<Outcome> {
    let hard = Duration::from_millis(budget_ms * 6 / 10);
    let soft = Duration::from_millis(budget_ms * 3 / 10);
    TT.with(|tt| run(pos, seen, hard, soft, MAX_DEPTH, &mut tt.borrow_mut(), true, true, true))
}

/// Fixed-depth search with no clock and a fresh table: deterministic, for tests and measurement.
#[cfg(test)]
fn search_depth(pos: &Chess, seen: &HashSet<u64>, depth: u32) -> Option<Outcome> {
    search_depth_with(pos, seen, depth, &mut Tt::new(16), true)
}

/// Fixed-depth search on a given table, with the table on or off.
#[cfg(test)]
fn search_depth_with(pos: &Chess, seen: &HashSet<u64>, depth: u32, tt: &mut Tt, use_tt: bool) -> Option<Outcome> {
    search_depth_feats(pos, seen, depth, tt, use_tt, true, true)
}

/// Fixed-depth search with the table and the killer/history ordering each on or off.
#[cfg(test)]
fn search_depth_opts(
    pos: &Chess,
    seen: &HashSet<u64>,
    depth: u32,
    tt: &mut Tt,
    use_tt: bool,
    use_order: bool,
) -> Option<Outcome> {
    search_depth_feats(pos, seen, depth, tt, use_tt, use_order, false)
}

/// Fixed-depth search with the table, the ordering and PVS + LMR each on or off.
#[cfg(test)]
fn search_depth_feats(
    pos: &Chess,
    seen: &HashSet<u64>,
    depth: u32,
    tt: &mut Tt,
    use_tt: bool,
    use_order: bool,
    use_pvs: bool,
) -> Option<Outcome> {
    let day = Duration::from_secs(86_400);
    run(pos, seen, day, day, depth, tt, use_tt, use_order, use_pvs)
}

/// Iterative deepening up to `max_depth`, stopping at `hard` and not starting a depth after `soft`.
fn run(
    pos: &Chess,
    seen: &HashSet<u64>,
    hard: Duration,
    soft: Duration,
    max_depth: u32,
    tt: &mut Tt,
    use_tt: bool,
    use_order: bool,
    use_pvs: bool,
) -> Option<Outcome> {
    let start = Instant::now();
    let mut moves: Vec<Move> = pos.legal_moves().into_iter().collect();
    tt.new_search(pos.turn());
    // The root is never cut off; its stored move (from the previous `go`) only orders.
    let tt_move = if use_tt { tt.probe(hash(pos)).and_then(|e| decode(e.mv, &moves)) } else { None };
    moves.sort_by_key(|m| -order_key(m, tt_move));
    let first = *moves.first()?;
    let mut out = Outcome { best: first, score: 0, depth: 0, nodes: 0, qnodes: 0, tt_hits: 0, tt_cuts: 0, tb_hits: 0 };
    if moves.len() == 1 {
        return Some(out);
    }
    let mut s = Search {
        seen,
        tt,
        use_tt,
        order: Ordering::new(),
        use_order,
        use_pvs,
        tt_hits: 0,
        tt_cuts: 0,
        tb_hits: 0,
        path: Vec::with_capacity(MAX_DEPTH as usize + 1),
        root_turn: pos.turn(),
        deadline: start + hard,
        nodes: 0,
        qnodes: 0,
        stopped: false,
    };
    for depth in 1..=max_depth {
        let Some((m, score)) = s.root(pos, &moves, depth) else { break };
        out = Outcome { best: m, score, depth, ..out };
        if use_tt {
            s.tt.store(hash(pos), depth, 0, score, EXACT, Some(m));
        }
        // Best move first for the next iteration.
        if let Some(i) = moves.iter().position(|x| *x == m) {
            moves[..=i].rotate_right(1);
        }
        // A mate inside the searched depth cannot be beaten by searching deeper. A longer one can:
        // the endgame tables score mates far beyond the horizon, and a shorter mate may still exist.
        let mate_in = MATE - score.abs();
        if (score.abs() > MATE_BOUND && mate_in <= depth as i32) || start.elapsed() >= soft {
            break;
        }
    }
    out.nodes = s.nodes;
    out.qnodes = s.qnodes;
    out.tt_hits = s.tt_hits;
    out.tt_cuts = s.tt_cuts;
    out.tb_hits = s.tb_hits;
    Some(out)
}

/// Pick a move for the side to move, given the moves so far (used by the self-play test).
#[cfg(test)]
fn choose(moves: &[String], budget_ms: u64) -> Option<String> {
    let (pos, seen) = replay(moves)?;
    let out = search(&pos, &seen, budget_ms)?;
    Some(UciMove::from_standard(out.best).to_string())
}

/// Handles one protocol line, returning the reply to print (if any) and whether to quit.
fn handle(line: &str, moves: &mut Vec<String>) -> (Option<String>, bool) {
    let mut parts = line.split_whitespace();
    match parts.next() {
        Some("game") => {
            TT.with(|tt| tt.borrow_mut().clear());
            (Some("ready".into()), false)
        }
        Some("position") => {
            *moves = parts.map(String::from).collect();
            (None, false)
        }
        Some("go") => {
            let budget = parts.next().and_then(|s| s.parse().ok()).unwrap_or(1000);
            let reply = match replay(moves).and_then(|(pos, seen)| search(&pos, &seen, budget)) {
                Some(o) => format!(
                    "info depth {} score {} nodes {} qnodes {} tthits {} ttcuts {} tbhits {}\nbestmove {}",
                    o.depth,
                    o.score,
                    o.nodes,
                    o.qnodes,
                    o.tt_hits,
                    o.tt_cuts,
                    o.tb_hits,
                    UciMove::from_standard(o.best)
                ),
                None => "bestmove 0000".into(),
            };
            (Some(reply), false)
        }
        Some("quit") => (None, true),
        _ => (None, false),
    }
}

fn main() {
    let stdin = io::stdin();
    let mut out = io::stdout();
    let mut moves = Vec::new();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let (reply, quit) = handle(&line, &mut moves);
        if let Some(r) = reply {
            writeln!(out, "{r}").ok();
            out.flush().ok();
        }
        if quit {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn moves(s: &str) -> Vec<String> {
        s.split_whitespace().map(String::from).collect()
    }

    fn best(s: &str) -> String {
        let mut mv = Vec::new();
        handle(&format!("position {s}"), &mut mv);
        let reply = handle("go 100", &mut mv).0.unwrap();
        let last = reply.lines().last().unwrap();
        last.strip_prefix("bestmove ").unwrap().to_string()
    }

    fn is_legal_after(s: &str, uci: &str) -> bool {
        let (pos, _) = replay(&moves(s)).unwrap();
        uci.parse::<UciMove>()
            .ok()
            .and_then(|u| u.to_move(&pos).ok())
            .is_some()
    }

    #[test]
    fn handshake_and_position() {
        let mut mv = Vec::new();
        assert_eq!(handle("game chess", &mut mv).0.as_deref(), Some("ready"));
        handle("position e2e4 e7e5", &mut mv);
        assert_eq!(mv, vec!["e2e4", "e7e5"]);
        assert!(handle("go 100", &mut mv).0.unwrap().lines().any(|l| l.starts_with("bestmove ")));
        assert!(handle("quit", &mut mv).1);
    }

    #[test]
    fn opening_move_is_legal() {
        let m = best("");
        assert!(is_legal_after("", &m), "{m}");
    }

    #[test]
    fn castling_prints_king_move() {
        // White can castle kingside; the referee expects e1g1, never e1h1.
        let s = "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6";
        let (pos, _) = replay(&moves(s)).unwrap();
        let castles: Vec<String> = pos
            .legal_moves()
            .iter()
            .filter(|m| m.is_castle())
            .map(|m| UciMove::from_standard(*m).to_string())
            .collect();
        assert_eq!(castles, vec!["e1g1"]);
        // Parsing castling from the referee works too.
        assert!(replay(&moves(&format!("{s} e1g1"))).is_some());
    }

    #[test]
    fn promotion_has_suffix_and_is_preferred() {
        // White pawn walks to a7 while black shuffles; b8 knight captured on the way.
        let s = "a2a4 h7h6 a4a5 h6h5 a5a6 g7g6 a6b7 g6g5";
        let m = best(s);
        assert!(m == "b7a8q" || m == "b7c8q", "{m}");
        assert!(is_legal_after(s, &m));
    }

    #[test]
    fn en_passant_is_found_and_parsed() {
        let s = "e2e4 a7a6 e4e5 d7d5";
        let (pos, _) = replay(&moves(s)).unwrap();
        let ep: Vec<String> = pos
            .legal_moves()
            .iter()
            .filter(|m| m.is_en_passant())
            .map(|m| UciMove::from_standard(*m).to_string())
            .collect();
        assert_eq!(ep, vec!["e5d6"]);
        assert!(replay(&moves(&format!("{s} e5d6"))).is_some());
    }

    #[test]
    fn takes_mate_in_one() {
        // Scholar's mate setup: Qxf7#.
        assert_eq!(best("e2e4 e7e5 d1h5 b8c6 f1c4 g8f6"), "h5f7");
    }

    #[test]
    fn terminal_position_does_not_panic() {
        // Fool's mate: white is checkmated, no legal move.
        assert_eq!(best("f2f3 e7e5 g2g4 d8h4"), "0000");
    }

    fn from_fen(fen: &str) -> Chess {
        let f: shakmaty::fen::Fen = fen.parse().unwrap();
        f.into_position(shakmaty::CastlingMode::Standard).unwrap()
    }

    #[test]
    fn legal_from_assorted_positions() {
        let fens = [
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
            "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
            "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
            "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2",
            "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
            "8/P6k/8/8/8/8/6pK/8 b - - 0 1",
            "4k3/4r3/8/8/8/8/3PPP2/4K3 w - - 0 1",
        ];
        for fen in fens {
            let pos = from_fen(fen);
            let out = search(&pos, &HashSet::new(), 100).unwrap();
            assert!(pos.is_legal(out.best), "{fen}: {:?}", out.best);
        }
    }

    #[test]
    fn finds_mate_in_two() {
        // Rook ladder: Ra7 (or Rb7) then the other rook mates on the back rank.
        let pos = from_fen("7k/8/8/8/8/8/1R6/R1K5 w - - 0 1");
        let out = search(&pos, &HashSet::new(), 1000).unwrap();
        assert_eq!(out.score, MATE - 3, "{:?}", out.best);
        let mut after = pos.clone();
        after.play_unchecked(out.best);
        assert!(!after.is_checkmate());
        // Every defence loses to a mate in one.
        for reply in after.legal_moves() {
            let mut p = after.clone();
            p.play_unchecked(reply);
            let o = search(&p, &HashSet::new(), 500).unwrap();
            assert_eq!(o.score, MATE - 1);
        }
    }

    #[test]
    fn prefers_shorter_mate() {
        // Qg7# mates at once; the score must say mate in one, not a longer mate.
        let pos = from_fen("7k/8/5KQ1/8/8/8/8/8 w - - 0 1");
        let out = search(&pos, &HashSet::new(), 500).unwrap();
        assert_eq!(out.score, MATE - 1, "{:?}", out.best);
    }

    #[test]
    fn stays_inside_budget_in_busy_middlegame() {
        let pos = from_fen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
        for budget in [50u64, 200, 500] {
            let t = Instant::now();
            let out = search(&pos, &HashSet::new(), budget).unwrap();
            let ms = t.elapsed().as_millis() as u64;
            assert!(ms < budget, "{ms} ms for a {budget} ms budget");
            assert!(out.depth >= 2, "depth {} at {budget} ms", out.depth);
        }
    }

    #[test]
    fn avoids_stalemating_a_lone_king() {
        // Qf7 or Qg6 would stalemate; with a queen up the engine must keep the game going.
        let pos = from_fen("7k/8/6K1/8/8/8/8/5Q2 w - - 0 1");
        let out = search(&pos, &HashSet::new(), 300).unwrap();
        let mut after = pos.clone();
        after.play_unchecked(out.best);
        assert!(!after.legal_moves().is_empty() || after.is_checkmate());
    }

    #[test]
    fn depth_one_does_not_hang_the_queen() {
        // Qxd5 wins a pawn on the static eval but exd5 takes the queen back; quiescence sees it.
        let pos = from_fen("4k3/8/4p3/3p4/8/8/8/3QK3 w - - 0 1");
        let out = search_depth(&pos, &HashSet::new(), 1).unwrap();
        assert_ne!(UciMove::from_standard(out.best).to_string(), "d1d5");
        assert!(out.qnodes > 0);
        // And it still takes a pawn that is truly loose.
        let pos = from_fen("4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1");
        let out = search_depth(&pos, &HashSet::new(), 1).unwrap();
        assert_eq!(UciMove::from_standard(out.best).to_string(), "d1d5");
    }

    #[test]
    fn quiescence_searches_evasions_in_check() {
        // Fixed depth 1: Qxf7 is mate (Scholar's); the leaf is in check, so quiescence must search
        // evasions (finding none) instead of standing pat on the material.
        let (pos, seen) = replay(&moves("e2e4 e7e5 d1h5 b8c6 f1c4 g8f6")).unwrap();
        let out = search_depth(&pos, &seen, 1).unwrap();
        assert_eq!(UciMove::from_standard(out.best).to_string(), "h5f7");
        assert_eq!(out.score, MATE - 1);
        // A quiet-looking leaf where the side to move is mated: qsearch in check finds no evasion.
        let mated = from_fen("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1");
        let mut tt = Tt::new(4);
        let mut s = Search {
            seen: &HashSet::new(),
            tt: &mut tt,
            use_tt: false,
            order: Ordering::new(),
            use_order: false,
            use_pvs: false,
            tt_hits: 0,
            tt_cuts: 0,
            tb_hits: 0,
            path: Vec::new(),
            root_turn: Color::White,
            deadline: Instant::now() + Duration::from_secs(86_400),
            nodes: 0,
            qnodes: 0,
            stopped: false,
        };
        assert_eq!(s.quiesce(&mated, 3, 0, -INF, INF), -(MATE - 3));
    }

    #[test]
    fn info_line_reports_quiescence_nodes() {
        let mut mv = Vec::new();
        handle("position e2e4 d7d5", &mut mv);
        let reply = handle("go 100", &mut mv).0.unwrap();
        let info = reply.lines().next().unwrap();
        assert!(info.starts_with("info depth ") && info.contains(" qnodes "), "{info}");
        assert!(info.contains(" tthits ") && info.contains(" ttcuts "), "{info}");
    }

    #[test]
    fn random_games_stay_legal() {
        // Self-play many plies with the engine; every move must parse back as legal.
        let mut hist: Vec<String> = Vec::new();
        for _ in 0..200 {
            let (pos, _) = replay(&hist).unwrap();
            if pos.is_game_over() {
                break;
            }
            let m = choose(&hist, 100).unwrap();
            assert!(is_legal_after(&hist.join(" "), &m), "{m} after {hist:?}");
            hist.push(m);
        }
    }

    /// Positions for the TT-on/off comparison: opening, open and closed middlegames, a tactical
    /// melee, endgames with pawns and a rook ending.
    const TT_FENS: [&str; 8] = [
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4",
        "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
        "r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 8",
        "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
        "8/8/4k3/3p4/3P4/4K3/8/8 w - - 0 1",
        "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1",
        "2r3k1/pp3ppp/4p3/3pP3/3P4/P4N2/1P3PPP/2R3K1 w - - 0 1",
    ];

    #[test]
    fn tt_keeps_move_and_score_with_fewer_nodes() {
        // Same fixed depth, table off vs on: the move and score must match and the table must
        // save nodes overall.
        let (mut off_nodes, mut on_nodes, mut cuts) = (0u64, 0u64, 0u64);
        for fen in TT_FENS {
            let pos = from_fen(fen);
            // Killer/history ordering off on both sides, so this measures the table alone.
            let off = search_depth_opts(&pos, &HashSet::new(), 4, &mut Tt::new(4), false, false).unwrap();
            let on = search_depth_opts(&pos, &HashSet::new(), 4, &mut Tt::new(18), true, false).unwrap();
            assert_eq!((off.best, off.score), (on.best, on.score), "{fen}");
            assert!(on.nodes <= off.nodes, "{fen}: {} vs {}", on.nodes, off.nodes);
            cuts += on.tt_cuts;
            off_nodes += off.nodes;
            on_nodes += on.nodes;
        }
        assert!(cuts > 0);
        assert!(on_nodes * 10 < off_nodes * 7, "{on_nodes} vs {off_nodes}");
    }

    #[test]
    fn mate_through_the_table_keeps_its_distance() {
        // Mate scores are stored node-relative and read back root-relative.
        let mut tt = Tt::new(8);
        tt.new_search(Color::White);
        tt.store(42, 3, 5, MATE - 7, EXACT, None); // mate 2 plies below a node at ply 5
        assert_eq!(from_tt(tt.probe(42).unwrap().score, 1), MATE - 3);
        tt.store(43, 3, 4, -(MATE - 6), EXACT, None);
        assert_eq!(from_tt(tt.probe(43).unwrap().score, 2), -(MATE - 4));

        // In a real search: this rook ladder is mate in three (MATE - 5). After white's first
        // move and black's best defence, the table already holds the positions below as mates
        // found from ply 2; a new search rooted there on the same table (same side to move, so
        // the table is kept) must cut them off and still report mate in two (MATE - 3), exactly
        // as a fresh table does.
        let pos = from_fen("8/8/7k/8/8/8/1R6/R1K5 w - - 0 1");
        let mut tt = Tt::new(16);
        let out = search_depth_with(&pos, &HashSet::new(), 6, &mut tt, true).unwrap();
        assert_eq!(out.score, MATE - 5);
        let mut after = pos.clone();
        after.play_unchecked(out.best);
        let defence = search_depth(&after, &HashSet::new(), 5).unwrap();
        assert_eq!(defence.score, -(MATE - 4));
        after.play_unchecked(defence.best);
        let reused = search_depth_with(&after, &HashSet::new(), 4, &mut tt, true).unwrap();
        let fresh = search_depth(&after, &HashSet::new(), 4).unwrap();
        assert!(reused.tt_cuts > 0);
        assert_eq!(reused.score, MATE - 3);
        assert_eq!(fresh.score, MATE - 3);
    }

    #[test]
    fn stored_moves_are_checked_for_legality() {
        // A code that matches no legal move decodes to nothing; a legal one round-trips,
        // promotions and castling included.
        let pos = from_fen("r3k2r/1P6/8/8/8/8/8/R3K2R w KQkq - 0 1");
        let moves: Vec<Move> = pos.legal_moves().into_iter().collect();
        for m in &moves {
            assert_eq!(decode(encode(m), &moves), Some(*m));
        }
        assert_eq!(decode(0, &moves), None);
        let other = from_fen("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
        let few: Vec<Move> = other.legal_moves().into_iter().collect();
        let promo = moves.iter().find(|m| m.promotion().is_some()).unwrap();
        assert_eq!(decode(encode(promo), &few), None);
    }

    #[test]
    #[ignore = "measurement: cargo test --release -p chess-engine tt_report -- --ignored --nocapture"]
    fn tt_report() {
        for depth in [3u32, 4, 5] {
            let (mut off_n, mut on_n, mut same) = (0u64, 0u64, 0);
            for fen in TT_FENS {
                let pos = from_fen(fen);
                let off = search_depth_with(&pos, &HashSet::new(), depth, &mut Tt::new(4), false).unwrap();
                let on = search_depth_with(&pos, &HashSet::new(), depth, &mut Tt::new(TT_BITS), true).unwrap();
                if (off.best, off.score) == (on.best, on.score) {
                    same += 1;
                } else {
                    println!("  d{depth} differs {fen}: off {:?} {} on {:?} {}", off.best, off.score, on.best, on.score);
                }
                off_n += off.nodes;
                on_n += on.nodes;
            }
            println!("depth {depth}: nodes off {off_n} on {on_n} ({:+.1}%), same {same}/8", 100.0 * (on_n as f64 / off_n as f64 - 1.0));
        }
        for (name, fen) in [("start", TT_FENS[0]), ("middlegame", TT_FENS[2]), ("italian", TT_FENS[1])] {
            let pos = from_fen(fen);
            let hard = Duration::from_millis(120);
            let soft = Duration::from_millis(60);
            let off = run(&pos, &HashSet::new(), hard, soft, MAX_DEPTH, &mut Tt::new(4), false, true, true).unwrap();
            let on = run(&pos, &HashSet::new(), hard, soft, MAX_DEPTH, &mut Tt::new(TT_BITS), true, true, true).unwrap();
            println!("go 200 {name}: off depth {} nodes {} | on depth {} nodes {} hits {} cuts {}", off.depth, off.nodes, on.depth, on.nodes, on.tt_hits, on.tt_cuts);
        }
    }

    #[test]
    fn ordering_keeps_move_and_score_with_fewer_nodes() {
        // Same fixed depth and table, killers/history off vs on: ordering must not change the
        // minimax result, and it must save nodes overall.
        let (mut off_nodes, mut on_nodes) = (0u64, 0u64);
        for fen in TT_FENS {
            let pos = from_fen(fen);
            let off = search_depth_opts(&pos, &HashSet::new(), 5, &mut Tt::new(18), true, false).unwrap();
            let on = search_depth_opts(&pos, &HashSet::new(), 5, &mut Tt::new(18), true, true).unwrap();
            assert_eq!(off.score, on.score, "{fen}");
            off_nodes += off.nodes;
            on_nodes += on.nodes;
        }
        assert!(on_nodes < off_nodes, "{on_nodes} vs {off_nodes}");
    }

    #[test]
    fn ordering_keeps_tactical_results() {
        // The fixed-depth tactical positions give the same move and score with ordering on or off.
        let cases: [(&str, u32); 5] = [
            ("7k/8/8/8/8/8/1R6/R1K5 w - - 0 1", 4),
            ("7k/8/5KQ1/8/8/8/8/8 w - - 0 1", 3),
            ("4k3/8/4p3/3p4/8/8/8/3QK3 w - - 0 1", 3),
            ("8/8/7k/8/8/8/1R6/R1K5 w - - 0 1", 6),
            ("7k/8/6K1/8/8/8/8/5Q2 w - - 0 1", 4),
        ];
        for (fen, depth) in cases {
            let pos = from_fen(fen);
            let off = search_depth_opts(&pos, &HashSet::new(), depth, &mut Tt::new(16), true, false).unwrap();
            let on = search_depth_opts(&pos, &HashSet::new(), depth, &mut Tt::new(16), true, true).unwrap();
            assert_eq!((off.best, off.score), (on.best, on.score), "{fen}");
        }
    }

    #[test]
    fn killers_and_history_record_quiet_cutoffs_only() {
        let pos = from_fen("r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4");
        let moves: Vec<Move> = pos.legal_moves().into_iter().collect();
        let quiet = *moves.iter().find(|m| is_quiet(m)).unwrap();
        let capture = *moves.iter().find(|m| m.is_capture()).unwrap();
        let mut o = Ordering::new();
        o.cutoff(&quiet, Color::Black, 3, 4);
        assert_eq!(o.key(&quiet, None, Color::Black, 3), KILLER_KEY[0]);
        // Another ply: not a killer there, so the history score (4*4) orders it.
        assert_eq!(o.key(&quiet, None, Color::Black, 4), 16);
        // Captures keep their MVV-LVA key above any killer; the TT move stays first.
        assert!(o.key(&capture, None, Color::Black, 3) > KILLER_KEY[0]);
        assert_eq!(o.key(&quiet, Some(quiet), Color::Black, 3), i32::MAX);
        // A second killer pushes the first into slot two.
        let other = *moves.iter().filter(|m| is_quiet(m)).nth(1).unwrap();
        o.cutoff(&other, Color::Black, 3, 2);
        assert_eq!(o.key(&other, None, Color::Black, 3), KILLER_KEY[0]);
        assert_eq!(o.key(&quiet, None, Color::Black, 3), KILLER_KEY[1]);
        // History is halved before it can climb into the killer keys.
        for _ in 0..100 {
            o.cutoff(&quiet, Color::Black, 10, 64);
        }
        assert!(o.key(&quiet, None, Color::Black, 4) <= HISTORY_MAX);
    }

    #[test]
    #[ignore = "measurement: cargo test --release -p chess-engine order_report -- --ignored --nocapture"]
    fn order_report() {
        for depth in [4u32, 5, 6] {
            let (mut off_n, mut on_n, mut same) = (0u64, 0u64, 0);
            for fen in TT_FENS {
                let pos = from_fen(fen);
                let off = search_depth_opts(&pos, &HashSet::new(), depth, &mut Tt::new(TT_BITS), true, false).unwrap();
                let on = search_depth_opts(&pos, &HashSet::new(), depth, &mut Tt::new(TT_BITS), true, true).unwrap();
                if (off.best, off.score) == (on.best, on.score) {
                    same += 1;
                } else {
                    println!("  d{depth} differs {fen}: off {:?} {} on {:?} {}", off.best, off.score, on.best, on.score);
                }
                println!("  d{depth} {fen}: off {} on {}", off.nodes, on.nodes);
                off_n += off.nodes;
                on_n += on.nodes;
            }
            println!("depth {depth}: nodes off {off_n} on {on_n} ({:+.1}%), same {same}/8", 100.0 * (on_n as f64 / off_n as f64 - 1.0));
        }
        for (name, fen) in [("start", TT_FENS[0]), ("italian", TT_FENS[1]), ("kiwipete", TT_FENS[2])] {
            let pos = from_fen(fen);
            let hard = Duration::from_millis(120);
            let soft = Duration::from_millis(60);
            let off = run(&pos, &HashSet::new(), hard, soft, MAX_DEPTH, &mut Tt::new(TT_BITS), true, false, false).unwrap();
            let on = run(&pos, &HashSet::new(), hard, soft, MAX_DEPTH, &mut Tt::new(TT_BITS), true, true, false).unwrap();
            println!("go 200 {name}: off depth {} nodes {} | on depth {} nodes {}", off.depth, off.nodes, on.depth, on.nodes);
        }
    }

    #[test]
    fn pvs_and_lmr_keep_results_near_the_full_search() {
        // Fixed depth 5, ordering on, PVS + LMR off vs on: reductions may change the move only
        // where it scores within a small margin of the unreduced result, and must save nodes.
        let (mut off_nodes, mut on_nodes) = (0u64, 0u64);
        for fen in TT_FENS {
            let pos = from_fen(fen);
            let off = search_depth_feats(&pos, &HashSet::new(), 5, &mut Tt::new(18), true, true, false).unwrap();
            let on = search_depth_feats(&pos, &HashSet::new(), 5, &mut Tt::new(18), true, true, true).unwrap();
            assert!((off.score - on.score).abs() <= 40, "{fen}: off {} on {}", off.score, on.score);
            off_nodes += off.nodes;
            on_nodes += on.nodes;
        }
        assert!(on_nodes < off_nodes, "{on_nodes} vs {off_nodes}");
    }

    #[test]
    fn pvs_and_lmr_keep_mates() {
        // Mate in two (and the other tactical cases) are found with the same move and score.
        let cases: [(&str, u32); 5] = [
            ("7k/8/8/8/8/8/1R6/R1K5 w - - 0 1", 4),
            ("7k/8/5KQ1/8/8/8/8/8 w - - 0 1", 3),
            ("4k3/8/4p3/3p4/8/8/8/3QK3 w - - 0 1", 3),
            ("8/8/7k/8/8/8/1R6/R1K5 w - - 0 1", 6),
            ("7k/8/6K1/8/8/8/8/5Q2 w - - 0 1", 4),
        ];
        for (fen, depth) in cases {
            let pos = from_fen(fen);
            let off = search_depth_feats(&pos, &HashSet::new(), depth, &mut Tt::new(16), true, true, false).unwrap();
            let on = search_depth_feats(&pos, &HashSet::new(), depth, &mut Tt::new(16), true, true, true).unwrap();
            assert_eq!(off.score, on.score, "{fen}");
            if off.score.abs() > MATE_BOUND {
                assert_eq!(off.best, on.best, "{fen}");
            }
        }
        let pos = from_fen("7k/8/8/8/8/8/1R6/R1K5 w - - 0 1");
        let out = search_depth(&pos, &HashSet::new(), 4).unwrap();
        assert_eq!(out.score, MATE - 3);
    }

    #[test]
    #[ignore = "measurement: cargo test --release -p chess-engine pvs_report -- --ignored --nocapture"]
    fn pvs_report() {
        // v0.4 = TT only; +order = killers/history; full = ordering + PVS + LMR.
        for depth in [5u32, 6] {
            let (mut base_n, mut ord_n, mut full_n, mut same) = (0u64, 0u64, 0u64, 0);
            for fen in TT_FENS {
                let pos = from_fen(fen);
                let base = search_depth_feats(&pos, &HashSet::new(), depth, &mut Tt::new(TT_BITS), true, false, false).unwrap();
                let ord = search_depth_feats(&pos, &HashSet::new(), depth, &mut Tt::new(TT_BITS), true, true, false).unwrap();
                let full = search_depth_feats(&pos, &HashSet::new(), depth, &mut Tt::new(TT_BITS), true, true, true).unwrap();
                if (base.best, base.score) == (full.best, full.score) {
                    same += 1;
                } else {
                    println!("  d{depth} differs {fen}: v0.4 {:?} {} full {:?} {}", base.best, base.score, full.best, full.score);
                }
                base_n += base.nodes;
                ord_n += ord.nodes;
                full_n += full.nodes;
            }
            println!("depth {depth}: nodes v0.4 {base_n} +order {ord_n} full {full_n} ({:+.1}%), same {same}/8", 100.0 * (full_n as f64 / base_n as f64 - 1.0));
        }
        for (name, fen) in [("start", TT_FENS[0]), ("italian", TT_FENS[1]), ("kiwipete", TT_FENS[2])] {
            let pos = from_fen(fen);
            let hard = Duration::from_millis(120);
            let soft = Duration::from_millis(60);
            let base = run(&pos, &HashSet::new(), hard, soft, MAX_DEPTH, &mut Tt::new(TT_BITS), true, false, false).unwrap();
            let full = run(&pos, &HashSet::new(), hard, soft, MAX_DEPTH, &mut Tt::new(TT_BITS), true, true, true).unwrap();
            println!("go 200 {name}: v0.4 depth {} nodes {} | full depth {} nodes {}", base.depth, base.nodes, full.depth, full.nodes);
        }
    }

    /// A random three-piece position: White king and `role`, Black king, White to move, or None if
    /// the rules library rejects it.
    fn three_pieces(role: Role, rng: &mut u64) -> Option<Chess> {
        let mut next = || {
            *rng ^= *rng << 13;
            *rng ^= *rng >> 7;
            *rng ^= *rng << 17;
            (*rng % 64) as u32
        };
        let (k, x, w) = (next(), next(), next());
        if k == x || k == w || x == w || (role == Role::Pawn && !(8..56).contains(&x)) {
            return None;
        }
        let mut board = shakmaty::Board::empty();
        board.set_piece_at(shakmaty::Square::new(k), shakmaty::Piece { color: Color::White, role: Role::King });
        board.set_piece_at(shakmaty::Square::new(x), shakmaty::Piece { color: Color::White, role });
        board.set_piece_at(shakmaty::Square::new(w), shakmaty::Piece { color: Color::Black, role: Role::King });
        let mut setup = shakmaty::Setup::empty();
        setup.board = board;
        use shakmaty::FromSetup;
        Chess::from_setup(setup, shakmaty::CastlingMode::Standard).ok()
    }

    #[test]
    fn tables_convert_against_a_random_mover() {
        // From random won KQK, KRK and KPK starts, the engine (depth 2) mates a random mover
        // within the table's distance and inside the fifty-move rule.
        let mut rng = 0x9E37_79B9_7F4A_7C15u64;
        for role in [Role::Queen, Role::Rook, Role::Pawn] {
            let mut games = 0;
            while games < 25 {
                let Some(mut pos) = three_pieces(role, &mut rng) else { continue };
                let Some(Tb::Win(dtm)) = endgame::probe(&pos) else { continue };
                games += 1;
                let mut seen = HashSet::from([hash(&pos)]);
                let mut plies = 0;
                while !pos.is_game_over() {
                    let m = if pos.turn() == Color::White {
                        let out = search_depth(&pos, &seen, 2).unwrap();
                        assert!(out.score > MATE_BOUND, "{role:?} {}: lost the win", shakmaty::fen::Fen::from_position(&pos, EnPassantMode::Legal));
                        out.best
                    } else {
                        let moves = pos.legal_moves();
                        rng ^= rng << 13;
                        rng ^= rng >> 7;
                        rng ^= rng << 17;
                        moves[(rng % moves.len() as u64) as usize]
                    };
                    pos.play_unchecked(m);
                    seen.insert(hash(&pos));
                    plies += 1;
                    assert!(pos.halfmoves() < 100);
                }
                assert!(pos.is_checkmate() && pos.turn() == Color::Black, "{role:?}: no mate");
                assert!(plies <= dtm, "{role:?}: mate took {plies} plies, table said {dtm}");
            }
        }
    }

    #[test]
    fn search_reports_the_table_distance() {
        // KRK, longest-class position: the root score is the table's exact mate distance, and the
        // defending side's score is the mirror image.
        let mut rng = 7u64;
        let mut checked = 0;
        while checked < 30 {
            let Some(pos) = three_pieces(Role::Rook, &mut rng) else { continue };
            let Some(Tb::Win(d)) = endgame::probe(&pos) else { continue };
            if d < 3 {
                continue;
            }
            let out = search_depth(&pos, &HashSet::new(), 1).unwrap();
            assert_eq!(out.score, MATE - d as i32);
            checked += 1;
        }
        // Four pieces: KQ vs KR. The search wins the rook through the table (a skewer).
        let pos = from_fen("3k4/8/3K4/8/8/8/r7/7Q w - - 0 1");
        let out = search_depth(&pos, &HashSet::new(), 4).unwrap();
        assert!(out.score > MATE_BOUND, "score {}", out.score);
    }
}
