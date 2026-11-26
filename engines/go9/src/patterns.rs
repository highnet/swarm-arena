//! 3×3 shape patterns for the playout policy (#189).
//!
//! A candidate point's neighbourhood is its 8 surrounding points, read clockwise from north
//! (N, NE, E, SE, S, SW, W, NW), 2 bits each: 0 empty, 1 black, 2 white, 3 off the board. That
//! is a 16-bit key into `TABLE`, a 65536-bit set of "good shape" keys built at compile time.
//! Every pattern is expanded over the board's 8 symmetries and the colour swap, so a lookup is
//! one load and does not depend on who is to move: a shape point is usually vital for both
//! sides (where one side hanes, the other wants to extend; where one cuts, the other connects).
//!
//! The shapes are written here from textbook Go ideas (hane, cut, block at a contact point,
//! blocking a crawl on the first line); they are not taken from any engine.

/// Pattern rows, top to bottom, centre `*` = the candidate (empty). `X` and `O` are the two
/// colours (either way round after the colour swap), `.` empty, `#` off the board, `?` anything.
const SHAPES: [[&str; 3]; 9] = [
    // Hane at the head of a contact: X's stone touches O; X plays diagonally around it.
    ["XO.", ".*.", "???"],
    // Hane against two stones in a row.
    ["XOO", ".*.", "???"],
    // Cut: O's two stones touch only through the diagonal X holds and the centre.
    ["XO?", "O*.", "???"],
    ["XO?", "O*?", "?.?"],
    // Block at a contact point: X's solid pair stops O from turning the corner.
    ["XO?", "X*?", "?.?"],
    // Hane under a contact on the side: X blocks O's extension along X's stones.
    ["X..", "O*.", "???"],
    // Edge: block the crawl. O crawls on the first line under X's second-line stone.
    ["?X?", "O*.", "###"],
    // Edge: descend to block when O presses from the second line.
    ["?O?", "X*.", "###"],
    // Edge hane on the first line next to O's second-line stone.
    ["XO.", ".*.", "###"],
];

/// Ring order (dr, dc) of the 8 neighbours: N, NE, E, SE, S, SW, W, NW.
pub const RING: [(i8, i8); 8] = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)];

/// Which grid cell (row, col) of a pattern each ring slot reads.
const fn slot_cell(i: usize) -> (usize, usize) {
    let (dr, dc) = RING[i];
    ((dr + 1) as usize, (dc + 1) as usize)
}

/// Ring index after rotating the board 90° clockwise (`rot`) times and, first, mirroring
/// left-right (`mirror`).
const fn map_slot(i: usize, mirror: bool, rot: usize) -> usize {
    let m = if mirror { (8 - i) % 8 } else { i };
    (m + 2 * rot) % 8
}

/// The key after a symmetry and optionally the colour swap.
pub const fn transform(key: u16, mirror: bool, rot: usize, swap: bool) -> u16 {
    let mut out = 0u16;
    let mut i = 0;
    while i < 8 {
        let mut v = (key >> (2 * i)) & 3;
        if swap && (v == 1 || v == 2) {
            v = 3 - v;
        }
        out |= v << (2 * map_slot(i, mirror, rot));
        i += 1;
    }
    out
}

const fn build() -> [u64; 1024] {
    let mut t = [0u64; 1024];
    let mut s = 0;
    while s < SHAPES.len() {
        // Per slot: the set of allowed values as a 4-bit mask.
        let mut allow = [0u8; 8];
        let mut i = 0;
        while i < 8 {
            let (r, c) = slot_cell(i);
            let ch = SHAPES[s][r].as_bytes()[c];
            allow[i] = match ch {
                b'.' => 1,
                b'X' => 2,
                b'O' => 4,
                b'#' => 8,
                b'?' => 15,
                _ => panic!("bad pattern character"),
            };
            i += 1;
        }
        // Enumerate every concrete key the pattern allows.
        let mut key = 0u32;
        while key < 65536 {
            let mut ok = true;
            let mut j = 0;
            while j < 8 {
                if allow[j] & (1 << ((key >> (2 * j)) & 3)) == 0 {
                    ok = false;
                    break;
                }
                j += 1;
            }
            if ok {
                let mut sym = 0;
                while sym < 16 {
                    let k = transform(key as u16, sym & 1 == 1, (sym >> 1) & 3, sym >> 3 == 1);
                    t[(k >> 6) as usize] |= 1u64 << (k & 63);
                    sym += 1;
                }
            }
            key += 1;
        }
        s += 1;
    }
    t
}

/// The good-shape keys, one bit each.
pub static TABLE: [u64; 1024] = build();

#[inline]
pub fn is_shape(key: u16) -> bool {
    TABLE[(key >> 6) as usize] >> (key & 63) & 1 == 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_is_closed_under_symmetry_and_colour_swap() {
        let mut matches = 0;
        for key in 0..=u16::MAX {
            if !is_shape(key) {
                continue;
            }
            matches += 1;
            for sym in 0..16 {
                let k = transform(key, sym & 1 == 1, (sym >> 1) & 3, sym >> 3 == 1);
                assert!(is_shape(k), "key {key:#06x} matches but its transform {sym} does not");
            }
        }
        assert!(matches > 0);
    }

    #[test]
    fn every_shape_point_has_an_empty_liberty() {
        // Slots 0, 2, 4, 6 are N, E, S, W. The playout relies on this: a match is never an eye
        // and never suicide.
        for key in 0..=u16::MAX {
            if is_shape(key) {
                assert!((0..4).any(|i| (key >> (4 * i)) & 3 == 0), "key {key:#06x}");
            }
        }
    }

    #[test]
    fn transforms_are_board_symmetries() {
        // A stone at N rotated once lands at E; mirrored, NE becomes NW.
        assert_eq!(transform(1, false, 1, false), 1 << 4);
        assert_eq!(transform(1 << 2, true, 0, false), 1 << 14);
        // Colour swap turns black into white and leaves the edge alone.
        assert_eq!(transform(1 | 3 << 2, false, 0, true), 2 | 3 << 2);
    }

    #[test]
    fn a_hane_matches_and_an_empty_neighbourhood_does_not() {
        assert!(!is_shape(0));
        // Black NW, white N, all else empty: the hane.
        let key = 1 << 14 | 2;
        assert!(is_shape(key));
        // Same with colours swapped and rotated.
        assert!(is_shape(transform(key, false, 3, true)));
    }
}
