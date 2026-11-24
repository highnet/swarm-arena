#!/usr/bin/env bash
# Regenerates the Go 9x9 opening book (#110) from the engine's own search. Run from engines/:
#   go9/book/generate.sh [shards] [playouts]
# Each round searches the book's frontier (positions it should hold but lacks) in parallel
# shards (separate processes: the engine itself stays single-threaded), appends the results and
# repeats until the frontier is empty. Results depend only on the playout budget and the seed,
# never on the shard count or the machine; an interrupted run redoes only its unfinished round.
set -euo pipefail
SHARDS=${1:-4}
PLAYOUTS=${2:-100000}
BOOK=go9/book/go9-book.txt
BIN=target/release/go9-engine
cargo build --release -p go9-engine >&2
while true; do
  status=$($BIN book frontier $BOOK)
  echo "$status" >&2
  case "$status" in *"frontier 0") break ;; esac
  tmp=$(mktemp -d)
  for i in $(seq 0 $((SHARDS - 1))); do
    $BIN book gen $BOOK --playouts "$PLAYOUTS" --shard "$i/$SHARDS" > "$tmp/$i.txt" &
  done
  wait
  { grep '^#' $BOOK; { grep -v '^#' $BOOK || true; cat "$tmp"/*.txt; } | sort -u; } > "$tmp/book"
  mv "$tmp/book" $BOOK
  rm -rf "$tmp"
done
# The book is embedded with include_str!: rebuild so the binary plays the new book.
cargo build --release -p go9-engine >&2
