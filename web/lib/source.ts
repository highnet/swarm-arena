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

export type SkillSection = {
  /** The anchor of the `<section>` that wraps one `##` chapter of the skill. */
  id: string;
  title: string;
};

export type Skill = {
  name: string;
  /** The skill's own `# heading` ("Chess playbook"), or its name when it has none. */
  title: string;
  description: string;
  path: string;
  /** The body without its `# heading`, each `##` chapter wrapped in `<section id>`. */
  html: string;
  sections: SkillSection[];
};

/** Anchors the skill page already uses for its own chapters. */
const RESERVED_IDS = new Set(['overview', 'skill', 'more']);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };

/** Heading HTML to plain text, for a nav label. */
const plain = (html: string) =>
  html.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ENTITIES[e]);

/**
 * Wraps each `<h2>` chapter of rendered markdown in a `<section>` with a stable anchor, so a page
 * can link to and track its chapters (the skill page's `SectionNav`). Text before the first h2
 * stays as it is.
 */
export const sectionChapters = (html: string): { html: string; sections: SkillSection[] } => {
  const sections: SkillSection[] = [];
  const used = new Set(RESERVED_IDS);
  const parts = html.split(/(?=<h2>)/).map((part) => {
    const m = /^<h2>([\s\S]*?)<\/h2>/.exec(part);
    if (!m) return part;
    const title = plain(m[1]).trim();
    const base =
      title
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'chapter';
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    sections.push({ id, title });
    return `<section id="${id}" aria-labelledby="${id}-title">${part.replace(
      '<h2>',
      `<h2 id="${id}-title">`,
    )}</section>`;
  });
  return { html: parts.join(''), sections };
};

/** Every agent skill in the repository: the swarm's own roles and each game's playbook. */
/** The first `# ` heading outside fenced code, so a `# comment` in a code block is never a title. */
export const firstHeading = (body: string): { title: string; rest: string } | null => {
  // Blank out fenced blocks, keeping offsets, so the match is never taken from code.
  const prose = body.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (m) =>
    m.replace(/[^\n]/g, ' '),
  );
  const m = /^# (.+)$/m.exec(prose);
  if (!m) return null;
  return {
    title: m[1].trim(),
    rest: body.slice(0, m.index) + body.slice(m.index + m[0].length),
  };
};

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
    const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '');
    // The page's one h1 is the skill's own heading; the body keeps everything after it.
    const heading = firstHeading(body);
    const { html, sections } = sectionChapters(md.render(heading ? heading.rest : body));
    skills.push({
      name,
      title: heading?.title ?? name,
      description,
      path: `.claude/skills/${name}/SKILL.md`,
      html,
      sections,
    });
  }
  return skills;
};

export type ConceptEvidence = {
  date: string;
  concept: string;
  game: string;
  outcome: string;
  title: string;
};

export type Concepts = {
  vocabulary: { name: string; idea: string }[];
  beliefsHtml: string;
  evidence: ConceptEvidence[];
};

/** The cross-game concepts skill: its vocabulary, the beliefs written so far, the evidence log. */
export const getConcepts = async (): Promise<Concepts> => {
  'use cache';
  // Ships with the deploy (#222): nothing changes it before the next one.
  cacheLife('max');
  const raw = await readFile(join(REPO, '.claude', 'skills', 'concepts', 'SKILL.md'), 'utf8').catch(
    () => '',
  );
  const section = (title: string) => {
    const at = raw.indexOf(`## ${title}`);
    if (at < 0) return '';
    const rest = raw.slice(at + title.length + 3);
    const end = rest.search(/\n## /);
    return (end < 0 ? rest : rest.slice(0, end)).trim();
  };
  const vocabulary = section('Concept vocabulary')
    .split('\n')
    .filter((l) => l.startsWith('|') && !/^\|\s*(Concept|---)/.test(l))
    .map((l) => l.split('|').map((c) => c.trim()))
    .map(([, name, idea]) => ({ name, idea }))
    .filter((c) => c.name);
  // One file per verdict under evidence/ (plus any lines still written inline in the old format).
  const dir = join(REPO, '.claude', 'skills', 'concepts', 'evidence');
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.md'));
  const lines = [
    ...section('Evidence log').split('\n'),
    ...(
      await Promise.all(files.map((f) => readFile(join(dir, f), 'utf8').catch(() => '')))
    ).flatMap((t) => t.split('\n')),
  ];
  const evidence = lines
    .map((l) => /^- (\S+) · \*\*(.+?)\*\* · (.+?) · (.+?) · (.+)$/.exec(l))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map(([, date, concept, game, outcome, title]) => ({ date, concept, game, outcome, title }));
  return { vocabulary, beliefsHtml: md.render(section('What we believe')), evidence };
};
