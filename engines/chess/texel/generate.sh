#!/usr/bin/env bash
# Texel data and fit for the chess evaluation weights (#293). Offline only.
# Self-play games of this engine at a fixed depth from every start line of the referee's balanced
# suite (shared/src/openings/chess.txt), each played <variants> times (variant 0 is the engine's
# own line; the others swap in a near-equal second-best move at a few seeded early plies). Quiet
# positions are labelled with the game result. The engine is single-threaded, so the work is
# sharded as processes. Deterministic for the same parameters and engine source.
#   usage: engines/chess/texel/generate.sh [depth] [variants] [shards] [holdout-every] [iterations] [lambdas]
# lambdas: comma list of L2 strengths toward the current weights; the validation games pick one.
# Writes texel/data/shard<N>.txt (not committed) and prints the fit, ending in a PARAMS block to
# paste into src/main.rs.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
engines="$here/../.."
depth="${1:-5}" variants="${2:-30}" shards="${3:-4}" every="${4:-10}" iters="${5:-1500}" lambdas="${6:-3e-7}"
(cd "$engines" && cargo build --release -p chess-engine)
bin="$engines/target/release/chess-engine"
data="$here/data"
mkdir -p "$data"
grep -v '^#' "$engines/../shared/src/openings/chess.txt" | cut -f1 > "$data/openings.txt"
for s in $(seq 0 $((shards - 1))); do
  "$bin" texel gen "$s" "$shards" "$depth" "$variants" < "$data/openings.txt" \
    > "$data/shard$s.txt" 2> "$data/shard$s.log" &
done
wait
echo "positions: $(cat "$data"/shard*.txt | wc -l), games: $(cat "$data"/shard*.log | grep -c '^game')"
"$bin" texel fit "$every" "$iters" "$lambdas" "$data"/shard*.txt
