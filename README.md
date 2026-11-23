# Swarm Arena

An agent swarm on one Claude subscription builds four game engines from zero (Chess, Go 9×9,
Othello, Hex 11×11). A referee plays every new version against fixed reference engines, and the
site shows the race. Every number on it comes from a logged match.

```
swarm-arena/
├── shared/     rules for all four games, referee, Elo, reference players, row types (TypeScript)
├── harness/    the `arena` CLI: task board, referee, gate matches, shipping
├── engines/    Rust workspace, one crate per game. Starts as protocol skeletons; the swarm fills them
├── supabase/   schema (migrations/) and the SAMPLE seed (seed.sql)
├── web/        Next.js site: the race, latest game, the board, strategy seat, seats, graveyard
└── docs/briefs the interview brief this was built from
```

## How it works

Every agent is a Claude Code cloud session on this repository. Prompt a session with
"run a swarm agent" or "run the swarm strategist"; `CLAUDE.md` routes it to the matching skill.

- **Strategist** (`.claude/skills/swarm-strategist`): `arena brief` → decide → `arena plan plan.json`
  posts the strategy call and opens at most one task per engine.
- **Agent** (`.claude/skills/swarm-agent`): `arena next` claims a task and prints its briefing; the
  session improves that engine's crate; `arena submit <task>` hands it to the referee:
  1. `cargo build --release` and `cargo test` must pass.
  2. Smoke test: 4 games against the random mover; any illegal move, crash or timeout buries it.
  3. Gate match: colour-swapped pairs against the next uncleared rung.
  4. Ship only if the rating beats the current one: commit, rebase onto `main`, push. Otherwise
     the idea is buried with the measured reason.

Ratings are anchored at 0 for a random mover; the rung values in `shared/src/tracks.ts` are
provisional until `arena calibrate` measures them.

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

Cloud sessions need, in their environment:

- Setup script: `npm ci && ./scripts/install-references.sh` (Stockfish, GNU Go, Edax).
- Network: the Supabase host, `github.com` for the Edax clone, package registries.
- `SUPABASE_URL`, plus the service role key as an environment secret. Never ship that key to
  the site.
- Permission to push to `main`: the referee ships versions there.

Start a run once, then prompt sessions (by hand or on a schedule):

```bash
npm run arena -- init "First run"     # once per run (ARENA_RUN, default run-001)
```

> run the swarm strategist
> run a swarm agent

Operator commands: `status`, `calibrate <track>`, `play <track> <a> <b>` (references like
`stockfish-3`, `gnugo-5`, `edax-6`, `mcts-2000`, or a path to an engine binary).
Set `ARENA_STORE=file` to run everything offline against `.arena/store.json`.

Knobs: `ARENA_MOVE_MS` (default 200), `ARENA_GATE_PAIRS` (20), `STOCKFISH_BIN`, `GNUGO_BIN`,
`EDAX_BIN`.

## Sample data

`npm run sample` regenerates `web/data/sample.json` and `supabase/seed.sql`. It is synthetic and
flagged `is_sample`, so the site labels it SAMPLE everywhere. Its replayed boards are real, legal
games between simple reference players, not the engines.
