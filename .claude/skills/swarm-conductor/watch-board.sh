#!/usr/bin/env bash
# Wait until the Rallypoint board changes, then exit, so the conductor ticks at once instead of
# waiting for its heartbeat. Run it from the conductor session in the background; its exit is the
# wake-up. Usage: watch-board.sh [interval_seconds=30] [max_seconds=1800]
#
# "The board" is what role sessions change when they finish: open pull requests (head, labels),
# open issues (labels, assignees) and main's tip. Session leases are left out, so the conductor's
# own lease writes never wake it. A failed read skips that poll rather than counting as a change.
set -uo pipefail

interval=${1:-30}
max=${2:-1800}
repo=${ARENA_REPO:-$(git remote get-url origin | sed -E 's#.*[:/]([^/]+/[^/]+)$#\1#; s#\.git$##')}

fingerprint() {
  local prs issues main
  prs=$(gh api "repos/$repo/pulls?state=open&per_page=100" \
    --jq '[.[] | [.number, .head.sha, (.labels | map(.name) | sort)]]') || return 1
  issues=$(gh api "repos/$repo/issues?state=open&per_page=100" \
    --jq '[.[] | select(.pull_request | not) | [.number, (.labels | map(.name) | sort), (.assignees | map(.login))]]') || return 1
  main=$(git ls-remote origin refs/heads/main | cut -f1) || return 1
  [[ -n $main ]] || return 1
  printf '%s\n%s\n%s\n' "$prs" "$issues" "$main" | sha1sum | cut -c1-12
}

start=""
until start=$(fingerprint); do sleep "$interval"; done
deadline=$((SECONDS + max))
while ((SECONDS < deadline)); do
  sleep "$interval"
  now=$(fingerprint) || continue
  if [[ $now != "$start" ]]; then
    echo "BOARD_CHANGED $(date -u +%H:%M:%S)"
    exit 0
  fi
done
echo "WATCH_EXPIRED $(date -u +%H:%M:%S)"
