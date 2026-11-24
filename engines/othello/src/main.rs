//! othello engine for Swarm Arena.
//! Rules: the `othello` crate. Search and evaluation: written by the swarm.
//! Protocol and library policy: ../PROTOCOL.md.

mod book;

use othello::Game;
use std::io::{self, BufRead, Write};
use std::time::{Duration, Instant};

const CORNERS: u64 = 1 | 1 << 7 | 1 << 56 | 1 << 63;

/// `a1` is top-left: index = (row - 1) * 8 + column, which is the crate's own bit layout.
fn parse_square(m: &str) -> Option<usize> {
    let b = m.as_bytes();
    if b.len() != 2 || !(b'a'..=b'h').contains(&b[0]) || !(b'1'..=b'8').contains(&b[1]) {
        return None;
    }
    Some((b[1] - b'1') as usize * 8 + (b[0] - b'a') as usize)
}

fn square_name(i: usize) -> String {
    format!("{}{}", (b'a' + (i % 8) as u8) as char, i / 8 + 1)
}

/// Replays the game from the start. Returns None on an illegal move.
fn replay(moves: &[String]) -> Option<Game> {
    let mut g = Game::default();
    for m in moves {
        if m == "pass" {
            if g.available_moves() != 0 {
                return None;
            }
            g.pass_move();
        } else {
            g = g.make_move(parse_square(m)?)?;
        }
    }
    Some(g)
}

// X-squares (b2 g2 b7 g7) and C-squares, each paired with the corner it touches.
const X_SQUARES: [(usize, usize); 4] = [(9, 0), (14, 7), (49, 56), (54, 63)];
const C_SQUARES: [(usize, usize); 8] =
    [(1, 0), (8, 0), (6, 7), (15, 7), (48, 56), (57, 56), (55, 63), (62, 63)];

const CORNER_W: i32 = 30;
const MOBILITY_W: i32 = 4;
const X_W: i32 = 18;
const C_W: i32 = 8;
/// Potential mobility: per square of difference, scaled by empties / 60 (2 in the opening,
/// fading to 0 as the board fills, where real mobility and stability take over).
const POTMOB_W: i32 = 2;
/// Edge-anchored stable disc, flat per disc (well below a corner's 30). Tuning with local
/// matches found larger or phase-growing weights lost to v0.2; see the playbook.
const STABLE_W: i32 = 2;
/// Terminal scores sit far above any heuristic score.
const WIN: i32 = 100_000;
const INF: i32 = 1_000_000;

const NOT_A: u64 = 0xfefe_fefe_fefe_fefe; // clears column a (bit 0 of each row)
const NOT_H: u64 = 0x7f7f_7f7f_7f7f_7f7f; // clears column h

/// Every square 8-adjacent to a square in `b`.
fn neighbours(b: u64) -> u64 {
    let ew = ((b << 1) & NOT_A) | ((b >> 1) & NOT_H);
    let row = b | ew;
    ew | (row << 8) | (row >> 8)
}

/// Potential mobility against `other`: the empty squares 8-adjacent to at least one of its
/// discs (where a later move by the side owning the count may flip something). More is better.
fn potential_mobility(other: u64, empty: u64) -> u64 {
    empty & neighbours(other)
}

const ROWS_18: u64 = 0xff | 0xff << 56;
const COLS_AH: u64 = 0x8181_8181_8181_8181;
const EDGE_MASKS: [u64; 4] = [0xff, 0xff << 56, 0x0101_0101_0101_0101, 0x8080_8080_8080_8080];

/// Edge-anchored stable discs of `own`: from each owned corner, the contiguous run of `own`
/// discs along both of its edges; a completely filled edge is stable in full (an edge disc can
/// only be flipped along its edge, and a full edge has no empty square to flip from).
/// Bitboard flood: grow from the owned corners one edge step at a time.
fn edge_stable(own: u64, occupied: u64) -> u64 {
    let mut st = own & CORNERS;
    for &line in &EDGE_MASKS {
        if occupied & line == line {
            st |= own & line;
        }
    }
    if st == 0 {
        return 0;
    }
    let edge_own = own & (ROWS_18 | COLS_AH);
    loop {
        let along_rows = ((st << 1) & NOT_A | (st >> 1) & NOT_H) & ROWS_18;
        let along_cols = ((st << 8) | (st >> 8)) & COLS_AH;
        let next = st | (edge_own & (along_rows | along_cols));
        if next == st {
            return st;
        }
        st = next;
    }
}

/// Static evaluation from the side to move's point of view. Original terms: corner ownership,
/// mobility difference, a penalty for X/C-squares next to a still-empty corner, potential
/// mobility (scaled down as the board fills), and edge-anchored stable discs.
fn evaluate(g: &Game) -> i32 {
    let [me, opp] = g.get();
    let occupied = me | opp;
    let empty = !occupied;
    let empties = empty.count_ones() as i32;
    let mut s = CORNER_W * ((me & CORNERS).count_ones() as i32 - (opp & CORNERS).count_ones() as i32);
    let mut o = g.clone();
    o.pass_move();
    s += MOBILITY_W * (g.available_moves().count_ones() as i32 - o.available_moves().count_ones() as i32);
    for &(x, c) in &X_SQUARES {
        if empty >> c & 1 == 1 {
            s -= X_W * ((me >> x & 1) as i32 - (opp >> x & 1) as i32);
        }
    }
    for &(sq, c) in &C_SQUARES {
        if empty >> c & 1 == 1 {
            s -= C_W * ((me >> sq & 1) as i32 - (opp >> sq & 1) as i32);
        }
    }
    let pm = potential_mobility(opp, empty).count_ones() as i32 - potential_mobility(me, empty).count_ones() as i32;
    s += POTMOB_W * pm * empties / 60;
    if occupied & CORNERS != 0 {
        let st = edge_stable(me, occupied).count_ones() as i32 - edge_stable(opp, occupied).count_ones() as i32;
        s += STABLE_W * st;
    }
    s
}

/// Final score for the side to move once neither side can place: disc difference.
fn terminal(g: &Game) -> i32 {
    let [me, opp] = g.get();
    let d = me.count_ones() as i32 - opp.count_ones() as i32;
    d.signum() * WIN + d
}

/// Transposition-table size: 2^20 slots of 16 bytes = 16 MB.
const TT_BITS: u32 = 20;
const EXACT: u8 = 0;
const LOWER: u8 = 1;
const UPPER: u8 = 2;
/// Stored in `Entry::mv` when the node has no best move to remember.
const NO_MOVE: u8 = 64;

/// One table slot (16 bytes). `meta` packs the generation (high 6 bits) and the bound (low 2).
#[derive(Clone, Copy, Default)]
struct Entry {
    key: u64,
    score: i32,
    mv: u8,
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
    fn best(&self) -> Option<usize> {
        (self.mv < NO_MOVE).then_some(self.mv as usize)
    }
}

/// 64-bit key of a (mover, opponent) pair. A pass swaps the pair, so the side to move needs no
/// flag; the two halves go through different mixes so (a, b) and (b, a) differ.
fn tt_key(me: u64, opp: u64) -> u64 {
    fn mix(mut z: u64) -> u64 {
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }
    mix(me ^ 0x9e37_79b9_7f4a_7c15) ^ mix(opp.wrapping_add(0x632b_e59b_d9b4_e019)).rotate_left(17)
}

/// Always-indexed table keyed by the full 64-bit key (the stored key rejects index collisions;
/// a stored move is still checked against the legal moves before use). It lives across `go`
/// calls within a game: each search bumps the generation, a slot from an older generation is
/// always replaced, and within a generation the deeper result stays. Scores need no ply
/// adjustment: Othello's terminal scores are disc counts, not distances to mate.
struct Tt {
    entries: Vec<Entry>,
    mask: usize,
    generation: u8,
}

impl Tt {
    fn new(bits: u32) -> Tt {
        Tt { entries: Vec::new(), mask: (1 << bits) - 1, generation: 0 }
    }

    fn clear(&mut self) {
        self.entries.clear();
        self.generation = 0;
    }

    fn new_search(&mut self) {
        if self.entries.is_empty() {
            self.entries = vec![Entry::default(); self.mask + 1];
        }
        self.generation = (self.generation + 1) & 63;
    }

    fn probe(&self, key: u64) -> Option<Entry> {
        let e = *self.entries.get(key as usize & self.mask)?;
        (e.key == key && key != 0).then_some(e)
    }

    fn store(&mut self, key: u64, depth: u32, score: i32, bound: u8, mv: Option<usize>) {
        let gen = self.generation;
        let Some(slot) = self.entries.get_mut(key as usize & self.mask) else { return };
        if slot.generation() == gen && slot.key != 0 && depth < slot.depth as u32 {
            return;
        }
        *slot = Entry { key, score, mv: mv.map_or(NO_MOVE, |m| m as u8), depth: depth.min(255) as u8, meta: (gen << 2) | bound };
    }
}

thread_local! {
    /// The game's table, kept between `go` calls and cleared by `game`.
    static TT: std::cell::RefCell<Tt> = std::cell::RefCell::new(Tt::new(TT_BITS));
}

struct Search<'a> {
    start: Instant,
    deadline: Duration,
    nodes: u64,
    stopped: bool,
    /// The transposition table; `None` searches without one (tests, reports, the book generator).
    tt: Option<&'a mut Tt>,
}

impl<'a> Search<'a> {
    fn new(deadline: Duration, tt: Option<&'a mut Tt>) -> Self {
        Search { start: Instant::now(), deadline, nodes: 0, stopped: false, tt }
    }

    fn out_of_time(&mut self) -> bool {
        if !self.stopped && self.nodes & 1023 == 0 && self.start.elapsed() >= self.deadline {
            self.stopped = true;
        }
        self.stopped
    }

    /// The stored best move for `g`, if the table holds one (legality is checked by `ordered`).
    fn tt_move(&self, g: &Game) -> Option<usize> {
        let [me, opp] = g.get();
        self.tt.as_ref()?.probe(tt_key(me, opp))?.best()
    }

    /// Negamax alpha-beta. A side with no placement passes; two passes end the game.
    fn negamax(&mut self, g: &Game, depth: u32, mut alpha: i32, beta: i32) -> i32 {
        self.nodes += 1;
        if self.out_of_time() {
            return 0;
        }
        let avail = g.available_moves();
        if avail == 0 {
            let mut p = g.clone();
            p.pass_move();
            if p.available_moves() == 0 {
                return terminal(g);
            }
            if depth == 0 {
                return evaluate(g);
            }
            return -self.negamax(&p, depth - 1, -beta, -alpha);
        }
        if depth == 0 {
            return evaluate(g);
        }
        let [me, opp] = g.get();
        let key = tt_key(me, opp);
        let mut first = None;
        if let Some(e) = self.tt.as_ref().and_then(|t| t.probe(key)) {
            if e.depth as u32 >= depth {
                let cut = match e.bound() {
                    EXACT => true,
                    LOWER => e.score >= beta,
                    _ => e.score <= alpha,
                };
                if cut {
                    return e.score;
                }
            }
            first = e.best();
        }
        let alpha0 = alpha;
        let mut best = -INF;
        let mut best_move = None;
        for i in ordered(avail, first) {
            let Some(next) = g.make_move(i) else { continue };
            let v = -self.negamax(&next, depth - 1, -beta, -alpha);
            if self.stopped {
                return 0;
            }
            if v > best {
                best = v;
                best_move = Some(i);
                if v > alpha {
                    alpha = v;
                    if alpha >= beta {
                        break;
                    }
                }
            }
        }
        if let Some(t) = self.tt.as_mut() {
            let bound = if best >= beta {
                LOWER
            } else if best <= alpha0 {
                UPPER
            } else {
                EXACT
            };
            t.store(key, depth, best, bound, best_move);
        }
        best
    }
}

/// Move order: the previous iteration's best move, then corners, then plain squares,
/// then C-squares and X-squares last.
fn ordered(avail: u64, first: Option<usize>) -> Vec<usize> {
    let mut xs = 0u64;
    let mut cs = 0u64;
    for &(x, _) in &X_SQUARES {
        xs |= 1 << x;
    }
    for &(c, _) in &C_SQUARES {
        cs |= 1 << c;
    }
    let mut out = Vec::with_capacity(avail.count_ones() as usize);
    if let Some(f) = first.filter(|&f| avail >> f & 1 == 1) {
        out.push(f);
    }
    for mask in [CORNERS, !(CORNERS | xs | cs), cs, xs] {
        let mut m = avail & mask;
        while m != 0 {
            let i = m.trailing_zeros() as usize;
            m &= m - 1;
            if Some(i) != first {
                out.push(i);
            }
        }
    }
    out
}

/// Iterative-deepening alpha-beta. Stops on a clock check at ~60% of the budget and plays
/// the best move of the last completed depth. Returns (move, depth completed).
fn search(g: &Game, budget_ms: u64) -> (usize, u32) {
    search_limited(g, u32::MAX, Duration::from_millis(budget_ms * 6 / 10))
}

/// Iterative deepening up to `max_depth` plies or until `deadline` passes, whichever is first,
/// with the game's transposition table.
fn search_limited(g: &Game, max_depth: u32, deadline: Duration) -> (usize, u32) {
    let r = TT.with(|t| {
        let mut t = t.borrow_mut();
        t.new_search();
        search_with(g, max_depth, deadline, Some(&mut t))
    });
    (r.0, r.1)
}

/// `search_limited` without a table, also returning the number of nodes searched.
#[cfg(test)]
fn search_counted(g: &Game, max_depth: u32, deadline: Duration) -> (usize, u32, u64) {
    let r = search_with(g, max_depth, deadline, None);
    (r.0, r.1, r.2)
}

/// Iterative deepening with an optional table: (move, depth completed, nodes, score of the
/// last completed depth). The root tries the stored move first on the first iteration and the
/// previous iteration's best after that.
fn search_with(g: &Game, max_depth: u32, deadline: Duration, tt: Option<&mut Tt>) -> (usize, u32, u64, i32) {
    let avail = g.available_moves();
    let mut s = Search::new(deadline, tt);
    let order = ordered(avail, s.tt_move(g));
    let mut best = order[0];
    if order.len() == 1 {
        return (best, 0, 0, 0);
    }
    let [me, opp] = g.get();
    let empties = (!(me | opp)).count_ones();
    let mut done = 0;
    let mut score = 0;
    for depth in 1..=empties.min(max_depth) {
        let mut alpha = -INF;
        let mut iter_best = None;
        for i in ordered(avail, Some(best)) {
            let Some(next) = g.make_move(i) else { continue };
            let v = -s.negamax(&next, depth - 1, -INF, -alpha);
            if s.stopped {
                break;
            }
            if v > alpha || iter_best.is_none() {
                alpha = v;
                iter_best = Some(i);
            }
        }
        if s.stopped {
            break;
        }
        best = iter_best.unwrap_or(best);
        done = depth;
        score = alpha;
        if let Some(t) = s.tt.as_mut() {
            t.store(tt_key(me, opp), depth, alpha, EXACT, Some(best));
        }
        // A deeper iteration costs several times this one: do not start what cannot finish.
        if s.start.elapsed() * 3 >= s.deadline {
            break;
        }
    }
    (best, done, s.nodes, score)
}

// ---------------------------------------------------------------------------------------------
// Exact endgame solver (task #94). Its own negamax on the final disc count: no evaluate() calls.
// ---------------------------------------------------------------------------------------------

/// At or below this many empties `go` runs the exact solve after a short midgame search.
/// Chosen from `solve_report` (see the playbook's solve-time table): 14 without the solver
/// table; 15 with it (#160), where 47 of 48 report positions solve inside a go-200 window.
const SOLVE_EMPTIES: u32 = 15;
/// Below this many empties the solver orders by parity only (computing every reply's mobility
/// costs more than it saves this close to the end).
const SHALLOW: u32 = 6;
/// Scores are final disc differences, so they lie inside [-64, 64].
const SOLVE_INF: i32 = 65;

/// The four 4×4 quadrants, for the parity tiebreak (an odd empty region is the mover's to close).
const QUADRANTS: [u64; 4] = [
    0x0000_0000_0f0f_0f0f,
    0x0000_0000_f0f0_f0f0,
    0x0f0f_0f0f_0000_0000,
    0xf0f0_f0f0_0000_0000,
];

/// Final disc difference for the side owning `me`, with the empty squares going to the winner.
fn final_score(me: u64, opp: u64) -> i32 {
    let m = me.count_ones() as i32;
    let o = opp.count_ones() as i32;
    let e = 64 - m - o;
    let d = m - o;
    if d > 0 {
        d + e
    } else if d < 0 {
        d - e
    } else {
        0
    }
}

/// The empty squares that lie in a quadrant holding an odd number of empties.
fn odd_regions(empty: u64) -> u64 {
    let mut odd = 0;
    for q in QUADRANTS {
        if (empty & q).count_ones() & 1 == 1 {
            odd |= q;
        }
    }
    odd & empty
}

/// Solver-table size: 2^18 slots of 16 bytes = 4 MB, in buckets of two.
const SOLVE_TT_BITS: u32 = 18;
/// The solver probes and stores only at nodes with at least this many empties; below it the
/// bookkeeping costs more than the subtree it saves (task #160, see the playbook).
const SOLVE_TT_MIN: u32 = 6;

/// One solver-table slot: proven bounds `lo <= value <= hi` on the exact final disc margin of
/// (mover, opponent), the best move found (`NO_MOVE` for none), and the empties it was solved at.
/// Values are final margins, never midgame heuristic scores: the solver has its own table, so
/// neither search can read the other's entries.
#[derive(Clone, Copy, Default)]
struct SolveEntry {
    key: u64,
    lo: i8,
    hi: i8,
    mv: u8,
    empties: u8,
}

/// The exact solver's table (task #160). Bounds on a final margin never go stale, so it lives
/// for the whole game (cleared by `game`) and the next move's solve reuses the last one's work.
/// Each bucket has a preferred slot (largest subtree, i.e. most empties) and an always-replace
/// slot. An entry with more empties than the current root is unreachable, so it yields.
#[derive(Default)]
struct SolveTt {
    entries: Vec<SolveEntry>,
    /// Empties at the current solve's root.
    root_empties: u8,
}

impl SolveTt {
    fn prepare(&mut self, root_empties: u32) {
        if self.entries.is_empty() {
            self.entries = vec![SolveEntry::default(); 1 << SOLVE_TT_BITS];
        }
        self.root_empties = root_empties as u8;
    }

    fn bucket(&self, key: u64) -> usize {
        (key as usize & ((1 << SOLVE_TT_BITS) - 1)) & !1
    }

    fn probe(&self, key: u64) -> Option<SolveEntry> {
        if self.entries.is_empty() || key == 0 {
            return None;
        }
        let b = self.bucket(key);
        self.entries[b..b + 2].iter().copied().find(|e| e.key == key)
    }

    /// Records `lo <= value <= hi` for `key`, intersecting with bounds already held for it.
    fn store(&mut self, key: u64, empties: u32, lo: i32, hi: i32, mv: Option<usize>) {
        if self.entries.is_empty() || key == 0 {
            return;
        }
        let b = self.bucket(key);
        let mv = mv.map_or(NO_MOVE, |m| m as u8);
        let empties = empties as u8;
        for j in b..b + 2 {
            let e = &mut self.entries[j];
            if e.key == key {
                e.lo = e.lo.max(lo as i8);
                e.hi = e.hi.min(hi as i8);
                if mv != NO_MOVE {
                    e.mv = mv;
                }
                e.empties = e.empties.max(empties);
                return;
            }
        }
        let new = SolveEntry { key, lo: lo as i8, hi: hi as i8, mv, empties };
        let first = self.entries[b];
        if first.key == 0 || empties >= first.empties || first.empties > self.root_empties {
            self.entries[b + 1] = first;
            self.entries[b] = new;
        } else {
            self.entries[b + 1] = new;
        }
    }
}

thread_local! {
    /// The solver's table, kept between `go` calls and cleared by `game`.
    static SOLVE_TT: std::cell::RefCell<SolveTt> = std::cell::RefCell::new(SolveTt::default());
}

struct Solver {
    start: Instant,
    deadline: Duration,
    nodes: u64,
    stopped: bool,
    /// Order moves by the opponent's reply count (fastest-first); off only for the report.
    fastest_first: bool,
    /// Prefer moves into odd empty quadrants as a tiebreak; off only for the report.
    parity: bool,
    /// Null windows after the first child (principal variation search).
    pvs: bool,
    /// Bounds table from `SOLVE_TT_MIN` empties up; `None` solves without one (tests, reports).
    tt: Option<SolveTt>,
}

impl Solver {
    fn new(deadline: Duration) -> Self {
        Solver { start: Instant::now(), deadline, nodes: 0, stopped: false, fastest_first: true, parity: true, pvs: true, tt: None }
    }

    fn out_of_time(&mut self) -> bool {
        if !self.stopped && self.nodes & 1023 == 0 && self.start.elapsed() >= self.deadline {
            self.stopped = true;
        }
        self.stopped
    }

    /// Exact final disc difference for the side to move, inside the window (alpha, beta):
    /// fail-soft, so a score <= alpha or >= beta is a bound. Returns 0 once stopped.
    fn solve(&mut self, me: u64, opp: u64, mut alpha: i32, beta: i32) -> i32 {
        self.nodes += 1;
        if self.out_of_time() {
            return 0;
        }
        let empty = !(me | opp);
        let n = empty.count_ones();
        if n == 0 {
            return me.count_ones() as i32 - opp.count_ones() as i32;
        }
        if n == 1 {
            return last_empty(me, opp, empty.trailing_zeros() as usize);
        }
        let g = Game::new(me, opp).expect("disjoint boards");
        let avail = g.available_moves();
        if avail == 0 {
            let mut p = g.clone();
            p.pass_move();
            if p.available_moves() == 0 {
                return final_score(me, opp);
            }
            return -self.solve(opp, me, -beta, -alpha);
        }
        // Table probe: a proven bound outside the window, or an exact value, answers at once
        // (the window is not narrowed, so a fail-soft result stays a bound on the caller's window).
        let use_tt = n >= SOLVE_TT_MIN && self.tt.is_some();
        let key = if use_tt { tt_key(me, opp) } else { 0 };
        let mut tt_move = NO_MOVE as usize;
        if use_tt {
            if let Some(e) = self.tt.as_ref().and_then(|t| t.probe(key)) {
                let (lo, hi) = (e.lo as i32, e.hi as i32);
                if lo >= beta || lo == hi {
                    return lo;
                }
                if hi <= alpha {
                    return hi;
                }
                tt_move = e.mv as usize;
            }
        }
        let alpha0 = alpha;
        // Children with their ordering key (lower first).
        let mut kids = [(0u32, 0u64, 0u64, 0u8); 32];
        let mut k = 0;
        let odd = if self.parity { odd_regions(empty) } else { 0 };
        let mut m = avail;
        while m != 0 {
            let i = m.trailing_zeros() as usize;
            m &= m - 1;
            let Some(next) = g.make_move(i) else { continue };
            let [p, q] = next.get();
            let mut key = 0;
            if self.fastest_first && n > SHALLOW {
                key = next.available_moves().count_ones() * 2;
            }
            if odd >> i & 1 == 0 {
                key += 1;
            }
            if i == tt_move {
                key = 0; // the table's best move goes first (ties keep it ahead: stable below)
            }
            kids[k] = (key, p, q, i as u8);
            k += 1;
        }
        let kids = &mut kids[..k];
        if tt_move < NO_MOVE as usize {
            kids.sort_by_key(|c| (c.0, c.3 as usize != tt_move));
        } else {
            kids.sort_unstable_by_key(|c| c.0);
        }
        let mut best = -SOLVE_INF;
        let mut best_sq = None;
        for (j, &(_, p, q, sq)) in kids.iter().enumerate() {
            // Principal variation search: the first child gets the full window, the rest a null
            // window at alpha, re-searched only when one fails high inside (alpha, beta).
            let mut v;
            if j == 0 || !self.pvs {
                v = -self.solve(p, q, -beta, -alpha);
            } else {
                v = -self.solve(p, q, -alpha - 1, -alpha);
                if v > alpha && v < beta && !self.stopped {
                    v = -self.solve(p, q, -beta, -v);
                }
            }
            if self.stopped {
                return 0;
            }
            if v > best {
                best = v;
                best_sq = Some(sq as usize);
                if v > alpha {
                    alpha = v;
                    if alpha >= beta {
                        break;
                    }
                }
            }
        }
        if use_tt {
            // Fail-soft: at or below the original alpha the value is at most `best`; at or above
            // beta it is at least `best`; in between it is exact.
            let (lo, hi) = if best <= alpha0 {
                (-64, best)
            } else if best >= beta {
                (best, 64)
            } else {
                (best, best)
            };
            let mv = if best > alpha0 { best_sq } else { None };
            if let Some(t) = self.tt.as_mut() {
                t.store(key, n, lo, hi, mv);
            }
        }
        best
    }
}

/// One empty square left: the mover plays it if it can, else the opponent, else nobody.
fn last_empty(me: u64, opp: u64, sq: usize) -> i32 {
    let g = Game::new(me, opp).expect("disjoint boards");
    if let Some(next) = g.make_move(sq) {
        let [p, q] = next.get();
        return q.count_ones() as i32 - p.count_ones() as i32;
    }
    let mut o = g;
    o.pass_move();
    if let Some(next) = o.make_move(sq) {
        let [p, q] = next.get();
        return p.count_ones() as i32 - q.count_ones() as i32;
    }
    final_score(me, opp)
}

/// Root of the exact solve: tries the moves in `order` (the midgame's best first). Returns the
/// best move found and its exact score, and whether every root move was settled. An unfinished
/// solve still returns its best move once the first root move is exact: any later move that
/// replaced it was proven better.
fn solve_root(g: &Game, order: &[usize], s: &mut Solver) -> (Option<(usize, i32)>, bool) {
    let mut best: Option<(usize, i32)> = None;
    let mut alpha = -SOLVE_INF;
    for &i in order {
        let Some(next) = g.make_move(i) else { continue };
        let [p, q] = next.get();
        let mut v;
        if best.is_none() || !s.pvs {
            v = -s.solve(p, q, -SOLVE_INF, -alpha);
        } else {
            v = -s.solve(p, q, -alpha - 1, -alpha);
            if v > alpha && !s.stopped {
                v = -s.solve(p, q, -SOLVE_INF, -v);
            }
        }
        if s.stopped {
            return (best, false);
        }
        if best.is_none() || v > alpha {
            alpha = v;
            best = Some((i, v));
        }
    }
    (best, true)
}

/// The move to play: below `SOLVE_EMPTIES` a short midgame search gives a fallback move and the
/// root order, then the exact solve takes the rest of the budget.
fn best_move(g: &Game, budget_ms: u64) -> usize {
    // Self-generated opening book (task #109): a stored deep-search move is played instantly.
    if let Some(m) = book::probe(g) {
        return m;
    }
    let empties = (!(g.get()[0] | g.get()[1])).count_ones();
    if empties > SOLVE_EMPTIES || g.available_moves().count_ones() == 1 {
        return search(g, budget_ms).0;
    }
    let total = Duration::from_millis(budget_ms * 8 / 10);
    let t = Instant::now();
    let (fallback, _) = search_limited(g, u32::MAX, Duration::from_millis(budget_ms / 10));
    let mut order = vec![fallback];
    order.extend(ordered(g.available_moves(), None).into_iter().filter(|&i| i != fallback));
    let mut s = Solver::new(total.saturating_sub(t.elapsed()));
    let mut tt = SOLVE_TT.with(|t| std::mem::take(&mut *t.borrow_mut()));
    tt.prepare(empties);
    s.tt = Some(tt);
    let result = solve_root(g, &order, &mut s).0;
    if let Some(tt) = s.tt.take() {
        SOLVE_TT.with(|t| *t.borrow_mut() = tt);
    }
    match result {
        Some((m, _)) => m,
        None => fallback,
    }
}

/// Picks a move for the side to move. Passes only with no placement.
fn choose(moves: &[String], budget_ms: u64) -> Option<String> {
    let g = replay(moves)?;
    if g.available_moves() == 0 {
        return Some("pass".into());
    }
    Some(square_name(best_move(&g, budget_ms)))
}

/// Handles one protocol line, returning the reply to print (if any) and whether to quit.
fn handle(line: &str, moves: &mut Vec<String>) -> (Option<String>, bool) {
    let mut parts = line.split_whitespace();
    match parts.next() {
        Some("game") => {
            TT.with(|t| t.borrow_mut().clear());
            SOLVE_TT.with(|t| *t.borrow_mut() = SolveTt::default());
            (Some("ready".into()), false)
        }
        Some("position") => {
            *moves = parts.map(String::from).collect();
            (None, false)
        }
        Some("go") => {
            let budget = parts.next().and_then(|s| s.parse().ok()).unwrap_or(1000);
            let mv = choose(moves, budget).unwrap_or_else(|| "none".into());
            (Some(format!("bestmove {mv}")), false)
        }
        Some("quit") => (None, true),
        _ => (None, false),
    }
}

fn main() {
    // Offline book generator (`book/generate.sh`); never used during a game.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("book") {
        book::command(&args[1..]);
        return;
    }
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

    #[test]
    fn handshake_and_position() {
        let mut moves = Vec::new();
        assert_eq!(handle("game othello", &mut moves).0.as_deref(), Some("ready"));
        handle("position a b", &mut moves);
        assert_eq!(moves, vec!["a", "b"]);
        assert!(handle("go 100", &mut moves).0.unwrap().starts_with("bestmove "));
        assert!(handle("quit", &mut moves).1);
    }

    fn mv(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn coordinate_mapping_round_trips() {
        assert_eq!(parse_square("a1"), Some(0));
        assert_eq!(parse_square("h1"), Some(7));
        assert_eq!(parse_square("a8"), Some(56));
        assert_eq!(parse_square("h8"), Some(63));
        assert_eq!(parse_square("i1"), None);
        for i in 0..64 {
            assert_eq!(parse_square(&square_name(i)), Some(i));
        }
    }

    #[test]
    fn opening_moves_match_referee_for_both_colours() {
        // Black's legal openings in standard notation (a1 top-left): d3 c4 f5 e6.
        let g = replay(&[]).unwrap();
        let want: u64 = ["d3", "c4", "f5", "e6"].iter().map(|m| 1u64 << parse_square(m).unwrap()).sum();
        assert_eq!(g.available_moves(), want);
        // After black d3, white's replies are c3 e3 c5.
        let g = replay(&mv(&["d3"])).unwrap();
        let want: u64 = ["c3", "e3", "c5"].iter().map(|m| 1u64 << parse_square(m).unwrap()).sum();
        assert_eq!(g.available_moves(), want);
        assert!(replay(&mv(&["a1"])).is_none());
    }

    #[test]
    fn passes_only_without_placement() {
        assert!(replay(&mv(&["pass"])).is_none(), "a pass while moves exist is illegal");
        // Pseudo-random games until the side to move has no placement but the opponent does.
        let mut seed: u64 = 12345;
        let mut found = 0;
        for _ in 0..500 {
            let mut moves: Vec<String> = Vec::new();
            loop {
                let g = replay(&moves).unwrap();
                let avail = g.available_moves();
                let mut o = g.clone();
                o.pass_move();
                if avail == 0 {
                    if o.available_moves() == 0 {
                        break;
                    }
                    assert_eq!(choose(&moves, 0).unwrap(), "pass");
                    found += 1;
                    moves.push("pass".into());
                    continue;
                }
                assert_ne!(choose(&moves, 0).unwrap(), "pass");
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                let k = (seed >> 33) as u32 % avail.count_ones();
                let i = (0..64).filter(|i| avail >> i & 1 == 1).nth(k as usize).unwrap();
                moves.push(square_name(i));
            }
        }
        assert!(found > 0, "no pass position reached");
    }

    #[test]
    fn plays_a_full_game_legally() {
        let mut moves = Vec::new();
        for _ in 0..130 {
            let g = replay(&moves).unwrap();
            let mut o = g.clone();
            o.pass_move();
            if g.available_moves() == 0 && o.available_moves() == 0 {
                break;
            }
            moves.push(choose(&moves, 50).unwrap());
            assert!(replay(&moves).is_some());
        }
        assert!(moves.len() > 20);
    }

    fn bits(sqs: &[&str]) -> u64 {
        sqs.iter().map(|m| 1u64 << parse_square(m).unwrap()).sum()
    }

    #[test]
    fn potential_mobility_counts_empties_next_to_the_other_side() {
        // Opening, either side: the empties touching the opponent's two discs. For Black (to
        // move) White sits on d4 e5; their 8-neighbourhoods hold 10 empty squares (c3 d3 e3 c4
        // c5 f4 f5 d6 e6 f6), and the same count holds the other way round by symmetry.
        let g = Game::default();
        let [b, w] = g.get();
        let empty = !(b | w);
        assert_eq!(potential_mobility(w, empty).count_ones(), 10);
        assert_eq!(potential_mobility(b, empty).count_ones(), 10);
        // A side boxed in on every side by the other has no empty neighbour: zero for the
        // boxed side's opponent, while the boxing ring touches all 16 empties around it.
        let inner = bits(&["d4"]);
        let ring = bits(&["c3", "d3", "e3", "c4", "e4", "c5", "d5", "e5"]);
        let empty = !(inner | ring);
        assert_eq!(potential_mobility(inner, empty), 0);
        assert_eq!(potential_mobility(ring, empty).count_ones(), 16);
        // No wrap across the a/h columns: a lone h1 disc touches g1 g2 h2 only, never a2.
        let empty = !bits(&["h1"]);
        assert_eq!(potential_mobility(bits(&["h1"]), empty), bits(&["g1", "g2", "h2"]));
        assert_eq!(potential_mobility(bits(&["a2"]), !bits(&["a2"])), bits(&["a1", "b1", "b2", "b3", "a3"]));
        // Through evaluate(), both colours: the side to move gains when the opponent offers more.
        let g = Game::new(bits(&["d4", "d5", "e4", "e5", "c3"]), bits(&["f6"])).unwrap();
        let h = Game::new(bits(&["f6"]), bits(&["d4", "d5", "e4", "e5", "c3"])).unwrap();
        assert_eq!(evaluate(&g), -evaluate(&h));
    }

    #[test]
    fn edge_stability_grows_from_owned_corners() {
        // Each case is checked with the anchored side as the side to move and as the opponent.
        let check = |own: u64, other: u64, want_own: u64, want_other: u64, what: &str| {
            for (g, o) in [(Game::new(own, other).unwrap(), 0), (Game::new(other, own).unwrap(), 1)] {
                let b = g.get();
                let occ = b[0] | b[1];
                assert_eq!(edge_stable(b[o], occ), want_own, "{what} (own as side {o})");
                assert_eq!(edge_stable(b[1 - o], occ), want_other, "{what} (other as side {})", 1 - o);
            }
        };
        // A lone corner: just the corner.
        check(bits(&["h8"]), bits(&["d4", "e5"]), bits(&["h8"]), 0, "lone corner");
        // A corner plus a broken run: a1 b1 c1 own, d1 opponent, e1 own -> a1 b1 c1 only;
        // down column a: a1 a2 own, a3 empty -> a2 too. b2 is not on an edge.
        let own = bits(&["a1", "b1", "c1", "e1", "a2"]);
        check(own, bits(&["d1", "b2"]), bits(&["a1", "b1", "c1", "a2"]), 0, "broken run");
        // A full edge counts entirely for both sides, whoever owns its corners.
        let own = bits(&["b8", "c8", "f8", "g8"]);
        let other = bits(&["a8", "d8", "e8", "h8"]);
        check(own, other, own, other, "full edge");
        // Two corners on one edge: runs grow from both ends.
        let own = bits(&["a1", "b1", "g1", "h1"]);
        check(own, bits(&["d1"]), own, 0, "runs from both corners");
        // Through evaluate(): the side to move scores the stable discs for itself, and the same
        // position seen from the other side scores them against it.
        let own = bits(&["a1", "b1", "c1", "d1", "a2", "a3"]);
        let other = bits(&["e1", "b2", "c3"]);
        let g = Game::new(own, other).unwrap();
        let h = Game::new(other, own).unwrap();
        assert_eq!(evaluate(&g), -evaluate(&h), "evaluation is symmetric between colours");
        assert!(evaluate(&g) > 0);
    }

    #[test]
    fn takes_a_free_corner_over_an_x_square() {
        // In the midgame (20+ empties), wherever a corner is legal and so is the X-square
        // touching that same corner, a fixed-depth search (no clock in play) must not choose
        // that X-square if it lets the opponent take the corner in reply. Endgames are left out on purpose:
        // there the disc count decides and an X-square can be the right move. Positions come
        // from seeded pseudo-random games, so every run checks the same positions.
        let mut checked = 0;
        for game in 0..40u64 {
            let mut seed = 0x9e37_79b9_7f4a_7c15 ^ game;
            let mut moves: Vec<String> = Vec::new();
            loop {
                let g = replay(&moves).unwrap();
                let avail = g.available_moves();
                let mut o = g.clone();
                o.pass_move();
                if avail == 0 {
                    if o.available_moves() == 0 {
                        break;
                    }
                    moves.push("pass".into());
                    continue;
                }
                let empties = (!(g.get()[0] | g.get()[1])).count_ones();
                for &(x, corner) in &X_SQUARES {
                    if empties >= 20 && avail >> corner & 1 == 1 && avail >> x & 1 == 1 {
                        let (m, depth) = search_limited(&g, 3, Duration::from_secs(60));
                        assert_eq!(depth, 3, "search did not complete depth 3");
                        // The X-square is a blunder when it hands the corner over. With the corner
                        // still ours to take later (the opponent cannot reach it next move) it can be
                        // a fine choice: allowed only then.
                        if m == x {
                            let reply = g.make_move(x).unwrap().available_moves();
                            assert_eq!(reply >> corner & 1, 0, "played {} and handed over {}: {moves:?}", square_name(x), square_name(corner));
                        }
                        checked += 1;
                    }
                }
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                let k = (seed >> 33) as u32 % avail.count_ones();
                let i = (0..64).filter(|i| avail >> i & 1 == 1).nth(k as usize).unwrap();
                moves.push(square_name(i));
            }
        }
        assert!(checked >= 5, "only {checked} midgame positions with a legal corner and its X-square");
    }

    #[test]
    fn search_handles_passes_and_terminal_positions() {
        // Black to move with no placement while White still has one: the search passes
        // inside the tree instead of treating it as the end.
        // Row 1: W B . . . . . . -> Black cannot move (no line ends in black), White plays c1.
        let g = Game::new(1 << 1, 1 << 0).unwrap(); // mover = Black on b1, opponent White on a1
        assert_eq!(g.available_moves(), 0);
        let mut p = g.clone();
        p.pass_move();
        assert_ne!(p.available_moves(), 0);
        let mut s = Search::new(Duration::from_secs(5), None);
        // White plays c1 and wins 3-0: from Black's view the game is lost.
        assert!(s.negamax(&g, 4, -INF, INF) <= -WIN);
        // Neither side can move: scored by disc difference.
        let end = Game::new(0b111, 0).unwrap();
        assert_eq!(s.negamax(&end, 3, -INF, INF), WIN + 3);
    }

    /// Seeded positions for the depth report: (empties band, game) pairs from pseudo-random play.
    fn report_positions() -> Vec<(u32, Game)> {
        let mut out = Vec::new();
        for band in [50u32, 40, 30, 20] {
            for game in 0..8u64 {
                let mut seed = 0xdead_beef ^ game.wrapping_mul(0x9e37_79b9) ^ band as u64;
                let mut moves: Vec<String> = Vec::new();
                loop {
                    let g = replay(&moves).unwrap();
                    let avail = g.available_moves();
                    let empties = (!(g.get()[0] | g.get()[1])).count_ones();
                    if empties <= band && avail.count_ones() >= 2 {
                        out.push((band, g));
                        break;
                    }
                    if avail == 0 {
                        moves.push("pass".into());
                        continue;
                    }
                    seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                    let k = (seed >> 33) as u32 % avail.count_ones();
                    let i = (0..64).filter(|i| avail >> i & 1 == 1).nth(k as usize).unwrap();
                    moves.push(square_name(i));
                }
            }
        }
        out
    }

    #[test]
    #[ignore = "report: cargo test --release -p othello-engine depth_report -- --ignored --nocapture"]
    fn depth_report() {
        // Per empties band: depth reached at `go 200` (120 ms deadline; wall clock, so
        // informational only) without and with a fresh table, and nodes at a fixed depth 7
        // (deterministic) without and with the table.
        for band in [50u32, 40, 30, 20] {
            let ps: Vec<_> = report_positions().into_iter().filter(|p| p.0 == band).collect();
            let plain: Vec<u32> = ps.iter().map(|(_, g)| search_with(g, u32::MAX, Duration::from_millis(120), None).1).collect();
            let with_tt: Vec<u32> = ps
                .iter()
                .map(|(_, g)| {
                    let mut t = Tt::new(TT_BITS);
                    t.new_search();
                    search_with(g, u32::MAX, Duration::from_millis(120), Some(&mut t)).1
                })
                .collect();
            let t0 = Instant::now();
            let n: u64 = ps.iter().map(|(_, g)| search_counted(g, 7, Duration::from_secs(600)).2).sum();
            let s0 = t0.elapsed().as_secs_f64();
            let t1 = Instant::now();
            let n_tt: u64 = ps
                .iter()
                .map(|(_, g)| {
                    let mut t = Tt::new(TT_BITS);
                    t.new_search();
                    search_with(g, 7, Duration::from_secs(600), Some(&mut t)).2
                })
                .sum();
            let s1 = t1.elapsed().as_secs_f64();
            let range = |d: &[u32]| format!("{}-{}", d.iter().min().unwrap(), d.iter().max().unwrap());
            println!(
                "<={band} empties: go 200 depth plain {} {:?}, tt {} {:?}; depth 7 nodes plain {n} ({:.0} ms), tt {n_tt} ({:.0} ms, {:+.0}%)",
                range(&plain),
                plain,
                range(&with_tt),
                with_tt,
                s0 * 1000.0,
                s1 * 1000.0,
                (n_tt as f64 / n as f64 - 1.0) * 100.0
            );
        }
    }

    #[test]
    fn tt_search_matches_plain_search_at_fixed_depth() {
        // Seeded positions over the four empties bands, depths 3..=6: with a fresh table the
        // root score equals plain alpha-beta's, and the table's move scores that same value under
        // plain search (ties may resolve to a different move). It must also search fewer nodes.
        let (mut plain_nodes, mut tt_nodes) = (0, 0);
        let mut checked = 0;
        for (_, g) in report_positions() {
            for depth in 3..=6 {
                let (_, d0, n0, v0) = search_with(&g, depth, Duration::from_secs(600), None);
                let mut t = Tt::new(TT_BITS);
                t.new_search();
                let (m1, d1, n1, v1) = search_with(&g, depth, Duration::from_secs(600), Some(&mut t));
                assert_eq!((d0, d1), (depth, depth));
                assert_eq!(v1, v0, "root score differs at depth {depth}:\n{g:?}");
                let next = g.make_move(m1).unwrap();
                let mut s = Search::new(Duration::from_secs(600), None);
                assert_eq!(-s.negamax(&next, depth - 1, -INF, INF), v0, "tt move is not best at depth {depth}:\n{g:?}");
                plain_nodes += n0;
                tt_nodes += n1;
                checked += 1;
            }
        }
        assert!(checked >= 100);
        assert!(tt_nodes < plain_nodes, "tt {tt_nodes} nodes vs plain {plain_nodes}");
    }

    #[test]
    fn tt_survives_go_calls_and_clears_on_game() {
        let mut moves = Vec::new();
        handle("game othello", &mut moves);
        assert!(TT.with(|t| t.borrow().entries.is_empty()));
        handle("position f5 d6 c3 d3 c4 f4 f6 f3 e6 e7", &mut moves);
        handle("go 50", &mut moves);
        let (filled, gen) = TT.with(|t| {
            let t = t.borrow();
            (t.entries.iter().filter(|e| e.key != 0).count(), t.generation)
        });
        assert!(filled > 0 && gen >= 1);
        handle("go 50", &mut moves);
        assert!(TT.with(|t| t.borrow().generation) > gen, "generation bumps each go");
        assert!(TT.with(|t| t.borrow().entries.iter().filter(|e| e.key != 0).count()) >= filled);
        handle("game othello", &mut moves);
        assert!(TT.with(|t| t.borrow().entries.is_empty()));
    }

    #[test]
    fn tt_replacement_keeps_deeper_within_a_generation() {
        let mut t = Tt::new(4);
        t.new_search();
        let k = 0x10; // slot 0
        t.store(k, 5, 7, EXACT, Some(3));
        t.store(k, 2, 9, EXACT, Some(4));
        assert_eq!(t.probe(k).unwrap().depth, 5, "shallower result does not replace within a search");
        t.store(k, 6, 11, LOWER, Some(5));
        assert_eq!((t.probe(k).unwrap().depth, t.probe(k).unwrap().score), (6, 11));
        t.new_search();
        t.store(k, 1, -2, UPPER, None);
        let e = t.probe(k).unwrap();
        assert_eq!((e.depth, e.score, e.bound(), e.best()), (1, -2, UPPER, None), "older generation always replaced");
        assert!(t.probe(0x20).is_none(), "different key in the same slot misses");
        assert_ne!(tt_key(1, 2), tt_key(2, 1), "a pass (swapped pair) is a different position");
    }

    /// Full-width minimax to the end of the game, no pruning: the reference for the solver.
    fn brute(g: &Game) -> i32 {
        let avail = g.available_moves();
        let [me, opp] = g.get();
        if avail == 0 {
            let mut p = g.clone();
            p.pass_move();
            if p.available_moves() == 0 {
                return final_score(me, opp);
            }
            return -brute(&p);
        }
        (0..64).filter(|i| avail >> i & 1 == 1).map(|i| -brute(&g.make_move(i).unwrap())).max().unwrap()
    }

    /// Seeded pseudo-random play until at most `empties` remain with the side to move able to
    /// place; `None` if the game ended first.
    fn position_at(empties: u32, seed0: u64) -> Option<Game> {
        let mut seed = seed0;
        let mut g = Game::default();
        loop {
            let avail = g.available_moves();
            let e = (!(g.get()[0] | g.get()[1])).count_ones();
            if e <= empties && avail != 0 {
                return Some(g);
            }
            if avail == 0 {
                let mut p = g.clone();
                p.pass_move();
                if p.available_moves() == 0 {
                    return None;
                }
                g = p;
                continue;
            }
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            let k = (seed >> 33) as u32 % avail.count_ones();
            let i = (0..64).filter(|i| avail >> i & 1 == 1).nth(k as usize).unwrap();
            g = g.make_move(i).unwrap();
        }
    }

    fn solve_exact(g: &Game) -> (usize, i32) {
        let mut s = Solver::new(Duration::from_secs(600));
        let (r, complete) = solve_root(g, &ordered(g.available_moves(), None), &mut s);
        assert!(complete);
        r.unwrap()
    }

    #[test]
    fn solver_table_gives_the_same_results_as_no_table() {
        // Task #160: positions at 8-14 empties, solved without a table and with one. The table is
        // shared across all positions (as across the moves of a game), and each position is also
        // probed with narrow windows, so stale or wrongly bounded entries would show as a mismatch.
        let mut table = SolveTt::default();
        table.prepare(14);
        let mut checked = 0;
        for n in 8..=14u32 {
            for seed in 0..60u64 {
                let Some(g) = position_at(n, seed * 7 + n as u64) else { continue };
                let [me, opp] = g.get();
                if g.available_moves() == 0 || (!(me | opp)).count_ones() != n {
                    continue;
                }
                let (_, plain) = solve_exact(&g);
                let mut s = Solver::new(Duration::from_secs(600));
                s.tt = Some(std::mem::take(&mut table));
                let (r, complete) = solve_root(&g, &ordered(g.available_moves(), None), &mut s);
                assert!(complete);
                let (mv, with_tt) = r.unwrap();
                assert_eq!(plain, with_tt, "root score differs at {n} empties, seed {seed}");
                // The table's chosen move really scores that value.
                let child = g.make_move(mv).unwrap();
                let [p, q] = child.get();
                assert_eq!(-Solver::new(Duration::from_secs(600)).solve(p, q, -SOLVE_INF, SOLVE_INF), plain);
                // Null windows around the value: fail-low, fail-high and exact agree with plain.
                for (a, b) in [(plain - 1, plain), (plain, plain + 1), (plain - 2, plain + 2), (-SOLVE_INF, SOLVE_INF)] {
                    let v_tt = s.solve(me, opp, a, b);
                    let v = Solver::new(Duration::from_secs(600)).solve(me, opp, a, b);
                    assert_eq!(v_tt > a, v > a, "fail-low differs at {n} empties, seed {seed}, window ({a}, {b})");
                    assert_eq!(v_tt >= b, v >= b, "fail-high differs at {n} empties, seed {seed}, window ({a}, {b})");
                    if v > a && v < b {
                        assert_eq!(v_tt, v);
                    }
                }
                table = s.tt.take().unwrap();
                checked += 1;
            }
        }
        assert!(checked >= 40, "only {checked} positions");
        assert!(table.entries.iter().any(|e| e.key != 0), "the table was never written");
    }

    #[test]
    fn solver_matches_brute_force_minimax() {
        // A hand-built position, 9 empties (rows 1 and 8 partly open), Black to move, then
        // seeded positions at 4..=10 empties. Move and score must agree with full-width minimax.
        let black = bits(&["a2", "b2", "c2", "d2", "e3", "f3", "c4", "d4", "e4", "a5", "b5", "c5", "d6", "e6", "f6", "g6", "c7", "d7", "e7"]);
        let empty = bits(&["a1", "b1", "c1", "h1", "a8", "d8", "e8", "g8", "h8"]);
        let white = !(black | empty);
        let hand = Game::new(black, white).unwrap();
        assert_eq!((!(black | white)).count_ones(), 9);
        assert_ne!(hand.available_moves(), 0, "the hand-built position must give Black a move");
        let mut positions = vec![hand];
        for seed in 0..60u64 {
            if let Some(g) = position_at(4 + (seed % 7) as u32, seed * 7919 + 1) {
                positions.push(g);
            }
        }
        let mut checked = 0;
        for g in &positions {
            if g.available_moves() == 0 {
                continue;
            }
            let (m, v) = solve_exact(g);
            let want = brute(g);
            assert_eq!(v, want, "solver score vs brute force:\n{g:?}");
            assert_eq!(-brute(&g.make_move(m).unwrap()), want, "solver move is not optimal:\n{g:?}");
            // Each ordering variant gives the same exact score.
            for (ff, par, pvs) in [(false, false, false), (true, false, false), (false, true, true), (true, true, false)] {
                let mut s = Solver::new(Duration::from_secs(600));
                s.fastest_first = ff;
                s.parity = par;
                s.pvs = pvs;
                let [p, q] = g.get();
                assert_eq!(s.solve(p, q, -SOLVE_INF, SOLVE_INF), want);
            }
            checked += 1;
        }
        assert!(checked >= 40, "only {checked} positions");
    }

    #[test]
    fn solver_handles_passes_and_never_passes_with_a_placement() {
        // Forced pass inside the solve: row 1 is "W B . . . . . ." with Black to move after a
        // pass. Black has no placement; White plays c1 and takes all three: Black loses by 64.
        let g = Game::new(1 << 1, 1 << 0).unwrap();
        assert_eq!(g.available_moves(), 0);
        let mut s = Solver::new(Duration::from_secs(5));
        assert_eq!(s.solve(1 << 1, 1 << 0, -SOLVE_INF, SOLVE_INF), brute(&g));
        assert_eq!(brute(&g), -64);
        // A pass in the middle of the line: seeded endgames where some side must pass before the
        // end; the solver still agrees with brute force.
        let mut with_pass = 0;
        for seed in 0..400u64 {
            let Some(g) = position_at(8, seed * 104729 + 3) else { continue };
            if !has_pass(&g) {
                continue;
            }
            let [p, q] = g.get();
            let mut s = Solver::new(Duration::from_secs(60));
            assert_eq!(s.solve(p, q, -SOLVE_INF, SOLVE_INF), brute(&g));
            with_pass += 1;
            if with_pass >= 10 {
                break;
            }
        }
        assert!(with_pass >= 3, "only {with_pass} endgames with a pass inside");
        // Through `choose` at solver depth: never "pass" while a placement exists, and always legal.
        for seed in 0..40u64 {
            let mut moves: Vec<String> = Vec::new();
            let mut s = seed + 17;
            loop {
                let g = replay(&moves).unwrap();
                let avail = g.available_moves();
                let mut o = g.clone();
                o.pass_move();
                if avail == 0 && o.available_moves() == 0 {
                    break;
                }
                let e = (!(g.get()[0] | g.get()[1])).count_ones();
                if e <= 12 {
                    let m = choose(&moves, 50).unwrap();
                    if avail != 0 {
                        assert_ne!(m, "pass");
                    } else {
                        assert_eq!(m, "pass");
                    }
                    moves.push(m);
                    assert!(replay(&moves).is_some());
                    continue;
                }
                if avail == 0 {
                    moves.push("pass".into());
                    continue;
                }
                s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                let k = (s >> 33) as u32 % avail.count_ones();
                let i = (0..64).filter(|i| avail >> i & 1 == 1).nth(k as usize).unwrap();
                moves.push(square_name(i));
            }
        }
    }

    #[test]
    fn self_play_from_a_solved_position_reaches_the_solved_score() {
        // Both sides playing `best_move` from a position the solver can finish: the game ends at
        // exactly the solved score (perfect play on both sides keeps the value).
        let mut checked = 0;
        for seed in 0..30u64 {
            let Some(start) = position_at(12, seed * 6151 + 5) else { continue };
            let (_, want) = solve_exact(&start);
            let mut g = start.clone();
            let mut sign = 1;
            loop {
                if g.available_moves() == 0 {
                    let mut p = g.clone();
                    p.pass_move();
                    if p.available_moves() == 0 {
                        break;
                    }
                    g = p;
                    sign = -sign;
                    continue;
                }
                g = g.make_move(best_move(&g, 2000)).unwrap();
                sign = -sign;
            }
            let [me, opp] = g.get();
            assert_eq!(sign * final_score(me, opp), want, "seed {seed}");
            checked += 1;
        }
        assert!(checked >= 20);
    }

    /// Whether some line from `g` has a side pass before the game ends.
    fn has_pass(g: &Game) -> bool {
        let avail = g.available_moves();
        if avail == 0 {
            let mut p = g.clone();
            p.pass_move();
            return p.available_moves() != 0;
        }
        (0..64).filter(|i| avail >> i & 1 == 1).any(|i| has_pass(&g.make_move(i).unwrap()))
    }

    #[test]
    #[ignore = "report: cargo test --release -p othello-engine solve_report -- --ignored --nocapture"]
    fn solve_report() {
        // Exact-solve wall time over 8 seeded positions at each empty count 12..=20, for the
        // ordering variants. Wall clock: informational. Half of a go-200 budget is 100 ms.
        // The last variant adds the solver table (#160), fresh per position (no reuse across moves).
        let variants = [("plain", false, false, false, false), ("fastest+parity", true, true, false, false), ("fastest+parity+pvs", true, true, true, false), ("+tt", true, true, true, true)];
        // Edit these to narrow a run (the engine source may not read environment variables): the
        // #160 table used 48 positions, 14..=16 empties and the last two variants.
        let only: Option<&[&str]> = None;
        let count: usize = 8;
        let max_n: u32 = 20;
        for n in 12..=max_n {
            let ps: Vec<Game> = (0..2000u64).filter_map(|s| position_at(n, s * 31 + n as u64)).filter(|g| (!(g.get()[0] | g.get()[1])).count_ones() == n).take(count).collect();
            let mut line = format!("{n} empties ({} pos):", ps.len());
            for &(name, ff, par, pvs, tt) in &variants {
                if !ff && n > 13 {
                    continue; // unordered search is far too slow out here
                }
                if only.is_some_and(|o| !o.contains(&name)) {
                    continue;
                }
                let mut times = Vec::new();
                let mut nodes = 0;
                for g in &ps {
                    // Capped at 2 s per position so the report finishes; a capped solve counts as 2000 ms.
                    let mut s = Solver::new(Duration::from_secs(2));
                    s.fastest_first = ff;
                    s.parity = par;
                    s.pvs = pvs;
                    if tt {
                        let mut table = SolveTt::default();
                        table.prepare(n);
                        s.tt = Some(table);
                    }
                    let t = Instant::now();
                    solve_root(g, &ordered(g.available_moves(), None), &mut s);
                    times.push(t.elapsed().as_secs_f64() * 1000.0);
                    nodes += s.nodes;
                }
                times.sort_by(|a, b| a.partial_cmp(b).unwrap());
                let under = times.iter().filter(|&&t| t <= 100.0).count();
                // ~140 ms is the solve window of a go-200 move (80% of the budget minus the 10%
                // midgame search).
                let window = times.iter().filter(|&&t| t <= 140.0).count();
                line += &format!(
                    "  {name}: median {:.1} ms max {:.1} ms, {under}/{} <= 100 ms, {window} <= 140 ms, {nodes} nodes",
                    times[times.len() / 2],
                    times[times.len() - 1],
                    times.len()
                );
            }
            println!("{line}");
        }
    }

    #[test]
    fn never_exceeds_the_budget() {
        let mut moves = Vec::new();
        let mut seed: u64 = 99;
        for ply in 0..60 {
            let Some(g) = replay(&moves) else { break };
            let avail = g.available_moves();
            let mut o = g.clone();
            o.pass_move();
            if avail == 0 && o.available_moves() == 0 {
                break;
            }
            if ply % 6 == 0 {
                let t = Instant::now();
                let (reply, _) = handle("go 200", &mut moves.clone());
                assert!(reply.unwrap().starts_with("bestmove "));
                assert!(t.elapsed() < Duration::from_millis(200), "ply {ply}: {:?}", t.elapsed());
            }
            if avail == 0 {
                moves.push("pass".into());
                continue;
            }
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            let k = (seed >> 33) as u32 % avail.count_ones();
            let i = (0..64).filter(|i| avail >> i & 1 == 1).nth(k as usize).unwrap();
            moves.push(square_name(i));
        }
    }

    #[test]
    fn legal_moves_for_both_colours_under_search() {
        // Self-play with the real search: every move, Black's and White's, replays legally.
        let mut moves = Vec::new();
        let mut colours = [0, 0];
        for ply in 0..130 {
            let g = replay(&moves).unwrap();
            let mut o = g.clone();
            o.pass_move();
            if g.available_moves() == 0 && o.available_moves() == 0 {
                break;
            }
            let m = choose(&moves, 30).unwrap();
            if m != "pass" {
                colours[ply % 2] += 1;
            }
            moves.push(m);
            assert!(replay(&moves).is_some());
        }
        assert!(colours[0] > 5 && colours[1] > 5);
    }
}

