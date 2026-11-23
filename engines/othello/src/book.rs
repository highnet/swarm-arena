//! Self-generated opening book (task #109).
//!
//! Every entry is this engine's own fixed-depth search of one position, far deeper than a
//! `go 200` search reaches. Positions are stored in a canonical form under the board's eight
//! symmetries (rotations and reflections), so transpositions and mirrored openings share one
//! entry. No external book or other engine's analysis is involved: the generator below starts
//! from every position the referee's random openings can produce and expands only along the
//! engine's own book moves and the replies its own search rates best.
//!
//! Binary format (`book/othello-book.bin`): records of 19 bytes sorted by (me, opp):
//! `me: u64 LE, opp: u64 LE, move: u8, score: i16 LE`, the side to move first and the move in
//! the canonical frame.

use crate::{evaluate, ordered, Search, INF};
use othello::Game;
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::io::{self, BufRead, Write};
use std::time::{Duration, Instant};

const BOOK: &[u8] = include_bytes!("../book/othello-book.bin");
const RECORD: usize = 19;

/// The board under symmetry `t` (0..8): bit 0 flips the ranks, bit 1 the files, bit 2
/// transposes along a1-h8. The eight combinations are the board's eight symmetries.
pub fn transform(t: u8, mut x: u64) -> u64 {
    if t & 1 != 0 {
        x = x.swap_bytes();
    }
    if t & 2 != 0 {
        const K1: u64 = 0x5555_5555_5555_5555;
        const K2: u64 = 0x3333_3333_3333_3333;
        const K4: u64 = 0x0f0f_0f0f_0f0f_0f0f;
        x = ((x >> 1) & K1) | ((x & K1) << 1);
        x = ((x >> 2) & K2) | ((x & K2) << 2);
        x = ((x >> 4) & K4) | ((x & K4) << 4);
    }
    if t & 4 != 0 {
        const K1: u64 = 0x5500_5500_5500_5500;
        const K2: u64 = 0x3333_0000_3333_0000;
        const K4: u64 = 0x0f0f_0f0f_0000_0000;
        let mut s = K4 & (x ^ (x << 28));
        x ^= s ^ (s >> 28);
        s = K2 & (x ^ (x << 14));
        x ^= s ^ (s >> 14);
        s = K1 & (x ^ (x << 7));
        x ^= s ^ (s >> 7);
    }
    x
}

/// The canonical (smallest) form of a position under the eight symmetries, and the symmetry
/// that produces it.
pub fn canonical(me: u64, opp: u64) -> ((u64, u64), u8) {
    (0..8u8)
        .map(|t| ((transform(t, me), transform(t, opp)), t))
        .min()
        .unwrap()
}

/// Number of entries in the embedded book.
pub fn entries() -> usize {
    BOOK.len() / RECORD
}

fn record(i: usize) -> (u64, u64, u8, i16) {
    let r = &BOOK[i * RECORD..(i + 1) * RECORD];
    let me = u64::from_le_bytes(r[0..8].try_into().unwrap());
    let opp = u64::from_le_bytes(r[8..16].try_into().unwrap());
    (me, opp, r[16], i16::from_le_bytes([r[17], r[18]]))
}

/// The stored (canonical move, score) for a canonical position.
fn lookup(key: (u64, u64)) -> Option<(u8, i16)> {
    let (mut lo, mut hi) = (0, entries());
    while lo < hi {
        let mid = (lo + hi) / 2;
        let (me, opp, m, s) = record(mid);
        match (me, opp).cmp(&key) {
            std::cmp::Ordering::Less => lo = mid + 1,
            std::cmp::Ordering::Greater => hi = mid,
            std::cmp::Ordering::Equal => return Some((m, s)),
        }
    }
    None
}

/// The book move for the side to move, mapped back to the real board, if the position is in
/// the book. Always a legal placement (checked against `available_moves`).
pub fn probe(g: &Game) -> Option<usize> {
    let [me, opp] = g.get();
    let (key, t) = canonical(me, opp);
    let (m, _) = lookup(key)?;
    let mut avail = g.available_moves();
    while avail != 0 {
        let i = avail.trailing_zeros() as usize;
        avail &= avail - 1;
        if transform(t, 1 << i) == 1 << m {
            return Some(i);
        }
    }
    None
}

// ---------------------------------------------------------------------------------------------
// Generator (offline): `othello-engine book <command>`, driven by `book/generate.sh`.
// Single-threaded like the engine; the script runs shards as separate processes.
// ---------------------------------------------------------------------------------------------

/// Plies played by the referee's random openings (`OPENING_PLIES.othello`): the engine first
/// moves at ply 4 (as Black) or ply 5 (as White).
pub const ROOT_PLIES: [u32; 2] = [4, 5];

/// Fixed-depth negamax from the root: (best move, score, nodes). Deterministic.
pub fn fixed_depth(g: &Game, depth: u32) -> (usize, i32, u64) {
    let avail = g.available_moves();
    let mut best = ordered(avail, None)[0];
    let mut s = Search {
        start: Instant::now(),
        deadline: Duration::from_secs(1 << 30),
        nodes: 0,
        stopped: false,
    };
    let mut score = 0;
    for d in 1..=depth {
        let mut alpha = -INF;
        let mut iter_best = best;
        for i in ordered(avail, Some(best)) {
            let Some(next) = g.make_move(i) else { continue };
            let v = -s.negamax(&next, d - 1, -INF, -alpha);
            if v > alpha {
                alpha = v;
                iter_best = i;
            }
        }
        best = iter_best;
        score = alpha;
    }
    (best, score, s.nodes)
}

fn ply(me: u64, opp: u64) -> u32 {
    (me | opp).count_ones() - 4
}

fn game(me: u64, opp: u64) -> Game {
    Game::new(me, opp).expect("disjoint position")
}

/// Every canonical position the referee's random openings can hand the engine.
pub fn roots() -> BTreeSet<(u64, u64)> {
    let mut out = BTreeSet::new();
    let mut layer = vec![Game::default()];
    for p in 0..=*ROOT_PLIES.iter().max().unwrap() {
        if ROOT_PLIES.contains(&p) {
            for g in &layer {
                if g.available_moves() != 0 {
                    let [me, opp] = g.get();
                    out.insert(canonical(me, opp).0);
                }
            }
        }
        let mut next = Vec::new();
        let mut seen = HashSet::new();
        for g in &layer {
            let mut avail = g.available_moves();
            while avail != 0 {
                let i = avail.trailing_zeros() as usize;
                avail &= avail - 1;
                let n = g.make_move(i).unwrap();
                let [me, opp] = n.get();
                if seen.insert(canonical(me, opp).0) {
                    next.push(n);
                }
            }
        }
        layer = next;
    }
    out
}

/// How many opponent replies the tree follows after our book move at `ply`: all of them while
/// the opening is still the referee's random choice, then the best few by our own search.
pub fn replies_followed(ply: u32) -> usize {
    match ply {
        0..=5 => usize::MAX,
        _ => 2,
    }
}

/// Deepest ply (discs on the board minus 4) at which the book stores a position.
pub const MAX_PLY: u32 = 9;

/// Book search depth by ply: 12 on the roots every gate game starts from, 11 below them.
/// (A `go 200` search reaches depth 8-9 here; depth 12 costs ~4.6 s per position, 11 ~1.4 s.)
pub fn book_depth(ply: u32) -> u32 {
    if ply <= 5 { 12 } else { 11 }
}

/// Search depth used to rank the opponent's replies.
const REPLY_DEPTH: u32 = 6;

/// Walks the book tree from the roots and returns the positions still missing an entry.
/// `book` holds (move, score) per canonical position; the tree stops at `max_ply`.
pub fn frontier(book: &BTreeMap<(u64, u64), (u8, i16)>, max_ply: u32) -> BTreeSet<(u64, u64)> {
    let mut need = BTreeSet::new();
    let mut seen = HashSet::new();
    let mut stack: Vec<(u64, u64)> = roots().into_iter().collect();
    while let Some(key) = stack.pop() {
        if !seen.insert(key) {
            continue;
        }
        let Some(&(m, _)) = book.get(&key) else {
            need.insert(key);
            continue;
        };
        let g = game(key.0, key.1);
        let Some(c) = g.make_move(m as usize) else { continue };
        let p = ply(key.0, key.1);
        if p + 2 > max_ply {
            continue;
        }
        // The opponent replies (or passes, handing the move straight back).
        let mut avail = c.available_moves();
        if avail == 0 {
            let mut q = c.clone();
            q.pass_move();
            if q.available_moves() != 0 {
                let [me, opp] = q.get();
                stack.push(canonical(me, opp).0);
            }
            continue;
        }
        let mut replies = Vec::new();
        while avail != 0 {
            let i = avail.trailing_zeros() as usize;
            avail &= avail - 1;
            let q = c.make_move(i).unwrap();
            replies.push((i, q));
        }
        let k = replies_followed(p);
        if k < replies.len() {
            // Rank by the opponent's view: lower score for us after its reply is better for it.
            let mut scored: Vec<(i32, usize, Game)> = replies
                .into_iter()
                .map(|(i, q)| {
                    let v = if q.available_moves() == 0 { evaluate(&q) } else { fixed_depth(&q, REPLY_DEPTH).1 };
                    (v, i, q)
                })
                .collect();
            scored.sort_by_key(|&(v, i, _)| (v, i));
            replies = scored.into_iter().take(k).map(|(_, i, q)| (i, q)).collect();
        }
        for (_, q) in replies {
            if q.available_moves() == 0 {
                continue; // we would have to pass: nothing to store
            }
            let [me, opp] = q.get();
            stack.push(canonical(me, opp).0);
        }
    }
    need
}

fn parse_key(a: &str, b: &str) -> Option<(u64, u64)> {
    Some((u64::from_str_radix(a, 16).ok()?, u64::from_str_radix(b, 16).ok()?))
}

/// Reads entry lines `me opp move score [depth]` (hex, hex, index, score).
pub fn read_entries(r: impl BufRead) -> BTreeMap<(u64, u64), (u8, i16)> {
    let mut out = BTreeMap::new();
    for line in r.lines().map_while(Result::ok) {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() < 4 {
            continue;
        }
        if let (Some(k), Ok(m), Ok(s)) = (parse_key(f[0], f[1]), f[2].parse(), f[3].parse()) {
            out.insert(k, (m, s));
        }
    }
    out
}

fn open(path: &str) -> io::BufReader<std::fs::File> {
    io::BufReader::new(std::fs::File::open(path).unwrap_or_else(|e| panic!("{path}: {e}")))
}

/// `othello-engine book …`. Commands:
/// - `frontier <entries>`: positions the tree still needs, one `me opp` per line.
/// - `analyse <shard> <shards>` (positions on stdin): entry lines for this shard.
/// - `pack <entries>`: writes the sorted binary book to stdout.
/// - `stats` (games on stdin, `b|w move…` per line): in-book plies and first miss per game.
pub fn command(args: &[String]) {
    let out = io::stdout();
    let mut out = out.lock();
    match args.first().map(String::as_str) {
        Some("frontier") => {
            let book = read_entries(open(&args[1]));
            for (me, opp) in frontier(&book, MAX_PLY) {
                writeln!(out, "{me:016x} {opp:016x}").unwrap();
            }
        }
        Some("analyse") => {
            let shard: usize = args[1].parse().unwrap();
            let shards: usize = args[2].parse().unwrap();
            let stdin = io::stdin();
            for (n, line) in stdin.lock().lines().map_while(Result::ok).enumerate() {
                if n % shards != shard {
                    continue;
                }
                let f: Vec<&str> = line.split_whitespace().collect();
                let Some((me, opp)) = parse_key(f[0], f[1]) else { continue };
                let depth = book_depth(ply(me, opp));
                let (m, v, _) = fixed_depth(&game(me, opp), depth);
                writeln!(out, "{me:016x} {opp:016x} {m} {} {depth}", v.clamp(-32000, 32000)).unwrap();
                out.flush().unwrap();
            }
        }
        Some("pack") => {
            let book = read_entries(open(&args[1]));
            for ((me, opp), (m, s)) in book {
                out.write_all(&me.to_le_bytes()).unwrap();
                out.write_all(&opp.to_le_bytes()).unwrap();
                out.write_all(&[m]).unwrap();
                out.write_all(&s.to_le_bytes()).unwrap();
            }
        }
        Some("stats") => {
            let stdin = io::stdin();
            let (mut games, mut hits, mut ours) = (0, 0, 0);
            for line in stdin.lock().lines().map_while(Result::ok) {
                let mut f = line.split_whitespace();
                let side = match f.next() {
                    Some("b") => 0,
                    Some("w") => 1,
                    _ => continue,
                };
                let moves: Vec<String> = f.map(String::from).collect();
                let (h, n, first) = game_stats(&moves, side);
                games += 1;
                hits += h;
                ours += n;
                let miss = first.map_or("none".into(), |p| p.to_string());
                writeln!(out, "in-book {h}/{n}, first out-of-book ply {miss}").unwrap();
            }
            writeln!(out, "games {games}, in-book plies {hits} of {ours} ({:.2} per game)", hits as f64 / games.max(1) as f64).unwrap();
        }
        _ => eprintln!("usage: othello-engine book frontier|analyse|pack|stats …"),
    }
}

/// For the side `side` (0 Black, 1 White) of one game: (plies it had a book move, plies it had
/// a placement, ply index of its first out-of-book placement).
pub fn game_stats(moves: &[String], side: usize) -> (u32, u32, Option<usize>) {
    let mut g = Game::default();
    let (mut hits, mut n, mut first) = (0, 0, None);
    for (p, m) in moves.iter().enumerate() {
        if p % 2 == side && g.available_moves() != 0 && p >= ROOT_PLIES[0] as usize {
            n += 1;
            if probe(&g).is_some() {
                hits += 1;
            } else if first.is_none() {
                first = Some(p);
            }
        }
        if m == "pass" {
            g.pass_move();
        } else {
            match crate::parse_square(m).and_then(|i| g.make_move(i)) {
                Some(x) => g = x,
                None => break,
            }
        }
    }
    (hits, n, first)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Square-by-square reference for `transform`.
    fn slow(t: u8, x: u64) -> u64 {
        let mut out = 0;
        for i in 0..64 {
            if x >> i & 1 == 1 {
                let (mut r, mut c) = (i / 8, i % 8);
                if t & 1 != 0 {
                    r = 7 - r;
                }
                if t & 2 != 0 {
                    c = 7 - c;
                }
                if t & 4 != 0 {
                    std::mem::swap(&mut r, &mut c);
                }
                out |= 1 << (r * 8 + c);
            }
        }
        out
    }

    #[test]
    fn transforms_are_the_eight_board_symmetries() {
        let mut x = 0x9e37_79b9_7f4a_7c15u64;
        for _ in 0..200 {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            for t in 0..8 {
                assert_eq!(transform(t, x), slow(t, x), "t={t} x={x:x}");
            }
        }
        let images: BTreeSet<u64> = (0..8).map(|t| transform(t, 1 << 1 | 1 << 10 | 1 << 20)).collect();
        assert_eq!(images.len(), 8);
    }

    #[test]
    fn mirrored_positions_share_a_key_and_map_the_move_back() {
        // d3 and its mirror f5... all four first moves are symmetric: one canonical position.
        let g = Game::default();
        let keys: BTreeSet<_> = ["d3", "c4", "f5", "e6"]
            .iter()
            .map(|m| {
                let n = g.make_move(crate::parse_square(m).unwrap()).unwrap();
                canonical(n.get()[0], n.get()[1]).0
            })
            .collect();
        assert_eq!(keys.len(), 1);
    }

    #[test]
    fn every_book_move_is_legal_and_the_book_is_sorted_and_small() {
        assert!(BOOK.len() % RECORD == 0 && BOOK.len() < 1 << 20, "{} bytes", BOOK.len());
        let mut prev = None;
        for i in 0..entries() {
            let (me, opp, m, _) = record(i);
            assert!(prev < Some((me, opp)), "sorted, no duplicates");
            prev = Some((me, opp));
            assert_eq!(canonical(me, opp).0, (me, opp), "stored canonical");
            let g = game(me, opp);
            assert!(g.available_moves() >> m & 1 == 1, "legal move in entry {i}");
            // Probing any symmetric copy yields the mapped, legal move.
            for t in 0..8 {
                let h = game(transform(t, me), transform(t, opp));
                let p = probe(&h).expect("symmetric copy is in book");
                assert!(h.available_moves() >> p & 1 == 1);
                // Same move up to symmetry (a self-symmetric position may map to a twin).
                let a = g.make_move(m as usize).unwrap().get();
                let b = h.make_move(p).unwrap().get();
                assert_eq!(canonical(a[0], a[1]).0, canonical(b[0], b[1]).0);
            }
        }
    }

    #[test]
    fn every_root_position_is_in_the_book() {
        let roots = roots();
        assert_eq!(roots.len(), 382);
        if entries() == 0 {
            return; // generator not yet run
        }
        for (me, opp) in roots {
            assert!(lookup((me, opp)).is_some());
        }
    }

    #[test]
    fn generator_is_deterministic() {
        let g = game(Game::default().get()[0], Game::default().get()[1]);
        assert_eq!(fixed_depth(&g, 6), fixed_depth(&g, 6));
        let empty = BTreeMap::new();
        assert_eq!(frontier(&empty, MAX_PLY), roots());
    }

    #[test]
    fn stats_count_only_the_given_side_after_the_random_plies() {
        let moves: Vec<String> = "f5 d6 c3 d3 c4 f4".split(' ').map(String::from).collect();
        let (hits, n, first) = game_stats(&moves, 0);
        assert_eq!(n, 1); // ply 4 only
        assert!(hits <= n);
        assert!(first.is_none() || first == Some(4));
    }
}
