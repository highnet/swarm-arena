//! go9 engine for Swarm Arena.
//! Rules: the `goban` crate. Search and evaluation: written by the swarm.
//! Protocol and library policy: ../PROTOCOL.md.

use goban::pieces::goban::Goban;
use goban::pieces::stones::Color;
use goban::pieces::util::coord::Coord;
use goban::rules::game::Game;
use goban::rules::{GobanSizes, IllegalRules, Move, CHINESE};
use std::collections::HashSet;
use std::io::{self, BufRead, Write};
use std::time::{Duration, Instant};

mod board;
mod search;

use board::{Board, Rng};
use search::KOMI;

const N: usize = 9;
/// GTP columns: a–j without i.
const COLS: &[u8; 9] = b"abcdefghj";

/// Parse a GTP move into goban's (row, col), row 0 at the top (rank 9). None for pass.
fn parse_move(m: &str) -> Option<Option<Coord>> {
    if m.eq_ignore_ascii_case("pass") {
        return Some(None);
    }
    let b = m.as_bytes();
    if b.len() != 2 {
        return None;
    }
    let col = COLS.iter().position(|&c| c == b[0].to_ascii_lowercase())?;
    let rank = (b[1] as char).to_digit(10)? as usize;
    if !(1..=N).contains(&rank) {
        return None;
    }
    Some(Some(((N - rank) as u8, col as u8)))
}

fn format_move(c: Coord) -> String {
    format!("{}{}", COLS[c.1 as usize] as char, N - c.0 as usize)
}

/// The position under the referee's rules. `goban` plays the stones and captures; positional
/// superko is checked here against every board seen so far, because goban only checks
/// superko for capturing moves and skips the first plies.
struct Position {
    game: Game,
    /// Every board that has occurred, including the empty start.
    seen: HashSet<Goban>,
    passes: u32,
}

impl Position {
    fn new() -> Self {
        let game = Game::new(GobanSizes::Nine, CHINESE);
        let mut seen = HashSet::new();
        seen.insert(game.goban().clone());
        Position { game, seen, passes: 0 }
    }

    fn from_moves(moves: &[String]) -> Self {
        let mut p = Position::new();
        for m in moves {
            match parse_move(m) {
                Some(None) => p.pass(),
                Some(Some(c)) if p.game.goban().get_color(c).is_none() => p.play(c),
                _ => {} // Unparseable or occupied: the referee would not send it.
            }
        }
        p
    }

    fn turn(&self) -> Color {
        self.game.turn()
    }

    fn pass(&mut self) {
        if self.passes >= 2 {
            self.game.resume();
        }
        self.game.play(Move::Pass);
        self.passes += 1;
    }

    fn play(&mut self, c: Coord) {
        if self.passes >= 2 {
            self.game.resume();
        }
        self.game.play(Move::Play(c.0, c.1));
        self.seen.insert(self.game.goban().clone());
        self.passes = 0;
    }

    /// The board after the side to move plays `c`, or None when that is illegal
    /// (occupied, suicide, or a repeat of any earlier board).
    fn after(&self, c: Coord) -> Option<Goban> {
        if self.game.check_point_by(c, IllegalRules::SUICIDE).is_some() {
            return None;
        }
        let next = self.game.play_for_verification(c);
        if self.seen.contains(&next) {
            return None;
        }
        Some(next)
    }

    fn legal_moves(&self) -> Vec<Coord> {
        let mut out = Vec::new();
        for r in 0..N as u8 {
            for col in 0..N as u8 {
                if self.after((r, col)).is_some() {
                    out.push((r, col));
                }
            }
        }
        out
    }
}

fn cells(g: &Goban) -> Vec<Option<Color>> {
    let mut v = Vec::with_capacity(N * N);
    for r in 0..N as u8 {
        for c in 0..N as u8 {
            v.push(g.get_color((r, c)));
        }
    }
    v
}

fn neighbours(i: usize) -> impl Iterator<Item = usize> {
    let (r, c) = (i / N, i % N);
    [
        (r > 0).then(|| i - N),
        (r + 1 < N).then(|| i + N),
        (c > 0).then(|| i - 1),
        (c + 1 < N).then(|| i + 1),
    ]
    .into_iter()
    .flatten()
}

/// Tromp-Taylor area score, positive favours black (komi included).
fn area_score(cells: &[Option<Color>]) -> f32 {
    let mut score = -KOMI;
    let mut seen = [false; N * N];
    for i in 0..N * N {
        match cells[i] {
            Some(Color::Black) => score += 1.0,
            Some(Color::White) => score -= 1.0,
            None if !seen[i] => {
                let mut region = vec![i];
                seen[i] = true;
                let (mut b, mut w) = (false, false);
                let mut k = 0;
                while k < region.len() {
                    for n in neighbours(region[k]) {
                        match cells[n] {
                            Some(Color::Black) => b = true,
                            Some(Color::White) => w = true,
                            None if !seen[n] => {
                                seen[n] = true;
                                region.push(n);
                            }
                            None => {}
                        }
                    }
                    k += 1;
                }
                if b != w {
                    let size = region.len() as f32;
                    score += if b { size } else { -size };
                }
            }
            None => {}
        }
    }
    score
}

/// RNG seeded from the game record and the wall clock.
fn seeded_rng(moves: &[String]) -> Rng {
    let mut s: u64 = 0x9E37_79B9_7F4A_7C15;
    for m in moves {
        for b in m.bytes() {
            s = (s ^ b as u64).wrapping_mul(0x100_0000_01B3);
        }
    }
    if let Ok(d) = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        s ^= d.as_nanos() as u64;
    }
    Rng(s | 1)
}

fn colour_code(c: Color) -> u8 {
    if c == Color::Black {
        board::BLACK
    } else {
        board::WHITE
    }
}

/// The flat playout board for `pos`, same stones and side to move.
fn flat_board(pos: &Position) -> Board {
    let mut cellv = [board::EMPTY; board::NN];
    for (i, c) in cells(pos.game.goban()).into_iter().enumerate() {
        if let Some(c) = c {
            cellv[i] = colour_code(c);
        }
    }
    let mut b = Board::from_cells(&cellv, colour_code(pos.turn()));
    b.passes = pos.passes.min(1) as u8;
    b
}

/// Root moves: legal under goban and positional superko, and not the mover's own eye.
fn root_moves(pos: &Position, flat: &Board) -> Vec<u8> {
    pos.legal_moves()
        .into_iter()
        .map(|c| c.0 * N as u8 + c.1)
        .filter(|&p| !flat.is_eye(p, flat.to_move))
        .collect()
}

/// Pick a move for the side to move, given the moves so far.
/// Passes when the opponent just passed and the board already wins on area, or when no
/// non-eye legal move remains. Otherwise runs UCT until ~70% of the budget and plays the
/// most-visited root move.
fn choose(moves: &[String], budget_ms: u64) -> Option<String> {
    let start = Instant::now();
    let pos = Position::from_moves(moves);
    let me = pos.turn();
    let now = cells(pos.game.goban());

    if pos.passes >= 1 {
        let s = area_score(&now);
        let winning = if me == Color::Black { s > 0.0 } else { s < 0.0 };
        if winning {
            return Some("pass".into());
        }
    }

    let flat = flat_board(&pos);
    let legal = root_moves(&pos, &flat);
    if legal.is_empty() {
        return Some("pass".into());
    }
    if legal.len() == 1 {
        return Some(format_move(to_coord(legal[0])));
    }
    let mut rng = seeded_rng(moves);
    let deadline = start + Duration::from_millis(budget_ms * 7 / 10);
    let out = search::search(&flat, &legal, deadline, &mut rng);
    eprintln!("info playouts {} winrate {:.3}", out.playouts, out.winrate);
    Some(format_move(to_coord(out.best)))
}

fn to_coord(p: u8) -> Coord {
    (p / N as u8, p % N as u8)
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
            let mv = choose(moves, budget).unwrap_or_else(|| "pass".into());
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

    fn mv(s: &str) -> Vec<String> {
        s.split_whitespace().map(String::from).collect()
    }

    fn legal(p: &Position, m: &str) -> bool {
        let c = parse_move(m).unwrap().unwrap();
        p.after(c).is_some()
    }

    #[test]
    fn handshake_and_position() {
        let mut moves = Vec::new();
        assert_eq!(handle("game go9", &mut moves).0.as_deref(), Some("ready"));
        handle("position e5 c3", &mut moves);
        assert_eq!(moves, vec!["e5", "c3"]);
        let reply = handle("go 100", &mut moves).0.unwrap();
        let m = reply.strip_prefix("bestmove ").unwrap();
        assert!(m != "e5" && m != "c3" && parse_move(m).is_some());
        assert!(handle("quit", &mut moves).1);
    }

    #[test]
    fn coordinates_round_trip() {
        assert_eq!(parse_move("a9"), Some(Some((0, 0))));
        assert_eq!(parse_move("j1"), Some(Some((8, 8))));
        assert_eq!(parse_move("h5"), Some(Some((4, 7))));
        assert_eq!(parse_move("i5"), None);
        assert_eq!(parse_move("pass"), Some(None));
        for r in 0..9u8 {
            for c in 0..9u8 {
                assert_eq!(parse_move(&format_move((r, c))), Some(Some((r, c))));
            }
        }
    }

    #[test]
    fn suicide_is_rejected() {
        // White stones at b9 and a8 surround a9: black a9 is suicide.
        let p = Position::from_moves(&mv("e5 b9 e4 a8"));
        assert_eq!(p.turn(), Color::Black);
        assert!(!legal(&p, "a9"));
        assert!(!p.legal_moves().contains(&(0, 0)));
        // But it is legal for white (fills own point, not suicide).
        let p = Position::from_moves(&mv("e5 b9 e4 a8 e3"));
        assert!(legal(&p, "a9"));
    }

    #[test]
    fn capturing_into_no_liberties_is_not_suicide() {
        // Black b9, white a9 in the corner; black a8 takes its last liberty and captures.
        let p = Position::from_moves(&mv("b9 a9"));
        assert!(legal(&p, "a8")); // captures a9
        let mut p = p;
        p.play((1, 0));
        assert_eq!(p.game.goban().get_color((0, 0)), None);
    }

    /// Ko at d5/e5: black e5 captures d5; white retaking at once would repeat the board.
    #[test]
    fn simple_ko_is_rejected() {
        // Black: c5 d6 d4 ; White: e6 e4 f5 d5 ; then black e5 captures d5.
        let p = Position::from_moves(&mv("c5 e6 d6 e4 d4 f5 pass d5 e5"));
        assert_eq!(p.game.goban().get_color(parse_move("d5").unwrap().unwrap()), None);
        assert_eq!(p.turn(), Color::White);
        assert!(!legal(&p, "d5"), "immediate ko recapture must be illegal");
        // After a tenuki exchange the recapture is legal again.
        let p = Position::from_moves(&mv("c5 e6 d6 e4 d4 f5 pass d5 e5 a1 a9"));
        assert!(legal(&p, "d5"));
    }

    #[test]
    fn positional_superko_rejects_any_earlier_board() {
        // After the ko capture both sides pass; the recapture is no longer an immediate
        // ko but still recreates an earlier board, so positional superko forbids it.
        let p = Position::from_moves(&mv("c5 e6 d6 e4 d4 f5 pass d5 e5 pass pass"));
        assert_eq!(p.turn(), Color::White);
        assert!(!legal(&p, "d5"), "recapture after passes repeats an earlier board");
    }

    #[test]
    fn seen_boards_are_tracked() {
        let p = Position::from_moves(&mv("e5 e6 pass d5"));
        assert_eq!(p.seen.len(), 4); // empty, +e5, +e6, +d5; the pass adds no board
    }

    #[test]
    fn never_fills_own_eye_and_passes_when_nothing_left() {
        // Black fills the board except nine single-point eyes while white passes.
        let mut seq = Vec::new();
        for r in 0..9u8 {
            for c in 0..9u8 {
                if [1, 4, 7].contains(&r) && [1, 4, 7].contains(&c) {
                    continue;
                }
                seq.push(format_move((r, c)));
                seq.push("pass".to_string());
            }
        }
        let p = Position::from_moves(&seq);
        assert_eq!(p.turn(), Color::Black);
        assert_eq!(p.legal_moves().len(), 9, "filling an eye is legal, just bad");
        assert!(root_moves(&p, &flat_board(&p)).is_empty(), "must not fill own eyes");
        assert_eq!(choose(&seq, 100).unwrap(), "pass");
        // White may play into black's eyes? Each is suicide for white.
        let mut w = seq.clone();
        w.push("pass".into());
        assert!(Position::from_moves(&w).legal_moves().is_empty());
    }

    #[test]
    fn area_score_counts_komi() {
        let empty = vec![None; N * N];
        assert_eq!(area_score(&empty), -KOMI);
        let mut one = empty.clone();
        one[40] = Some(Color::Black);
        assert_eq!(area_score(&one), 81.0 - KOMI);
    }

    /// Self-play at the gate's 200 ms: every chosen move must be legal under goban and the
    /// seen-board set, and every reply must come in time.
    #[test]
    fn self_play_at_200ms_stays_legal() {
        for game in 0..20 {
            let mut moves: Vec<String> = Vec::new();
            for _ in 0..200 {
                let t = Instant::now();
                let m = choose(&moves, 200).unwrap();
                assert!(t.elapsed() < Duration::from_millis(200), "game {game}: slow reply");
                let p = Position::from_moves(&moves);
                if m != "pass" {
                    assert!(legal(&p, &m), "game {game}: illegal {m} after {moves:?}");
                }
                moves.push(m);
                let n = moves.len();
                if n >= 2 && moves[n - 1] == "pass" && moves[n - 2] == "pass" {
                    break;
                }
            }
        }
    }

    /// Random games (eye-filling allowed, so groups die and kos appear) played on goban and the
    /// flat board side by side: the stones agree after every move, and the flat board's
    /// legality differs from goban's only where positional superko forbids a move.
    #[test]
    fn flat_board_agrees_with_goban() {
        let mut rng = Rng(0x1234_5678_9abc_def1);
        let (mut kos, mut captures) = (0, 0);
        for game in 0..40 {
            let mut pos = Position::new();
            let mut flat = Board::empty(board::BLACK);
            for ply in 0..300 {
                // Legality agrees.
                let mut legal = Vec::new();
                for p in 0..board::NN as u8 {
                    let c = to_coord(p);
                    let oracle = pos.after(c).is_some();
                    let fast = flat.is_legal(p);
                    if oracle {
                        assert!(fast, "game {game} ply {ply}: flat rejects legal {}", format_move(c));
                        legal.push(p);
                    } else if fast {
                        // Only superko may forbid what the flat board allows.
                        assert!(
                            pos.game.check_point_by(c, IllegalRules::SUICIDE).is_none(),
                            "game {game} ply {ply}: flat allows {}",
                            format_move(c)
                        );
                    }
                }
                if flat.ko != board::PASS {
                    kos += 1;
                }
                if legal.is_empty() || rng.below(40) == 0 {
                    pos.pass();
                    flat.play(board::PASS);
                    if pos.passes >= 2 {
                        break;
                    }
                    continue;
                }
                let p = legal[rng.below(legal.len())];
                let before = flat.cell.iter().filter(|&&c| c != board::EMPTY).count();
                pos.play(to_coord(p));
                flat.play(p);
                flat.check_invariants();
                let after = flat.cell.iter().filter(|&&c| c != board::EMPTY).count();
                if after <= before {
                    captures += 1;
                }
                let g: Vec<u8> = cells(pos.game.goban()).into_iter().map(|c| c.map_or(board::EMPTY, colour_code)).collect();
                assert_eq!(&g[..], &flat.cell[..], "game {game} ply {ply}: boards differ");
                assert_eq!(flat.to_move, colour_code(pos.turn()));
            }
        }
        assert!(kos > 10 && captures > 100, "too few kos ({kos}) or captures ({captures}) tested");
    }

    #[test]
    fn flat_board_rules() {
        // Suicide: white b9 a8 around a9.
        let f = flat_board(&Position::from_moves(&mv("e5 b9 e4 a8")));
        assert!(!f.is_legal(0));
        // Capture into no liberties is legal: black b9, white a9, black a8 captures.
        let mut f = flat_board(&Position::from_moves(&mv("b9 a9")));
        assert!(f.is_legal(9));
        f.play(9);
        assert_eq!(f.cell[0], board::EMPTY);
        // Simple ko: black e5 captures d5; white may not retake at once.
        let mut f = flat_board(&Position::from_moves(&mv("c5 e6 d6 e4 d4 f5 pass d5")));
        let (d5, e5) = (4 * 9 + 3, 4 * 9 + 4);
        f.play(e5);
        assert_eq!(f.cell[d5 as usize], board::EMPTY);
        assert_eq!(f.ko, d5);
        assert!(!f.is_legal(d5));
        f.play(0);
        f.play(80);
        assert!(f.is_legal(d5));
    }

    /// Prints playouts per second on the empty board (cargo test --release -- --nocapture).
    #[test]
    fn playout_speed() {
        let pos = Position::new();
        let flat = flat_board(&pos);
        let legal = root_moves(&pos, &flat);
        let mut rng = Rng(7);
        let t = Instant::now();
        let out = search::search(&flat, &legal, t + Duration::from_millis(140), &mut rng);
        let secs = t.elapsed().as_secs_f64();
        println!("{} playouts in {:.0} ms: {:.0}/s", out.playouts, secs * 1e3, out.playouts as f64 / secs);
        assert!(out.playouts > 100);
    }
}
