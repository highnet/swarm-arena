//! Benson's unconditional life on the flat 9×9 board, and the settled points it implies.
//!
//! For a colour c, a *region* is a maximal connected set of points that are not c (empty or
//! enemy). A region is *vital* to a c chain when every empty point of the region is a liberty of
//! that chain. Benson's algorithm starts with every c chain and repeats, until nothing changes:
//! drop each chain with fewer than two vital regions among the regions whose bordering chains are
//! all still kept. The chains left can never be captured, whatever the enemy plays and even if c
//! always passes.
//!
//! *Settled* (for scoring under Tromp-Taylor, where dead stones are not removed): a region that
//! holds no stone at all, whose bordering c chains are all unconditionally alive, and whose every
//! point touches c. It is c's area for good as long as nobody plays inside: an enemy stone there
//! can never make an eye (every point keeps a living c neighbour) and only costs a move, and a c
//! stone there can only fill its own area. The engine therefore plays inside no settled region.
//! A region that also holds enemy stones is left unsettled: those stones are dead, but under the
//! referee's rules they count until they are captured, so the engine must still play there.

use crate::board::{opponent, BLACK, EMPTY, NEIGH, NN, OFF, WHITE};

/// What Benson's algorithm settles on a board.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Settled {
    /// Unconditionally alive stones, per colour (bit p = point p).
    pub alive: [u128; 2],
    /// Settled empty points, per colour: the colour's area for good.
    pub area: [u128; 2],
}

impl Settled {
    /// Every settled empty point, both colours: the points no move should go to.
    pub fn forbid(&self) -> u128 {
        self.area[0] | self.area[1]
    }

    /// The colour's settled area, `BLACK` or `WHITE`.
    #[cfg(test)]
    pub fn area_of(&self, c: u8) -> u128 {
        self.area[(c - 1) as usize]
    }

    #[cfg(test)]
    pub fn alive_of(&self, c: u8) -> u128 {
        self.alive[(c - 1) as usize]
    }
}

/// Benson's algorithm for both colours.
pub fn settled(cells: &[u8; NN]) -> Settled {
    let mut s = Settled::default();
    for c in [BLACK, WHITE] {
        let (alive, area) = benson(cells, c);
        s.alive[(c - 1) as usize] = alive;
        s.area[(c - 1) as usize] = area;
    }
    s
}

/// Points Benson leaves open: neither an unconditionally alive stone nor a settled empty
/// point. Stones of chains that are not alive count, since capturing them opens new points.
pub fn unsettled_points(s: &Settled) -> u32 {
    NN as u32 - (s.alive[0] | s.alive[1] | s.area[0] | s.area[1]).count_ones()
}

/// Flood fill from `start` over the points where `inside` holds.
fn flood(start: usize, inside: impl Fn(usize) -> bool) -> u128 {
    let mut set = 1u128 << start;
    let mut stack = [0u8; NN];
    stack[0] = start as u8;
    let mut top = 1;
    while top > 0 {
        top -= 1;
        let q = stack[top] as usize;
        for &n in &NEIGH[q] {
            if n != OFF && set & (1u128 << n) == 0 && inside(n as usize) {
                set |= 1u128 << n;
                stack[top] = n;
                top += 1;
            }
        }
    }
    set
}

/// The neighbours of a set of points (outside the set).
fn around(set: u128) -> u128 {
    let mut out = 0u128;
    let mut s = set;
    while s != 0 {
        let p = s.trailing_zeros() as usize;
        s &= s - 1;
        for &n in &NEIGH[p] {
            if n != OFF {
                out |= 1u128 << n;
            }
        }
    }
    out & !set
}

/// (unconditionally alive stones of `c`, settled empty points of `c`).
fn benson(cells: &[u8; NN], c: u8) -> (u128, u128) {
    let mut empties = 0u128;
    let mut enemy = 0u128;
    for p in 0..NN {
        match cells[p] {
            EMPTY => empties |= 1u128 << p,
            x if x == opponent(c) => enemy |= 1u128 << p,
            _ => {}
        }
    }
    // Chains of c: stones and liberties.
    let mut chains: Vec<(u128, u128)> = Vec::new();
    let mut done = 0u128;
    for p in 0..NN {
        if cells[p] == c && done & (1u128 << p) == 0 {
            let stones = flood(p, |q| cells[q] == c);
            done |= stones;
            chains.push((stones, around(stones) & empties));
        }
    }
    if chains.is_empty() || chains.len() > 64 {
        return (0, 0);
    }
    // Regions: (points, empty points, bordering chains as a bitmask, vital-to chains).
    let mut regions: Vec<(u128, u128, u64, u64)> = Vec::new();
    let mut done = 0u128;
    for p in 0..NN {
        if cells[p] != c && done & (1u128 << p) == 0 {
            let pts = flood(p, |q| cells[q] != c);
            done |= pts;
            let ring = around(pts);
            let e = pts & empties;
            let (mut border, mut vital) = (0u64, 0u64);
            for (i, &(stones, libs)) in chains.iter().enumerate() {
                if stones & ring != 0 {
                    border |= 1 << i;
                    if e & !libs == 0 {
                        vital |= 1 << i;
                    }
                }
            }
            regions.push((pts, e, border, vital));
        }
    }
    let mut alive: u64 = if chains.len() == 64 { u64::MAX } else { (1u64 << chains.len()) - 1 };
    loop {
        let mut count = vec![0u8; chains.len()];
        for &(_, _, border, vital) in &regions {
            if border & !alive != 0 {
                continue; // a dropped chain borders it: no longer enclosed
            }
            let mut v = vital & alive;
            while v != 0 {
                let i = v.trailing_zeros() as usize;
                v &= v - 1;
                count[i] = count[i].saturating_add(1);
            }
        }
        let mut next = alive;
        for (i, &k) in count.iter().enumerate() {
            if k < 2 {
                next &= !(1u64 << i);
            }
        }
        if next == alive {
            break;
        }
        alive = next;
    }
    let mut stones = 0u128;
    for (i, &(s, _)) in chains.iter().enumerate() {
        if alive & (1 << i) != 0 {
            stones |= s;
        }
    }
    if stones == 0 {
        return (0, 0);
    }
    let mut area = 0u128;
    for &(pts, e, border, _) in &regions {
        if border == 0 || border & !alive != 0 || pts & enemy != 0 {
            continue;
        }
        // Every point touches a (living) c stone.
        let mut all_touch = true;
        let mut q = e;
        while q != 0 {
            let p = q.trailing_zeros() as usize;
            q &= q - 1;
            if !NEIGH[p].iter().any(|&n| n != OFF && stones & (1u128 << n) != 0) {
                all_touch = false;
                break;
            }
        }
        if all_touch {
            area |= e;
        }
    }
    (stones, area)
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// A board from a 9-line diagram, top row first: `X` black, `O` white, `.` empty.
    pub fn cells(rows: &[&str]) -> [u8; NN] {
        assert_eq!(rows.len(), 9);
        let mut out = [EMPTY; NN];
        for (r, row) in rows.iter().enumerate() {
            let row: Vec<u8> = row.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
            assert_eq!(row.len(), 9, "row {r}");
            for (c, &b) in row.iter().enumerate() {
                out[r * 9 + c] = match b {
                    b'X' => BLACK,
                    b'O' => WHITE,
                    _ => EMPTY,
                };
            }
        }
        out
    }

    fn pt(name: &str) -> usize {
        let b = name.as_bytes();
        let col = b"abcdefghj".iter().position(|&c| c == b[0]).unwrap();
        let rank = (b[1] - b'0') as usize;
        (9 - rank) * 9 + col
    }

    fn has(mask: u128, name: &str) -> bool {
        mask & (1u128 << pt(name)) != 0
    }

    #[test]
    fn two_eyes_live_and_their_eyes_settle() {
        // Black wall on the left with eyes a9 and a7; white plays elsewhere.
        let b = cells(&[
            ".XX......",
            "XXX......",
            ".X.......",
            "XX.......",
            ".........",
            ".........",
            "......O..",
            ".........",
            ".........",
        ]);
        let s = settled(&b);
        assert!(has(s.alive_of(BLACK), "b9") && has(s.alive_of(BLACK), "a6"));
        assert!(has(s.area_of(BLACK), "a9") && has(s.area_of(BLACK), "a7"));
        // The open outside is not settled, and white's lone stone is not alive.
        assert_eq!(s.area_of(BLACK).count_ones(), 2);
        assert_eq!(s.alive_of(WHITE), 0);
    }

    #[test]
    fn one_eye_is_not_alive() {
        let b = cells(&[
            ".X.......",
            "XX.......",
            ".........",
            ".........",
            ".........",
            ".........",
            ".........",
            ".........",
            ".........",
        ]);
        assert_eq!(settled(&b), Settled::default());
    }

    #[test]
    fn false_eye_does_not_count() {
        // Black's corner chain has a real eye at a9, but c9 is false: d9 is a separate stone
        // (white holds d8 and e9) that lives on c9 alone, so c9 is not enclosed by living chains.
        let b = cells(&[
            ".X.XO....",
            "XXXOO....",
            "OOOO.....",
            ".........",
            ".........",
            ".........",
            ".........",
            ".........",
            ".........",
        ]);
        let s = settled(&b);
        assert_eq!(s.alive_of(BLACK), 0, "false eyes must not give life");
        assert_eq!(s.forbid(), 0);
    }

    #[test]
    fn seki_is_left_unsettled() {
        // A living black wall (eyes a9, c9) around a white ring that shares its two liberties
        // d6 and c5 with the black stones c6 and d5: a seki. The wall lives; nothing inside it
        // is settled for either colour.
        let b = cells(&[
            ".X.XXXX..",
            "XXXXXXX..",
            "XOOOOX...",
            "XOX.OX...",
            "XO.XOX...",
            "XOOOOX...",
            "XXXXXX...",
            ".........",
            ".........",
        ]);
        let s = settled(&b);
        assert!(has(s.alive_of(BLACK), "a8") && has(s.area_of(BLACK), "a9") && has(s.area_of(BLACK), "c9"));
        assert!(!has(s.alive_of(BLACK), "c6") && !has(s.alive_of(BLACK), "d5"));
        assert_eq!(s.alive_of(WHITE), 0);
        for p in ["d6", "c5"] {
            assert!(!has(s.forbid(), p), "{p} is a seki liberty, not settled");
        }
    }

    #[test]
    fn region_with_dead_enemy_stones_stays_unsettled() {
        // Black lives with eyes a9 and c9..e9; a white stone sits dead in the big eye.
        let b = cells(&[
            ".X.O.X...",
            "XXXXXX...",
            ".........",
            ".........",
            ".........",
            ".........",
            ".........",
            ".........",
            ".........",
        ]);
        let s = settled(&b);
        assert!(has(s.alive_of(BLACK), "b9"));
        assert!(has(s.area_of(BLACK), "a9"));
        assert!(!has(s.area_of(BLACK), "c9") && !has(s.area_of(BLACK), "e9"), "dead stone must be captured first");
    }

    #[test]
    fn big_open_region_is_not_settled() {
        // A living black group (eyes a9, c9) next to a large open area: points of the open area
        // that do not touch black are not settled even though black borders it alone.
        let b = cells(&[
            ".X.X.....",
            "XXXX.....",
            ".........",
            ".........",
            ".........",
            ".........",
            ".........",
            ".........",
            ".........",
        ]);
        let s = settled(&b);
        assert!(has(s.area_of(BLACK), "a9") && has(s.area_of(BLACK), "c9"));
        assert_eq!(s.area_of(BLACK).count_ones(), 2);
    }

    #[test]
    fn whole_board_split_settles_everything() {
        // Black owns the left, white the right, both with two eyes; the board is finished.
        let b = cells(&[
            ".X.XO.O.O",
            "XXXXOOOOO",
            "...XO....",
            "XXXXOOOOO",
            ".X.XO.O.O",
            "XXXXOOOOO",
            "...XO....",
            "XXXXOOOOO",
            ".X.XO.O.O",
        ]);
        let s = settled(&b);
        let empties = b.iter().filter(|&&c| c == EMPTY).count() as u32;
        assert_eq!(s.forbid().count_ones(), empties, "every empty point is settled");
        assert_eq!(unsettled_points(&s), 0);
    }
}
