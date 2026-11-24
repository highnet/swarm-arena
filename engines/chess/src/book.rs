//! The engine's own opening book (#108): moves its own search chose at a fixed depth far beyond
//! what the gate clock allows, keyed by the position's Zobrist hash (transpositions share an
//! entry) and played instantly while the game stays in book. No external book is read: every
//! entry comes from `chess-engine book gen`, which runs this crate's search.
//!
//! `book/book.txt` is the source of truth (FEN, move, score, depth, one line per position);
//! `book/book.bin` is what the engine embeds: 10-byte records (u64 key, u16 move code, little
//! endian) sorted by key, probed by binary search. `chess-engine book pack` turns one into the
//! other, and a unit test checks they agree and that every stored move is legal.

use crate::{decode, encode, hash, replay, run, Tt, MATE_BOUND};
use shakmaty::fen::Fen;
use shakmaty::uci::UciMove;
use shakmaty::{CastlingMode, Chess, Color, EnPassantMode, Move, Position};
use std::collections::{HashMap, HashSet};
use std::io::{self, BufRead, Write};
use std::time::{Duration, Instant};

static BOOK: &[u8] = include_bytes!("../book/book.bin");
const RECORD: usize = 10;

fn record(i: usize) -> (u64, u16) {
    let r = &BOOK[i * RECORD..(i + 1) * RECORD];
    (u64::from_le_bytes(r[..8].try_into().unwrap()), u16::from_le_bytes([r[8], r[9]]))
}

/// Number of positions in the embedded book.
pub fn len() -> usize {
    BOOK.len() / RECORD
}

/// The book move for this position, validated against its legal moves, or None out of book.
pub fn probe(pos: &Chess) -> Option<Move> {
    let key = hash(pos);
    let (mut lo, mut hi) = (0, len());
    while lo < hi {
        let mid = (lo + hi) / 2;
        let (k, code) = record(mid);
        if k == key {
            let moves: Vec<Move> = pos.legal_moves().into_iter().collect();
            return decode(code, &moves);
        }
        if k < key {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    None
}

/// One generated entry: the position, the move the deep search chose, its score and depth.
struct Entry {
    fen: String,
    mv: String,
    score: i32,
    depth: u32,
}

/// The position's FEN with the move counters reset: the key ignores them, so one position is
/// one line however it was reached.
fn fen(pos: &Chess) -> String {
    let full = Fen::from_position(pos, EnPassantMode::Legal).to_string();
    let fields: Vec<&str> = full.split(' ').take(4).collect();
    format!("{} 0 1", fields.join(" "))
}

fn parse_fen(s: &str) -> Option<Chess> {
    s.parse::<Fen>().ok()?.into_position(CastlingMode::Standard).ok()
}

/// Parses a `book.txt` line: FEN, move (UCI), score, depth, tab-separated.
fn parse_line(line: &str) -> Option<(Chess, Move, i32, u32)> {
    let mut f = line.split('\t');
    let pos = parse_fen(f.next()?)?;
    let mv = f.next()?.parse::<UciMove>().ok()?.to_move(&pos).ok()?;
    let score = f.next()?.parse().ok()?;
    let depth = f.next()?.parse().ok()?;
    Some((pos, mv, score, depth))
}

/// Packs `book.txt` lines into the embedded format. Panics on a malformed line: a book with a bad
/// entry must not be built.
fn pack(lines: impl Iterator<Item = String>) -> Vec<u8> {
    let mut recs: Vec<(u64, u16)> = lines
        .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
        .map(|l| {
            let (pos, mv, _, _) = parse_line(&l).unwrap_or_else(|| panic!("bad book line: {l}"));
            (hash(&pos), encode(&mv))
        })
        .collect();
    recs.sort_unstable();
    recs.dedup_by_key(|r| r.0);
    recs.iter().flat_map(|(k, c)| k.to_le_bytes().into_iter().chain(c.to_le_bytes())).collect()
}

/// Deterministic fixed-depth search with a fresh table, for one root move list.
fn deep(pos: &Chess, depth: u32, exclude: &[Move]) -> Option<(Move, i32)> {
    let mut seen = HashSet::new();
    seen.insert(hash(pos));
    let mut tt = Tt::new(22);
    let day = Duration::from_secs(86_400);
    let o = run(pos, &seen, day, day, depth, &mut tt, true, true, true, exclude)?;
    Some((o.best, o.score))
}

struct Gen {
    depth: u32,
    reply_depth: u32,
    /// How many replies to predict at the 1st, 2nd, … opponent turn of a line (the last repeats).
    replies: Vec<usize>,
    /// Deep entries already made, by key (a transposition is searched once).
    entries: HashMap<u64, Option<Move>>,
    /// Predicted opponent replies, by key.
    predicted: HashMap<u64, Vec<Move>>,
    out: Vec<Entry>,
    started: Instant,
}

impl Gen {
    fn entry(&mut self, pos: &Chess) -> Option<Move> {
        let key = hash(pos);
        if let Some(m) = self.entries.get(&key) {
            return *m;
        }
        let t = Instant::now();
        let found = deep(pos, self.depth, &[]);
        let mv = match found {
            // A forced mate or loss is left to the search: the book is for openings.
            Some((m, s)) if s.abs() < MATE_BOUND => {
                self.out.push(Entry { fen: fen(pos), mv: UciMove::from_standard(m).to_string(), score: s, depth: self.depth });
                eprintln!(
                    "[{:>6.0}s] {:>5} {} {} {} ({:.1}s)",
                    self.started.elapsed().as_secs_f64(),
                    self.out.len(),
                    fen(pos),
                    UciMove::from_standard(m),
                    s,
                    t.elapsed().as_secs_f64()
                );
                Some(m)
            }
            _ => None,
        };
        self.entries.insert(key, mv);
        mv
    }

    /// The opponent's likeliest replies by this engine's own shorter search: the best, then the
    /// best of the rest, and so on (`replies` of them).
    fn predict(&mut self, pos: &Chess, level: usize) -> Vec<Move> {
        let want = self.replies[level.min(self.replies.len() - 1)];
        let key = hash(pos);
        if let Some(r) = self.predicted.get(&key) {
            if r.len() >= want {
                return r[..want].to_vec();
            }
        }
        let mut got: Vec<Move> = Vec::new();
        while got.len() < want {
            match deep(pos, self.reply_depth, &got) {
                Some((m, _)) => got.push(m),
                None => break,
            }
        }
        self.predicted.insert(key, got.clone());
        got
    }

    /// Walks the book tree for side `us`: one book move where `us` is to move, the predicted
    /// replies where the opponent is, until `us` has `left` book moves on every line. `level`
    /// counts the opponent turns already passed on this line.
    fn walk(&mut self, pos: &Chess, us: Color, left: u32, level: usize) {
        if left == 0 || pos.is_game_over() {
            return;
        }
        if pos.turn() == us {
            if let Some(m) = self.entry(pos) {
                let mut child = pos.clone();
                child.play_unchecked(m);
                self.walk(&child, us, left - 1, level);
            }
        } else {
            for r in self.predict(pos, level) {
                let mut child = pos.clone();
                child.play_unchecked(r);
                self.walk(&child, us, left, level + 1);
            }
        }
    }
}

fn arg<T: std::str::FromStr>(args: &[String], i: usize, default: T) -> T {
    args.get(i).and_then(|s| s.parse().ok()).unwrap_or(default)
}

/// `chess-engine book …`: offline tooling, never reached from the protocol loop.
///
/// - `gen <shard> <shards> <depth> <reply-depth> <replies> <book-moves> [done.txt]`: `replies` is a comma
///   list, replies predicted at the 1st, 2nd, … opponent turn (e.g. `3,2`). Reads opening lines (UCI
///   moves from the initial position, one per line; an empty line is the initial position) on
///   stdin, takes every `shards`-th line from `shard`, and prints `book.txt` lines on stdout.
/// - `pack`: reads `book.txt` lines on stdin and writes `book.bin` to stdout.
/// - `stats <engine-colour>`: reads games (UCI moves, one game per line, a tab, then `w` or `b` for
///   the engine's colour) and reports in-book plies per game and the first out-of-book ply.
pub fn tool(args: &[String]) {
    let stdin = io::stdin();
    let lines: Vec<String> = stdin.lock().lines().map_while(Result::ok).collect();
    match args.first().map(String::as_str) {
        Some("gen") => {
            let shard: usize = arg(args, 1, 0);
            let shards: usize = arg(args, 2, 1);
            let mut g = Gen {
                depth: arg(args, 3, 9),
                reply_depth: arg(args, 4, 6),
                replies: args.get(5).map_or(vec![3], |s| s.split(',').filter_map(|x| x.parse().ok()).collect()),
                entries: HashMap::new(),
                predicted: HashMap::new(),
                out: Vec::new(),
                started: Instant::now(),
            };
            let book_moves: u32 = arg(args, 6, 3);
            // Optional 8th argument: a `book.txt` from an interrupted run. Roots already in it are
            // skipped (a root is written only once both of its trees are complete).
            let done: HashSet<String> = args
                .get(7)
                .and_then(|p| std::fs::read_to_string(p).ok())
                .map(|t| t.lines().filter_map(|l| l.split('\t').next()).map(String::from).collect())
                .unwrap_or_default();
            let mut stdout = io::stdout();
            for (i, line) in lines.iter().enumerate() {
                if i % shards != shard {
                    continue;
                }
                let mv: Vec<String> = line.split_whitespace().map(String::from).collect();
                let Some((pos, _)) = replay(&mv) else {
                    eprintln!("skipping unplayable line: {line}");
                    continue;
                };
                if done.contains(&fen(&pos)) {
                    continue;
                }
                let before = g.out.len();
                g.walk(&pos, Color::White, book_moves, 0);
                g.walk(&pos, Color::Black, book_moves, 0);
                for e in &g.out[before..] {
                    writeln!(stdout, "{}\t{}\t{}\t{}", e.fen, e.mv, e.score, e.depth).ok();
                }
                stdout.flush().ok();
            }
        }
        Some("pack") => {
            io::stdout().write_all(&pack(lines.into_iter())).ok();
        }
        Some("stats") => {
            let (mut games, mut hits, mut first_out) = (0, 0, Vec::new());
            for line in &lines {
                let mut f = line.split('\t');
                let mv: Vec<String> = f.next().unwrap_or("").split_whitespace().map(String::from).collect();
                let us = if f.next() == Some("b") { Color::Black } else { Color::White };
                let mut pos = Chess::default();
                let mut out_at = None;
                let mut in_book = 0;
                for (ply, s) in mv.iter().enumerate() {
                    if pos.turn() == us && out_at.is_none() && ply >= 4 {
                        if probe(&pos).is_some() {
                            in_book += 1;
                        } else {
                            out_at = Some(ply);
                        }
                    }
                    let Some(m) = s.parse::<UciMove>().ok().and_then(|u| u.to_move(&pos).ok()) else { break };
                    pos.play_unchecked(m);
                }
                games += 1;
                hits += in_book;
                first_out.push(out_at.unwrap_or(mv.len()));
                println!("{}\t{}\tin-book {}\tfirst-out-ply {}", games, if us == Color::White { "w" } else { "b" }, in_book, out_at.map_or("-".into(), |p| p.to_string()));
            }
            if games > 0 {
                first_out.sort_unstable();
                println!(
                    "games {games}  book positions {}  in-book plies per game {:.2}  median first out-of-book ply {}",
                    len(),
                    hits as f64 / games as f64,
                    first_out[first_out.len() / 2]
                );
            }
        }
        _ => eprintln!("usage: chess-engine book gen|pack|stats"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TXT: &str = include_str!("../book/book.txt");

    #[test]
    fn every_book_move_is_legal_and_the_binary_matches_the_text() {
        let mut n = 0;
        for line in TXT.lines().filter(|l| !l.trim().is_empty() && !l.starts_with('#')) {
            let (pos, mv, score, depth) = parse_line(line).unwrap_or_else(|| panic!("bad line or illegal move: {line}"));
            assert!(pos.is_legal(mv), "{line}");
            assert!(score.abs() < MATE_BOUND && depth > 0, "{line}");
            assert_eq!(probe(&pos), Some(mv), "embedded book disagrees with book.txt at {line}");
            n += 1;
        }
        assert_eq!(pack(TXT.lines().map(String::from)), BOOK, "book.bin is not `book pack` of book.txt");
        assert_eq!(n, len(), "book.txt has duplicate positions");
    }

    #[test]
    fn out_of_book_positions_miss() {
        let pos = parse_fen("8/8/8/4k3/8/8/4K3/8 w - - 0 1").unwrap();
        assert_eq!(probe(&pos), None);
    }

    #[test]
    fn generator_is_deterministic() {
        let run_once = || {
            let mut g = Gen {
                depth: 3,
                reply_depth: 2,
                replies: vec![2],
                entries: HashMap::new(),
                predicted: HashMap::new(),
                out: Vec::new(),
                started: Instant::now(),
            };
            let (pos, _) = replay(&["e2e4".to_string(), "e7e5".to_string()]).unwrap();
            g.walk(&pos, Color::White, 2, 0);
            g.walk(&pos, Color::Black, 2, 0);
            g.out.iter().map(|e| format!("{}\t{}\t{}\t{}", e.fen, e.mv, e.score, e.depth)).collect::<Vec<_>>()
        };
        let a = run_once();
        assert!(a.len() >= 5, "{a:?}");
        assert_eq!(a, run_once());
        for l in &a {
            assert!(parse_line(l).is_some(), "{l}");
        }
    }
}
