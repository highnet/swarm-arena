//! chess engine for Swarm Arena.
//! Rules: the `shakmaty` crate. Search and evaluation: written by the swarm.
//! Protocol and library policy: ../PROTOCOL.md.

mod book;
mod endgame;
mod texel;

use endgame::Tb;
use shakmaty::uci::UciMove;
use shakmaty::zobrist::Zobrist64;
use shakmaty::{attacks, Bitboard, Chess, Color, EnPassantMode, Move, Position, Rank, Role, Square};
use std::cell::RefCell;
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
/// Delta-pruning margin: a capture whose victim plus this cannot lift the stand-pat score to
/// alpha is skipped in quiescence.
const DELTA_MARGIN: i32 = 200;
/// At or below this game phase (24 = all pieces, 0 = bare kings and pawns) delta pruning is off:
/// in late endgames a single capture can decide the game beyond its material value.
const ENDGAME_PHASE: i32 = 6;
/// Plies of quiescence beyond which a node is scored statically (guards check-evasion chains).
const MAX_QPLY: i32 = 32;

/// Transposition-table size: 2^20 entries of 16 bytes = 16 MB.
const TT_BITS: u32 = 20;
const EXACT: u8 = 0;
const LOWER: u8 = 1;
const UPPER: u8 = 2;

/// One table slot (16 bytes). `meta` packs the generation (high 6 bits) and the bound (low 2).
#[derive(Clone, Copy, Default)]
struct Entry {
    key: u64,
    score: i32,
    mv: u16,
    depth: u8,
    meta: u8,
}

impl Entry {
    fn bound(&self) -> u8 {
        self.meta & 3
    }
    fn generation(&self) -> u8 {
        self.meta >> 2
    }
}

/// Fixed-size, always-indexed table keyed by the full Zobrist key (the stored key rejects index
/// collisions). It lives across `go` calls within a game: each search bumps the generation, a
/// slot from an older generation is always replaced, and within a generation the deeper result
/// stays.
struct Tt {
    entries: Vec<Entry>,
    mask: usize,
    generation: u8,
    /// The side the engine searched for last; draw scores carry contempt against it, so a change of
    /// side clears the table.
    root_turn: Option<Color>,
}

impl Tt {
    fn new(bits: u32) -> Tt {
        Tt { entries: vec![Entry::default(); 1 << bits], mask: (1 << bits) - 1, generation: 0, root_turn: None }
    }

    fn clear(&mut self) {
        self.entries.iter_mut().for_each(|e| *e = Entry::default());
        self.generation = 0;
        self.root_turn = None;
    }

    fn new_search(&mut self, turn: Color) {
        if self.root_turn != Some(turn) {
            self.clear();
            self.root_turn = Some(turn);
        }
        self.generation = (self.generation + 1) & 63;
    }

    fn probe(&self, key: u64) -> Option<Entry> {
        let e = self.entries[key as usize & self.mask];
        // An empty slot has key 0; a real position hashing to exactly 0 is not worth a flag bit.
        (e.key == key && key != 0).then_some(e)
    }

    fn store(&mut self, key: u64, depth: u32, ply: i32, score: i32, bound: u8, mv: Option<Move>) {
        let slot = &mut self.entries[key as usize & self.mask];
        if slot.generation() == self.generation && depth < slot.depth as u32 {
            return;
        }
        *slot = Entry {
            key,
            score: to_tt(score, ply),
            mv: mv.map_or(0, |m| encode(&m)),
            depth: depth.min(255) as u8,
            meta: (self.generation << 2) | bound,
        };
    }
}

thread_local! {
    /// The game's table, kept between `go` calls and cleared by `game`.
    static TT: RefCell<Tt> = RefCell::new(Tt::new(TT_BITS));
}

/// Mate scores are stored relative to the node (distance from it), not the root, so a mate found
/// through a transposition at another ply still reports its true distance.
fn to_tt(score: i32, ply: i32) -> i32 {
    if score > MATE_BOUND {
        score + ply
    } else if score < -MATE_BOUND {
        score - ply
    } else {
        score
    }
}

fn from_tt(score: i32, ply: i32) -> i32 {
    if score > MATE_BOUND {
        score - ply
    } else if score < -MATE_BOUND {
        score + ply
    } else {
        score
    }
}

/// Compact move: from (6 bits), to (6 bits), promotion role (3 bits), and a set top bit so a
/// stored move is never 0.
fn encode(m: &Move) -> u16 {
    let from = m.from().map_or(0, |s| s as u16);
    let to = m.to() as u16;
    let promo = m.promotion().map_or(0, |r| r as u16);
    0x8000 | from | (to << 6) | (promo << 12)
}

/// The legal move matching a stored code, if any: this both decodes and validates it.
fn decode(code: u16, moves: &[Move]) -> Option<Move> {
    if code == 0 {
        return None;
    }
    moves.iter().find(|m| encode(m) == code).copied()
}

/// Game phase from the pieces on the board, 0 (pawn endgame) to 24 (all pieces).
fn phase(pos: &Chess) -> i32 {
    let b = pos.board();
    let minors = (b.knights() | b.bishops()).count() as i32;
    (minors + 2 * b.rooks().count() as i32 + 4 * b.queens().count() as i32).min(24)
}

/// Distance-to-centre score of a square, 0 (corner) to 14 (the four centre squares).
fn centrality(file: i32, rank: i32) -> i32 {
    (7 - (2 * file - 7).abs()) + (7 - (2 * rank - 7).abs())
}

/// Every number `evaluate` reads (#293). The terms and their shape are fixed in code; only these
/// weights change, so a Texel-style fit (`texel.rs`) can tune them against game results.
/// Each term is linear in its weight, which is what lets the fit read off one feature per weight.
/// Middlegame / endgame pairs are tapered by the 24-point phase; `bishop_pair` is added after it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Params {
    /// Material by role (pawn, knight, bishop, rook, queen), middlegame and endgame.
    pub material_mg: [i32; 5],
    pub material_eg: [i32; 5],
    /// Pawn: per rank advanced past the second, middlegame and endgame.
    pub pawn_advance: [i32; 2],
    /// Pawn on the d or e file, extra middlegame bonus by rank seen from its owner (index = rank).
    pub pawn_centre: [i32; 8],
    /// Per centrality point above the board's mean (7), middlegame and endgame.
    pub knight_centre: [i32; 2],
    pub bishop_centre: [i32; 2],
    pub queen_centre: [i32; 2],
    /// Bishop still on its back rank (middlegame).
    pub bishop_back: i32,
    /// Rook on the seventh rank, middlegame and endgame.
    pub rook_seventh: [i32; 2],
    /// Rook on c-f of its back rank (middlegame).
    pub rook_back_centre: i32,
    /// Queen off its back rank (middlegame).
    pub queen_off_back: i32,
    /// King on a, b, c, g or h of its back rank (middlegame).
    pub king_shelter: i32,
    /// King per rank advanced off its back rank (middlegame).
    pub king_advance: i32,
    /// King per centrality point above the mean (endgame).
    pub king_centre_eg: i32,
    /// Mobility per safe square above `MOBILITY_BASE`: knight, bishop, rook, queen; mg and eg.
    pub mobility: [[i32; 2]; 4],
    /// Passed pawn by rank seen from its owner (index 1 = second rank .. 6 = seventh), mg and eg,
    /// and the extra when its stop square is empty.
    pub passer_mg: [i32; 8],
    pub passer_eg: [i32; 8],
    pub passer_free_mg: [i32; 8],
    pub passer_free_eg: [i32; 8],
    /// Both bishops (added after the taper).
    pub bishop_pair: i32,
    /// King safety (#301, middlegame): per square of the enemy king zone (king square and its
    /// neighbours) attacked by one of our knight, bishop, rook, queen, counted per attacker.
    pub king_attack: [i32; 4],
    /// Own pawns in front of a castled king (king on its first two ranks, files a-c or f-h), on
    /// the king's and adjacent files: one rank ahead, two ranks ahead (middlegame).
    pub pawn_shield: [i32; 2],
    /// Pawn structure (#301), per pawn, mg and eg: no own pawn on an adjacent file; the rear pawn
    /// of each pair on a file; not isolated, no own pawn beside or behind it on an adjacent file,
    /// and its stop square attacked by an enemy pawn.
    pub isolated: [i32; 2],
    pub doubled: [i32; 2],
    pub backward: [i32; 2],
    /// Rook on a file with no pawns, and on one with only enemy pawns (#301), mg and eg.
    pub rook_open: [i32; 2],
    pub rook_half_open: [i32; 2],
}

/// The safe-square count at which a piece's mobility scores 0: knight, bishop, rook, queen.
/// Not tuned: with the weight it only adds a constant per piece, which material already carries.
const MOBILITY_BASE: [i32; 4] = [4, 6, 7, 13];

/// The weights `evaluate` plays with: fitted by `texel/generate.sh 5 30 4 10 1500 3e-7` (#293) to
/// 6,000 games of v0.11 self-play; the v0.11 hand-set numbers they replaced are in the playbook.
pub(crate) const PARAMS: Params = Params {
    material_mg: [90, 318, 331, 500, 903],
    material_eg: [102, 309, 321, 507, 904],
    pawn_advance: [-6, 8],
    pawn_centre: [0, -8, -2, 14, 9, 11, 0, 0],
    knight_centre: [2, 7],
    bishop_centre: [1, 0],
    queen_centre: [0, 3],
    bishop_back: -6,
    rook_seventh: [18, 10],
    rook_back_centre: 12,
    queen_off_back: -4,
    king_shelter: 27,
    king_advance: -11,
    king_centre_eg: 4,
    mobility: [[6, 1], [7, 5], [9, 5], [3, 9]],
    passer_mg: [0, 0, 1, 7, 15, 30, 46, 0],
    passer_eg: [0, 7, 8, 19, 32, 61, 87, 0],
    passer_free_mg: [0, 0, -1, 1, 4, 9, 11, 0],
    passer_free_eg: [0, 2, 0, 5, 9, 19, 23, 0],
    bishop_pair: 27,
    king_attack: [0, 0, 0, 0],
    pawn_shield: [0, 0],
    isolated: [0, 0],
    doubled: [0, 0],
    backward: [0, 0],
    rook_open: [0, 0],
    rook_half_open: [0, 0],
};

/// Piece-square bonus for a piece of `role` on (file, rank), rank seen from its owner's side.
/// Returns (middlegame, endgame). Formula-built rather than tabulated, so the shape is legible.
#[inline(always)]
fn placement(p: &Params, role: Role, file: i32, rank: i32) -> (i32, i32) {
    let c = centrality(file, rank) - 7;
    match role {
        Role::Pawn => {
            let adv = rank - 1;
            let centre = if (3..=4).contains(&file) { p.pawn_centre[rank as usize] } else { 0 };
            (p.pawn_advance[0] * adv + centre, p.pawn_advance[1] * adv)
        }
        Role::Knight => (p.knight_centre[0] * c, p.knight_centre[1] * c),
        Role::Bishop => (p.bishop_centre[0] * c + if rank == 0 { p.bishop_back } else { 0 }, p.bishop_centre[1] * c),
        Role::Rook => {
            let (s_mg, s_eg) = if rank == 6 { (p.rook_seventh[0], p.rook_seventh[1]) } else { (0, 0) };
            let central = if (2..=5).contains(&file) && rank == 0 { p.rook_back_centre } else { 0 };
            (s_mg + central, s_eg)
        }
        Role::Queen => (p.queen_centre[0] * c + if rank == 0 { 0 } else { p.queen_off_back }, p.queen_centre[1] * c),
        Role::King => {
            let shelter = if rank == 0 {
                if matches!(file, 0..=2 | 6 | 7) { p.king_shelter } else { 0 }
            } else {
                p.king_advance * rank
            };
            (shelter, p.king_centre_eg * c)
        }
    }
}

const FILE_A: u64 = 0x0101_0101_0101_0101;
const FILE_H: u64 = FILE_A << 7;

/// Squares attacked by the pawns of `color` (a pawn bitboard), by shifting the whole set at once.
fn pawn_attack_set(pawns: u64, color: Color) -> u64 {
    match color {
        Color::White => ((pawns & !FILE_A) << 7) | ((pawns & !FILE_H) << 9),
        Color::Black => ((pawns & !FILE_A) >> 9) | ((pawns & !FILE_H) >> 7),
    }
}

/// Mobility and passed-pawn terms with the playing weights (see `activity_with`).
#[cfg(test)]
fn activity(pos: &Chess) -> (i32, i32) {
    activity_with(pos, &PARAMS)
}

/// Mobility and passed-pawn terms, white minus black, as (middlegame, endgame). Mobility counts,
/// for each knight, bishop, rook and queen, the squares it attacks that hold no own piece and are
/// not attacked by an enemy pawn. A pawn is passed when no enemy pawn stands ahead of it on its
/// own or an adjacent file.
#[inline(always)]
fn activity_with(pos: &Chess, p: &Params) -> (i32, i32) {
    let board = pos.board();
    let occ = board.occupied();
    let pawns = board.pawns().0;
    let (mut mg, mut eg) = (0i32, 0i32);
    for color in [Color::White, Color::Black] {
        let sign = if color == Color::White { 1 } else { -1 };
        let own = board.by_color(color).0;
        let own_pawns = pawns & own;
        let enemy_pawns = pawns & board.by_color(!color).0;
        let unsafe_sq = own | pawn_attack_set(enemy_pawns, !color);
        let safe = !unsafe_sq;
        let occ_raw = occ;
        let zone = board.king_of(!color).map_or(0, |k| attacks::king_attacks(k).0 | 1u64 << k as u32);
        let sets = [
            (board.knights().0 & own, 0usize),
            (board.bishops().0 & own, 1),
            (board.rooks().0 & own, 2),
            (board.queens().0 & own, 3),
        ];
        for (set, i) in sets {
            let [wm, we] = p.mobility[i];
            let base = MOBILITY_BASE[i];
            for sq in Bitboard(set) {
                let att = match i {
                    0 => attacks::knight_attacks(sq),
                    1 => attacks::bishop_attacks(sq, occ_raw),
                    2 => attacks::rook_attacks(sq, occ_raw),
                    _ => attacks::queen_attacks(sq, occ_raw),
                };
                let n = (att.0 & safe).count_ones() as i32 - base;
                mg += sign * (wm * n + p.king_attack[i] * (att.0 & zone).count_ones() as i32);
                eg += sign * we * n;
                if i == 2 {
                    let file = FILE_A << sq.file().to_usize();
                    if pawns & file == 0 {
                        mg += sign * p.rook_open[0];
                        eg += sign * p.rook_open[1];
                    } else if own_pawns & file == 0 {
                        mg += sign * p.rook_half_open[0];
                        eg += sign * p.rook_half_open[1];
                    }
                }
            }
        }
        for sq in Bitboard(own_pawns) {
            let file = sq.file().to_usize() as u32;
            let raw = sq.rank().to_usize() as u32;
            let files = (FILE_A << file) | ((FILE_A << file) & !FILE_H) << 1 | ((FILE_A << file) & !FILE_A) >> 1;
            let ahead = match color {
                Color::White => if raw == 7 { 0 } else { !0u64 << (8 * (raw + 1)) },
                Color::Black => (1u64 << (8 * raw)) - 1,
            };
            // Blocked by an enemy pawn in front or beside, or the rear pawn of a doubled pair.
            if enemy_pawns & files & ahead != 0 || own_pawns & (FILE_A << file) & ahead != 0 {
                continue;
            }
            let rank = if color == Color::White { raw } else { 7 - raw } as usize;
            mg += sign * p.passer_mg[rank];
            eg += sign * p.passer_eg[rank];
            let stop = match color {
                Color::White => sq.offset(8),
                Color::Black => sq.offset(-8),
            };
            if stop.is_some_and(|s| !occ.contains(s)) {
                mg += sign * p.passer_free_mg[rank];
                eg += sign * p.passer_free_eg[rank];
            }
        }
    }
    (mg, eg)
}

/// Pawn structure and pawn shield (#301), white minus black, as (middlegame, endgame): isolated,
/// doubled and backward pawns, and own pawns on the two ranks in front of a castled king.
#[inline(always)]
fn structure_with(pos: &Chess, p: &Params) -> (i32, i32) {
    let board = pos.board();
    let pawns = board.pawns().0;
    let (mut mg, mut eg) = (0i32, 0i32);
    for color in [Color::White, Color::Black] {
        let sign = if color == Color::White { 1 } else { -1 };
        let own_pawns = pawns & board.by_color(color).0;
        let enemy_att = pawn_attack_set(pawns & board.by_color(!color).0, !color);
        for sq in Bitboard(own_pawns) {
            let file = sq.file().to_usize() as u32;
            let raw = sq.rank().to_usize() as u32;
            let f = FILE_A << file;
            let adj = ((f & !FILE_H) << 1) | ((f & !FILE_A) >> 1);
            let ahead = match color {
                Color::White => if raw == 7 { 0 } else { !0u64 << (8 * (raw + 1)) },
                Color::Black => (1u64 << (8 * raw)) - 1,
            };
            if own_pawns & f & ahead != 0 {
                mg += sign * p.doubled[0];
                eg += sign * p.doubled[1];
            }
            if own_pawns & adj == 0 {
                mg += sign * p.isolated[0];
                eg += sign * p.isolated[1];
            } else if own_pawns & adj & !ahead == 0 {
                let stop = match color {
                    Color::White => sq.offset(8),
                    Color::Black => sq.offset(-8),
                };
                if stop.is_some_and(|s| enemy_att & (1u64 << s as u32) != 0) {
                    mg += sign * p.backward[0];
                    eg += sign * p.backward[1];
                }
            }
        }
        if let Some(k) = board.king_of(color) {
            let kf = k.file().to_usize() as u32;
            let kr = k.rank().to_usize() as u32;
            let rel = if color == Color::White { kr } else { 7 - kr };
            if rel <= 1 && !(3..=4).contains(&kf) {
                let f = FILE_A << kf;
                let files = f | ((f & !FILE_H) << 1) | ((f & !FILE_A) >> 1);
                let rank_bb = |r: u32| 0xffu64 << (8 * r);
                let (r1, r2) = match color {
                    Color::White => (rank_bb(kr + 1), rank_bb(kr + 2)),
                    Color::Black => (rank_bb(kr - 1), rank_bb(kr - 2)),
                };
                mg += sign * (p.pawn_shield[0] * (own_pawns & files & r1).count_ones() as i32
                    + p.pawn_shield[1] * (own_pawns & files & r2).count_ones() as i32);
            }
        }
    }
    (mg, eg)
}

/// The evaluation's parts, all white minus black: (middlegame, endgame, phase 0..24, untapered).
/// `evaluate` combines them as `(mg * phase + eg * (24 - phase)) / 24 + flat`; each part is linear
/// in `p`, which the Texel fit relies on.
#[inline(always)]
pub(crate) fn eval_terms(pos: &Chess, p: &Params) -> (i32, i32, i32, i32) {
    let board = pos.board();
    let (mut mg, mut eg, mut phase) = (0i32, 0i32, 0i32);
    let mut bishops = [0; 2];
    for (sq, piece) in board.iter() {
        let sign = if piece.color == Color::White { 1 } else { -1 };
        let file = sq.file().to_usize() as i32;
        let raw = sq.rank().to_usize() as i32;
        let rank = if piece.color == Color::White { raw } else { 7 - raw };
        let (pm, pe) = placement(p, piece.role, file, rank);
        if piece.role != Role::King {
            let i = piece.role as usize - 1;
            mg += sign * (p.material_mg[i] + pm);
            eg += sign * (p.material_eg[i] + pe);
        } else {
            mg += sign * pm;
            eg += sign * pe;
        }
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
    let (am, ae) = activity_with(pos, p);
    let (sm, se) = structure_with(pos, p);
    mg += am + sm;
    eg += ae + se;
    let mut flat = 0;
    if bishops[Color::White as usize] >= 2 {
        flat += p.bishop_pair;
    }
    if bishops[Color::Black as usize] >= 2 {
        flat -= p.bishop_pair;
    }
    (mg, eg, phase.min(24), flat)
}

/// Static evaluation from the side to move's point of view: material, tapered placement,
/// mobility and passed pawns, and a bishop-pair bonus, with the weights in `PARAMS`.
fn evaluate(pos: &Chess) -> i32 {
    let (mg, eg, phase, flat) = eval_terms(pos, &PARAMS);
    let s = (mg * phase + eg * (24 - phase)) / 24 + flat;
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

/// Static exchange evaluation: the material the side to move nets by playing capture `m` and
/// letting both sides keep recapturing on its target square, each with its least valuable
/// attacker and each free to stop when going on would lose. A swap list over the attackers of the
/// target: the occupancy shrinks as pieces join the exchange, so a slider behind one (an x-ray,
/// e.g. a rook battery) joins in turn. En passant removes the captured pawn from its own square;
/// a pawn that captures onto the last rank becomes a queen. The king captures only when the
/// other side has no attacker left. Pins are ignored. Non-captures score 0.
fn see(pos: &Chess, m: &Move) -> i32 {
    let (Some(from), Some(victim)) = (m.from(), m.capture()) else { return 0 };
    let board = pos.board();
    let to = m.to();
    let last_rank = matches!(to.rank(), Rank::First | Rank::Eighth);
    let mut occ = board.occupied();
    occ.discard(from);
    if m.is_en_passant() {
        occ.discard(Square::from_coords(to.file(), from.rank()));
    }
    let promo_gain = |p: Role| value(p) - value(Role::Pawn);
    // gain[d]: what the side making the d-th capture has netted if the exchange stops after it.
    let mut gain = [0i32; 32];
    gain[0] = value(victim) + m.promotion().map_or(0, promo_gain);
    let mut on_target = m.promotion().unwrap_or(m.role());
    let mut side = !pos.turn();
    let mut d = 0;
    while d + 1 < gain.len() {
        let attackers = board.attacks_to(to, side, occ) & occ;
        let Some((sq, role)) = [Role::Pawn, Role::Knight, Role::Bishop, Role::Rook, Role::Queen, Role::King]
            .into_iter()
            .find_map(|r| (attackers & board.by_role(r)).first().map(|sq| (sq, r)))
        else {
            break;
        };
        if role == Role::King && !(board.attacks_to(to, !side, occ.without(sq)) & occ.without(sq)).is_empty() {
            break;
        }
        let promotes = role == Role::Pawn && last_rank;
        d += 1;
        gain[d] = value(on_target) + if promotes { promo_gain(Role::Queen) } else { 0 } - gain[d - 1];
        on_target = if promotes { Role::Queen } else { role };
        occ.discard(sq);
        side = !side;
    }
    while d > 0 {
        gain[d - 1] = -(-gain[d - 1]).max(gain[d]);
        d -= 1;
    }
    gain[0]
}

/// Whether a capture can lose material at all: only when the capturing piece is worth more than
/// its victim (otherwise the first capture already banks at least the difference). Lets the
/// callers skip the swap list for most captures.
fn may_lose(m: &Move) -> bool {
    m.capture().is_some_and(|v| value(m.role()) > value(v) && m.promotion().is_none())
}

/// Ordering key for a capture that loses material (SEE < 0): after the killers, above every
/// quiet move's history score, least bad first.
const LOSING_CAPTURE_KEY: i32 = 350_000;

/// The SEE ordering key of `m` if it is a losing capture (and not the TT move); None otherwise,
/// and then the MVV-LVA key stands.
fn losing_capture_key(pos: &Chess, m: &Move, tt_move: Option<Move>) -> Option<i32> {
    if Some(*m) == tt_move || !may_lose(m) {
        return None;
    }
    let s = see(pos, m);
    (s < 0).then_some(LOSING_CAPTURE_KEY + s)
}

/// A quiet move: neither a capture nor a promotion. Only quiets go into the killer slots and the
/// history table; captures and promotions already have their own ordering.
fn is_quiet(m: &Move) -> bool {
    !m.is_capture() && m.promotion().is_none()
}

/// Ordering keys for the two killer slots: below every capture and promotion, above every quiet
/// move's history score (which `HISTORY_MAX` keeps under them).
const KILLER_KEY: [i32; 2] = [400_000, 399_000];
/// History scores are halved once any entry passes this, so they never reach the killer keys.
const HISTORY_MAX: i32 = 300_000;

/// Killer slots (two per ply) and the history table for quiet-move ordering. Fresh at each `go`.
struct Ordering {
    killers: Vec<[Option<Move>; 2]>,
    /// history[side][from][to]: grows by depth*depth whenever that quiet move causes a beta cut-off.
    history: Vec<[[i32; 64]; 64]>,
}

impl Ordering {
    fn new() -> Ordering {
        Ordering { killers: vec![[None; 2]; MAX_DEPTH as usize + 2], history: vec![[[0; 64]; 64]; 2] }
    }

    fn slot(m: &Move) -> (usize, usize) {
        (m.from().map_or(0, |s| s as usize), m.to() as usize)
    }

    /// Ordering key for a move at `ply`: the TT move, captures and promotions as `order_key`, then
    /// the two killers, then quiet moves by history score.
    fn key(&self, m: &Move, tt_move: Option<Move>, side: Color, ply: i32) -> i32 {
        if Some(*m) == tt_move || !is_quiet(m) {
            return order_key(m, tt_move);
        }
        if let Some(k) = self.killers.get(ply as usize) {
            if k[0] == Some(*m) {
                return KILLER_KEY[0];
            }
            if k[1] == Some(*m) {
                return KILLER_KEY[1];
            }
        }
        let (from, to) = Self::slot(m);
        self.history[side as usize][from][to]
    }

    /// Whether `m` sits in one of the two killer slots at `ply`.
    fn is_killer(&self, m: &Move, ply: i32) -> bool {
        self.killers.get(ply as usize).is_some_and(|k| k[0] == Some(*m) || k[1] == Some(*m))
    }

    /// Records a quiet move that caused a beta cut-off at `ply` with `depth` plies left.
    fn cutoff(&mut self, m: &Move, side: Color, ply: i32, depth: u32) {
        if let Some(k) = self.killers.get_mut(ply as usize) {
            if k[0] != Some(*m) {
                k[1] = k[0];
                k[0] = Some(*m);
            }
        }
        let (from, to) = Self::slot(m);
        let h = &mut self.history[side as usize][from][to];
        *h += (depth * depth) as i32;
        if *h > HISTORY_MAX {
            self.history.iter_mut().flatten().flatten().for_each(|v| *v /= 2);
        }
    }
}

/// Late move reductions apply from this remaining depth on, after this many moves have been
/// searched at the node; from `LMR_LATE_INDEX` on (at depth >= 6) the reduction is two plies.
const LMR_MIN_DEPTH: u32 = 3;
const LMR_MIN_INDEX: usize = 3;
const LMR_LATE_INDEX: usize = 8;
/// Null-move pruning applies from this remaining depth on; the null move is searched
/// `NULL_R` plies shallower (`NULL_R_DEEP` from depth `NULL_DEEP_DEPTH` on).
const NULL_MIN_DEPTH: u32 = 3;
const NULL_R: u32 = 2;
const NULL_R_DEEP: u32 = 3;
const NULL_DEEP_DEPTH: u32 = 7;

/// The zugzwang guard: null-move pruning needs the side to move to own a knight, bishop, rook
/// or queen. With only king and pawns, passing can be better than every legal move.
fn has_non_pawn_material(pos: &Chess) -> bool {
    let b = pos.board();
    let ours = b.by_color(pos.turn());
    !(ours & !(b.pawns() | b.kings())).is_empty()
}

struct Search<'a> {
    seen: &'a HashSet<u64>,
    tt: &'a mut Tt,
    use_tt: bool,
    /// Killer moves and history ordering for quiet moves (off: quiets in generation order).
    order: Ordering,
    use_order: bool,
    /// Principal variation search (null windows after the first move) with late move reductions.
    use_pvs: bool,
    /// Null-move pruning at null-window nodes.
    use_null: bool,
    /// Static exchange evaluation: losing captures skipped in quiescence, ordered late in negamax.
    use_see: bool,
    /// Ply of the null move on the current path (-1: none); a null move never follows one.
    null_ply: i32,
    /// Path entries below this index lie before the last null move: they, and the game history,
    /// do not count toward repetition draws inside a null-move search.
    rep_floor: usize,
    /// Null moves tried, and those that cut the node off.
    null_tries: u64,
    null_cuts: u64,
    /// Probes that found this position's entry, and those that cut the node off.
    tt_hits: u64,
    tt_cuts: u64,
    /// Positions scored exactly by the endgame tables.
    tb_hits: u64,
    path: Vec<u64>,
    root_turn: Color,
    deadline: Instant,
    /// All nodes visited, quiescence included (drives the clock check).
    nodes: u64,
    /// Quiescence nodes only.
    qnodes: u64,
    stopped: bool,
    /// Best root move and score of a depth the clock cut short, once its first move completed.
    partial: Option<(Move, i32)>,
}

impl Search<'_> {
    fn draw(&self, turn: Color) -> i32 {
        if turn == self.root_turn {
            -CONTEMPT
        } else {
            CONTEMPT
        }
    }

    /// The exact score of a KQK, KRK or KPK position from the engine's own tables, mate-distance
    /// relative to the root like every mate score. None outside the tables, or when the mate
    /// would not arrive before the fifty-move rule (then the search decides).
    fn table_score(&mut self, pos: &Chess, ply: i32) -> Option<i32> {
        let tb = endgame::probe(pos)?;
        let room = 100 - pos.halfmoves().min(100);
        let s = match tb {
            Tb::Win(d) | Tb::Loss(d) if d >= room => return None,
            Tb::Win(d) => MATE - (ply + d as i32),
            Tb::Loss(d) => -(MATE - (ply + d as i32)),
            Tb::Draw => self.draw(pos.turn()),
        };
        self.tb_hits += 1;
        Some(s)
    }

    fn out_of_time(&mut self) -> bool {
        if !self.stopped && self.nodes & 1023 == 0 && Instant::now() >= self.deadline {
            self.stopped = true;
        }
        self.stopped
    }

    /// Whether a node may try a null move: null window (non-PV), enough depth, not in check, the
    /// previous ply not itself a null move, no mate-range bound, the zugzwang guard, and a
    /// static eval already at or above beta. The root never comes here (`root` searches moves).
    #[allow(clippy::too_many_arguments)]
    fn null_move_ok(&self, pos: &Chess, depth: u32, ply: i32, alpha: i32, beta: i32, in_check: bool) -> bool {
        self.use_null
            && beta - alpha == 1
            && depth >= NULL_MIN_DEPTH
            && !in_check
            && self.null_ply != ply - 1
            && beta.abs() < MATE_BOUND
            && has_non_pawn_material(pos)
            && evaluate(pos) >= beta
    }

    /// Negamax alpha-beta. Scores are from the side to move's point of view.
    fn negamax(&mut self, pos: &Chess, depth: u32, ply: i32, mut alpha: i32, beta: i32) -> i32 {
        self.nodes += 1;
        if self.out_of_time() {
            return 0;
        }
        let h = hash(pos);
        if (self.rep_floor == 0 && self.seen.contains(&h)) || self.path[self.rep_floor..].contains(&h) {
            return self.draw(pos.turn());
        }
        let mut moves = pos.legal_moves();
        if moves.is_empty() {
            return if pos.is_check() { -(MATE - ply) } else { self.draw(pos.turn()) };
        }
        if pos.halfmoves() >= 100 || pos.is_insufficient_material() {
            return self.draw(pos.turn());
        }
        if let Some(s) = self.table_score(pos, ply) {
            return s;
        }
        if depth == 0 {
            return self.quiesce(pos, ply, 0, alpha, beta);
        }
        // The repetition, fifty-move and mate checks above run before the probe, so a stored
        // score never hides a path-dependent draw at this node.
        let mut tt_move = None;
        if self.use_tt {
            if let Some(e) = self.tt.probe(h) {
                self.tt_hits += 1;
                tt_move = decode(e.mv, &moves);
                if e.depth as u32 >= depth {
                    let s = from_tt(e.score, ply);
                    let cut = match e.bound() {
                        EXACT => true,
                        LOWER => s >= beta,
                        _ => s <= alpha,
                    };
                    if cut {
                        self.tt_cuts += 1;
                        return s;
                    }
                }
            }
        }
        let in_check = pos.is_check();
        // Null-move pruning: at a null-window node, if passing still fails high against a
        // reduced search, a real move would too (outside zugzwang, which the material guard
        // keeps out). Never twice in a row, never in check, never near mate scores.
        if self.null_move_ok(pos, depth, ply, alpha, beta, in_check) {
            if let Ok(null) = pos.clone().swap_turn() {
                // swap_turn clears en passant, so the null position hashes on its own.
                let r = if depth >= NULL_DEEP_DEPTH { NULL_R_DEEP } else { NULL_R };
                self.null_tries += 1;
                self.path.push(h);
                let (floor, null_ply) = (self.rep_floor, self.null_ply);
                self.rep_floor = self.path.len();
                self.null_ply = ply;
                let v = -self.negamax(&null, depth - 1 - r, ply + 1, -beta, -beta + 1);
                self.rep_floor = floor;
                self.null_ply = null_ply;
                self.path.pop();
                if self.stopped {
                    return 0;
                }
                if v >= beta {
                    self.null_cuts += 1;
                    return beta;
                }
            }
        }
        let alpha0 = alpha;
        let use_see = self.use_see;
        if self.use_order {
            let side = pos.turn();
            let order = &self.order;
            moves.sort_by_cached_key(|m| {
                let see_key = if use_see { losing_capture_key(pos, m, tt_move) } else { None };
                -see_key.unwrap_or_else(|| order.key(m, tt_move, side, ply))
            });
        } else {
            moves.sort_by_cached_key(|m| {
                let see_key = if use_see { losing_capture_key(pos, m, tt_move) } else { None };
                -see_key.unwrap_or_else(|| order_key(m, tt_move))
            });
        }
        self.path.push(h);
        let mut best = -INF;
        let mut best_move = None;
        for (i, m) in moves.iter().enumerate() {
            let mut child = pos.clone();
            child.play_unchecked(*m);
            let s = if i == 0 || !self.use_pvs {
                -self.negamax(&child, depth - 1, ply + 1, -beta, -alpha)
            } else {
                // Principal variation search: a later move only has to prove it is no better
                // than alpha, so it gets a null window; a fail-high inside (alpha, beta) is
                // re-searched with the full window. Late quiet moves are first searched shallower.
                let r = if self.use_pvs
                    && depth >= LMR_MIN_DEPTH
                    && !in_check
                    && i >= LMR_MIN_INDEX
                    && is_quiet(m)
                    && Some(*m) != tt_move
                    && !self.order.is_killer(m, ply)
                    && !child.is_check()
                {
                    if depth >= 6 && i >= LMR_LATE_INDEX {
                        2
                    } else {
                        1
                    }
                } else {
                    0
                };
                let mut v = -self.negamax(&child, depth - 1 - r, ply + 1, -alpha - 1, -alpha);
                if r > 0 && v > alpha && !self.stopped {
                    v = -self.negamax(&child, depth - 1, ply + 1, -alpha - 1, -alpha);
                }
                if v > alpha && v < beta && !self.stopped {
                    v = -self.negamax(&child, depth - 1, ply + 1, -beta, -alpha);
                }
                v
            };
            if self.stopped {
                break;
            }
            if s > best {
                best = s;
                best_move = Some(*m);
                if s > alpha {
                    alpha = s;
                    if alpha >= beta {
                        if self.use_order && is_quiet(m) {
                            self.order.cutoff(m, pos.turn(), ply, depth);
                        }
                        break;
                    }
                }
            }
        }
        self.path.pop();
        if self.use_tt && !self.stopped {
            let bound = if best <= alpha0 {
                UPPER
            } else if best >= beta {
                LOWER
            } else {
                EXACT
            };
            self.tt.store(h, depth, ply, best, bound, best_move);
        }
        best
    }

    /// Quiescence search at the alpha-beta leaves: settle captures before trusting the static
    /// evaluation. Out of check the side to move may stand pat on `evaluate`; then only captures
    /// and queen promotions are searched, MVV-LVA first, with delta pruning outside late
    /// endgames. In check there is no standing pat: every evasion is searched so mates are seen.
    fn quiesce(&mut self, pos: &Chess, ply: i32, qply: i32, mut alpha: i32, beta: i32) -> i32 {
        self.nodes += 1;
        self.qnodes += 1;
        if self.out_of_time() {
            return 0;
        }
        if let Some(s) = self.table_score(pos, ply) {
            return s;
        }
        let in_check = pos.is_check();
        if qply >= MAX_QPLY {
            return evaluate(pos);
        }
        let mut moves = pos.legal_moves();
        if in_check && moves.is_empty() {
            return -(MATE - ply);
        }
        let mut best = -INF;
        let mut stand = -INF;
        if !in_check {
            if pos.is_insufficient_material() {
                return self.draw(pos.turn());
            }
            stand = evaluate(pos);
            if stand >= beta {
                return stand;
            }
            best = stand;
            alpha = alpha.max(stand);
            let use_see = self.use_see;
            // Out of check, a capture that loses material by static exchange is not searched:
            // standing pat already scores better than it can (QxP defended by a pawn).
            moves.retain(|m| match m.promotion() {
                Some(p) => p == Role::Queen,
                None => m.is_capture() && !(use_see && may_lose(m) && see(pos, m) < 0),
            });
        }
        moves.sort_unstable_by_key(|m| -order_key(m, None));
        let delta = !in_check && phase(pos) > ENDGAME_PHASE;
        for m in &moves {
            if delta {
                let gain = m.capture().map_or(0, value)
                    + m.promotion().map_or(0, |p| value(p) - value(Role::Pawn));
                if stand + gain + DELTA_MARGIN < alpha {
                    continue;
                }
            }
            let mut child = pos.clone();
            child.play_unchecked(*m);
            let s = -self.quiesce(&child, ply + 1, qply + 1, -beta, -alpha);
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
            self.partial = best;
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
    nodes: u64,
    qnodes: u64,
    tt_hits: u64,
    tt_cuts: u64,
    tb_hits: u64,
    null_tries: u64,
    null_cuts: u64,
    /// The move comes from a depth the hard stop cut short (`depth` is the last completed one).
    #[cfg_attr(not(test), allow(dead_code))]
    partial: bool,
}

/// How a search spends its `go <ms>`. `hard` is when the search stops wherever it is; a new depth
/// starts only while `soft` allows it. With `predict`, that check uses the next iteration's
/// expected cost (the last iteration's time times the measured growth per ply) instead of a fixed
/// cut-off; with `partial`, a depth cut short by `hard` still counts once its first root move (the
/// previous best) has been searched: any move that beat it did so at the new depth.
#[derive(Clone, Copy)]
struct Clock {
    start: Instant,
    hard: Duration,
    soft: Duration,
    predict: bool,
    partial: bool,
}

/// Growth per ply assumed before two iterations have been timed, and the clamp on the measured one.
const BRANCH_DEFAULT: f64 = 3.0;
const BRANCH_MIN: f64 = 1.5;
const BRANCH_MAX: f64 = 6.0;
/// Iterations faster than this are too noisy to measure the growth from.
const BRANCH_FLOOR: Duration = Duration::from_micros(500);
/// Share of the next iteration that must fit before the hard stop for it to start. Its first root
/// move (the previous best, searched with a full window) took a median 35% of an iteration over
/// the 8 TT FENs (8-66%), and with `partial` that move alone is a usable result. Smaller after an
/// unstable iteration, where a deeper look is worth more.
const START_SHARE: f64 = 0.4;
const START_SHARE_UNSTABLE: f64 = 0.25;
/// A score this much below the previous depth's counts as unstable.
const SCORE_DROP: i32 = 40;

impl Clock {
    /// No clock beyond the two given limits: a fixed cut-off at `soft`, as before #186.
    fn fixed(hard: Duration, soft: Duration) -> Clock {
        Clock { start: Instant::now(), hard, soft, predict: false, partial: false }
    }

    /// The policy before #186: stop at 60% of the budget, start no depth after 30%.
    #[cfg(test)]
    fn legacy(start: Instant, budget_ms: u64) -> Clock {
        let hard = Duration::from_millis(budget_ms * 6 / 10);
        let soft = Duration::from_millis(budget_ms * 3 / 10);
        Clock { start, hard, soft, predict: false, partial: false }
    }

    /// The game clock: stop with a safety margin left for unwinding, output and the slower wasm
    /// build (a tenth of the budget, at least 15 ms, at most 100 ms), and start a depth only when
    /// its predicted cost fits.
    fn for_budget(start: Instant, budget_ms: u64) -> Clock {
        let margin = (budget_ms / 10).clamp(15, 100).min(budget_ms / 2);
        let hard = Duration::from_millis(budget_ms - margin);
        Clock { start, hard, soft: hard, predict: true, partial: true }
    }
}

/// Iterative deepening: depth 1, 2, 3, ... until the clock says stop. Returns the best move of the
/// deepest depth searched far enough to trust (see `Clock`).
#[cfg(test)]
fn search(pos: &Chess, seen: &HashSet<u64>, budget_ms: u64) -> Option<Outcome> {
    search_from(pos, seen, Instant::now(), budget_ms)
}

/// `search` with the budget counted from `start` (when the `go` arrived).
fn search_from(pos: &Chess, seen: &HashSet<u64>, start: Instant, budget_ms: u64) -> Option<Outcome> {
    let clock = Clock::for_budget(start, budget_ms);
    TT.with(|tt| run_clock(pos, seen, clock, MAX_DEPTH, &mut tt.borrow_mut(), true, true, true, true, true, &[]))
}

/// Fixed-depth search with no clock and a fresh table: deterministic, for tests and measurement.
#[cfg(test)]
fn search_depth(pos: &Chess, seen: &HashSet<u64>, depth: u32) -> Option<Outcome> {
    search_depth_with(pos, seen, depth, &mut Tt::new(16), true)
}

/// Fixed-depth search on a given table, with the table on or off.
#[cfg(test)]
fn search_depth_with(pos: &Chess, seen: &HashSet<u64>, depth: u32, tt: &mut Tt, use_tt: bool) -> Option<Outcome> {
    search_depth_feats(pos, seen, depth, tt, use_tt, true, true)
}

/// Fixed-depth search with the table and the killer/history ordering each on or off.
#[cfg(test)]
fn search_depth_opts(
    pos: &Chess,
    seen: &HashSet<u64>,
    depth: u32,
    tt: &mut Tt,
    use_tt: bool,
    use_order: bool,
) -> Option<Outcome> {
    search_depth_feats(pos, seen, depth, tt, use_tt, use_order, false)
}

/// Fixed-depth search with the table, the ordering and PVS + LMR each on or off.
#[cfg(test)]
fn search_depth_feats(
    pos: &Chess,
    seen: &HashSet<u64>,
    depth: u32,
    tt: &mut Tt,
    use_tt: bool,
    use_order: bool,
    use_pvs: bool,
) -> Option<Outcome> {
    let day = Duration::from_secs(86_400);
    run(pos, seen, day, day, depth, tt, use_tt, use_order, use_pvs, &[])
}

/// Iterative deepening up to `max_depth`, stopping at `hard` and not starting a depth after `soft`.
/// Root moves in `exclude` are not searched (the book generator ranks replies this way).
/// Null-move pruning rides with PVS (its null windows are where it applies).
#[allow(clippy::too_many_arguments)]
fn run(
    pos: &Chess,
    seen: &HashSet<u64>,
    hard: Duration,
    soft: Duration,
    max_depth: u32,
    tt: &mut Tt,
    use_tt: bool,
    use_order: bool,
    use_pvs: bool,
    exclude: &[Move],
) -> Option<Outcome> {
    run_feats(pos, seen, hard, soft, max_depth, tt, use_tt, use_order, use_pvs, use_pvs, exclude)
}

/// `run` with null-move pruning switched on or off on its own.
#[allow(clippy::too_many_arguments)]
fn run_feats(
    pos: &Chess,
    seen: &HashSet<u64>,
    hard: Duration,
    soft: Duration,
    max_depth: u32,
    tt: &mut Tt,
    use_tt: bool,
    use_order: bool,
    use_pvs: bool,
    use_null: bool,
    exclude: &[Move],
) -> Option<Outcome> {
    run_opts(pos, seen, hard, soft, max_depth, tt, use_tt, use_order, use_pvs, use_null, true, exclude)
}

/// `run_feats` with static exchange evaluation switched on or off as well.
#[allow(clippy::too_many_arguments)]
fn run_opts(
    pos: &Chess,
    seen: &HashSet<u64>,
    hard: Duration,
    soft: Duration,
    max_depth: u32,
    tt: &mut Tt,
    use_tt: bool,
    use_order: bool,
    use_pvs: bool,
    use_null: bool,
    use_see: bool,
    exclude: &[Move],
) -> Option<Outcome> {
    let clock = Clock::fixed(hard, soft);
    run_clock(pos, seen, clock, max_depth, tt, use_tt, use_order, use_pvs, use_null, use_see, exclude)
}

/// The iterative-deepening loop under a `Clock`.
#[allow(clippy::too_many_arguments)]
fn run_clock(
    pos: &Chess,
    seen: &HashSet<u64>,
    clock: Clock,
    max_depth: u32,
    tt: &mut Tt,
    use_tt: bool,
    use_order: bool,
    use_pvs: bool,
    use_null: bool,
    use_see: bool,
    exclude: &[Move],
) -> Option<Outcome> {
    let start = clock.start;
    let mut moves: Vec<Move> = pos.legal_moves().into_iter().filter(|m| !exclude.contains(m)).collect();
    tt.new_search(pos.turn());
    // The root is never cut off; its stored move (from the previous `go`) only orders.
    let tt_move = if use_tt { tt.probe(hash(pos)).and_then(|e| decode(e.mv, &moves)) } else { None };
    moves.sort_by_key(|m| -order_key(m, tt_move));
    let first = *moves.first()?;
    let mut out =
        Outcome { best: first, score: 0, depth: 0, nodes: 0, qnodes: 0, tt_hits: 0, tt_cuts: 0, tb_hits: 0, null_tries: 0, null_cuts: 0, partial: false };
    if moves.len() == 1 {
        return Some(out);
    }
    let mut s = Search {
        seen,
        tt,
        use_tt,
        order: Ordering::new(),
        use_order,
        use_pvs,
        use_null,
        use_see,
        null_ply: -1,
        rep_floor: 0,
        null_tries: 0,
        null_cuts: 0,
        tt_hits: 0,
        tt_cuts: 0,
        tb_hits: 0,
        path: Vec::with_capacity(MAX_DEPTH as usize + 1),
        root_turn: pos.turn(),
        deadline: start + clock.hard,
        nodes: 0,
        qnodes: 0,
        stopped: false,
        partial: None,
    };
    // Time of the previous completed iteration, for the growth per ply.
    let mut before = Duration::ZERO;
    let mut iter_start = Instant::now();
    for depth in 1..=max_depth {
        let Some((m, score)) = s.root(pos, &moves, depth) else {
            // Cut short by the hard stop: keep the new depth's best if its first move finished.
            if clock.partial {
                if let Some((m, score)) = s.partial {
                    out = Outcome { best: m, score, partial: true, ..out };
                }
            }
            break;
        };
        let unstable = depth > 1 && (m != out.best || score < out.score - SCORE_DROP);
        out = Outcome { best: m, score, depth, ..out };
        if use_tt {
            s.tt.store(hash(pos), depth, 0, score, EXACT, Some(m));
        }
        // Best move first for the next iteration.
        if let Some(i) = moves.iter().position(|x| *x == m) {
            moves[..=i].rotate_right(1);
        }
        // A mate inside the searched depth cannot be beaten by searching deeper. A longer one can:
        // the endgame tables score mates far beyond the horizon, and a shorter mate may still exist.
        let mate_in = MATE - score.abs();
        if score.abs() > MATE_BOUND && mate_in <= depth as i32 {
            break;
        }
        let now = Instant::now();
        let last = now - iter_start;
        let elapsed = now - start;
        let fits = next_fits(elapsed, last, before, clock.soft, unstable);
        (before, iter_start) = (last, now);
        if clock.predict {
            if !fits {
                break;
            }
        } else if elapsed >= clock.soft {
            break;
        }
    }
    out.nodes = s.nodes;
    out.qnodes = s.qnodes;
    out.tt_hits = s.tt_hits;
    out.tt_cuts = s.tt_cuts;
    out.tb_hits = s.tb_hits;
    out.null_tries = s.null_tries;
    out.null_cuts = s.null_cuts;
    Some(out)
}

/// Quiescence score of `pos` for the side to move, with no clock. The Texel generator keeps a
/// position only when this equals the static evaluation (nothing hangs).
pub(crate) fn quiesce_score(pos: &Chess) -> i32 {
    let seen = HashSet::new();
    let mut tt = Tt::new(1);
    let mut s = Search {
        seen: &seen,
        tt: &mut tt,
        use_tt: false,
        order: Ordering::new(),
        use_order: false,
        use_pvs: false,
        use_null: false,
        use_see: true,
        null_ply: -1,
        rep_floor: 0,
        null_tries: 0,
        null_cuts: 0,
        tt_hits: 0,
        tt_cuts: 0,
        tb_hits: 0,
        path: Vec::new(),
        root_turn: pos.turn(),
        deadline: Instant::now() + Duration::from_secs(86_400),
        nodes: 0,
        qnodes: 0,
        stopped: false,
        partial: None,
    };
    s.quiesce(pos, 0, 0, -INF, INF)
}

/// Whether the next depth is worth starting: its predicted cost (the last iteration's time times
/// the growth per ply, measured from the last two iterations and clamped) must fit before `limit`,
/// or at least the share of it that yields a usable result.
fn next_fits(elapsed: Duration, last: Duration, before: Duration, limit: Duration, unstable: bool) -> bool {
    let growth = if before >= BRANCH_FLOOR {
        (last.as_secs_f64() / before.as_secs_f64()).clamp(BRANCH_MIN, BRANCH_MAX)
    } else {
        BRANCH_DEFAULT
    };
    let share = if unstable { START_SHARE_UNSTABLE } else { START_SHARE };
    let predicted = last.as_secs_f64() * growth;
    elapsed.as_secs_f64() + predicted * share <= limit.as_secs_f64()
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
        Some("game") => {
            TT.with(|tt| tt.borrow_mut().clear());
            (Some("ready".into()), false)
        }
        Some("position") => {
            *moves = parts.map(String::from).collect();
            (None, false)
        }
        Some("go") => {
            let start = Instant::now();
            let budget = parts.next().and_then(|s| s.parse().ok()).unwrap_or(1000);
            let Some((pos, seen)) = replay(moves) else { return (Some("bestmove 0000".into()), false) };
            if let Some(m) = book::probe(&pos) {
                let mut child = pos.clone();
                child.play_unchecked(m);
                // A book move that would repeat a position is left to the search (contempt).
                if !seen.contains(&hash(&child)) {
                    return (Some(format!("info book 1\nbestmove {}", UciMove::from_standard(m))), false);
                }
            }
            let reply = match search_from(&pos, &seen, start, budget) {
                Some(o) => format!(
                    "info depth {} score {} nodes {} qnodes {} tthits {} ttcuts {} tbhits {}\nbestmove {}",
                    o.depth,
                    o.score,
                    o.nodes,
                    o.qnodes,
                    o.tt_hits,
                    o.tt_cuts,
                    o.tb_hits,
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
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("book") {
        book::tool(&args[1..]);
        return;
    }
    if args.first().map(String::as_str) == Some("texel") {
        texel::tool(&args[1..]);
        return;
    }
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

    fn mirrored(pos: &Chess) -> Chess {
        let setup = pos.clone().to_setup(EnPassantMode::Legal).into_mirrored();
        <Chess as shakmaty::FromSetup>::from_setup(setup, shakmaty::CastlingMode::Standard).unwrap()
    }

    /// Evaluation from White's point of view.
    fn white_eval(pos: &Chess) -> i32 {
        if pos.turn() == Color::White { evaluate(pos) } else { -evaluate(pos) }
    }

    #[test]
    fn symmetric_positions_evaluate_to_zero() {
        for fen in [
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            "r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 4 4",
            "4k3/1p4p1/8/3p4/3P4/8/1P4P1/4K3 w - - 0 1",
            "3rk3/8/2n5/p6p/P6P/2N5/8/3RK3 b - - 0 1",
        ] {
            let pos = from_fen(fen);
            assert_eq!(activity(&pos), (0, 0), "{fen}");
            assert_eq!(evaluate(&pos), 0, "{fen}");
        }
    }

    #[test]
    fn a_mirrored_position_negates() {
        for fen in TT_FENS.iter().chain(MATE_IN_3.iter()) {
            let pos = from_fen(fen);
            let m = mirrored(&pos);
            let (am, ae) = activity(&pos);
            assert_eq!(activity(&m), (-am, -ae), "{fen}");
            assert_eq!(white_eval(&m), -white_eval(&pos), "{fen}");
            assert_eq!(evaluate(&m), evaluate(&pos), "{fen}");
        }
    }

    #[test]
    fn a_passed_pawn_on_the_seventh_beats_one_on_the_fourth() {
        let seventh = from_fen("4k3/2P5/8/8/8/8/8/4K3 w - - 0 1");
        let fourth = from_fen("4k3/8/8/8/2P5/8/8/4K3 w - - 0 1");
        assert!(activity(&seventh).1 > activity(&fourth).1);
        assert!(activity(&seventh).0 > activity(&fourth).0);
        // An enemy pawn on an adjacent file ahead of it stops it being passed.
        let held = from_fen("4k3/1p6/8/8/2P5/8/8/4K3 w - - 0 1");
        let free = from_fen("4k3/p7/8/8/2P5/8/8/4K3 w - - 0 1");
        assert!(activity(&free).1 > activity(&held).1);
        // Free stop square counts extra.
        let blocked = from_fen("8/8/2k5/2P5/8/8/8/4K3 w - - 0 1");
        let open = from_fen("8/8/k7/2P5/8/8/8/4K3 w - - 0 1");
        assert!(activity(&open).1 > activity(&blocked).1);
        // The rear pawn of a doubled pair is not a second passer.
        let doubled = from_fen("4k3/8/8/2P5/2P5/8/8/4K3 w - - 0 1");
        let single = from_fen("4k3/8/8/2P5/8/8/8/4K3 w - - 0 1");
        assert_eq!(activity(&doubled), activity(&single));
    }

    /// `PARAMS` with every weight 0 except the #301 term `set` turns on, so a term reads as a count.
    fn only(set: impl Fn(&mut Params)) -> Params {
        let mut p = Params {
            material_mg: [0; 5],
            material_eg: [0; 5],
            pawn_advance: [0; 2],
            pawn_centre: [0; 8],
            knight_centre: [0; 2],
            bishop_centre: [0; 2],
            queen_centre: [0; 2],
            bishop_back: 0,
            rook_seventh: [0; 2],
            rook_back_centre: 0,
            queen_off_back: 0,
            king_shelter: 0,
            king_advance: 0,
            king_centre_eg: 0,
            mobility: [[0; 2]; 4],
            passer_mg: [0; 8],
            passer_eg: [0; 8],
            passer_free_mg: [0; 8],
            passer_free_eg: [0; 8],
            bishop_pair: 0,
            king_attack: [0; 4],
            pawn_shield: [0; 2],
            isolated: [0; 2],
            doubled: [0; 2],
            backward: [0; 2],
            rook_open: [0; 2],
            rook_half_open: [0; 2],
        };
        set(&mut p);
        p
    }

    fn count(fen: &str, p: &Params) -> (i32, i32) {
        let (mg, eg, _, flat) = eval_terms(&from_fen(fen), p);
        assert_eq!(flat, 0);
        (mg, eg)
    }

    #[test]
    fn pawn_structure_terms_count_the_right_pawns() {
        let iso = only(|p| p.isolated = [1, 2]);
        // White: a2 isolated, c2 + c3 doubled and isolated, g2 h2 fine. Black: h7 alone is isolated.
        assert_eq!(count("4k3/7p/8/8/8/2P5/P1P3PP/4K3 w - - 0 1", &iso), (3 - 1, 6 - 2));
        let dbl = only(|p| p.doubled = [1, 1]);
        assert_eq!(count("4k3/8/8/8/8/2P5/2P5/4K3 w - - 0 1", &dbl), (1, 1));
        assert_eq!(count("4k3/2p5/2p5/2p5/8/8/8/4K3 w - - 0 1", &dbl), (-2, -2));
        // d2 has no own pawn beside or behind it on c/e (e3 is ahead) and c4 hits its stop d3.
        let back = only(|p| p.backward = [1, 1]);
        assert_eq!(count("4k3/8/8/8/2p5/4P3/3P4/4K3 w - - 0 1", &back), (1, 1));
        // The same pawn with its stop square free of enemy pawn attacks is not backward.
        assert_eq!(count("4k3/8/8/8/8/4P3/3P4/4K3 w - - 0 1", &back), (0, 0));
    }

    #[test]
    fn rook_files_and_king_safety_terms() {
        let open = only(|p| {
            p.rook_open = [1, 10];
            p.rook_half_open = [100, 1000];
        });
        // White rook on the open d file; black rook on the e file holding only a white pawn.
        assert_eq!(count("4r1k1/8/8/8/8/8/4P3/3R2K1 w - - 0 1", &open), (1 - 100, 10 - 1000));
        let shield = only(|p| p.pawn_shield = [1, 10]);
        // White king g1 with f2, g2 one rank ahead and h3 two ahead; black king on e8 is not castled.
        assert_eq!(count("4k3/pppppppp/8/8/8/7P/5PP1/6K1 w - - 0 1", &shield), (12, 0));
        // Black castled on g8 with f7, g6, h7.
        assert_eq!(count("6k1/5p1p/6p1/8/8/8/8/3K4 w - - 0 1", &shield), (-12, 0));
        let attack = only(|p| p.king_attack = [1, 10, 100, 1000]);
        // Zone of g8: f8 g8 h8 f7 g7 h7. Queen h5 attacks h7, h8 (file) and f7 (diagonal).
        assert_eq!(count("6k1/8/8/7Q/8/8/8/K7 w - - 0 1", &attack), (3000, 0));
        // Knight on f5 attacks g7 and h6; zone of g8 holds g7: 1.
        assert_eq!(count("6k1/8/8/5N2/8/8/8/K7 w - - 0 1", &attack), (1, 0));
    }

    /// Evaluation cost report for #179: run with `cargo test --release -p chess-engine eval_report
    /// -- --ignored --nocapture`. Prints the activity terms, fixed-depth nodes and `go 200` depth,
    /// nodes and node rate over the TT FENs.
    #[test]
    #[ignore]
    fn eval_report() {
        for fen in TT_FENS {
            let pos = from_fen(fen);
            println!("activity {:?} eval {} {fen}", activity(&pos), evaluate(&pos));
        }
        for depth in [5, 6] {
            let (mut nodes, mut ms) = (0u64, 0u128);
            for fen in TT_FENS {
                let t = Instant::now();
                let o = search_depth(&from_fen(fen), &HashSet::new(), depth).unwrap();
                ms += t.elapsed().as_millis();
                nodes += o.nodes;
            }
            println!("fixed d{depth}: nodes {nodes} in {ms} ms");
        }
        let (mut nodes, mut us) = (0u64, 0u128);
        for fen in TT_FENS {
            let pos = from_fen(fen);
            let hard = Duration::from_millis(120);
            let soft = Duration::from_millis(60);
            let t = Instant::now();
            let o = run(&pos, &HashSet::new(), hard, soft, MAX_DEPTH, &mut Tt::new(TT_BITS), true, true, true, &[]).unwrap();
            us += t.elapsed().as_micros();
            nodes += o.nodes;
            println!("go 200: depth {} nodes {} qnodes {} {fen}", o.depth, o.nodes, o.qnodes);
        }
        println!("go 200 rate: {:.0} knps", nodes as f64 * 1000.0 / us as f64);
    }

    #[test]
    fn mobility_swing_stays_below_a_pawn() {
        // The whole mobility + passer term in ordinary opening and middlegame positions.
        for fen in TT_FENS.iter().take(4).chain(MATE_IN_3.iter().take(2)) {
            let pos = from_fen(fen);
            let (mg, _) = activity(&pos);
            assert!(mg.abs() < 100, "{fen}: {mg}");
        }
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
    fn depth_one_does_not_hang_the_queen() {
        // Qxd5 wins a pawn on the static eval but exd5 takes the queen back; quiescence sees it.
        let pos = from_fen("4k3/8/4p3/3p4/8/8/8/3QK3 w - - 0 1");
        let out = search_depth(&pos, &HashSet::new(), 1).unwrap();
        assert_ne!(UciMove::from_standard(out.best).to_string(), "d1d5");
        assert!(out.qnodes > 0);
        // And it still takes a pawn that is truly loose.
        let pos = from_fen("4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1");
        let out = search_depth(&pos, &HashSet::new(), 1).unwrap();
        assert_eq!(UciMove::from_standard(out.best).to_string(), "d1d5");
    }

    #[test]
    fn quiescence_searches_evasions_in_check() {
        // Fixed depth 1: Qxf7 is mate (Scholar's); the leaf is in check, so quiescence must search
        // evasions (finding none) instead of standing pat on the material.
        let (pos, seen) = replay(&moves("e2e4 e7e5 d1h5 b8c6 f1c4 g8f6")).unwrap();
        let out = search_depth(&pos, &seen, 1).unwrap();
        assert_eq!(UciMove::from_standard(out.best).to_string(), "h5f7");
        assert_eq!(out.score, MATE - 1);
        // A quiet-looking leaf where the side to move is mated: qsearch in check finds no evasion.
        let mated = from_fen("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1");
        let mut tt = Tt::new(4);
        let mut s = Search {
            seen: &HashSet::new(),
            tt: &mut tt,
            use_tt: false,
            order: Ordering::new(),
            use_order: false,
            use_pvs: false,
            use_null: false,
            use_see: true,
            null_ply: -1,
            rep_floor: 0,
            null_tries: 0,
            null_cuts: 0,
            tt_hits: 0,
            tt_cuts: 0,
            tb_hits: 0,
            path: Vec::new(),
            root_turn: Color::White,
            deadline: Instant::now() + Duration::from_secs(86_400),
            nodes: 0,
            qnodes: 0,
            stopped: false,
            partial: None,
        };
        assert_eq!(s.quiesce(&mated, 3, 0, -INF, INF), -(MATE - 3));
    }

    #[test]
    fn info_line_reports_quiescence_nodes() {
        let mut mv = Vec::new();
        handle("position e2e4 d7d5", &mut mv);
        let reply = handle("go 100", &mut mv).0.unwrap();
        let info = reply.lines().next().unwrap();
        assert!(info.starts_with("info depth ") && info.contains(" qnodes "), "{info}");
        assert!(info.contains(" tthits ") && info.contains(" ttcuts "), "{info}");
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

    /// Positions for the TT-on/off comparison: opening, open and closed middlegames, a tactical
    /// melee, endgames with pawns and a rook ending.
    const TT_FENS: [&str; 8] = [
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4",
        "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
        "r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 8",
        "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
        "8/8/4k3/3p4/3P4/4K3/8/8 w - - 0 1",
        "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1",
        "2r3k1/pp3ppp/4p3/3pP3/3P4/P4N2/1P3PPP/2R3K1 w - - 0 1",
    ];

    #[test]
    fn tt_keeps_move_and_score_with_fewer_nodes() {
        // Same fixed depth, table off vs on: the move and score must match and the table must
        // save nodes overall.
        let (mut off_nodes, mut on_nodes, mut cuts) = (0u64, 0u64, 0u64);
        for fen in TT_FENS {
            let pos = from_fen(fen);
            // Killer/history ordering off on both sides, so this measures the table alone.
            let off = search_depth_opts(&pos, &HashSet::new(), 4, &mut Tt::new(4), false, false).unwrap();
            let on = search_depth_opts(&pos, &HashSet::new(), 4, &mut Tt::new(18), true, false).unwrap();
            assert_eq!((off.best, off.score), (on.best, on.score), "{fen}");
            assert!(on.nodes <= off.nodes, "{fen}: {} vs {}", on.nodes, off.nodes);
            cuts += on.tt_cuts;
            off_nodes += off.nodes;
            on_nodes += on.nodes;
        }
        assert!(cuts > 0);
        assert!(on_nodes * 10 < off_nodes * 7, "{on_nodes} vs {off_nodes}");
    }

    #[test]
    fn mate_through_the_table_keeps_its_distance() {
        // Mate scores are stored node-relative and read back root-relative.
        let mut tt = Tt::new(8);
        tt.new_search(Color::White);
        tt.store(42, 3, 5, MATE - 7, EXACT, None); // mate 2 plies below a node at ply 5
        assert_eq!(from_tt(tt.probe(42).unwrap().score, 1), MATE - 3);
        tt.store(43, 3, 4, -(MATE - 6), EXACT, None);
        assert_eq!(from_tt(tt.probe(43).unwrap().score, 2), -(MATE - 4));

        // In a real search: this rook ladder is mate in three (MATE - 5). After white's first
        // move and black's best defence, the table already holds the positions below as mates
        // found from ply 2; a new search rooted there on the same table (same side to move, so
        // the table is kept) must cut them off and still report mate in two (MATE - 3), exactly
        // as a fresh table does.
        let pos = from_fen("8/8/7k/8/8/8/1R6/R1K5 w - - 0 1");
        let mut tt = Tt::new(16);
        let out = search_depth_with(&pos, &HashSet::new(), 6, &mut tt, true).unwrap();
        assert_eq!(out.score, MATE - 5);
        let mut after = pos.clone();
        after.play_unchecked(out.best);
        let defence = search_depth(&after, &HashSet::new(), 5).unwrap();
        assert_eq!(defence.score, -(MATE - 4));
        after.play_unchecked(defence.best);
        let reused = search_depth_with(&after, &HashSet::new(), 4, &mut tt, true).unwrap();
        let fresh = search_depth(&after, &HashSet::new(), 4).unwrap();
        assert!(reused.tt_cuts > 0);
        assert_eq!(reused.score, MATE - 3);
        assert_eq!(fresh.score, MATE - 3);
    }

    #[test]
    fn stored_moves_are_checked_for_legality() {
        // A code that matches no legal move decodes to nothing; a legal one round-trips,
        // promotions and castling included.
        let pos = from_fen("r3k2r/1P6/8/8/8/8/8/R3K2R w KQkq - 0 1");
        let moves: Vec<Move> = pos.legal_moves().into_iter().collect();
        for m in &moves {
            assert_eq!(decode(encode(m), &moves), Some(*m));
        }
        assert_eq!(decode(0, &moves), None);
        let other = from_fen("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
        let few: Vec<Move> = other.legal_moves().into_iter().collect();
        let promo = moves.iter().find(|m| m.promotion().is_some()).unwrap();
        assert_eq!(decode(encode(promo), &few), None);
    }

    #[test]
    #[ignore = "measurement: cargo test --release -p chess-engine tt_report -- --ignored --nocapture"]
    fn tt_report() {
        for depth in [3u32, 4, 5] {
            let (mut off_n, mut on_n, mut same) = (0u64, 0u64, 0);
            for fen in TT_FENS {
                let pos = from_fen(fen);
                let off = search_depth_with(&pos, &HashSet::new(), depth, &mut Tt::new(4), false).unwrap();
                let on = search_depth_with(&pos, &HashSet::new(), depth, &mut Tt::new(TT_BITS), true).unwrap();
                if (off.best, off.score) == (on.best, on.score) {
                    same += 1;
                } else {
                    println!("  d{depth} differs {fen}: off {:?} {} on {:?} {}", off.best, off.score, on.best, on.score);
                }
                off_n += off.nodes;
                on_n += on.nodes;
            }
            println!("depth {depth}: nodes off {off_n} on {on_n} ({:+.1}%), same {same}/8", 100.0 * (on_n as f64 / off_n as f64 - 1.0));
        }
        for (name, fen) in [("start", TT_FENS[0]), ("middlegame", TT_FENS[2]), ("italian", TT_FENS[1])] {
            let pos = from_fen(fen);
            let hard = Duration::from_millis(120);
            let soft = Duration::from_millis(60);
            let off = run(&pos, &HashSet::new(), hard, soft, MAX_DEPTH, &mut Tt::new(4), false, true, true, &[]).unwrap();
            let on = run(&pos, &HashSet::new(), hard, soft, MAX_DEPTH, &mut Tt::new(TT_BITS), true, true, true, &[]).unwrap();
            println!("go 200 {name}: off depth {} nodes {} | on depth {} nodes {} hits {} cuts {}", off.depth, off.nodes, on.depth, on.nodes, on.tt_hits, on.tt_cuts);
        }
    }

    #[test]
    fn ordering_keeps_move_and_score_with_fewer_nodes() {
        // Same fixed depth and table, killers/history off vs on: ordering must not change the
        // minimax result, and it must save nodes overall.
        let (mut off_nodes, mut on_nodes) = (0u64, 0u64);
        for fen in TT_FENS {
            let pos = from_fen(fen);
            let off = search_depth_opts(&pos, &HashSet::new(), 5, &mut Tt::new(18), true, false).unwrap();
            let on = search_depth_opts(&pos, &HashSet::new(), 5, &mut Tt::new(18), true, true).unwrap();
            assert_eq!(off.score, on.score, "{fen}");
            off_nodes += off.nodes;
            on_nodes += on.nodes;
        }
        assert!(on_nodes < off_nodes, "{on_nodes} vs {off_nodes}");
    }

    #[test]
    fn ordering_keeps_tactical_results() {
        // The fixed-depth tactical positions give the same move and score with ordering on or off.
        let cases: [(&str, u32); 5] = [
            ("7k/8/8/8/8/8/1R6/R1K5 w - - 0 1", 4),
            ("7k/8/5KQ1/8/8/8/8/8 w - - 0 1", 3),
            ("4k3/8/4p3/3p4/8/8/8/3QK3 w - - 0 1", 3),
            ("8/8/7k/8/8/8/1R6/R1K5 w - - 0 1", 6),
            ("7k/8/6K1/8/8/8/8/5Q2 w - - 0 1", 4),
        ];
        for (fen, depth) in cases {
            let pos = from_fen(fen);
            let off = search_depth_opts(&pos, &HashSet::new(), depth, &mut Tt::new(16), true, false).unwrap();
            let on = search_depth_opts(&pos, &HashSet::new(), depth, &mut Tt::new(16), true, true).unwrap();
            assert_eq!((off.best, off.score), (on.best, on.score), "{fen}");
        }
    }

    #[test]
    fn killers_and_history_record_quiet_cutoffs_only() {
        let pos = from_fen("r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4");
        let moves: Vec<Move> = pos.legal_moves().into_iter().collect();
        let quiet = *moves.iter().find(|m| is_quiet(m)).unwrap();
        let capture = *moves.iter().find(|m| m.is_capture()).unwrap();
        let mut o = Ordering::new();
        o.cutoff(&quiet, Color::Black, 3, 4);
        assert_eq!(o.key(&quiet, None, Color::Black, 3), KILLER_KEY[0]);
        // Another ply: not a killer there, so the history score (4*4) orders it.
        assert_eq!(o.key(&quiet, None, Color::Black, 4), 16);
        // Captures keep their MVV-LVA key above any killer; the TT move stays first.
        assert!(o.key(&capture, None, Color::Black, 3) > KILLER_KEY[0]);
        assert_eq!(o.key(&quiet, Some(quiet), Color::Black, 3), i32::MAX);
        // A second killer pushes the first into slot two.
        let other = *moves.iter().filter(|m| is_quiet(m)).nth(1).unwrap();
        o.cutoff(&other, Color::Black, 3, 2);
        assert_eq!(o.key(&other, None, Color::Black, 3), KILLER_KEY[0]);
        assert_eq!(o.key(&quiet, None, Color::Black, 3), KILLER_KEY[1]);
        // History is halved before it can climb into the killer keys.
        for _ in 0..100 {
            o.cutoff(&quiet, Color::Black, 10, 64);
        }
        assert!(o.key(&quiet, None, Color::Black, 4) <= HISTORY_MAX);
    }

    #[test]
    #[ignore = "measurement: cargo test --release -p chess-engine order_report -- --ignored --nocapture"]
    fn order_report() {
        for depth in [4u32, 5, 6] {
            let (mut off_n, mut on_n, mut same) = (0u64, 0u64, 0);
            for fen in TT_FENS {
                let pos = from_fen(fen);
                let off = search_depth_opts(&pos, &HashSet::new(), depth, &mut Tt::new(TT_BITS), true, false).unwrap();
                let on = search_depth_opts(&pos, &HashSet::new(), depth, &mut Tt::new(TT_BITS), true, true).unwrap();
                if (off.best, off.score) == (on.best, on.score) {
                    same += 1;
                } else {
                    println!("  d{depth} differs {fen}: off {:?} {} on {:?} {}", off.best, off.score, on.best, on.score);
                }
                println!("  d{depth} {fen}: off {} on {}", off.nodes, on.nodes);
                off_n += off.nodes;
                on_n += on.nodes;
            }
            println!("depth {depth}: nodes off {off_n} on {on_n} ({:+.1}%), same {same}/8", 100.0 * (on_n as f64 / off_n as f64 - 1.0));
        }
        for (name, fen) in [("start", TT_FENS[0]), ("italian", TT_FENS[1]), ("kiwipete", TT_FENS[2])] {
            let pos = from_fen(fen);
            let hard = Duration::from_millis(120);
            let soft = Duration::from_millis(60);
            let off = run(&pos, &HashSet::new(), hard, soft, MAX_DEPTH, &mut Tt::new(TT_BITS), true, false, false, &[]).unwrap();
            let on = run(&pos, &HashSet::new(), hard, soft, MAX_DEPTH, &mut Tt::new(TT_BITS), true, true, false, &[]).unwrap();
            println!("go 200 {name}: off depth {} nodes {} | on depth {} nodes {}", off.depth, off.nodes, on.depth, on.nodes);
        }
    }

    #[test]
    fn pvs_and_lmr_keep_results_near_the_full_search() {
        // Fixed depth 5, ordering on, PVS + LMR off vs on: reductions may change the move only
        // where it scores within a small margin of the unreduced result, and must save nodes.
        let (mut off_nodes, mut on_nodes) = (0u64, 0u64);
        for fen in TT_FENS {
            let pos = from_fen(fen);
            let off = search_depth_feats(&pos, &HashSet::new(), 5, &mut Tt::new(18), true, true, false).unwrap();
            let on = search_depth_feats(&pos, &HashSet::new(), 5, &mut Tt::new(18), true, true, true).unwrap();
            assert!((off.score - on.score).abs() <= 40, "{fen}: off {} on {}", off.score, on.score);
            off_nodes += off.nodes;
            on_nodes += on.nodes;
        }
        assert!(on_nodes < off_nodes, "{on_nodes} vs {off_nodes}");
    }

    #[test]
    fn pvs_and_lmr_keep_mates() {
        // Mate in two (and the other tactical cases) are found with the same move and score.
        let cases: [(&str, u32); 5] = [
            ("7k/8/8/8/8/8/1R6/R1K5 w - - 0 1", 4),
            ("7k/8/5KQ1/8/8/8/8/8 w - - 0 1", 3),
            ("4k3/8/4p3/3p4/8/8/8/3QK3 w - - 0 1", 3),
            ("8/8/7k/8/8/8/1R6/R1K5 w - - 0 1", 6),
            ("7k/8/6K1/8/8/8/8/5Q2 w - - 0 1", 4),
        ];
        for (fen, depth) in cases {
            let pos = from_fen(fen);
            let off = search_depth_feats(&pos, &HashSet::new(), depth, &mut Tt::new(16), true, true, false).unwrap();
            let on = search_depth_feats(&pos, &HashSet::new(), depth, &mut Tt::new(16), true, true, true).unwrap();
            assert_eq!(off.score, on.score, "{fen}");
            if off.score.abs() > MATE_BOUND {
                assert_eq!(off.best, on.best, "{fen}");
            }
        }
        let pos = from_fen("7k/8/8/8/8/8/1R6/R1K5 w - - 0 1");
        let out = search_depth(&pos, &HashSet::new(), 4).unwrap();
        assert_eq!(out.score, MATE - 3);
    }

    #[test]
    #[ignore = "measurement: cargo test --release -p chess-engine pvs_report -- --ignored --nocapture"]
    fn pvs_report() {
        // v0.4 = TT only; +order = killers/history; full = ordering + PVS + LMR.
        for depth in [5u32, 6] {
            let (mut base_n, mut ord_n, mut full_n, mut same) = (0u64, 0u64, 0u64, 0);
            for fen in TT_FENS {
                let pos = from_fen(fen);
                let base = search_depth_feats(&pos, &HashSet::new(), depth, &mut Tt::new(TT_BITS), true, false, false).unwrap();
                let ord = search_depth_feats(&pos, &HashSet::new(), depth, &mut Tt::new(TT_BITS), true, true, false).unwrap();
                let full = search_depth_feats(&pos, &HashSet::new(), depth, &mut Tt::new(TT_BITS), true, true, true).unwrap();
                if (base.best, base.score) == (full.best, full.score) {
                    same += 1;
                } else {
                    println!("  d{depth} differs {fen}: v0.4 {:?} {} full {:?} {}", base.best, base.score, full.best, full.score);
                }
                base_n += base.nodes;
                ord_n += ord.nodes;
                full_n += full.nodes;
            }
            println!("depth {depth}: nodes v0.4 {base_n} +order {ord_n} full {full_n} ({:+.1}%), same {same}/8", 100.0 * (full_n as f64 / base_n as f64 - 1.0));
        }
        for (name, fen) in [("start", TT_FENS[0]), ("italian", TT_FENS[1]), ("kiwipete", TT_FENS[2])] {
            let pos = from_fen(fen);
            let hard = Duration::from_millis(120);
            let soft = Duration::from_millis(60);
            let base = run(&pos, &HashSet::new(), hard, soft, MAX_DEPTH, &mut Tt::new(TT_BITS), true, false, false, &[]).unwrap();
            let full = run(&pos, &HashSet::new(), hard, soft, MAX_DEPTH, &mut Tt::new(TT_BITS), true, true, true, &[]).unwrap();
            println!("go 200 {name}: v0.4 depth {} nodes {} | full depth {} nodes {}", base.depth, base.nodes, full.depth, full.nodes);
        }
    }

    const MATE_IN_3: [&str; 4] = [
        "r5rk/5p1p/5R2/4B3/8/8/7P/7K w - - 0 1",
        "3r1r1k/1p3p1p/p2p4/4n1NN/6bQ/1BPq4/P3p1PP/1R5K w - - 0 1",
        "r1b1kb1r/pppp1ppp/5q2/4n3/3KP3/2N3PN/PPP4P/R1BQ1B1R b kq - 0 1",
        "2r3k1/p4p2/3Rp2p/1p2P1pK/8/1P4P1/P3Q2P/1q6 b - - 0 1",
    ];

    fn null_search(pos: &Chess, depth: u32, use_null: bool) -> Outcome {
        let day = Duration::from_secs(86_400);
        run_feats(pos, &HashSet::new(), day, day, depth, &mut Tt::new(18), true, true, true, use_null, &[]).unwrap()
    }

    #[test]
    fn null_move_still_finds_mate_in_three() {
        for fen in MATE_IN_3 {
            let pos = from_fen(fen);
            let off = null_search(&pos, 7, false);
            let on = null_search(&pos, 7, true);
            assert_eq!(off.score, MATE - 5, "{fen}");
            assert_eq!(on.score, MATE - 5, "{fen}");
            assert_eq!(on.best, off.best, "{fen}");
        }
    }

    #[test]
    fn null_move_skipped_in_king_and_pawn_endings() {
        // Five pieces (outside the tables), White only king and pawns: zugzwang territory.
        let pos = from_fen("4k3/8/8/3p4/8/8/PPP5/4K3 w - - 0 1");
        assert!(!has_non_pawn_material(&pos));
        let out = null_search(&pos, 8, true);
        // Black's king and pawn have no pieces either, so no node may pass.
        assert_eq!(out.null_tries, 0);
        // The search did reach the depth where null moves would apply.
        assert_eq!(out.depth, 8);
        let mid = from_fen(TT_FENS[0]);
        assert!(has_non_pawn_material(&mid));
        assert!(null_search(&mid, 7, true).null_tries > 0);
    }

    #[test]
    fn null_move_skipped_when_in_check() {
        let mut tt = Tt::new(10);
        let seen = HashSet::new();
        let mut s = Search {
            seen: &seen,
            tt: &mut tt,
            use_tt: false,
            order: Ordering::new(),
            use_order: false,
            use_pvs: true,
            use_null: true,
            use_see: true,
            null_ply: -1,
            rep_floor: 0,
            null_tries: 0,
            null_cuts: 0,
            tt_hits: 0,
            tt_cuts: 0,
            tb_hits: 0,
            path: Vec::new(),
            root_turn: Color::Black,
            deadline: Instant::now() + Duration::from_secs(86_400),
            nodes: 0,
            qnodes: 0,
            stopped: false,
            partial: None,
        };
        // Black to move, a queen up, but in check from the bishop: every condition except the
        // check holds (null window, depth, pieces, eval far above beta).
        let checked = from_fen("4k3/8/8/1B6/8/8/q7/4K3 b - - 0 1");
        assert!(checked.is_check() && has_non_pawn_material(&checked));
        assert!(evaluate(&checked) > 0);
        assert!(!s.null_move_ok(&checked, 6, 3, -1, 0, true));
        // The same material out of check does pass.
        let free = from_fen("4k3/8/8/2B5/8/8/q7/4K3 b - - 0 1");
        assert!(!free.is_check());
        assert!(s.null_move_ok(&free, 6, 3, -1, 0, false));
        // Not right after a null move, not at a full-window (PV) node, not below depth 3.
        s.null_ply = 2;
        assert!(!s.null_move_ok(&free, 6, 3, -1, 0, false));
        s.null_ply = -1;
        assert!(!s.null_move_ok(&free, 6, 3, -1, 5, false));
        assert!(!s.null_move_ok(&free, 2, 3, -1, 0, false));
        // And a search from the checked position never passes at its in-check root child.
        let v = s.negamax(&checked, 4, 1, -1, 0);
        assert!(v > -MATE_BOUND && !s.stopped);
    }

    #[test]
    #[ignore = "measurement: cargo test --release -p chess-engine null_report -- --ignored --nocapture"]
    fn null_report() {
        for depth in [5u32, 6, 7] {
            let (mut off_n, mut on_n, mut same, mut tries, mut cuts) = (0u64, 0u64, 0, 0u64, 0u64);
            for fen in TT_FENS {
                let pos = from_fen(fen);
                let off = null_search(&pos, depth, false);
                let on = null_search(&pos, depth, true);
                if (off.best, off.score) == (on.best, on.score) {
                    same += 1;
                } else {
                    println!("  d{depth} differs {fen}: off {:?} {} on {:?} {}", off.best, off.score, on.best, on.score);
                }
                off_n += off.nodes;
                on_n += on.nodes;
                tries += on.null_tries;
                cuts += on.null_cuts;
            }
            println!(
                "depth {depth}: nodes off {off_n} on {on_n} ({:+.1}%), same {same}/8, null tries {tries} cuts {cuts}",
                100.0 * (on_n as f64 / off_n as f64 - 1.0)
            );
        }
        for (i, fen) in TT_FENS.iter().enumerate() {
            let pos = from_fen(fen);
            let hard = Duration::from_millis(120);
            let soft = Duration::from_millis(60);
            let off = run_feats(&pos, &HashSet::new(), hard, soft, MAX_DEPTH, &mut Tt::new(TT_BITS), true, true, true, false, &[]).unwrap();
            let on = run_feats(&pos, &HashSet::new(), hard, soft, MAX_DEPTH, &mut Tt::new(TT_BITS), true, true, true, true, &[]).unwrap();
            println!("go 200 fen{i}: off depth {} nodes {} | null depth {} nodes {}", off.depth, off.nodes, on.depth, on.nodes);
        }
    }

    /// A random three-piece position: White king and `role`, Black king, White to move, or None if
    /// the rules library rejects it.
    fn three_pieces(role: Role, rng: &mut u64) -> Option<Chess> {
        let mut next = || {
            *rng ^= *rng << 13;
            *rng ^= *rng >> 7;
            *rng ^= *rng << 17;
            (*rng % 64) as u32
        };
        let (k, x, w) = (next(), next(), next());
        if k == x || k == w || x == w || (role == Role::Pawn && !(8..56).contains(&x)) {
            return None;
        }
        let mut board = shakmaty::Board::empty();
        board.set_piece_at(shakmaty::Square::new(k), shakmaty::Piece { color: Color::White, role: Role::King });
        board.set_piece_at(shakmaty::Square::new(x), shakmaty::Piece { color: Color::White, role });
        board.set_piece_at(shakmaty::Square::new(w), shakmaty::Piece { color: Color::Black, role: Role::King });
        let mut setup = shakmaty::Setup::empty();
        setup.board = board;
        use shakmaty::FromSetup;
        Chess::from_setup(setup, shakmaty::CastlingMode::Standard).ok()
    }

    #[test]
    fn tables_convert_against_a_random_mover() {
        // From random won KQK, KRK and KPK starts, the engine (depth 2) mates a random mover
        // within the table's distance and inside the fifty-move rule.
        let mut rng = 0x9E37_79B9_7F4A_7C15u64;
        for role in [Role::Queen, Role::Rook, Role::Pawn] {
            let mut games = 0;
            while games < 25 {
                let Some(mut pos) = three_pieces(role, &mut rng) else { continue };
                let Some(Tb::Win(dtm)) = endgame::probe(&pos) else { continue };
                games += 1;
                let mut seen = HashSet::from([hash(&pos)]);
                let mut plies = 0;
                while !pos.is_game_over() {
                    let m = if pos.turn() == Color::White {
                        let out = search_depth(&pos, &seen, 2).unwrap();
                        assert!(out.score > MATE_BOUND, "{role:?} {}: lost the win", shakmaty::fen::Fen::from_position(&pos, EnPassantMode::Legal));
                        out.best
                    } else {
                        let moves = pos.legal_moves();
                        rng ^= rng << 13;
                        rng ^= rng >> 7;
                        rng ^= rng << 17;
                        moves[(rng % moves.len() as u64) as usize]
                    };
                    pos.play_unchecked(m);
                    seen.insert(hash(&pos));
                    plies += 1;
                    assert!(pos.halfmoves() < 100);
                }
                assert!(pos.is_checkmate() && pos.turn() == Color::Black, "{role:?}: no mate");
                assert!(plies <= dtm, "{role:?}: mate took {plies} plies, table said {dtm}");
            }
        }
    }

    #[test]
    fn search_reports_the_table_distance() {
        // KRK, longest-class position: the root score is the table's exact mate distance, and the
        // defending side's score is the mirror image.
        let mut rng = 7u64;
        let mut checked = 0;
        while checked < 30 {
            let Some(pos) = three_pieces(Role::Rook, &mut rng) else { continue };
            let Some(Tb::Win(d)) = endgame::probe(&pos) else { continue };
            if d < 3 {
                continue;
            }
            let out = search_depth(&pos, &HashSet::new(), 1).unwrap();
            assert_eq!(out.score, MATE - d as i32);
            checked += 1;
        }
        // Four pieces: KQ vs KR. The search wins the rook through the table (a skewer).
        let pos = from_fen("3k4/8/3K4/8/8/8/r7/7Q w - - 0 1");
        let out = search_depth(&pos, &HashSet::new(), 4).unwrap();
        assert!(out.score > MATE_BOUND, "score {}", out.score);
    }

    fn see_of(fen: &str, uci: &str) -> i32 {
        let pos = from_fen(fen);
        let m = UciMove::from_ascii(uci.as_bytes()).unwrap().to_move(&pos).unwrap();
        see(&pos, &m)
    }

    #[test]
    fn see_pawn_defended_piece() {
        // QxP defended by a pawn loses the queen for a pawn; undefended it wins the pawn.
        assert_eq!(see_of("4k3/8/4p3/3p4/8/8/8/3QK3 w - - 0 1", "d1d5"), 100 - 900);
        assert_eq!(see_of("4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1", "d1d5"), 100);
        // NxP defended by a pawn; PxN wins outright.
        assert_eq!(see_of("4k3/8/4p3/3p4/8/4N3/8/4K3 w - - 0 1", "e3d5"), 100 - 320);
        assert_eq!(see_of("4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1", "e4d5"), 320);
        // A cheaper capture banks at least the difference: the gate skips the swap list there.
        let pos = from_fen("4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1");
        let m = UciMove::from_ascii(b"e4d5").unwrap().to_move(&pos).unwrap();
        assert!(!may_lose(&m));
    }

    #[test]
    fn see_xray_rook_battery() {
        // Re2xe5, Re8xe5, Re1xe5: the rook behind joins through the square the first one left.
        assert_eq!(see_of("4r1k1/8/8/4p3/8/8/4R3/4R1K1 w - - 0 1", "e2e5"), 100);
        // Without the second rook the defended pawn costs a rook.
        assert_eq!(see_of("4r1k1/8/8/4p3/8/8/4R3/6K1 w - - 0 1", "e2e5"), 100 - 500);
        // Black's battery too: two black rooks defend, White's two rooks attack: the exchange
        // stops after Re8xe5, White keeps the pawn and loses nothing by stopping.
        assert_eq!(see_of("4r1k1/4r3/8/4p3/8/8/4R3/4R1K1 w - - 0 1", "e2e5"), 100 - 500);
        // A queen x-raying behind a bishop: Bxe4 Nxe4 Qxe4 (+100 -330 +320); alone, -230.
        assert_eq!(see_of("7k/8/8/2n5/4p3/5B2/6Q1/K7 w - - 0 1", "f3e4"), 100 - 330 + 320);
        assert_eq!(see_of("7k/8/8/2n5/4p3/5B2/8/K7 w - - 0 1", "f3e4"), 100 - 330);
    }

    #[test]
    fn see_en_passant() {
        // exd6 e.p. lifts the d5 pawn, which opens the d-file for the rook behind: Bxd6 Rxd6.
        assert_eq!(see_of("5b1k/8/8/3pP3/8/8/8/3R3K w - d6 0 2", "e5d6"), 100);
        // Without the rook the bishop's recapture evens it out.
        assert_eq!(see_of("5b1k/8/8/3pP3/8/8/8/7K w - d6 0 2", "e5d6"), 0);
        assert_eq!(see_of("7k/8/8/3pP3/8/8/8/7K w - d6 0 2", "e5d6"), 100);
    }

    #[test]
    fn see_promotion_capture() {
        // bxa8=Q wins rook + promotion (500 + 800); Qxa8 takes the new queen back.
        assert_eq!(see_of("r2q2k1/1P6/8/8/8/8/8/6K1 w - - 0 1", "b7a8q"), 500 + 800 - 900);
        assert_eq!(see_of("r5k1/1P6/8/8/8/8/8/6K1 w - - 0 1", "b7a8q"), 500 + 800);
        // A recapture by a pawn onto the last rank promotes inside the exchange too: Rxb8 (+330),
        // Rxb8 (-500), cxb8=Q (+500 and the promotion).
        assert_eq!(see_of("1b2r1k1/2P5/8/8/8/8/8/1R4K1 w - - 0 1", "b1b8"), 330);
    }

    #[test]
    fn see_king_never_captures_into_a_defended_square() {
        // Qxf7+: the king cannot take back while the bishop guards f7.
        assert_eq!(see_of("6k1/5p2/8/8/2B5/8/8/5QK1 w - - 0 1", "f1f7"), 100);
        assert_eq!(see_of("6k1/5p2/8/8/8/8/8/5QK1 w - - 0 1", "f1f7"), 100 - 900);
    }

    #[test]
    fn losing_captures_order_after_killers_and_are_skipped_in_quiescence() {
        let fen = "4k3/8/4p3/3p4/8/8/8/3QK3 w - - 0 1";
        let pos = from_fen(fen);
        let m = UciMove::from_ascii(b"d1d5").unwrap().to_move(&pos).unwrap();
        let k = losing_capture_key(&pos, &m, None).unwrap();
        assert!(k < KILLER_KEY[1] && k > HISTORY_MAX, "{k}");
        // The TT move keeps its place.
        assert_eq!(losing_capture_key(&pos, &m, Some(m)), None);
        // Fixed depth with and without SEE: same verdict on the bad capture, fewer qnodes.
        let day = Duration::from_secs(86_400);
        let opts = |see| run_opts(&pos, &HashSet::new(), day, day, 4, &mut Tt::new(16), true, true, true, true, see, &[]).unwrap();
        let (off, on) = (opts(false), opts(true));
        assert_ne!(on.best, m);
        assert_eq!(on.score, off.score);
        assert!(on.qnodes < off.qnodes, "{} vs {}", on.qnodes, off.qnodes);
    }

    #[test]
    fn see_keeps_tactical_results() {
        for fen in MATE_IN_3 {
            let pos = from_fen(fen);
            let out = search_depth(&pos, &HashSet::new(), 7).unwrap();
            assert_eq!(out.score, MATE - 5, "{fen}");
        }
    }

    #[test]
    #[ignore = "measurement: cargo test --release -p chess-engine see_report -- --ignored --nocapture"]
    fn see_report() {
        let day = Duration::from_secs(86_400);
        for depth in [5u32, 6, 7] {
            let (mut n0, mut n1, mut q0, mut q1, mut t0, mut t1, mut same) = (0u64, 0u64, 0u64, 0u64, 0f64, 0f64, 0);
            for fen in TT_FENS {
                let pos = from_fen(fen);
                let go = |see| {
                    let t = Instant::now();
                    let o = run_opts(&pos, &HashSet::new(), day, day, depth, &mut Tt::new(TT_BITS), true, true, true, true, see, &[]).unwrap();
                    (o, t.elapsed().as_secs_f64() * 1000.0)
                };
                let ((off, ta), (on, tb)) = (go(false), go(true));
                if (off.best, off.score) == (on.best, on.score) {
                    same += 1;
                } else {
                    println!("  d{depth} differs {fen}: off {:?} {} on {:?} {}", off.best, off.score, on.best, on.score);
                }
                println!("  d{depth} {fen}: nodes {} -> {} qnodes {} -> {} ms {ta:.0} -> {tb:.0}", off.nodes, on.nodes, off.qnodes, on.qnodes);
                (n0, n1, q0, q1, t0, t1) = (n0 + off.nodes, n1 + on.nodes, q0 + off.qnodes, q1 + on.qnodes, t0 + ta, t1 + tb);
            }
            println!(
                "depth {depth}: nodes {n0} -> {n1} ({:+.1}%), qnodes {q0} -> {q1} ({:+.1}%), ms {t0:.0} -> {t1:.0} ({:+.1}%), same {same}/8",
                100.0 * (n1 as f64 / n0 as f64 - 1.0),
                100.0 * (q1 as f64 / q0 as f64 - 1.0),
                100.0 * (t1 / t0 - 1.0)
            );
        }
        for (i, fen) in TT_FENS.iter().enumerate() {
            let pos = from_fen(fen);
            let (hard, soft) = (Duration::from_millis(120), Duration::from_millis(60));
            let go = |see| run_opts(&pos, &HashSet::new(), hard, soft, MAX_DEPTH, &mut Tt::new(TT_BITS), true, true, true, true, see, &[]).unwrap();
            let (off, on) = (go(false), go(true));
            println!("go 200 fen{i}: off depth {} nodes {} | on depth {} nodes {}", off.depth, off.nodes, on.depth, on.nodes);
        }
    }

    /// Search under a clock on a fresh game table, timed from the call.
    fn clocked(pos: &Chess, clock: impl Fn(Instant) -> Clock) -> (Outcome, f64) {
        let mut tt = Tt::new(TT_BITS);
        let t = Instant::now();
        let o = run_clock(pos, &HashSet::new(), clock(t), MAX_DEPTH, &mut tt, true, true, true, true, true, &[]).unwrap();
        (o, t.elapsed().as_secs_f64() * 1000.0)
    }

    #[test]
    fn next_depth_starts_only_when_its_predicted_share_fits() {
        let ms = Duration::from_millis;
        // 10 ms used, last depth 4 ms after 1 ms (growth 4): next ~16 ms, 40% of it 6.4 ms.
        assert!(next_fits(ms(10), ms(4), ms(1), ms(17), false));
        assert!(!next_fits(ms(10), ms(4), ms(1), ms(16), false));
        // Unstable: only a quarter of it (4 ms) has to fit.
        assert!(next_fits(ms(10), ms(4), ms(1), ms(15), true));
        assert!(!next_fits(ms(10), ms(4), ms(1), ms(13), true));
        // Growth is clamped: a 6.7x jump counts as 6x (24 ms, 9.6), a shrink as 1.5x (6 ms, 2.4).
        assert!(!next_fits(ms(10), ms(4), Duration::from_micros(600), ms(19), false));
        assert!(next_fits(ms(10), ms(4), Duration::from_micros(600), ms(20), false));
        assert!(next_fits(ms(10), ms(4), ms(8), ms(13), false));
        // Too fast to measure: assume 3x (12 ms, 4.8).
        assert!(next_fits(ms(10), ms(4), Duration::from_micros(100), ms(15), false));
        assert!(!next_fits(ms(10), ms(4), Duration::from_micros(100), ms(14), false));
    }

    #[test]
    fn game_clock_keeps_a_margin() {
        let t = Instant::now();
        for (budget, hard) in [(200u64, 180u64), (50, 35), (20, 10), (1000, 900), (3000, 2900)] {
            assert_eq!(Clock::for_budget(t, budget).hard, Duration::from_millis(hard), "go {budget}");
        }
    }

    #[test]
    fn cut_short_depth_still_plays_a_legal_move_in_time() {
        // A hard stop far below what a depth takes: the result is a completed or partial depth's
        // legal move, and the reply stays inside the budget.
        for fen in TT_FENS {
            let pos = from_fen(fen);
            for budget in [20u64, 60, 200] {
                let (o, ms) = clocked(&pos, |t| Clock::for_budget(t, budget));
                assert!(pos.is_legal(o.best), "{fen}: {:?}", o.best);
                assert!(ms < budget as f64, "{fen}: {ms:.1} ms for go {budget}");
            }
        }
    }

    #[test]
    #[ignore = "measurement: cargo test --release -p chess-engine clock_report -- --ignored --nocapture"]
    fn clock_report() {
        for budget in [200u64, 1000] {
            println!("go {budget}: fen | legacy depth ms | predicted depth(+partial) ms");
            let (mut ld, mut nd, mut lt, mut nt) = (0u32, 0u32, 0.0, 0.0);
            for (i, fen) in TT_FENS.iter().enumerate() {
                let pos = from_fen(fen);
                let (a, at) = clocked(&pos, |t| Clock::legacy(t, budget));
                let (b, bt) = clocked(&pos, |t| Clock::for_budget(t, budget));
                println!(
                    "  fen{i} | d{} {at:.0} ms {} | d{}{} {bt:.0} ms {}",
                    a.depth,
                    UciMove::from_standard(a.best),
                    b.depth,
                    if b.partial { "+" } else { "" },
                    UciMove::from_standard(b.best)
                );
                // fen5-7 end at once (table mate, near-forced): the mean is over the first five.
                if i < 5 {
                    (ld, nd, lt, nt) = (ld + a.depth, nd + b.depth, lt + at, nt + bt);
                }
            }
            println!("  fen0-4 mean depth {:.2} -> {:.2}, mean ms {:.0} -> {:.0}", ld as f64 / 5.0, nd as f64 / 5.0, lt / 5.0, nt / 5.0);
        }
    }

    #[test]
    #[ignore = "measurement: cargo test --release -p chess-engine clock_worst_case -- --ignored --nocapture"]
    fn clock_worst_case() {
        // Self-play at go 200 through the protocol path, timing every reply.
        let mut worst = 0.0f64;
        let mut n = 0;
        for game in 0..6 {
            let mut moves: Vec<String> = Vec::new();
            handle("game chess", &mut moves);
            // Vary the opening a little so the games differ.
            let first = ["e2e4", "d2d4", "c2c4", "g1f3", "e2e3", "b1c3"][game];
            moves.push(first.into());
            for _ in 0..120 {
                let mut m = moves.clone();
                handle(&format!("position {}", moves.join(" ")), &mut m);
                let t = Instant::now();
                let (reply, _) = handle("go 200", &mut m);
                let ms = t.elapsed().as_secs_f64() * 1000.0;
                worst = worst.max(ms);
                n += 1;
                let reply = reply.unwrap();
                let mv = reply.lines().last().unwrap().trim_start_matches("bestmove ").to_string();
                if mv == "0000" {
                    break;
                }
                moves.push(mv);
                let Some((pos, _)) = replay(&moves) else { break };
                if pos.is_game_over() {
                    break;
                }
            }
        }
        println!("{n} replies at go 200, worst {worst:.1} ms");
        assert!(worst < 200.0);
    }
}
