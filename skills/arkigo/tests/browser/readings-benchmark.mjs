import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { buildPage } from '../../scripts/page.mjs';
import { changesBetween } from '../../scripts/lib/changes.mjs';
import { revision } from '../../scripts/lib/design.mjs';
import { clinicInput, pageInput } from '../page/fixtures.mjs';
import { generateScale } from '../page/generate.mjs';
import { desktop } from './helpers.mjs';

const targets = {
  inventory: '.inventory-table', progress: '.progress-count', changes: '.change-record', decisions: '.decision-row'
};
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
const base = { ...design, objects: objects.map((item) => item.id === 'item-001' ? { ...item, summary: '旧摘要' } : item) };
const data = pageInput(design, { history: [{
  format: 'arkigo-change/1', at: '2026-11-20T10:00:00.000Z', by: '测试', reason: '更新模块摘要',
  base: revision(base), result: revision(design), changes: changesBetween(base, design)
}] });
const html = buildPage(data);
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
          // Only the decisions have an entry of their own; the other pages open from the find panel.
          if (mode !== 'decisions') document.querySelector('#search-open').click();
          document.querySelector((mode === 'decisions' ? '#readings' : '.browse-pages') +
            ' [data-mode="' + mode + '"]').click();
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
