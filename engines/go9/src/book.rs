//! Self-generated opening book (#110).
//!
//! Every entry is a move this engine's own search chose with a long, fixed playout budget
//! (`search::search_limited`, no clock), stored in `book/go9-book.txt` and embedded with
//! `include_str!`. Nothing comes from an external book or another engine.
//!
//! Entries are keyed by **position**, not move order, and by the smallest of the board's eight
//! symmetries, so transpositions and mirrored openings share one entry. The stored move is in
//! the canonical frame and is mapped back through the same symmetry when probed.
//!
//! The book only covers positions without captures or passes (the first few plies), so the
//! stones and the side to move are the whole position: no ko, no superko history.

use crate::board::{BLACK, EMPTY, N, NN, WHITE};
use std::collections::HashMap;
use std::sync::OnceLock;

/// The book source: one entry per line, see `parse_line`.
const BOOK_TEXT: &str = include_str!("../book/go9-book.txt");

/// A position: black stones and white stones as 81-bit masks.
pub type Key = (u128, u128);

/// The deepest ply (number of moves already played) the book covers.
pub const MAX_PLY: usize = 4;

/// GTP columns: a–j without i.
const COLS: &[u8; 9] = b"abcdefghj";

/// Cell `p` under symmetry `s` (0..8): bit 2 transposes, bit 0 flips rows, bit 1 flips columns.
pub fn sym(s: u8, p: u8) -> u8 {
    let (mut r, mut c) = (p as usize / N, p as usize % N);
    if s & 4 != 0 {
        std::mem::swap(&mut r, &mut c);
    }
    if s & 1 != 0 {
        r = N - 1 - r;
    }
    if s & 2 != 0 {
        c = N - 1 - c;
    }
    (r * N + c) as u8
}

/// The cell that symmetry `s` maps onto `q`.
pub fn unsym(s: u8, q: u8) -> u8 {
    (0..NN as u8).find(|&p| sym(s, p) == q).expect("symmetries are bijections")
}

fn key_under(cells: &[u8; NN], s: u8) -> Key {
    let (mut b, mut w) = (0u128, 0u128);
    for p in 0..NN as u8 {
        match cells[p as usize] {
            BLACK => b |= 1 << sym(s, p),
            WHITE => w |= 1 << sym(s, p),
            _ => {}
        }
    }
    (b, w)
}

/// The canonical key of `cells` (smallest over the eight symmetries) and the symmetry that
/// gives it.
pub fn canonical(cells: &[u8; NN]) -> (Key, u8) {
    (0..8u8).map(|s| (key_under(cells, s), s)).min().unwrap()
}

/// The cells of a key.
#[cfg(test)]
pub fn cells_of(key: Key) -> [u8; NN] {
    let mut cells = [EMPTY; NN];
    for (p, cell) in cells.iter_mut().enumerate() {
        if key.0 >> p & 1 != 0 {
            *cell = BLACK;
        } else if key.1 >> p & 1 != 0 {
            *cell = WHITE;
        }
    }
    cells
}

/// GTP name of cell `p` (row 0 = rank 9).
pub fn point_name(p: u8) -> String {
    format!("{}{}", COLS[p as usize % N] as char, N - p as usize / N)
}

/// Cell index of a GTP point name.
pub fn point_index(s: &str) -> Option<u8> {
    let b = s.as_bytes();
    if b.len() != 2 {
        return None;
    }
    let col = COLS.iter().position(|&c| c == b[0])?;
    let rank = (b[1] as char).to_digit(10)? as usize;
    if !(1..=N).contains(&rank) {
        return None;
    }
    Some(((N - rank) * N + col) as u8)
}

fn mask_names(m: u128) -> String {
    let v: Vec<String> = (0..NN as u8).filter(|&p| m >> p & 1 != 0).map(point_name).collect();
    if v.is_empty() {
        "-".into()
    } else {
        v.join(",")
    }
}

fn parse_mask(s: &str) -> Option<u128> {
    if s == "-" {
        return Some(0);
    }
    s.split(',').try_fold(0u128, |m, n| Some(m | 1 << point_index(n)?))
}

/// One book line: `<black stones>\t<white stones>\t<move>\t<playouts>\t<winrate>`, stones as
/// comma-separated GTP points in the canonical frame (`-` for none). Lines starting with `#`
/// are comments.
pub fn format_line(key: Key, mv: u8, playouts: u64, winrate: f32) -> String {
    format!("{}\t{}\t{}\t{}\t{:.3}", mask_names(key.0), mask_names(key.1), point_name(mv), playouts, winrate)
}

/// Parses a book line into its key and move; None for comments, blanks and malformed lines.
pub fn parse_line(line: &str) -> Option<(Key, u8)> {
    if line.starts_with('#') {
        return None;
    }
    let mut f = line.split('\t');
    let b = parse_mask(f.next()?)?;
    let w = parse_mask(f.next()?)?;
    let mv = point_index(f.next()?)?;
    Some(((b, w), mv))
}

/// Parses a whole book.
pub fn parse(text: &str) -> HashMap<Key, u8> {
    text.lines().filter_map(parse_line).collect()
}

/// The embedded book, parsed once.
pub fn embedded() -> &'static HashMap<Key, u8> {
    static BOOK: OnceLock<HashMap<Key, u8>> = OnceLock::new();
    BOOK.get_or_init(|| parse(BOOK_TEXT))
}

/// The book move for `cells` (in `cells`' own frame), if any. The caller checks that the
/// position has no captures or passes, and that the move is legal.
pub fn probe(book: &HashMap<Key, u8>, cells: &[u8; NN]) -> Option<u8> {
    let (key, s) = canonical(cells);
    book.get(&key).map(|&m| unsym(s, m))
}

/// Points on the third to seventh lines (c3–g7): where the referee's suite openings and nearly
/// all 9×9 opening moves are played. The book expands replies only on these.
pub fn region() -> Vec<u8> {
    (0..NN as u8).filter(|&p| (2..=6).contains(&(p as usize / N)) && (2..=6).contains(&(p as usize % N))).collect()
}

/// Positions the book should hold but `book` lacks, canonical and sorted:
/// - plies 0–2: every position with up to two stones, all in the region (covers every suite
///   opening of #105, whose two plies are drawn from c3–g7, and our first move from the start);
/// - ply 3: every ply-2 region position plus any third (black) stone in the region, i.e. our
///   first move as White after the opponent's first move;
/// - ply 4: every ply-2 position, plus its own book move, plus any white reply in the region,
///   i.e. our second move as Black. These depend on the ply-2 entries, so a second round adds
///   them once those exist.
pub fn frontier(book: &HashMap<Key, u8>) -> Vec<Key> {
    let reg = region();
    let mut want: Vec<Key> = Vec::new();
    let add = |cells: &[u8; NN], want: &mut Vec<Key>| want.push(canonical(cells).0);
    let mut cells = [EMPTY; NN];
    add(&cells, &mut want);
    for &b in &reg {
        cells[b as usize] = BLACK;
        add(&cells, &mut want);
        for &w in &reg {
            if w == b {
                continue;
            }
            cells[w as usize] = WHITE;
            add(&cells, &mut want);
            for &b2 in &reg {
                if cells[b2 as usize] == EMPTY {
                    cells[b2 as usize] = BLACK;
                    add(&cells, &mut want);
                    cells[b2 as usize] = EMPTY;
                }
            }
            if let Some(m) = probe(book, &cells) {
                cells[m as usize] = BLACK;
                for &w2 in &reg {
                    if cells[w2 as usize] == EMPTY {
                        cells[w2 as usize] = WHITE;
                        add(&cells, &mut want);
                        cells[w2 as usize] = EMPTY;
                    }
                }
                cells[m as usize] = EMPTY;
            }
            cells[w as usize] = EMPTY;
        }
        cells[b as usize] = EMPTY;
    }
    want.sort();
    want.dedup();
    want.retain(|k| !book.contains_key(k));
    want
}

/// A move order reaching `key` (black and white stones alternating, black first). Valid
/// because book positions have no captures: black has as many stones as white, or one more.
pub fn move_order(key: Key) -> Vec<u8> {
    let bl: Vec<u8> = (0..NN as u8).filter(|&p| key.0 >> p & 1 != 0).collect();
    let wh: Vec<u8> = (0..NN as u8).filter(|&p| key.1 >> p & 1 != 0).collect();
    let mut out = Vec::new();
    for i in 0..bl.len().max(wh.len()) {
        out.extend(bl.get(i));
        out.extend(wh.get(i));
    }
    out
}

/// A deterministic RNG seed for a position.
pub fn seed(key: Key, base: u64) -> u64 {
    let mut s = base ^ 0xcbf2_9ce4_8422_2325;
    for v in [key.0 as u64, (key.0 >> 64) as u64, key.1 as u64, (key.1 >> 64) as u64] {
        s = (s ^ v).wrapping_mul(0x100_0000_01b3);
        s ^= s >> 29;
    }
    s | 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn symmetries_are_the_eight_board_maps() {
        // e5 is fixed by all; c3 goes to the four 3-3 points; d3 to eight distinct points.
        let e5 = point_index("e5").unwrap();
        assert!((0..8).all(|s| sym(s, e5) == e5));
        let mut c3: Vec<u8> = (0..8).map(|s| sym(s, point_index("c3").unwrap())).collect();
        c3.sort();
        c3.dedup();
        assert_eq!(c3.len(), 4);
        let mut d3: Vec<u8> = (0..8).map(|s| sym(s, point_index("d3").unwrap())).collect();
        d3.sort();
        d3.dedup();
        assert_eq!(d3.len(), 8);
        for s in 0..8 {
            for p in 0..NN as u8 {
                assert_eq!(unsym(s, sym(s, p)), p);
            }
        }
    }

    #[test]
    fn canonical_is_symmetry_invariant_and_probe_maps_back() {
        let mut cells = [EMPTY; NN];
        cells[point_index("c4").unwrap() as usize] = BLACK;
        cells[point_index("f6").unwrap() as usize] = WHITE;
        let (k, s) = canonical(&cells);
        for t in 0..8 {
            let mut c2 = [EMPTY; NN];
            for p in 0..NN as u8 {
                c2[sym(t, p) as usize] = cells[p as usize];
            }
            assert_eq!(canonical(&c2).0, k);
        }
        // A book saying "d6" in the canonical frame answers the image of d6 here.
        let mut book = HashMap::new();
        let d6 = point_index("d6").unwrap();
        book.insert(k, d6);
        let got = probe(&book, &cells).unwrap();
        assert_eq!(sym(s, got), d6);
    }

    #[test]
    fn lines_round_trip() {
        let mut cells = [EMPTY; NN];
        cells[point_index("c3").unwrap() as usize] = BLACK;
        cells[point_index("g7").unwrap() as usize] = BLACK;
        cells[point_index("e5").unwrap() as usize] = WHITE;
        let (k, _) = canonical(&cells);
        let line = format_line(k, point_index("d4").unwrap(), 40000, 0.5);
        assert_eq!(parse_line(&line), Some((k, point_index("d4").unwrap())));
        assert_eq!(parse_line(&format_line((0, 0), 40, 1, 0.5)), Some(((0, 0), 40)));
        assert_eq!(parse_line("# comment"), None);
    }
}
