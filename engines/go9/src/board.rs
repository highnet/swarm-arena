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
        p != self.ko && self.cell[p as usize] == EMPTY && !self.is_suicide(p, self.to_move)
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

    /// A uniform random move among the empty points that are legal and not own eyes, or PASS.
    pub fn random_move(&self, rng: &mut Rng, buf: &mut [u8; NN]) -> u8 {
        let mut len = 0;
        for p in 0..NN {
            if self.cell[p] == EMPTY {
                buf[len] = p as u8;
                len += 1;
            }
        }
        let c = self.to_move;
        while len > 0 {
            let j = rng.below(len);
            let p = buf[j];
            if !self.is_eye(p, c) && self.is_legal(p) {
                return p;
            }
            len -= 1;
            buf[j] = buf[len];
        }
        PASS
    }

    /// Plays random moves until two passes or `cap` moves; returns the final area score
    /// (positive favours black).
    pub fn playout(&mut self, rng: &mut Rng, cap: u32, komi: f32) -> f32 {
        let mut buf = [0u8; NN];
        let mut moves = 0;
        while self.passes < 2 && moves < cap {
            let m = self.random_move(rng, &mut buf);
            self.play(m);
            moves += 1;
        }
        self.score(komi)
    }

    /// `playout`, appending every move it plays (passes included) to `seq`.
    pub fn playout_recorded(&mut self, rng: &mut Rng, cap: u32, komi: f32, seq: &mut Vec<u8>) -> f32 {
        let mut buf = [0u8; NN];
        let mut moves = 0;
        while self.passes < 2 && moves < cap {
            let m = self.random_move(rng, &mut buf);
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
    }
}
