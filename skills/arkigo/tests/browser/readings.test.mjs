import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { indexDesign } from '../../assets/model.mjs';
import { inventoryRows } from '../../assets/inventory.mjs';
import { clinicInput, pageInput } from '../page/fixtures.mjs';
import { createBoundaries } from '../page/generate.mjs';
import { engines, mobile, openPage, state, waitForView, writePage } from './helpers.mjs';

const input = clinicInput();
const index = indexDesign(input.design);
const browsers = new Map();
const names = process.env.ARKIGO_BROWSERS?.split(',') ?? Object.keys(engines);
let url;

before(async (t) => {
  for (const name of names) browsers.set(name, await engines[name].launch());
  url = await writePage(t, input);
});
after(async () => Promise.all([...browsers.values()].map((browser) => browser.close())));

async function openReading(t, name, mode, options) {
  return openPage(t, browsers.get(name), url + '#/' + mode + '/clinic', options);
}

for (const name of names) {
  test(`${name}: removed routes return to the roadmap and the catalog is available from search`, async (t) => {
    const { page, errors, requests } = await openReading(t, name, 'map');
    for (const mode of ['progress', 'changes', 'decisions']) {
      await page.goto(url + '#/' + mode + '/clinic');
      await waitForView(page, 'clinic', { mode: 'map' });
      assert.equal(await page.locator('.reading-page').count(), 0);
    }
    await page.goto(url + '#/map/appointment');
    await waitForView(page, 'reserve', { detail: 'appointment' });
    await page.locator('#search-open').click();
    assert.deepEqual(await page.locator('.browse-pages button').allTextContents(), ['按类型列出全部']);
    await page.locator('.browse-pages [data-mode="inventory"]').click();
    await waitForView(page, 'clinic', { mode: 'inventory', selected: 'appointment' });
    await page.goBack();
    await waitForView(page, 'reserve', { mode: 'map', detail: 'appointment' });
    await page.goForward();
    await waitForView(page, 'clinic', { mode: 'inventory', selected: 'appointment' });
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
  });

  test(`${name}: inventory combines filters, clears an empty result and opens a row`, async (t) => {
    const { page } = await openReading(t, name, 'inventory');
    const rows = page.locator('.inventory-table tbody tr');
    assert.equal(await rows.count(), Object.values(inventoryRows(index, input.evidence)).flat().length);
    await page.getByLabel('设计状态').selectOption('accepted');
    await page.getByLabel('所属模块').selectOption('reserve');
    const row = rows.filter({ hasText: index.get('reserve-api').title });
    await row.locator('td').last().click();
    assert.equal((await state(page)).detail, 'reserve-api');
    await page.locator('#detail').getByRole('button', { name: '关闭详情' }).click();
    await page.getByLabel('设计状态').selectOption('proposed');
    assert.equal(await rows.count(), 0);
    assert.match(await page.locator('.inventory-results').innerText(), /当前筛选没有结果/);
    await page.getByRole('button', { name: '清除筛选' }).click();
    assert.equal(await page.getByLabel('所属模块').inputValue(), '');
    assert.equal(await page.locator('.inventory-table').count(), 6);
  });

  test(`${name}: narrow catalog retains table columns and scrolls sideways`, async (t) => {
    const { page } = await openReading(t, name, 'inventory', { viewport: mobile, hasTouch: true });
    assert.equal(await page.locator('.inventory-page').evaluate((element) =>
      element.scrollWidth <= element.clientWidth), true);
    const table = page.locator('.inventory-table').first();
    assert.equal(await table.locator('thead').evaluate((head) => getComputedStyle(head).display), 'table-header-group');
    const results = page.getByRole('region', { name: '清单结果' });
    assert.ok(await results.evaluate((el) => el.scrollWidth > el.clientWidth));
    await results.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('.inventory-results').scrollLeft > 0);
    await results.evaluate((el) => { el.scrollLeft = 0; });
    await page.locator('.inventory-table tbody tr button').first().tap();
    assert.ok(await page.locator('#detail').isVisible());
  });

  if (name !== 'chromium') continue;

  test('chromium: dark reading text meets 4.5:1 and empty views provide next steps', async (t) => {
    const { page } = await openReading(t, name, 'inventory', { colorScheme: 'dark' });
    const contrast = await page.locator('.reading-page').evaluate((reading) => {
      const rgb = (color) => color.match(/[\d.]+/g).map(Number);
      const light = ([r, g, b]) => [r, g, b].map((value) => value / 255).map((value) =>
        value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
      return [...reading.querySelectorAll('h2, h3, p, td, th, a, button, time, code, select')]
        .filter((el) => el.getClientRects().length && !el.disabled).map((el) => {
          let background;
          for (let parent = el; parent; parent = parent.parentElement) {
            const color = rgb(getComputedStyle(parent).backgroundColor);
            if (color.length === 3 || color[3] === 1) { background = light(color); break; }
          }
          const text = light(rgb(getComputedStyle(el).color));
          return { text: el.textContent, ratio: (Math.max(background, text) + .05) /
            (Math.min(background, text) + .05) };
        }).filter(({ ratio }) => ratio < 4.5);
    });
    assert.deepEqual(contrast, []);
    const empty = await writePage(t, pageInput(createBoundaries().empty));
    await page.goto(empty + '#/inventory/empty');
    assert.ok(await page.locator('.reading-empty svg').isVisible());
  });
}
