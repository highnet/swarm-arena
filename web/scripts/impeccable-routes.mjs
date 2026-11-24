/**
 * Impeccable `detect`, route by route (issue #218). Drives a running site (`next start`) through
 * the Impeccable CLI's URL scan at a desktop and a phone viewport, and reports the findings per
 * page as a Markdown table, so each route's redesign (#229–#233) can show its before and after.
 *
 *   node web/scripts/impeccable-routes.mjs [base-url] [--out <file.md>] [--json <file.json>]
 *                                         [--viewports 1440x900,390x844] [--only /,/engines]
 *
 * The routes are every page under `web/app` without a dynamic segment, plus the four engine pages
 * (the only dynamic route whose ids are fixed: the games). Pages that need a record id (a game, a
 * match, a session) depend on live data and are left to the route issues' own runs.
 *
 * It reports, it does not gate: the exit code is 0 whatever the findings, and 1 only when the
 * detector could not scan at all. With `GITHUB_STEP_SUMMARY` set (GitHub Actions) the table is
 * appended to the job summary.
 *
 * Impeccable (Apache-2.0) is a dev dependency of the site, run from `node_modules`; nothing of
 * it is vendored.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(WEB, 'app');

/** The four engines' ids, the one dynamic segment whose values are fixed (`/engines/[id]`). */
export const ENGINE_IDS = ['chess', 'go9', 'othello', 'hex'];

export const DEFAULT_VIEWPORTS = ['1440x900', '390x844'];

/**
 * Route paths for every `page.tsx` under `appDir`: route groups `(x)` drop out, a page under a
 * dynamic segment is skipped unless that segment is `/engines/[id]` itself, which expands to
 * the four engines.
 */
export const pageRoutes = (appDir = APP) => {
  const routes = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name === 'page.tsx') routes.push(relative(appDir, dir));
    }
  };
  walk(appDir);
  const out = [];
  for (const rel of routes) {
    const parts = rel === '' ? [] : rel.split(sep).filter((p) => !/^\(.*\)$/.test(p));
    const route = `/${parts.join('/')}`;
    if (route === '/engines/[id]') out.push(...ENGINE_IDS.map((id) => `/engines/${id}`));
    else if (!parts.some((p) => p.startsWith('['))) out.push(route);
  }
  return out.sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b)));
};

/** Parses the CLI's `--json` output (an array of findings) into rule counts. */
export const summarise = (findings) => {
  const counted = findings.filter((f) => !f.advisory);
  const rules = new Map();
  for (const f of counted) rules.set(f.antipattern, (rules.get(f.antipattern) ?? 0) + 1);
  return {
    findings: counted.length,
    advisory: findings.length - counted.length,
    rules: [...rules].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
};

/** One Markdown table: a row per route, a column per viewport. */
export const markdown = (results, viewports) => {
  const cell = (r) => {
    if (!r) return '–';
    if (r.error) return `scan failed: ${r.error}`;
    if (r.findings === 0) return r.advisory ? `0 (${r.advisory} advisory)` : '0';
    const rules = r.rules.map(([id, n]) => (n > 1 ? `${id} ×${n}` : id)).join(', ');
    return `**${r.findings}**: ${rules}`;
  };
  const lines = [
    '### Impeccable detect, per route',
    '',
    `| Route | ${viewports.join(' | ')} |`,
    `| --- | ${viewports.map(() => '---').join(' | ')} |`,
  ];
  for (const route of [...new Set(results.map((r) => r.route))]) {
    const row = viewports.map((v) =>
      cell(results.find((r) => r.route === route && r.viewport === v)),
    );
    lines.push(`| \`${route}\` | ${row.join(' | ')} |`);
  }
  const total = results.reduce((n, r) => n + (r.findings ?? 0), 0);
  lines.push(
    '',
    `${total} findings across ${results.length} scans (advisory findings not counted).`,
  );
  return `${lines.join('\n')}\n`;
};

const impeccableBin = () => {
  const require = createRequire(join(WEB, 'package.json'));
  return join(dirname(require.resolve('impeccable/package.json')), 'cli', 'bin', 'cli.js');
};

const scan = (bin, url, viewport) => {
  const run = spawnSync(process.execPath, [bin, 'detect', '--json', '--viewport', viewport, url], {
    cwd: WEB, // so the CLI reads web/DESIGN.md and web/.impeccable/
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 180_000,
  });
  const out = (run.stdout ?? '').trim();
  try {
    return summarise(JSON.parse(out || '[]'));
  } catch {
    const why = (run.stderr || run.error?.message || `exit ${run.status}`).trim().split('\n').pop();
    return { error: why.slice(0, 160) };
  }
};

const main = () => {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const outMd = flag('--out');
  const outJson = flag('--json');
  const viewports = (flag('--viewports') ?? DEFAULT_VIEWPORTS.join(',')).split(',');
  const only = flag('--only')?.split(',');
  const base = (args[0] ?? 'http://localhost:3000').replace(/\/$/, '');

  const bin = impeccableBin();
  const routes = only ?? pageRoutes();
  const results = [];
  for (const route of routes) {
    for (const viewport of viewports) {
      const r = { route, viewport, ...scan(bin, `${base}${route}`, viewport) };
      console.log(
        `${route} @ ${viewport}: ${r.error ? `FAILED (${r.error})` : `${r.findings} findings`}`,
      );
      results.push(r);
    }
  }

  const md = markdown(results, viewports);
  console.log(`\n${md}`);
  if (outMd) writeFileSync(outMd, md);
  if (outJson) writeFileSync(outJson, `${JSON.stringify(results, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  if (results.every((r) => r.error)) process.exit(1);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
