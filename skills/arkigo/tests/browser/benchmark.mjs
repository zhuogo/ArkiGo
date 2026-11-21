import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { buildPage } from '../../scripts/page.mjs';
import { clinicDir, clinicInput, pageInput } from '../page/fixtures.mjs';
import { generateScale } from '../page/generate.mjs';
import { desktop } from './helpers.mjs';

const directory = await mkdtemp(join(tmpdir(), 'arkigo-benchmark-'));
let browser;
try {
  const scale = pageInput(generateScale());
  const html = buildPage(scale);
  const file = join(directory, 'index.html');
  await writeFile(file, html);
  browser = await chromium.launch();
  const cases = [];
  for (let i = 0; i < 5; i++) {
    const context = await browser.newContext({ viewport: desktop, reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        requestAnimationFrame(function measureReady() {
          if (!window.arkigoCanvas) requestAnimationFrame(measureReady);
          else requestAnimationFrame(() => performance.mark('arkigo-ready'));
        });
      });
      await page.goto(pathToFileURL(file).href);
      await page.waitForFunction(() => performance.getEntriesByName('arkigo-ready').length === 1);
      assert.equal(await page.locator('#world .graph-card').count(), 40);
      const ready = await page.evaluate(() => performance.getEntriesByName('arkigo-ready')[0].startTime);
      await page.goto(pathToFileURL(file).href + '#/map/item-160');
      await page.waitForFunction(() => window.arkigoCanvas.getState().selected === 'item-160');
      const switchTime = await page.evaluate(async () => {
        const start = performance.now();
        document.querySelector('#world .graph-card[data-id="item-160"]')
          .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (window.arkigoCanvas.getState().viewId !== 'item-160' ||
            document.querySelectorAll('#world .graph-card').length !== 3) throw Error('Flow failed to render');
        return performance.now() - start;
      });
      cases.push({ ready, switchTime });
    } finally {
      await context.close();
    }
  }
  // Time the shared implementation in Chromium, including relation projection for the 40-card root.
  const source = new URL('../../assets/', import.meta.url);
  const imports = await Promise.all(['model.mjs', 'layout.mjs'].map((name) => readFile(new URL(name, source), 'utf8')));
  const page = await browser.newPage();
  const mapTimes = await page.evaluate(({ functions, design }) => {
    const layout = new Function(functions + '\nreturn { indexDesign, projectRelations, layoutMap };')();
    const index = layout.indexDesign(design);
    const cards = index.children.get(design.id);
    return Array.from({ length: 5 }, () => {
      const start = performance.now();
      const { edges } = layout.projectRelations(index, design.relations, design.id, new Set(cards.map(({ id }) => id)));
      const plan = layout.layoutMap(cards, edges);
      if (plan.cards.length !== 40) throw Error('Map needs exactly 40 cards');
      return performance.now() - start;
    });
  }, { functions: imports.join('\n').replace(/^export /gm, ''), design: scale.design });
  console.log(JSON.stringify({
    chromium: browser.version(), viewport: desktop, cases, mapTimes,
    bytes: { clinic: Buffer.byteLength(buildPage(clinicInput())), scale: Buffer.byteLength(html) }
  }, null, 2));
} finally {
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
}
