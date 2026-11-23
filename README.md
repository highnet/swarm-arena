# Swarm Arena

An agent swarm of Claude Code cloud sessions builds four game engines from zero (Chess, Go 9×9,
Othello, Hex 11×11). A referee plays every new version against fixed reference engines, and the
site shows the race. Every number on it comes from a logged match.

```
swarm-arena/
├── shared/     rules for all four games, referee, Elo, reference players, row types (TypeScript)
├── harness/    the `arena` CLI: task board, referee, gate matches, shipping
├── engines/    Rust workspace, one crate per game. Starts as protocol skeletons; the swarm fills them
├── supabase/   schema (migrations/)
├── web/        Next.js site: the race, latest game, the board, strategy seat, seats, graveyard
└── docs/briefs the interview brief this was built from
```

## How it works

Each game has two things the swarm owns and edits: its **engine** (`engines/<game>`) and its
**playbook** skill (`.claude/skills/<game>-playbook/SKILL.md`), which agents load before touching
that engine. The referee appends every verdict to the playbook's results log and keeps playbook
lessons even when an idea is buried.

There is no finish line. Engines climb ladders of reference opponents (Stockfish, GNU Go, Edax,
growing searches for Hex); past the top rung, each new version is rated against the previous one.

Every agent is a Claude Code cloud session on this repository. Prompt a session with
"run a swarm agent" or "run the swarm strategist"; `CLAUDE.md` routes it to the matching skill.

- **Strategist** (`.claude/skills/swarm-strategist`): `arena brief` → decide → `arena plan plan.json`
  posts the strategy call and opens at most one task per engine.
- **Agent** (`.claude/skills/swarm-agent`): `arena next` claims a task and prints its briefing; the
  session improves that engine's crate; `arena submit <task>` hands it to the referee:
  1. `cargo build --release` and `cargo test` must pass.
  2. Smoke test: 4 games against the random mover; any illegal move, crash or timeout buries it.
  3. Gate match: colour-swapped pairs against the next uncleared rung.
  4. Ship only if the rating beats the current one: commit engine and playbook, rebase onto
     `main`, push. Otherwise the engine change is discarded and the playbook keeps the lesson.

Ratings are anchored at 0 for a random mover; the rung values in `shared/src/tracks.ts` are
provisional until `arena calibrate` measures them.

## Run it

```bash
npm install
npm test                     # rules (perft etc.), Elo
npm run dev                  # site on :3000 (ladders at the start line without Supabase)
```

### Supabase

```bash
supabase link --project-ref <ref>
supabase db push             # applies supabase/migrations
```

`web/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

The site shows the newest run, or the ladders at the start line before one exists. It
subscribes to Supabase Realtime and refreshes as records arrive.

### The swarm

Cloud sessions need, in their environment:

- Setup script: `npm ci && npm run arena -- prepare` (Stockfish, GNU Go, Edax, warm cargo builds, cached main binaries). It runs once per environment snapshot; agents rerun `prepare`, which takes seconds when warm.
- Network: the Supabase host, `github.com` for the Edax clone, package registries.
- `SUPABASE_URL` and `ARENA_RUN` as environment variables, and the project's secret key
  (`sb_secret_…`) as a network secret for the Supabase host, sent in the `apikey` header. The
  harness never needs the key in a variable. Never ship it to the site.
- Permission to push to `main`: the referee ships versions there.

Start a run once, then prompt sessions (by hand or on a schedule):

```bash
npm run arena -- init "First run"     # once per run (ARENA_RUN, default run-001)
```

> run the swarm strategist
> run a swarm agent

Or leave it running: `/loop /swarm-conductor` in a cloud session surveys the board each tick and
starts one session per role and target. `docs/LOOPS.md` has the prompts, including a two-session
builder/judge loop for when sessions cannot start sessions.

Operator commands: `status`, `calibrate <track>`, `play <track> <a> <b>` (references like
`stockfish-3`, `gnugo-5`, `edax-6`, `mcts-2000`, or a path to an engine binary).
Set `ARENA_STORE=file` to run everything offline against `.arena/store.json`.

Knobs: `ARENA_MOVE_MS` (default 200), `ARENA_GATE_PAIRS` (20), `STOCKFISH_BIN`, `GNUGO_BIN`,
`EDAX_BIN`.

## Deployment

The site deploys to Vercel from `main` (project root `web/`). Preview deployments are off: only
`main` builds. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the Vercel
project to read the run.
