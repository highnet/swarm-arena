import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { cacheLife } from 'next/cache';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';
import ini from 'highlight.js/lib/languages/ini';
import markdown from 'highlight.js/lib/languages/markdown';
import rust from 'highlight.js/lib/languages/rust';
import type { GameId } from '@arena/shared';

/** The repository root: the site builds from web/, everything else lives beside it. */
const REPO = resolve(process.cwd(), '..');

export type SourceFile = {
  path: string;
  lines: number;
  html: string;
};

const LANG: Record<string, string> = { rs: 'rust', toml: 'toml', md: 'markdown' };

const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    if (e.name === 'target' || e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
};

hljs.registerLanguage('rust', rust);
hljs.registerLanguage('toml', ini);
hljs.registerLanguage('markdown', markdown);

/**
 * highlight.js returns one HTML string whose spans can cross line breaks (block comments,
 * strings). Split it into one element per line, closing and reopening spans at each break,
 * so the page can number lines in CSS.
 */
const splitLines = (html: string) => {
  const open: string[] = [];
  const lines: string[] = [];
  let current = '';
  const tag = /<\/?span[^>]*>|\n|[^<\n]+/g;
  for (const m of html.matchAll(tag)) {
    const t = m[0];
    if (t === '\n') {
      lines.push(current + '</span>'.repeat(open.length));
      current = open.join('');
    } else if (t.startsWith('</span')) {
      open.pop();
      current += t;
    } else if (t.startsWith('<span')) {
      open.push(t);
      current += t;
    } else {
      current += t;
    }
  }
  lines.push(current + '</span>'.repeat(open.length));
  return lines;
};

const highlight = (code: string, lang: string) => {
  const html = hljs.getLanguage(lang)
    ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    : code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = splitLines(html).map((l) => `<span class="line">${l}</span>`);
  return `<pre class="hljs"><code>${lines.join('\n')}</code></pre>`;
};

/** The engine crate as it is on main: Cargo.toml first, then sources in path order. */
export const getEngineSource = async (id: GameId): Promise<SourceFile[]> => {
  'use cache';
  cacheLife('hours');
  const crate = join(REPO, 'engines', id);
  const files = (await walk(crate))
    .filter((f) => /\.(rs|toml|md)$/.test(f))
    .sort((a, b) =>
      a.endsWith('Cargo.toml') ? -1 : b.endsWith('Cargo.toml') ? 1 : a.localeCompare(b),
    );
  const out: SourceFile[] = [];
  for (const f of files) {
    if ((await stat(f)).size > 400_000) continue;
    const code = await readFile(f, 'utf8');
    const ext = f.split('.').pop() ?? '';
    out.push({
      path: relative(REPO, f),
      lines: code.split('\n').length,
      html: highlight(code.replace(/\n$/, ''), LANG[ext] ?? 'text'),
    });
  }
  return out;
};

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

export type Skill = {
  name: string;
  description: string;
  path: string;
  html: string;
};

/** Every agent skill in the repository: the swarm's own roles and each game's playbook. */
export const getSkills = async (): Promise<Skill[]> => {
  'use cache';
  cacheLife('hours');
  const dir = join(REPO, '.claude', 'skills');
  const names = (await readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const skills: Skill[] = [];
  for (const name of names) {
    const raw = await readFile(join(dir, name, 'SKILL.md'), 'utf8').catch(() => null);
    if (!raw) continue;
    const front = raw.match(/^---\n([\s\S]*?)\n---\n/);
    const description = front?.[1].match(/^description:\s*(.*)$/m)?.[1] ?? '';
    skills.push({
      name,
      description,
      path: `.claude/skills/${name}/SKILL.md`,
      html: md.render(raw.replace(/^---\n[\s\S]*?\n---\n/, '')),
    });
  }
  return skills;
};
