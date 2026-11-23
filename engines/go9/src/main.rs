//! go9 engine for Swarm Arena.
//! Rules: the `goban` crate. Search and evaluation: written by the swarm.
//! Protocol and library policy: ../PROTOCOL.md.

use goban::pieces::goban::Goban;
use goban::pieces::stones::{Color, Stone};
use goban::pieces::util::coord::Coord;
use goban::rules::game::Game;
use goban::rules::{GobanSizes, IllegalRules, Move, CHINESE};
use std::collections::HashSet;
use std::io::{self, BufRead, Write};

const N: usize = 9;
const KOMI: f32 = 7.5;
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

/// Liberties of the group containing stone `i`.
fn group_liberties(cells: &[Option<Color>], i: usize) -> usize {
    let colour = cells[i];
    let mut stack = vec![i];
    let mut seen = [false; N * N];
    let mut libs = [false; N * N];
    seen[i] = true;
    while let Some(s) = stack.pop() {
        for n in neighbours(s) {
            if cells[n].is_none() {
                libs[n] = true;
            } else if cells[n] == colour && !seen[n] {
                seen[n] = true;
                stack.push(n);
            }
        }
    }
    libs.iter().filter(|&&l| l).count()
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

/// Single-point eye of `colour`: every orthogonal neighbour is that colour.
fn is_own_eye(cells: &[Option<Color>], i: usize, colour: Color) -> bool {
    cells[i].is_none() && neighbours(i).all(|n| cells[n] == Some(colour))
}

/// Small xorshift RNG; the seed mixes the game record with the wall clock.
struct Rng(u64);

impl Rng {
    fn seeded(moves: &[String]) -> Self {
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

    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
}

/// Legal moves that do not fill the mover's own eye, with a playing weight:
/// captures are favoured, self-atari nearly ruled out.
fn candidates(pos: &Position) -> Vec<(Coord, u64)> {
    let me = pos.turn();
    let now = cells(pos.game.goban());
    let mut out = Vec::new();
    for c in pos.legal_moves() {
        let i = c.0 as usize * N + c.1 as usize;
        if is_own_eye(&now, i, me) || pos.game.check_eye(Stone { coord: c, color: me }) {
            continue;
        }
        let after = cells(&pos.after(c).expect("legal"));
        let captured = now.iter().zip(&after).filter(|(a, b)| a.is_some() && b.is_none()).count();
        let libs = group_liberties(&after, i);
        let weight = if captured > 0 {
            10 + 40 * captured as u64
        } else if libs == 1 {
            1
        } else {
            10
        };
        out.push((c, weight));
    }
    out
}

/// Pick a move for the side to move, given the moves so far.
/// Plays a weighted-random legal move that never fills its own single-point eye: captures are
/// preferred, self-atari avoided. Passes when no such move remains, or when the opponent just
/// passed and the board already wins on area.
fn choose(moves: &[String], _budget_ms: u64) -> Option<String> {
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

    let mut rng = Rng::seeded(moves);
    let mut best: Option<(u64, Coord)> = None;
    for (c, weight) in candidates(&pos) {
        // Random key scaled by weight: the highest key wins.
        let key = (rng.next() % 1_000_000) * weight;
        if best.map_or(true, |(k, _)| key > k) {
            best = Some((key, c));
        }
    }
    Some(best.map_or_else(|| "pass".into(), |(_, c)| format_move(c)))
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
        assert!(candidates(&p).is_empty(), "must not fill own eyes");
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

    #[test]
    fn random_games_stay_legal() {
        // Self-play many short games; every chosen move must be legal in our own model.
        for game in 0..20 {
            let mut moves: Vec<String> = Vec::new();
            for _ in 0..120 {
                let m = choose(&moves, 10).unwrap();
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
}
