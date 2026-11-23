#!/usr/bin/env bash
# Installs the free reference engines the ladders play against:
#   Stockfish (chess, GPLv3), GNU Go (go, GPLv3), Edax (othello, GPLv3, built from source).
# Hex uses the harness's built-in MCTS ladder, so it needs nothing.
# Idempotent and fast when everything is present: it checks before it installs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REFS="${ARENA_HOME:-$ROOT/.arena}/refs"
mkdir -p "$REFS/bin"
export PATH="$REFS/bin:/usr/games:$PATH"
SUDO=$([ "$(id -u)" -eq 0 ] && echo "" || echo "sudo")

have() { command -v "$1" >/dev/null 2>&1; }

# Stockfish: the official prebuilt release (about a second). GNU Go: a small source build
# (about 20 seconds). Package managers are only a last resort: apt mirrors can take minutes.
if ! have stockfish && [ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ]; then
  flavour=$(grep -q avx2 /proc/cpuinfo && echo avx2 || echo sse41-popcnt)
  tmp=$(mktemp -d)
  if curl -fsSL "https://github.com/official-stockfish/Stockfish/releases/download/sf_17.1/stockfish-ubuntu-x86-64-$flavour.tar" \
    | tar x -C "$tmp"; then
    cp "$tmp/stockfish/stockfish-ubuntu-x86-64-$flavour" "$REFS/bin/stockfish"
  fi
  rm -rf "$tmp"
fi
if ! have gnugo && have cc; then
  tmp=$(mktemp -d)
  if curl -fsSL https://ftp.gnu.org/gnu/gnugo/gnugo-3.8.tar.gz | tar xz -C "$tmp" --strip-components 1; then
    (cd "$tmp" && ./configure -q CFLAGS="-O2 -fcommon" >/dev/null 2>&1 && make -s -j"$(nproc)" >/dev/null 2>&1) \
      && cp "$tmp/interface/gnugo" "$REFS/bin/gnugo"
  fi
  rm -rf "$tmp"
fi

missing=()
have stockfish || missing+=(stockfish)
have gnugo || missing+=(gnugo)
if [ ${#missing[@]} -gt 0 ]; then
  if have brew; then
    brew install stockfish gnu-go || true
  elif have apt-get; then
    $SUDO apt-get install -y -qq --no-install-recommends "${missing[@]}" >/dev/null 2>&1 \
      || { $SUDO apt-get update -qq >/dev/null 2>&1 && $SUDO apt-get install -y -qq --no-install-recommends "${missing[@]}" >/dev/null 2>&1; } || true
  fi
fi

# Browser builds of the engines (played on the site).
if have rustup && ! rustup target list --installed | grep -q wasm32-wasip1; then
  rustup target add wasm32-wasip1 >/dev/null 2>&1 || true
fi

if [ ! -x "$REFS/edax/bin/lEdax-x86-64" ]; then
  rm -rf "$REFS/edax"
  git clone -q --depth 1 https://github.com/abulmo/edax-reversi "$REFS/edax"
  ARCH=$([ "$(uname -m)" = "arm64" ] || [ "$(uname -m)" = "aarch64" ] && echo armv8 || echo x86-64)
  (cd "$REFS/edax/src" && make -j"$(nproc)" build ARCH="$ARCH" OS=linux CC="${CC:-gcc}" >/dev/null 2>&1)
  # The harness looks for lEdax-x86-64; keep that name whatever the arch.
  [ -x "$REFS/edax/bin/lEdax-x86-64" ] || cp "$REFS/edax/bin/"*Edax* "$REFS/edax/bin/lEdax-x86-64"
fi

fail=0
for b in stockfish gnugo; do
  if have "$b"; then echo "$b: $(command -v "$b")"; else echo "$b: MISSING" >&2; fail=1; fi
done
echo "edax: $REFS/edax/bin/lEdax-x86-64"
exit $fail
