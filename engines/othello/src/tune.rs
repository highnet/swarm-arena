//! Offline fit of `evaluate()`'s weights per game phase (task #295). Never used during a game:
//! `othello-engine tune …` is a separate entry point, like the book generator.
//!
//! - `tune gen <openings> <seed> <games> <shard> <shards>`: deterministic self-play from the
//!   balanced suite. Prints one line per recorded position: mover, opponent (hex), the
//!   position's label (final disc margin for the side to move under exact play from the first
//!   position with `SOLVE_EMPTIES` or fewer empties) and whether that label is the position's
//!   own exact solve (`x`) or the game's (`g`).
//! - `tune fit <buckets> <file>…`: logistic (Texel-style) fit of the six features per bucket of
//!   empties. `<buckets>` lists the lower bounds, highest first, e.g. `45,30,15,0`; `0` alone is
//!   the single-phase control. Prints the fitted weights next to v0.7's and the log-losses.

use super::*;
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader};

/// Plies of the midgame search that picks the self-play moves.
const GEN_DEPTH: u32 = 6;
/// Chance (per mille) that a recorded position is left by a uniformly random move instead.
const EPSILON_PERMILLE: u64 = 100;
/// Scale of the integer weights: an evaluation of `SCALE` is one logit (odds e : 1).
pub const SCALE: f64 = 100.0;
/// Ridge on the fitted logits, per position (keeps rare features such as X-squares sane).
const RIDGE: f64 = 1e-4;

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

fn nth_move(avail: u64, k: u32) -> usize {
    (0..64).filter(|i| avail >> i & 1 == 1).nth(k as usize).unwrap()
}

fn empties_of(g: &Game) -> u32 {
    (!(g.get()[0] | g.get()[1])).count_ones()
}

/// Reads the suite's opening lines (moves before the tab; `#` lines are comments).
fn openings(path: &str) -> Vec<Vec<String>> {
    let f = std::fs::File::open(path).unwrap_or_else(|e| panic!("{path}: {e}"));
    BufReader::new(f)
        .lines()
        .map_while(Result::ok)
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .map(|l| l.split('\t').next().unwrap().split_whitespace().map(String::from).collect())
        .collect()
}

/// One recorded position: mover, opponent, whether Black was to move, its own exact value
/// (from its mover's view) if it was solved.
struct Rec {
    me: u64,
    opp: u64,
    black: bool,
    exact: Option<i32>,
}

/// One self-play game from `opening`: every position after the opening that is not in the book
/// and has a legal placement, with its label. Deterministic in `rng`.
fn self_play(opening: &[String], rng: &mut Rng, tt: &mut Tt) -> Vec<(u64, u64, i32, bool)> {
    let mut g = replay(opening).expect("legal opening");
    let mut black = opening.len() % 2 == 0;
    // The suite's openings are 6 plies without a pass, so the colour follows from their length.
    tt.clear();
    let mut recs: Vec<Rec> = Vec::new();
    // Value from Black's view of the first solved position (= the game's result under exact play).
    let mut game_value: Option<i32> = None;
    loop {
        let avail = g.available_moves();
        if avail == 0 {
            let mut p = g.clone();
            p.pass_move();
            if p.available_moves() == 0 {
                let [me, opp] = g.get();
                let v = final_score(me, opp);
                game_value.get_or_insert(if black { v } else { -v });
                break;
            }
            g = p;
            black = !black;
            continue;
        }
        let [me, opp] = g.get();
        let empties = empties_of(&g);
        if let Some(m) = book::probe(&g) {
            g = g.make_move(m).unwrap();
            black = !black;
            continue;
        }
        let random = rng.below(1000) < EPSILON_PERMILLE;
        let chosen;
        if empties <= SOLVE_EMPTIES {
            let mut s = Solver::new(Duration::from_secs(1 << 30));
            let (r, complete) = solve_root(&g, &ordered(avail, None), &mut s);
            assert!(complete);
            let (m, v) = r.unwrap();
            game_value.get_or_insert(if black { v } else { -v });
            recs.push(Rec { me, opp, black, exact: Some(v) });
            chosen = m;
        } else {
            recs.push(Rec { me, opp, black, exact: None });
            tt.new_search();
            chosen = search_run(&g, GEN_DEPTH, Clock::fixed(Instant::now(), Duration::from_secs(1 << 30)), Some(tt)).0;
        }
        let m = if random { nth_move(avail, rng.below(avail.count_ones() as u64) as u32) } else { chosen };
        g = g.make_move(m).unwrap();
        black = !black;
    }
    let gv = game_value.unwrap();
    recs.into_iter()
        .map(|r| match r.exact {
            Some(v) => (r.me, r.opp, v, true),
            None => (r.me, r.opp, if r.black { gv } else { -gv }, false),
        })
        .collect()
}

fn gen(args: &[String]) {
    let [path, seed, games, shard, shards] = args else {
        eprintln!("usage: tune gen <openings> <seed> <games> <shard> <shards>");
        std::process::exit(2);
    };
    let lines = openings(path);
    let seed: u64 = seed.parse().unwrap();
    let games: u64 = games.parse().unwrap();
    let shard: u64 = shard.parse().unwrap();
    let shards: u64 = shards.parse().unwrap();
    // The positions come from v0.7's play whatever `PHASES` holds now, so they reproduce.
    SELF_PLAY_V07.store(true, std::sync::atomic::Ordering::Relaxed);
    let mut tt = Tt::new(18);
    let mut out = io::BufWriter::new(io::stdout());
    for i in (0..games).filter(|i| i % shards == shard) {
        let mut rng = Rng(seed ^ i.wrapping_mul(0xd1b5_4a32_d192_ed03));
        let opening = &lines[(i as usize) % lines.len()];
        for (me, opp, v, exact) in self_play(opening, &mut rng, &mut tt) {
            writeln!(out, "{me:016x} {opp:016x} {v} {}", if exact { 'x' } else { 'g' }).unwrap();
        }
    }
}

/// Float features of one position as `weighted` applies them (potential mobility × empties / 60).
fn float_features(me: u64, opp: u64) -> ([f64; N_FEATURES], u32) {
    let g = Game::new(me, opp).expect("disjoint position");
    let f = features(&g);
    let e = (!(me | opp)).count_ones();
    let mut x = [0.0; N_FEATURES];
    for k in 0..N_FEATURES {
        x[k] = f[k] as f64;
    }
    x[4] *= e as f64 / 60.0;
    (x, e)
}

fn sigmoid(z: f64) -> f64 {
    1.0 / (1.0 + (-z).exp())
}

/// Mean log-loss of logits `w · x` on `data`.
fn log_loss(data: &[([f64; N_FEATURES], f64)], w: &[f64; N_FEATURES]) -> f64 {
    let mut s = 0.0;
    for (x, y) in data {
        let z: f64 = (0..N_FEATURES).map(|k| w[k] * x[k]).sum();
        let p = sigmoid(z).clamp(1e-12, 1.0 - 1e-12);
        s -= y * p.ln() + (1.0 - y) * (1.0 - p).ln();
    }
    s / data.len() as f64
}

/// Solves the n×n system `a x = b` by Gaussian elimination with partial pivoting.
fn solve_linear<const N: usize>(mut a: [[f64; N]; N], mut b: [f64; N]) -> [f64; N] {
    for c in 0..N {
        let p = (c..N).max_by(|&i, &j| a[i][c].abs().total_cmp(&a[j][c].abs())).unwrap();
        a.swap(c, p);
        b.swap(c, p);
        for r in c + 1..N {
            let f = a[r][c] / a[c][c];
            for k in c..N {
                a[r][k] -= f * a[c][k];
            }
            b[r] -= f * b[c];
        }
    }
    let mut x = [0.0; N];
    for c in (0..N).rev() {
        let s: f64 = (c + 1..N).map(|k| a[c][k] * x[k]).sum();
        x[c] = (b[c] - s) / a[c][c];
    }
    x
}

/// Logistic regression without an intercept (the score must stay antisymmetric), by Newton's
/// method on the mean log-loss plus `RIDGE` × |w|². Deterministic.
pub fn fit_logistic(data: &[([f64; N_FEATURES], f64)]) -> [f64; N_FEATURES] {
    let mut w = [0.0; N_FEATURES];
    let n = data.len() as f64;
    for _ in 0..25 {
        let mut grad = [0.0; N_FEATURES];
        let mut hess = [[0.0; N_FEATURES]; N_FEATURES];
        for (x, y) in data {
            let z: f64 = (0..N_FEATURES).map(|k| w[k] * x[k]).sum();
            let p = sigmoid(z);
            let h = p * (1.0 - p);
            for i in 0..N_FEATURES {
                grad[i] += (p - y) * x[i] / n;
                for j in 0..N_FEATURES {
                    hess[i][j] += h * x[i] * x[j] / n;
                }
            }
        }
        for i in 0..N_FEATURES {
            grad[i] += 2.0 * RIDGE * w[i];
            hess[i][i] += 2.0 * RIDGE;
        }
        let step = solve_linear(hess, grad);
        let mut moved = 0.0f64;
        for i in 0..N_FEATURES {
            w[i] -= step[i];
            moved = moved.max(step[i].abs());
        }
        if moved < 1e-9 {
            break;
        }
    }
    w
}

/// The best single scale `k` for fixed weights `w0` (v0.7's), by Newton in one dimension: how
/// well v0.7's weight *shape* predicts the results.
fn fit_scale(data: &[([f64; N_FEATURES], f64)], w0: &[f64; N_FEATURES]) -> f64 {
    let zs: Vec<(f64, f64)> = data.iter().map(|(x, y)| ((0..N_FEATURES).map(|k| w0[k] * x[k]).sum(), *y)).collect();
    let mut k = 0.0;
    for _ in 0..50 {
        let (mut g, mut h) = (0.0, 0.0);
        for (z, y) in &zs {
            let p = sigmoid(k * z);
            g += (p - y) * z;
            h += p * (1.0 - p) * z * z;
        }
        let step = g / h.max(1e-12);
        k -= step;
        if step.abs() < 1e-12 {
            break;
        }
    }
    k
}

fn label(margin: i32) -> f64 {
    match margin.signum() {
        1 => 1.0,
        0 => 0.5,
        _ => 0.0,
    }
}

fn fit(args: &[String]) {
    let Some((buckets, files)) = args.split_first() else {
        eprintln!("usage: tune fit <buckets e.g. 45,30,15,0> <file>…");
        std::process::exit(2);
    };
    let bounds: Vec<u32> = buckets.split(',').map(|b| b.parse().unwrap()).collect();
    assert!(bounds.windows(2).all(|w| w[0] > w[1]) && *bounds.last().unwrap() == 0, "bounds: highest first, ending in 0");
    // A repeated position (opening transpositions repeat often) counts once, with the mean of
    // its labels; a BTreeMap keeps the fit independent of file order and shard count.
    let mut by_pos: BTreeMap<(u64, u64), (f64, u32)> = BTreeMap::new();
    let (mut total, mut exact) = (0u64, 0u64);
    for path in files {
        let f = std::fs::File::open(path).unwrap_or_else(|e| panic!("{path}: {e}"));
        for line in BufReader::new(f).lines().map_while(Result::ok) {
            let p: Vec<&str> = line.split_whitespace().collect();
            let me = u64::from_str_radix(p[0], 16).unwrap();
            let opp = u64::from_str_radix(p[1], 16).unwrap();
            let v: i32 = p[2].parse().unwrap();
            total += 1;
            if p.get(3) == Some(&"x") {
                exact += 1;
            }
            let e = by_pos.entry((me, opp)).or_insert((0.0, 0));
            e.0 += label(v);
            e.1 += 1;
        }
    }
    let dups = total - by_pos.len() as u64;
    let mut data: Vec<Vec<([f64; N_FEATURES], f64)>> = vec![Vec::new(); bounds.len()];
    for (&(me, opp), &(sum, n)) in &by_pos {
        let (x, e) = float_features(me, opp);
        let b = bounds.iter().position(|&lo| e >= lo).unwrap();
        data[b].push((x, sum / n as f64));
    }
    println!("positions {total} ({exact} with exact labels), {dups} repeats merged");
    let v07: [f64; N_FEATURES] = V07_WEIGHTS.map(|w| w as f64);
    println!("weights per bucket (integer, {SCALE} = one logit); v0.7 rescaled by its best-fit scale");
    println!("{:>10} {:>8}  {}  {:>9} {:>9}", "empties", "n", FEATURE_NAMES.map(|n| format!("{n:>8}")).join(" "), "loss", "v0.7 loss");
    for (b, d) in data.iter().enumerate() {
        let hi = if b == 0 { 60 } else { bounds[b - 1] - 1 };
        if d.is_empty() {
            println!("{:>4}-{:<5} {:>8}  (no positions)", hi, bounds[b], 0);
            continue;
        }
        let w = fit_logistic(d);
        let k = fit_scale(d, &v07);
        let ints = w.map(|x| (x * SCALE).round() as i32);
        let v07s = v07.map(|x| x * k);
        println!(
            "{:>4}-{:<5} {:>8}  {}  {:>9.5} {:>9.5}",
            hi,
            bounds[b],
            d.len(),
            ints.map(|x| format!("{x:>8}")).join(" "),
            log_loss(d, &w),
            log_loss(d, &v07s)
        );
        println!("{:>10} {:>8}  {}  (v0.7 × {:.3})", "", "", v07s.map(|x| format!("{:>8}", (x * SCALE).round() as i32)).join(" "), k);
    }
}

pub fn command(args: &[String]) {
    match args.first().map(String::as_str) {
        Some("gen") => gen(&args[1..]),
        Some("fit") => fit(&args[1..]),
        _ => {
            eprintln!("usage: tune gen|fit …");
            std::process::exit(2);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn self_play_is_deterministic_and_labels_are_consistent() {
        let lines = openings(concat!(env!("CARGO_MANIFEST_DIR"), "/../../shared/src/openings/othello.txt"));
        assert!(lines.len() >= 200);
        let mut tt = Tt::new(16);
        let run = |i: u64, tt: &mut Tt| self_play(&lines[i as usize], &mut Rng(295 ^ i), tt);
        for i in 0..3u64 {
            let a = run(i, &mut tt);
            assert_eq!(a, run(i, &mut tt), "game {i} replays identically");
            assert!(!a.is_empty());
            for &(me, opp, v, exact) in &a {
                let g = Game::new(me, opp).unwrap();
                assert_ne!(g.available_moves(), 0, "only positions with a placement");
                assert!(book::probe(&g).is_none(), "in-book positions are skipped");
                let e = (!(me | opp)).count_ones();
                assert_eq!(exact, e <= SOLVE_EMPTIES);
                assert!((-64..=64).contains(&v));
                if exact && e <= 8 {
                    let mut s = Solver::new(Duration::from_secs(60));
                    let (r, _) = solve_root(&g, &ordered(g.available_moves(), None), &mut s);
                    assert_eq!(r.unwrap().1, v, "exact label at {e} empties");
                }
            }
        }
    }

    #[test]
    fn logistic_fit_recovers_known_weights() {
        // Labels drawn from a known logistic model: the fit must land near it.
        let truth = [0.8, 0.3, -0.5, -0.2, 0.1, 0.4];
        let mut rng = Rng(7);
        let mut data = Vec::new();
        for _ in 0..20000 {
            let mut x = [0.0; N_FEATURES];
            for v in x.iter_mut() {
                *v = rng.below(9) as f64 - 4.0;
            }
            let z: f64 = (0..N_FEATURES).map(|k| truth[k] * x[k]).sum();
            let y = if (rng.below(1_000_000) as f64) < sigmoid(z) * 1e6 { 1.0 } else { 0.0 };
            data.push((x, y));
        }
        let w = fit_logistic(&data);
        for k in 0..N_FEATURES {
            assert!((w[k] - truth[k]).abs() < 0.06, "weight {k}: {} vs {}", w[k], truth[k]);
        }
        assert!(log_loss(&data, &w) <= log_loss(&data, &truth) + 1e-9);
    }
}
