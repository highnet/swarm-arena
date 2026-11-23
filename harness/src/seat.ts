import { copyFileSync, mkdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { GAMES, randomPlayer, type Task } from '@arena/shared';
import { agent, bumpSessions, now, post, records, rungs, setAgent, tasks, track } from './board';
import { ARENA_HOME, ARENA_ROOT, ENGINES_DIR, GATE_PAIRS, log, MOVE_MS, run, RUN_ID } from './config';
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
    await db.update('tasks', { id: task.id }, { status: 'dead', closed_at: now() });
    await post('patch_rejected', { track_id: task.track_id, agent_id: 'referee', task_id: task.id, match_id: matchId, title: `Rejected: ${task.title}`, detail: why });
    await post('idea_dead', { track_id: task.track_id, agent_id: 'strategist', task_id: task.id, title: task.title, detail: why });
    log(`buried: ${task.title} (${why})`);
    return { shipped: false as const, why };
  };

  try {
    await setAgent(seatId, { status: 'working' });
    const build = await run('cargo', ['build', '--release', '-p', crate(task.track_id)], { cwd: ENGINES_DIR });
    if (build.code !== 0) return await bury('Build failed.');
    const test = await run('cargo', ['test', '--release', '-p', crate(task.track_id)], { cwd: ENGINES_DIR });
    if (test.code !== 0) return await bury('Tests failed.');
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
    const opponent = await reference(rung.opponent, task.track_id, MOVE_MS, Date.now() % 1e9);
    const gate = await runMatch({
      track: task.track_id,
      candidate,
      candidateVersion: version,
      opponent,
      opponentLabel: rung.label,
      opponentElo: rung.elo,
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

    // Ship: commit the crate, rebase onto the latest main, push. Retry on a race.
    await git(['add', '-A', relative(ARENA_ROOT, crateDir), relative(ARENA_ROOT, resolve(ENGINES_DIR, 'Cargo.lock'))]);
    await git(['commit', '-m', `${task.track_id} ${version}: ${task.title}`]);
    let pushed = false;
    for (let attempt = 0; attempt < 3 && !pushed; attempt++) {
      await git(['fetch', 'origin', 'main']);
      const rebase = await git(['rebase', '--autostash', 'origin/main']);
      if (rebase.code !== 0) {
        await git(['rebase', '--abort']);
        return await bury('Rated higher, but the change no longer applies on main.', gate.matchId);
      }
      pushed = (await git(['push', 'origin', 'HEAD:main'])).code === 0;
    }
    if (!pushed) return await bury('Rated higher, but pushing to main failed.', gate.matchId);

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
    const delta = prev === null ? 'First rated version' : `${gate.est.elo - prev >= 0 ? '+' : ''}${Math.round(gate.est.elo - prev)} over the previous version`;
    await post('patch_landed', { track_id: task.track_id, agent_id: seatId, task_id: task.id, match_id: gate.matchId, title: `${version} shipped: ${task.title}`, detail: `${delta}.` });
    for (const r of ladder) {
      if (!r.cleared_at && gate.est.elo - gate.est.error / 2 > r.elo) {
        await db.update('rungs', { id: r.id }, { cleared_at: now(), cleared_by_match: gate.matchId });
        await post('rung_cleared', {
          track_id: task.track_id,
          agent_id: 'referee',
          match_id: gate.matchId,
          title: `${t.name} cleared ${r.label} (${r.elo})`,
          detail: r.label === t.finish_label ? 'Finish line reached.' : null,
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
