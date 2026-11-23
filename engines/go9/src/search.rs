//! Monte Carlo tree search with UCT over the flat playout board.
//!
//! The root's children are given by the caller (checked against goban and the seen-board set,
//! so the move played is always legal under positional superko). Below the root the tree uses
//! the flat board's rules: captures, suicide and simple ko.

use crate::board::{opponent, Board, Rng, BLACK, NN, PASS};
use std::time::Instant;

pub const KOMI: f32 = 7.5;
/// Playouts stop after this many moves and are scored as they stand.
const PLAYOUT_CAP: u32 = 3 * NN as u32;
/// UCT exploration constant (win rates in 0..1).
const EXPLORE: f32 = 0.6;
/// A leaf is expanded once it has this many visits.
const EXPAND_AT: u32 = 2;
/// The tree stops growing at this many nodes (about 50 MB); search continues with playouts.
const MAX_NODES: usize = 2_000_000;

struct Node {
    /// The move that led here.
    mv: u8,
    /// Index of the first child; children are contiguous.
    first: u32,
    children: u16,
    expanded: bool,
    visits: u32,
    /// Wins for the player who made `mv`.
    wins: f32,
}

impl Node {
    fn new(mv: u8) -> Self {
        Node { mv, first: 0, children: 0, expanded: false, visits: 0, wins: 0.0 }
    }
}

pub struct Outcome {
    pub best: u8,
    pub playouts: u64,
    /// Win rate of `best` for the side to move.
    pub winrate: f32,
}

/// Searches from `root` until `deadline` and returns the most-visited of `root_moves`.
/// `root_moves` must be non-empty.
pub fn search(root: &Board, root_moves: &[u8], deadline: Instant, rng: &mut Rng) -> Outcome {
    let mut nodes: Vec<Node> = Vec::with_capacity(1 << 16);
    nodes.push(Node::new(PASS));
    add_children(&mut nodes, 0, root_moves, rng);

    let mut path: Vec<u32> = Vec::with_capacity(64);
    let mut moves: Vec<u8> = Vec::with_capacity(NN);
    let mut playouts: u64 = 0;
    loop {
        // Check the clock every few playouts; always run at least one.
        if playouts % 16 == 0 && playouts > 0 && Instant::now() >= deadline {
            break;
        }
        let mut board = root.clone();
        path.clear();
        path.push(0);
        let mut node = 0usize;
        // Selection.
        while nodes[node].expanded && board.passes < 2 {
            let child = select(&nodes, node);
            board.play(nodes[child].mv);
            node = child;
            path.push(node as u32);
        }
        // Expansion.
        if board.passes < 2 && nodes[node].visits + 1 >= EXPAND_AT && nodes.len() + NN < MAX_NODES {
            board.playout_moves(&mut moves);
            if moves.is_empty() {
                moves.push(PASS);
            }
            add_children(&mut nodes, node, &moves, rng);
            let child = select(&nodes, node);
            board.play(nodes[child].mv);
            node = child;
            path.push(node as u32);
        }
        // Simulation.
        let score = if board.passes >= 2 { board.score(KOMI) } else { board.playout(rng, PLAYOUT_CAP, KOMI) };
        let black_wins = score > 0.0;
        // Backpropagation: the player who moved into the root is the opponent of the root mover.
        let mut mover = opponent(root.to_move);
        for &n in &path {
            let nd = &mut nodes[n as usize];
            nd.visits += 1;
            if (mover == BLACK) == black_wins {
                nd.wins += 1.0;
            }
            mover = opponent(mover);
        }
        playouts += 1;
    }

    let root_node = &nodes[0];
    let mut best = root_node.first as usize;
    for c in root_node.first as usize..(root_node.first as usize + root_node.children as usize) {
        if nodes[c].visits > nodes[best].visits {
            best = c;
        }
    }
    let b = &nodes[best];
    Outcome { best: b.mv, playouts, winrate: if b.visits > 0 { b.wins / b.visits as f32 } else { 0.5 } }
}

/// Appends `moves` as children of `parent` in random order.
fn add_children(nodes: &mut Vec<Node>, parent: usize, moves: &[u8], rng: &mut Rng) {
    let first = nodes.len();
    for &m in moves {
        nodes.push(Node::new(m));
    }
    // Shuffle so unvisited children are tried in random order.
    let len = moves.len();
    for i in (1..len).rev() {
        let j = rng.below(i + 1);
        nodes.swap(first + i, first + j);
    }
    let p = &mut nodes[parent];
    p.first = first as u32;
    p.children = len as u16;
    p.expanded = true;
}

/// UCT choice among the children of `parent`: unvisited children first, in stored order.
fn select(nodes: &[Node], parent: usize) -> usize {
    let p = &nodes[parent];
    let (first, end) = (p.first as usize, p.first as usize + p.children as usize);
    let log_n = (p.visits.max(1) as f32).ln();
    let mut best = first;
    let mut best_value = f32::NEG_INFINITY;
    for c in first..end {
        let n = &nodes[c];
        if n.visits == 0 {
            return c;
        }
        let v = n.wins / n.visits as f32 + EXPLORE * (log_n / n.visits as f32).sqrt();
        if v > best_value {
            best_value = v;
            best = c;
        }
    }
    best
}
