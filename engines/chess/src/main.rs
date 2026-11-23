//! chess engine for Swarm Arena.
//! Rules: the `shakmaty` crate. Search and evaluation: written by the swarm.
//! Protocol and library policy: ../PROTOCOL.md.

use shakmaty::uci::UciMove;
use shakmaty::zobrist::Zobrist64;
use shakmaty::{Chess, Color, EnPassantMode, Move, Position, Role};
use std::collections::HashSet;
use std::io::{self, BufRead, Write};
use std::time::{Duration, Instant};

fn value(role: Role) -> i32 {
    match role {
        Role::Pawn => 100,
        Role::Knight => 320,
        Role::Bishop => 330,
        Role::Rook => 500,
        Role::Queen => 900,
        Role::King => 0,
    }
}

fn hash(pos: &Chess) -> u64 {
    pos.zobrist_hash::<Zobrist64>(EnPassantMode::Legal).0
}

/// Replays the referee's UCI moves from the initial position. Returns the position and the
/// hashes of every position seen (for repetition avoidance), or None on an unparsable move.
fn replay(moves: &[String]) -> Option<(Chess, HashSet<u64>)> {
    let mut pos = Chess::default();
    let mut seen = HashSet::new();
    seen.insert(hash(&pos));
    for s in moves {
        let m = s.parse::<UciMove>().ok()?.to_move(&pos).ok()?;
        pos.play_unchecked(m);
        seen.insert(hash(&pos));
    }
    Some((pos, seen))
}

const MATE: i32 = 1_000_000;
const INF: i32 = 2_000_000;
/// Scores above this are forced mates (mate is scored MATE - plies, so shorter mates win).
const MATE_BOUND: i32 = MATE - 1_000;
/// Draws (repetition, stalemate, fifty moves, dead material) cost the engine this much: it plays
/// weaker opponents, so a draw is usually a half point thrown away.
const CONTEMPT: i32 = 50;
const MAX_DEPTH: u32 = 64;

/// Distance-to-centre score of a square, 0 (corner) to 14 (the four centre squares).
fn centrality(file: i32, rank: i32) -> i32 {
    (7 - (2 * file - 7).abs()) + (7 - (2 * rank - 7).abs())
}

/// Piece-square bonus for a piece of `role` on (file, rank), rank seen from its owner's side.
/// Returns (middlegame, endgame). Formula-built rather than tabulated, so the shape is legible.
fn placement(role: Role, file: i32, rank: i32) -> (i32, i32) {
    let c = centrality(file, rank);
    match role {
        Role::Pawn => {
            let advance = 6 * (rank - 1);
            let centre = if (3..=4).contains(&file) { [0, -8, 4, 14, 16, 10, 0, 0][rank as usize] } else { 0 };
            (advance + centre, 2 * advance)
        }
        Role::Knight => (3 * c - 21, 2 * c - 14),
        Role::Bishop => (2 * c - 12 + if rank == 0 { -6 } else { 0 }, c - 7),
        Role::Rook => {
            let seventh = if rank == 6 { 16 } else { 0 };
            let central = if (2..=5).contains(&file) && rank == 0 { 4 } else { 0 };
            (seventh + central, seventh / 2)
        }
        Role::Queen => (c - 7 + if rank == 0 { 0 } else { -2 }, 2 * c - 14),
        Role::King => {
            let shelter = if rank == 0 {
                if matches!(file, 0..=2 | 6 | 7) { 18 } else { 0 }
            } else {
                -14 * rank
            };
            (shelter, 4 * c - 28)
        }
    }
}

/// Static evaluation from the side to move's point of view: material, tapered placement, and a
/// bishop-pair bonus.
fn evaluate(pos: &Chess) -> i32 {
    let board = pos.board();
    let (mut mg, mut eg, mut phase) = (0i32, 0i32, 0i32);
    let mut bishops = [0; 2];
    for (sq, piece) in board.iter() {
        let sign = if piece.color == Color::White { 1 } else { -1 };
        let file = sq.file().to_usize() as i32;
        let raw = sq.rank().to_usize() as i32;
        let rank = if piece.color == Color::White { raw } else { 7 - raw };
        let (pm, pe) = placement(piece.role, file, rank);
        let v = value(piece.role);
        mg += sign * (v + pm);
        eg += sign * (v + pe);
        phase += match piece.role {
            Role::Knight | Role::Bishop => 1,
            Role::Rook => 2,
            Role::Queen => 4,
            _ => 0,
        };
        if piece.role == Role::Bishop {
            bishops[piece.color as usize] += 1;
        }
    }
    let phase = phase.min(24);
    let mut s = (mg * phase + eg * (24 - phase)) / 24;
    if bishops[Color::White as usize] >= 2 {
        s += 30;
    }
    if bishops[Color::Black as usize] >= 2 {
        s -= 30;
    }
    if pos.turn() == Color::White {
        s
    } else {
        -s
    }
}

/// Ordering key: the previous iteration's best move first, then captures by MVV-LVA (most
/// valuable victim, cheapest attacker), then promotions, then quiet moves.
fn order_key(m: &Move, best: Option<Move>) -> i32 {
    if Some(*m) == best {
        return i32::MAX;
    }
    let mut k = 0;
    if let Some(victim) = m.capture() {
        k += 1_000_000 + 16 * value(victim) - value(m.role()) / 10;
    }
    if let Some(p) = m.promotion() {
        k += 500_000 + value(p);
    }
    k
}

struct Search<'a> {
    seen: &'a HashSet<u64>,
    path: Vec<u64>,
    root_turn: Color,
    deadline: Instant,
    nodes: u64,
    stopped: bool,
}

impl Search<'_> {
    fn draw(&self, turn: Color) -> i32 {
        if turn == self.root_turn {
            -CONTEMPT
        } else {
            CONTEMPT
        }
    }

    fn out_of_time(&mut self) -> bool {
        if !self.stopped && self.nodes & 1023 == 0 && Instant::now() >= self.deadline {
            self.stopped = true;
        }
        self.stopped
    }

    /// Negamax alpha-beta. Scores are from the side to move's point of view.
    fn negamax(&mut self, pos: &Chess, depth: u32, ply: i32, mut alpha: i32, beta: i32) -> i32 {
        self.nodes += 1;
        if self.out_of_time() {
            return 0;
        }
        let h = hash(pos);
        if self.seen.contains(&h) || self.path.contains(&h) {
            return self.draw(pos.turn());
        }
        let mut moves = pos.legal_moves();
        if moves.is_empty() {
            return if pos.is_check() { -(MATE - ply) } else { self.draw(pos.turn()) };
        }
        if pos.halfmoves() >= 100 || pos.is_insufficient_material() {
            return self.draw(pos.turn());
        }
        if depth == 0 {
            return evaluate(pos);
        }
        moves.sort_unstable_by_key(|m| -order_key(m, None));
        self.path.push(h);
        let mut best = -INF;
        for m in &moves {
            let mut child = pos.clone();
            child.play_unchecked(*m);
            let s = -self.negamax(&child, depth - 1, ply + 1, -beta, -alpha);
            if self.stopped {
                break;
            }
            if s > best {
                best = s;
                if s > alpha {
                    alpha = s;
                    if alpha >= beta {
                        break;
                    }
                }
            }
        }
        self.path.pop();
        best
    }

    /// One full-width iteration at the root. Returns the best move and its score, or None if the
    /// clock ran out before the iteration finished.
    fn root(&mut self, pos: &Chess, moves: &[Move], depth: u32) -> Option<(Move, i32)> {
        let mut alpha = -INF;
        let mut best = None;
        self.path.push(hash(pos));
        for m in moves {
            let mut child = pos.clone();
            child.play_unchecked(*m);
            let s = -self.negamax(&child, depth - 1, 1, -INF, -alpha);
            if self.stopped {
                break;
            }
            if s > alpha {
                alpha = s;
                best = Some((*m, s));
            }
        }
        self.path.pop();
        if self.stopped {
            None
        } else {
            best
        }
    }
}

/// Result of a search: the move to play, its score, and the deepest completed depth.
struct Outcome {
    best: Move,
    score: i32,
    depth: u32,
}

/// Iterative deepening: depth 1, 2, 3, ... until the clock says stop. Always returns the best move
/// of the last completed depth. Stops searching by 60% of the budget, and does not start a depth it
/// is unlikely to finish.
fn search(pos: &Chess, seen: &HashSet<u64>, budget_ms: u64) -> Option<Outcome> {
    let start = Instant::now();
    let mut moves: Vec<Move> = pos.legal_moves().into_iter().collect();
    moves.sort_by_key(|m| -order_key(m, None));
    let first = *moves.first()?;
    let mut out = Outcome { best: first, score: 0, depth: 0 };
    if moves.len() == 1 {
        return Some(out);
    }
    let hard = Duration::from_millis(budget_ms * 6 / 10);
    let soft = Duration::from_millis(budget_ms * 3 / 10);
    let mut s = Search {
        seen,
        path: Vec::with_capacity(MAX_DEPTH as usize + 1),
        root_turn: pos.turn(),
        deadline: start + hard,
        nodes: 0,
        stopped: false,
    };
    for depth in 1..=MAX_DEPTH {
        let Some((m, score)) = s.root(pos, &moves, depth) else { break };
        out = Outcome { best: m, score, depth };
        // Best move first for the next iteration.
        if let Some(i) = moves.iter().position(|x| *x == m) {
            moves[..=i].rotate_right(1);
        }
        if score.abs() > MATE_BOUND || start.elapsed() >= soft {
            break;
        }
    }
    Some(out)
}

/// Pick a move for the side to move, given the moves so far (used by the self-play test).
#[cfg(test)]
fn choose(moves: &[String], budget_ms: u64) -> Option<String> {
    let (pos, seen) = replay(moves)?;
    let out = search(&pos, &seen, budget_ms)?;
    Some(UciMove::from_standard(out.best).to_string())
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
            let reply = match replay(moves).and_then(|(pos, seen)| search(&pos, &seen, budget)) {
                Some(o) => format!(
                    "info depth {} score {}\nbestmove {}",
                    o.depth,
                    o.score,
                    UciMove::from_standard(o.best)
                ),
                None => "bestmove 0000".into(),
            };
            (Some(reply), false)
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

    fn moves(s: &str) -> Vec<String> {
        s.split_whitespace().map(String::from).collect()
    }

    fn best(s: &str) -> String {
        let mut mv = Vec::new();
        handle(&format!("position {s}"), &mut mv);
        let reply = handle("go 100", &mut mv).0.unwrap();
        let last = reply.lines().last().unwrap();
        last.strip_prefix("bestmove ").unwrap().to_string()
    }

    fn is_legal_after(s: &str, uci: &str) -> bool {
        let (pos, _) = replay(&moves(s)).unwrap();
        uci.parse::<UciMove>()
            .ok()
            .and_then(|u| u.to_move(&pos).ok())
            .is_some()
    }

    #[test]
    fn handshake_and_position() {
        let mut mv = Vec::new();
        assert_eq!(handle("game chess", &mut mv).0.as_deref(), Some("ready"));
        handle("position e2e4 e7e5", &mut mv);
        assert_eq!(mv, vec!["e2e4", "e7e5"]);
        assert!(handle("go 100", &mut mv).0.unwrap().lines().any(|l| l.starts_with("bestmove ")));
        assert!(handle("quit", &mut mv).1);
    }

    #[test]
    fn opening_move_is_legal() {
        let m = best("");
        assert!(is_legal_after("", &m), "{m}");
    }

    #[test]
    fn castling_prints_king_move() {
        // White can castle kingside; the referee expects e1g1, never e1h1.
        let s = "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6";
        let (pos, _) = replay(&moves(s)).unwrap();
        let castles: Vec<String> = pos
            .legal_moves()
            .iter()
            .filter(|m| m.is_castle())
            .map(|m| UciMove::from_standard(*m).to_string())
            .collect();
        assert_eq!(castles, vec!["e1g1"]);
        // Parsing castling from the referee works too.
        assert!(replay(&moves(&format!("{s} e1g1"))).is_some());
    }

    #[test]
    fn promotion_has_suffix_and_is_preferred() {
        // White pawn walks to a7 while black shuffles; b8 knight captured on the way.
        let s = "a2a4 h7h6 a4a5 h6h5 a5a6 g7g6 a6b7 g6g5";
        let m = best(s);
        assert!(m == "b7a8q" || m == "b7c8q", "{m}");
        assert!(is_legal_after(s, &m));
    }

    #[test]
    fn en_passant_is_found_and_parsed() {
        let s = "e2e4 a7a6 e4e5 d7d5";
        let (pos, _) = replay(&moves(s)).unwrap();
        let ep: Vec<String> = pos
            .legal_moves()
            .iter()
            .filter(|m| m.is_en_passant())
            .map(|m| UciMove::from_standard(*m).to_string())
            .collect();
        assert_eq!(ep, vec!["e5d6"]);
        assert!(replay(&moves(&format!("{s} e5d6"))).is_some());
    }

    #[test]
    fn takes_mate_in_one() {
        // Scholar's mate setup: Qxf7#.
        assert_eq!(best("e2e4 e7e5 d1h5 b8c6 f1c4 g8f6"), "h5f7");
    }

    #[test]
    fn terminal_position_does_not_panic() {
        // Fool's mate: white is checkmated, no legal move.
        assert_eq!(best("f2f3 e7e5 g2g4 d8h4"), "0000");
    }

    fn from_fen(fen: &str) -> Chess {
        let f: shakmaty::fen::Fen = fen.parse().unwrap();
        f.into_position(shakmaty::CastlingMode::Standard).unwrap()
    }

    #[test]
    fn legal_from_assorted_positions() {
        let fens = [
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
            "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
            "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
            "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2",
            "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
            "8/P6k/8/8/8/8/6pK/8 b - - 0 1",
            "4k3/4r3/8/8/8/8/3PPP2/4K3 w - - 0 1",
        ];
        for fen in fens {
            let pos = from_fen(fen);
            let out = search(&pos, &HashSet::new(), 100).unwrap();
            assert!(pos.is_legal(out.best), "{fen}: {:?}", out.best);
        }
    }

    #[test]
    fn finds_mate_in_two() {
        // Rook ladder: Ra7 (or Rb7) then the other rook mates on the back rank.
        let pos = from_fen("7k/8/8/8/8/8/1R6/R1K5 w - - 0 1");
        let out = search(&pos, &HashSet::new(), 1000).unwrap();
        assert_eq!(out.score, MATE - 3, "{:?}", out.best);
        let mut after = pos.clone();
        after.play_unchecked(out.best);
        assert!(!after.is_checkmate());
        // Every defence loses to a mate in one.
        for reply in after.legal_moves() {
            let mut p = after.clone();
            p.play_unchecked(reply);
            let o = search(&p, &HashSet::new(), 500).unwrap();
            assert_eq!(o.score, MATE - 1);
        }
    }

    #[test]
    fn prefers_shorter_mate() {
        // Qg7# mates at once; the score must say mate in one, not a longer mate.
        let pos = from_fen("7k/8/5KQ1/8/8/8/8/8 w - - 0 1");
        let out = search(&pos, &HashSet::new(), 500).unwrap();
        assert_eq!(out.score, MATE - 1, "{:?}", out.best);
    }

    #[test]
    fn stays_inside_budget_in_busy_middlegame() {
        let pos = from_fen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
        for budget in [50u64, 200, 500] {
            let t = Instant::now();
            let out = search(&pos, &HashSet::new(), budget).unwrap();
            let ms = t.elapsed().as_millis() as u64;
            assert!(ms < budget, "{ms} ms for a {budget} ms budget");
            assert!(out.depth >= 2, "depth {} at {budget} ms", out.depth);
        }
    }

    #[test]
    fn avoids_stalemating_a_lone_king() {
        // Qf7 or Qg6 would stalemate; with a queen up the engine must keep the game going.
        let pos = from_fen("7k/8/6K1/8/8/8/8/5Q2 w - - 0 1");
        let out = search(&pos, &HashSet::new(), 300).unwrap();
        let mut after = pos.clone();
        after.play_unchecked(out.best);
        assert!(!after.legal_moves().is_empty() || after.is_checkmate());
    }

    #[test]
    fn random_games_stay_legal() {
        // Self-play many plies with the engine; every move must parse back as legal.
        let mut hist: Vec<String> = Vec::new();
        for _ in 0..200 {
            let (pos, _) = replay(&hist).unwrap();
            if pos.is_game_over() {
                break;
            }
            let m = choose(&hist, 100).unwrap();
            assert!(is_legal_after(&hist.join(" "), &m), "{m} after {hist:?}");
            hist.push(m);
        }
    }
}
