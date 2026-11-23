//! chess engine for Swarm Arena.
//! Rules: the `shakmaty` crate. Search and evaluation: written by the swarm.
//! Protocol and library policy: ../PROTOCOL.md.

use shakmaty::uci::UciMove;
use shakmaty::zobrist::Zobrist64;
use shakmaty::{Chess, EnPassantMode, Move, Position, Role};
use std::collections::HashSet;
use std::io::{self, BufRead, Write};

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

/// One-ply score of playing `m` in `pos`: mate first, then material won minus material left
/// hanging on the destination, plus small nudges toward checks and restricting the opponent.
fn score(pos: &Chess, m: Move, seen: &HashSet<u64>) -> i32 {
    let mut after = pos.clone();
    after.play_unchecked(m);
    if after.is_checkmate() {
        return 1_000_000;
    }
    let replies = after.legal_moves();
    if replies.is_empty() {
        return -50_000; // stalemate: throws away a won game against weak opponents
    }
    let mut s = m.capture().map_or(0, value);
    if let Some(p) = m.promotion() {
        s += value(p) - value(Role::Pawn);
    }
    // Hanging check: can the opponent take the moved piece on its new square?
    let mover = m.promotion().unwrap_or(m.role());
    if mover != Role::King {
        let board = after.board();
        let them = after.turn();
        let occ = board.occupied();
        let attackers = board.attacks_to(m.to(), them, occ);
        if attackers.any() {
            let defenders = board.attacks_to(m.to(), !them, occ);
            let cheapest = attackers
                .into_iter()
                .filter_map(|sq| board.role_at(sq))
                .map(value)
                .min()
                .unwrap_or(0);
            if defenders.is_empty() {
                s -= value(mover);
            } else if cheapest < value(mover) {
                s -= value(mover) - cheapest;
            }
        }
    }
    if after.is_check() {
        s += 30;
    }
    s -= 2 * replies.len() as i32;
    if m.role() == Role::Pawn {
        s += 5;
    }
    if seen.contains(&hash(&after)) {
        s -= 200;
    }
    s
}

/// Pick a move for the side to move, given the moves so far.
fn choose(moves: &[String], _budget_ms: u64) -> Option<String> {
    let (pos, seen) = replay(moves)?;
    let legal = pos.legal_moves();
    let salt = hash(&pos);
    legal
        .iter()
        .enumerate()
        .max_by_key(|(i, m)| {
            // Deterministic tie-break that varies by position, so equal moves do not shuffle.
            let noise = ((salt ^ (*i as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15)) >> 61) as i32;
            score(&pos, **m, &seen) * 8 + noise
        })
        .map(|(_, m)| UciMove::from_standard(*m).to_string())
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
            let mv = choose(moves, budget).unwrap_or_else(|| "0000".into());
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

    fn moves(s: &str) -> Vec<String> {
        s.split_whitespace().map(String::from).collect()
    }

    fn best(s: &str) -> String {
        let mut mv = Vec::new();
        handle(&format!("position {s}"), &mut mv);
        let reply = handle("go 100", &mut mv).0.unwrap();
        reply.strip_prefix("bestmove ").unwrap().to_string()
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
        assert!(handle("go 100", &mut mv).0.unwrap().starts_with("bestmove "));
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
