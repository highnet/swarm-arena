/**
 * Colour tokens (issue #206): parses the `:root` tokens in app/globals.css, resolves each
 * `light-dark(<light>, <dark>)` pair, and asserts WCAG AA in both themes:
 *   - text tokens at 4.5:1 against every surface they sit on;
 *   - engine accents and status marks at 3:1 (non-text contrast, WCAG 1.4.11);
 *   - the primary button's label against its fill at 4.5:1;
 *   - board pieces (#263): each side's stones at 3:1 on every board square, and against each other.
 * Run: npm test -w web (node --test).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

const SURFACES = ['bg', 'band', 'panel', 'panel-raised'];
const TEXT = ['fg', 'fg-2', 'fg-3', 'good-text', 'critical-text'];
const CODE = ['code-keyword', 'code-type', 'code-title', 'code-string', 'code-number'];
const MARKS = ['series-1', 'series-2', 'series-3', 'series-4', 'good', 'critical', 'warning'];

/** The first `:root { … }` block: every token, as written. */
const rootTokens = () => {
  const block = css.match(/:root\s*\{([\s\S]*?)\n\}/);
  assert.ok(block, 'globals.css has a :root block');
  const tokens = {};
  for (const m of block[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
  return tokens;
};

const OKLCH = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*[\d.]+)?\)/;

/** Resolves a token to an oklch() string for one theme, following var() and light-dark(). */
const resolve = (tokens, name, theme, seen = new Set()) => {
  assert.ok(!seen.has(name), `--${name} refers to itself`);
  seen.add(name);
  const raw = tokens[name];
  assert.ok(raw, `--${name} is defined`);
  const ref = raw.match(/^var\(--([\w-]+)\)$/);
  if (ref) return resolve(tokens, ref[1], theme, seen);
  const pair = raw.match(/^light-dark\((oklch\([^)]*\)),\s*(oklch\([^)]*\))\)$/);
  if (pair) return theme === 'light' ? pair[1] : pair[2];
  assert.match(raw, OKLCH, `--${name} is an oklch() colour`);
  return raw;
};

/** oklch() → relative luminance (WCAG), via OKLab and linear sRGB, clipped to the gamut. */
const luminance = (oklch) => {
  const [, L, C, h] = oklch.match(OKLCH).map(Number);
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clip = (v) => Math.min(1, Math.max(0, v));
  const r = clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bl = clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
};

const contrast = (x, y) => {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

const tokens = rootTokens();

for (const theme of ['light', 'dark']) {
  const color = (name) => resolve(tokens, name, theme);

  test(`${theme}: text tokens reach 4.5:1 on every surface`, () => {
    for (const fg of [...TEXT, ...CODE])
      for (const bg of SURFACES) {
        const ratio = contrast(color(fg), color(bg));
        assert.ok(ratio >= 4.5, `--${fg} on --${bg}: ${ratio.toFixed(2)}:1`);
      }
  });

  test(`${theme}: engine and status marks reach 3:1 on every surface`, () => {
    for (const mark of MARKS)
      for (const bg of SURFACES) {
        const ratio = contrast(color(mark), color(bg));
        assert.ok(ratio >= 3, `--${mark} on --${bg}: ${ratio.toFixed(2)}:1`);
      }
  });

  test(`${theme}: both sides' pieces stand out from the board and from each other`, () => {
    for (const stone of ['stone-black', 'stone-white'])
      for (const square of ['square-light', 'square-dark']) {
        const ratio = contrast(color(stone), color(square));
        assert.ok(ratio >= 3, `--${stone} on --${square}: ${ratio.toFixed(2)}:1`);
      }
    const sides = contrast(color('stone-black'), color('stone-white'));
    assert.ok(sides >= 3, `--stone-black against --stone-white: ${sides.toFixed(2)}:1`);
    for (const square of ['square-light', 'square-dark']) {
      const ratio = contrast(color('board-line'), color(square));
      assert.ok(ratio >= 3, `--board-line on --${square}: ${ratio.toFixed(2)}:1`);
    }
  });

  test(`${theme}: the primary action's label reads on its fill`, () => {
    const ratio = contrast(color('primary-fg'), color('primary'));
    assert.ok(ratio >= 4.5, `--primary-fg on --primary: ${ratio.toFixed(2)}:1`);
  });
}

test('the two themes are both defined for every surface and text token', () => {
  for (const name of [...SURFACES, ...TEXT, ...MARKS, ...CODE])
    assert.match(tokens[name], /^light-dark\(/, `--${name} has a light and a dark value`);
});
