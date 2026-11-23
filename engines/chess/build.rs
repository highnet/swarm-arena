//! Solves the engine's endgame tables at build time with the engine's own retrograde analysis
//! (`src/eg_gen.rs`) and writes them where `src/endgame.rs` embeds them. No external tablebase is
//! read: the tables are computed from the rules of chess every build.

#[path = "src/eg_gen.rs"]
mod eg_gen;

use eg_gen::{pack_pawn, pack_pawnless, solve, Piece};
use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-changed=src/eg_gen.rs");
    println!("cargo:rerun-if-changed=build.rs");
    // Cargo's output directory for generated files (a build-time path, not engine input).
    let out = PathBuf::from(std::env::var_os("OUT_DIR").expect("cargo sets OUT_DIR"));
    let kqk = solve(Piece::Queen, None, None);
    let krk = solve(Piece::Rook, None, None);
    let kpk = solve(Piece::Pawn, Some(&kqk), Some(&krk));
    std::fs::write(out.join("kqk.bin"), pack_pawnless(&kqk)).unwrap();
    std::fs::write(out.join("krk.bin"), pack_pawnless(&krk)).unwrap();
    std::fs::write(out.join("kpk.bin"), pack_pawn(&kpk)).unwrap();
}
