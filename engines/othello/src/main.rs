//! othello engine for Swarm Arena.
//! Rules: the `othello` crate. Search and evaluation: written by the swarm.
//! Protocol and library policy: ../PROTOCOL.md.

use othello::Game;
use std::io::{self, BufRead, Write};
use std::time::{Duration, Instant};

const CORNERS: u64 = 1 | 1 << 7 | 1 << 56 | 1 << 63;

/// `a1` is top-left: index = (row - 1) * 8 + column, which is the crate's own bit layout.
fn parse_square(m: &str) -> Option<usize> {
    let b = m.as_bytes();
    if b.len() != 2 || !(b'a'..=b'h').contains(&b[0]) || !(b'1'..=b'8').contains(&b[1]) {
        return None;
    }
    Some((b[1] - b'1') as usize * 8 + (b[0] - b'a') as usize)
}

fn square_name(i: usize) -> String {
    format!("{}{}", (b'a' + (i % 8) as u8) as char, i / 8 + 1)
}

/// Replays the game from the start. Returns None on an illegal move.
fn replay(moves: &[String]) -> Option<Game> {
    let mut g = Game::default();
    for m in moves {
        if m == "pass" {
            if g.available_moves() != 0 {
                return None;
            }
            g.pass_move();
        } else {
            g = g.make_move(parse_square(m)?)?;
        }
    }
    Some(g)
}

// X-squares (b2 g2 b7 g7) and C-squares, each paired with the corner it touches.
const X_SQUARES: [(usize, usize); 4] = [(9, 0), (14, 7), (49, 56), (54, 63)];
const C_SQUARES: [(usize, usize); 8] =
    [(1, 0), (8, 0), (6, 7), (15, 7), (48, 56), (57, 56), (55, 63), (62, 63)];

const CORNER_W: i32 = 30;
const MOBILITY_W: i32 = 4;
const X_W: i32 = 18;
const C_W: i32 = 8;
/// Terminal scores sit far above any heuristic score.
const WIN: i32 = 100_000;
const INF: i32 = 1_000_000;

/// Static evaluation from the side to move's point of view. Original terms: corner ownership,
/// mobility difference, and a penalty for X/C-squares next to a still-empty corner.
fn evaluate(g: &Game) -> i32 {
    let [me, opp] = g.get();
    let empty = !(me | opp);
    let mut s = CORNER_W * ((me & CORNERS).count_ones() as i32 - (opp & CORNERS).count_ones() as i32);
    let mut o = g.clone();
    o.pass_move();
    s += MOBILITY_W * (g.available_moves().count_ones() as i32 - o.available_moves().count_ones() as i32);
    for &(x, c) in &X_SQUARES {
        if empty >> c & 1 == 1 {
            s -= X_W * ((me >> x & 1) as i32 - (opp >> x & 1) as i32);
        }
    }
    for &(sq, c) in &C_SQUARES {
        if empty >> c & 1 == 1 {
            s -= C_W * ((me >> sq & 1) as i32 - (opp >> sq & 1) as i32);
        }
    }
    s
}

/// Final score for the side to move once neither side can place: disc difference.
fn terminal(g: &Game) -> i32 {
    let [me, opp] = g.get();
    let d = me.count_ones() as i32 - opp.count_ones() as i32;
    d.signum() * WIN + d
}

/// Hard cap on quiescence plies below the horizon, so corner chains cannot explode.
const MAX_QPLY: u32 = 4;

struct Search {
    start: Instant,
    deadline: Duration,
    nodes: u64,
    /// Nodes searched past the horizon by quiescence (also counted in `nodes`, so the 1024-node
    /// clock check runs inside quiescence too).
    qnodes: u64,
    stopped: bool,
    /// Corner quiescence at the leaves (task #59). Off = plain `evaluate()` at depth 0.
    qsearch: bool,
}

impl Search {
    fn out_of_time(&mut self) -> bool {
        if !self.stopped && self.nodes & 1023 == 0 && self.start.elapsed() >= self.deadline {
            self.stopped = true;
        }
        self.stopped
    }

    /// Negamax alpha-beta. A side with no placement passes; two passes end the game.
    fn negamax(&mut self, g: &Game, depth: u32, mut alpha: i32, beta: i32) -> i32 {
        self.nodes += 1;
        if self.out_of_time() {
            return 0;
        }
        let avail = g.available_moves();
        if avail == 0 {
            let mut p = g.clone();
            p.pass_move();
            if p.available_moves() == 0 {
                return terminal(g);
            }
            if depth == 0 {
                return self.leaf(g, alpha, beta);
            }
            return -self.negamax(&p, depth - 1, -beta, -alpha);
        }
        if depth == 0 {
            return self.leaf(g, alpha, beta);
        }
        let mut best = -INF;
        for i in ordered(avail, None) {
            let Some(next) = g.make_move(i) else { continue };
            let v = -self.negamax(&next, depth - 1, -beta, -alpha);
            if self.stopped {
                return 0;
            }
            if v > best {
                best = v;
                if v > alpha {
                    alpha = v;
                    if alpha >= beta {
                        break;
                    }
                }
            }
        }
        best
    }

    /// Score at the horizon: quiescence when enabled, otherwise the static evaluation.
    fn leaf(&mut self, g: &Game, alpha: i32, beta: i32) -> i32 {
        if self.qsearch {
            self.quiesce(g, 0, alpha, beta)
        } else {
            evaluate(g)
        }
    }

    /// Corner quiescence. Othello has no captures; the unstable leaf is one where a corner is
    /// on offer. The side to move stands pat on `evaluate()` or takes a corner; a side forced
    /// to pass hands the move over, and the search follows the opponent's corners. Capped at
    /// `MAX_QPLY` plies. Scores are side-to-move, like `evaluate()`.
    fn quiesce(&mut self, g: &Game, qply: u32, mut alpha: i32, beta: i32) -> i32 {
        // The horizon node itself was counted (and clock-checked) by `negamax`; `qnodes` are
        // the nodes searched past it.
        if qply > 0 {
            self.nodes += 1;
            self.qnodes += 1;
            if self.out_of_time() {
                return 0;
            }
        }
        let avail = g.available_moves();
        if avail == 0 {
            let mut p = g.clone();
            p.pass_move();
            let reply = p.available_moves();
            if reply == 0 {
                return terminal(g);
            }
            if qply < MAX_QPLY && reply & CORNERS != 0 {
                return -self.quiesce(&p, qply + 1, -beta, -alpha);
            }
            return evaluate(g);
        }
        let stand = evaluate(g);
        let corners = avail & CORNERS;
        if stand >= beta || corners == 0 || qply >= MAX_QPLY {
            return stand;
        }
        let mut best = stand;
        alpha = alpha.max(stand);
        let mut m = corners;
        while m != 0 {
            let i = m.trailing_zeros() as usize;
            m &= m - 1;
            let Some(next) = g.make_move(i) else { continue };
            let v = -self.quiesce(&next, qply + 1, -beta, -alpha);
            if self.stopped {
                return 0;
            }
            if v > best {
                best = v;
                if v > alpha {
                    alpha = v;
                    if alpha >= beta {
                        break;
                    }
                }
            }
        }
        best
    }
}

/// Move order: the previous iteration's best move, then corners, then plain squares,
/// then C-squares and X-squares last.
fn ordered(avail: u64, first: Option<usize>) -> Vec<usize> {
    let mut xs = 0u64;
    let mut cs = 0u64;
    for &(x, _) in &X_SQUARES {
        xs |= 1 << x;
    }
    for &(c, _) in &C_SQUARES {
        cs |= 1 << c;
    }
    let mut out = Vec::with_capacity(avail.count_ones() as usize);
    if let Some(f) = first.filter(|&f| avail >> f & 1 == 1) {
        out.push(f);
    }
    for mask in [CORNERS, !(CORNERS | xs | cs), cs, xs] {
        let mut m = avail & mask;
        while m != 0 {
            let i = m.trailing_zeros() as usize;
            m &= m - 1;
            if Some(i) != first {
                out.push(i);
            }
        }
    }
    out
}

/// Iterative-deepening alpha-beta. Stops on a clock check at ~60% of the budget and plays
/// the best move of the last completed depth. Returns (move, depth completed).
fn search(g: &Game, budget_ms: u64) -> (usize, u32) {
    search_limited(g, u32::MAX, Duration::from_millis(budget_ms * 6 / 10))
}

/// Iterative deepening up to `max_depth` plies or until `deadline` passes, whichever is first.
fn search_limited(g: &Game, max_depth: u32, deadline: Duration) -> (usize, u32) {
    let out = search_with(g, max_depth, deadline, true);
    (out.best, out.depth)
}

/// What one search produced: the move, the last completed depth, its root score and the
/// node counts (`qnodes` is the quiescence share of `nodes`).
#[derive(Debug, Clone, Copy)]
#[cfg_attr(not(test), allow(dead_code))] // score and node counts are read by tests and reports
struct SearchOut {
    best: usize,
    depth: u32,
    score: i32,
    nodes: u64,
    qnodes: u64,
}

fn search_with(g: &Game, max_depth: u32, deadline: Duration, qsearch: bool) -> SearchOut {
    let avail = g.available_moves();
    let order = ordered(avail, None);
    let mut best = order[0];
    if order.len() == 1 {
        return SearchOut { best, depth: 0, score: 0, nodes: 0, qnodes: 0 };
    }
    let mut s = Search {
        start: Instant::now(),
        deadline,
        nodes: 0,
        qnodes: 0,
        stopped: false,
        qsearch,
    };
    let mut score = 0;
    let empties = (!(g.get()[0] | g.get()[1])).count_ones();
    let mut done = 0;
    for depth in 1..=empties.min(max_depth) {
        let mut alpha = -INF;
        let mut iter_best = None;
        for i in ordered(avail, Some(best)) {
            let Some(next) = g.make_move(i) else { continue };
            let v = -s.negamax(&next, depth - 1, -INF, -alpha);
            if s.stopped {
                break;
            }
            if v > alpha || iter_best.is_none() {
                alpha = v;
                iter_best = Some(i);
            }
        }
        if s.stopped {
            break;
        }
        best = iter_best.unwrap_or(best);
        score = alpha;
        done = depth;
        // A deeper iteration costs several times this one: do not start what cannot finish.
        if s.start.elapsed() * 3 >= s.deadline {
            break;
        }
    }
    SearchOut { best, depth: done, score, nodes: s.nodes, qnodes: s.qnodes }
}

/// Picks a move for the side to move. Passes only with no placement.
fn choose(moves: &[String], budget_ms: u64) -> Option<String> {
    let g = replay(moves)?;
    if g.available_moves() == 0 {
        return Some("pass".into());
    }
    Some(square_name(search(&g, budget_ms).0))
}

/// Handles one protocol line, returning the reply to print (if any) and whether to quit.
fn handle(line: &str, moves: &mut Vec<String>) -> (Option<String>, bool) {
    let mut parts = line.split_whitespace();
    match parts.next() {
        Some("game") => (Some("ready".into()), false),
        Some("position") => {
            *moves = parts.map(String::from).collect();
            (None, false)
        }
        Some("go") => {
            let budget = parts.next().and_then(|s| s.parse().ok()).unwrap_or(1000);
            let mv = choose(moves, budget).unwrap_or_else(|| "none".into());
            (Some(format!("bestmove {mv}")), false)
        }
        Some("quit") => (None, true),
        _ => (None, false),
    }
}

fn main() {
    let stdin = io::stdin();
    let mut out = io::stdout();
    let mut moves = Vec::new();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let (reply, quit) = handle(&line, &mut moves);
        if let Some(r) = reply {
            writeln!(out, "{r}").ok();
            out.flush().ok();
        }
        if quit {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handshake_and_position() {
        let mut moves = Vec::new();
        assert_eq!(handle("game othello", &mut moves).0.as_deref(), Some("ready"));
        handle("position a b", &mut moves);
        assert_eq!(moves, vec!["a", "b"]);
        assert!(handle("go 100", &mut moves).0.unwrap().starts_with("bestmove "));
        assert!(handle("quit", &mut moves).1);
    }

    fn mv(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn coordinate_mapping_round_trips() {
        assert_eq!(parse_square("a1"), Some(0));
        assert_eq!(parse_square("h1"), Some(7));
        assert_eq!(parse_square("a8"), Some(56));
        assert_eq!(parse_square("h8"), Some(63));
        assert_eq!(parse_square("i1"), None);
        for i in 0..64 {
            assert_eq!(parse_square(&square_name(i)), Some(i));
        }
    }

    #[test]
    fn opening_moves_match_referee_for_both_colours() {
        // Black's legal openings in standard notation (a1 top-left): d3 c4 f5 e6.
        let g = replay(&[]).unwrap();
        let want: u64 = ["d3", "c4", "f5", "e6"].iter().map(|m| 1u64 << parse_square(m).unwrap()).sum();
        assert_eq!(g.available_moves(), want);
        // After black d3, white's replies are c3 e3 c5.
        let g = replay(&mv(&["d3"])).unwrap();
        let want: u64 = ["c3", "e3", "c5"].iter().map(|m| 1u64 << parse_square(m).unwrap()).sum();
        assert_eq!(g.available_moves(), want);
        assert!(replay(&mv(&["a1"])).is_none());
    }

    #[test]
    fn passes_only_without_placement() {
        assert!(replay(&mv(&["pass"])).is_none(), "a pass while moves exist is illegal");
        // Pseudo-random games until the side to move has no placement but the opponent does.
        let mut seed: u64 = 12345;
        let mut found = 0;
        for _ in 0..500 {
            let mut moves: Vec<String> = Vec::new();
            loop {
                let g = replay(&moves).unwrap();
                let avail = g.available_moves();
                let mut o = g.clone();
                o.pass_move();
                if avail == 0 {
                    if o.available_moves() == 0 {
                        break;
                    }
                    assert_eq!(choose(&moves, 0).unwrap(), "pass");
                    found += 1;
                    moves.push("pass".into());
                    continue;
                }
                assert_ne!(choose(&moves, 0).unwrap(), "pass");
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                let k = (seed >> 33) as u32 % avail.count_ones();
                let i = (0..64).filter(|i| avail >> i & 1 == 1).nth(k as usize).unwrap();
                moves.push(square_name(i));
            }
        }
        assert!(found > 0, "no pass position reached");
    }

    #[test]
    fn plays_a_full_game_legally() {
        let mut moves = Vec::new();
        for _ in 0..130 {
            let g = replay(&moves).unwrap();
            let mut o = g.clone();
            o.pass_move();
            if g.available_moves() == 0 && o.available_moves() == 0 {
                break;
            }
            moves.push(choose(&moves, 50).unwrap());
            assert!(replay(&moves).is_some());
        }
        assert!(moves.len() > 20);
    }

    /// Fixed-depth root score of `m` (no clock in play), from the mover's point of view.
    fn root_score(g: &Game, m: usize, depth: u32, qsearch: bool) -> i32 {
        let next = g.make_move(m).unwrap();
        let mut s = Search { start: Instant::now(), deadline: Duration::from_secs(600), nodes: 0, qnodes: 0, stopped: false, qsearch };
        -s.negamax(&next, depth - 1, -INF, INF)
    }

    const NO_CLOCK: Duration = Duration::from_secs(600);

    #[test]
    fn quiescence_sees_a_corner_at_the_horizon() {
        // Seeded midgame, 24 empties, Black to move. After a3 and any White reply, Black has a
        // corner placement: it sits just past a depth-2 horizon. Plain depth 2 scores a3 from a
        // standing evaluation that cannot see that corner, ties it with c1 and plays c1 (move
        // order). Corner quiescence searches the corner at the leaf, scores a3 higher (toward the
        // deep score) and plays a3, which a plain depth-8 search confirms by a wide margin.
        let g = replay(&mv(&[
            "c4", "c3", "f5", "f4", "g3", "g4", "e3", "h2", "d3", "c5", "b6", "f3", "h4", "g5", "g2", "e6", "f6", "b5",
            "e2", "g6", "h3", "h5", "b3", "b2", "a6", "a5", "b4", "a7", "e7", "a4", "c6", "d6", "b1", "c2", "d7", "d8",
        ]))
        .unwrap();
        let (c1, a3) = (parse_square("c1").unwrap(), parse_square("a3").unwrap());
        let after_a3 = g.make_move(a3).unwrap();
        let mut replies = after_a3.available_moves();
        assert_ne!(replies, 0);
        while replies != 0 {
            let r = replies.trailing_zeros() as usize;
            replies &= replies - 1;
            assert_ne!(after_a3.make_move(r).unwrap().available_moves() & CORNERS, 0, "a3 then {}: Black has a corner", square_name(r));
        }
        let plain = search_with(&g, 2, NO_CLOCK, false);
        let quiet = search_with(&g, 2, NO_CLOCK, true);
        assert_eq!((plain.best, plain.depth), (c1, 2));
        assert_eq!((quiet.best, quiet.depth), (a3, 2));
        assert!(quiet.qnodes > 0 && quiet.qnodes < quiet.nodes);
        assert_eq!(search_with(&g, 8, NO_CLOCK, false).best, a3, "deep plain search agrees with quiescence");
        // The misjudged line: plain depth 2 ties a3 with c1; quiescence moves a3's score toward
        // the deep score, and the deep search rates a3 well above c1.
        let (a3_plain, a3_quiet, a3_deep) = (root_score(&g, a3, 2, false), root_score(&g, a3, 2, true), root_score(&g, a3, 8, false));
        assert_eq!(a3_plain, root_score(&g, c1, 2, false), "plain depth 2 cannot tell a3 from c1");
        assert!(a3_quiet > a3_plain, "quiescence {a3_quiet} vs plain {a3_plain}");
        assert!((a3_quiet - a3_deep).abs() < (a3_plain - a3_deep).abs());
        assert!(a3_deep >= root_score(&g, c1, 8, false) + 20);
    }

    #[test]
    fn quiescence_is_capped_and_scores_like_evaluate_when_quiet() {
        // No corner on offer: quiescence is exactly the static evaluation, one node.
        let g = replay(&[]).unwrap();
        let mut s = Search { start: Instant::now(), deadline: NO_CLOCK, nodes: 0, qnodes: 0, stopped: false, qsearch: true };
        assert_eq!(s.quiesce(&g, 0, -INF, INF), evaluate(&g));
        assert_eq!(s.qnodes, 0, "nothing searched past the horizon");
        // At the cap it stands pat even with a corner on offer.
        let g = replay(&mv(&[
            "c4", "c3", "f5", "f4", "g3", "g4", "e3", "h2", "d3", "c5", "b6", "f3", "h4", "g5", "g2", "e6", "f6", "b5",
            "e2", "g6", "h3", "h5", "b3", "b2", "a6", "a5", "b4", "a7", "e7", "a4", "c6", "d6", "b1", "c2", "d7", "d8", "c1",
        ]))
        .unwrap();
        assert_ne!(g.available_moves() & CORNERS, 0);
        let mut s = Search { start: Instant::now(), deadline: NO_CLOCK, nodes: 0, qnodes: 0, stopped: false, qsearch: true };
        assert_eq!(s.quiesce(&g, MAX_QPLY, -INF, INF), evaluate(&g));
        assert!(s.quiesce(&g, 0, -INF, INF) >= evaluate(&g), "taking the corner is searched, standing pat is the floor");
    }

    /// Seeded positions for the depth report: (empties band, game) pairs from pseudo-random play.
    fn report_positions() -> Vec<(u32, Game)> {
        let mut out = Vec::new();
        for band in [50u32, 40, 30, 20] {
            for game in 0..8u64 {
                let mut seed = 0xdead_beef ^ game.wrapping_mul(0x9e37_79b9) ^ band as u64;
                let mut moves: Vec<String> = Vec::new();
                loop {
                    let g = replay(&moves).unwrap();
                    let avail = g.available_moves();
                    let empties = (!(g.get()[0] | g.get()[1])).count_ones();
                    if empties <= band && avail.count_ones() >= 2 {
                        out.push((band, g));
                        break;
                    }
                    if avail == 0 {
                        moves.push("pass".into());
                        continue;
                    }
                    seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                    let k = (seed >> 33) as u32 % avail.count_ones();
                    let i = (0..64).filter(|i| avail >> i & 1 == 1).nth(k as usize).unwrap();
                    moves.push(square_name(i));
                }
            }
        }
        out
    }

    #[test]
    #[ignore = "report: cargo test --release -p othello-engine depth_report -- --ignored --nocapture"]
    fn depth_report() {
        // Depth reached at `go 200` (wall clock, so informational only) and the quiescence node
        // share at a fixed depth (deterministic).
        for (label, q) in [("plain", false), ("quiescence", true)] {
            for band in [50u32, 40, 30, 20] {
                let ps: Vec<_> = report_positions().into_iter().filter(|p| p.0 == band).collect();
                let depths: Vec<u32> = ps.iter().map(|(_, g)| search_with(g, u32::MAX, Duration::from_millis(120), q).depth).collect();
                let (mut n, mut qn) = (0, 0);
                for (_, g) in &ps {
                    let o = search_with(g, 6, NO_CLOCK, q);
                    n += o.nodes;
                    qn += o.qnodes;
                }
                println!(
                    "{label:>10} <={band} empties: go 200 depth {}-{} {:?}; depth 6 nodes {n} qnodes {qn} ({:.0}%)",
                    depths.iter().min().unwrap(),
                    depths.iter().max().unwrap(),
                    depths,
                    100.0 * qn as f64 / n.max(1) as f64
                );
            }
        }
    }

    #[test]
    fn takes_a_free_corner_over_an_x_square() {
        // In the midgame (20+ empties), wherever a corner is legal and so is the X-square
        // touching that same corner, a fixed-depth search (no clock in play) must not choose
        // that X-square: it would hand the corner away. Endgames are left out on purpose:
        // there the disc count decides and an X-square can be the right move. Positions come
        // from seeded pseudo-random games, so every run checks the same positions.
        let mut checked = 0;
        for game in 0..40u64 {
            let mut seed = 0x9e37_79b9_7f4a_7c15 ^ game;
            let mut moves: Vec<String> = Vec::new();
            loop {
                let g = replay(&moves).unwrap();
                let avail = g.available_moves();
                let mut o = g.clone();
                o.pass_move();
                if avail == 0 {
                    if o.available_moves() == 0 {
                        break;
                    }
                    moves.push("pass".into());
                    continue;
                }
                let empties = (!(g.get()[0] | g.get()[1])).count_ones();
                for &(x, corner) in &X_SQUARES {
                    if empties >= 20 && avail >> corner & 1 == 1 && avail >> x & 1 == 1 {
                        let (m, depth) = search_limited(&g, 3, Duration::from_secs(60));
                        assert_eq!(depth, 3, "search did not complete depth 3");
                        if m == x {
                            // Corner quiescence can see past the X-square's horizon: allow it only
                            // where a plain depth-7 search also rates it no worse than the corner.
                            let (xs, cs) = (root_score(&g, x, 7, false), root_score(&g, corner, 7, false));
                            assert!(xs >= cs, "played {} ({xs}) over its corner {} ({cs}): {moves:?}", square_name(x), square_name(corner));
                        }
                        checked += 1;
                    }
                }
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                let k = (seed >> 33) as u32 % avail.count_ones();
                let i = (0..64).filter(|i| avail >> i & 1 == 1).nth(k as usize).unwrap();
                moves.push(square_name(i));
            }
        }
        assert!(checked >= 5, "only {checked} midgame positions with a legal corner and its X-square");
    }

    #[test]
    fn search_handles_passes_and_terminal_positions() {
        // Black to move with no placement while White still has one: the search passes
        // inside the tree instead of treating it as the end.
        // Row 1: W B . . . . . . -> Black cannot move (no line ends in black), White plays c1.
        let g = Game::new(1 << 1, 1 << 0).unwrap(); // mover = Black on b1, opponent White on a1
        assert_eq!(g.available_moves(), 0);
        let mut p = g.clone();
        p.pass_move();
        assert_ne!(p.available_moves(), 0);
        let mut s = Search { start: Instant::now(), deadline: Duration::from_secs(5), nodes: 0, qnodes: 0, stopped: false, qsearch: true };
        // White plays c1 and wins 3-0: from Black's view the game is lost.
        assert!(s.negamax(&g, 4, -INF, INF) <= -WIN);
        // Neither side can move: scored by disc difference.
        let end = Game::new(0b111, 0).unwrap();
        assert_eq!(s.negamax(&end, 3, -INF, INF), WIN + 3);
    }

    #[test]
    fn never_exceeds_the_budget() {
        let mut moves = Vec::new();
        let mut seed: u64 = 99;
        for ply in 0..60 {
            let Some(g) = replay(&moves) else { break };
            let avail = g.available_moves();
            let mut o = g.clone();
            o.pass_move();
            if avail == 0 && o.available_moves() == 0 {
                break;
            }
            if ply % 6 == 0 {
                let t = Instant::now();
                let (reply, _) = handle("go 200", &mut moves.clone());
                assert!(reply.unwrap().starts_with("bestmove "));
                assert!(t.elapsed() < Duration::from_millis(200), "ply {ply}: {:?}", t.elapsed());
            }
            if avail == 0 {
                moves.push("pass".into());
                continue;
            }
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            let k = (seed >> 33) as u32 % avail.count_ones();
            let i = (0..64).filter(|i| avail >> i & 1 == 1).nth(k as usize).unwrap();
            moves.push(square_name(i));
        }
    }

    #[test]
    fn legal_moves_for_both_colours_under_search() {
        // Self-play with the real search: every move, Black's and White's, replays legally.
        let mut moves = Vec::new();
        let mut colours = [0, 0];
        for ply in 0..130 {
            let g = replay(&moves).unwrap();
            let mut o = g.clone();
            o.pass_move();
            if g.available_moves() == 0 && o.available_moves() == 0 {
                break;
            }
            let m = choose(&moves, 30).unwrap();
            if m != "pass" {
                colours[ply % 2] += 1;
            }
            moves.push(m);
            assert!(replay(&moves).is_some());
        }
        assert!(colours[0] > 5 && colours[1] > 5);
    }
}

