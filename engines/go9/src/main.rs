//! go9 engine for Swarm Arena.
//! Rules: the `goban` crate. Search and evaluation: written by the swarm.
//! Protocol and library policy: ../PROTOCOL.md.

use std::io::{self, BufRead, Write};

/// Pick a move for the side to move, given the moves so far.
/// Returns None until a move generator exists, which the referee scores as a forfeit.
fn choose(_moves: &[String], _budget_ms: u64) -> Option<String> {
    None
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
        assert_eq!(handle("game go9", &mut moves).0.as_deref(), Some("ready"));
        handle("position a b", &mut moves);
        assert_eq!(moves, vec!["a", "b"]);
        assert!(handle("go 100", &mut moves).0.unwrap().starts_with("bestmove "));
        assert!(handle("quit", &mut moves).1);
    }
}
