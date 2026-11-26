//! Learned cell prior (#155): a table from the local pattern around an empty cell to the win
//! rate of players who played there in the engine's own self-play games. The table is generated
//! offline by `src/bin/prior_gen.rs` (seeded, sharded, documented there), stored in the crate as
//! `prior.bin` and compiled in; no external data. The search gives each new child
//! `prior_visits` virtual visits at that win rate.
//!
//! Pattern. The six neighbours of the cell, in the cyclic slot order of `board::inferior` (up,
//! up-right, right, down, down-left, left), each one of five states seen from the mover:
//! empty, own stone, opponent stone, own edge, opponent edge (an off-board slot counts as the
//! edge of the colour that owns that side; the two acute-corner slots as Black's, as in
//! `board::inferior`). Index = Σ state(d) · 5^d.
//!
//! Folds. White's patterns are mapped onto Black's by the transpose (r, c) → (c, r), which is a
//! symmetry of the Hex board that swaps the two colours' edges: it reverses the slot order
//! (d → 5 − d). Then the 180° rotation (d → d + 3) is folded. Each class is stored at all its
//! raw indices, so a lookup needs no canonicalisation.

use crate::board::CELLS;
use std::sync::OnceLock;

/// Raw pattern indices: five states in each of six slots.
pub const PATTERNS: usize = 15_625;

/// Slot states, seen from the mover.
pub const EMPTY: u8 = 0;
pub const OWN: u8 = 1;
pub const OPP: u8 = 2;
pub const OWN_EDGE: u8 = 3;
pub const OPP_EDGE: u8 = 4;

/// The generated table: one byte per raw pattern, the smoothed win rate × 255.
static TABLE: &[u8; PATTERNS] = include_bytes!("prior.bin");

/// Neighbour of each cell in each slot: a cell index, or `BLACK_EDGE` / `WHITE_EDGE`.
pub const BLACK_EDGE: u8 = 121;
pub const WHITE_EDGE: u8 = 122;

const fn neighbours() -> [[u8; 6]; CELLS] {
    // (dr, dc) of the slots: up, up-right, right, down, down-left, left.
    const D: [(i32, i32); 6] = [(-1, 0), (-1, 1), (0, 1), (1, 0), (1, -1), (0, -1)];
    let mut out = [[0u8; 6]; CELLS];
    let mut i = 0;
    while i < CELLS {
        let (r, c) = ((i / 11) as i32, (i % 11) as i32);
        let mut d = 0;
        while d < 6 {
            let (nr, nc) = (r + D[d].0, c + D[d].1);
            out[i][d] = if nr >= 0 && nr < 11 && nc >= 0 && nc < 11 {
                (nr * 11 + nc) as u8
            } else if nr < 0 || nr > 10 {
                // Off the top or bottom (corner slots included): Black's edge.
                BLACK_EDGE
            } else {
                WHITE_EDGE
            };
            d += 1;
        }
        i += 1;
    }
    out
}

/// Slot neighbours of every cell.
pub static NB: [[u8; 6]; CELLS] = neighbours();

/// The pattern of `cell` for the mover (`black_moves`), on the position `black`/`white`.
#[inline]
pub fn pattern(black: u128, white: u128, cell: usize, black_moves: bool) -> usize {
    let (own, opp) = if black_moves {
        (black, white)
    } else {
        (white, black)
    };
    let mut idx = 0usize;
    let mut pow = 1usize;
    for d in 0..6 {
        let n = NB[cell][d];
        let s = match n {
            BLACK_EDGE => {
                if black_moves {
                    OWN_EDGE
                } else {
                    OPP_EDGE
                }
            }
            WHITE_EDGE => {
                if black_moves {
                    OPP_EDGE
                } else {
                    OWN_EDGE
                }
            }
            _ => ((own >> n) & 1) as u8 | (((opp >> n) & 1) as u8) << 1,
        };
        idx += s as usize * pow;
        pow *= 5;
    }
    idx
}

/// Digits of a raw index.
pub fn digits(mut idx: usize) -> [u8; 6] {
    let mut s = [0u8; 6];
    for d in s.iter_mut() {
        *d = (idx % 5) as u8;
        idx /= 5;
    }
    s
}

fn index(s: &[u8; 6]) -> usize {
    s.iter().rev().fold(0, |acc, &d| acc * 5 + d as usize)
}

/// Canonical index of a pattern seen by a mover of `black_moves`: White's are transposed
/// onto Black's, then the smaller of the pattern and its 180° rotation.
pub fn canonical(idx: usize, black_moves: bool) -> usize {
    let mut s = digits(idx);
    if !black_moves {
        s.reverse();
    }
    let mut r = [0u8; 6];
    for d in 0..6 {
        r[d] = s[(d + 3) % 6];
    }
    index(&s).min(index(&r))
}

/// Win rate tables for each mover (index 0 White, 1 Black), as the table's byte (× 255).
fn tables() -> &'static [[u8; PATTERNS]; 2] {
    static T: OnceLock<Box<[[u8; PATTERNS]; 2]>> = OnceLock::new();
    T.get_or_init(|| {
        let mut t = Box::new([[0u8; PATTERNS]; 2]);
        for idx in 0..PATTERNS {
            t[1][idx] = TABLE[canonical(idx, true)];
            t[0][idx] = TABLE[canonical(idx, false)];
        }
        t
    })
}

/// The learned win rate (× 255) of the mover playing `cell`.
#[inline]
pub fn rate(black: u128, white: u128, cell: usize, black_moves: bool) -> u8 {
    tables()[black_moves as usize][pattern(black, white, cell, black_moves)]
}

/// The raw table (for tests and the generator).
pub fn raw() -> &'static [u8; PATTERNS] {
    TABLE
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_loads_and_every_pattern_is_covered() {
        let t = raw();
        assert_eq!(t.len(), PATTERNS);
        // Every raw index resolves to a stored class whose rate is a sane probability, and the
        // stored class is the canonical one (the generator writes every index of a class).
        for idx in 0..PATTERNS {
            for black in [true, false] {
                let c = canonical(idx, black);
                assert!(c < PATTERNS);
                assert_eq!(canonical(c, true), c, "canonical index is a fixed point");
            }
            assert_eq!(
                t[idx],
                t[canonical(idx, true)],
                "index {idx} holds its class's rate"
            );
        }
        // The table was generated, not left flat.
        assert!(t.iter().any(|&v| v != t[0]));
        // Every pattern that occurs on a real position maps to an entry (no out-of-range
        // index), for both movers.
        let mut rng = crate::board::Rng::new(5);
        for t in 0..300 {
            let (mut b, mut w) = (0u128, 0u128);
            for s in 0..(t % 100) {
                loop {
                    let c = rng.below(CELLS);
                    if (b | w) >> c & 1 == 0 {
                        if s % 2 == 0 {
                            b |= 1 << c;
                        } else {
                            w |= 1 << c;
                        }
                        break;
                    }
                }
            }
            for cell in 0..CELLS {
                for bm in [true, false] {
                    assert!(pattern(b, w, cell, bm) < PATTERNS);
                    let _ = rate(b, w, cell, bm);
                }
            }
        }
    }

    #[test]
    fn folds_are_symmetries() {
        // The 180° rotation of the board maps cell i to 120 - i and keeps the colours.
        // The transpose maps (r, c) to (c, r) and swaps them.
        let mut rng = crate::board::Rng::new(9);
        for _ in 0..500 {
            let (mut b, mut w) = (0u128, 0u128);
            for c in 0..CELLS {
                match rng.below(3) {
                    0 => b |= 1 << c,
                    1 => w |= 1 << c,
                    _ => {}
                }
            }
            let rot = |x: u128| (0..CELLS).fold(0u128, |m, i| m | ((x >> i) & 1) << (120 - i));
            let tr = |x: u128| {
                (0..CELLS).fold(0u128, |m, i| m | ((x >> i) & 1) << ((i % 11) * 11 + i / 11))
            };
            let cell = rng.below(CELLS);
            let tcell = (cell % 11) * 11 + cell / 11;
            for bm in [true, false] {
                let p = canonical(pattern(b, w, cell, bm), bm);
                let pr = canonical(pattern(rot(b), rot(w), 120 - cell, bm), bm);
                // The two acute corners count their corner slot as Black's under both, which the
                // transpose does not preserve; skip them for the colour swap.
                assert_eq!(p, pr, "rotation at {cell}");
                if cell != 10 && cell != 110 {
                    let pt = canonical(pattern(tr(w), tr(b), tcell, !bm), !bm);
                    assert_eq!(p, pt, "transpose at {cell}");
                }
            }
        }
    }

    #[test]
    fn edge_slots() {
        // a1: up and up-right off the top (Black's), left off the left (White's).
        assert_eq!(
            NB[0],
            [BLACK_EDGE, BLACK_EDGE, 1, 11, WHITE_EDGE, WHITE_EDGE]
        );
        // f6 has six board neighbours: f5 g5 g6 f7 e7 e6.
        assert_eq!(NB[60], [49, 50, 61, 71, 70, 59]);
        let p = digits(pattern(0, 0, 0, true));
        assert_eq!(p, [OWN_EDGE, OWN_EDGE, EMPTY, EMPTY, OPP_EDGE, OPP_EDGE]);
        let p = digits(pattern(1 << 1, 1 << 11, 0, false));
        assert_eq!(p, [OPP_EDGE, OPP_EDGE, OPP, OWN, OWN_EDGE, OWN_EDGE]);
    }
}
