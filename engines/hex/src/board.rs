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
    if FILL_INFERIOR {
        fill_inferior(black, white, black_to_move, rng)
    } else if BRIDGE_PAIRING {
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
    bridges_from(black, white, 0, 0, black_to_move, rng)
}

/// The bridge pairing and split of [`fill_bridges`], with the cells of `taken` already
/// assigned (`black_gets` holds those that went to Black).
#[inline]
fn bridges_from(
    black: u128,
    white: u128,
    mut taken: u128,
    mut black_gets: u128,
    black_to_move: bool,
    rng: &mut Rng,
) -> u128 {
    let mut list = [(0u8, 0u8); 364];
    let n = bridges(black, white, &mut list);
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
    let rest = ALL & !(black | white | taken);
    split(black | black_gets, rest, black_to_move, rng)
}

/// Inferior-cell fill-in (#95): before the bridge pairing, give each captured pair to its
/// capturer and split the dead cells evenly (see [`fill_inferior`]).
pub const FILL_INFERIOR: bool = false;

// ---------------------------------------------------------------------------------------------
// Inferior cells (#95): dead cells and captured pairs, from fixed local patterns.
//
// The six neighbours of a cell in cyclic order around it: (r−1, c), (r−1, c+1), (r, c+1),
// (r+1, c), (r+1, c−1), (r, c−1); consecutive slots are adjacent to each other. An off-board
// slot is the edge beyond it and counts as a stone of the edge's owner (Black top/bottom, White
// left/right); the off-board corner slots of k1 (up-right) and a11 (down-left) count as Black.
//
// Dead cell: four consecutive slots of one colour. Then any chain through the cell can step
// between the cell's neighbours directly (consecutive slots touch, and the two other slots
// touch each other), so neither side ever needs the cell.
// Captured pair (a, b) for X: two adjacent empty cells where a has a run of four X slots once b
// counts as X, and b has one once a counts as X. If the opponent takes a, X answers b and a is
// dead, so the result is the same as X owning both.
// Only stones (never empty cells) make up the patterns, so they stay true whatever happens
// to the other empty cells.
// ---------------------------------------------------------------------------------------------

/// Index offset of the neighbour in each slot.
const SLOT_OFF: [i32; 6] = [-11, -10, 1, 11, 10, -1];
/// Cells whose neighbour in each slot is on the board, as far as columns go (rows fall off the
/// shifts by themselves).
const SLOT_COLS: [u128; 6] = [ALL, ALL & !RIGHT, ALL & !RIGHT, ALL, ALL & !LEFT, ALL & !LEFT];
/// Cells whose slot is off the board on a Black edge.
const SLOT_EDGE_BLACK: [u128; 6] = [TOP, TOP, 0, BOTTOM, BOTTOM, 0];
/// Cells whose slot is off the board on a White edge.
const SLOT_EDGE_WHITE: [u128; 6] = [0, RIGHT & !TOP, RIGHT, 0, LEFT & !BOTTOM, LEFT];

/// For each slot, the cells whose neighbour in that slot is a stone of `stones` or an edge of
/// `edges`.
#[inline]
fn slots(stones: u128, edges: &[u128; 6]) -> [u128; 6] {
    let mut s = [0u128; 6];
    for d in 0..6 {
        s[d] = (back(stones, SLOT_OFF[d]) & SLOT_COLS[d]) | edges[d];
    }
    s
}

/// Cells with four consecutive slots set.
#[inline]
fn four_in_a_row(s: &[u128; 6]) -> u128 {
    let mut out = 0;
    for i in 0..6 {
        out |= s[i] & s[(i + 1) % 6] & s[(i + 2) % 6] & s[(i + 3) % 6];
    }
    out
}

/// Cells that would have four consecutive slots set if slot `d` were set too (a run through d).
#[inline]
fn four_with(s: &[u128; 6], d: usize) -> u128 {
    let d = d % 6;
    let mut out = 0;
    for start in [d + 3, d + 4, d + 5, d] {
        let mut m = ALL;
        for k in 0..4 {
            let j = (start + k) % 6;
            if j != d {
                m &= s[j];
            }
        }
        out |= m;
    }
    out
}

/// The inferior cells of a position.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Inferior {
    /// Empty cells whose colour never changes the winner.
    pub dead: u128,
    /// Empty cells in a pair captured by Black / by White.
    pub captured: [u128; 2],
}

/// Captured pairs of `x` (one colour's slots) among `empty`: for the three forward slots
/// (+1, +11, +10), the lower cell of each pair. The partner is at `+ SLOT_OFF[d]`.
#[inline]
fn pairs_forward(s: &[u128; 6], empty: u128) -> [u128; 3] {
    let mut out = [0u128; 3];
    for (k, d) in [2usize, 3, 4].into_iter().enumerate() {
        let off = SLOT_OFF[d];
        out[k] = empty
            & back(empty, off)
            & SLOT_COLS[d]
            & four_with(s, d)
            & back(four_with(s, d + 3), off);
    }
    out
}

/// Complete local dead-cell test (#180). Off: only four consecutive slots of one colour (#95).
pub const DEAD_COMPLETE: bool = true;

/// The 15 ways to pick four slots in cyclic order.
const QUADS: [[usize; 4]; 15] = [
    [0, 1, 2, 3],
    [0, 1, 2, 4],
    [0, 1, 2, 5],
    [0, 1, 3, 4],
    [0, 1, 3, 5],
    [0, 1, 4, 5],
    [0, 2, 3, 4],
    [0, 2, 3, 5],
    [0, 2, 4, 5],
    [0, 3, 4, 5],
    [1, 2, 3, 4],
    [1, 2, 3, 5],
    [1, 2, 4, 5],
    [1, 3, 4, 5],
    [2, 3, 4, 5],
];

/// Cells that are *not* dead by the complete local test, given for each slot the cells whose
/// slot could end up Black (`nb`: not a White stone or edge) and could end up White (`nw`).
///
/// A cell's colour never matters for X when its X-neighbours, whatever the empty slots become,
/// form one run of consecutive slots: consecutive slots touch, so any X chain through the cell
/// can step around it. That fails for some completion exactly when four slots in cyclic order
/// alternate "could be X", "could be Y", "could be X", "could be Y" (colour the empty ones
/// that way: two separate X runs). The test is symmetric in X and Y, so a cell is dead (useless
/// to both) iff no four slots alternate. This contains the four-in-a-row rule and adds, e.g.,
/// three consecutive X with two consecutive Y next to them (X X X Y Y ·) and X X · Y Y ·.
#[inline]
fn alternating(nb: &[u128; 6], nw: &[u128; 6]) -> u128 {
    let mut alive = 0;
    for [a, b, c, d] in QUADS {
        alive |= nb[a] & nb[c] & nw[b] & nw[d];
        alive |= nw[a] & nw[c] & nb[b] & nb[d];
    }
    alive
}

/// Dead empty cells from the slot masks of both colours.
#[inline]
fn dead_cells(sb: &[u128; 6], sw: &[u128; 6], empty: u128) -> u128 {
    if !DEAD_COMPLETE {
        return empty & (four_in_a_row(sb) | four_in_a_row(sw));
    }
    let nb = sw.map(|m| !m);
    let nw = sb.map(|m| !m);
    empty & !alternating(&nb, &nw)
}

/// Vulnerable cells for the player `mover_black` (#180): empty cells c with an empty neighbour
/// d such that an opponent stone on d would make c dead. Returns, for each slot j, the cells c
/// that the opponent kills by playing their slot-j neighbour (which is empty).
///
/// The mover's move at c is then dominated by its move at d: with the opponent on d, c's colour
/// does not matter, so (mover c, opponent d) has the same winner as (opponent c, opponent d),
/// and giving d to the mover can only help it, which is (mover d, opponent c).
pub fn vulnerable(black: u128, white: u128, mover_black: bool) -> [u128; 6] {
    let empty = ALL & !(black | white);
    let sb = slots(black, &SLOT_EDGE_BLACK);
    let sw = slots(white, &SLOT_EDGE_WHITE);
    let alive_now = if DEAD_COMPLETE {
        alternating(&sw.map(|m| !m), &sb.map(|m| !m))
    } else {
        !(four_in_a_row(&sb) | four_in_a_row(&sw))
    };
    let candidates = empty & alive_now;
    let mut out = [0u128; 6];
    for j in 0..6 {
        let killer_empty = back(empty, SLOT_OFF[j]) & SLOT_COLS[j];
        let (mut b, mut w) = (sb, sw);
        if mover_black {
            w[j] |= killer_empty;
        } else {
            b[j] |= killer_empty;
        }
        out[j] = candidates & killer_empty & dead_cells(&b, &w, empty);
    }
    out
}

/// Cells whose neighbour in slot `j` is in `set`.
#[inline]
pub fn slot_neighbour_in(set: u128, j: usize) -> u128 {
    back(set, SLOT_OFF[j]) & SLOT_COLS[j]
}

/// Dead cells and captured pairs of the position.
pub fn inferior(black: u128, white: u128) -> Inferior {
    let empty = ALL & !(black | white);
    let sb = slots(black, &SLOT_EDGE_BLACK);
    let sw = slots(white, &SLOT_EDGE_WHITE);
    let dead = dead_cells(&sb, &sw, empty);
    let mut captured = [0u128; 2];
    for (side, s) in [&sb, &sw].into_iter().enumerate() {
        for (k, lower) in pairs_forward(s, empty).into_iter().enumerate() {
            captured[side] |= lower | (lower << SLOT_OFF[k + 2]) & ALL;
        }
    }
    Inferior { dead, captured }
}

/// Every captured pair as (lower cell, upper cell, captured by Black). At most 3 pairs per cell
/// per colour, so 726 fits.
fn captured_pairs(black: u128, white: u128, out: &mut [(u8, u8, bool); 726]) -> usize {
    let empty = ALL & !(black | white);
    let mut n = 0;
    for (black_owns, s) in [
        (true, slots(black, &SLOT_EDGE_BLACK)),
        (false, slots(white, &SLOT_EDGE_WHITE)),
    ] {
        for (k, mut lower) in pairs_forward(&s, empty).into_iter().enumerate() {
            while lower != 0 {
                let a = lower.trailing_zeros() as i32;
                out[n] = (a as u8, (a + SLOT_OFF[k + 2]) as u8, black_owns);
                n += 1;
                lower &= lower - 1;
            }
        }
    }
    n
}

/// Inferior-cell fill-in. Captured pairs, in random order, each whose two cells are still
/// unassigned go to the capturer: in play the opponent's intrusion is answered inside the pair,
/// so the pair costs each side one move, as a bridge does, and X owning both has the same winner
/// as that one-each split. Dead cells, which never change the winner, are then split evenly
/// (an odd one stays in the random split). Then the bridge pairing (if on) and the random split
/// of the rest, which keeps the parity, so the side to move still makes ⌈k/2⌉ of the k moves.
pub fn fill_inferior(black: u128, white: u128, black_to_move: bool, rng: &mut Rng) -> u128 {
    let mut list = [(0u8, 0u8, false); 726];
    let n = captured_pairs(black, white, &mut list);
    let mut taken = 0u128;
    let mut black_gets = 0u128;
    for i in 0..n {
        let j = i + rng.below(n - i);
        list.swap(i, j);
        let (a, b, to_black) = list[i];
        let pair = 1u128 << a | 1u128 << b;
        if taken & pair == 0 {
            taken |= pair;
            if to_black {
                black_gets |= pair;
            }
        }
    }
    let inf = inferior(black, white);
    let mut dead = inf.dead & !taken;
    let mut r = 0u64;
    let mut bits = 0;
    while dead.count_ones() >= 2 {
        if bits == 0 {
            r = rng.next_u64();
            bits = 64;
        }
        let a = dead.trailing_zeros();
        dead &= dead - 1;
        let b = dead.trailing_zeros();
        dead &= dead - 1;
        taken |= 1u128 << a | 1u128 << b;
        black_gets |= 1u128 << if r & 1 == 0 { a } else { b };
        r >>= 1;
        bits -= 1;
    }
    if BRIDGE_PAIRING {
        bridges_from(black, white, taken, black_gets, black_to_move, rng)
    } else {
        let rest = ALL & !(black | white | taken);
        split(black | black_gets, rest, black_to_move, rng)
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
            assert_eq!(carrier, grow(1u128 << centre) & grow(1u128 << other) & !black);
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

    // ---- Inferior cells (#95) ----

    const SLOT_STEP: [(i32, i32); 6] = [(-1, 0), (-1, 1), (0, 1), (1, 0), (1, -1), (0, -1)];

    fn at(r: i32, c: i32) -> u128 {
        1u128 << (r * 11 + c)
    }

    fn stones(cells: &[(i32, i32)]) -> u128 {
        cells.iter().fold(0, |m, &(r, c)| m | at(r, c))
    }

    #[test]
    fn slots_match_hexgame_neighbours_and_edges() {
        use hexgame::{Board, Coords, CoordsOrEdge, Edge};
        let board = Board::new(11);
        let all_black = slots(ALL, &SLOT_EDGE_BLACK);
        let all_white = slots(ALL, &SLOT_EDGE_WHITE);
        let no_stones_black = slots(0, &SLOT_EDGE_BLACK);
        let no_stones_white = slots(0, &SLOT_EDGE_WHITE);
        for r in 0..11i32 {
            for c in 0..11i32 {
                let i = r * 11 + c;
                let lib: Vec<CoordsOrEdge> =
                    board.get_neighbors(Coords::new(r as u8, c as u8)).collect();
                for d in 0..6 {
                    let (nr, nc) = (r + SLOT_STEP[d].0, c + SLOT_STEP[d].1);
                    let on_board = (0..11).contains(&nr) && (0..11).contains(&nc);
                    let bit = |m: u128| m >> i & 1 == 1;
                    if on_board {
                        // The slot is that neighbour, a neighbour in hexgame too, and no edge.
                        assert_eq!(i + SLOT_OFF[d], nr * 11 + nc);
                        assert!(lib.contains(&CoordsOrEdge::Coords(Coords::new(nr as u8, nc as u8))));
                        assert!(bit(all_black[d]) && bit(all_white[d]), "({r}, {c}) slot {d}");
                        assert!(!bit(no_stones_black[d]) && !bit(no_stones_white[d]));
                    } else {
                        // Off the board: exactly one owner, and an edge hexgame says it touches.
                        let (b, w) = (bit(no_stones_black[d]), bit(no_stones_white[d]));
                        assert!(b != w, "({r}, {c}) slot {d}");
                        let edge_ok = if b {
                            lib.contains(&CoordsOrEdge::Edge(Edge::Top))
                                && nr < 0
                                || lib.contains(&CoordsOrEdge::Edge(Edge::Bottom)) && nr > 10
                        } else {
                            lib.contains(&CoordsOrEdge::Edge(Edge::Left)) && nc < 0
                                || lib.contains(&CoordsOrEdge::Edge(Edge::Right)) && nc > 10
                        };
                        assert!(edge_ok, "({r}, {c}) slot {d}");
                    }
                }
                // Consecutive on-board slots are neighbours of each other.
                for d in 0..6 {
                    let (a, b) = (SLOT_STEP[d], SLOT_STEP[(d + 1) % 6]);
                    let (ar, ac, br, bc) = (r + a.0, c + a.1, r + b.0, c + b.1);
                    if [ar, ac, br, bc].iter().all(|x| (0..11).contains(x)) {
                        assert_ne!(grow(at(ar, ac)) & at(br, bc), 0);
                    }
                }
            }
        }
    }

    fn is_dead(black: u128, white: u128, r: i32, c: i32) -> bool {
        inferior(black, white).dead & at(r, c) != 0
    }

    #[test]
    fn dead_cells_on_hand_built_positions() {
        // Interior, f6: four consecutive Black neighbours (f5, g5, g6, f7) kill it; three do not.
        let b4 = stones(&[(4, 5), (4, 6), (5, 6), (6, 5)]);
        assert!(is_dead(b4, 0, 5, 5));
        assert!(!is_dead(stones(&[(4, 5), (4, 6), (5, 6)]), 0, 5, 5));
        // Four of six, not consecutive: alive.
        assert!(!is_dead(stones(&[(4, 5), (4, 6), (6, 5), (6, 4)]), 0, 5, 5));
        // Four consecutive White ones (g6, f7, e7, e6).
        assert!(is_dead(0, stones(&[(5, 6), (6, 5), (6, 4), (5, 4)]), 5, 5));
        // Mixed colours never make a run.
        assert!(!is_dead(stones(&[(4, 5), (4, 6)]), stones(&[(5, 6), (6, 5)]), 5, 5));
        // Top edge f1: the edge is two Black slots, so g1 and f2 Black kill it; White ones not.
        assert!(is_dead(stones(&[(0, 6), (1, 5)]), 0, 0, 5));
        assert!(!is_dead(0, stones(&[(0, 6), (1, 5)]), 0, 5));
        // Bottom edge f11 with e11 and f10 Black.
        assert!(is_dead(stones(&[(10, 4), (9, 5)]), 0, 10, 5));
        // Left edge a6: the edge is two White slots; a5 and b5 White kill it.
        assert!(is_dead(0, stones(&[(4, 0), (4, 1)]), 5, 0));
        assert!(!is_dead(stones(&[(4, 0), (4, 1)]), 0, 5, 0));
        // Right edge k6 with k7 and j7 White.
        assert!(is_dead(0, stones(&[(6, 10), (6, 9)]), 5, 10));
        // Acute corner a1 (two neighbours, b1 and a2): both Black or both White kill it.
        assert!(is_dead(stones(&[(0, 1), (1, 0)]), 0, 0, 0));
        assert!(is_dead(0, stones(&[(0, 1), (1, 0)]), 0, 0));
        // b1 Black and a2 White (B B B W W W with the edges), or b1 alone (B B B · W W): each
        // side already touches its edge, so a1 is dead by the complete test only.
        assert_eq!(is_dead(stones(&[(0, 1)]), stones(&[(1, 0)]), 0, 0), DEAD_COMPLETE);
        assert_eq!(is_dead(stones(&[(0, 1)]), 0, 0, 0), DEAD_COMPLETE);
        // Interior f6 with a single Black neighbour is never dead.
        assert!(!is_dead(stones(&[(4, 5)]), 0, 5, 5));
        // Acute corner k11 (j11 and k10).
        assert!(is_dead(stones(&[(10, 9), (9, 10)]), 0, 10, 10));
        assert!(is_dead(0, stones(&[(10, 9), (9, 10)]), 10, 10));
        // Obtuse corner k1 (j1, j2, k2): Black j1 + j2 with the top edge; White j2 + k2 + j1
        // with the right edge.
        assert!(is_dead(stones(&[(0, 9), (1, 9)]), 0, 0, 10));
        // With j1 empty this one is dead only by the complete test (W W W edge, B B edge).
        assert_eq!(is_dead(0, stones(&[(1, 10), (1, 9)]), 0, 10), DEAD_COMPLETE);
        assert!(is_dead(0, stones(&[(1, 10), (1, 9), (0, 9)]), 0, 10));
        // Obtuse corner a11 (a10, b10, b11): Black b11 + b10 with the bottom edge; White
        // needs a10, b10 and b11 with the left edge.
        assert!(is_dead(stones(&[(10, 1), (9, 1)]), 0, 10, 0));
        assert!(is_dead(0, stones(&[(9, 0), (9, 1), (10, 1)]), 10, 0));
        // The empty board has none, and stones are never dead.
        assert_eq!(inferior(0, 0), Inferior::default());
        assert_eq!(inferior(b4, 0).dead & b4, 0);
    }

    /// A random colouring of the empty cells of the position.
    fn complete(black: u128, white: u128, rng: &mut Rng) -> u128 {
        let mut b = black;
        let mut bits = ALL & !(black | white);
        while bits != 0 {
            let i = bits.trailing_zeros();
            if rng.next_u64() >> 63 == 1 {
                b |= 1u128 << i;
            }
            bits &= bits - 1;
        }
        b
    }

    #[test]
    fn flipping_a_dead_cell_never_changes_the_winner() {
        let mut rng = Rng::new(95);
        let mut checked = 0;
        for t in 0..600 {
            let (b, w, _) = random_position(&mut rng, 20 + t % 90);
            let mut dead = inferior(b, w).dead;
            while dead != 0 {
                let cell = 1u128 << dead.trailing_zeros();
                dead &= dead - 1;
                for _ in 0..20 {
                    let full = complete(b, w, &mut rng);
                    assert_eq!(
                        black_connects(full | cell),
                        black_connects(full & !cell),
                        "position {t}"
                    );
                    checked += 1;
                }
            }
        }
        assert!(checked > 5000, "{checked}");
    }

    #[test]
    fn complete_dead_patterns_on_hand_built_positions() {
        // f6's slots: f5 g5 g6 f7 e7 e6. Three Black (f5 g5 g6) and two White next to them
        // (f7 e7), e6 empty: dead only by the complete test.
        let (b3, w2) = (stones(&[(4, 5), (4, 6), (5, 6)]), stones(&[(6, 5), (6, 4)]));
        assert_eq!(is_dead(b3, w2, 5, 5), DEAD_COMPLETE);
        // The White pair on the other side (e7 e6) works too; split (f7, e6) does not.
        assert_eq!(is_dead(b3, stones(&[(6, 4), (5, 4)]), 5, 5), DEAD_COMPLETE);
        assert!(!is_dead(b3, stones(&[(6, 5), (5, 4)]), 5, 5));
        // Two and two with an empty slot between on both sides: B B · W W ·.
        assert_eq!(is_dead(stones(&[(4, 5), (4, 6)]), stones(&[(6, 5), (6, 4)]), 5, 5), DEAD_COMPLETE);
        // Three and three.
        assert_eq!(is_dead(b3, stones(&[(6, 5), (6, 4), (5, 4)]), 5, 5), DEAD_COMPLETE);
        // Three Black alone: alive.
        assert!(!is_dead(b3, 0, 5, 5));
        // Top edge f1 (two Black edge slots), with f2 White and e1... e2? f1's slots: edge, edge,
        // g1, f2, e2, e1. g1 Black and f2 e2 White, e1 empty: B B B W W ·.
        assert_eq!(is_dead(stones(&[(0, 6)]), stones(&[(1, 5), (1, 4)]), 0, 5), DEAD_COMPLETE);
    }

    #[test]
    fn complete_dead_test_matches_brute_force_on_every_slot_pattern() {
        // Every assignment of {Black, White, empty} to the six slots of f6: dead by the bitboard
        // test iff, for every colouring of the empty slots, both colours' slots form one run.
        let slot = [(4, 5), (4, 6), (5, 6), (6, 5), (6, 4), (5, 4)];
        let one_run = |m: u32| -> bool {
            // m: 6-bit set; at most one run on the cycle.
            if m == 0 || m == 63 {
                return true;
            }
            (0..6).filter(|&i| m >> i & 1 == 1 && m >> ((i + 5) % 6) & 1 == 0).count() == 1
        };
        let mut new_dead = 0;
        for code in 0..729u32 {
            let (mut b, mut w, mut bm, mut em) = (0u128, 0u128, 0u32, 0u32);
            let mut x = code;
            for (i, &(r, c)) in slot.iter().enumerate() {
                match x % 3 {
                    1 => {
                        b |= at(r, c);
                        bm |= 1 << i;
                    }
                    2 => w |= at(r, c),
                    _ => em |= 1 << i,
                }
                x /= 3;
            }
            let mut dead = true;
            let mut t = em;
            loop {
                let black = bm | t;
                dead &= one_run(black) && one_run(63 & !black);
                if t == 0 {
                    break;
                }
                t = (t - 1) & em;
            }
            if DEAD_COMPLETE {
                assert_eq!(is_dead(b, w, 5, 5), dead, "pattern {code}");
            } else {
                assert!(!is_dead(b, w, 5, 5) || dead, "pattern {code}");
            }
            let sb = slots(b, &SLOT_EDGE_BLACK);
            let sw = slots(w, &SLOT_EDGE_WHITE);
            if dead && (four_in_a_row(&sb) | four_in_a_row(&sw)) & at(5, 5) == 0 {
                new_dead += 1;
            }
        }
        assert!(new_dead > 0);
    }

    #[test]
    fn complete_dead_cells_are_found_beyond_four_in_a_row() {
        // The random-completion proof above covers the complete test; make sure it sees many
        // cells the four-in-a-row rule misses.
        let mut rng = Rng::new(180);
        let mut extra = 0;
        for t in 0..600 {
            let (b, w, _) = random_position(&mut rng, 20 + t % 90);
            let sb = slots(b, &SLOT_EDGE_BLACK);
            let sw = slots(w, &SLOT_EDGE_WHITE);
            let old = four_in_a_row(&sb) | four_in_a_row(&sw);
            extra += (inferior(b, w).dead & !old).count_ones();
        }
        if DEAD_COMPLETE {
            assert!(extra > 300, "{extra}");
        }
    }

    #[test]
    fn a_vulnerable_cell_is_dominated_by_its_killer() {
        // For each vulnerable cell c with killer d (mover M): with the opponent on d, c is dead
        // (flipping c never changes the winner), and in every completion of the other empties,
        // if M wins with (M on c, opponent on d) it also wins with (M on d, opponent on c).
        let mut rng = Rng::new(1800);
        let mut checked = 0;
        for t in 0..800 {
            let (b, w, _) = random_position(&mut rng, 20 + t % 90);
            for mover_black in [true, false] {
                for (j, mut v) in vulnerable(b, w, mover_black).into_iter().enumerate() {
                    while v != 0 {
                        let ci = v.trailing_zeros() as i32;
                        v &= v - 1;
                        let c = 1u128 << ci;
                        let d = 1u128 << (ci + SLOT_OFF[j]);
                        assert_eq!((b | w) & (c | d), 0);
                        assert_ne!(grow(c) & d, 0, "killer is a neighbour");
                        let (ob, ow) = if mover_black { (b, w | d) } else { (b | d, w) };
                        assert_ne!(inferior(ob, ow).dead & c, 0, "position {t}");
                        for _ in 0..10 {
                            let rest = complete(b, w | c | d, &mut rng);
                            let mover_wins = |black: u128| black_connects(black) == mover_black;
                            let (mc, md) = if mover_black {
                                (rest | c, rest | d)
                            } else {
                                (rest | d, rest | c)
                            };
                            if mover_wins(mc) {
                                assert!(mover_wins(md), "position {t}");
                            }
                            // And the opponent on d makes c's colour irrelevant.
                            let with_d = if mover_black { rest } else { rest | d };
                            assert_eq!(black_connects(with_d | c), black_connects(with_d & !c));
                            checked += 1;
                        }
                    }
                }
            }
        }
        assert!(checked > 5000, "{checked}");
    }

    #[test]
    fn captured_pairs_on_hand_built_positions() {
        // f6–g6: the two common neighbours g5 and f7 plus f5 and g7 are Black.
        let black = stones(&[(4, 6), (6, 5), (4, 5), (6, 6)]);
        let inf = inferior(black, 0);
        assert_eq!(inf.captured[0], stones(&[(5, 5), (5, 6)]));
        assert_eq!(inf.captured[1], 0);
        assert_eq!(inf.dead, 0);
        // A second-row stone e2 captures its two edge cells e1 and f1.
        let inf = inferior(stones(&[(1, 4)]), 0);
        assert_eq!(inf.captured[0], stones(&[(0, 4), (0, 5)]));
        // Bottom: e10 captures e11 and d11.
        assert_eq!(inferior(stones(&[(9, 4)]), 0).captured[0], stones(&[(10, 4), (10, 3)]));
        // White's second column: b5 captures a5 and a6, j5 captures k5 and k4.
        assert_eq!(inferior(0, stones(&[(4, 1)])).captured[1], stones(&[(4, 0), (5, 0)]));
        assert_eq!(inferior(0, stones(&[(4, 9)])).captured[1], stones(&[(4, 10), (3, 10)]));
        // The same stone of the other colour captures nothing.
        assert_eq!(inferior(0, stones(&[(1, 4)])).captured, [0, 0]);
        // A filled cell breaks the pair.
        assert_eq!(inferior(stones(&[(1, 4)]), stones(&[(0, 5)])).captured[0], 0);
        // Corner: b2 for Black takes a1? a1–b1 needs a1's run (top, top, b1, a2): a2 Black.
        let inf = inferior(stones(&[(1, 0)]), 0);
        assert_ne!(inf.captured[0] & at(0, 0), 0);
    }

    #[test]
    fn a_captured_pair_wins_exactly_as_the_capturer_owning_both() {
        let mut rng = Rng::new(195);
        let mut checked = 0;
        for t in 0..400 {
            let (b, w, _) = random_position(&mut rng, 6 + t % 90);
            let mut list = [(0u8, 0u8, false); 726];
            let n = captured_pairs(b, w, &mut list);
            for &(a, c, to_black) in &list[..n] {
                let (ma, mc) = (1u128 << a, 1u128 << c);
                let caps = inferior(b, w).captured[usize::from(!to_black)];
                assert_eq!(caps & (ma | mc), ma | mc);
                for _ in 0..20 {
                    let full = complete(b, w, &mut rng) & !(ma | mc);
                    let win = |black: u128| black_connects(black) == to_black;
                    let both = if to_black { full | ma | mc } else { full };
                    let only_a = if to_black { full | ma } else { full | mc };
                    let only_c = if to_black { full | mc } else { full | ma };
                    assert_eq!(win(both), win(only_a), "position {t}");
                    assert_eq!(win(both), win(only_c), "position {t}");
                    checked += 1;
                }
            }
        }
        assert!(checked > 5000, "{checked}");
    }

    #[test]
    fn inferior_fill_gives_pairs_to_the_capturer_and_keeps_the_moves() {
        let mut rng = Rng::new(23);
        // e2 Black, White to move: e1 and f1 always end Black's, and Black's count is the
        // uniform count plus one (each side made one move in the pair).
        let black = stones(&[(1, 4)]);
        for _ in 0..500 {
            let f = fill_inferior(black, 0, false, &mut rng);
            assert_eq!(f & stones(&[(0, 4), (0, 5)]), stones(&[(0, 4), (0, 5)]));
            let u = fill_uniform(black, 0, false, &mut rng);
            assert_eq!(f.count_ones(), u.count_ones() + 1);
        }
        for t in 0..2000 {
            let (b, w, btm) = random_position(&mut rng, t % 110);
            let f = fill_inferior(b, w, btm, &mut rng);
            assert_eq!(f & b, b, "keeps Black's stones");
            assert_eq!(f & w, 0, "never takes White's stones");
        }
    }

}
