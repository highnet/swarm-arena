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
/// Tree size cap (32 bytes a node: 64 MB).
const MAX_NODES: usize = 2_000_000;
/// Playouts between clock checks.
const CHECK_EVERY: u32 = 64;
/// Inferior-move pruning at expansion (#95): no children on dead cells or on cells the
/// opponent of the mover has captured.
pub const PRUNE_EXPANSION: bool = true;
/// Learned cell prior (#155, ported onto v0.6 in #297): each new child starts with
/// [`PRIOR_VISITS`] virtual AMAF visits at the self-play win rate of its cell's six-neighbour
/// pattern (`prior.rs`). Off, the search is exactly v0.6's (`same_search_as_v0_5`).
pub const PRIOR: bool = true;
/// Virtual AMAF visits per new child. AMAF only: the real counts (and so the cached `q`/`beta`,
/// the expansion threshold and the most-visited choice) never see them; in the real stats the
/// prior cost 30-40% of the playouts (#155).
pub const PRIOR_VISITS: u32 = 20;

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

/// A tree node, 32 bytes. Its statistics are from the point of view of the player who made its
/// move; its children are `first..first + count` in the arena.
///
/// `q` and `beta` cache the two terms of the selection value that depend only on the real
/// counts (#187). Real counts change only on the playout's path, one node per level, while the
/// value is read for every child of every path node, so caching them leaves selection one
/// division per child (Q_amaf) instead of three and a square root. They are computed with the
/// same `f32` operations from the same counts, so every value is bit-identical to v0.5's.
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
    /// Cached `wins / visits` (0 while unvisited), set in `backup` (#187).
    q: f32,
    /// Cached `sqrt(K / (3 visits + K))` (0 while unvisited), set in `backup` (#187).
    beta: f32,
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
            q: 0.0,
            beta: 0.0,
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

/// Run UCT from the position `black`/`white` with `black_to_move` to play, with the learned
/// prior as [`PRIOR`] says. Returns `None` only when the board is full.
pub fn search(
    black: u128,
    white: u128,
    black_to_move: bool,
    limit: Limit,
    seed: u64,
) -> Option<Outcome> {
    let prior_visits = if PRIOR { PRIOR_VISITS } else { 0 };
    search_with_prior(black, white, black_to_move, limit, seed, prior_visits)
}

/// [`search`] with `prior_visits` virtual AMAF visits per new child (0: no prior, v0.6's
/// search exactly). The offline generator learns the table with 0.
pub fn search_with_prior(
    black: u128,
    white: u128,
    black_to_move: bool,
    limit: Limit,
    seed: u64,
    prior_visits: u32,
) -> Option<Outcome> {
    let empties = ALL & !(black | white);
    if empties == 0 {
        return None;
    }
    let start = Instant::now();
    let mut rng = Rng::new(seed);
    let mut nodes: Vec<Node> = Vec::with_capacity(1 << 16);
    nodes.push(Node::new(u8::MAX));
    expand(
        &mut nodes,
        0,
        (black, white, black_to_move),
        prior_visits,
        &mut rng,
    );

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
                    if ALL & !(b | w) != 0 {
                        expand(&mut nodes, id, (b, w, btm), prior_visits, &mut rng);
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
    // so the per-child update is a table load and one add. One branch-free pass writes every
    // entry of both tables (#187; cells 121-127 are never a move).
    let inc_black = 1 | (black_won as u64) << 32;
    let inc_white = 1 | (!black_won as u64) << 32;
    let mut add = [[0u64; 128]; 2];
    let halves = [final_black as u64, (final_black >> 64) as u64];
    for (h, &half) in halves.iter().enumerate() {
        for c in 0..64 {
            let own = (half >> c & 1).wrapping_neg();
            add[0][h * 64 + c] = inc_black & own;
            add[1][h * 64 + c] = inc_white & !own;
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
        // The two real-count terms of the selection value, exactly as `value` used to compute
        // them per child.
        let v = node.visits as f32;
        node.q = node.wins as f32 / v;
        node.beta = (RAVE_K / (3.0 * v + RAVE_K)).sqrt();
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
/// than a top-left-first order), each seeded with `prior_visits` virtual AMAF visits at its
/// pattern's learned win rate (#155). Only `amaf` changes: `visits`, `wins`, `q` and `beta`
/// stay 0, which is what `backup` would cache for zero real visits, so nothing cached goes stale.
/// With `prior_visits = 0` every child is `Node::new` and the RNG draws are v0.6's.
fn expand(
    nodes: &mut Vec<Node>,
    id: u32,
    (black, white, black_to_move): (u128, u128, bool),
    prior_visits: u32,
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
            n.amaf = prior_visits as u64 | (wins as u64) << 32;
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
        // A child with neither real nor AMAF visits is worth FPU = 1.1, above any other value
        // (all are win rates, at most 1), so the first one is the answer (#187).
        if n.amaf == 0 && n.visits == 0 {
            return i;
        }
        let v = value(n);
        if v > best_v {
            best_v = v;
            best = i;
        }
    }
    best
}

/// Selection value: (1 - beta) * Q + beta * Q_amaf, beta = sqrt(K / (3n + K))
/// (1 with no real visits, 0 with no AMAF visits, FPU with neither). Q and beta come cached in
/// the node.
#[inline]
fn value(n: &Node) -> f32 {
    let (amaf_visits, amaf_wins) = (n.amaf as u32, (n.amaf >> 32) as u32);
    if amaf_visits == 0 {
        if n.visits == 0 {
            return FPU;
        }
        return n.q;
    }
    let qa = amaf_wins as f32 / amaf_visits as f32;
    if n.visits == 0 {
        return qa;
    }
    n.q + n.beta * (qa - n.q)
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

    /// Test positions: the empty board, a 3-stone opening, and two 20-stone mid-games.
    fn positions() -> [(u128, u128, bool); 4] {
        let bits = |cells: &[u8]| cells.iter().fold(0u128, |m, &c| m | 1u128 << c);
        [
            (0, 0, true),
            (bits(&[60, 49]), bits(&[70]), false),
            (
                bits(&[24, 50, 46, 37, 15, 25, 113, 48, 38, 40]),
                bits(&[96, 58, 36, 59, 104, 57, 47, 60, 82, 69]),
                true,
            ),
            (
                bits(&[107, 49, 72, 62, 53, 58, 6, 94, 64, 75]),
                bits(&[37, 70, 82, 95, 98, 26, 23, 34, 39, 65]),
                true,
            ),
        ]
    }

    /// The cheaper selection and AMAF backup (#187) search exactly as v0.5 did, with the prior
    /// off (#297: the port leaves the base exact): these moves and
    /// win-rate bits were recorded on main before #187 with the same positions, seeds and
    /// playout budgets. Any change to the tree, the RAVE values or the tie-breaking shows here.
    #[test]
    fn same_search_as_v0_5() {
        const MAIN: [(usize, u64, u32, u8, u32); 12] = [
            (0, 1, 20_000, 100, 0x3f0aa063),
            (0, 7, 20_000, 59, 0x3f094ffa),
            (0, 12345, 20_000, 58, 0x3f08fa35),
            (1, 1, 20_000, 82, 0x3f005210),
            (1, 7, 20_000, 71, 0x3f0473b4),
            (1, 12345, 20_000, 71, 0x3f042eb6),
            (2, 1, 20_000, 52, 0x3ec9aa9b),
            (2, 7, 100_000, 62, 0x3ec09ce7),
            (2, 12345, 20_000, 61, 0x3ecd7562),
            (3, 1, 20_000, 30, 0x3f22c3fd),
            (3, 7, 20_000, 30, 0x3f1f1b61),
            (3, 12345, 20_000, 20, 0x3f1df110),
        ];
        let pos = positions();
        for (i, seed, n, mv, winrate) in MAIN {
            let (b, w, btm) = pos[i];
            let out = search_with_prior(b, w, btm, Limit::Playouts(n), seed, 0).unwrap();
            assert_eq!(
                (out.mv, out.winrate.to_bits()),
                (mv, winrate),
                "position {i}, seed {seed}"
            );
        }
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

    /// v0.5's selection value, from the counts alone (nothing cached).
    fn value_from_counts(n: &Node) -> f32 {
        let (av, aw) = (n.amaf as u32, (n.amaf >> 32) as u32);
        match (n.visits, av) {
            (0, 0) => FPU,
            (v, 0) => n.wins as f32 / v as f32,
            (0, a) => aw as f32 / a as f32,
            (v, a) => {
                let q = n.wins as f32 / v as f32;
                let beta = (RAVE_K / (3.0 * v as f32 + RAVE_K)).sqrt();
                q + beta * (aw as f32 / a as f32 - q)
            }
        }
    }

    #[test]
    fn prior_seeds_new_children_and_cached_values_stay_exact() {
        let (b, w, btm) = positions()[2];
        let mut rng = Rng::new(4);
        let mut nodes = vec![Node::new(u8::MAX)];
        expand(&mut nodes, 0, (b, w, btm), PRIOR_VISITS, &mut rng);
        let root = nodes[0];
        let kids = root.first as usize..root.first as usize + root.count as usize;
        assert_eq!(root.count as u32, candidates(b, w, btm).count_ones());
        for n in &nodes[kids.clone()] {
            let r = prior::rate(b, w, n.mv as usize, btm) as u32;
            assert_eq!(n.amaf as u32, PRIOR_VISITS, "virtual AMAF visits");
            assert_eq!((n.amaf >> 32) as u32, (PRIOR_VISITS * r + 127) / 255);
            assert_eq!((n.visits, n.wins, n.q, n.beta), (0, 0, 0.0, 0.0));
            assert_eq!(value(n).to_bits(), value_from_counts(n).to_bits());
        }
        // Expand one child (with the prior) and back two playouts up root -> child -> grandchild:
        // every cached value must equal a recomputation from the counts.
        let c = kids.start as u32;
        let mv = nodes[c as usize].mv;
        let (b2, w2) = if btm {
            (b | 1u128 << mv, w)
        } else {
            (b, w | 1u128 << mv)
        };
        expand(&mut nodes, c, (b2, w2, !btm), PRIOR_VISITS, &mut rng);
        let g = nodes[c as usize].first;
        assert_eq!(nodes[g as usize].amaf as u32, PRIOR_VISITS);
        for final_black in [
            board::fill(b2, w2, !btm, &mut rng),
            board::fill(b2, w2, !btm, &mut rng),
        ] {
            backup(&mut nodes, &[0, c, g], btm, final_black);
        }
        for n in &nodes {
            assert_eq!(
                value(n).to_bits(),
                value_from_counts(n).to_bits(),
                "move {}",
                n.mv
            );
        }
        assert_eq!(nodes[c as usize].visits, 2);
        // The real counts never hold virtual visits.
        assert!(nodes[1..].iter().all(|n| n.visits <= 2));
    }

    #[test]
    fn prior_search_is_deterministic_and_legal() {
        for (b, w, btm) in positions() {
            let a = search_with_prior(b, w, btm, Limit::Playouts(5000), 3, PRIOR_VISITS).unwrap();
            let c = search_with_prior(b, w, btm, Limit::Playouts(5000), 3, PRIOR_VISITS).unwrap();
            assert_eq!((a.mv, a.winrate.to_bits()), (c.mv, c.winrate.to_bits()));
            assert_eq!((b | w) >> a.mv & 1, 0);
        }
    }
}
