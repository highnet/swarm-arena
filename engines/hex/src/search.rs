//! UCT search with RAVE over the flat board. Nodes live in one arena with their children
//! contiguous; each node's statistics are from the point of view of the player who made its move.
//!
//! RAVE (all-moves-as-first): a fill-in playout gives every empty cell to exactly one colour and
//! nothing is ever captured, so "this cell was played by X later in the simulation" is just "X
//! owns it on the final board". After each playout every child of every node on the path whose
//! cell ends up owned by that child's mover gets one AMAF visit (and a win if the mover won).

use crate::board::{self, Rng, ALL};
use crate::prior;
use std::time::{Duration, Instant};

/// RAVE equivalence parameter: beta = sqrt(K / (3n + K)), so AMAF and UCT weigh equally
/// at n = K / 3 real visits.
const RAVE_K: f32 = 1000.0;
/// Value of a child with neither real nor AMAF visits (tried before anything known).
const FPU: f32 = 1.1;
/// A leaf is expanded on this visit.
const EXPAND_AT: u32 = 2;
/// Tree size cap (24 bytes a node: 48 MB).
const MAX_NODES: usize = 2_000_000;
/// Playouts between clock checks.
const CHECK_EVERY: u32 = 64;
/// Inferior-move pruning at expansion (#95): no children on dead cells or on cells the
/// opponent of the mover has captured.
pub const PRUNE_EXPANSION: bool = true;
/// Learned cell prior (#155): each new child starts with this many virtual visits at the
/// learned win rate of its cell's pattern (`prior.rs`). 0 turns it off.
pub const PRIOR_VISITS: u32 = 20;
/// Which statistics get the virtual visits.
pub const PRIOR_TARGET: PriorTarget = PriorTarget::Real;

/// Where the prior's virtual visits go.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PriorTarget {
    /// The child's real (UCT) visits and wins.
    Real,
    /// Its AMAF visits and wins.
    Amaf,
    /// Both.
    Both,
}

/// The prior settings in effect (the constants, or `HEX_PRIOR=<visits>,<real|amaf|both>` when
/// tuning locally).
fn prior_settings() -> (u32, PriorTarget) {
    static S: std::sync::OnceLock<(u32, PriorTarget)> = std::sync::OnceLock::new();
    *S.get_or_init(|| {
        let Ok(v) = std::env::var("HEX_PRIOR") else {
            return (PRIOR_VISITS, PRIOR_TARGET);
        };
        let mut it = v.split(',');
        let n = it.next().and_then(|x| x.parse().ok()).unwrap_or(PRIOR_VISITS);
        let t = match it.next() {
            Some("amaf") => PriorTarget::Amaf,
            Some("both") => PriorTarget::Both,
            Some("real") => PriorTarget::Real,
            _ => PRIOR_TARGET,
        };
        (n.min(255), t)
    })
}

/// The cells a node with this position gets children on: every empty cell, minus (with
/// [`PRUNE_EXPANSION`]) the dead cells and the pairs the opponent captured. Never empty while
/// a cell is empty.
pub fn candidates(black: u128, white: u128, black_to_move: bool) -> u128 {
    let empty = ALL & !(black | white);
    if !PRUNE_EXPANSION {
        return empty;
    }
    let inf = board::inferior(black, white);
    let theirs = inf.captured[black_to_move as usize];
    let keep = empty & !inf.dead & !theirs;
    if keep != 0 {
        keep
    } else {
        empty
    }
}

#[derive(Clone, Copy)]
struct Node {
    visits: u32,
    wins: u32,
    /// AMAF visits in the low 32 bits, AMAF wins in the high 32 (one add per update).
    amaf: u64,
    first: u32,
    count: u8,
    mv: u8,
    expanded: bool,
    /// Virtual visits the prior put into `visits` (so expansion still waits for real ones).
    prior: u8,
}

impl Node {
    fn new(mv: u8) -> Self {
        Node {
            visits: 0,
            wins: 0,
            amaf: 0,
            first: 0,
            count: 0,
            mv,
            expanded: false,
            prior: 0,
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
    let pri = prior_settings();
    expand(&mut nodes, 0, (black, white, black_to_move), pri, &mut rng);

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
                let real = node.visits - node.prior as u32;
                if real + 1 >= EXPAND_AT && nodes.len() + 121 <= MAX_NODES {
                    if ALL & !(b | w) != 0 {
                        expand(&mut nodes, id, (b, w, btm), pri, &mut rng);
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
        let final_black = board::fill(b, w, btm, &mut rng);
        backup(&mut nodes, &path, black_to_move, final_black);
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

/// Back one playout up the path: UCT stats on the path nodes, AMAF stats on every child of
/// every path node. `final_black` is Black's board after the fill-in (tree moves included);
/// White owns the rest.
fn backup(nodes: &mut [Node], path: &[u32], black_to_move: bool, final_black: u128) {
    let black_won = board::black_connects(final_black);
    // Per-cell AMAF increments for a Black and a White mover: 1 visit if that colour owns the
    // cell at the end, plus 1 win (high half) if that colour also won. Built once per playout
    // so the per-child update is a table load and one add.
    let mut add = [[0u64; 128]; 2];
    for (side, (mut bits, won)) in [(final_black, black_won), (ALL & !final_black, !black_won)]
        .into_iter()
        .enumerate()
    {
        let inc = 1 | (won as u64) << 32;
        while bits != 0 {
            add[side][bits.trailing_zeros() as usize] = inc;
            bits &= bits - 1;
        }
    }
    // The root's mover is the opponent of the side to move; alternate along the path.
    let mut mover_black = !black_to_move;
    for &n in path {
        let node = &mut nodes[n as usize];
        node.visits += 1;
        if mover_black == black_won {
            node.wins += 1;
        }
        let (first, count) = (node.first as usize, node.count as usize);
        // Children are moved by the other side.
        let table = &add[mover_black as usize];
        for c in &mut nodes[first..first + count] {
            c.amaf += table[c.mv as usize & 127];
        }
        mover_black = !mover_black;
    }
}

/// Give node `id` (position `black`/`white`, `black_to_move` to play) one child per
/// [`candidates`] cell, in a random order (so unvisited children are tried in a random rather
/// than a top-left-first order), each seeded with the learned prior (`prior_visits` virtual
/// visits at its pattern's win rate, in the statistics `target` names).
fn expand(
    nodes: &mut Vec<Node>,
    id: u32,
    (black, white, black_to_move): (u128, u128, bool),
    (prior_visits, target): (u32, PriorTarget),
    rng: &mut Rng,
) {
    let first = nodes.len();
    let mut cells = candidates(black, white, black_to_move);
    while cells != 0 {
        let mv = cells.trailing_zeros() as u8;
        let mut n = Node::new(mv);
        if prior_visits > 0 {
            let r = prior::rate(black, white, mv as usize, black_to_move) as u32;
            let wins = (prior_visits * r + 127) / 255;
            if target != PriorTarget::Amaf {
                n.visits = prior_visits;
                n.wins = wins;
                n.prior = prior_visits as u8;
            }
            if target != PriorTarget::Real {
                n.amaf = prior_visits as u64 | (wins as u64) << 32;
            }
        }
        nodes.push(n);
        cells &= cells - 1;
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

/// Child of an expanded node maximising the RAVE-blended value. There is no UCB exploration
/// term: the C sweep (0, 0.05, 0.1, 0.3) found C = 0 best by a wide margin, because AMAF already
/// spreads statistics over every child and an exploration bonus only diverts real visits.
fn select(nodes: &[Node], parent: &Node) -> u32 {
    let mut best = parent.first;
    let mut best_v = f32::NEG_INFINITY;
    for i in parent.first..parent.first + parent.count as u32 {
        let n = &nodes[i as usize];
        let v = value(n);
        if v > best_v {
            best_v = v;
            best = i;
        }
    }
    best
}

/// Selection value: (1 - beta) * Q + beta * Q_amaf, beta = sqrt(K / (3n + K))
/// (1 with no real visits, 0 with no AMAF visits, FPU with neither).
#[inline]
fn value(n: &Node) -> f32 {
    let visits = n.visits as f32;
    let (amaf_visits, amaf_wins) = (n.amaf as u32, (n.amaf >> 32) as u32);
    if amaf_visits == 0 {
        if n.visits == 0 {
            return FPU;
        }
        return n.wins as f32 / visits;
    }
    let qa = amaf_wins as f32 / amaf_visits as f32;
    if n.visits == 0 {
        return qa;
    }
    let q = n.wins as f32 / visits;
    let beta = (RAVE_K / (3.0 * visits + RAVE_K)).sqrt();
    q + beta * (qa - q)
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
    fn amaf_counts_on_a_hand_built_path() {
        // Root (Black to move) has children on cells 0, 1, 2; child "0" is expanded with
        // children on 1 and 2. The playout went root -> Black 0 -> White 1 and ended with
        // Black owning cells 0 and 2 plus column f (a top-to-bottom chain), so Black won.
        let mut nodes = vec![Node::new(u8::MAX)];
        for mv in [0, 1, 2, 1, 2] {
            nodes.push(Node::new(mv));
        }
        (nodes[0].first, nodes[0].count, nodes[0].expanded) = (1, 3, true);
        (nodes[1].first, nodes[1].count, nodes[1].expanded) = (4, 2, true);
        let column_f = (0..11).fold(0u128, |acc, r| acc | 1u128 << (r * 11 + 5));
        let final_black = column_f | 1 | 1 << 2;
        assert!(board::black_connects(final_black));
        backup(&mut nodes, &[0, 1, 4], true, final_black);

        let stats = |i: usize| {
            let n = nodes[i];
            (n.visits, n.wins, n.amaf as u32, (n.amaf >> 32) as u32)
        };
        // Root: moved by White (lost). Its children are Black's: 0 and 2 are Black's at the end.
        assert_eq!(stats(0), (1, 0, 0, 0));
        assert_eq!(stats(1), (1, 1, 1, 1)); // Black 0: on the path, owned, won
        assert_eq!(stats(2), (0, 0, 0, 0)); // Black 1: White owns cell 1
        assert_eq!(stats(3), (0, 0, 1, 1)); // Black 2: owned by Black, won
        // Under "Black 0" the children are White's: White owns 1 (lost), not 2.
        assert_eq!(stats(4), (1, 0, 1, 0)); // White 1: on the path, owned, lost
        assert_eq!(stats(5), (0, 0, 0, 0)); // White 2: Black owns cell 2
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

    #[test]
    fn expansion_skips_dead_and_opponent_captured_cells() {
        // Black e2 captures e1 and f1; Black f5 g5 g6 f7 make f6 dead.
        let black = 1u128 << 15 | [49, 50, 61, 71].iter().fold(0u128, |m, &i| m | 1u128 << i);
        let (e1, f1, f6) = (1u128 << 4, 1u128 << 5, 1u128 << 60);
        let empty = ALL & !black;
        // White to move: no children on the dead cell or Black's pair.
        let c = candidates(black, 0, false);
        assert_eq!(c, empty & !(e1 | f1 | f6));
        // Black to move may still play its own pair, never the dead cell.
        assert_eq!(candidates(black, 0, true), empty & !f6);
        // A lone empty cell is always kept.
        let last = ALL & !board::LEFT & !(1u128 << 60);
        assert_eq!(candidates(last, board::LEFT, true).count_ones(), 1);
        let out = search(black, 0, false, Limit::Playouts(2000), 3).unwrap();
        assert_eq!((e1 | f1 | f6) >> out.mv & 1, 0);
    }

}
