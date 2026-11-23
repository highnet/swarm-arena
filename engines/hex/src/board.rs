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

/// The fill-in of [`playout`] without the connection check: returns Black's final board
/// (White owns every other cell). The search reads AMAF statistics from it.
pub fn fill(black: u128, white: u128, black_to_move: bool, rng: &mut Rng) -> u128 {
    let mut empty = [0u8; CELLS];
    let mut k = 0;
    let mut bits = ALL & !(black | white);
    while bits != 0 {
        empty[k] = bits.trailing_zeros() as u8;
        k += 1;
        bits &= bits - 1;
    }
    // Partial Fisher–Yates: the first ⌈k/2⌉ picks go to the side to move.
    let mine = k.div_ceil(2);
    let mut picked = 0u128;
    for i in 0..mine {
        let j = i + rng.below(k - i);
        empty.swap(i, j);
        picked |= 1u128 << empty[i];
    }
    let rest = ALL & !(black | white | picked);
    if black_to_move {
        black | picked
    } else {
        black | rest
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
}
