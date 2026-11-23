#!/usr/bin/env tsx
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { performanceElo, playMatch, GAMES, type GameId, type Task } from '@arena/shared';
import { agent, ensureRun, records, rungs, setAgent, tasks, tracks } from './board';
import { ARENA_HOME, log, MOVE_MS, RUN_ID } from './config';
import { arenaEngine } from './engine';
import { reference } from './references';
import { runTask } from './seat';
import { getStore } from './store';
import { strategize } from './strategist';

const USAGE = `arena <command>

  init [label]                  create the run, tracks and ladders (ARENA_RUN, default run-001)
  status                        print tracks, open tasks and the last records
  strategist                    one strategist session: strategy update + new tasks
  seat <task-id>                run one task end to end (session, build, gate, land or bury)
  swarm [--parallel N] [--hours H]
                                loop: strategist when idle, one seat per track, up to N at once
  calibrate <track> [--pairs N] measure each rung against the one below and print Elo
  play <track> <a> <b> [--pairs N]
                                play references or engine binaries against each other

Store: Supabase when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set, else ${ARENA_HOME}/store.json.`;

const flag = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};

const seatFor = async (task: Task) => {
  const opened = (await records()).find((r) => r.task_id === task.id && r.kind === 'task_opened');
  const seat = String((opened?.data as { seat?: string })?.seat ?? `${task.track_id}/builder`);
  return { seat, id: await agent(seat, task.track_id, 'builder') };
};

const mover = async (spec: string, game: GameId, seed: number) =>
  existsSync(spec) ? arenaEngine(spec, resolve(spec), game, MOVE_MS) : reference(spec, game, MOVE_MS, seed);

const main = async () => {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'init': {
      const created = await ensureRun(args[0] ?? `Run ${RUN_ID}`);
      log(created ? `created ${RUN_ID} in ${getStore().kind}` : `${RUN_ID} already exists`);
      return;
    }
    case 'status': {
      for (const t of await tracks()) log(`${t.name.padEnd(10)} ${t.current_version ?? '—'} ${t.current_elo ?? '—'}`);
      for (const t of (await tasks()).filter((k) => ['open', 'claimed'].includes(k.status))) log(`task ${t.status} [${t.track_id}] ${t.title} (${t.id})`);
      for (const r of (await records()).slice(-10)) log(`${r.kind.padEnd(14)} ${r.title}`);
      return;
    }
    case 'strategist':
      return strategize();
    case 'seat': {
      const task = (await tasks()).find((t) => t.id === args[0]);
      if (!task) throw new Error(`no task ${args[0]}`);
      const { seat, id } = await seatFor(task);
      return runTask(task, id, seat);
    }
    case 'swarm': {
      const parallel = flag('parallel', 2);
      const deadline = Date.now() + flag('hours', 24) * 3600_000;
      const active = new Map<GameId, Promise<void>>();
      log(`swarm: up to ${parallel} seats until ${new Date(deadline).toISOString()}`);
      while (Date.now() < deadline) {
        const open = (await tasks()).filter((t) => t.status === 'open' && !active.has(t.track_id));
        if (!open.length && active.size < parallel) {
          await strategize().catch((e) => log(`strategist: ${e}`));
        }
        for (const task of (await tasks()).filter((t) => t.status === 'open')) {
          if (active.size >= parallel || active.has(task.track_id)) continue;
          const { seat, id } = await seatFor(task);
          const p = runTask(task, id, seat)
            .catch((e) => log(`seat ${seat}: ${e}`))
            .finally(() => active.delete(task.track_id));
          active.set(task.track_id, p);
        }
        await setAgent('referee', { status: active.size ? 'working' : 'idle' });
        await new Promise((r) => setTimeout(r, 30_000));
      }
      await Promise.all(active.values());
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
