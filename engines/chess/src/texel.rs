//! Texel-style fit of the evaluation weights (#293). Offline tooling only: nothing here runs at
//! move time, and the fitted numbers ship as the `PARAMS` constant in `main.rs`.
//!
//! - `chess-engine texel gen <shard> <shards> <depth> <variants>`: self-play games of this engine
//!   at a fixed depth from the opening lines on stdin (UCI moves, one line each). Each opening is
//!   played `variants` times; variant 0 is the engine's own line, the others swap in the
//!   second-best root move (when it scores within `SWAP_MARGIN`) at a few seeded early plies, so
//!   one opening gives several games. Prints the quiet positions of every game, labelled with its
//!   result: `FEN<TAB>result (1 white won, 0.5, 0)<TAB>game id` (opening index × 1000 + variant). Games are sharded by id, so the
//!   work runs as processes (`texel/generate.sh`), never threads.
//! - `chess-engine texel fit <holdout-every> <iterations> <lambdas> <files…>`: reads those lines,
//!   holds out the games whose id is a multiple of `holdout-every` (test) and those one above
//!   (validation), fits the sigmoid scale K on the training games with the current weights, then
//!   the weights by Adam on the mean squared error plus an L2 pull toward the current weights for
//!   each lambda, keeps the lambda with the lowest validation error, and prints train, validation
//!   and held-out error before and after plus the new `PARAMS` block.
//!
//! The fit needs no second evaluator: every part of `eval_terms` is linear in its weight, so the
//! feature of weight j in a position is `eval_terms` with that weight 1 and every other weight 0.

use crate::{endgame, eval_terms, hash, quiesce_score, replay, run, Params, Tt, MATE_BOUND, PARAMS};
use shakmaty::fen::Fen;
use shakmaty::{CastlingMode, Chess, Color, EnPassantMode, Move, Position};
use std::collections::{HashMap, HashSet};
use std::io::{self, BufRead, Write};
use std::time::Duration;

/// A second-best root move may replace the best one when it scores within this many centipawns.
const SWAP_MARGIN: i32 = 30;
/// Swaps happen only in the first plies after the opening line, each with this chance in 1/1000.
const SWAP_PLIES: u32 = 16;
const SWAP_CHANCE: u64 = 300;
/// Positions this close to the opening line are not recorded (they repeat across variants).
const SKIP_PLIES: u32 = 4;
/// A game is adjudicated once both sides' searches agree on a score this large for `ADJ_PLIES`.
const ADJ_SCORE: i32 = 1000;
const ADJ_PLIES: u32 = 4;
/// Games longer than this (plies after the opening) are scored as draws.
const MAX_PLIES: u32 = 400;

fn arg<T: std::str::FromStr>(args: &[String], i: usize, default: T) -> T {
    args.get(i).and_then(|s| s.parse().ok()).unwrap_or(default)
}

fn rng_next(state: &mut u64) -> u64 {
    // SplitMix64: a deterministic stream per game id.
    *state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

fn search(pos: &Chess, seen: &HashSet<u64>, depth: u32, tt: &mut Tt, exclude: &[Move]) -> Option<(Move, i32)> {
    let day = Duration::from_secs(86_400);
    let o = run(pos, seen, day, day, depth, tt, true, true, true, exclude)?;
    Some((o.best, o.score))
}

/// Plays one self-play game from `pos` and returns its quiet positions (FENs) and the result
/// from White's side (1, 0.5 or 0).
fn play(mut pos: Chess, depth: u32, seed: u64, swaps: bool) -> (Vec<String>, f32) {
    let mut rng = seed;
    let mut seen: HashSet<u64> = HashSet::new();
    let mut counts: HashMap<u64, u32> = HashMap::new();
    let key = hash(&pos);
    seen.insert(key);
    counts.insert(key, 1);
    // One table per side: the search clears a table whose root side changes (contempt).
    let mut tts = [Tt::new(18), Tt::new(18)];
    let mut quiet = Vec::new();
    let mut big = 0u32;
    let mut last_sign = 0;
    let white = |turn: Color, s: i32| if turn == Color::White { s } else { -s };
    for ply in 0..MAX_PLIES {
        let moves = pos.legal_moves();
        if moves.is_empty() {
            let r = if pos.is_check() { if pos.turn() == Color::White { 0.0 } else { 1.0 } } else { 0.5 };
            return (quiet, r);
        }
        if pos.is_insufficient_material() || pos.halfmoves() >= 100 || counts[&hash(&pos)] >= 3 {
            return (quiet, 0.5);
        }
        if let Some(tb) = endgame::probe(&pos) {
            let r = match tb {
                endgame::Tb::Win(_) => white(pos.turn(), 1) as f32,
                endgame::Tb::Loss(_) => white(pos.turn(), -1) as f32,
                endgame::Tb::Draw => 0.0,
            };
            return (quiet, (r + 1.0) / 2.0);
        }
        let turn = pos.turn();
        let tt = &mut tts[turn as usize];
        let Some((mut best, mut score)) = search(&pos, &seen, depth, tt, &[]) else { return (quiet, 0.5) };
        let in_check = pos.is_check();
        if ply >= SKIP_PLIES
            && !in_check
            && !best.is_capture()
            && best.promotion().is_none()
            && score.abs() < MATE_BOUND
            && quiesce_score(&pos) == crate::evaluate(&pos)
        {
            quiet.push(Fen::from_position(&pos, EnPassantMode::Legal).to_string());
        }
        if swaps && ply < SWAP_PLIES && moves.len() > 1 && rng_next(&mut rng) % 1000 < SWAP_CHANCE {
            if let Some((m2, s2)) = search(&pos, &seen, depth, tt, &[best]) {
                if s2 >= score - SWAP_MARGIN {
                    (best, score) = (m2, s2);
                }
            }
        }
        // Adjudicate once both sides agree that one of them is winning.
        let ws = white(turn, score);
        let sign = if ws >= ADJ_SCORE { 1 } else if ws <= -ADJ_SCORE { -1 } else { 0 };
        if sign != 0 && sign == last_sign {
            big += 1;
        } else {
            big = u32::from(sign != 0);
        }
        last_sign = sign;
        if big >= ADJ_PLIES {
            return (quiet, if sign > 0 { 1.0 } else { 0.0 });
        }
        pos.play_unchecked(best);
        let key = hash(&pos);
        seen.insert(key);
        *counts.entry(key).or_insert(0) += 1;
    }
    (quiet, 0.5)
}

/// The tunable weights of `Params`, by name, in a fixed order.
fn slots(p: &mut Params) -> Vec<(String, &mut i32)> {
    let mut v: Vec<(String, &mut i32)> = Vec::new();
    fn arr<'a, const N: usize>(v: &mut Vec<(String, &'a mut i32)>, name: &str, a: &'a mut [i32; N]) {
        for (i, x) in a.iter_mut().enumerate() {
            v.push((format!("{name}[{i}]"), x));
        }
    }
    arr(&mut v, "material_mg", &mut p.material_mg);
    arr(&mut v, "material_eg", &mut p.material_eg);
    arr(&mut v, "pawn_advance", &mut p.pawn_advance);
    arr(&mut v, "pawn_centre", &mut p.pawn_centre);
    arr(&mut v, "knight_centre", &mut p.knight_centre);
    arr(&mut v, "bishop_centre", &mut p.bishop_centre);
    arr(&mut v, "queen_centre", &mut p.queen_centre);
    v.push(("bishop_back".into(), &mut p.bishop_back));
    arr(&mut v, "rook_seventh", &mut p.rook_seventh);
    v.push(("rook_back_centre".into(), &mut p.rook_back_centre));
    v.push(("queen_off_back".into(), &mut p.queen_off_back));
    v.push(("king_shelter".into(), &mut p.king_shelter));
    v.push(("king_advance".into(), &mut p.king_advance));
    v.push(("king_centre_eg".into(), &mut p.king_centre_eg));
    for (i, m) in p.mobility.iter_mut().enumerate() {
        arr(&mut v, &format!("mobility[{i}]"), m);
    }
    arr(&mut v, "passer_mg", &mut p.passer_mg);
    arr(&mut v, "passer_eg", &mut p.passer_eg);
    arr(&mut v, "passer_free_mg", &mut p.passer_free_mg);
    arr(&mut v, "passer_free_eg", &mut p.passer_free_eg);
    v.push(("bishop_pair".into(), &mut p.bishop_pair));
    v
}

fn to_vec(p: &Params) -> Vec<i32> {
    let mut q = *p;
    slots(&mut q).into_iter().map(|(_, x)| *x).collect()
}

fn from_vec(w: &[i32]) -> Params {
    let mut p = PARAMS;
    for ((_, x), v) in slots(&mut p).into_iter().zip(w) {
        *x = *v;
    }
    p
}

/// The white-relative evaluation `evaluate` would give with weights `p`, before its sign flip.
fn white_eval(pos: &Chess, p: &Params) -> i32 {
    let (mg, eg, phase, flat) = eval_terms(pos, p);
    (mg * phase + eg * (24 - phase)) / 24 + flat
}

/// The feature of each weight in `pos`: its tapered coefficient (untruncated), sparse.
fn features(pos: &Chess, n: usize) -> Vec<(u8, f32)> {
    let mut out = Vec::new();
    let mut unit = vec![0; n];
    for j in 0..n {
        unit[j] = 1;
        let (mg, eg, phase, flat) = eval_terms(pos, &from_vec(&unit));
        unit[j] = 0;
        let x = (mg * phase + eg * (24 - phase)) as f32 / 24.0 + flat as f32;
        if x != 0.0 {
            out.push((j as u8, x));
        }
    }
    out
}

struct Data {
    offsets: Vec<usize>,
    idx: Vec<u8>,
    val: Vec<f32>,
    result: Vec<f32>,
}

impl Data {
    fn new() -> Data {
        Data { offsets: vec![0], idx: Vec::new(), val: Vec::new(), result: Vec::new() }
    }
    fn push(&mut self, f: &[(u8, f32)], r: f32) {
        for &(j, x) in f {
            self.idx.push(j);
            self.val.push(x);
        }
        self.offsets.push(self.idx.len());
        self.result.push(r);
    }
    fn len(&self) -> usize {
        self.result.len()
    }
    fn eval(&self, i: usize, w: &[f64]) -> f64 {
        (self.offsets[i]..self.offsets[i + 1]).map(|k| w[self.idx[k] as usize] * self.val[k] as f64).sum()
    }
}

fn sigmoid(k: f64, e: f64) -> f64 {
    1.0 / (1.0 + 10f64.powf(-k * e / 400.0))
}

fn mse(d: &Data, w: &[f64], k: f64) -> f64 {
    (0..d.len()).map(|i| (d.result[i] as f64 - sigmoid(k, d.eval(i, w))).powi(2)).sum::<f64>() / d.len() as f64
}

/// Mean squared error with the engine's own integer evaluation (the numbers it would play).
fn mse_exact(pos: &[(Chess, f32)], p: &Params, k: f64) -> f64 {
    pos.iter().map(|(q, r)| (*r as f64 - sigmoid(k, white_eval(q, p) as f64)).powi(2)).sum::<f64>() / pos.len() as f64
}

/// K minimising the error with weights `w`: golden-section search on [0.05, 5].
fn fit_k(d: &Data, w: &[f64]) -> f64 {
    let (mut a, mut b) = (0.05f64, 5.0f64);
    let g = (5f64.sqrt() - 1.0) / 2.0;
    for _ in 0..60 {
        let c = b - g * (b - a);
        let e = a + g * (b - a);
        if mse(d, w, c) < mse(d, w, e) {
            b = e;
        } else {
            a = c;
        }
    }
    (a + b) / 2.0
}

fn gradient(d: &Data, w: &[f64], k: f64) -> Vec<f64> {
    let mut g = vec![0.0; w.len()];
    let c = k * std::f64::consts::LN_10 / 400.0;
    for i in 0..d.len() {
        let s = sigmoid(k, d.eval(i, w));
        let coef = 2.0 * (s - d.result[i] as f64) * s * (1.0 - s) * c;
        for kk in d.offsets[i]..d.offsets[i + 1] {
            g[d.idx[kk] as usize] += coef * d.val[kk] as f64;
        }
    }
    let n = d.len() as f64;
    g.iter_mut().for_each(|x| *x /= n);
    g
}

fn parse_fen(s: &str) -> Option<Chess> {
    s.parse::<Fen>().ok()?.into_position(CastlingMode::Standard).ok()
}

/// Prints `p` as the Rust `PARAMS` block.
fn print_params(p: &Params) {
    let a = |x: &[i32]| format!("{x:?}");
    println!("pub(crate) const PARAMS: Params = Params {{");
    println!("    material_mg: {},", a(&p.material_mg));
    println!("    material_eg: {},", a(&p.material_eg));
    println!("    pawn_advance: {},", a(&p.pawn_advance));
    println!("    pawn_centre: {},", a(&p.pawn_centre));
    println!("    knight_centre: {},", a(&p.knight_centre));
    println!("    bishop_centre: {},", a(&p.bishop_centre));
    println!("    queen_centre: {},", a(&p.queen_centre));
    println!("    bishop_back: {},", p.bishop_back);
    println!("    rook_seventh: {},", a(&p.rook_seventh));
    println!("    rook_back_centre: {},", p.rook_back_centre);
    println!("    queen_off_back: {},", p.queen_off_back);
    println!("    king_shelter: {},", p.king_shelter);
    println!("    king_advance: {},", p.king_advance);
    println!("    king_centre_eg: {},", p.king_centre_eg);
    println!("    mobility: {:?},", p.mobility);
    println!("    passer_mg: {},", a(&p.passer_mg));
    println!("    passer_eg: {},", a(&p.passer_eg));
    println!("    passer_free_mg: {},", a(&p.passer_free_mg));
    println!("    passer_free_eg: {},", a(&p.passer_free_eg));
    println!("    bishop_pair: {},", p.bishop_pair);
    println!("}};");
}

/// Adam, full batch, on the training error plus `lambda` × the squared distance (in centipawns)
/// from the starting weights `w0`: the prior keeps weights the data barely sees where they were.
fn descend(train: &Data, w0: &[f64], k: f64, lambda: f64, iterations: usize) -> Vec<f64> {
    let n = w0.len();
    let mut w = w0.to_vec();
    let (mut m, mut v) = (vec![0.0; n], vec![0.0; n]);
    let (b1, b2, lr, eps) = (0.9f64, 0.999f64, 1.0f64, 1e-12f64);
    for t in 1..=iterations {
        let mut g = gradient(train, &w, k);
        for j in 0..n {
            g[j] += 2.0 * lambda * (w[j] - w0[j]);
            m[j] = b1 * m[j] + (1.0 - b1) * g[j];
            v[j] = b2 * v[j] + (1.0 - b2) * g[j] * g[j];
            let mh = m[j] / (1.0 - b1.powi(t as i32));
            let vh = v[j] / (1.0 - b2.powi(t as i32));
            w[j] -= lr * mh / (vh.sqrt() + eps);
        }
    }
    w
}

/// `texel fit <holdout-every> <iterations> <lambdas> <files…>`. Games with id % every == 0 are the
/// held-out test set, id % every == 1 the validation set that picks lambda (a comma list), the
/// rest train. Errors are printed with the engine's own integer evaluation.
fn fit(args: &[String]) {
    let every: u64 = arg(args, 1, 10);
    let iterations: usize = arg(args, 2, 1500);
    let lambdas: Vec<f64> = args.get(3).map_or(vec![0.0], |s| s.split(',').filter_map(|x| x.parse().ok()).collect());
    let n = to_vec(&PARAMS).len();
    let mut sets = [Data::new(), Data::new(), Data::new()];
    let mut sets_pos: [Vec<(Chess, f32)>; 3] = [Vec::new(), Vec::new(), Vec::new()];
    let mut games: [HashSet<u64>; 3] = [HashSet::new(), HashSet::new(), HashSet::new()];
    for path in &args[4..] {
        let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{path}: {e}"));
        for line in text.lines() {
            let mut f = line.split('\t');
            let (Some(fen), Some(r), Some(g)) = (f.next(), f.next(), f.next()) else { continue };
            let (Some(pos), Ok(r), Ok(g)) = (parse_fen(fen), r.parse::<f32>(), g.parse::<u64>()) else { continue };
            let s = match g % every {
                0 => 2,
                1 => 1,
                _ => 0,
            };
            sets[s].push(&features(&pos, n), r);
            sets_pos[s].push((pos, r));
            games[s].insert(g);
        }
    }
    let names = ["train", "validation", "held-out"];
    for s in 0..3 {
        println!("{}: {} positions from {} games", names[s], sets[s].len(), games[s].len());
    }
    let w0: Vec<f64> = to_vec(&PARAMS).iter().map(|&x| x as f64).collect();
    let k = fit_k(&sets[0], &w0);
    println!("K = {k:.4} (fitted on train with the current weights)");
    let report = |label: &str, p: &Params| {
        let e: Vec<f64> = (0..3).map(|s| mse_exact(&sets_pos[s], p, k)).collect();
        println!("{label}: train {:.6} validation {:.6} held-out {:.6}", e[0], e[1], e[2]);
        e
    };
    report("before", &PARAMS);
    let mut best: Option<(f64, Params)> = None;
    for &lambda in &lambdas {
        let w = descend(&sets[0], &w0, k, lambda, iterations);
        let p = from_vec(&w.iter().map(|x| x.round() as i32).collect::<Vec<_>>());
        let e = report(&format!("lambda {lambda:e}"), &p);
        if best.as_ref().is_none_or(|(b, _)| e[1] < *b) {
            best = Some((e[1], p));
        }
    }
    let (_, fitted) = best.expect("at least one lambda");
    report("after (lowest validation error)", &fitted);
    let mut old = PARAMS;
    let mut new = fitted;
    for ((name, a), (_, b)) in slots(&mut old).into_iter().zip(slots(&mut new)) {
        if a != b {
            println!("  {name}: {a} -> {b}");
        }
    }
    print_params(&fitted);
}

/// `chess-engine texel …`: offline tooling, never reached from the protocol loop.
pub fn tool(args: &[String]) {
    match args.first().map(String::as_str) {
        Some("gen") => {
            let shard: u64 = arg(args, 1, 0);
            let shards: u64 = arg(args, 2, 1);
            let depth: u32 = arg(args, 3, 6);
            let variants: u64 = arg(args, 4, 4);
            let stdin = io::stdin();
            let lines: Vec<String> = stdin.lock().lines().map_while(Result::ok).collect();
            let mut out = io::stdout();
            for (i, line) in lines.iter().enumerate() {
                let mv: Vec<String> = line.split_whitespace().map(String::from).collect();
                let Some((pos, _)) = replay(&mv) else {
                    eprintln!("skipping unplayable line: {line}");
                    continue;
                };
                for v in 0..variants {
                    let id = i as u64 * 1000 + v;
                    if id % shards != shard {
                        continue;
                    }
                    let (quiet, r) = play(pos.clone(), depth, id.wrapping_mul(0x2545_f491_4f6c_dd1d), v > 0);
                    for fen in &quiet {
                        writeln!(out, "{fen}\t{r}\t{id}").ok();
                    }
                    out.flush().ok();
                    eprintln!("game {id}: {} quiet positions, result {r}", quiet.len());
                }
            }
        }
        Some("fit") => fit(args),
        _ => eprintln!("usage: chess-engine texel gen <shard> <shards> <depth> <variants> | fit <holdout-every> <iterations> <lambdas> <files…>"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::evaluate;

    #[test]
    fn features_times_weights_give_the_evaluation() {
        let w: Vec<f64> = to_vec(&PARAMS).iter().map(|&x| x as f64).collect();
        let n = w.len();
        for fen in [
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4",
            "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
            "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
        ] {
            let pos = parse_fen(fen).unwrap();
            let f = features(&pos, n);
            let lin: f64 = f.iter().map(|&(j, x)| w[j as usize] * x as f64).sum();
            let e = if pos.turn() == Color::White { evaluate(&pos) } else { -evaluate(&pos) };
            assert!((lin - e as f64).abs() < 1.0, "{fen}: {lin} vs {e}");
        }
    }

    #[test]
    fn params_round_trip_through_the_slot_vector() {
        assert_eq!(from_vec(&to_vec(&PARAMS)), PARAMS);
    }

    #[test]
    fn self_play_game_is_labelled_and_quiet() {
        let pos = replay(&["e2e4".into(), "e7e5".into()]).unwrap().0;
        let (quiet, r) = play(pos, 2, 7, true);
        assert!([0.0, 0.5, 1.0].contains(&r));
        for fen in &quiet {
            let p = parse_fen(fen).unwrap();
            assert!(!p.is_check());
            assert_eq!(quiesce_score(&p), evaluate(&p));
        }
    }
}
