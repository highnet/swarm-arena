#!/usr/bin/env bash
# Installs the free reference engines the ladders play against:
#   Stockfish (chess, GPLv3), GNU Go (go, GPLv3), Edax (othello, GPLv3, built from source).
# Hex uses the harness's built-in MCTS ladder, so it needs nothing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REFS="${ARENA_HOME:-$ROOT/.arena}/refs"
mkdir -p "$REFS"

if command -v apt-get >/dev/null; then
  SUDO=$([ "$(id -u)" -eq 0 ] && echo "" || echo "sudo")
  $SUDO apt-get install -y stockfish gnugo || { $SUDO apt-get update && $SUDO apt-get install -y stockfish gnugo; }
elif command -v brew >/dev/null; then
  brew install stockfish gnu-go
else
  echo "Install stockfish and gnugo with your package manager, then rerun." >&2
fi

if [ ! -x "$REFS/edax/bin/lEdax-x86-64" ]; then
  rm -rf "$REFS/edax"
  git clone --depth 1 https://github.com/abulmo/edax-reversi "$REFS/edax"
  ARCH=$([ "$(uname -m)" = "arm64" ] || [ "$(uname -m)" = "aarch64" ] && echo armv8 || echo x86-64)
  (cd "$REFS/edax/src" && make build ARCH="$ARCH" OS=linux CC="${CC:-gcc}" >/dev/null)
  # The harness looks for lEdax-x86-64; keep that name whatever the arch.
  [ -x "$REFS/edax/bin/lEdax-x86-64" ] || cp "$REFS/edax/bin/"*Edax* "$REFS/edax/bin/lEdax-x86-64"
fi

echo "stockfish: $(command -v stockfish || ls /usr/games/stockfish 2>/dev/null || echo missing)"
echo "gnugo:     $(command -v gnugo || ls /usr/games/gnugo 2>/dev/null || echo missing)"
echo "edax:      $REFS/edax/bin/lEdax-x86-64"
