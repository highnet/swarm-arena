import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cacheLife } from 'next/cache';
import MarkdownIt from 'markdown-it';
import { TRACKS, type GameId } from '@arena/shared';

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

/** Stories live beside the site, in the repository's `news/` folder. */
const NEWS_DIR = resolve(process.cwd(), '..', 'news');

/** A story stays "just in" this long after it was published. */
export const JUST_IN_MS = 48 * 3_600_000;

export type Article = {
  slug: string;
  title: string;
  dek: string;
  published: string;
  engine: GameId | null;
  version: string | null;
  pr: number | null;
  minutes: number;
  path: string;
  html: string;
};

const ENGINES = new Set<string>(TRACKS.map((t) => t.id));

/** `key: value` front matter; a trailing `# comment` is ignored. */
const frontMatter = (raw: string) => {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const fields: Record<string, string> = {};
  for (const line of (m?.[1] ?? '').split('\n')) {
    const kv = /^([a-z]+):\s*(.*?)\s*(?:\s#.*)?$/.exec(line);
    if (kv) fields[kv[1]] = kv[2];
  }
  return { fields, body: m ? raw.slice(m[0].length) : raw };
};

/** Front matter is plain text: give it the same curly apostrophes the rendered body gets. */
const curly = (t: string) => t.replace(/(\w)'(\w)/g, '$1’$2');

const parse = (file: string, raw: string): Article | null => {
  const { fields, body } = frontMatter(raw);
  const slug = file.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
  if (!fields.title || !fields.published || Number.isNaN(Date.parse(fields.published))) return null;
  const words = body.split(/\s+/).filter(Boolean).length;
  return {
    slug,
    title: curly(fields.title),
    dek: curly(fields.dek ?? ''),
    published: new Date(fields.published).toISOString(),
    engine: fields.engine && ENGINES.has(fields.engine) ? (fields.engine as GameId) : null,
    version: fields.version || null,
    pr: fields.pr && /^\d+$/.test(fields.pr) ? Number(fields.pr) : null,
    minutes: Math.max(1, Math.round(words / 220)),
    path: `news/${file}`,
    html: md.render(body),
  };
};

/** Every story, newest first. */
export const getNews = async (): Promise<Article[]> => {
  'use cache';
  cacheLife('minutes');
  const files = (await readdir(NEWS_DIR).catch(() => [] as string[])).filter((f) =>
    /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(f),
  );
  const stories = await Promise.all(
    files.map(async (f) => parse(f, await readFile(join(NEWS_DIR, f), 'utf8').catch(() => ''))),
  );
  return stories
    .filter((a): a is Article => a !== null)
    .sort((a, b) => b.published.localeCompare(a.published));
};

export const getArticle = async (slug: string) =>
  (await getNews()).find((a) => a.slug === slug) ?? null;

export const newsHref = (slug: string) => `/news/${encodeURIComponent(slug)}`;
