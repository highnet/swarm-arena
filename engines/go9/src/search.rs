//! Monte Carlo tree search with UCT and RAVE (AMAF) over the flat playout board.
//!
//! The root's children are given by the caller (checked against goban and the seen-board set,
//! so the move played is always legal under positional superko). Below the root the tree uses
//! the flat board's rules: captures, suicide and simple ko.

use crate::board::{opponent, Board, Rng, BLACK, EMPTY, NN, PASS};
use std::time::Instant;

pub const KOMI: f32 = 7.5;
/// Playouts stop after this many moves and are scored as they stand.
const PLAYOUT_CAP: u32 = 3 * NN as u32;
/// UCT exploration constant (win rates in 0..1), added to the RAVE blend.
const EXPLORE: f32 = 0.0;
/// RAVE equivalence parameter: beta = sqrt(K / (3n + K)).
const RAVE_K: f32 = 3000.0;
/// Value of a child with neither real nor AMAF visits (tried before any visited child).
const FPU: f32 = 1.1;
/// A leaf is expanded once it has this many visits.
const EXPAND_AT: u32 = 2;
/// The tree stops growing at this many nodes (about 50 MB); search continues with playouts.
const MAX_NODES: usize = 2_000_000;

#[derive(Clone, Copy)]
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
    /// AMAF visits: playouts through the parent in which `mv` was first played, at or below
    /// the parent, by the player who would make it here.
    amaf_visits: u32,
    /// AMAF wins for that player.
    amaf_wins: f32,
}

impl Node {
    fn new(mv: u8) -> Self {
        Node { mv, first: 0, children: 0, expanded: false, visits: 0, wins: 0.0, amaf_visits: 0, amaf_wins: 0.0 }
    }
}

pub struct Outcome {
    pub best: u8,
    pub playouts: u64,
    /// Win rate of `best` for the side to move.
    pub winrate: f32,
    /// Visits the root already held when this search started (inherited by tree reuse).
    pub inherited: u32,
}

/// A search tree and the position at its root. Kept between moves so the next search can start
/// from the subtree of the position actually reached (`advance`).
pub struct Tree {
    nodes: Vec<Node>,
    root: Board,
}

impl Tree {
    /// A fresh tree over `root` whose root children are `root_moves` (non-empty).
    pub fn new(root: &Board, root_moves: &[u8], rng: &mut Rng) -> Tree {
        let mut nodes: Vec<Node> = Vec::with_capacity(1 << 16);
        nodes.push(Node::new(PASS));
        add_children(&mut nodes, 0, root_moves, rng);
        Tree { nodes, root: root.clone() }
    }

    /// Visits of the root node.
    #[cfg(test)]
    pub fn root_visits(&self) -> u32 {
        self.nodes[0].visits
    }

    /// Visits of the node reached by `moves` from the root, if the tree holds it.
    #[cfg(test)]
    pub fn visits_after(&self, moves: &[u8]) -> Option<u32> {
        let mut at = 0;
        for &m in moves {
            at = self.child(at, m)?;
        }
        Some(self.nodes[at].visits)
    }

    /// The root's children's moves, in arena order.
    #[cfg(test)]
    pub fn root_children(&self) -> Vec<u8> {
        let p = &self.nodes[0];
        (p.first as usize..p.first as usize + p.children as usize).map(|c| self.nodes[c].mv).collect()
    }

    /// The most-visited root child and its most-visited child.
    #[cfg(test)]
    pub fn principal_pair(&self) -> (u8, u8, u32) {
        let most = |n: usize| {
            let p = &self.nodes[n];
            (p.first as usize..p.first as usize + p.children as usize).max_by_key(|&c| self.nodes[c].visits).unwrap()
        };
        let a = most(0);
        let b = most(a);
        (self.nodes[a].mv, self.nodes[b].mv, self.nodes[b].visits)
    }

    fn child(&self, parent: usize, mv: u8) -> Option<usize> {
        let p = &self.nodes[parent];
        if !p.expanded {
            return None;
        }
        (p.first as usize..p.first as usize + p.children as usize).find(|&c| self.nodes[c].mv == mv)
    }

    /// Re-roots the tree at the node reached by playing `moves` from its root, keeping that
    /// subtree's visits, wins and AMAF statistics and dropping the rest (the arena is compacted).
    /// `actual` is the real position now and `root_moves` its legal root moves from the
    /// goban/superko oracle: root children the oracle rejects are pruned, oracle moves the tree
    /// lacks are added unvisited. None (start fresh) when a move is not in the tree, the node
    /// reached was never expanded, or its board differs from `actual`.
    pub fn advance(self, moves: &[u8], actual: &Board, root_moves: &[u8]) -> Option<Tree> {
        if moves.is_empty() {
            return None;
        }
        let mut board = self.root.clone();
        let mut at = 0usize;
        for &m in moves {
            at = self.child(at, m)?;
            board.play(m);
        }
        if !self.nodes[at].expanded || board.cell != actual.cell || board.to_move != actual.to_move {
            return None;
        }
        let old = self.nodes;
        let mut nodes: Vec<Node> = Vec::with_capacity(old.len().max(1 << 16));
        // (new index, old index) of nodes whose children still have to be copied.
        let mut queue: Vec<(u32, u32)> = Vec::new();
        let mut root = old[at];
        root.mv = PASS;
        root.first = 1;
        nodes.push(root);
        let o = &old[at];
        let kids = o.first as usize..o.first as usize + o.children as usize;
        for c in kids.clone() {
            if root_moves.contains(&old[c].mv) {
                queue.push((nodes.len() as u32, c as u32));
                nodes.push(old[c]);
            }
        }
        for &m in root_moves {
            if !kids.clone().any(|c| old[c].mv == m) {
                nodes.push(Node::new(m));
            }
        }
        nodes[0].children = (nodes.len() - 1) as u16;
        // Breadth first: each node's children are copied contiguously.
        let mut q = 0;
        while q < queue.len() {
            let (ni, oi) = queue[q];
            q += 1;
            let on = old[oi as usize];
            if !on.expanded {
                continue;
            }
            let first = nodes.len();
            for c in on.first as usize..on.first as usize + on.children as usize {
                queue.push((nodes.len() as u32, c as u32));
                nodes.push(old[c]);
            }
            nodes[ni as usize].first = first as u32;
        }
        Some(Tree { nodes, root: actual.clone() })
    }
}

/// Searches from `root` until `deadline` and returns the most-visited of `root_moves`.
/// `root_moves` must be non-empty.
#[cfg(test)]
pub fn search(root: &Board, root_moves: &[u8], deadline: Instant, rng: &mut Rng) -> Outcome {
    search_limited(root, root_moves, Some(deadline), u64::MAX, rng)
}

/// As `search`, but stops after `max_playouts` simulations too. With no deadline the result
/// depends only on the position, the moves and the RNG: the offline book generator uses this.
pub fn search_limited(root: &Board, root_moves: &[u8], deadline: Option<Instant>, max_playouts: u64, rng: &mut Rng) -> Outcome {
    let mut tree = Tree::new(root, root_moves, rng);
    search_tree(&mut tree, deadline, max_playouts, rng)
}

/// Grows `tree` until `deadline` or `max_playouts` more simulations and returns the
/// most-visited root child.
pub fn search_tree(tree: &mut Tree, deadline: Option<Instant>, max_playouts: u64, rng: &mut Rng) -> Outcome {
    let inherited = tree.nodes[0].visits;
    let root = &tree.root;
    let nodes = &mut tree.nodes;

    let mut path: Vec<u32> = Vec::with_capacity(64);
    let mut moves: Vec<u8> = Vec::with_capacity(NN);
    // Every move of this simulation from the root, tree and playout, passes included.
    let mut seq: Vec<u8> = Vec::with_capacity(4 * NN);
    let mut playouts: u64 = 0;
    loop {
        // Check the clock every few playouts; always run at least one.
        if playouts >= max_playouts.max(1) {
            break;
        }
        if let Some(deadline) = deadline {
            if playouts % 16 == 0 && playouts > 0 && Instant::now() >= deadline {
                break;
            }
        }
        let mut board = root.clone();
        path.clear();
        path.push(0);
        seq.clear();
        let mut node = 0usize;
        // Selection.
        while nodes[node].expanded && board.passes < 2 {
            let child = select(nodes, node);
            board.play(nodes[child].mv);
            seq.push(nodes[child].mv);
            node = child;
            path.push(node as u32);
        }
        // Expansion.
        if board.passes < 2 && nodes[node].visits + 1 >= EXPAND_AT && nodes.len() + NN < MAX_NODES {
            board.playout_moves(&mut moves);
            if moves.is_empty() {
                moves.push(PASS);
            }
            add_children(nodes, node, &moves, rng);
            let child = select(nodes, node);
            board.play(nodes[child].mv);
            seq.push(nodes[child].mv);
            node = child;
            path.push(node as u32);
        }
        // Simulation.
        let score = if board.passes >= 2 { board.score(KOMI) } else { board.playout_recorded(rng, PLAYOUT_CAP, KOMI, &mut seq) };
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
        amaf_update(nodes, &path, &seq, root.to_move, black_wins);
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
    Outcome { best: b.mv, playouts, winrate: if b.visits > 0 { b.wins / b.visits as f32 } else { 0.5 }, inherited }
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

/// AMAF update, first play wins. `seq[i]` is the move played from `path[i]` onwards (the tree
/// moves, then the playout); colours alternate from `root_mover`, passes included. For each
/// expanded path node, each child whose point was first played at or after that node, by the
/// colour to move there, gets one AMAF visit, and a win if that colour won. Passes never count,
/// and a point played again after a capture counts only for whoever played it first.
fn amaf_update(nodes: &mut [Node], path: &[u32], seq: &[u8], root_mover: u8, black_wins: bool) {
    // first[p]: colour of the first play on p in seq[i..], for the current i; EMPTY if none.
    let mut first = [EMPTY; NN];
    let colour_at = |i: usize| if i % 2 == 0 { root_mover } else { opponent(root_mover) };
    for i in (0..seq.len()).rev() {
        let m = seq[i];
        if m != PASS {
            first[m as usize] = colour_at(i);
        }
        if i < path.len() {
            let parent = &nodes[path[i] as usize];
            if !parent.expanded {
                continue;
            }
            let (start, end) = (parent.first as usize, parent.first as usize + parent.children as usize);
            let mover = colour_at(i);
            let win = if (mover == BLACK) == black_wins { 1.0 } else { 0.0 };
            for c in &mut nodes[start..end] {
                if c.mv != PASS && first[c.mv as usize] == mover {
                    c.amaf_visits += 1;
                    c.amaf_wins += win;
                }
            }
        }
    }
}

/// Choice among the children of `parent`: the highest blend (1 - beta) * Q + beta * Q_amaf,
/// beta = sqrt(K / (3n + K)), plus the UCB term when EXPLORE > 0. A child with no real visits is
/// valued by AMAF alone, one with neither by FPU; ties go to the earlier (shuffled) child.
fn select(nodes: &[Node], parent: usize) -> usize {
    let p = &nodes[parent];
    let (first, end) = (p.first as usize, p.first as usize + p.children as usize);
    let log_n = (p.visits.max(1) as f32).ln();
    let mut best = first;
    let mut best_value = f32::NEG_INFINITY;
    for c in first..end {
        let n = &nodes[c];
        let v = if n.visits == 0 && n.amaf_visits == 0 {
            FPU
        } else {
            let amaf = if n.amaf_visits > 0 { n.amaf_wins / n.amaf_visits as f32 } else { 0.5 };
            if n.visits == 0 {
                amaf + EXPLORE * log_n.sqrt()
            } else {
                let nv = n.visits as f32;
                let beta = (RAVE_K / (3.0 * nv + RAVE_K)).sqrt();
                let q = n.wins / nv;
                (1.0 - beta) * q + beta * amaf + EXPLORE * (log_n / nv).sqrt()
            }
        };
        if v > best_value {
            best_value = v;
            best = c;
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Root (Black to move) with children 0, 1, 2; child 0 expanded with children 1, 2, 3.
    /// The simulation from the root: B 0 (tree), W 1 (tree), then the playout B 2, W pass,
    /// B 1 (point 1 again, after a capture), W 3, W never plays 2.
    fn tree() -> (Vec<Node>, Vec<u32>, Vec<u8>) {
        let mut nodes = vec![Node::new(PASS)];
        for m in [0u8, 1, 2] {
            nodes.push(Node::new(m));
        }
        nodes[0].first = 1;
        nodes[0].children = 3;
        nodes[0].expanded = true;
        for m in [1u8, 2, 3] {
            nodes.push(Node::new(m));
        }
        nodes[1].first = 4;
        nodes[1].children = 3;
        nodes[1].expanded = true;
        // path: root, child 0 (node 1), its child 1 (node 4, a leaf).
        let path = vec![0, 1, 4];
        let seq = vec![0, 1, 2, PASS, 1, 3];
        (nodes, path, seq)
    }

    #[test]
    fn amaf_counts_on_a_hand_built_path() {
        let (mut nodes, path, seq) = tree();
        // White wins.
        amaf_update(&mut nodes, &path, &seq, BLACK, false);
        let a = |n: &Node| (n.amaf_visits, n.amaf_wins);
        // Root children, Black to move: 0 first played by B (yes), 1 first by W (no, the later
        // B replay does not count), 2 first by B (yes). Black lost: no wins.
        assert_eq!(a(&nodes[1]), (1, 0.0));
        assert_eq!(a(&nodes[2]), (0, 0.0));
        assert_eq!(a(&nodes[3]), (1, 0.0));
        // Children of node 1, White to move, from seq[1..]: 1 first by W (yes), 2 first by B
        // (no), 3 first by W (yes). White won.
        assert_eq!(a(&nodes[4]), (1, 1.0));
        assert_eq!(a(&nodes[5]), (0, 0.0));
        assert_eq!(a(&nodes[6]), (1, 1.0));
    }

    #[test]
    fn passes_never_count() {
        let mut nodes = vec![Node::new(PASS), Node::new(PASS), Node::new(4)];
        nodes[0].first = 1;
        nodes[0].children = 2;
        nodes[0].expanded = true;
        amaf_update(&mut nodes, &[0, 1], &[PASS, 5, 4], BLACK, true);
        assert_eq!(nodes[1].amaf_visits, 0);
        assert_eq!((nodes[2].amaf_visits, nodes[2].amaf_wins), (1, 1.0));
    }

    #[test]
    fn unvisited_children_use_amaf_then_fpu() {
        let mut nodes = vec![Node::new(PASS), Node::new(0), Node::new(1), Node::new(2)];
        nodes[0].first = 1;
        nodes[0].children = 3;
        nodes[0].expanded = true;
        nodes[0].visits = 10;
        nodes[1].visits = 5;
        nodes[1].wins = 4.0;
        nodes[1].amaf_visits = 5;
        nodes[1].amaf_wins = 4.0;
        nodes[2].amaf_visits = 3;
        nodes[2].amaf_wins = 3.0;
        // Node 3 has nothing: FPU 1.1 beats everything.
        assert_eq!(select(&nodes, 0), 3);
        nodes[3].amaf_visits = 4;
        nodes[3].amaf_wins = 0.0;
        // Node 2 (AMAF 1.0) beats node 1 (0.8) and node 3 (0.0).
        assert_eq!(select(&nodes, 0), 2);
    }
}
