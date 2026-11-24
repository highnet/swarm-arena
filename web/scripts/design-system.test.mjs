/**
 * The shared editorial layout system (issue #218): the section primitives keep the contract that
 * web/DESIGN.md documents, and the per-route Impeccable report covers every page route.
 * Run: npm test -w web (node --test).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { markdown, pageRoutes, summarise } from './impeccable-routes.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const PRIMITIVES = [
  'Section',
  'SectionHeading',
  'SectionNav',
  'Disclosure',
  'FullBleed',
  'ReadingProgress',
  'TextLink',
];
/** The primitives with a visual API: they export their CVA `*Variants` for composition. */
const WITH_VARIANTS = [
  'Section',
  'SectionHeading',
  'Disclosure',
  'FullBleed',
  'ReadingProgress',
  'TextLink',
];

test('each section primitive exists, carries a data-slot and is documented in DESIGN.md', () => {
  const design = read('DESIGN.md');
  for (const name of PRIMITIVES) {
    const src = read(`components/ui/${name}.tsx`);
    const slot = name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    assert.match(src, new RegExp(`data-slot="${slot}"`), `${name} has data-slot="${slot}"`);
    assert.match(src, new RegExp(`type ${name}Props = `), `${name} has a named ${name}Props type`);
    assert.ok(design.includes(`**${name}**`), `DESIGN.md documents ${name}`);
  }
  for (const name of WITH_VARIANTS) {
    const variants = `${name[0].toLowerCase()}${name.slice(1)}Variants`;
    assert.match(
      read(`components/ui/${name}.tsx`),
      new RegExp(`export \\{ ${name}, ${variants} \\}`),
    );
  }
});

test('the primitives hold no colour or spacing values of their own', () => {
  for (const name of PRIMITIVES) {
    const src = read(`components/ui/${name}.tsx`);
    assert.doesNotMatch(src, /#[0-9a-f]{3,8}\b|oklch\(|rgb\(/i, `${name} has no literal colour`);
    assert.doesNotMatch(src, /style=\{\{/, `${name} has no inline style`);
  }
  // Section padding comes from the section spacing scale, defined once in globals.css.
  const section = read('components/ui/Section.tsx');
  for (const step of ['py-section-compact', 'py-section', 'py-section-roomy']) {
    assert.ok(section.includes(`'${step}'`), `Section uses ${step}`);
  }
  const css = read('app/globals.css');
  for (const token of [
    '--spacing-section-compact',
    '--spacing-section:',
    '--spacing-section-roomy',
    '--spacing-chapter',
    '--spacing-sticky',
  ]) {
    assert.ok(css.includes(token), `globals.css defines ${token}`);
  }
});

test('reduced motion removes the reading progress and the smooth scroll', () => {
  const css = read('app/globals.css');
  assert.match(
    css,
    /prefers-reduced-motion: reduce\)\s*\{\s*\.reading-progress\s*\{\s*display: none;/,
    'reading progress hidden for reduced motion',
  );
  assert.match(
    css,
    /prefers-reduced-motion: no-preference\)\s*\{\s*html\s*\{\s*scroll-behavior: smooth;/,
    'smooth scrolling only when motion is allowed',
  );
  assert.match(read('components/ui/SectionNav.tsx'), /prefers-reduced-motion: reduce/);
});

test('the Impeccable report covers every static page route and the four engines', () => {
  const routes = pageRoutes();
  assert.equal(routes[0], '/', 'the homepage comes first');
  for (const r of ['/engines', '/fleet', '/news', '/how-it-works', '/versions', '/graveyard']) {
    assert.ok(routes.includes(r), `${r} is scanned`);
  }
  for (const id of ['chess', 'go9', 'othello', 'hex']) {
    assert.ok(routes.includes(`/engines/${id}`), `/engines/${id} is scanned`);
  }
  assert.ok(!routes.some((r) => r.includes('[')), 'no unresolved dynamic segment');
  assert.equal(new Set(routes).size, routes.length, 'no route twice');
});

test('the report counts findings per rule and leaves advisories out', () => {
  const s = summarise([
    { antipattern: 'pulsing-dot' },
    { antipattern: 'overused-font' },
    { antipattern: 'pulsing-dot' },
    { antipattern: 'design-system-font-size', advisory: true },
  ]);
  assert.deepEqual(s, {
    findings: 3,
    advisory: 1,
    rules: [
      ['pulsing-dot', 2],
      ['overused-font', 1],
    ],
  });
  const md = markdown(
    [
      { route: '/', viewport: '1440x900', ...s },
      { route: '/', viewport: '390x844', findings: 0, advisory: 0, rules: [] },
      { route: '/fleet', viewport: '1440x900', error: 'no browser' },
    ],
    ['1440x900', '390x844'],
  );
  assert.match(md, /\| `\/` \| \*\*3\*\*: pulsing-dot ×2, overused-font \| 0 \|/);
  assert.match(md, /\| `\/fleet` \| scan failed: no browser \| – \|/);
});
