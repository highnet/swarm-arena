#!/usr/bin/env bash
# Reproduces the fitted evaluation weights of task #295 (PHASES in src/main.rs).
# 1. Self-play: v0.7's search at fixed depth 6 with v0.7's weights (whatever PHASES holds), 10%
#    uniformly random moves, the balanced suite's 200 openings in turn, in-book plies skipped,
#    the exact solver from 14 empties down. Deterministic from the seed, whatever the shard count.
# 2. Fit: logistic (Texel-style) per bucket of 5 empties (shipped as PHASES), then the 4-bucket
#    and 1-bucket variants measured beside it. Takes ~11 min on 4 cores for 24000 games.
# Usage, from engines/: othello/tune/generate.sh [games] [shards] [seed]
set -euo pipefail
GAMES=${1:-24000}
SHARDS=${2:-4}
SEED=${3:-295}
DIR=$(cd "$(dirname "$0")" && pwd)
BIN=target/release/othello-engine
OPENINGS=../shared/src/openings/othello.txt
OUT=${TUNE_OUT:-$DIR/positions}
cargo build --release -p othello-engine
mkdir -p "$OUT"
for s in $(seq 0 $((SHARDS - 1))); do
  "$BIN" tune gen "$OPENINGS" "$SEED" "$GAMES" "$s" "$SHARDS" > "$OUT/shard-$s.txt" &
done
wait
echo "positions: $(cat "$OUT"/shard-*.txt | wc -l)"
"$BIN" tune fit 50,45,40,35,30,25,20,15,10,5,0 "$OUT"/shard-*.txt
"$BIN" tune fit 45,30,15,0 "$OUT"/shard-*.txt
"$BIN" tune fit 0 "$OUT"/shard-*.txt
