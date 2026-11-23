//! Flat 11×11 Hex board for playouts: one `u128` bitboard per colour, cell index
//! `row * 11 + column` (the referee's index). `hexgame` stays the authority for legality and
//! the game replay; this board only exists to make random fill-in playouts cheap.

/// Cells on the board.
pub const CELLS: usize = 121;
/// Row stride.
const W: u32 = 11;

/// Mask of all 121 cells.
pub const ALL: u128 = (1u128 << CELLS) - 1;

const fn row_mask(r: u32) -> u128 {
    ((1u128 << W) - 1) << (r * W)
}

const fn col_mask(c: u32) -> u128 {
    let mut m = 0u128;
    let mut r = 0;
    while r < W {
        m |= 1u128 << (r * W + c);
        r += 1;
    }
    m
}

/// Top row (Black's start edge) and bottom row.
pub const TOP: u128 = row_mask(0);
pub const BOTTOM: u128 = row_mask(W - 1);
/// Left column (White's start edge) and right column.
pub const LEFT: u128 = col_mask(0);
pub const RIGHT: u128 = col_mask(W - 1);

/// Every cell adjacent to a cell of `x` (plus `x` itself). Neighbours of (r, c):
/// (r, c±1), (r−1, c), (r−1, c+1), (r+1, c), (r+1, c−1) — indices ±1, −11, −10, +11, +10.
#[inline]
pub fn grow(x: u128) -> u128 {
    let not_left = x & !LEFT;
    let not_right = x & !RIGHT;
    (x | (x << W)
        | (x >> W)
        | (not_right << 1)
        | (not_left >> 1)
        | (not_left << (W - 1))
        | (not_right >> (W - 1)))
        & ALL
}

/// The cells of `stones` connected to `from` through `stones` (flood fill).
#[inline]
fn reach(stones: u128, from: u128) -> u128 {
    let mut set = stones & from;
    loop {
        let next = grow(set) & stones;
        if next == set {
            return set;
        }
        set = next;
    }
}

/// Does `black` join the top and bottom rows?
#[inline]
pub fn black_connects(black: u128) -> bool {
    reach(black, TOP) & BOTTOM != 0
}

/// Does `white` join the left and right columns?
#[inline]
#[cfg(test)]
pub fn white_connects(white: u128) -> bool {
    reach(white, LEFT) & RIGHT != 0
}

/// Small, fast, deterministic RNG (xorshift64*).
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed ^ 0x9E37_79B9_7F4A_7C15 | 1)
    }

    #[inline]
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// Uniform in `0..n` (n ≤ 121, so the multiply-shift bias is negligible).
    #[inline]
    pub fn below(&mut self, n: usize) -> usize {
        ((self.next_u64() >> 32) * n as u64 >> 32) as usize
    }
}

/// One random fill-in playout. `black`/`white` are the stones on the board, `black_to_move`
/// the side to move. Every empty cell is filled in one random order, alternating colours from
/// the side to move, so the side to move gets ⌈k/2⌉ of the k empty cells. A full Hex board
/// always has exactly one winner, so one connection check at the end decides it.
/// Returns true if Black wins.
#[cfg_attr(not(test), allow(dead_code))]
pub fn playout(black: u128, white: u128, black_to_move: bool, rng: &mut Rng) -> bool {
    black_connects(fill(black, white, black_to_move, rng))
}

/// Bridge pairing in the fill-in (#60): before the random split, each bridge whose two carrier
/// cells are both empty gives one carrier cell to each colour, so no playout cuts a bridge.
pub const BRIDGE_PAIRING: bool = true;

/// The fill-in of [`playout`] without the connection check: returns Black's final board
/// (White owns every other cell). The search reads AMAF statistics from it.
#[inline]
pub fn fill(black: u128, white: u128, black_to_move: bool, rng: &mut Rng) -> u128 {
    if BRIDGE_PAIRING {
        fill_bridges(black, white, black_to_move, rng)
    } else {
        fill_uniform(black, white, black_to_move, rng)
    }
}

/// Uniform fill-in: every empty cell in one random order, alternating colours from the side to
/// move (the side to move gets ⌈k/2⌉ of the k empty cells).
pub fn fill_uniform(black: u128, white: u128, black_to_move: bool, rng: &mut Rng) -> u128 {
    split(black, ALL & !(black | white), black_to_move, rng)
}

/// Shift `x` so that bit `i + d` lands on bit `i` (d may be negative).
#[inline]
const fn back(x: u128, d: i32) -> u128 {
    if d >= 0 {
        x >> d
    } else {
        (x << -d) & ALL
    }
}

/// The three bridge directions that point down the board (each bridge is found once, from its
/// upper stone): offset of the far stone, offsets of the two carrier cells, and the origin
/// cells whose column leaves room for the bridge. Neighbours of (r, c) are (r, c±1),
/// (r−1, c), (r−1, c+1), (r+1, c), (r+1, c−1).
const BRIDGE_DIRS: [(i32, i32, i32, u128); 3] = [
    // (r+1, c+1) through (r, c+1) and (r+1, c).
    (12, 1, 11, ALL & !RIGHT),
    // (r+2, c−1) through (r+1, c−1) and (r+1, c).
    (21, 10, 11, ALL & !LEFT),
    // (r+1, c−2) through (r, c−1) and (r+1, c−1).
    (9, -1, 10, ALL & !LEFT & !col_mask(1)),
];

/// Every bridge of either colour whose carrier is empty, as its two carrier cells.
/// Returns how many it wrote (at most 3 per stone, so 363 fits).
#[inline]
fn bridges(black: u128, white: u128, out: &mut [(u8, u8); 364]) -> usize {
    let empty = ALL & !(black | white);
    let mut n = 0;
    for stones in [black, white] {
        for (far, ca, cb, mask) in BRIDGE_DIRS {
            let mut origins = stones & mask & back(stones, far) & back(empty, ca) & back(empty, cb);
            while origins != 0 {
                let a = origins.trailing_zeros() as i32;
                out[n] = ((a + ca) as u8, (a + cb) as u8);
                n += 1;
                origins &= origins - 1;
            }
        }
    }
    n
}

/// Bridge-preserving fill-in: visit the bridges with an empty carrier in random order; each one
/// whose two carrier cells are both still unassigned gives one (chosen at random) to each
/// colour. The remaining empty cells are split as in [`fill_uniform`], minus one cell per pair
/// for each side, so the side to move still gets ⌈k/2⌉ of all k empty cells.
pub fn fill_bridges(black: u128, white: u128, black_to_move: bool, rng: &mut Rng) -> u128 {
    let (black_gets, rest) = pair_bridges(black, white, rng);
    split(black | black_gets, rest, black_to_move, rng)
}

/// The bridge-pairing pass of [`fill_bridges`]: returns the carrier cells it gave Black and the
/// cells still unassigned (empty and in no paired carrier).
#[inline]
fn pair_bridges(black: u128, white: u128, rng: &mut Rng) -> (u128, u128) {
    let mut list = [(0u8, 0u8); 364];
    let n = bridges(black, white, &mut list);
    let mut taken = 0u128;
    let mut black_gets = 0u128;
    for i in 0..n {
        let r = rng.next_u64();
        let j = i + ((r >> 32) * (n - i) as u64 >> 32) as usize;
        list.swap(i, j);
        let (a, b) = list[i];
        let pair = 1u128 << a | 1u128 << b;
        if taken & pair == 0 {
            taken |= pair;
            black_gets |= 1u128 << if r & 1 == 0 { a } else { b };
        }
    }
    (black_gets, ALL & !(black | white | taken))
}

/// Per-cell acceptance thresholds for [`fill_weighted`], one table per side to move: cell `i`
/// is accepted for the side to move with probability `thr[i] / 2^32` each time it is drawn.
/// `u32::MAX` means "always accept, without drawing a number", so an all-`MAX` table gives
/// exactly the uniform split (same random stream).
pub type Weights = [u32; 128];

/// Thresholds from an ownership map (`own[i]` = fraction of playouts Black owned cell `i`):
/// the side to move's weight is `0.5 + lambda * (own_side - 0.5)`, divided by the largest
/// possible weight `0.5 + lambda / 2`. Returns (Black to move, White to move).
pub fn ownership_weights(own: &[f32; CELLS], lambda: f32) -> (Weights, Weights) {
    let mut wb = [u32::MAX; 128];
    let mut ww = [u32::MAX; 128];
    if lambda <= 0.0 {
        return (wb, ww);
    }
    let top = 0.5 + lambda / 2.0;
    let thr = |o: f32| -> u32 {
        let w = (0.5 + lambda * (o - 0.5)) / top;
        if w >= 1.0 {
            u32::MAX - 1
        } else {
            (w * 4_294_967_296.0) as u32
        }
    };
    for i in 0..CELLS {
        wb[i] = thr(own[i]);
        ww[i] = thr(1.0 - own[i]);
    }
    (wb, ww)
}

/// Ownership-guided fill-in (#88): bridge pairing as in [`fill_bridges`], then the side to
/// move's ⌈k/2⌉ cells of the k remaining are drawn by successive weighted sampling without
/// replacement (draw a remaining cell uniformly, keep it with probability `w[cell]`, else draw
/// again), so the per-colour counts are exactly those of the uniform split.
pub fn fill_weighted(
    black: u128,
    white: u128,
    black_to_move: bool,
    w: &Weights,
    rng: &mut Rng,
) -> u128 {
    let (black_gets, rest) = if BRIDGE_PAIRING {
        pair_bridges(black, white, rng)
    } else {
        (0, ALL & !(black | white))
    };
    split_weighted(black | black_gets, rest, black_to_move, w, rng)
}

/// [`split`] with per-cell acceptance (see [`Weights`]).
#[inline]
fn split_weighted(
    black: u128,
    empty: u128,
    black_to_move: bool,
    w: &Weights,
    rng: &mut Rng,
) -> u128 {
    let mut cells = [0u8; CELLS];
    let mut k = 0;
    let mut bits = empty;
    while bits != 0 {
        cells[k] = bits.trailing_zeros() as u8;
        k += 1;
        bits &= bits - 1;
    }
    let mine = k.div_ceil(2);
    let mut picked = 0u128;
    for i in 0..mine {
        loop {
            let j = i + rng.below(k - i);
            let t = w[cells[j] as usize];
            if t == u32::MAX || ((rng.next_u64() >> 32) as u32) < t {
                cells.swap(i, j);
                break;
            }
        }
        picked |= 1u128 << cells[i];
    }
    if black_to_move {
        black | picked
    } else {
        black | (empty & !picked)
    }
}

/// Split the k cells of `empty` at random: ⌈k/2⌉ to the side to move, the rest to the other
/// side. Returns Black's final board. After bridge pairing (p cells to each side) k has the
/// parity of all k + 2p empties, so the side to move still ends with ⌈(k + 2p)/2⌉ of them.
#[inline]
fn split(black: u128, empty: u128, black_to_move: bool, rng: &mut Rng) -> u128 {
    let mut cells = [0u8; CELLS];
    let mut k = 0;
    let mut bits = empty;
    while bits != 0 {
        cells[k] = bits.trailing_zeros() as u8;
        k += 1;
        bits &= bits - 1;
    }
    // Partial Fisher–Yates: the first ⌈k/2⌉ picks go to the side to move.
    let mine = k.div_ceil(2);
    let mut picked = 0u128;
    for i in 0..mine {
        let j = i + rng.below(k - i);
        cells.swap(i, j);
        picked |= 1u128 << cells[i];
    }
    if black_to_move {
        black | picked
    } else {
        black | (empty & !picked)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks() {
        assert_eq!(TOP.count_ones(), 11);
        assert_eq!(LEFT.count_ones(), 11);
        assert_eq!(ALL.count_ones(), 121);
        assert_eq!(TOP & LEFT, 1);
        assert_eq!(BOTTOM & RIGHT, 1u128 << 120);
    }

    #[test]
    fn grow_matches_neighbour_offsets() {
        for r in 0..11i32 {
            for c in 0..11i32 {
                let i = (r * 11 + c) as u32;
                let mut want = 1u128 << i;
                for (dr, dc) in [(-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0)] {
                    let (nr, nc) = (r + dr, c + dc);
                    if (0..11).contains(&nr) && (0..11).contains(&nc) {
                        want |= 1u128 << (nr * 11 + nc);
                    }
                }
                assert_eq!(grow(1u128 << i), want, "cell ({r}, {c})");
            }
        }
    }

    #[test]
    fn full_board_has_exactly_one_winner() {
        let mut rng = Rng::new(7);
        for _ in 0..500 {
            let mut black = 0u128;
            for i in 0..CELLS {
                if rng.next_u64() & 1 == 0 {
                    black |= 1u128 << i;
                }
            }
            let white = ALL & !black;
            assert_ne!(black_connects(black), white_connects(white));
        }
    }

    #[test]
    fn playout_fills_by_parity() {
        // On the empty board with Black to move, Black gets 61 cells; a playout must report a
        // winner consistent with some full fill. Check the split directly.
        let mut rng = Rng::new(3);
        let mut black_wins = 0;
        for _ in 0..2000 {
            if playout(0, 0, true, &mut rng) {
                black_wins += 1;
            }
        }
        // First player wins random fill-ins a bit more than half the time; it must not be
        // degenerate either way.
        assert!((900..1300).contains(&black_wins), "{black_wins}");
    }

    /// Random position: `stones` cells, alternating colours. Returns (black, white, black_to_move).
    fn random_position(rng: &mut Rng, stones: usize) -> (u128, u128, bool) {
        let (mut b, mut w) = (0u128, 0u128);
        for s in 0..stones {
            loop {
                let c = rng.below(CELLS);
                if (b | w) >> c & 1 == 0 {
                    if s % 2 == 0 {
                        b |= 1u128 << c;
                    } else {
                        w |= 1u128 << c;
                    }
                    break;
                }
            }
        }
        (b, w, stones % 2 == 0)
    }

    #[test]
    fn bridge_fill_keeps_the_split() {
        let mut rng = Rng::new(17);
        for t in 0..2000 {
            let (b, w, btm) = random_position(&mut rng, t % 110);
            let u = fill_uniform(b, w, btm, &mut rng);
            let p = fill_bridges(b, w, btm, &mut rng);
            assert_eq!(p & b, b, "keeps Black's stones");
            assert_eq!(p & w, 0, "never takes White's stones");
            assert_eq!(p.count_ones(), u.count_ones(), "position {t}");
        }
    }

    #[test]
    fn bridges_are_found_in_all_six_directions() {
        // Centre stone (5, 5) with a partner at each bridge offset: one bridge each, and the
        // carriers are the two common neighbours.
        let centre = 5 * 11 + 5;
        for (dr, dc) in [(-2, 1), (-1, 2), (1, 1), (2, -1), (1, -2), (-1, -1)] {
            let other = ((5 + dr) * 11 + 5 + dc) as u32;
            let black = 1u128 << centre | 1u128 << other;
            let mut out = [(0u8, 0u8); 364];
            assert_eq!(bridges(black, 0, &mut out), 1, "offset ({dr}, {dc})");
            let carrier = 1u128 << out[0].0 | 1u128 << out[0].1;
            assert_eq!(
                carrier,
                grow(1u128 << centre) & grow(1u128 << other) & !black
            );
            assert_eq!(bridges(0, black, &mut out), 1, "White, offset ({dr}, {dc})");
        }
        // Brute force over every pair of cells: a bridge is two non-adjacent cells with exactly
        // two common neighbours (so nothing wraps around the board's sides).
        for a in 0..CELLS as u32 {
            for b in a + 1..CELLS as u32 {
                let stones = 1u128 << a | 1u128 << b;
                let common = grow(1u128 << a) & grow(1u128 << b) & !stones;
                let adjacent = grow(1u128 << a) >> b & 1 == 1;
                let want = usize::from(!adjacent && common.count_ones() == 2);
                let mut out = [(0u8, 0u8); 364];
                assert_eq!(bridges(stones, 0, &mut out), want, "cells {a} and {b}");
            }
        }
        // An occupied carrier cell disables the bridge.
        let black = 1u128 << centre | 1u128 << (centre + 12);
        let mut out = [(0u8, 0u8); 364];
        assert_eq!(bridges(black, 1u128 << (centre + 1), &mut out), 0);
    }

    #[test]
    fn every_bridge_fill_keeps_a_black_bridge_connected() {
        // Black bridge d4–e5 with an empty carrier, a White wall around it, White to move.
        let (a, b) = (3 * 11 + 3, 4 * 11 + 4);
        let black = 1u128 << a | 1u128 << b;
        let white = 1u128 << (2 * 11 + 6) | 1u128 << (7 * 11 + 2) | 1u128 << (5 * 11 + 8);
        let mut rng = Rng::new(5);
        let mut cut = 0;
        for _ in 0..5000 {
            let fb = fill_bridges(black, white, false, &mut rng);
            assert_ne!(reach(fb, 1u128 << a) >> b & 1, 0, "the bridge must hold");
            if reach(fill_uniform(black, white, false, &mut rng), 1u128 << a) >> b & 1 == 0 {
                cut += 1;
            }
        }
        // The uniform fill does cut it sometimes (about a quarter of the time).
        assert!(cut > 500, "{cut}");
    }

    #[test]
    fn weighted_fill_keeps_the_counts_and_lambda_zero_is_uniform() {
        let mut rng = Rng::new(23);
        let mut own = [0.0f32; CELLS];
        for (i, o) in own.iter_mut().enumerate() {
            *o = (i % 11) as f32 / 10.0;
        }
        let (zb, zw) = ownership_weights(&own, 0.0);
        for lambda in [0.25f32, 0.5, 1.0] {
            let (wb, ww) = ownership_weights(&own, lambda);
            for t in 0..2000 {
                let (b, w, btm) = random_position(&mut rng, t % 110);
                let table = if btm { &wb } else { &ww };
                let u = fill_bridges(b, w, btm, &mut rng);
                let p = fill_weighted(b, w, btm, table, &mut rng);
                assert_eq!(p & b, b, "keeps Black's stones");
                assert_eq!(p & w, 0, "never takes White's stones");
                assert_eq!(
                    p.count_ones(),
                    u.count_ones(),
                    "lambda {lambda}, position {t}"
                );
                // lambda = 0: the same random stream gives exactly the uniform fill.
                let seed = rng.next_u64();
                let z = if btm { &zb } else { &zw };
                let a = fill_weighted(b, w, btm, z, &mut Rng::new(seed));
                assert_eq!(a, fill_bridges(b, w, btm, &mut Rng::new(seed)));
            }
        }
    }

    #[test]
    fn weighted_fill_follows_the_ownership_map() {
        // Black owns the left half of the map, White the right: with lambda = 0.5 Black's share
        // of the left-half cells on the empty board must clearly exceed one half.
        let mut own = [0.0f32; CELLS];
        for (i, o) in own.iter_mut().enumerate() {
            *o = if i % 11 < 5 { 1.0 } else { 0.0 };
        }
        let left = (0..CELLS)
            .filter(|i| i % 11 < 5)
            .fold(0u128, |a, i| a | 1u128 << i);
        let mut rng = Rng::new(31);
        for (lambda, lo, hi) in [(0.0f32, 0.45, 0.55), (0.5, 0.58, 0.8)] {
            let (wb, ww) = ownership_weights(&own, lambda);
            let mut owned = 0u64;
            for t in 0..2000 {
                let btm = t % 2 == 0;
                let table = if btm { &wb } else { &ww };
                owned += (fill_weighted(0, 0, btm, table, &mut rng) & left).count_ones() as u64;
            }
            let share = owned as f64 / (2000.0 * left.count_ones() as f64);
            assert!((lo..hi).contains(&share), "lambda {lambda}: {share}");
        }
    }
}
