import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { buildPage } from '../../scripts/page.mjs';
import { clinicInput, pageInput } from '../page/fixtures.mjs';
import { generateScale } from '../page/generate.mjs';
import { desktop } from './helpers.mjs';

const targets = { inventory: '.inventory-table' };
const templates = [
  ['rule', { constraint: '预约应在号源开放后提交。' }],
  ['acceptance', { when: '患者确认预约', then: ['显示预约凭证'] }],
  ['decision', { question: '由谁核验凭证？', options: [{ title: '前台' }, { title: '诊室' }] }],
  ['entity', { fields: [{ name: 'id', type: 'UUID', required: true }] }],
  ['interface', { kind: 'http', signature: 'GET /appointments' }],
  ['screen', { route: '/appointments', purpose: '读取预约凭证' }]
];
const original = generateScale();
const parents = new Set(original.objects.map(({ parent }) => parent));
const objects = original.objects.map((object, i) => {
  if (object.type !== 'module' || parents.has(object.id) || object.parent === original.id) return object;
  const [type, body] = templates[i % templates.length];
  return { ...object, type, body, ...(type === 'decision' && { status: 'proposed' }) };
});
const design = { ...original, objects };
const html = buildPage(pageInput(design));
const folder = await mkdtemp(join(tmpdir(), 'arkigo-readings-'));
let browser;
try {
  const file = join(folder, 'index.html');
  await writeFile(file, html);
  browser = await chromium.launch();
  const times = Object.fromEntries(Object.keys(targets).map((mode) => [mode, []]));
  for (let i = 0; i < 5; i++) {
    const context = await browser.newContext({ viewport: desktop, reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      for (const [mode, target] of Object.entries(targets)) {
        await page.goto(pathToFileURL(file).href);
        assert.equal(await page.locator('#world .graph-card').count(), 40);
        times[mode].push(await page.evaluate(async ({ mode, target }) => {
          const start = performance.now();
          document.querySelector('#search-open').click();
          document.querySelector('.browse-pages [data-mode="' + mode + '"]').click();
          await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
          if (window.arkigoCanvas.getState().mode !== mode || !document.querySelector(target)) {
            throw Error('Missing reading: ' + mode);
          }
          return performance.now() - start;
        }, { mode, target }));
      }
    } finally {
      await context.close();
    }
  }
  console.log(JSON.stringify({
    chromium: browser.version(),
    bytes: {
      clinic: Buffer.byteLength(buildPage(clinicInput())),
      scale: Buffer.byteLength(buildPage(pageInput(original))),
      mixedScale: Buffer.byteLength(html)
    },
    times
  }, null, 2));
} finally {
  await browser?.close();
  await rm(folder, { recursive: true, force: true });
}
