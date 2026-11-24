//! Offline generator of the learned cell prior (`src/prior.bin`, see `src/prior.rs`). Never run
//! by the engine; the table it writes is compiled in.
//!
//! It plays the engine's own search against itself (prior off, `Limit::Playouts`, so a game is a
//! pure function of its seed) and, for every searched move, records the move's pattern (folded
//! as in `prior.rs`) and whether the mover went on to win. One process per shard, no threads:
//!
//! ```text
//! # from engines/, four shards in parallel (one per core), then merge:
//! cargo build --release -p hex-engine --bin prior_gen
//! for s in 0 1 2 3; do target/release/prior_gen play --shard $s --games 1500 \
//!     --playouts 3000 --out /tmp/prior-$s.txt & done; wait
//! target/release/prior_gen merge /tmp/prior-*.txt --out hex/src/prior.bin
//! ```
//!
//! Game `g` of shard `s` uses seed `s * 1_000_000 + g`. Its first move is a random cell, its
//! second a random cell next to the first or a random cell (half each), so games differ; the
//! opening moves are not recorded. Then the search plays until a side connects, also playing a
//! winning cell or blocking the opponent's at once as `choose` does (those moves are recorded
//! too: they are part of what the engine plays). The shard file holds one line per canonical
//! class seen: `index wins visits`. `merge` sums the shards and writes, for every raw index,
//! the smoothed rate `(wins + A/2) / (visits + A)` with `A = 20` virtual games, × 255 rounded,
//! at the index's class (classes never seen get 128).

use hex_engine::board::{self, Rng, ALL, CELLS};
use hex_engine::prior::{self, PATTERNS};
use hex_engine::search::{self, Limit};
use std::collections::BTreeMap;
use std::fs;

/// Smoothing: virtual games at 50% added to every class.
const SMOOTH: f64 = 20.0;

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

fn num(args: &[String], name: &str, default: u64) -> u64 {
    arg(args, name).map_or(default, |v| v.parse().expect("number"))
}

/// A cell that wins at once for the colour of `own` (connects with it added), if any.
fn winning_cell(own: u128, empty: u128, black: bool) -> Option<usize> {
    let mut bits = empty;
    while bits != 0 {
        let c = bits.trailing_zeros() as usize;
        let s = own | 1u128 << c;
        if if black { board::black_connects(s) } else { board::white_connects(s) } {
            return Some(c);
        }
        bits &= bits - 1;
    }
    None
}

/// Play one self-play game; returns the (canonical pattern, mover is Black) of each recorded
/// move and whether Black won.
fn game(seed: u64, playouts: u32) -> (Vec<(usize, bool)>, bool) {
    let mut rng = Rng::new(seed);
    let (mut b, mut w) = (0u128, 0u128);
    let mut btm = true;
    let mut rec = Vec::new();
    for ply in 0.. {
        let empty = ALL & !(b | w);
        let (own, opp) = if btm { (b, w) } else { (w, b) };
        let mv = if ply == 0 {
            rng.below(CELLS)
        } else if ply == 1 {
            let first = b.trailing_zeros() as usize;
            let near: Vec<usize> = prior::NB[first]
                .iter()
                .map(|&n| n as usize)
                .filter(|&n| n < CELLS && empty >> n & 1 == 1)
                .collect();
            if rng.below(2) == 0 && !near.is_empty() {
                near[rng.below(near.len())]
            } else {
                loop {
                    let c = rng.below(CELLS);
                    if empty >> c & 1 == 1 {
                        break c;
                    }
                }
            }
        } else {
            let mv = winning_cell(own, empty, btm)
                .or_else(|| winning_cell(opp, empty, !btm))
                .unwrap_or_else(|| {
                    let s = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ ply as u64;
                    search::search(b, w, btm, Limit::Playouts(playouts), s)
                        .expect("board not full")
                        .mv as usize
                });
            let p = prior::pattern(b, w, mv, btm);
            rec.push((prior::canonical(p, btm), btm));
            mv
        };
        if btm {
            b |= 1u128 << mv;
            if board::black_connects(b) {
                return (rec, true);
            }
        } else {
            w |= 1u128 << mv;
            if board::white_connects(w) {
                return (rec, false);
            }
        }
        btm = !btm;
    }
    unreachable!()
}

fn play(args: &[String]) {
    // The table is learned from the engine without the prior (whatever the compiled table).
    search::PRIOR_OFF.store(true, std::sync::atomic::Ordering::Relaxed);
    let shard = num(args, "--shard", 0);
    let games = num(args, "--games", 100);
    let playouts = num(args, "--playouts", 3000) as u32;
    let out = arg(args, "--out").expect("--out file");
    let mut counts: BTreeMap<usize, (u64, u64)> = BTreeMap::new();
    let mut black_wins = 0;
    for g in 0..games {
        let (rec, black_won) = game(shard * 1_000_000 + g, playouts);
        black_wins += black_won as u64;
        for (class, black) in rec {
            let e = counts.entry(class).or_default();
            e.0 += (black == black_won) as u64;
            e.1 += 1;
        }
        if (g + 1) % 100 == 0 {
            eprintln!("shard {shard}: {} games, Black won {black_wins}", g + 1);
        }
    }
    let text: String = counts
        .iter()
        .map(|(k, (wins, n))| format!("{k} {wins} {n}\n"))
        .collect();
    fs::write(&out, text).expect("write shard");
    eprintln!("shard {shard}: {} classes -> {out}", counts.len());
}

fn merge(args: &[String]) {
    let out = arg(args, "--out").expect("--out file");
    let mut counts = vec![(0u64, 0u64); PATTERNS];
    let mut skip = false;
    for a in args {
        if skip || a == "--out" {
            skip = !skip;
            continue;
        }
        for line in fs::read_to_string(a).expect("read shard").lines() {
            let v: Vec<u64> = line.split(' ').map(|x| x.parse().expect("number")).collect();
            counts[v[0] as usize].0 += v[1];
            counts[v[0] as usize].1 += v[2];
        }
    }
    let table: Vec<u8> = (0..PATTERNS)
        .map(|i| {
            let (wins, n) = counts[prior::canonical(i, true)];
            let r = (wins as f64 + SMOOTH / 2.0) / (n as f64 + SMOOTH);
            (r * 255.0).round() as u8
        })
        .collect();
    let seen = counts.iter().filter(|c| c.1 > 0).count();
    let moves: u64 = counts.iter().map(|c| c.1).sum();
    fs::write(&out, table).expect("write table");
    eprintln!("{moves} moves over {seen} classes -> {out}");
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("play") => play(&args[2..]),
        Some("merge") => merge(&args[2..]),
        _ => eprintln!("usage: prior_gen play --shard S --games N --playouts P --out F | merge FILES --out F"),
    }
}
