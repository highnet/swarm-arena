import {
  Bot,
  Boxes,
  Compass,
  Layers,
  RefreshCcw,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { REPO } from './repo';

/** Ready-to-paste session prompts, shown on /protocol and in /agent.md. */
export const REPO_LINE = `Repository: github.com/${REPO} (default branch main).`;

export const PROMPTS: { title: string; when: string; icon: LucideIcon; prompt: string }[] = [
  {
    title: 'Run one swarm agent',
    when: 'The default. The session picks its own role from the state of the repository.',
    icon: Bot,
    prompt: `${REPO_LINE}
Run a swarm agent. Follow .claude/skills/swarm-agent/SKILL.md exactly: \`npm run arena -- prepare\`, take your Rallypoint role with \`npm run arena -- next\`, do that one role, log progress as you go, and leave a retro with \`npm run arena -- retro\` before you end.`,
  },
  {
    title: 'Work one engine',
    when: 'Point a worker at a specific game. Replace chess with go9, othello or hex.',
    icon: Boxes,
    prompt: `${REPO_LINE}
Run a swarm agent on the chess engine. Follow .claude/skills/swarm-agent/SKILL.md, but take your role with \`npm run arena -- next chess\`. Load the chess playbook and the concepts skill before you change anything, log progress, submit through the referee, leave a hand-off and a retro.`,
  },
  {
    title: 'Clear the review queue',
    when: 'Pull requests are piling up. Finishing work beats starting it.',
    icon: ShieldCheck,
    prompt: `${REPO_LINE}
Clear the Rallypoint queue. Repeat \`npm run arena -- next --only merger,reviewer\` and do each role it gives you, one at a time, following .claude/skills/swarm-agent/SKILL.md and the matching .rallypoint/roles/<role>.md. Never review or merge work this session wrote. Stop when it prints ROLE none. Leave one retro at the end.`,
  },
  {
    title: 'Plan the next experiments',
    when: 'The backlog is empty, or the strategy needs a fresh look.',
    icon: Compass,
    prompt: `${REPO_LINE}
Run the swarm strategist. Follow .claude/skills/swarm-strategist/SKILL.md: read \`npm run arena -- brief\`, the playbooks and .claude/skills/concepts/SKILL.md, then open the next tasks with \`npm run arena -- plan plan.json\`. Give every task a type and a concept, and prefer porting a concept that already gained Elo in one game to the engines that have not tried it.`,
  },
  {
    title: 'Port a concept across games',
    when: 'Something worked in one engine. Test it in the other three.',
    icon: Layers,
    prompt: `${REPO_LINE}
Run the swarm strategist with one goal: find the concept in .claude/skills/concepts/SKILL.md with the best evidence so far, and open one task per engine that has not tried it (concept set, type chosen, spec saying what should differ for that game). Then run \`npm run arena -- next\` once and do the role it gives you.`,
  },
  {
    title: 'Improve the protocol',
    when: 'Retros point at friction, or the metrics stall.',
    icon: RefreshCcw,
    prompt: `${REPO_LINE}
Act as the Rallypoint improver for the swarm. Follow .claude/skills/swarm-steward/SKILL.md: read the retros and \`npm run arena -- metrics\`, pick one change the evidence supports inside the allowed paths, open an issue labelled loop:improvement, and deliver it as one pull request for an independent review. Leave a retro.`,
  },
  {
    title: 'Tidy coordination state',
    when: 'Claims or leases look stuck, or the fleet shows seats not heard from.',
    icon: Wrench,
    prompt: `${REPO_LINE}
Act as the Rallypoint janitor. Read .rallypoint/roles/janitor.md, run \`node .rallypoint/scripts/report.mjs\`, and repair only what the report proves is stale (old claims, orphaned leases, released arena tasks still marked claimed on the board). Change nothing else. Leave a retro.`,
  },
];
