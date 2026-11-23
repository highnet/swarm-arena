//! Endgame table generator: solves king + one piece against a lone king by retrograde analysis.
//!
//! This file is compiled only by `build.rs`, which writes the tables into `OUT_DIR` for the
//! engine to embed (`endgame.rs`). It is plain `std` with its own tiny move generator (three
//! pieces only), so the tests can check its output against the rules library as an independent
//! oracle.
//!
//! The strong side is always White here; the probe flips colours for a strong Black.
//! Squares are 0..64 with a1 = 0, b1 = 1, ..., h8 = 63.
//!
//! Full-space index: `((stm * 64 + k) * 64 + x) * 64 + w`, where `k` is the strong king, `x` the
//! strong piece, `w` the weak king, and `stm` 0 when the strong side is to move, 1 when the weak
//! side is. Value: 0 = draw (or an illegal position), `n > 0` = mate in `n - 1` plies (a win for
//! the strong side to move, a loss for the weak side to move).

pub const FULL: usize = 2 * 64 * 64 * 64;
/// Strong-king squares of the pawnless tables after the 8-fold symmetry (a1-d1-d4 triangle).
pub const TRIANGLE: [u8; 10] = [0, 1, 2, 3, 9, 10, 11, 18, 19, 27];

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Piece {
    Queen,
    Rook,
    /// A White pawn (moves up the board).
    Pawn,
}

const UNKNOWN: u8 = 255;

pub fn index(stm: usize, k: usize, x: usize, w: usize) -> usize {
    ((stm * 64 + k) * 64 + x) * 64 + w
}

fn bit(s: usize) -> u64 {
    1u64 << s
}

fn king_attacks(s: usize) -> u64 {
    let (f, r) = ((s % 8) as i32, (s / 8) as i32);
    let mut b = 0;
    for df in -1..=1 {
        for dr in -1..=1 {
            let (nf, nr) = (f + df, r + dr);
            if (df, dr) != (0, 0) && (0..8).contains(&nf) && (0..8).contains(&nr) {
                b |= bit((nr * 8 + nf) as usize);
            }
        }
    }
    b
}

/// Squares a slider on `s` attacks along `dirs`, stopping at (and including) the first occupied
/// square in `occ`.
fn slide(s: usize, dirs: &[(i32, i32)], occ: u64) -> u64 {
    let mut b = 0;
    for &(df, dr) in dirs {
        let (mut f, mut r) = ((s % 8) as i32 + df, (s / 8) as i32 + dr);
        while (0..8).contains(&f) && (0..8).contains(&r) {
            let t = (r * 8 + f) as usize;
            b |= bit(t);
            if occ & bit(t) != 0 {
                break;
            }
            f += df;
            r += dr;
        }
    }
    b
}

const ROOK_DIRS: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];
const QUEEN_DIRS: [(i32, i32); 8] = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)];

/// Squares the strong piece on `x` attacks, with `occ` blocking sliders.
fn piece_attacks(p: Piece, x: usize, occ: u64) -> u64 {
    match p {
        Piece::Queen => slide(x, &QUEEN_DIRS, occ),
        Piece::Rook => slide(x, &ROOK_DIRS, occ),
        Piece::Pawn => {
            let (f, r) = (x % 8, x / 8);
            let mut b = 0;
            if r < 7 {
                if f > 0 {
                    b |= bit(x + 7);
                }
                if f < 7 {
                    b |= bit(x + 9);
                }
            }
            b
        }
    }
}

fn legal(p: Piece, stm: usize, k: usize, x: usize, w: usize) -> bool {
    if k == x || k == w || x == w || king_attacks(k) & bit(w) != 0 {
        return false;
    }
    if p == Piece::Pawn && !(8..56).contains(&x) {
        return false;
    }
    // With the strong side to move, the weak king may not stand in check.
    !(stm == 0 && piece_attacks(p, x, bit(k)) & bit(w) != 0)
}

/// The weak king's legal destinations from `w`; `Err(())` if one of them captures the piece safely
/// (the ending is then a draw for the weak side).
fn weak_moves(p: Piece, k: usize, x: usize, w: usize) -> Result<Vec<usize>, ()> {
    let mut out = Vec::new();
    let guarded = king_attacks(k);
    let mut targets = king_attacks(w) & !guarded;
    while targets != 0 {
        let t = targets.trailing_zeros() as usize;
        targets &= targets - 1;
        if t == x {
            return Err(());
        }
        // The weak king no longer blocks the piece's rays once it has moved.
        if piece_attacks(p, x, bit(k)) & bit(t) == 0 {
            out.push(t);
        }
    }
    Ok(out)
}

/// A strong-side move's result.
enum Child {
    /// The same ending, weak side to move: (strong king, piece, weak king).
    Same(usize, usize, usize),
    /// A pawn promoted: the queen or rook ending, weak side to move.
    Promoted(Piece, usize, usize, usize),
}

fn strong_moves(p: Piece, k: usize, x: usize, w: usize) -> Vec<Child> {
    let mut out = Vec::new();
    let mut kt = king_attacks(k) & !bit(x) & !king_attacks(w);
    while kt != 0 {
        let t = kt.trailing_zeros() as usize;
        kt &= kt - 1;
        out.push(Child::Same(t, x, w));
    }
    match p {
        Piece::Queen | Piece::Rook => {
            let occ = bit(k) | bit(w);
            let mut xt = piece_attacks(p, x, occ) & !occ;
            while xt != 0 {
                let t = xt.trailing_zeros() as usize;
                xt &= xt - 1;
                out.push(Child::Same(k, t, w));
            }
        }
        Piece::Pawn => {
            let occ = bit(k) | bit(w);
            let one = x + 8;
            if occ & bit(one) == 0 {
                if one >= 56 {
                    out.push(Child::Promoted(Piece::Queen, k, one, w));
                    out.push(Child::Promoted(Piece::Rook, k, one, w));
                } else {
                    out.push(Child::Same(k, one, w));
                    if x / 8 == 1 && occ & bit(x + 16) == 0 {
                        out.push(Child::Same(k, x + 16, w));
                    }
                }
            }
        }
    }
    out
}

/// Solves one ending over the full space. A pawn ending needs the solved queen and rook endings
/// for its promotions.
pub fn solve(p: Piece, kqk: Option<&[u8]>, krk: Option<&[u8]>) -> Vec<u8> {
    let mut res = vec![0u8; FULL];
    // Positions still unresolved, per side to move, with their move lists.
    let mut strong: Vec<(usize, Vec<Child>)> = Vec::new();
    let mut weak: Vec<(usize, Vec<usize>)> = Vec::new();
    for k in 0..64 {
        for x in 0..64 {
            for w in 0..64 {
                if legal(p, 0, k, x, w) {
                    res[index(0, k, x, w)] = UNKNOWN;
                    strong.push((index(0, k, x, w), strong_moves(p, k, x, w)));
                }
                if legal(p, 1, k, x, w) {
                    let i = index(1, k, x, w);
                    match weak_moves(p, k, x, w) {
                        // A safe capture: the weak side draws; stays 0.
                        Err(()) => {}
                        Ok(m) if m.is_empty() => {
                            let check = piece_attacks(p, x, bit(k)) & bit(w) != 0;
                            res[i] = if check { 1 } else { 0 };
                        }
                        Ok(m) => {
                            res[i] = UNKNOWN;
                            weak.push((i, m.into_iter().map(|t| index(0, k, x, t)).collect()));
                        }
                    }
                }
            }
        }
    }
    let promoted = |q: Piece, k: usize, x: usize, w: usize| -> u8 {
        let t = if q == Piece::Queen { kqk } else { krk };
        t.expect("pawn ending needs the promotion tables")[index(1, k, x, w)]
    };
    // Pass `ply` labels positions mated in exactly `ply` plies: odd passes the strong side to move
    // (some move reaches a weak-side loss in ply - 1), even passes the weak side to move (every
    // move reaches a strong-side win, the longest in ply - 1).
    let mut quiet = 0;
    for ply in 1..250usize {
        let target = ply as u8; // the stored value of a child mated in ply - 1
        let mut found = Vec::new();
        if ply % 2 == 1 {
            strong.retain(|(i, moves)| {
                let win = moves.iter().any(|c| match *c {
                    Child::Same(k, x, w) => res[index(1, k, x, w)] == target,
                    Child::Promoted(q, k, x, w) => promoted(q, k, x, w) == target,
                });
                if win {
                    found.push(*i);
                }
                !win
            });
        } else {
            weak.retain(|(i, moves)| {
                let lost = moves.iter().all(|&c| (1..=target).contains(&res[c]));
                if lost {
                    found.push(*i);
                }
                !lost
            });
        }
        quiet = if found.is_empty() { quiet + 1 } else { 0 };
        for i in found {
            res[i] = target + 1;
        }
        // Promotion tables reach at most ~70 plies; past that two empty passes end the search.
        if quiet >= 2 && ply > 80 {
            break;
        }
    }
    for v in res.iter_mut() {
        if *v == UNKNOWN {
            *v = 0;
        }
    }
    res
}

/// The pawnless table with the strong king folded into the a1-d1-d4 triangle:
/// `((t * 64 + x) * 64 + w) * 2 + stm`.
pub fn pack_pawnless(full: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(10 * 64 * 64 * 2);
    for &k in TRIANGLE.iter() {
        for x in 0..64 {
            for w in 0..64 {
                for stm in 0..2 {
                    out.push(full[index(stm, k as usize, x, w)]);
                }
            }
        }
    }
    out
}

/// The pawn table with the pawn folded onto files a-d, ranks 2-7:
/// `((p * 64 + k) * 64 + w) * 2 + stm`, `p = (rank - 1) * 4 + file`.
pub fn pack_pawn(full: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(24 * 64 * 64 * 2);
    for p in 0..24 {
        let x = (p / 4 + 1) * 8 + p % 4;
        for k in 0..64 {
            for w in 0..64 {
                for stm in 0..2 {
                    out.push(full[index(stm, k, x, w)]);
                }
            }
        }
    }
    out
}
