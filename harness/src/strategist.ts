import { TRACKS, type GameId } from '@arena/shared';
import { bumpSessions, now, post, records, rungs, setAgent, tasks, tracks } from './board';
import { ARENA_ROOT, log, run, RUN_ID } from './config';
import { getStore } from './store';

const SCHEMA = {
  type: 'object',
  required: ['update', 'tasks'],
  properties: {
    update: {
      type: 'object',
      required: ['title', 'detail'],
      properties: { title: { type: 'string' }, detail: { type: 'string' } },
    },
    tasks: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        required: ['track', 'seat', 'title', 'spec'],
        properties: {
          track: { enum: TRACKS.map((t) => t.id) },
          seat: { type: 'string', description: 'e.g. chess/search, go/playout' },
          title: { type: 'string' },
          spec: { type: 'string' },
        },
      },
    },
  },
};

type Plan = {
  update: { title: string; detail: string };
  tasks: { track: GameId; seat: string; title: string; spec: string }[];
};

const briefing = async () => {
  const ts = await tracks();
  const all = await tasks();
  const recs = await records();
  const lines: string[] = [];
  for (const t of ts) {
    const ladder = await rungs(t.id);
    lines.push(
      `## ${t.name} (${t.id}) — ${t.current_version ?? 'no version'} at ${t.current_elo ?? 'unmeasured'} Elo; finish: ${t.finish_label}`,
      `Ladder: ${ladder.map((r) => `${r.label} ${r.elo}${r.cleared_at ? ' ✓' : ''}`).join(' → ')}`,
      `Open/claimed: ${all.filter((k) => k.track_id === t.id && ['open', 'claimed'].includes(k.status)).map((k) => k.title).join('; ') || 'none'}`,
      `Landed: ${all.filter((k) => k.track_id === t.id && k.status === 'landed').map((k) => k.title).join('; ') || 'none'}`,
      `Dead: ${recs.filter((r) => r.track_id === t.id && r.kind === 'idea_dead').map((r) => `${r.title} (${r.detail})`).join('; ') || 'none'}`,
    );
  }
  const strategy = recs.filter((r) => r.kind === 'strategy').slice(-3).map((r) => `- ${r.title}`).join('\n');
  return `${lines.join('\n')}\n\nRecent strategy updates:\n${strategy}`;
};

/**
 * One strategist session: read the board, post a strategy update, open the next tasks.
 * Uses --json-schema so the output is structured, never free-form chat.
 */
export const strategize = async () => {
  await setAgent('strategist', { status: 'working' });
  await bumpSessions('strategist');
  const prompt = `You are the strategist seat of Swarm Arena: agents build four game engines (Rust crates in engines/<game>) from zero.
Each task you open becomes one Claude Code session on one engine crate, then a gate match decides whether it lands.
Tasks must be small enough for one session (roughly one feature), concrete, and measurable by Elo. A crate with no move generator needs that first.
Never reopen a dead idea unchanged. Prefer the track furthest from its finish line when choosing where to spend sessions.
Open at most one new task per track that has no open or claimed task.

Board:
${await briefing()}

Return the strategy update (a one-line decision as title, one or two sentences of reasoning as detail) and the tasks to open.`;

  const res = await run(
    process.env.CLAUDE_BIN ?? 'claude',
    ['-p', prompt, '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA), '--allowedTools', 'Read', 'Glob', 'Grep'],
    { cwd: ARENA_ROOT, timeoutMs: 15 * 60_000 },
  );
  await setAgent('strategist', { status: 'idle' });
  if (res.code !== 0) throw new Error(`strategist session failed: ${res.stderr.slice(0, 200)}`);
  const envelope = JSON.parse(res.stdout);
  const plan: Plan =
    envelope.structured_output ?? JSON.parse(String(envelope.result).match(/\{[\s\S]*\}/)?.[0] ?? '{}');
  if (!plan?.update || !Array.isArray(plan.tasks)) throw new Error('strategist returned no plan');

  await post('strategy', { agent_id: 'strategist', title: plan.update.title, detail: plan.update.detail });
  const busy = new Set((await tasks()).filter((k) => ['open', 'claimed'].includes(k.status)).map((k) => k.track_id));
  for (const t of plan.tasks) {
    if (busy.has(t.track)) continue;
    busy.add(t.track);
    const id = `${RUN_ID}-${t.track}-${Date.now().toString(36)}`;
    await getStore().insert('tasks', {
      id,
      run_id: RUN_ID,
      track_id: t.track,
      title: t.title,
      spec: t.spec,
      status: 'open',
      claimed_by: null,
      created_at: now(),
      closed_at: null,
    });
    // The seat name travels with the task so the swarm knows who to wake.
    await post('task_opened', { track_id: t.track, agent_id: 'strategist', task_id: id, title: t.title, detail: t.spec, data: { seat: t.seat } });
    log(`task opened: [${t.track}] ${t.title} -> ${t.seat}`);
  }
};
