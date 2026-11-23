import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { GAMES, randomPlayer, type Task } from '@arena/shared';
import { bumpSessions, now, post, records, rungs, setAgent, track } from './board';
import { ARENA_HOME, ARENA_ROOT, GATE_PAIRS, log, MOVE_MS, run, RUN_ID } from './config';
import { arenaEngine } from './engine';
import { gateRung, runMatch } from './match';
import { reference } from './references';
import { getStore } from './store';

const gitRoot = async () => (await run('git', ['rev-parse', '--show-toplevel'], { cwd: ARENA_ROOT })).stdout.trim();

const crate = (t: Task) => `${t.track_id}-engine`;

const sessionPrompt = async (task: Task, seat: string) => {
  const t = await track(task.track_id);
  const ladder = await rungs(task.track_id);
  const recent = (await records())
    .filter((r) => r.track_id === task.track_id && ['match_verdict', 'patch_landed', 'idea_dead'].includes(r.kind))
    .slice(-12)
    .map((r) => `- [${r.kind}] ${r.title}${r.detail ? `: ${r.detail}` : ''}`)
    .join('\n');
  const protocol = readFileSync(resolve(ARENA_ROOT, 'engines/PROTOCOL.md'), 'utf8');
  return `You are seat "${seat}" in Swarm Arena, a swarm building game engines from zero.
You are working on the ${GAMES[task.track_id].name} engine: the Rust crate in this directory (${crate(task)}).

TASK: ${task.title}
SPEC: ${task.spec}

Current version: ${t.current_version ?? 'none yet'} at ${t.current_elo === null ? 'no measured' : Math.round(t.current_elo)} Elo.
Ladder: ${ladder.map((r) => `${r.label} (${r.elo})${r.cleared_at ? ' cleared' : ''}`).join(', ')}.
Recent results on this track:
${recent || '- none yet'}

Rules:
- Use the rules library already in Cargo.toml (or another rules/data-structure crate) for move generation and game state.
- Write search, evaluation and time management yourself. No engine crates, ported engine source, downloaded weights or opening books.
- Keep the protocol below working. The referee forfeits illegal moves, crashes and timeouts.
- Stay inside this crate. Run \`cargo build --release\` and \`cargo test\` until both pass.
- When you are done, reply with one sentence describing the change. Do not commit; the harness commits.

${protocol}`;
};

/**
 * Run one task end to end: a Claude Code session in an isolated worktree, the build gate,
 * a legality smoke test, the gate match, and then land or bury the idea.
 */
export const runTask = async (task: Task, seatId: string, seat: string) => {
  const db = getStore();
  const claimed = await db.claim('tasks', { id: task.id, status: 'open' }, { status: 'claimed', claimed_by: seatId });
  if (!claimed) return;
  await post('task_claimed', { track_id: task.track_id, agent_id: seatId, task_id: task.id, title: `${seat} claimed “${task.title}”` });
  await setAgent(seatId, { status: 'working' });

  const root = await gitRoot();
  const sub = relative(root, ARENA_ROOT);
  const branch = `arena/${task.id}`;
  const wt = resolve(ARENA_HOME, 'worktrees', task.id);
  const crateDir = resolve(wt, sub, 'engines', task.track_id);
  const bury = async (why: string, matchId: string | null = null) => {
    await db.update('tasks', { id: task.id }, { status: 'dead', closed_at: now() });
    await post('patch_rejected', { track_id: task.track_id, agent_id: 'referee', task_id: task.id, match_id: matchId, title: `Rejected: ${task.title}`, detail: why });
    await post('idea_dead', { track_id: task.track_id, agent_id: 'strategist', task_id: task.id, title: task.title, detail: why });
    log(`dead: ${task.title} (${why})`);
  };

  try {
    await run('git', ['worktree', 'add', '-B', branch, wt, 'HEAD'], { cwd: root });

    // 1. The Claude Code session. Its transcript stays local; the board only learns the outcome.
    log(`${seat}: session for "${task.title}"`);
    await bumpSessions(seatId);
    const session = await run(
      process.env.CLAUDE_BIN ?? 'claude',
      [
        '-p',
        await sessionPrompt(task, seat),
        '--permission-mode',
        'acceptEdits',
        '--allowedTools',
        'Bash(cargo:*)',
        'Read',
        'Edit',
        'Write',
        'Glob',
        'Grep',
        '--output-format',
        'json',
      ],
      { cwd: crateDir, timeoutMs: Number(process.env.ARENA_SESSION_MS ?? 45 * 60_000) },
    );
    if (session.code !== 0) return bury(`Session failed (exit ${session.code}).`);

    // 2. Build gate.
    const build = await run('cargo', ['build', '--release', '-p', crate(task)], { cwd: resolve(wt, sub, 'engines') });
    if (build.code !== 0) return bury('Build failed.');
    const test = await run('cargo', ['test', '--release', '-p', crate(task)], { cwd: resolve(wt, sub, 'engines') });
    if (test.code !== 0) return bury('Tests failed.');
    const built = resolve(wt, sub, 'engines/target/release', crate(task));
    const bin = resolve(ARENA_HOME, 'bin', `${task.id}`);
    mkdirSync(resolve(ARENA_HOME, 'bin'), { recursive: true });
    copyFileSync(built, bin);

    // 3. Legality smoke test: two pairs against the random mover, no forfeits allowed.
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
      return bury(`Forfeited ${smoke.forfeits.length} of 4 smoke games: ${smoke.forfeits[0]}.`, smoke.matchId);
    }

    // 4. Gate match against the next uncleared rung.
    const t = await track(task.track_id);
    const ladder = await rungs(task.track_id);
    const rung = gateRung(ladder, t.current_elo);
    const landedCount = (await db.select<Task>('tasks', { run_id: RUN_ID, track_id: task.track_id, status: 'landed' })).length;
    const version = `v0.${landedCount + 1}`;
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
    if (gate.forfeits.length) return bury(`Forfeited ${gate.forfeits.length} gate games.`, gate.matchId);
    if (prev !== null && gate.est.elo <= prev) {
      return bury(`Measured ${Math.round(gate.est.elo)} ± ${Math.round(gate.est.error)}, not above ${Math.round(prev)}.`, gate.matchId);
    }

    // 5. Land: commit in the worktree, merge into the main checkout, record.
    await run('git', ['add', '-A', resolve(wt, sub, 'engines', task.track_id)], { cwd: wt });
    await run('git', ['commit', '-m', `${task.track_id} ${version}: ${task.title}`], { cwd: wt });
    const merge = await run('git', ['merge', '--no-ff', '-m', `arena: land ${task.track_id} ${version}`, branch], { cwd: root });
    if (merge.code !== 0) {
      await run('git', ['merge', '--abort'], { cwd: root });
      return bury('Measured better, but the patch no longer merges cleanly.', gate.matchId);
    }
    copyFileSync(bin, resolve(ARENA_HOME, 'bin', `${task.track_id}-current`));
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
    const delta = prev === null ? 'first measured version' : `${gate.est.elo - prev >= 0 ? '+' : ''}${Math.round(gate.est.elo - prev)} Elo over the previous version`;
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
    log(`landed ${task.track_id} ${version} at ${Math.round(gate.est.elo)}`);
  } catch (e) {
    await bury(`Harness error: ${String(e).slice(0, 160)}`);
  } finally {
    await setAgent(seatId, { status: 'idle' });
    if (existsSync(wt)) await run('git', ['worktree', 'remove', '--force', wt], { cwd: root });
  }
};
