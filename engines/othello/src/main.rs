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
/// Frontier: per own frontier disc, at a full board of empties (scaled down as it fills).
const FRONTIER_W: i32 = 6;
/// Edge-anchored stable disc: base weight plus (60 - empties) / 4, so it grows from 8 (opening)
/// to 23 (full board), always below a corner.
const STABLE_W: i32 = 8;
/// Terminal scores sit far above any heuristic score.
const WIN: i32 = 100_000;
const INF: i32 = 1_000_000;

const NOT_A: u64 = 0xfefe_fefe_fefe_fefe; // clears column a (bit 0 of each row)
const NOT_H: u64 = 0x7f7f_7f7f_7f7f_7f7f; // clears column h

/// Every square 8-adjacent to a square in `b`.
fn neighbours(b: u64) -> u64 {
    let ew = ((b << 1) & NOT_A) | ((b >> 1) & NOT_H);
    let row = b | ew;
    ew | (row << 8) | (row >> 8)
}

/// Frontier discs of `own`: discs with at least one empty 8-neighbour.
fn frontier(own: u64, empty: u64) -> u64 {
    own & neighbours(empty)
}

const ROWS_18: u64 = 0xff | 0xff << 56;
const COLS_AH: u64 = 0x8181_8181_8181_8181;
const EDGE_MASKS: [u64; 4] = [0xff, 0xff << 56, 0x0101_0101_0101_0101, 0x8080_8080_8080_8080];

/// Edge-anchored stable discs of `own`: from each owned corner, the contiguous run of `own`
/// discs along both of its edges; a completely filled edge is stable in full (an edge disc can
/// only be flipped along its edge, and a full edge has no empty square to flip from).
/// Bitboard flood: grow from the owned corners one edge step at a time.
fn edge_stable(own: u64, occupied: u64) -> u64 {
    let mut st = own & CORNERS;
    for &line in &EDGE_MASKS {
        if occupied & line == line {
            st |= own & line;
        }
    }
    if st == 0 {
        return 0;
    }
    let edge_own = own & (ROWS_18 | COLS_AH);
    loop {
        let along_rows = ((st << 1) & NOT_A | (st >> 1) & NOT_H) & ROWS_18;
        let along_cols = ((st << 8) | (st >> 8)) & COLS_AH;
        let next = st | (edge_own & (along_rows | along_cols));
        if next == st {
            return st;
        }
        st = next;
    }
}

/// Static evaluation from the side to move's point of view. Original terms: corner ownership,
/// mobility difference, a penalty for X/C-squares next to a still-empty corner, fewer frontier
/// discs (scaled down as the board fills), and edge-anchored stable discs (scaled up).
fn evaluate(g: &Game) -> i32 {
    let [me, opp] = g.get();
    let occupied = me | opp;
    let empty = !occupied;
    let empties = empty.count_ones() as i32;
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
    let fr = frontier(opp, empty).count_ones() as i32 - frontier(me, empty).count_ones() as i32;
    s += FRONTIER_W * fr * empties / 60;
    if occupied & CORNERS != 0 {
        let st = edge_stable(me, occupied).count_ones() as i32 - edge_stable(opp, occupied).count_ones() as i32;
        s += (STABLE_W + (60 - empties) / 4) * st;
    }
    s
}

/// Final score for the side to move once neither side can place: disc difference.
fn terminal(g: &Game) -> i32 {
    let [me, opp] = g.get();
    let d = me.count_ones() as i32 - opp.count_ones() as i32;
    d.signum() * WIN + d
}

struct Search {
    start: Instant,
    deadline: Duration,
    nodes: u64,
    stopped: bool,
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
                return evaluate(g);
            }
            return -self.negamax(&p, depth - 1, -beta, -alpha);
        }
        if depth == 0 {
            return evaluate(g);
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
    let (m, d, _) = search_counted(g, max_depth, deadline);
    (m, d)
}

/// `search_limited`, also returning the number of nodes searched.
fn search_counted(g: &Game, max_depth: u32, deadline: Duration) -> (usize, u32, u64) {
    let avail = g.available_moves();
    let order = ordered(avail, None);
    let mut best = order[0];
    if order.len() == 1 {
        return (best, 0, 0);
    }
    let mut s = Search {
        start: Instant::now(),
        deadline,
        nodes: 0,
        stopped: false,
    };
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
        done = depth;
        // A deeper iteration costs several times this one: do not start what cannot finish.
        if s.start.elapsed() * 3 >= s.deadline {
            break;
        }
    }
    (best, done, s.nodes)
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

    fn bits(sqs: &[&str]) -> u64 {
        sqs.iter().map(|m| 1u64 << parse_square(m).unwrap()).sum()
    }

    #[test]
    fn frontier_counts_discs_touching_an_empty_square() {
        // Opening: all four centre discs touch an empty square, for both colours.
        let [b, w] = Game::default().get();
        let empty = !(b | w);
        assert_eq!(frontier(b, empty).count_ones(), 2);
        assert_eq!(frontier(w, empty).count_ones(), 2);
        // A disc boxed in on every side is not frontier; its boxing discs are.
        let black = bits(&["d4"]);
        let white = bits(&["c3", "d3", "e3", "c4", "e4", "c5", "d5", "e5"]);
        let empty = !(black | white);
        assert_eq!(frontier(black, empty), 0);
        assert_eq!(frontier(white, empty), white);
        // No wrap across the a/h columns: h1 next to empty a2 (bit 8) only via a real neighbour.
        let full_but = !bits(&["a2"]);
        assert_eq!(frontier(bits(&["h1"]), !full_but), 0);
        assert_eq!(frontier(bits(&["a1", "b1", "b3"]), !full_but), bits(&["a1", "b1", "b3"]));
        assert_eq!(frontier(bits(&["h2", "h3"]), !full_but), 0);
    }

    #[test]
    fn edge_stability_grows_from_owned_corners() {
        // Each case is checked with the anchored side as the side to move and as the opponent.
        let check = |own: u64, other: u64, want_own: u64, want_other: u64, what: &str| {
            for (g, o) in [(Game::new(own, other).unwrap(), 0), (Game::new(other, own).unwrap(), 1)] {
                let b = g.get();
                let occ = b[0] | b[1];
                assert_eq!(edge_stable(b[o], occ), want_own, "{what} (own as side {o})");
                assert_eq!(edge_stable(b[1 - o], occ), want_other, "{what} (other as side {})", 1 - o);
            }
        };
        // A lone corner: just the corner.
        check(bits(&["h8"]), bits(&["d4", "e5"]), bits(&["h8"]), 0, "lone corner");
        // A corner plus a broken run: a1 b1 c1 own, d1 opponent, e1 own -> a1 b1 c1 only;
        // down column a: a1 a2 own, a3 empty -> a2 too. b2 is not on an edge.
        let own = bits(&["a1", "b1", "c1", "e1", "a2"]);
        check(own, bits(&["d1", "b2"]), bits(&["a1", "b1", "c1", "a2"]), 0, "broken run");
        // A full edge counts entirely for both sides, whoever owns its corners.
        let own = bits(&["b8", "c8", "f8", "g8"]);
        let other = bits(&["a8", "d8", "e8", "h8"]);
        check(own, other, own, other, "full edge");
        // Two corners on one edge: runs grow from both ends.
        let own = bits(&["a1", "b1", "g1", "h1"]);
        check(own, bits(&["d1"]), own, 0, "runs from both corners");
        // Through evaluate(): the side to move scores the stable discs for itself, and the same
        // position seen from the other side scores them against it.
        let own = bits(&["a1", "b1", "c1", "d1", "a2", "a3"]);
        let other = bits(&["e1", "b2", "c3"]);
        let g = Game::new(own, other).unwrap();
        let h = Game::new(other, own).unwrap();
        assert_eq!(evaluate(&g), -evaluate(&h), "evaluation is symmetric between colours");
        assert!(evaluate(&g) > 0);
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
                        assert_ne!(m, x, "played {} with its corner {} legal: {moves:?}", square_name(x), square_name(corner));
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
        let mut s = Search { start: Instant::now(), deadline: Duration::from_secs(5), nodes: 0, stopped: false };
        // White plays c1 and wins 3-0: from Black's view the game is lost.
        assert!(s.negamax(&g, 4, -INF, INF) <= -WIN);
        // Neither side can move: scored by disc difference.
        let end = Game::new(0b111, 0).unwrap();
        assert_eq!(s.negamax(&end, 3, -INF, INF), WIN + 3);
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
        // Depth reached at `go 200` (120 ms deadline; wall clock, so informational only), and
        // nodes and nodes per second at a fixed depth 7 (node counts deterministic).
        for band in [50u32, 40, 30, 20] {
            let ps: Vec<_> = report_positions().into_iter().filter(|p| p.0 == band).collect();
            let depths: Vec<u32> = ps.iter().map(|(_, g)| search_limited(g, u32::MAX, Duration::from_millis(120)).1).collect();
            let t = Instant::now();
            let n: u64 = ps.iter().map(|(_, g)| search_counted(g, 7, Duration::from_secs(600)).2).sum();
            let secs = t.elapsed().as_secs_f64();
            println!(
                "<={band} empties: go 200 depth {}-{} {:?}; depth 7 nodes {n}, {:.0} knps",
                depths.iter().min().unwrap(),
                depths.iter().max().unwrap(),
                depths,
                n as f64 / secs / 1000.0
            );
        }
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

