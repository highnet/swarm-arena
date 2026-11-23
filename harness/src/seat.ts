import { cpus, totalmem } from 'node:os';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { outsideHelp } from './rules';
import { buildWasm, wasmPaths } from './wasm';
import { relative, resolve } from 'node:path';
import { GAMES, randomPlayer, type Task } from '@arena/shared';
import { agent, bumpSessions, now, post, records, rungs, setAgent, tasks, track } from './board';
import { ARENA_HOME, ARENA_ROOT, ENGINES_DIR, GATE_PAIRS, log, MOVE_MS, MOVE_SLACK_MS, run, RUN_ID } from './config';
import { arenaEngine } from './engine';
import { gateRung, runMatch } from './match';
import { reference } from './references';
import { getStore } from './store';

/**
 * Agent sessions run as Claude Code cloud sessions on this repository. A session calls
 * `arena next` to claim a task, improves the engine crate itself, then `arena submit <task>`
 * hands the result to the referee. The harness never launches a model.
 */

const crate = (trackId: string) => `${trackId}-engine`;

const seatOf = async (task: Task) => {
  const opened = (await records()).find((r) => r.task_id === task.id && r.kind === 'task_opened');
  return String((opened?.data as { seat?: string })?.seat ?? `${task.track_id}/builder`);
};

const briefing = async (task: Task, seat: string) => {
  const t = await track(task.track_id);
  const ladder = await rungs(task.track_id);
  const recent = (await records())
    .filter((r) => r.track_id === task.track_id && ['match_verdict', 'patch_landed', 'idea_dead'].includes(r.kind))
    .slice(-12)
    .map((r) => `- [${r.kind}] ${r.title}${r.detail ? `: ${r.detail}` : ''}`)
    .join('\n');
  return `TASK ${task.id}
Seat: ${seat}
Engine: ${GAMES[task.track_id].name}, crate ${relative(ARENA_ROOT, resolve(ENGINES_DIR, task.track_id))}
Title: ${task.title}
Spec: ${task.spec}

Current version: ${t.current_version ?? 'none yet'} at ${t.current_elo === null ? 'no rating' : Math.round(t.current_elo)}.
Hardware: ${cpus().length} cores here, ${Math.round(totalmem() / 2 ** 30)} GB RAM, but the engine gets ONE thread and must also run in a browser.
Time: answer \`go <ms>\` within <ms> (gate matches use ${MOVE_MS} ms, players on the site choose 0.5–3 s); later than <ms> + ${MOVE_SLACK_MS} ms forfeits.
Ladder: ${ladder.map((r) => `${r.label} (${r.elo})${r.cleared_at ? ' cleared' : ''}`).join(', ')}.
Recent results:
${recent || '- none yet'}

When cargo build --release and cargo test pass in the crate, run:
  npm run arena -- submit ${task.id}
If you cannot finish, run:
  npm run arena -- release ${task.id}`;
};

/** Claim the oldest open task on a track nobody else is working on. Returns the briefing. */
export const claimNext = async (onlyTrack?: string) => {
  const db = getStore();
  const all = await tasks();
  const busy = new Set(all.filter((t) => t.status === 'claimed').map((t) => t.track_id));
  const open = all
    .filter((t) => t.status === 'open' && !busy.has(t.track_id) && (!onlyTrack || t.track_id === onlyTrack))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  for (const task of open) {
    const seat = await seatOf(task);
    const seatId = await agent(seat, task.track_id, 'builder');
    const claimed = await db.claim('tasks', { id: task.id, status: 'open' }, { status: 'claimed', claimed_by: seatId });
    if (!claimed) continue;
    await bumpSessions(seatId);
    await setAgent(seatId, { status: 'working' });
    await post('task_claimed', { track_id: task.track_id, agent_id: seatId, task_id: task.id, title: `${seat} claimed “${task.title}”` });
    return briefing(task, seat);
  }
  return null;
};

/** Put a claimed task back on the board (the session could not finish it). */
export const release = async (taskId: string) => {
  const db = getStore();
  const [task] = await db.select<Task>('tasks', { id: taskId });
  if (!task || task.status !== 'claimed') throw new Error(`task ${taskId} is not claimed`);
  await db.update('tasks', { id: taskId }, { status: 'open', claimed_by: null });
  if (task.claimed_by) await setAgent(task.claimed_by, { status: 'idle' });
  log(`released ${taskId}`);
};

const git = (args: string[]) => run('git', args, { cwd: ARENA_ROOT });

const playbook = (trackId: string) => resolve(ARENA_ROOT, '.claude/skills', `${trackId}-playbook`, 'SKILL.md');

/** The referee's one-line verdict at the end of the engine's playbook. */
const logVerdict = (trackId: string, line: string) => {
  const p = playbook(trackId);
  if (existsSync(p)) appendFileSync(p, `- ${now().slice(0, 16).replace('T', ' ')} UTC · ${line}\n`);
};

/** Take back the last verdict line (a ship that could not be pushed). */
const unlogVerdict = (trackId: string) => {
  const p = playbook(trackId);
  if (!existsSync(p)) return;
  const lines = readFileSync(p, 'utf8').trimEnd().split('\n');
  if (lines.at(-1)?.startsWith('- ')) writeFileSync(p, `${lines.slice(0, -1).join('\n')}\n`);
};

/** Commit the given paths, rebase onto the latest main and push. Retries on a race. */
const commitAndPush = async (paths: string[], message: string) => {
  await git(['add', '-A', ...paths.map((p) => relative(ARENA_ROOT, p))]);
  const commit = await git(['commit', '-m', message]);
  if (commit.code !== 0) return true; // nothing to commit
  for (let attempt = 0; attempt < 3; attempt++) {
    await git(['fetch', 'origin', 'main']);
    const rebase = await git(['rebase', '--autostash', 'origin/main']);
    if (rebase.code !== 0) {
      await git(['rebase', '--abort']);
      return false;
    }
    if ((await git(['push', 'origin', 'HEAD:main'])).code === 0) return true;
  }
  return false;
};

/** Build the engine as it is on origin/main, in a separate worktree, and start it. */
const currentVersion = async (trackId: Task['track_id'], label: string) => {
  const dir = resolve(ARENA_HOME, 'main-build');
  await git(['fetch', 'origin', 'main']);
  await git(['worktree', 'remove', '--force', dir]);
  const add = await git(['worktree', 'add', '--detach', dir, 'origin/main']);
  if (add.code !== 0) throw new Error(`could not check out main: ${add.stderr.slice(0, 120)}`);
  const target = resolve(ARENA_HOME, 'main-target');
  const build = await run('cargo', ['build', '--release', '-p', crate(trackId), '--target-dir', target], {
    cwd: resolve(dir, relative(ARENA_ROOT, ENGINES_DIR)),
  });
  if (build.code !== 0) throw new Error('could not build the current version from main');
  const bin = resolve(ARENA_HOME, 'bin', `${trackId}-main`);
  mkdirSync(resolve(ARENA_HOME, 'bin'), { recursive: true });
  copyFileSync(resolve(target, 'release', crate(trackId)), bin);
  await git(['worktree', 'remove', '--force', dir]);
  return arenaEngine(label, bin, trackId, MOVE_MS);
};

/**
 * Referee a finished task: build gate, legality smoke test, gate match against the next
 * uncleared rung, then ship to main (rebase + push) or bury with the measured reason.
 */
export const submit = async (taskId: string) => {
  const db = getStore();
  const [task] = await db.select<Task>('tasks', { id: taskId, run_id: RUN_ID });
  if (!task || task.status !== 'claimed') throw new Error(`task ${taskId} is not claimed`);
  const seatId = task.claimed_by ?? 'referee';
  const crateDir = resolve(ENGINES_DIR, task.track_id);

  const bury = async (why: string, matchId: string | null = null) => {
    // The engine change is discarded; the playbook keeps the lesson.
    await git(['checkout', '--', relative(ARENA_ROOT, crateDir)]);
    await git(['clean', '-fdq', '--', relative(ARENA_ROOT, crateDir)]);
    logVerdict(task.track_id, `buried · ${task.title} · ${why}`);
    await commitAndPush([playbook(task.track_id)], `docs(${task.track_id}): playbook lesson from “${task.title}”\n\nBuried: ${why}`);
    await db.update('tasks', { id: task.id }, { status: 'dead', closed_at: now() });
    await post('patch_rejected', { track_id: task.track_id, agent_id: 'referee', task_id: task.id, match_id: matchId, title: `Rejected: ${task.title}`, detail: why });
    await post('idea_dead', { track_id: task.track_id, agent_id: 'strategist', task_id: task.id, title: task.title, detail: why });
    log(`buried: ${task.title} (${why})`);
    return { shipped: false as const, why };
  };

  try {
    await setAgent(seatId, { status: 'working' });
    const breach = outsideHelp(crateDir);
    if (breach) return await bury(`Engines think alone: ${breach}`);
    const build = await run('cargo', ['build', '--release', '-p', crate(task.track_id)], { cwd: ENGINES_DIR });
    if (build.code !== 0) return await bury('Build failed.');
    const test = await run('cargo', ['test', '--release', '-p', crate(task.track_id)], { cwd: ENGINES_DIR });
    if (test.code !== 0) return await bury('Tests failed.');
    // The browser build is the sandbox: no sockets, no processes, one thread. It must compile.
    const t0 = await track(task.track_id);
    const wasmOk = await buildWasm(task.track_id, { version: 'candidate', elo: t0.current_elo });
    if (!wasmOk) {
      return await bury('The browser build (wasm32-wasip1) failed: engines must run sandboxed, single-threaded, with no network or processes.');
    }
    const bin = resolve(ARENA_HOME, 'bin', task.id);
    mkdirSync(resolve(ARENA_HOME, 'bin'), { recursive: true });
    copyFileSync(resolve(ENGINES_DIR, 'target/release', crate(task.track_id)), bin);

    const candidate = await arenaEngine(task.id, bin, task.track_id, MOVE_MS);
    const smoke = await runMatch({
      track: task.track_id,
      candidate,
      candidateVersion: 'candidate',
      opponent: randomPlayer(1),
      opponentLabel: 'Random mover',
      opponentElo: 0,
      pairs: 2,
      purpose: 'calibration',
      taskId: task.id,
    });
    if (smoke.forfeits.length) {
      await candidate.close?.();
      return await bury(`Forfeited ${smoke.forfeits.length} of 4 smoke games: ${smoke.forfeits[0]}.`, smoke.matchId);
    }

    const t = await track(task.track_id);
    const ladder = await rungs(task.track_id);
    const rung = gateRung(ladder, t.current_elo);
    const shipped = (await db.select<Task>('tasks', { run_id: RUN_ID, track_id: task.track_id, status: 'landed' })).length;
    const version = `v0.${shipped + 1}`;
    // Past the top of the ladder there is no finish line: play the current version instead.
    const opponent = rung
      ? await reference(rung.opponent, task.track_id, MOVE_MS, Date.now() % 1e9)
      : await currentVersion(task.track_id, t.current_version ?? 'current');
    const gate = await runMatch({
      track: task.track_id,
      candidate,
      candidateVersion: version,
      opponent,
      opponentLabel: rung ? rung.label : `${t.name} ${t.current_version}`,
      opponentElo: rung ? rung.elo : (t.current_elo ?? 0),
      pairs: GATE_PAIRS,
      purpose: 'gate',
      taskId: task.id,
    });
    await candidate.close?.();
    await opponent.close?.();

    const prev = t.current_elo;
    if (gate.forfeits.length) return await bury(`Forfeited ${gate.forfeits.length} gate games.`, gate.matchId);
    if (prev !== null && gate.est.elo <= prev) {
      return await bury(`Rated ${Math.round(gate.est.elo)} ± ${Math.round(gate.est.error)}, not above ${Math.round(prev)}.`, gate.matchId);
    }

    // Ship: the crate and its playbook go to main together.
    const delta = prev === null ? 'first rated version' : `${gate.est.elo - prev >= 0 ? '+' : ''}${Math.round(gate.est.elo - prev)}`;
    logVerdict(task.track_id, `${version} shipped · ${task.title} · rated ${Math.round(gate.est.elo)} (${delta})`);
    // The browser build: visitors play the version that just shipped.
    const wasm = await buildWasm(task.track_id, { version, elo: Math.round(gate.est.elo) });
    const pushed = await commitAndPush(
      [crateDir, resolve(ENGINES_DIR, 'Cargo.lock'), playbook(task.track_id), ...(wasm ? wasmPaths(task.track_id) : [])],
      `feat(${task.track_id}): ${task.title}\n\nArena ${version}, rated ${Math.round(gate.est.elo)} (${delta}).`,
    );
    if (!pushed) {
      // Undo the local ship commit so the burial pushes only the playbook lesson.
      await git(['reset', '--mixed', 'HEAD~1']);
      unlogVerdict(task.track_id);
      return await bury('Rated higher, but the change no longer applies on main.', gate.matchId);
    }

    await db.update('tasks', { id: task.id }, { status: 'landed', closed_at: now() });
    await db.update('tracks', { run_id: RUN_ID, id: task.track_id }, { current_elo: Math.round(gate.est.elo), current_version: version });
    await db.insert('elo_points', {
      run_id: RUN_ID,
      track_id: task.track_id,
      at: now(),
      engine_version: version,
      elo: Math.round(gate.est.elo),
      elo_error: Math.round(gate.est.error),
      match_id: gate.matchId,
    });
    await post('patch_landed', {
      track_id: task.track_id,
      agent_id: seatId,
      task_id: task.id,
      match_id: gate.matchId,
      title: `${version} shipped: ${task.title}`,
      detail: prev === null ? 'First rated version.' : `${delta} over the previous version.`,
    });
    for (const r of ladder) {
      if (!r.cleared_at && gate.est.elo - gate.est.error / 2 > r.elo) {
        await db.update('rungs', { id: r.id }, { cleared_at: now(), cleared_by_match: gate.matchId });
        await post('rung_cleared', {
          track_id: task.track_id,
          agent_id: 'referee',
          match_id: gate.matchId,
          title: `${t.name} cleared ${r.label} (${r.elo})`,
        });
      }
    }
    log(`shipped ${task.track_id} ${version} at ${Math.round(gate.est.elo)}`);
    return { shipped: true as const, version, elo: Math.round(gate.est.elo) };
  } catch (e) {
    return await bury(`Referee error: ${String(e).slice(0, 160)}`);
  } finally {
    await setAgent(seatId, { status: 'idle' });
  }
};
