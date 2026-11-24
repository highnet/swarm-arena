//! Offline generator for the Hex engine's own opening book (#111). Offline tooling: never runs
//! during a game. It enumerates every position after one and after two plies, keeps one per
//! 180° rotation, searches each with the engine's own MCTS for a fixed playout budget (no clock,
//! so the output depends only on the arguments), and prints one `book.txt` line per position.
//!
//! cargo run --release --bin gen-book -- [--playouts P] [--nodes N] [--seed S] [--shard I/N] [--plies 1,2]
//!
//! One process is one thread; shard the work over processes (`--shard 0/4` … `3/4`) and
//! concatenate the outputs, then `sort` (the engine does not care about order; sorting keeps
//! the file diff-stable). See the playbook for the exact command.

#[path = "../board.rs"]
#[allow(dead_code)]
mod board;
#[path = "../book.rs"]
#[allow(dead_code)]
mod book;
#[path = "../search.rs"]
#[allow(dead_code)]
mod search;

use std::io::Write;

fn main() {
    let mut playouts = 600_000u32;
    let mut max_nodes = 16_000_000usize;
    let mut seed = 1u64;
    let (mut shard, mut shards) = (0usize, 1usize);
    let mut plies = vec![1u32, 2];
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let v = it.next().map(String::as_str).unwrap_or("");
        match a.as_str() {
            "--playouts" => playouts = v.parse().expect("--playouts N"),
            "--nodes" => max_nodes = v.parse().expect("--nodes N"),
            "--seed" => seed = v.parse().expect("--seed S"),
            "--shard" => {
                let (i, n) = v.split_once('/').expect("--shard I/N");
                shard = i.parse().expect("shard index");
                shards = n.parse().expect("shard count");
            }
            "--plies" => plies = v.split(',').map(|p| p.parse().expect("--plies 1,2")).collect(),
            _ => panic!("unknown argument {a}"),
        }
    }

    // Canonical positions, in a fixed order.
    let mut positions: Vec<(u128, u128)> = Vec::new();
    for a in 0..121u32 {
        if plies.contains(&1) {
            positions.push((1u128 << a, 0));
        }
        if plies.contains(&2) {
            for c in (0..121u32).filter(|&c| c != a) {
                positions.push((1u128 << a, 1u128 << c));
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    positions.retain(|&(b, w)| {
        let (key, _) = book::canonical(b, w);
        key == (b, w) && seen.insert(key)
    });

    let mine: Vec<_> = positions
        .iter()
        .enumerate()
        .filter(|(i, _)| i % shards == shard)
        .map(|(_, p)| *p)
        .collect();
    eprintln!(
        "gen-book: {} canonical positions, shard {shard}/{shards}: {}, {playouts} playouts each, tree cap {max_nodes} nodes, seed {seed}",
        positions.len(),
        mine.len(),
    );
    let out = std::io::stdout();
    let mut out = out.lock();
    let start = std::time::Instant::now();
    for (k, &(b, w)) in mine.iter().enumerate() {
        let black_to_move = b.count_ones() == w.count_ones();
        // Per-position seed from the position itself: an entry does not depend on the sharding.
        let s = (b ^ w.rotate_left(64)) as u64 ^ (b >> 64) as u64 ^ (w as u64).rotate_left(17);
        let s = s.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ seed;
        let res = search::search_capped(b, w, black_to_move, search::Limit::Playouts(playouts), s, max_nodes)
            .expect("board not full");
        writeln!(out, "{}", book::line(b, w, res.mv, res.winrate)).unwrap();
        out.flush().ok();
        if k % 50 == 49 {
            eprintln!("gen-book: shard {shard}: {}/{} in {:.0?}", k + 1, mine.len(), start.elapsed());
        }
    }
}
