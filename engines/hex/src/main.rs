//! hex engine for Swarm Arena.
//! Rules: the `hexgame` crate. Search and evaluation: written by the swarm.
//! Protocol and library policy: ../PROTOCOL.md.
//!
//! Orientation. The referee plays 11×11 Hex with `a1` top-left, columns `a`–`k` left to right,
//! rows `1`–`11` top to bottom, Black first joining top to bottom, White joining left to right,
//! no swap. `hexgame` uses the same convention: `Coords { row, column }` zero-based from the top
//! left, Black owns `Edge::Top`/`Edge::Bottom`, and its six neighbours of (r, c) are
//! (r, c±1), (r-1, c), (r-1, c+1), (r+1, c), (r+1, c-1) — exactly the referee's. The mapping is
//! therefore column letter ↔ `column`, row number − 1 ↔ `row`; `to_coords`/`to_move` below do it
//! explicitly (rather than trusting the library's string parser) and the tests pin it down.

use hexgame::{Board, Color, Coords, Edge, Game, Status};
use std::io::{self, BufRead, Write};

/// Board size used by the referee.
const N: u8 = 11;

/// The six neighbour offsets (row, column) shared by the referee and `hexgame`.
const NEIGHBOURS: [(i8, i8); 6] = [(-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0)];

/// Bridge offsets: (target, carrier a, carrier b). Two stones at a bridge distance are virtually
/// connected while both carrier cells are empty.
/// A (row, column) step.
type Step = (i8, i8);

const BRIDGES: [(Step, Step, Step); 6] = [
    ((-2, 1), (-1, 0), (-1, 1)),
    ((-1, 2), (-1, 1), (0, 1)),
    ((1, 1), (0, 1), (1, 0)),
    ((2, -1), (1, -1), (1, 0)),
    ((1, -2), (0, -1), (1, -1)),
    ((-1, -1), (-1, 0), (0, -1)),
];

/// Parse a referee move (`a1`..`k11`) into `hexgame` coordinates.
fn to_coords(mv: &str) -> Option<Coords> {
    let mut chars = mv.chars();
    let col = chars.next()?;
    if !col.is_ascii_lowercase() {
        return None;
    }
    let column = col as u8 - b'a';
    let rest = chars.as_str();
    if rest.is_empty() || rest.len() > 2 || !rest.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let row: u8 = rest.parse().ok()?;
    if column >= N || row == 0 || row > N {
        return None;
    }
    Some(Coords::new(row - 1, column))
}

/// Format `hexgame` coordinates as a referee move.
fn to_move(c: Coords) -> String {
    format!("{}{}", (b'a' + c.column) as char, c.row + 1)
}

/// Replay the referee's moves into a `hexgame` game. Stops at the first move it cannot apply.
fn replay(moves: &[String]) -> Game {
    let mut game = Game::new(N);
    for mv in moves {
        let Some(c) = to_coords(mv) else { break };
        if game.play(c).is_err() {
            break;
        }
    }
    game
}

/// The two edges a colour must join.
fn edges(color: Color) -> (Edge, Edge) {
    match color {
        Color::Black => (Edge::Top, Edge::Bottom),
        Color::White => (Edge::Left, Edge::Right),
    }
}

/// Has `color` joined its edges on `board`?
fn has_won(board: &Board, color: Color) -> bool {
    let (a, b) = edges(color);
    board.is_in_same_set(a, b)
}

/// Would `color` win at once by playing `c`?
fn wins_with(board: &Board, c: Coords, color: Color) -> bool {
    let mut b = board.clone();
    b.play(c, color).is_ok() && has_won(&b, color)
}

fn offset(c: Coords, (dr, dc): Step) -> Option<Coords> {
    let r = c.row as i8 + dr;
    let k = c.column as i8 + dc;
    let on = |x: i8| (0..N as i8).contains(&x);
    (on(r) && on(k)).then(|| Coords::new(r as u8, k as u8))
}

/// Hex distance from the centre cell (5, 5).
fn centre_distance(c: Coords) -> i32 {
    let dr = c.row as i32 - (N as i32 / 2);
    let dc = c.column as i32 - (N as i32 / 2);
    (dr.abs() + dc.abs() + (dr + dc).abs()) / 2
}

/// Heuristic score of `color` playing on the empty cell `c`: near the centre, touching or
/// bridging to its own stones, and pressing against the opponent's.
fn score(board: &Board, c: Coords, color: Color) -> i32 {
    let mut s = 20 - 3 * centre_distance(c);
    for d in NEIGHBOURS {
        match offset(c, d).and_then(|n| board.get_color(n)) {
            Some(x) if x == color => s += 4,
            Some(_) => s += 2,
            None => {}
        }
    }
    for (t, a, b) in BRIDGES {
        let (Some(t), Some(a), Some(b)) = (offset(c, t), offset(c, a), offset(c, b)) else {
            continue;
        };
        if board.get_color(t) == Some(color)
            && board.get_color(a).is_none()
            && board.get_color(b).is_none()
        {
            s += 5;
        }
    }
    s
}

/// Pick a move for the side to move, given the moves so far.
fn choose(moves: &[String], _budget_ms: u64) -> Option<String> {
    let game = replay(moves);
    let Status::Ongoing(me) = game.get_status() else {
        return None;
    };
    let board = game.get_board();
    let empty = board.get_empty_cells();
    if empty.is_empty() {
        return None;
    }
    if let Some(&c) = empty.iter().find(|&&c| wins_with(board, c, me)) {
        return Some(to_move(c));
    }
    let opp = me.opponent_color();
    if let Some(&c) = empty.iter().find(|&&c| wins_with(board, c, opp)) {
        return Some(to_move(c));
    }
    // Deterministic tie-break that varies with the position, so equal cells do not always
    // resolve to the top-left one.
    let salt = moves.len() as u32;
    let best = empty.iter().copied().max_by_key(|&c| {
        let i = c.row as u32 * N as u32 + c.column as u32;
        (
            score(board, c, me),
            (i.wrapping_mul(2654435761) ^ salt.wrapping_mul(40503)) & 0xff,
        )
    })?;
    Some(to_move(best))
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

    /// The referee's cell index (row * 11 + column) for a move, computed as hex.ts does.
    fn referee_index(m: &str) -> usize {
        let col = "abcdefghijk".find(m.chars().next().unwrap()).unwrap();
        let row: usize = m[1..].parse().unwrap();
        (row - 1) * 11 + col
    }

    #[test]
    fn handshake_and_position() {
        let mut moves = Vec::new();
        assert_eq!(handle("game hex", &mut moves).0.as_deref(), Some("ready"));
        handle("position a1 b2", &mut moves);
        assert_eq!(moves, vec!["a1", "b2"]);
        assert!(handle("go 100", &mut moves)
            .0
            .unwrap()
            .starts_with("bestmove "));
        assert!(handle("quit", &mut moves).1);
    }

    #[test]
    fn coordinates_round_trip_all_cells() {
        for row in 0..N {
            for column in 0..N {
                let c = Coords::new(row, column);
                let m = to_move(c);
                assert_eq!(to_coords(&m), Some(c), "{m}");
                assert_eq!(referee_index(&m), row as usize * 11 + column as usize);
                // Agrees with the library's own "c4" formatting.
                assert_eq!(m, c.to_string());
            }
        }
        assert_eq!(to_coords("a1"), Some(Coords::new(0, 0)));
        assert_eq!(to_coords("k1"), Some(Coords::new(0, 10)));
        assert_eq!(to_coords("a11"), Some(Coords::new(10, 0)));
        assert_eq!(to_coords("f6"), Some(Coords::new(5, 5)));
        for bad in ["", "a", "a0", "a12", "l1", "A1", "a1x", "1a", "pass"] {
            assert_eq!(to_coords(bad), None, "{bad}");
        }
    }

    #[test]
    fn neighbours_match_the_library() {
        let board = Board::new(N);
        for row in 0..N {
            for column in 0..N {
                let c = Coords::new(row, column);
                let mut ours: Vec<Coords> =
                    NEIGHBOURS.iter().filter_map(|&d| offset(c, d)).collect();
                let mut lib: Vec<Coords> = board
                    .get_neighbors(c)
                    .filter_map(|n| match n {
                        hexgame::CoordsOrEdge::Coords(x) => Some(x),
                        _ => None,
                    })
                    .collect();
                ours.sort_by_key(|x| (x.row, x.column));
                lib.sort_by_key(|x| (x.row, x.column));
                assert_eq!(ours, lib, "{c}");
            }
        }
    }

    /// Black fills column a top to bottom (a1..a11); White plays elsewhere. Black has joined
    /// top to bottom, the referee's Black goal.
    #[test]
    fn black_wins_top_to_bottom() {
        let mut moves = Vec::new();
        for r in 1..=11 {
            moves.push(format!("a{r}"));
            if r < 11 {
                moves.push(format!("k{r}"));
            }
        }
        let game = replay(&moves);
        assert_eq!(game.get_status(), Status::Finished(Color::Black));
        assert_eq!(moves.len(), 21);
    }

    /// White fills row 1 left to right; Black plays on row 11 without connecting. White has
    /// joined left to right, the referee's White goal.
    #[test]
    fn white_wins_left_to_right() {
        let cols = "abcdefghijk".chars().collect::<Vec<_>>();
        let mut moves = Vec::new();
        for (i, c) in cols.iter().enumerate() {
            moves.push(format!("{}11", cols[i]));
            moves.push(format!("{c}1"));
        }
        let game = replay(&moves);
        assert_eq!(game.get_status(), Status::Finished(Color::White));
    }

    /// A Black row across the board is not a Black win (wrong edges).
    #[test]
    fn black_row_is_not_a_win() {
        let cols = "abcdefghijk".chars().collect::<Vec<_>>();
        let mut moves = Vec::new();
        for (i, c) in cols.iter().enumerate() {
            moves.push(format!("{c}6"));
            if i < 10 {
                // White on row 1, stopping short of a connection.
                moves.push(format!("{c}1"));
            }
        }
        let game = replay(&moves);
        assert!(matches!(game.get_status(), Status::Ongoing(_)));
    }

    #[test]
    fn takes_an_immediate_win() {
        // Black a1..a10, White k1..k10; Black to move wins at a11.
        let mut moves = Vec::new();
        for r in 1..=10 {
            moves.push(format!("a{r}"));
            moves.push(format!("k{r}"));
        }
        assert_eq!(choose(&moves, 100).as_deref(), Some("a11"));
    }

    #[test]
    fn blocks_an_immediate_loss() {
        // White a1..j1 (needs k1), Black scattered on row 11; Black to move must block k1.
        let cols = "abcdefghij".chars().collect::<Vec<_>>();
        let mut moves = Vec::new();
        for (i, c) in cols.iter().enumerate() {
            moves.push(format!("{}11", "abcdefghijk".chars().nth(i).unwrap()));
            moves.push(format!("{c}1"));
        }
        assert_eq!(choose(&moves, 100).as_deref(), Some("k1"));
    }

    #[test]
    fn opens_in_the_centre() {
        assert_eq!(choose(&[], 100).as_deref(), Some("f6"));
    }

    /// Self-play random-ish games to the end: every move chosen is legal and every game ends
    /// with a winner within 121 plies.
    #[test]
    fn plays_legal_moves_to_a_finish() {
        let mut moves: Vec<String> = Vec::new();
        loop {
            let game = replay(&moves);
            if let Status::Finished(_) = game.get_status() {
                break;
            }
            let m = choose(&moves, 50).expect("a move");
            let c = to_coords(&m).expect("parsable");
            assert!(game.get_board().get_color(c).is_none(), "occupied {m}");
            moves.push(m);
            assert!(moves.len() <= 121);
        }
    }
}
