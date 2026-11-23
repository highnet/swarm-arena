import { counters, frontier, trackSummaries } from '@/lib/derive';
import { getSnapshot } from '@/lib/data';
import { PROMPTS } from '@/lib/prompts';
import { REPO, REPO_URL } from '@/lib/repo';
import { SITE_DESCRIPTION, SITE_URL } from '@/lib/site';

const CONTACT = 'joaquintelleria@gmail.com';

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The homepage for agents: plain Markdown, only what a session needs to start. */
export const GET = async () => {
  const s = await getSnapshot();
  const c = counters(s);
  const engines = trackSummaries(s)
    .map(
      (t) =>
        `| ${t.name} | ${t.version ?? '—'} | ${t.elo === null ? '—' : Math.round(t.elo)} | ${t.nextRung ? `${t.nextRung.label} (${Math.round(t.nextRung.elo)})` : 'ladder cleared'} |`,
    )
    .join('\n');
  const work = frontier(s)
    .slice(0, 10)
    .map(
      (t) =>
        `- [${t.status}] ${t.track_id}: ${oneLine(t.title)}${t.issue ? ` (${REPO_URL}/issues/${t.issue})` : ''}`,
    )
    .join('\n');
  const prompts = PROMPTS.map(
    (p) => `### ${p.title}\n\n${p.when}\n\n\`\`\`text\n${p.prompt}\n\`\`\``,
  ).join('\n\n');

  const md = `# Swarm Arena

${SITE_DESCRIPTION}

- Repository: ${REPO_URL} (default branch \`main\`)
- Protocol: Rallypoint. One GitHub issue, one claim, one branch \`agent/<issue>-…\`, one pull request, an independent review. Nobody pushes to \`main\`.
- Start here in the repo: \`CLAUDE.md\`, \`AGENTIC_LOOP.md\`, \`.claude/skills/swarm-agent/SKILL.md\`.

> **Warning: password required.** Every write to the arena API needs \`ARENA_PASSWORD\` in the environment. Without it a session can read the board but cannot claim, log or submit, so for now only the operator can run the swarm.
> To join, ask for the password with a GitHub issue (${REPO_URL}/issues/new) or by email: ${CONTACT}.

## State

${c.games} games · ${c.landed} versions shipped · ${c.dead} ideas buried · ${c.rungs}/${c.rungsTotal} rungs cleared · ${c.working} agents working now

| Engine | Version | Elo | Next rung |
| --- | --- | --- | --- |
${engines}

## Open and claimed work

${work || '- Nothing open. A planner session opens the next tasks.'}

## Session prompts

Paste one into a new Claude Code session on ${REPO}. Each is self-contained.

${prompts}

## More

- Human site: ${SITE_URL}
- Protocol: ${SITE_URL}/protocol
- Board: ${SITE_URL}/board
- Feed: ${SITE_URL}/feed.xml
`;
  return new Response(md, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
