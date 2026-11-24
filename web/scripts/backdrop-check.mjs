/**
 * Browser check for the homepage backdrop (issue #234). Drives a running site (`next start`) in
 * Chromium, in both colour schemes, at 1440 and 390 px:
 *
 *   1. the backdrop canvas exists on `/` only (not on /engines, which keeps its own scene),
 *      draws with WebGL, and caps the device pixel ratio at 1.5;
 *   2. it animates while visible, stops while the tab is hidden and while the overview is
 *      scrolled out of view, and resumes after each;
 *   3. reduced motion renders exactly one frame and no loop;
 *   4. without WebGL the same field is drawn once as SVG;
 *   5. the headline, intro and links keep WCAG AA against the backdrop behind them (3:1 for
 *      the large headline, 4.5:1 for the rest), measured on the pixels the backdrop painted;
 *   6. no console errors or page errors anywhere.
 *
 * Headless Chromium renders WebGL in software (SwiftShader), so the mean draw time it prints is
 * an upper bound, not the GPU cost.
 *
 * Run: node web/scripts/backdrop-check.mjs [base-url] (default http://localhost:3000; needs
 * Playwright's Chromium). Exits 1 on a failed check.
 */
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const HOST = '[data-slot="home-backdrop"]';
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

const watchErrors = (page, label) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return () =>
    check(
      errors.length === 0,
      `${label}: no console errors${errors.length ? ` (${errors.join(' | ')})` : ''}`,
    );
};

const frames = (page) => page.$eval(HOST, (e) => e.backdropFrames ?? 0);
const settle = (page, ms) => page.waitForTimeout(ms);

/** Emulates the tab being hidden or shown again (Playwright pages are always visible). */
const setHidden = (page, hidden) =>
  page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (h ? 'hidden' : 'visible'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);

const open = async (browser, opts, path = '/') => {
  const page = await browser.newPage(opts);
  const done = watchErrors(
    page,
    `${opts.colorScheme ?? ''} ${opts.viewport.width}px ${path}${opts.reducedMotion ? ' reduced' : ''}`,
  );
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  return { page, done };
};

/**
 * Lowest contrast between each text block's colour and the backdrop pixels behind it: the text
 * is hidden, the backdrop alone is captured, and every pixel in the block's box is compared.
 */
const contrastFloor = async (page) => {
  const boxes = await page.evaluate(() => {
    const pick = [
      ['headline', '#hero-title', 3],
      ['intro', '#overview p', 4.5],
      ['links', '#overview a:not([class*="bg-"])', 4.5],
    ];
    return pick.flatMap(([name, sel, need]) =>
      [...document.querySelectorAll(sel)].slice(0, 4).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          name,
          need,
          color: getComputedStyle(el).color,
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
        };
      }),
    );
  });
  await page.addStyleTag({
    content: '#overview > :not([aria-hidden]) { visibility: hidden !important; }',
  });
  await settle(page, 100);
  const shot = (await page.screenshot()).toString('base64');
  await page.evaluate(() => document.querySelector('style:last-of-type')?.remove());
  return page.evaluate(
    async ({ shot, boxes }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${shot}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const scale = img.width / window.innerWidth;
      const lin = (v) => {
        v /= 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const rgbOf = (css) => {
        const p = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        p.fillStyle = css;
        p.fillRect(0, 0, 1, 1);
        return p.getImageData(0, 0, 1, 1).data;
      };
      return boxes.map((b) => {
        const [tr, tg, tb] = rgbOf(b.color);
        const lt = lum(tr, tg, tb);
        const x = Math.max(0, Math.round(b.x * scale));
        const y = Math.max(0, Math.round(b.y * scale));
        const w = Math.min(c.width - x, Math.round(b.w * scale));
        const h = Math.min(c.height - y, Math.round(b.h * scale));
        if (w <= 0 || h <= 0) return { ...b, min: Infinity };
        const d = ctx.getImageData(x, y, w, h).data;
        let min = Infinity;
        let at = '';
        for (let i = 0; i < d.length; i += 4) {
          const lb = lum(d[i], d[i + 1], d[i + 2]);
          const ratio = (Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05);
          if (ratio < min) {
            min = ratio;
            const px = (i / 4) % w;
            at = `rgb(${d[i]} ${d[i + 1]} ${d[i + 2]}) at ${Math.round((x + px) / scale)},${Math.round((y + Math.floor(i / 4 / w)) / scale)}`;
          }
        }
        return { name: b.name, need: b.need, min, at };
      });
    },
    { shot, boxes },
  );
};

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  for (const colorScheme of ['light', 'dark'])
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ]) {
      const label = `${colorScheme} ${width}px`;
      const { page, done } = await open(browser, {
        viewport: { width, height },
        colorScheme,
        deviceScaleFactor: 2,
      });
      await page.waitForSelector(`${HOST}[data-motion]`, { timeout: 30_000 });
      const kind = await page.$eval(HOST, (e) => e.dataset.backdrop);
      check(kind === 'webgl', `${label}: backdrop draws with WebGL (${kind})`);
      check((await page.locator(`${HOST} canvas`).count()) === 1, `${label}: one canvas on /`);
      const dpr = await page.$eval(`${HOST} canvas`, (c) => c.width / c.clientWidth);
      check(dpr <= 1.5 + 1e-6, `${label}: pixel ratio capped (${dpr.toFixed(2)} at DPR 2)`);

      const f0 = await frames(page);
      await settle(page, 1200);
      const f1 = await frames(page);
      check(f1 > f0 + 5, `${label}: animates while visible (+${f1 - f0} frames in 1.2 s)`);
      const ms = await page.$eval(HOST, (e) => e.backdropFrameMs ?? 0);
      console.log(`     mean draw ${ms.toFixed(2)} ms/frame (software WebGL)`);

      await setHidden(page, true);
      await settle(page, 200);
      const h0 = await frames(page);
      await settle(page, 1200);
      const h1 = await frames(page);
      const hm = await page.$eval(HOST, (e) => e.dataset.motion);
      check(
        h1 === h0 && hm === 'paused',
        `${label}: stops while the tab is hidden (+${h1 - h0}, ${hm})`,
      );
      await setHidden(page, false);
      await settle(page, 800);
      check((await frames(page)) > h1, `${label}: resumes when the tab is shown`);

      await page.$eval('#engines', (e) =>
        e.scrollIntoView({ block: 'start', behavior: 'instant' }),
      );
      await settle(page, 500);
      const s0 = await frames(page);
      await settle(page, 1200);
      const s1 = await frames(page);
      const sm = await page.$eval(HOST, (e) => e.dataset.motion);
      check(
        s1 === s0 && sm === 'paused',
        `${label}: stops when scrolled out of view (+${s1 - s0}, ${sm})`,
      );
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await settle(page, 800);
      check((await frames(page)) > s1, `${label}: resumes when scrolled back`);

      for (const r of await contrastFloor(page))
        check(
          r.min >= r.need,
          `${label}: ${r.name} keeps AA over the backdrop (min ${r.min.toFixed(2)}:1, needs ${r.need}:1; ${r.at})`,
        );
      done();
      await page.close();
    }

  // Reduced motion: one frame, no loop.
  for (const colorScheme of ['light', 'dark']) {
    const { page, done } = await open(browser, {
      viewport: { width: 1440, height: 900 },
      colorScheme,
      reducedMotion: 'reduce',
    });
    await page.waitForSelector(`${HOST}[data-motion]`, { timeout: 30_000 });
    await settle(page, 1500);
    const n = await frames(page);
    const m = await page.$eval(HOST, (e) => e.dataset.motion);
    check(n === 1 && m === 'still', `${colorScheme} reduced motion: one frame, still (${n}, ${m})`);
    done();
    await page.close();
  }

  // No WebGL: the same field as SVG.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return /webgl/.test(type) ? null : get.call(this, type, ...rest);
      };
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`${HOST}[data-backdrop]`, { timeout: 30_000 });
    const kind = await page.$eval(HOST, (e) => e.dataset.backdrop);
    const paths = await page.locator(`${HOST} svg path`).count();
    const canvases = await page.locator(`${HOST} canvas`).count();
    check(
      kind === 'svg' && paths === 4 && canvases === 0,
      `no WebGL: static SVG field (${kind}, ${paths} boards, ${canvases} canvases)`,
    );
    check(
      errors.length === 0,
      `no WebGL: no page errors${errors.length ? ` (${errors.join(' | ')})` : ''}`,
    );
    await ctx.close();
  }

  // Other routes keep their own scene and never get this one.
  {
    const { page, done } = await open(
      browser,
      { viewport: { width: 1440, height: 900 } },
      '/engines',
    );
    await settle(page, 3000);
    check((await page.locator(HOST).count()) === 0, '/engines: no homepage backdrop');
    done();
    await page.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nall backdrop checks passed');
