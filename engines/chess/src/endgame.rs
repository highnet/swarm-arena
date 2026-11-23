//! Probing the engine's own endgame tables (KQK, KRK, KPK).
//!
//! `build.rs` solves the three endings with the generator in `eg_gen.rs` (retrograde analysis over
//! every position) and this module embeds the result: one byte per position, 0 for a draw and
//! `n > 0` for mate in `n - 1` plies, with the board folded by symmetry. Size: 2 × 81,920 bytes
//! for the pawnless endings, 196,608 for KPK, 360 KB in all. Nothing external is loaded.

use shakmaty::{Chess, Color, Position, Role, Square};

static KQK: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/kqk.bin"));
static KRK: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/krk.bin"));
static KPK: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/kpk.bin"));

/// A table result from the side to move's point of view, distances in plies.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tb {
    /// The side to move mates in this many plies (with best play by both sides).
    Win(u32),
    /// The side to move is mated in this many plies.
    Loss(u32),
    Draw,
}

/// Index of a strong-king square in the a1-d1-d4 triangle (255 outside it).
const fn triangle() -> [u8; 64] {
    let mut t = [255u8; 64];
    let sq = [0, 1, 2, 3, 9, 10, 11, 18, 19, 27];
    let mut i = 0;
    while i < 10 {
        t[sq[i]] = i as u8;
        i += 1;
    }
    t
}
const TRIANGLE: [u8; 64] = triangle();

fn flip_file(s: usize) -> usize {
    s ^ 7
}
fn flip_rank(s: usize) -> usize {
    s ^ 56
}
fn transpose(s: usize) -> usize {
    (s % 8) * 8 + s / 8
}

/// Table index of a pawnless position (strong king `k`, piece `x`, weak king `w`, White strong).
fn pawnless_index(mut k: usize, mut x: usize, mut w: usize, stm: usize) -> usize {
    if k % 8 > 3 {
        (k, x, w) = (flip_file(k), flip_file(x), flip_file(w));
    }
    if k / 8 > 3 {
        (k, x, w) = (flip_rank(k), flip_rank(x), flip_rank(w));
    }
    if k / 8 > k % 8 {
        (k, x, w) = (transpose(k), transpose(x), transpose(w));
    }
    ((TRIANGLE[k] as usize * 64 + x) * 64 + w) * 2 + stm
}

/// Table index of a KPK position (White pawn on `x`, ranks 2-7).
fn pawn_index(mut k: usize, mut x: usize, mut w: usize, stm: usize) -> usize {
    if x % 8 > 3 {
        (k, x, w) = (flip_file(k), flip_file(x), flip_file(w));
    }
    let p = (x / 8 - 1) * 4 + x % 8;
    ((p * 64 + k) * 64 + w) * 2 + stm
}

/// The table's verdict on a position with exactly two kings and one queen, rook or pawn, or None
/// for any other position (or one with castling rights, which the tables leave out).
pub fn probe(pos: &Chess) -> Option<Tb> {
    let board = pos.board();
    if board.occupied().count() != 3 || pos.castles().any() {
        return None;
    }
    let strong = if board.by_color(Color::White).count() == 2 { Color::White } else { Color::Black };
    let xsq = (board.by_color(strong) & !board.kings()).first()?;
    let (table, pawn) = match board.role_at(xsq)? {
        Role::Queen => (KQK, false),
        Role::Rook => (KRK, false),
        Role::Pawn => (KPK, true),
        _ => return None,
    };
    // Colours are flipped so the strong side is White, as in the generator.
    let norm = |s: Square| if strong == Color::White { s as usize } else { flip_rank(s as usize) };
    let (k, x, w) = (norm(board.king_of(strong)?), norm(xsq), norm(board.king_of(!strong)?));
    let stm = usize::from(pos.turn() != strong);
    let i = if pawn { pawn_index(k, x, w, stm) } else { pawnless_index(k, x, w, stm) };
    Some(match table[i] {
        0 => Tb::Draw,
        n if stm == 0 => Tb::Win(n as u32 - 1),
        n => Tb::Loss(n as u32 - 1),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use shakmaty::{Board, CastlingMode, FromSetup, Piece, Setup};

    /// Builds a position from three pieces, or None if the rules library rejects it.
    fn position(strong: Color, role: Role, k: u32, x: u32, w: u32, turn: Color) -> Option<Chess> {
        if k == x || k == w || x == w {
            return None;
        }
        let mut board = Board::empty();
        let sq = |s: u32| Square::new(s);
        board.set_piece_at(sq(k), Piece { color: strong, role: Role::King });
        board.set_piece_at(sq(x), Piece { color: strong, role });
        board.set_piece_at(sq(w), Piece { color: !strong, role: Role::King });
        let mut setup = Setup::empty();
        setup.board = board;
        setup.turn = turn;
        Chess::from_setup(setup, CastlingMode::Standard).ok()
    }

    /// The parent's result given a child's result (the child is seen from the other side).
    fn back(child: Tb) -> Tb {
        match child {
            Tb::Win(d) => Tb::Loss(d + 1),
            Tb::Loss(d) => Tb::Win(d + 1),
            Tb::Draw => Tb::Draw,
        }
    }

    /// Orders results for the side to move: shorter wins first, then draws, then longer losses.
    fn rank(t: Tb) -> i64 {
        match t {
            Tb::Win(d) => 1000 - d as i64,
            Tb::Draw => 0,
            Tb::Loss(d) => -1000 + d as i64,
        }
    }

    /// One ply of minimax using only the rules library: every legal move, its result from the
    /// table if it stays in a solved ending, or a draw if material left cannot mate.
    fn one_ply(pos: &Chess) -> Tb {
        let moves = pos.legal_moves();
        if moves.is_empty() {
            return if pos.is_check() { Tb::Loss(0) } else { Tb::Draw };
        }
        moves
            .iter()
            .map(|m| {
                let mut child = pos.clone();
                child.play_unchecked(*m);
                if child.is_insufficient_material() {
                    Tb::Draw
                } else {
                    back(probe(&child).expect("a three-piece child stays in a solved ending"))
                }
            })
            .max_by_key(|t| rank(*t))
            .unwrap()
    }

    /// Checks every position of an ending against the rules library, both colours as the strong
    /// side. Returns (positions, strong-to-move wins, strong-to-move draws, longest mate in plies).
    fn verify(role: Role) -> (u64, u64, u64, u32) {
        let (mut n, mut wins, mut draws, mut longest) = (0, 0, 0, 0);
        let squares = if role == Role::Pawn { 8..56 } else { 0..64 };
        for k in 0..64 {
            for x in squares.clone() {
                for w in 0..64 {
                    for turn in [Color::White, Color::Black] {
                        let Some(pos) = position(Color::White, role, k, x, w, turn) else { continue };
                        let Some(got) = probe(&pos) else {
                            let b = pos.board();
                            panic!("no probe k{k} x{x} w{w} {turn:?} occ {} castles {}", b.occupied().count(), pos.castles().any());
                        };
                        assert_eq!(got, one_ply(&pos), "k{k} x{x} w{w} {turn:?}");
                        // The same position with colours swapped reads the same result.
                        let flipped = position(Color::Black, role, k ^ 56, x ^ 56, w ^ 56, !turn).unwrap();
                        assert_eq!(probe(&flipped), Some(got));
                        n += 1;
                        if turn == Color::White {
                            match got {
                                Tb::Win(d) => {
                                    wins += 1;
                                    longest = longest.max(d);
                                }
                                Tb::Draw => draws += 1,
                                Tb::Loss(_) => panic!("the strong side cannot lose"),
                            }
                        }
                    }
                }
            }
        }
        (n, wins, draws, longest)
    }

    #[test]
    fn kqk_table_matches_the_rules_everywhere() {
        let (n, wins, draws, longest) = verify(Role::Queen);
        println!("KQK: {n} positions, white to move {wins} wins {draws} draws, longest mate {longest} plies");
        // Published fact: the longest KQK mate is 10 moves (19 plies with the winner to move).
        assert_eq!(longest, 19);
        assert_eq!(draws, 0, "with the queen's side to move KQK is always won");
    }

    #[test]
    fn krk_table_matches_the_rules_everywhere() {
        let (n, wins, draws, longest) = verify(Role::Rook);
        println!("KRK: {n} positions, white to move {wins} wins {draws} draws, longest mate {longest} plies");
        // Published fact: the longest KRK mate is 16 moves (31 plies with the winner to move).
        assert_eq!(longest, 31);
        assert_eq!(draws, 0, "with the rook's side to move KRK is always won");
    }

    #[test]
    fn kpk_table_matches_the_rules_everywhere() {
        let (n, wins, draws, longest) = verify(Role::Pawn);
        println!("KPK: {n} positions, white to move {wins} wins {draws} draws, longest mate {longest} plies");
        assert!(wins > 0 && draws > 0);
    }

    fn fen(s: &str) -> Chess {
        let f: shakmaty::fen::Fen = s.parse().unwrap();
        f.into_position(CastlingMode::Standard).unwrap()
    }

    #[test]
    fn known_positions() {
        // Mate in one: Qh8# / Qb7#, Rh8#.
        assert_eq!(probe(&fen("k7/8/1K6/8/8/8/7Q/8 w - - 0 1")), Some(Tb::Win(1)));
        assert_eq!(probe(&fen("k7/8/1K6/8/8/8/8/7R w - - 0 1")), Some(Tb::Win(1)));
        // Already mated, and stalemated.
        assert_eq!(probe(&fen("k6R/8/1K6/8/8/8/8/8 b - - 0 1")), Some(Tb::Loss(0)));
        assert_eq!(probe(&fen("k7/2Q5/1K6/8/8/8/8/8 b - - 0 1")), Some(Tb::Draw));
        // The lone king takes an undefended rook: draw.
        assert_eq!(probe(&fen("8/8/8/3k4/3R4/8/8/K7 b - - 0 1")), Some(Tb::Draw));
        // Rook pawn with the defending king in the corner: draw either way.
        assert_eq!(probe(&fen("k7/8/8/8/8/8/P7/K7 w - - 0 1")), Some(Tb::Draw));
        assert_eq!(probe(&fen("k7/8/8/8/8/8/P7/K7 b - - 0 1")), Some(Tb::Draw));
        // The pawn outruns a king far away; with Black as the strong side too.
        assert!(matches!(probe(&fen("7k/8/8/8/8/8/P7/K7 w - - 0 1")), Some(Tb::Win(_))));
        assert!(matches!(probe(&fen("k7/p7/8/8/8/8/8/7K b - - 0 1")), Some(Tb::Win(_))));
        // Not a table ending: four pieces, or a minor piece.
        assert_eq!(probe(&fen("k7/8/8/8/8/8/PP6/K7 w - - 0 1")), None);
        assert_eq!(probe(&fen("k7/8/8/8/8/8/N7/K7 w - - 0 1")), None);
    }
}
