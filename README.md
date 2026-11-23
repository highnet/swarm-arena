# Swarm Arena

An agent swarm on one Claude subscription builds four game engines from zero (Chess, Go 9×9,
Othello, Hex 11×11). A referee plays every new version against fixed reference engines, and the
site shows the race. Every number on it comes from a logged match.

```
swarm-arena/
├── shared/     rules for all four games, referee, Elo, reference players, row types (TypeScript)
├── harness/    the swarm: strategist + seats (Claude Code sessions), gate matches, board writer
├── engines/    Rust workspace, one crate per game. Starts as protocol skeletons; the swarm fills them
├── supabase/   schema (migrations/) and the SAMPLE seed (seed.sql)
├── web/        Next.js site: the race, latest game, the board, strategy seat, seats, graveyard
└── docs/briefs the interview brief this was built from
```

## How it works

1. **Strategist** (one Claude Code session, structured JSON output) reads the board and opens tasks.
2. **Seat** claims a task, runs a Claude Code session inside that engine's crate in its own git
   worktree. The transcript stays local; the board gets structured records only.
3. **Build gate**: `cargo build --release` and `cargo test` must pass.
4. **Smoke test**: 4 games against the random mover; any illegal move, crash or timeout kills the idea.
5. **Gate match**: colour-swapped pairs against the next uncleared rung. The version lands only if
   its measured Elo beats the current one; it is then merged and its Elo point recorded.
   Otherwise the idea goes to the graveyard with the measured reason.

Elo is arena Elo: a random mover is 0 and the rungs in `shared/src/tracks.ts` are provisional until
`arena calibrate` measures them.

## Run it

```bash
npm install
npm test                     # rules (perft etc.), Elo
npm run dev                  # site on :3000, shows the SAMPLE run without Supabase
```

### Supabase

```bash
supabase link --project-ref <ref>
supabase db push             # applies supabase/migrations
psql "$DATABASE_URL" -f supabase/seed.sql   # optional: the SAMPLE run
```

`web/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

The site picks the newest non-sample run and falls back to the sample. With a real run it
subscribes to Supabase Realtime and refreshes as records arrive.

### The swarm

The harness writes with the service role key, from your own machine (the subscription runs
there). Run it on a dedicated branch or clone: landed versions are merged into the checked-out branch.

```bash
export SUPABASE_URL=https://<ref>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service role key>   # never ship this to the site
export ARENA_RUN=run-001

npm run arena -- init "First run"
npm run arena -- swarm --parallel 2 --hours 24
```

Other commands: `status`, `strategist`, `seat <task-id>`, `calibrate <track>`,
`play <track> <a> <b>` (a/b are reference ids like `mcts-2000` or paths to engine binaries).
External references need their binaries: `stockfish` (chess rungs), `gnugo` (Go rungs). The Edax
adapter for the Othello rungs is not written yet.

Set `ARENA_STORE=file` to run everything offline against `.arena/store.json`.

Knobs: `ARENA_MOVE_MS` (default 200), `ARENA_GATE_PAIRS` (20), `ARENA_SESSION_MS` (45 min),
`CLAUDE_BIN`, `STOCKFISH_BIN`, `GNUGO_BIN`.

## Sample data

`npm run sample` regenerates `web/data/sample.json` and `supabase/seed.sql`. It is synthetic and
flagged `is_sample`, so the site labels it SAMPLE everywhere. Its replayed boards are real, legal
games between simple reference players, not the engines.
