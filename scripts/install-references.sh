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

missing=()
have stockfish || missing+=(stockfish)
have gnugo || missing+=(gnugo)

if [ ${#missing[@]} -gt 0 ]; then
  if have apt-get; then
    # Package lists are empty in fresh containers: update first, then install only what is missing.
    $SUDO apt-get update -qq >/dev/null 2>&1 || true
    $SUDO apt-get install -y -qq --no-install-recommends "${missing[@]}" >/dev/null 2>&1 || true
  elif have brew; then
    brew install stockfish gnu-go || true
  fi
fi

# Fallbacks when no package manager could provide them.
if ! have stockfish; then
  echo "stockfish: building from source" >&2
  rm -rf "$REFS/stockfish-src"
  git -c advice.detachedHead=false clone -q --depth 1 --branch sf_17.1 https://github.com/official-stockfish/Stockfish "$REFS/stockfish-src"
  (cd "$REFS/stockfish-src/src" && { make -s -j"$(nproc)" build ARCH=x86-64-modern >/dev/null 2>&1 \
    || make -s -j"$(nproc)" build ARCH=x86-64 >/dev/null; })
  cp "$REFS/stockfish-src/src/stockfish" "$REFS/bin/stockfish"
  rm -rf "$REFS/stockfish-src"
fi
if ! have gnugo; then
  echo "gnugo: building from source" >&2
  rm -rf "$REFS/gnugo-src" && mkdir -p "$REFS/gnugo-src"
  curl -fsSL https://ftp.gnu.org/gnu/gnugo/gnugo-3.8.tar.gz | tar xz -C "$REFS/gnugo-src" --strip-components 1
  (cd "$REFS/gnugo-src" && ./configure -q CFLAGS="-O2 -fcommon" >/dev/null 2>&1 && make -s -j"$(nproc)" >/dev/null 2>&1)
  cp "$REFS/gnugo-src/interface/gnugo" "$REFS/bin/gnugo"
  rm -rf "$REFS/gnugo-src"
fi

# Browser builds of the engines (played on the site).
if have rustup && ! rustup target list --installed | grep -q wasm32-wasip1; then
  rustup target add wasm32-wasip1 >/dev/null 2>&1 || true
fi

if [ ! -x "$REFS/edax/bin/lEdax-x86-64" ]; then
  rm -rf "$REFS/edax"
  git clone -q --depth 1 https://github.com/abulmo/edax-reversi "$REFS/edax"
  ARCH=$([ "$(uname -m)" = "arm64" ] || [ "$(uname -m)" = "aarch64" ] && echo armv8 || echo x86-64)
  (cd "$REFS/edax/src" && make build ARCH="$ARCH" OS=linux CC="${CC:-gcc}" >/dev/null 2>&1)
  # The harness looks for lEdax-x86-64; keep that name whatever the arch.
  [ -x "$REFS/edax/bin/lEdax-x86-64" ] || cp "$REFS/edax/bin/"*Edax* "$REFS/edax/bin/lEdax-x86-64"
fi

fail=0
for b in stockfish gnugo; do
  if have "$b"; then echo "$b: $(command -v "$b")"; else echo "$b: MISSING" >&2; fail=1; fi
done
echo "edax: $REFS/edax/bin/lEdax-x86-64"
exit $fail
