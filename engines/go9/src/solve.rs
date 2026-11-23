//! Exact endgame solver: alpha-beta to the end of the game on the final Tromp-Taylor area score,
//! over the points Benson's algorithm leaves unsettled.
//!
//! Moves are the empty points outside `Board::forbid` (the settled areas) that are legal on the
//! flat board and not the mover's own single-point eye, plus pass; two passes end the game and
//! the board is scored as it stands (komi 7.5), exactly as the referee does. Values are in half
//! points for the side to move (`2 * score`, odd because of the half-point komi, so never zero:
//! positive wins). A transposition table keyed on stones, side to move, ko point and passes
//! stores bounds. Superko beyond simple ko is not modelled; a ply cap bounds cycles.

use crate::board::{opponent, Board, BLACK, EMPTY, NEIGH, NN, OFF, PASS, WHITE};
use std::time::Instant;

pub const KOMI: f32 = 7.5;
/// Values lie strictly inside (-INF, INF).
pub const INF: i32 = 1000;

const fn splitmix(x: u64) -> u64 {
    let mut z = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Zobrist keys: [point][colour - 1], then the ko point (NN + 1 entries, PASS = none), then
/// side to move and passes.
const ZOB: [[u64; 2]; NN] = {
    let mut t = [[0u64; 2]; NN];
    let mut i = 0;
    while i < NN {
        t[i][0] = splitmix(2 * i as u64 + 1);
        t[i][1] = splitmix(2 * i as u64 + 2);
        i += 1;
    }
    t
};
const ZKO: [u64; NN + 1] = {
    let mut t = [0u64; NN + 1];
    let mut i = 0;
    while i < NN {
        t[i] = splitmix(1000 + i as u64);
        i += 1;
    }
    t
};
const ZWHITE: u64 = splitmix(5000);
const ZPASS: u64 = splitmix(5001);

fn key(b: &Board) -> u64 {
    let mut k = 0u64;
    for p in 0..NN {
        let c = b.cell[p];
        if c != EMPTY {
            k ^= ZOB[p][(c - 1) as usize];
        }
    }
    k ^= ZKO[b.ko as usize];
    if b.to_move == WHITE {
        k ^= ZWHITE;
    }
    if b.passes > 0 {
        k ^= ZPASS;
    }
    k
}

/// The final value for the side to move, in half points.
fn final_value(b: &Board) -> i32 {
    let black = (b.score(KOMI) * 2.0) as i32;
    if b.to_move == BLACK { black } else { -black }
}

const EXACT: u8 = 0;
const LOWER: u8 = 1;
const UPPER: u8 = 2;

#[derive(Clone, Copy, Default)]
struct Entry {
    key: u64,
    value: i16,
    bound: u8,
    best: u8,
    /// Plies left before the cap when stored; usable for any search with no more left.
    left: u8,
}

pub struct Solver {
    tt: Vec<Entry>,
    deadline: Instant,
    pub nodes: u64,
    pub aborted: bool,
    /// Plies from the root at which a line is scored as it stands.
    max_ply: u32,
    /// Lines cut by `max_ply` (their value is the board as it stands, not a proven end).
    pub capped: u64,
}

/// Ordering score of move `p` for the side to move (higher first).
fn order_score(b: &Board, p: u8) -> i32 {
    let c = b.to_move;
    let opp = opponent(c);
    let mut s = 0;
    let nb = &NEIGH[p as usize];
    for (i, &n) in nb.iter().enumerate() {
        if n == OFF {
            continue;
        }
        let col = b.cell[n as usize];
        if col == EMPTY {
            continue;
        }
        let h = b.head_of(n);
        if nb[..i].iter().any(|&m| m != OFF && b.cell[m as usize] != EMPTY && b.head_of(m) == h) {
            continue;
        }
        if b.atari_lib(h) == Some(p) {
            // Capture, or save an own chain in atari.
            s += if col == opp { 1000 + 20 * b.size_of(h) as i32 } else { 500 + 10 * b.size_of(h) as i32 };
        }
    }
    if b.last != PASS && NEIGH[b.last as usize].contains(&p) {
        s += 100;
    }
    if b.is_self_atari(p, c) {
        s -= 300;
    }
    s
}

/// Moves for the side to move, best-ordered, pass last; `tt_best` (if a move) goes first.
fn moves(b: &Board, tt_best: u8, out: &mut Vec<(i32, u8)>) {
    out.clear();
    let c = b.to_move;
    for p in 0..NN as u8 {
        if b.cell[p as usize] == EMPTY && b.forbid & (1u128 << p) == 0 && b.is_legal(p) && !b.is_eye(p, c) {
            let s = if p == tt_best { 1 << 20 } else { order_score(b, p) };
            out.push((s, p));
        }
    }
    out.push((if tt_best == PASS { 1 << 20 } else { -(1 << 20) }, PASS));
    out.sort_unstable_by(|a, b| b.0.cmp(&a.0));
}

impl Solver {
    /// A solver with a 2^`tt_bits`-entry table (16 bytes each).
    pub fn new(deadline: Instant, tt_bits: u32, max_ply: u32) -> Self {
        Solver { tt: vec![Entry::default(); 1 << tt_bits], deadline, nodes: 0, aborted: false, max_ply, capped: 0 }
    }

    /// Value of `b` for the side to move in half points, within (alpha, beta) fail-soft.
    pub fn negamax(&mut self, b: &Board, ply: u32, mut alpha: i32, beta: i32) -> i32 {
        self.nodes += 1;
        if self.nodes & 1023 == 0 && Instant::now() >= self.deadline {
            self.aborted = true;
        }
        if self.aborted {
            return 0;
        }
        if b.passes >= 2 {
            return final_value(b);
        }
        if ply >= self.max_ply {
            self.capped += 1;
            return final_value(b);
        }
        let left = (self.max_ply - ply) as u8;
        let k = key(b);
        let slot = (k as usize) & (self.tt.len() - 1);
        let e = self.tt[slot];
        let mut tt_best = OFF;
        if e.key == k {
            tt_best = e.best;
            if e.left >= left {
                let v = e.value as i32;
                match e.bound {
                    EXACT => return v,
                    LOWER if v >= beta => return v,
                    UPPER if v <= alpha => return v,
                    _ => {}
                }
            }
        }
        let alpha0 = alpha;
        let mut list = Vec::with_capacity(32);
        moves(b, tt_best, &mut list);
        let (mut best, mut best_move) = (-INF, PASS);
        for &(_, m) in &list {
            let mut child = b.clone();
            child.play(m);
            let v = -self.negamax(&child, ply + 1, -beta, -alpha);
            if self.aborted {
                return 0;
            }
            if v > best {
                best = v;
                best_move = m;
            }
            if v > alpha {
                alpha = v;
            }
            if alpha >= beta {
                break;
            }
        }
        let bound = if best <= alpha0 {
            UPPER
        } else if best >= beta {
            LOWER
        } else {
            EXACT
        };
        self.tt[slot] = Entry { key: k, value: best as i16, bound, best: best_move, left };
        best
    }

    /// Solves `root` over `root_moves` (legal under the referee's rules) plus pass, within
    /// (alpha, beta). Returns (best move, value for the side to move in half points), or None
    /// if the clock ran out first.
    pub fn solve_root(&mut self, root: &Board, root_moves: &[u8], alpha: i32, beta: i32) -> Option<(u8, i32)> {
        let mut list: Vec<(i32, u8)> = root_moves.iter().map(|&p| (order_score(root, p), p)).collect();
        list.sort_unstable_by(|a, b| b.0.cmp(&a.0));
        list.push((0, PASS));
        let mut a = alpha;
        let (mut best, mut best_move) = (-INF, PASS);
        for &(_, m) in &list {
            let mut child = root.clone();
            child.play(m);
            let v = -self.negamax(&child, 1, -beta, -a);
            if self.aborted {
                return None;
            }
            if v > best {
                best = v;
                best_move = m;
            }
            if v > a {
                a = v;
            }
            if a >= beta {
                break;
            }
        }
        Some((best_move, best))
    }
}

/// Plain minimax over the same move set, no pruning or table (for tests).
#[cfg(test)]
pub fn minimax(b: &Board, ply: u32, max_ply: u32) -> i32 {
    if b.passes >= 2 || ply >= max_ply {
        return final_value(b);
    }
    let mut list = Vec::new();
    moves(b, OFF, &mut list);
    let mut best = -INF;
    for &(_, m) in &list {
        let mut child = b.clone();
        child.play(m);
        best = best.max(-minimax(&child, ply + 1, max_ply));
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::benson::{settled, tests::cells, unsettled_points};
    use crate::board::Rng;
    use std::time::Duration;

    fn far() -> Instant {
        Instant::now() + Duration::from_secs(600)
    }

    /// Flat-board legal, non-forbidden, non-eye moves (the root list the engine would give).
    fn root_list(b: &Board) -> Vec<u8> {
        let mut l = Vec::new();
        moves(b, OFF, &mut l);
        l.into_iter().map(|x| x.1).filter(|&m| m != PASS).collect()
    }

    fn with_forbid(cellv: &[u8; NN], to_move: u8) -> Board {
        let mut b = Board::from_cells(cellv, to_move);
        b.forbid = settled(cellv).forbid();
        b
    }

    /// Random endgames: play random legal moves from a settled-looking base until few
    /// unsettled points remain.
    fn random_endings(seed: u64, count: usize, max_unsettled: u32) -> Vec<Board> {
        let base = cells(&[
            ".X.XO.O.O",
            "XXXXOOOOO",
            ".........",
            ".........",
            ".........",
            ".........",
            ".........",
            "XXXXOOOOO",
            ".X.XO.O.O",
        ]);
        let mut rng = Rng(seed | 1);
        let mut out = Vec::new();
        while out.len() < count {
            let mut b = Board::from_cells(&base, BLACK);
            let mut buf = [0u8; NN];
            for _ in 0..200 {
                b.forbid = settled(&b.cell).forbid();
                let n = unsettled_points(&settled(&b.cell));
                if n <= max_unsettled {
                    break;
                }
                let m = b.random_move(&mut rng, &mut buf);
                b.play(if m == PASS { PASS } else { m });
                b.passes = 0;
            }
            let s = settled(&b.cell);
            if unsettled_points(&s) <= max_unsettled {
                b.forbid = s.forbid();
                b.passes = 0;
                b.ko = PASS;
                out.push(b);
            }
        }
        out
    }

    #[test]
    fn alpha_beta_agrees_with_minimax() {
        let mut checked = 0;
        // The ply cap keeps plain minimax affordable; the solver must match it exactly.
        for (i, b) in random_endings(42, 30, 4).into_iter().enumerate() {
            let cap = 8;
            let want = minimax(&b, 0, cap);
            let mut s = Solver::new(far(), 12, cap);
            let got = s.negamax(&b, 0, -INF, INF);
            assert_eq!(got, want, "ending {i}");
            // Null-window win test agrees on the sign.
            let mut s = Solver::new(far(), 12, cap);
            let w = s.negamax(&b, 0, -1, 1);
            assert_eq!(w > 0, want > 0, "ending {i}: null window");
            // The root solve finds a move achieving the value.
            let mut s = Solver::new(far(), 12, cap);
            let (m, v) = s.solve_root(&b, &root_list(&b), -INF, INF).unwrap();
            assert_eq!(v, want);
            let mut child = b.clone();
            child.play(m);
            assert_eq!(-minimax(&child, 1, cap), want, "ending {i}: best move");
            checked += 1;
        }
        assert_eq!(checked, 30);
    }

    #[test]
    fn dame_and_pass() {
        // Board split down the middle, both sides alive, one dame at e5 between them: whoever
        // is to move may take it (a point) or pass; Black needs it to win? Black has 36 + the
        // left area, white the same: compute and check the solver takes the dame.
        let c = cells(&[
            ".X.XO.O.O",
            "XXXXOOOOO",
            "...XO....",
            "XXXXOOOOO",
            ".X.X.O.O.",
            "XXXXOOOOO",
            "...XO....",
            "XXXXOOOOO",
            ".X.XO.O.O",
        ]);
        let b = with_forbid(&c, BLACK);
        assert_eq!(unsettled_points(&settled(&b.cell)), 1);
        let mut s = Solver::new(far(), 12, 20);
        let (m, v) = s.solve_root(&b, &root_list(&b), -INF, INF).unwrap();
        assert_eq!(m, 4 * 9 + 4, "black takes the dame e5");
        let mut after = b.clone();
        after.play(m);
        after.play(PASS);
        after.play(PASS);
        assert_eq!(v, final_value(&{
            let mut x = after.clone();
            x.to_move = BLACK;
            x
        }));
        // With nothing left, the only move is pass.
        let mut full = after.clone();
        full.passes = 0;
        full.to_move = WHITE;
        full.forbid = settled(&full.cell).forbid();
        assert!(root_list(&full).is_empty());
    }

    #[test]
    fn captures_dead_stones_before_passing() {
        // A white stone sits dead in black's big eye (c9..e9). Under Tromp-Taylor it counts
        // until captured, so black must take it rather than pass.
        let c = cells(&[
            ".X.O.XO.O",
            "XXXXXXOOO",
            "XXXXXXOOO",
            "XXXXXXOOO",
            "XXXXXXOOO",
            "XXXXXXOOO",
            "XXXXXXOOO",
            "XXXXXXOOO",
            ".X.X.XO.O",
        ]);
        let b = with_forbid(&c, BLACK);
        let mut s = Solver::new(far(), 14, 30);
        let (m, v) = s.solve_root(&b, &root_list(&b), -INF, INF).unwrap();
        assert!(m == 2 || m == 4, "black fills a liberty of the dead stone, got {m}");
        // Black's area: everything left of the white wall = 6 columns * 9 = 54 points; white 27.
        assert_eq!(v, 2 * 54 - 2 * 27 - 15);
    }

    #[test]
    #[ignore]
    fn solve_report() {
        // Timing table: solve time by unsettled points (cargo test --release solve_report --
        // --ignored --nocapture).
        for n in [4u32, 6, 8, 10, 12, 14, 16, 18, 20, 24] {
            let ends = random_endings(1000 + n as u64, 8, n);
            for (name, lo, hi) in [("full", -INF, INF), ("win/loss", -1, 1)] {
                let mut times = Vec::new();
                let (mut nodes, mut fails) = (0, 0);
                for b in &ends {
                    let t = Instant::now();
                    let mut s = Solver::new(Instant::now() + Duration::from_secs(2), 18, 3 * n + 20);
                    if s.solve_root(b, &root_list(b), lo, hi).is_none() {
                        fails += 1;
                    }
                    nodes += s.nodes;
                    times.push(t.elapsed().as_secs_f64() * 1e3);
                }
                times.sort_by(|a, b| a.partial_cmp(b).unwrap());
                let within = times.iter().filter(|&&t| t <= 100.0).count();
                println!(
                    "unsettled<={n} {name}: median {:.1} ms, max {:.1} ms, <=100ms {within}/8, timeouts {fails}/8, {:.0} knodes avg",
                    times[times.len() / 2],
                    times[times.len() - 1],
                    nodes as f64 / 8e3
                );
            }
        }
    }
}
