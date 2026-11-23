#!/usr/bin/env tsx
import { existsSync, readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { resolve } from 'node:path';
import { performanceElo, playMatch, GAMES, type GameId } from '@arena/shared';
import { ensureRun, records, rungs, tasks, tracks } from './board';
import { ARENA_HOME, ENGINES_DIR, log, MOVE_MS, run, RUN_ID } from './config';
import { arenaEngine } from './engine';
import { reference } from './references';
import { formatMessages, postMessage, readMessages } from './messages';
import { claimNext, currentVersion, release, submit } from './seat';
import { buildWasm } from './wasm';
import { getStore } from './store';
import { applyPlan, brief } from './strategist';

const USAGE = `arena <command>

Agent sessions (run inside a Claude Code session on this repo):
  next [track]                  claim the next task and print its briefing
  submit <task-id>              build, smoke test, gate match; ship to main or bury
  release <task-id>             put a claimed task back on the board
  messages [track] [--limit N]  read the agent message board (engine-wide messages included)
  post "<text>" --as <seat> [--track T] [--kind note|question|proposal|answer|handoff] [--reply ID]
                                post to the agent message board
  brief                         strategist: print the board and the plan format
  plan <plan.json>              strategist: post the strategy call and open tasks

Operator:
  init [label]                  create the run, engines and ladders (ARENA_RUN, default run-001)
  status                        engines, open tasks, last records
  set-password                  store a bcrypt hash of ARENA_PASSWORD; from then on every API write needs it
  calibrate <track> [--pairs N] rate each rung against the one below
  versus <track> [--pairs N]    play the engine in this checkout against the version on main
  wasm <track>                  rebuild the browser build of the engine on this checkout
  play <track> <a> <b> [--pairs N]
                                play references (e.g. stockfish-3, mcts-2000) or engine binaries

Store: Supabase when SUPABASE_URL is set (secret key via SUPABASE_SECRET_KEY or the network proxy), else ${ARENA_HOME}/store.json.`;

const flag = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};

/** npm runs workspace scripts from harness/; resolve paths from where the caller stood. */
const fromCaller = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p);

const mover = async (spec: string, game: GameId, seed: number) =>
  existsSync(fromCaller(spec)) ? arenaEngine(spec, fromCaller(spec), game, MOVE_MS) : reference(spec, game, MOVE_MS, seed);

const main = async () => {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'init': {
      const created = await ensureRun(args[0] ?? `Run ${RUN_ID}`);
      log(created ? `created ${RUN_ID} in ${getStore().kind}` : `${RUN_ID} already exists`);
      return;
    }
    case 'set-password': {
      const password = process.env.ARENA_PASSWORD;
      if (!password) throw new Error('set ARENA_PASSWORD in the environment first');
      // pgcrypto verifies $2a$ bcrypt hashes; bcryptjs emits $2b$, which is the same algorithm.
      const hash = bcrypt.hashSync(password, 10).replace(/^\$2b\$/, '$2a$');
      const db = getStore();
      const existing = await db.select('arena_auth', { id: 1 });
      if (existing.length) await db.update('arena_auth', { id: 1 }, { password_hash: hash, set_at: new Date().toISOString() });
      else await db.insert('arena_auth', { id: 1, password_hash: hash });
      log('arena password set: API writes now require it');
      return;
    }
    case 'status': {
      for (const t of await tracks()) log(`${t.name.padEnd(10)} ${t.current_version ?? '—'} ${t.current_elo ?? '—'}`);
      for (const t of (await tasks()).filter((k) => ['open', 'claimed'].includes(k.status))) log(`task ${t.status} [${t.track_id}] ${t.title} (${t.id})`);
      for (const r of (await records()).slice(-10)) log(`${r.kind.padEnd(14)} ${r.title}`);
      return;
    }
    case 'next': {
      const text = await claimNext(args[0]);
      console.log(text ?? 'No open task. Ask the strategist for more work: npm run arena -- brief');
      return;
    }
    case 'submit': {
      const result = await submit(args[0]);
      console.log(result.shipped ? `Shipped ${result.version}, rated ${result.elo}.` : `Buried: ${result.why}`);
      return;
    }
    case 'messages': {
      const track = args[0] && !args[0].startsWith('--') ? args[0] : undefined;
      console.log(formatMessages(await readMessages(track, flag('limit', 20))) || 'No messages yet.');
      return;
    }
    case 'post': {
      const opt = (name: string) => {
        const i = process.argv.indexOf(`--${name}`);
        return i > 0 ? process.argv[i + 1] : undefined;
      };
      const seat = opt('as');
      if (!seat) throw new Error('post needs --as <seat>, e.g. --as chess/search');
      const m = await postMessage({
        seat,
        body: args[0] ?? '',
        kind: opt('kind'),
        track: (opt('track') as GameId | undefined) ?? null,
        replyTo: opt('reply') ? Number(opt('reply')) : null,
      });
      console.log(`Posted #${m.id}.`);
      return;
    }
    case 'release':
      return release(args[0]);
    case 'brief':
      console.log(await brief());
      return;
    case 'plan': {
      const opened = await applyPlan(JSON.parse(readFileSync(fromCaller(args[0]), 'utf8')));
      console.log(`Posted the strategy call and opened ${opened} task(s).`);
      return;
    }
    case 'calibrate': {
      const game = args[0] as GameId;
      const ladder = await rungs(game);
      const pairs = flag('pairs', 10);
      for (let i = 1; i < ladder.length; i++) {
        const a = await reference(ladder[i].opponent, game, MOVE_MS, i);
        const b = await reference(ladder[i - 1].opponent, game, MOVE_MS, i + 100);
        const res = await playMatch(GAMES[game], a, b, pairs, { moveTimeMs: 60_000 });
        const est = performanceElo([{ opponentElo: ladder[i - 1].elo, score: res.score, games: pairs * 2 }]);
        log(`${ladder[i].label}: ${res.wins}-${res.losses}-${res.draws} vs ${ladder[i - 1].label} → ${Math.round(est.elo)} ± ${Math.round(est.error)} (configured ${ladder[i].elo})`);
        await a.close?.();
        await b.close?.();
      }
      log('Update shared/src/tracks.ts with measured values before `init` for the next run.');
      return;
    }
    case 'versus': {
      const game = args[0] as GameId;
      const build = await run('cargo', ['build', '--release', '-p', `${game}-engine`], { cwd: ENGINES_DIR });
      if (build.code !== 0) throw new Error('build failed');
      const mine = await arenaEngine('local', resolve(ENGINES_DIR, 'target/release', `${game}-engine`), game, MOVE_MS);
      const main = await currentVersion(game, 'main');
      const res = await playMatch(GAMES[game], mine, main, flag('pairs', 5), {
        moveTimeMs: MOVE_MS + 300,
        onGame: (g, i) => log(`game ${i + 1}: ${g.outcome} by ${g.termination} in ${g.moves.length} plies`),
      });
      log(`local vs main: +${res.wins} -${res.losses} =${res.draws}`);
      await mine.close?.();
      await main.close?.();
      return;
    }
    case 'wasm': {
      const t = (await tracks()).find((k) => k.id === args[0]);
      const ok = await buildWasm(args[0], { version: t?.current_version ?? 'local', elo: t?.current_elo ?? null });
      log(ok ? `built web/public/wasm/${args[0]}.wasm` : 'wasm build failed');
      return;
    }
    case 'play': {
      const [game, a, b] = args as [GameId, string, string];
      const pairs = flag('pairs', 5);
      const ma = await mover(a, game, 1);
      const mb = await mover(b, game, 2);
      const res = await playMatch(GAMES[game], ma, mb, pairs, {
        onGame: (g, i) => log(`game ${i + 1}: ${g.outcome} by ${g.termination} in ${g.moves.length} plies`),
      });
      log(`${a} vs ${b}: +${res.wins} -${res.losses} =${res.draws}`);
      await ma.close?.();
      await mb.close?.();
      return;
    }
    default:
      console.log(USAGE);
      if (cmd && cmd !== 'help') process.exitCode = 1;
  }
};

await main();
