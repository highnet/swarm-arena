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
mod book;
mod patterns;
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

/// The last search's tree and the game record at its root, kept between `go` calls so the
/// next search can start from the subtree of the position actually reached.
#[derive(Default)]
struct Reuse {
    saved: Option<(Vec<String>, search::Tree)>,
    /// Root visits inherited and playouts run by the last search (None: no search ran).
    last: Option<(u32, u64)>,
}

impl Reuse {
    /// The tree for `moves`: the saved one re-rooted at the position reached, when `moves`
    /// extends its game record and every move since is in the tree; otherwise a fresh one.
    fn tree_for(&mut self, moves: &[String], flat: &Board, legal: &[u8], rng: &mut Rng) -> search::Tree {
        if let Some((at, tree)) = self.saved.take() {
            if moves.len() > at.len() && moves[..at.len()] == at[..] {
                let since: Option<Vec<u8>> = moves[at.len()..]
                    .iter()
                    .map(|m| parse_move(m).map(|c| c.map_or(board::PASS, |c| c.0 * N as u8 + c.1)))
                    .collect();
                if let Some(t) = since.and_then(|since| tree.advance(&since, flat, legal)) {
                    return t;
                }
            }
        }
        search::Tree::new(flat, legal, rng)
    }
}

/// Pick a move for the side to move, given the moves so far, without tree reuse.
#[cfg(test)]
fn choose(moves: &[String], budget_ms: u64) -> Option<String> {
    choose_with(moves, budget_ms, &mut Reuse::default())
}

/// Pick a move for the side to move, given the moves so far.
/// Passes when the opponent just passed and the board already wins on area, or when no
/// non-eye legal move remains. Otherwise runs UCT until ~70% of the budget, starting from the
/// reused subtree when `reuse` holds one for this position, and plays the most-visited root move.
fn choose_with(moves: &[String], budget_ms: u64, reuse: &mut Reuse) -> Option<String> {
    let start = Instant::now();
    reuse.last = None;
    let pos = Position::from_moves(moves);
    let me = pos.turn();
    let now = cells(pos.game.goban());

    if pos.passes >= 1 {
        let s = area_score(&now);
        let winning = if me == Color::Black { s > 0.0 } else { s < 0.0 };
        if winning {
            reuse.saved = None;
            return Some("pass".into());
        }
    }

    let flat = flat_board(&pos);
    let legal = root_moves(&pos, &flat);
    if legal.is_empty() {
        reuse.saved = None;
        return Some("pass".into());
    }
    if legal.len() == 1 {
        reuse.saved = None;
        return Some(format_move(to_coord(legal[0])));
    }
    if let Some(m) = book_move(moves, &flat).filter(|m| legal.contains(m)) {
        reuse.saved = None;
        eprintln!("info book {}", format_move(to_coord(m)));
        return Some(format_move(to_coord(m)));
    }
    let mut rng = seeded_rng(moves);
    let deadline = start + Duration::from_millis(budget_ms * 7 / 10);
    let mut tree = reuse.tree_for(moves, &flat, &legal, &mut rng);
    let out = search::search_tree(&mut tree, Some(deadline), u64::MAX, &mut rng);
    reuse.saved = Some((moves.to_vec(), tree));
    reuse.last = Some((out.inherited, out.playouts));
    eprintln!("info playouts {} reused {} winrate {:.3}", out.playouts, out.inherited, out.winrate);
    Some(format_move(to_coord(out.best)))
}

/// The opening book's move for this position, when the game is still in the book's range:
/// at most `book::MAX_PLY` moves, no pass, no capture (every move left its stone).
fn book_move(moves: &[String], flat: &Board) -> Option<u8> {
    if moves.len() > book::MAX_PLY || moves.iter().any(|m| m.eq_ignore_ascii_case("pass")) {
        return None;
    }
    if flat.cell.iter().filter(|&&c| c != board::EMPTY).count() != moves.len() {
        return None;
    }
    book::probe(book::embedded(), &flat.cell)
}

/// Offline book tooling (`go9-engine book …`); never used during a game.
///
/// - `book gen <file> --playouts N [--shard i/k] [--seed S]`: searches every position of the
///   frontier (`book::frontier` of the entries already in `<file>`) whose index is `i` mod `k`,
///   with N playouts each and no clock, and prints one book line per position. Deterministic.
/// - `book frontier <file>`: how many positions the frontier holds.
/// - `book stats [opening plies]`: reads game records (`<b|w> <move>…`, the colour this engine played) on stdin
///   and prints in-book plies per game and the first out-of-book ply.
fn book_tool(args: &[String]) {
    let flag = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let load = |path: &str| book::parse(&std::fs::read_to_string(path).unwrap_or_default());
    match args.first().map(String::as_str) {
        Some("frontier") => {
            let b = load(&args[1]);
            println!("{} entries, frontier {}", b.len(), book::frontier(&b).len());
        }
        Some("gen") => {
            let b = load(&args[1]);
            let playouts: u64 = flag("--playouts").and_then(|v| v.parse().ok()).unwrap_or(50_000);
            let seed: u64 = flag("--seed").and_then(|v| v.parse().ok()).unwrap_or(110);
            let (i, k) = flag("--shard")
                .and_then(|v| v.split_once('/').map(|(a, b)| (a.parse().ok(), b.parse().ok())))
                .and_then(|(a, b)| Some((a?, b?)))
                .unwrap_or((0usize, 1usize));
            let out = io::stdout();
            for (n, key) in book::frontier(&b).into_iter().enumerate() {
                if n % k != i {
                    continue;
                }
                let order: Vec<String> = book::move_order(key).into_iter().map(|p| format_move(to_coord(p))).collect();
                let pos = Position::from_moves(&order);
                let flat = flat_board(&pos);
                let legal = root_moves(&pos, &flat);
                let mut rng = Rng(book::seed(key, seed));
                let res = search::search_limited(&flat, &legal, None, playouts, &mut rng);
                let mut o = out.lock();
                writeln!(o, "{}", book::format_line(key, res.best, res.playouts, res.winrate)).ok();
                o.flush().ok();
            }
        }
        Some("stats") => {
            // Plies of the referee's opening (#105: 2), not played by the engine.
            let skip: usize = args.get(1).and_then(|v| v.parse().ok()).unwrap_or(2);
            let (mut games, mut inbook) = (0u32, 0u32);
            let mut first: std::collections::BTreeMap<usize, u32> = Default::default();
            for line in io::stdin().lock().lines().map_while(Result::ok) {
                let mut f = line.split_whitespace();
                let me = match f.next() {
                    Some("b") => 0,
                    Some("w") => 1,
                    _ => continue,
                };
                let all: Vec<String> = f.map(String::from).collect();
                games += 1;
                let mut out_at = None;
                for ply in (me..all.len()).step_by(2).filter(|&p| p >= skip) {
                    let pos = Position::from_moves(&all[..ply]);
                    let flat = flat_board(&pos);
                    if book_move(&all[..ply], &flat).is_some() {
                        inbook += 1;
                    } else {
                        out_at = Some(ply);
                        break;
                    }
                }
                *first.entry(out_at.unwrap_or(all.len())).or_default() += 1;
            }
            println!("{games} games, {inbook} in-book plies ({:.2} per game)", inbook as f32 / games.max(1) as f32);
            for (ply, n) in first {
                println!("first out-of-book ply {ply}: {n} games");
            }
        }
        _ => eprintln!("usage: go9-engine book gen <file> --playouts N [--shard i/k] [--seed S] | frontier <file> | stats [opening plies]"),
    }
}

fn to_coord(p: u8) -> Coord {
    (p / N as u8, p % N as u8)
}

/// Handles one protocol line, returning the reply to print (if any) and whether to quit.
fn handle(line: &str, moves: &mut Vec<String>, reuse: &mut Reuse) -> (Option<String>, bool) {
    let mut parts = line.split_whitespace();
    match parts.next() {
        Some("game") => {
            reuse.saved = None;
            (Some("ready".into()), false)
        }
        Some("position") => {
            *moves = parts.map(String::from).collect();
            (None, false)
        }
        Some("go") => {
            let budget = parts.next().and_then(|s| s.parse().ok()).unwrap_or(1000);
            let mv = choose_with(moves, budget, reuse).unwrap_or_else(|| "pass".into());
            (Some(format!("bestmove {mv}")), false)
        }
        Some("quit") => (None, true),
        _ => (None, false),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("book") {
        book_tool(&args[1..]);
        return;
    }
    let stdin = io::stdin();
    let mut out = io::stdout();
    let mut moves = Vec::new();
    let mut reuse = Reuse::default();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let (reply, quit) = handle(&line, &mut moves, &mut reuse);
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
        let mut r = Reuse::default();
        assert_eq!(handle("game go9", &mut moves, &mut r).0.as_deref(), Some("ready"));
        handle("position e5 c3", &mut moves, &mut r);
        assert_eq!(moves, vec!["e5", "c3"]);
        let reply = handle("go 100", &mut moves, &mut r).0.unwrap();
        let m = reply.strip_prefix("bestmove ").unwrap();
        assert!(m != "e5" && m != "c3" && parse_move(m).is_some());
        assert!(handle("quit", &mut moves, &mut r).1);
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
            // One reuse cache per side, as two engine processes would keep them.
            let mut reuse = [Reuse::default(), Reuse::default()];
            for _ in 0..200 {
                let t = Instant::now();
                let m = choose_with(&moves, 200, &mut reuse[moves.len() % 2]).unwrap();
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

    /// Every embedded book entry is a legal, non-own-eye move in its position, and the position
    /// is reachable without captures (black has as many stones as white, or one more).
    #[test]
    fn book_moves_are_legal() {
        let b = book::embedded();
        for (&key, &mv) in b.iter() {
            let (nb, nw) = (key.0.count_ones(), key.1.count_ones());
            assert!(nb == nw || nb == nw + 1, "stone counts {nb}/{nw}");
            assert!(nb + nw <= book::MAX_PLY as u32);
            let order: Vec<String> = book::move_order(key).into_iter().map(|p| format_move(to_coord(p))).collect();
            let pos = Position::from_moves(&order);
            let flat = flat_board(&pos);
            assert_eq!(&flat.cell, &book::cells_of(key), "{order:?}");
            assert!(root_moves(&pos, &flat).contains(&mv), "illegal book move after {order:?}");
        }
    }

    /// Every opening of the referee's suite (#105) is in the book from both sides' first move:
    /// the ply-2 position itself. Reported, not asserted, before the book is generated.
    #[test]
    fn suite_openings_are_in_book() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../shared/src/openings/go9.txt");
        let Ok(text) = std::fs::read_to_string(path) else { return };
        let (mut hit, mut total) = (0, 0);
        for line in text.lines().filter(|l| !l.starts_with('#') && !l.trim().is_empty()) {
            let moves: Vec<String> = line.split('\t').next().unwrap().split_whitespace().map(String::from).collect();
            let pos = Position::from_moves(&moves);
            let flat = flat_board(&pos);
            total += 1;
            if let Some(m) = book_move(&moves, &flat) {
                assert!(root_moves(&pos, &flat).contains(&m));
                hit += 1;
            }
        }
        println!("suite openings in book: {hit}/{total}");
        if !book::embedded().is_empty() {
            assert_eq!(hit, total);
        }
    }

    /// The generator's search is reproducible: same position, budget and seed, same move.
    #[test]
    fn book_search_is_deterministic() {
        let order = mv("e5 c3");
        let pos = Position::from_moves(&order);
        let flat = flat_board(&pos);
        let legal = root_moves(&pos, &flat);
        let key = book::canonical(&flat.cell).0;
        let run = || {
            let mut rng = Rng(book::seed(key, 110));
            let o = search::search_limited(&flat, &legal, None, 3000, &mut rng);
            (o.best, o.playouts, o.winrate)
        };
        assert_eq!(run(), run());
        assert_eq!(run().1, 3000);
    }

    /// In book, `go` answers the stored move at once; out of book (a capture or a pass) it searches.
    #[test]
    fn book_is_probed_only_in_range() {
        let moves = mv("e5 c3");
        let pos = Position::from_moves(&moves);
        let flat = flat_board(&pos);
        if let Some(m) = book_move(&moves, &flat) {
            let t = Instant::now();
            assert_eq!(choose(&moves, 1000).unwrap(), format_move(to_coord(m)));
            assert!(t.elapsed() < Duration::from_millis(100));
        }
        let with_pass = mv("e5 pass");
        let pos = Position::from_moves(&with_pass);
        assert_eq!(book_move(&with_pass, &flat_board(&pos)), None);
        let long = mv("e5 c3 g7 c7 g3");
        let pos = Position::from_moves(&long);
        assert_eq!(book_move(&long, &flat_board(&pos)), None);
    }

    /// A searched tree over `moves` (beyond the book), with its flat board and root moves.
    fn searched(moves: &[String], playouts: u64) -> search::Tree {
        let pos = Position::from_moves(moves);
        let flat = flat_board(&pos);
        let legal = root_moves(&pos, &flat);
        let mut rng = Rng(154);
        let mut tree = search::Tree::new(&flat, &legal, &mut rng);
        search::search_tree(&mut tree, None, playouts, &mut rng);
        tree
    }

    fn after(moves: &[String], extra: &[u8]) -> Vec<String> {
        let mut v = moves.to_vec();
        v.extend(extra.iter().map(|&p| format_move(to_coord(p))));
        v
    }

    /// Re-rooting after our move and the reply keeps the grandchild's visits, and its root
    /// children are exactly the oracle's moves: one the oracle rejects is pruned.
    #[test]
    fn reroot_keeps_the_grandchild() {
        let moves = mv("e5 c3 g7 c7 g3 d5");
        let tree = searched(&moves, 20_000);
        let (a, b, visits) = tree.principal_pair();
        assert!(visits > 100, "grandchild has only {visits} visits");
        let next = after(&moves, &[a, b]);
        let pos = Position::from_moves(&next);
        let flat = flat_board(&pos);
        let mut legal = root_moves(&pos, &flat);
        // Pretend the oracle rejects the grandchild's most-visited child.
        let dropped = legal.iter().copied().max_by_key(|&m| tree.visits_after(&[a, b, m]).unwrap_or(0)).unwrap();
        assert!(tree.visits_after(&[a, b, dropped]).unwrap_or(0) > 0);
        legal.retain(|&m| m != dropped);
        let first = legal[0];
        let first_visits = tree.visits_after(&[a, b, first]);
        let re = tree.advance(&[a, b], &flat, &legal).expect("re-root");
        assert_eq!(re.root_visits(), visits);
        assert_eq!(re.visits_after(&[dropped]), None);
        assert_eq!(re.visits_after(&[first]), first_visits);
        let mut kids = re.root_children();
        kids.sort();
        let mut want = legal.clone();
        want.sort();
        assert_eq!(kids, want);
        // And the re-rooted tree searches on.
        let mut re = re;
        let mut rng = Rng(1);
        let out = search::search_tree(&mut re, None, 500, &mut rng);
        assert_eq!(out.inherited, visits);
        assert!(legal.contains(&out.best));
        assert_eq!(re.root_visits(), visits + 500);
    }

    /// A reply the tree never expanded, a history that does not extend the saved one, or a new
    /// game all start fresh.
    #[test]
    fn unexpected_reply_starts_fresh() {
        let moves = mv("e5 c3 g7 c7 g3 d5");
        let tree = searched(&moves, 5_000);
        let (a, _, _) = tree.principal_pair();
        let pos_a = Position::from_moves(&after(&moves, &[a]));
        let rare = root_moves(&pos_a, &flat_board(&pos_a))
            .into_iter()
            .find(|&m| tree.visits_after(&[a, m]).unwrap_or(0) < 2)
            .expect("an unexplored reply");
        let next = after(&moves, &[a, rare]);
        let pos = Position::from_moves(&next);
        let flat = flat_board(&pos);
        let legal = root_moves(&pos, &flat);
        let mut rng = Rng(3);
        let mut reuse = Reuse { last: None, saved: Some((moves.clone(), tree)) };
        assert_eq!(reuse.tree_for(&next, &flat, &legal, &mut rng).root_visits(), 0);

        // The expected reply is reused through the same entry point.
        let tree = searched(&moves, 5_000);
        let (a, b, visits) = tree.principal_pair();
        let next = after(&moves, &[a, b]);
        let pos = Position::from_moves(&next);
        let flat = flat_board(&pos);
        let legal = root_moves(&pos, &flat);
        let mut reuse = Reuse { last: None, saved: Some((moves.clone(), tree)) };
        assert_eq!(reuse.tree_for(&next, &flat, &legal, &mut rng).root_visits(), visits);

        // A different history (not an extension of the saved one) is fresh.
        let other = mv("e5 c3 g7 c7 g3 d6");
        let pos = Position::from_moves(&other);
        let flat = flat_board(&pos);
        let legal = root_moves(&pos, &flat);
        let mut reuse = Reuse { last: None, saved: Some((moves.clone(), searched(&moves, 2_000))) };
        assert_eq!(reuse.tree_for(&other, &flat, &legal, &mut rng).root_visits(), 0);

        // `game` drops the saved tree.
        let (mut ms, mut r) = (Vec::new(), Reuse { last: None, saved: Some((moves.clone(), searched(&moves, 100))) });
        handle("game go9", &mut ms, &mut r);
        assert!(r.saved.is_none());
    }

    /// Self-play at go 200 with and without tree reuse: mean root visits inherited per searched
    /// move and mean playouts per move (cargo test --release reuse_report -- --ignored --nocapture).
    #[test]
    #[ignore]
    fn reuse_report() {
        for reuse_on in [false, true] {
            // (ply, inherited, playouts) per searched move.
            let mut rows: Vec<(usize, u64, u64)> = Vec::new();
            for _game in 0..4 {
                let mut moves: Vec<String> = Vec::new();
                let mut reuse = [Reuse::default(), Reuse::default()];
                for _ in 0..160 {
                    let r = &mut reuse[moves.len() % 2];
                    if !reuse_on {
                        r.saved = None;
                    }
                    let m = choose_with(&moves, 200, r).unwrap();
                    if let Some((inh, n)) = r.last {
                        rows.push((moves.len(), inh as u64, n));
                    }
                    moves.push(m);
                    let n = moves.len();
                    if n >= 2 && moves[n - 1] == "pass" && moves[n - 2] == "pass" {
                        break;
                    }
                }
            }
            let tag = if reuse_on { "on " } else { "off" };
            for (name, lo, hi) in [("plies 0-39", 0, 40), ("plies 40+", 40, usize::MAX), ("all", 0, usize::MAX)] {
                let sel: Vec<_> = rows.iter().filter(|r| r.0 >= lo && r.0 < hi).collect();
                let med = |f: &dyn Fn(&(usize, u64, u64)) -> u64| {
                    let mut v: Vec<u64> = sel.iter().map(|r| f(r)).collect();
                    v.sort();
                    v.get(v.len() / 2).copied().unwrap_or(0)
                };
                let reused = sel.iter().filter(|r| r.1 > 0).count();
                println!(
                    "reuse {tag} {name}: {} moves, {} with a reused tree, median inherited {}, median playouts {}, median root visits {}",
                    sel.len(),
                    reused,
                    med(&|r| r.1),
                    med(&|r| r.2),
                    med(&|r| r.1 + r.2)
                );
            }
        }
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
