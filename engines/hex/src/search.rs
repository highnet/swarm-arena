//! UCT search over the flat board. Nodes live in one arena with their children contiguous;
//! each node's statistics are from the point of view of the player who made its move.

use crate::board::{self, Rng, ALL};
use std::time::{Duration, Instant};

/// Exploration constant on win rates.
const C: f32 = 0.3;
/// A leaf is expanded on this visit.
const EXPAND_AT: u32 = 2;
/// Tree size cap (16 bytes a node: 32 MB).
const MAX_NODES: usize = 2_000_000;
/// Playouts between clock checks.
const CHECK_EVERY: u32 = 64;

#[derive(Clone, Copy)]
struct Node {
    visits: u32,
    wins: u32,
    first: u32,
    count: u8,
    mv: u8,
    expanded: bool,
}

impl Node {
    fn new(mv: u8) -> Self {
        Node {
            visits: 0,
            wins: 0,
            first: 0,
            count: 0,
            mv,
            expanded: false,
        }
    }
}

/// When to stop searching.
#[derive(Clone, Copy, Debug)]
pub enum Limit {
    /// Stop after this many playouts (deterministic; used by tests).
    #[cfg_attr(not(test), allow(dead_code))]
    Playouts(u32),
    /// Stop once this much wall-clock time has passed (the protocol's `go <ms>`).
    Time(Duration),
}

/// What a search found.
pub struct Outcome {
    /// Best root move (cell index), the most-visited child.
    pub mv: u8,
    pub playouts: u32,
    /// Win rate of the chosen move for the side to move.
    pub winrate: f32,
}

/// Run UCT from the position `black`/`white` with `black_to_move` to play.
/// Returns `None` only when the board is full.
pub fn search(
    black: u128,
    white: u128,
    black_to_move: bool,
    limit: Limit,
    seed: u64,
) -> Option<Outcome> {
    let empties = ALL & !(black | white);
    if empties == 0 {
        return None;
    }
    let start = Instant::now();
    let mut rng = Rng::new(seed);
    let mut nodes: Vec<Node> = Vec::with_capacity(1 << 16);
    nodes.push(Node::new(u8::MAX));
    expand(&mut nodes, 0, empties, &mut rng);

    let mut path: Vec<u32> = Vec::with_capacity(128);
    let mut playouts = 0u32;
    loop {
        match limit {
            Limit::Playouts(n) if playouts >= n => break,
            Limit::Time(t) if playouts % CHECK_EVERY == 0 && start.elapsed() >= t => break,
            _ => {}
        }
        // Selection.
        let (mut b, mut w, mut btm) = (black, white, black_to_move);
        path.clear();
        let mut id = 0u32;
        path.push(id);
        loop {
            let node = nodes[id as usize];
            if !node.expanded {
                if node.visits + 1 >= EXPAND_AT && nodes.len() + 121 <= MAX_NODES {
                    let empty = ALL & !(b | w);
                    if empty != 0 {
                        expand(&mut nodes, id, empty, &mut rng);
                        continue;
                    }
                }
                break;
            }
            if node.count == 0 {
                break;
            }
            id = select(&nodes, &node);
            let mv = nodes[id as usize].mv;
            if btm {
                b |= 1u128 << mv;
            } else {
                w |= 1u128 << mv;
            }
            btm = !btm;
            path.push(id);
        }
        // Simulation and backup.
        let black_won = board::playout(b, w, btm, &mut rng);
        // The root's mover is the opponent of the side to move; alternate along the path.
        let mut mover_black = !black_to_move;
        for &n in &path {
            let node = &mut nodes[n as usize];
            node.visits += 1;
            if mover_black == black_won {
                node.wins += 1;
            }
            mover_black = !mover_black;
        }
        playouts += 1;
    }

    let root = nodes[0];
    let kids = &nodes[root.first as usize..root.first as usize + root.count as usize];
    let best = kids.iter().max_by_key(|n| (n.visits, n.wins))?;
    Some(Outcome {
        mv: best.mv,
        playouts,
        winrate: if best.visits > 0 {
            best.wins as f32 / best.visits as f32
        } else {
            0.5
        },
    })
}

/// Give node `id` one child per empty cell, in a random order (so unvisited children are
/// tried in a random rather than a top-left-first order).
fn expand(nodes: &mut Vec<Node>, id: u32, mut empty: u128, rng: &mut Rng) {
    let first = nodes.len();
    while empty != 0 {
        nodes.push(Node::new(empty.trailing_zeros() as u8));
        empty &= empty - 1;
    }
    let count = nodes.len() - first;
    for i in (1..count).rev() {
        let j = rng.below(i + 1);
        nodes.swap(first + i, first + j);
    }
    let node = &mut nodes[id as usize];
    node.first = first as u32;
    node.count = count as u8;
    node.expanded = true;
}

/// UCB1 child of an expanded node; unvisited children first.
fn select(nodes: &[Node], parent: &Node) -> u32 {
    let log_n = (parent.visits.max(1) as f32).ln();
    let mut best = parent.first;
    let mut best_v = f32::NEG_INFINITY;
    for i in parent.first..parent.first + parent.count as u32 {
        let n = &nodes[i as usize];
        if n.visits == 0 {
            return i;
        }
        let v = n.wins as f32 / n.visits as f32 + C * (log_n / n.visits as f32).sqrt();
        if v > best_v {
            best_v = v;
            best = i;
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_same_move() {
        let a = search(0, 0, true, Limit::Playouts(3000), 11).unwrap();
        let b = search(0, 0, true, Limit::Playouts(3000), 11).unwrap();
        assert_eq!(a.mv, b.mv);
        assert_eq!(a.playouts, 3000);
    }

    #[test]
    fn one_empty_cell() {
        let black = ALL & !(1u128 << 60) & !board::LEFT;
        let white = board::LEFT;
        let out = search(black, white, true, Limit::Playouts(10), 1).unwrap();
        assert_eq!(out.mv, 60);
        assert!(search(
            ALL & !board::LEFT,
            board::LEFT,
            true,
            Limit::Playouts(10),
            1
        )
        .is_none());
    }
}
