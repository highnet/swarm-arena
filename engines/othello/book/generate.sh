#!/usr/bin/env bash
# Regenerates the Othello engine's self-generated opening book (task #109).
# Every entry is the engine's own fixed-depth search (`book_depth` in src/book.rs); nothing
# comes from an external book. Deterministic: the same code gives the same book, whatever the
# shard count or machine. Usage, from engines/: othello/book/generate.sh [shards]
set -euo pipefail
SHARDS=${1:-4}
DIR=$(cd "$(dirname "$0")" && pwd)
BIN=target/release/othello-engine
cargo build --release -p othello-engine
ENTRIES="$DIR/entries.txt"
touch "$ENTRIES"
while :; do
  "$BIN" book frontier "$ENTRIES" > "$DIR/frontier.txt"
  n=$(wc -l < "$DIR/frontier.txt")
  echo "frontier: $n positions ($(wc -l < "$ENTRIES") stored)"
  [ "$n" -eq 0 ] && break
  for s in $(seq 0 $((SHARDS - 1))); do
    "$BIN" book analyse "$s" "$SHARDS" < "$DIR/frontier.txt" > "$DIR/shard-$s.txt" &
  done
  wait
  cat "$DIR"/shard-*.txt >> "$ENTRIES"
  rm -f "$DIR"/shard-*.txt
done
rm -f "$DIR/frontier.txt"
sort -o "$ENTRIES" "$ENTRIES"
"$BIN" book pack "$ENTRIES" > "$DIR/othello-book.bin"
echo "book: $(wc -l < "$ENTRIES") entries, $(wc -c < "$DIR/othello-book.bin") bytes"
# The engine embeds the book with include_bytes!: rebuild so target/release plays the new one.
cargo build --release -p othello-engine
