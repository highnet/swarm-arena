//! Flat 9×9 playout board, written for speed: 81 cells, chains kept as circular linked lists
//! with a shared head, pseudo-liberty counts per chain, and a simple-ko point.
//!
//! It knows captures, suicide and simple ko, but not positional superko: the root of the search
//! uses goban plus the seen-board set as the legality oracle for the move actually played.

pub const N: usize = 9;
pub const NN: usize = N * N;
/// The pass move, and "no point" for the ko field.
pub const PASS: u8 = NN as u8;

pub const EMPTY: u8 = 0;
pub const BLACK: u8 = 1;
pub const WHITE: u8 = 2;

const OFF: u8 = u8::MAX;
/// How many self-atari picks a random playout move redraws before accepting one.
const SELF_ATARI_REDRAWS: u32 = 4;

/// Orthogonal neighbours of each point; OFF marks the edge.
const NEIGH: [[u8; 4]; NN] = build_neigh();
/// Diagonal neighbours of each point; OFF marks the edge.
const DIAG: [[u8; 4]; NN] = build_diag();

const fn at(r: isize, c: isize) -> u8 {
    if r < 0 || c < 0 || r >= N as isize || c >= N as isize {
        OFF
    } else {
        (r as usize * N + c as usize) as u8
    }
}

const fn build_neigh() -> [[u8; 4]; NN] {
    let mut t = [[OFF; 4]; NN];
    let mut i = 0;
    while i < NN {
        let (r, c) = ((i / N) as isize, (i % N) as isize);
        t[i] = [at(r - 1, c), at(r + 1, c), at(r, c - 1), at(r, c + 1)];
        i += 1;
    }
    t
}

const fn build_diag() -> [[u8; 4]; NN] {
    let mut t = [[OFF; 4]; NN];
    let mut i = 0;
    while i < NN {
        let (r, c) = ((i / N) as isize, (i % N) as isize);
        t[i] = [at(r - 1, c - 1), at(r - 1, c + 1), at(r + 1, c - 1), at(r + 1, c + 1)];
        i += 1;
    }
    t
}

#[inline]
pub fn opponent(c: u8) -> u8 {
    3 - c
}

#[derive(Clone)]
pub struct Board {
    pub cell: [u8; NN],
    /// Chain head of each stone.
    head: [u8; NN],
    /// Next stone of the same chain (circular).
    next: [u8; NN],
    /// Pseudo-liberties of the chain, indexed by its head: one per (stone, empty neighbour) pair.
    /// Zero exactly when the chain has no liberty.
    libs: [u16; NN],
    /// Stones in the chain, indexed by its head.
    size: [u8; NN],
    /// The point the side to move may not play because of simple ko, or PASS.
    pub ko: u8,
    pub to_move: u8,
    /// Consecutive passes so far.
    pub passes: u8,
    /// The last move played (PASS if none or a pass).
    pub last: u8,
    /// The empty points, in no order: `empty[..n_empty]`; `epos[p]` is p's index there.
    empty: [u8; NN],
    epos: [u8; NN],
    n_empty: u8,
}

/// Small xorshift RNG.
pub struct Rng(pub u64);

impl Rng {
    #[inline]
    pub fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    /// Uniform-ish integer in 0..n (n > 0).
    #[inline]
    pub fn below(&mut self, n: usize) -> usize {
        ((self.next() >> 32) * n as u64 >> 32) as usize
    }
}

impl Board {
    pub fn empty(to_move: u8) -> Self {
        Board {
            cell: [EMPTY; NN],
            head: [0; NN],
            next: [0; NN],
            libs: [0; NN],
            size: [0; NN],
            ko: PASS,
            to_move,
            passes: 0,
            last: PASS,
            empty: std::array::from_fn(|i| i as u8),
            epos: std::array::from_fn(|i| i as u8),
            n_empty: NN as u8,
        }
    }

    /// A board holding these stones (row-major, row 0 at the top), with no ko point.
    /// The stones must form a legal position: every chain has a liberty.
    pub fn from_cells(cells: &[u8; NN], to_move: u8) -> Self {
        let mut b = Board::empty(to_move);
        for (p, &c) in cells.iter().enumerate() {
            if c != EMPTY {
                b.put(p as u8, c);
            }
        }
        b
    }

    /// Places a stone and merges it with its friends. Updates neighbours' pseudo-liberties but
    /// removes nothing.
    fn put(&mut self, p: u8, c: u8) {
        let pi = p as usize;
        self.cell[pi] = c;
        // Drop p from the empty list.
        let (i, last) = (self.epos[pi], self.empty[self.n_empty as usize - 1]);
        self.empty[i as usize] = last;
        self.epos[last as usize] = i;
        self.n_empty -= 1;
        self.head[pi] = p;
        self.next[pi] = p;
        self.size[pi] = 1;
        let mut libs = 0;
        for &n in &NEIGH[pi] {
            if n == OFF {
                continue;
            }
            if self.cell[n as usize] == EMPTY {
                libs += 1;
            } else {
                self.libs[self.head[n as usize] as usize] -= 1;
            }
        }
        self.libs[pi] = libs;
        for &n in &NEIGH[pi] {
            if n != OFF && self.cell[n as usize] == c {
                let (a, b) = (self.head[pi], self.head[n as usize]);
                if a != b {
                    self.merge(a, b);
                }
            }
        }
    }

    /// Joins chain `b` into chain `a` (or the other way round, the smaller into the larger).
    fn merge(&mut self, a: u8, b: u8) {
        let (big, small) = if self.size[a as usize] >= self.size[b as usize] { (a, b) } else { (b, a) };
        let mut s = small;
        loop {
            self.head[s as usize] = big;
            s = self.next[s as usize];
            if s == small {
                break;
            }
        }
        self.next.swap(big as usize, small as usize);
        self.libs[big as usize] += self.libs[small as usize];
        self.size[big as usize] += self.size[small as usize];
    }

    /// Removes the chain with head `h`, returning how many stones it had.
    fn remove(&mut self, h: u8) -> u32 {
        let mut count = 0;
        let mut s = h;
        loop {
            self.cell[s as usize] = EMPTY;
            self.empty[self.n_empty as usize] = s;
            self.epos[s as usize] = self.n_empty;
            self.n_empty += 1;
            count += 1;
            s = self.next[s as usize];
            if s == h {
                break;
            }
        }
        // Every neighbouring stone gains a liberty per removed stone it touches.
        loop {
            for &n in &NEIGH[s as usize] {
                if n != OFF && self.cell[n as usize] != EMPTY {
                    self.libs[self.head[n as usize] as usize] += 1;
                }
            }
            s = self.next[s as usize];
            if s == h {
                break;
            }
        }
        count
    }

    /// Whether `c` playing on empty point `p` would leave its own chain without liberties
    /// and capture nothing.
    pub fn is_suicide(&self, p: u8, c: u8) -> bool {
        let nb = &NEIGH[p as usize];
        for &n in nb {
            if n == OFF {
                continue;
            }
            let ni = n as usize;
            let col = self.cell[ni];
            if col == EMPTY {
                return false;
            }
            let h = self.head[ni];
            // How many of p's neighbours belong to this chain: p takes that many pseudo-liberties.
            let k = nb.iter().filter(|&&m| m != OFF && self.cell[m as usize] != EMPTY && self.head[m as usize] == h).count() as u16;
            let libs = self.libs[h as usize];
            if col == c {
                if libs > k {
                    return false;
                }
            } else if libs == k {
                return false; // captures
            }
        }
        true
    }

    /// Legal for the side to move under captures, suicide and simple ko.
    pub fn is_legal(&self, p: u8) -> bool {
        if p == self.ko || self.cell[p as usize] != EMPTY {
            return false;
        }
        // Fast path: an empty neighbour is a liberty.
        if NEIGH[p as usize].iter().any(|&n| n != OFF && self.cell[n as usize] == EMPTY) {
            return true;
        }
        !self.is_suicide(p, self.to_move)
    }

    /// Single-point eye of `c`: every orthogonal neighbour is `c`, and the diagonals hold at most
    /// one enemy stone (none on the edge), so the eye is not false.
    pub fn is_eye(&self, p: u8, c: u8) -> bool {
        let pi = p as usize;
        if self.cell[pi] != EMPTY {
            return false;
        }
        for &n in &NEIGH[pi] {
            if n != OFF && self.cell[n as usize] != c {
                return false;
            }
        }
        let (mut enemy, mut edge) = (0, false);
        for &d in &DIAG[pi] {
            if d == OFF {
                edge = true;
            } else if self.cell[d as usize] == opponent(c) {
                enemy += 1;
            }
        }
        if edge { enemy == 0 } else { enemy <= 1 }
    }

    /// Plays a legal move for the side to move (`is_legal` must hold) or a pass.
    pub fn play(&mut self, p: u8) {
        let c = self.to_move;
        self.to_move = opponent(c);
        self.ko = PASS;
        self.last = p;
        if p == PASS {
            self.passes += 1;
            return;
        }
        self.passes = 0;
        self.put(p, c);
        let opp = opponent(c);
        let (mut captured, mut last) = (0, PASS);
        for &n in &NEIGH[p as usize] {
            if n != OFF && self.cell[n as usize] == opp {
                let h = self.head[n as usize];
                if self.libs[h as usize] == 0 {
                    captured += self.remove(h);
                    last = n;
                }
            }
        }
        let h = self.head[p as usize] as usize;
        if captured == 1 && self.size[h] == 1 && self.libs[h] == 1 {
            self.ko = last;
        }
    }

    /// Tromp-Taylor area score, positive favours black, komi included.
    pub fn score(&self, komi: f32) -> f32 {
        let mut s = -komi;
        let mut seen = [false; NN];
        let mut stack = [0u8; NN];
        for i in 0..NN {
            match self.cell[i] {
                BLACK => s += 1.0,
                WHITE => s -= 1.0,
                _ if !seen[i] => {
                    seen[i] = true;
                    stack[0] = i as u8;
                    let (mut top, mut size, mut touch) = (1, 0, 0u8);
                    while top > 0 {
                        top -= 1;
                        let q = stack[top] as usize;
                        size += 1;
                        for &n in &NEIGH[q] {
                            if n == OFF {
                                continue;
                            }
                            let col = self.cell[n as usize];
                            if col == EMPTY {
                                if !seen[n as usize] {
                                    seen[n as usize] = true;
                                    stack[top] = n;
                                    top += 1;
                                }
                            } else {
                                touch |= col;
                            }
                        }
                    }
                    if touch == BLACK {
                        s += size as f32;
                    } else if touch == WHITE {
                        s -= size as f32;
                    }
                }
                _ => {}
            }
        }
        s
    }

    /// Moves a playout may choose: legal and not the mover's own eye.
    pub fn playout_moves(&self, out: &mut Vec<u8>) {
        out.clear();
        let c = self.to_move;
        for p in 0..NN as u8 {
            if self.cell[p as usize] == EMPTY && !self.is_eye(p, c) && self.is_legal(p) {
                out.push(p);
            }
        }
    }

    /// ORs the liberties of the chain with head `h` into `mask` (bit p = point p).
    #[inline]
    fn chain_libs(&self, h: u8, mask: &mut u128) {
        let mut s = h;
        loop {
            for &n in &NEIGH[s as usize] {
                if n != OFF && self.cell[n as usize] == EMPTY {
                    *mask |= 1u128 << n;
                }
            }
            s = self.next[s as usize];
            if s == h {
                break;
            }
        }
    }

    /// The single liberty of the chain with head `h`, if it is in atari. A lone liberty touches
    /// at most four stones, so more than four pseudo-liberties means at least two liberties.
    #[inline]
    fn atari_lib(&self, h: u8) -> Option<u8> {
        if self.libs[h as usize] > 4 {
            return None;
        }
        // Walk the chain, stopping at the second distinct liberty.
        let mut lib = OFF;
        let mut s = h;
        loop {
            for &n in &NEIGH[s as usize] {
                if n != OFF && self.cell[n as usize] == EMPTY && n != lib {
                    if lib != OFF {
                        return None;
                    }
                    lib = n;
                }
            }
            s = self.next[s as usize];
            if s == h {
                break;
            }
        }
        if lib == OFF { None } else { Some(lib) }
    }

    /// Whether `c` playing on empty point `p` leaves its own chain with exactly one liberty
    /// without capturing anything (self-atari). Exact liberties are counted only when `p` has
    /// at most one empty neighbour.
    pub fn is_self_atari(&self, p: u8, c: u8) -> bool {
        let nb = &NEIGH[p as usize];
        let mut mask = 0u128;
        for &n in nb {
            if n != OFF && self.cell[n as usize] == EMPTY {
                mask |= 1u128 << n;
            }
        }
        if mask.count_ones() >= 2 {
            return false;
        }
        let opp = opponent(c);
        for (i, &n) in nb.iter().enumerate() {
            if n == OFF {
                continue;
            }
            let col = self.cell[n as usize];
            if col == EMPTY {
                continue;
            }
            let h = self.head[n as usize];
            if nb[..i].iter().any(|&m| m != OFF && self.cell[m as usize] != EMPTY && self.head[m as usize] == h) {
                continue;
            }
            if col == opp {
                if self.atari_lib(h) == Some(p) {
                    return false; // captures
                }
            } else {
                self.chain_libs(h, &mut mask);
                if (mask & !(1u128 << p)).count_ones() >= 2 {
                    return false;
                }
            }
        }
        mask &= !(1u128 << p);
        mask.count_ones() == 1
    }

    /// Whether `p` touches a stone of `c`.
    #[inline]
    fn joins_own(&self, p: u8, c: u8) -> bool {
        NEIGH[p as usize].iter().any(|&n| n != OFF && self.cell[n as usize] == c)
    }

    /// Liberties `c` would have after playing `p`, counting a capture as two (the stones taken
    /// free at least one point next to `p`, usually more).
    fn libs_after(&self, p: u8, c: u8) -> u32 {
        let nb = &NEIGH[p as usize];
        let mut mask = 0u128;
        let opp = opponent(c);
        for &n in nb {
            if n == OFF {
                continue;
            }
            let col = self.cell[n as usize];
            if col == EMPTY {
                mask |= 1u128 << n;
            } else if col == c {
                self.chain_libs(self.head[n as usize], &mut mask);
            } else if col == opp && self.atari_lib(self.head[n as usize]) == Some(p) {
                return 2;
            }
        }
        mask &= !(1u128 << p);
        mask.count_ones()
    }

    /// The tactical reply to the last move, if any: (a) save an own chain next to it that is in
    /// atari, by capturing an adjacent enemy chain in atari (the largest) or by extending on the
    /// liberty when that gives two or more; otherwise (b) capture the last move's chain if it is
    /// in atari. Every move returned is legal.
    pub fn tactical_move(&self) -> Option<u8> {
        let last = self.last;
        if last == PASS || self.cell[last as usize] == EMPTY {
            return None;
        }
        let c = self.to_move;
        let opp = opponent(c);
        // (a) escape.
        let mut best: Option<u8> = None;
        let mut best_size = 0u32;
        let mut extend: Option<u8> = None;
        let nb = &NEIGH[last as usize];
        for (i, &n) in nb.iter().enumerate() {
            if n == OFF || self.cell[n as usize] != c {
                continue;
            }
            let h = self.head[n as usize];
            if nb[..i].iter().any(|&m| m != OFF && self.cell[m as usize] == c && self.head[m as usize] == h) {
                continue;
            }
            let Some(lib) = self.atari_lib(h) else { continue };
            // Capture an enemy chain in atari touching this chain.
            let mut s = h;
            loop {
                for &m in &NEIGH[s as usize] {
                    if m != OFF && self.cell[m as usize] == opp {
                        let eh = self.head[m as usize];
                        let sz = self.size[eh as usize] as u32;
                        if sz > best_size {
                            if let Some(l) = self.atari_lib(eh) {
                                if self.is_legal(l) {
                                    best = Some(l);
                                    best_size = sz;
                                }
                            }
                        }
                    }
                }
                s = self.next[s as usize];
                if s == h {
                    break;
                }
            }
            if extend.is_none() && self.is_legal(lib) && self.libs_after(lib, c) >= 2 {
                extend = Some(lib);
            }
        }
        if best.is_some() {
            return best;
        }
        if extend.is_some() {
            return extend;
        }
        // (b) capture the last move's chain.
        if self.cell[last as usize] == opp {
            if let Some(l) = self.atari_lib(self.head[last as usize]) {
                if self.is_legal(l) {
                    return Some(l);
                }
            }
        }
        None
    }

    /// A uniform random move among the empty points that are legal and not own eyes, or PASS.
    /// Self-atari moves that join an own chain and capture nothing are redrawn, up to
    /// SELF_ATARI_REDRAWS times; a lone stone's self-atari (a throw-in or nakade) is kept, since
    /// rejecting it too was weaker. When only self-ataris remain, the first one rejected is
    /// played rather than passing.
    pub fn random_move(&self, rng: &mut Rng, buf: &mut [u8; NN]) -> u8 {
        let mut len = self.n_empty as usize;
        buf[..len].copy_from_slice(&self.empty[..len]);
        let c = self.to_move;
        let (mut redraws, mut fallback) = (0, PASS);
        while len > 0 {
            let j = rng.below(len);
            let p = buf[j];
            if !self.is_eye(p, c) && self.is_legal(p) {
                if redraws < SELF_ATARI_REDRAWS && self.joins_own(p, c) && self.is_self_atari(p, c) {
                    redraws += 1;
                    if fallback == PASS {
                        fallback = p;
                    }
                } else {
                    return p;
                }
            }
            len -= 1;
            buf[j] = buf[len];
        }
        fallback
    }

    /// The playout policy: the tactical reply to the last move if there is one, else a random
    /// move that avoids self-atari.
    #[inline]
    pub fn policy_move(&self, rng: &mut Rng, buf: &mut [u8; NN]) -> u8 {
        match self.tactical_move() {
            Some(m) => m,
            None => self.random_move(rng, buf),
        }
    }

    /// Plays policy moves until two passes or `cap` moves, appending each (passes included)
    /// to `seq`; returns the final area score (positive favours black).
    pub fn playout_recorded(&mut self, rng: &mut Rng, cap: u32, komi: f32, seq: &mut Vec<u8>) -> f32 {
        let mut buf = [0u8; NN];
        let mut moves = 0;
        while self.passes < 2 && moves < cap {
            let m = self.policy_move(rng, &mut buf);
            self.play(m);
            seq.push(m);
            moves += 1;
        }
        self.score(komi)
    }

    #[cfg(test)]
    pub fn check_invariants(&self) {
        for p in 0..NN {
            if self.cell[p] == EMPTY {
                continue;
            }
            let h = self.head[p] as usize;
            assert_eq!(self.cell[h], self.cell[p]);
            if h == p {
                let (mut count, mut libs, mut s) = (0, 0u16, p);
                loop {
                    assert_eq!(self.head[s] as usize, h);
                    count += 1;
                    libs += NEIGH[s].iter().filter(|&&n| n != OFF && self.cell[n as usize] == EMPTY).count() as u16;
                    s = self.next[s] as usize;
                    if s == p {
                        break;
                    }
                }
                assert_eq!(count, self.size[h] as u32);
                assert_eq!(libs, self.libs[h]);
                assert!(libs > 0, "chain without liberties left on the board");
            }
        }
        let n = self.n_empty as usize;
        assert_eq!(n, self.cell.iter().filter(|&&c| c == EMPTY).count());
        for i in 0..n {
            let e = self.empty[i] as usize;
            assert_eq!(self.cell[e], EMPTY);
            assert_eq!(self.epos[e] as usize, i);
        }
    }
}

#[cfg(test)]
mod bench {
    use super::*;
    use std::time::Instant;

    /// Playout cost from the empty board (cargo test --release bench -- --nocapture --ignored).
    #[test]
    #[ignore]
    fn playout_bench() {
        let mut rng = Rng(99);
        let mut seq = Vec::new();
        let t = Instant::now();
        let n = 20000;
        let mut moves = 0usize;
        for _ in 0..n {
            let mut b = Board::empty(BLACK);
            seq.clear();
            b.playout_recorded(&mut rng, 243, 7.5, &mut seq);
            moves += seq.len();
        }
        let s = t.elapsed().as_secs_f64();
        println!("{:.0} playouts/s, {:.1} moves/playout, {:.0} ns/move", n as f64 / s, moves as f64 / n as f64, s * 1e9 / moves as f64);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A board from (point, colour) pairs, `to_move` to play, `last` the move just made.
    fn board(stones: &[(u8, u8)], to_move: u8, last: u8) -> Board {
        let mut cells = [EMPTY; NN];
        for &(p, c) in stones {
            cells[p as usize] = c;
        }
        let mut b = Board::from_cells(&cells, to_move);
        b.last = last;
        b.check_invariants();
        b
    }

    #[test]
    fn captures_the_chain_left_in_atari() {
        // White e5 (40) just played into black's mouth: b 31, 39, 41; its last liberty is 49.
        let b = board(&[(31, BLACK), (39, BLACK), (41, BLACK), (40, WHITE)], BLACK, 40);
        assert_eq!(b.tactical_move(), Some(49));
        // Prefer the largest: White can capture the two-stone chain 40-49 rather than nothing.
        let b = board(&[(31, WHITE), (39, WHITE), (41, WHITE), (48, WHITE), (50, WHITE), (40, BLACK), (49, BLACK)], WHITE, 49);
        assert_eq!(b.tactical_move(), Some(58));
    }

    #[test]
    fn escapes_an_atari_by_extending_or_capturing() {
        // Black 40 in atari after White 41; extending at 49 gives three liberties.
        let b = board(&[(40, BLACK), (31, WHITE), (39, WHITE), (41, WHITE)], BLACK, 41);
        assert_eq!(b.tactical_move(), Some(49));
        // Same, but White 41 is itself in atari (black 32, 42; last liberty 50): capturing it
        // is preferred to extending.
        let b = board(&[(40, BLACK), (32, BLACK), (42, BLACK), (31, WHITE), (39, WHITE), (41, WHITE)], BLACK, 41);
        assert_eq!(b.tactical_move(), Some(50));
        // Extending into a dead end (one liberty after) is not an escape: black 0 in the corner,
        // white 1 and the only liberty 9 surrounded by white 18 and 10.
        let b = board(&[(0, BLACK), (1, WHITE), (10, WHITE), (18, WHITE)], BLACK, 1);
        assert_eq!(b.tactical_move(), None);
        // Nothing to do after a quiet move.
        let b = board(&[(40, BLACK), (20, WHITE)], BLACK, 20);
        assert_eq!(b.tactical_move(), None);
    }

    #[test]
    fn self_atari_is_detected_and_never_chosen() {
        // Black at the corner 0 next to white 1 keeps only liberty 9.
        let b = board(&[(1, WHITE), (60, BLACK)], BLACK, 60);
        assert!(b.is_self_atari(0, BLACK));
        assert!(!b.is_self_atari(40, BLACK));
        // Joining a chain that keeps two liberties is fine.
        let b2 = board(&[(1, WHITE), (9, BLACK)], BLACK, 9);
        assert!(!b2.is_self_atari(0, BLACK));
        // A self-atari that captures is allowed: white 1 has only liberty 0 (black 2, 10).
        let b3 = board(&[(1, WHITE), (2, BLACK), (10, BLACK)], BLACK, 10);
        assert!(!b3.is_self_atari(0, BLACK));
        // Black 9 (liberties 0 and 10) next to white 1 and 18: black 0 joins it and leaves the
        // pair with liberty 10 alone. The random policy never picks it while other moves remain.
        let b4 = board(&[(1, WHITE), (18, WHITE), (9, BLACK)], BLACK, 18);
        assert!(b4.is_self_atari(0, BLACK));
        let mut buf = [0u8; NN];
        for seed in 1..3000u64 {
            let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
            let m = b4.random_move(&mut rng, &mut buf);
            assert_ne!(m, 0, "seed {seed} chose the self-atari");
            assert!(b4.is_legal(m));
        }
        // A lone stone's self-atari (a throw-in) is left to the random pick: it is not redrawn.
        let mut seen = false;
        for seed in 1..3000u64 {
            let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
            seen |= b.random_move(&mut rng, &mut buf) == 0;
        }
        assert!(seen);
    }

    #[test]
    fn playouts_keep_the_board_consistent() {
        let mut rng = Rng(0xdead_beef);
        let mut seq = Vec::new();
        for _ in 0..200 {
            let mut b = Board::empty(BLACK);
            let mut buf = [0u8; NN];
            for _ in 0..243 {
                if b.passes >= 2 {
                    break;
                }
                let m = b.policy_move(&mut rng, &mut buf);
                assert!(m == PASS || b.is_legal(m));
                b.play(m);
                seq.push(m);
                b.check_invariants();
            }
        }
    }
}
