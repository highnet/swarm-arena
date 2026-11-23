//! othello engine for Swarm Arena.
//! Rules: the `othello` crate. Search and evaluation: written by the swarm.
//! Protocol and library policy: ../PROTOCOL.md.

use othello::Game;
use std::io::{self, BufRead, Write};

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

/// Greedy choice: a corner if one is legal, else the move maximising
/// (own mobility - opponent mobility) after it. Passes only with no placement.
fn choose(moves: &[String], _budget_ms: u64) -> Option<String> {
    let g = replay(moves)?;
    let avail = g.available_moves();
    if avail == 0 {
        return Some("pass".into());
    }
    let pool = if avail & CORNERS != 0 { avail & CORNERS } else { avail };
    let mut best: Option<(i32, usize)> = None;
    for i in (0..64).filter(|i| pool >> i & 1 == 1) {
        let next = g.make_move(i)?; // side to move is now the opponent
        let theirs = next.available_moves().count_ones() as i32;
        let mut back = next.clone();
        back.pass_move();
        let mine = back.available_moves().count_ones() as i32;
        let score = mine - theirs;
        if best.map_or(true, |(s, _)| score > s) {
            best = Some((score, i));
        }
    }
    best.map(|(_, i)| square_name(i))
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
                    assert_eq!(choose(&moves, 50).unwrap(), "pass");
                    found += 1;
                    moves.push("pass".into());
                    continue;
                }
                assert_ne!(choose(&moves, 50).unwrap(), "pass");
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

    #[test]
    fn prefers_corners() {
        // Any position where a corner is legal must return a corner.
        let mut moves = Vec::new();
        for _ in 0..130 {
            let g = replay(&moves).unwrap();
            if g.available_moves() & CORNERS != 0 {
                let c = parse_square(&choose(&moves, 50).unwrap()).unwrap();
                assert!(CORNERS >> c & 1 == 1);
            }
            match choose(&moves, 50) {
                Some(m) => moves.push(m),
                None => break,
            }
            if replay(&moves).map_or(true, |g| { let mut o = g.clone(); o.pass_move(); g.available_moves() == 0 && o.available_moves() == 0 }) { break; }
        }
    }
}
