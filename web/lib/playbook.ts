import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cacheLife } from 'next/cache';
import MarkdownIt from 'markdown-it';
import type { GameId } from '@arena/shared';

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

/** The repo root: the site builds from web/, the skills live beside it. */
const skillPath = (id: GameId) =>
  resolve(process.cwd(), '..', '.claude', 'skills', `${id}-playbook`, 'SKILL.md');

export type Playbook = {
  html: string;
  /** Lines of the referee's results log, newest first. */
  log: string[];
};

/** The game's playbook skill as the swarm last left it on main. */
export const getPlaybook = async (id: GameId): Promise<Playbook | null> => {
  'use cache';
  cacheLife('hours');
  const raw = await readFile(skillPath(id), 'utf8').catch(() => null);
  if (!raw) return null;
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '');
  const [main, logPart = ''] = body.split(/^## Results log\s*$/m);
  const log = logPart
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2))
    .reverse();
  // The page title is already the engine's name; drop the playbook's own H1.
  return { html: md.render(main.replace(/^# .*\n/m, '')), log };
};
