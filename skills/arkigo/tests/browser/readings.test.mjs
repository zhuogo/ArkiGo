import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import Ajv from 'ajv';
import { indexDesign } from '../../assets/model.mjs';
import { inventoryRows } from '../../assets/inventory.mjs';
import { progressGroups } from '../../assets/progress.mjs';
import { decisionPrompt } from '../../assets/decisions.mjs';
import { buildPage } from '../../scripts/page.mjs';
import { clinicDir, clinicInput, pageInput } from '../page/fixtures.mjs';
import { createBoundaries } from '../page/generate.mjs';
import { card, engines, mobile, openPage, state, waitForView, writePage } from './helpers.mjs';

const input = clinicInput();
const index = indexDesign(input.design);
const modes = ['inventory', 'progress', 'changes', 'decisions'];
const entries = ['map', 'decisions'];
const browsers = new Map();
const names = process.env.ARKIGO_BROWSERS?.split(',') ?? Object.keys(engines);
const validation = new Ajv().compile(JSON.parse(await readFile(
  new URL('../../schemas/decisions-v1.schema.json', import.meta.url), 'utf8')));
const literal = '<script>window.arkigoInjected = true</script>\n保留原样';
const tab = (page, mode) => page.locator(`#readings [data-mode="${mode}"]`);
const pending = (page, id) => page.locator(`.decision-row[data-id="${id}"]`);
// Pages without an entry of their own are opened the way a reader finds them: from the find panel.
async function openMode(page, mode, touch = false) {
  const activate = (locator) => touch ? locator.tap() : locator.click();
  if (entries.includes(mode)) return activate(tab(page, mode));
  await activate(page.locator('#search-open'));
  await activate(page.locator(`.browse-pages [data-mode="${mode}"]`));
}
const exec = promisify(execFile);
let url;

before(async (t) => {
  for (const name of names) browsers.set(name, await engines[name].launch());
  url = await writePage(t, input);
});
after(async () => Promise.all([...browsers.values()].map((browser) => browser.close())));

async function openReading(t, name, mode, options) {
  return openPage(t, browsers.get(name), url + '#/' + mode + '/clinic', options);
}

async function downloadDecisions(page, touch = false) {
  const download = page.waitForEvent('download');
  const control = page.getByRole('button', { name: '导出决定' });
  await (touch ? control.tap() : control.click());
  const file = await download;
  assert.equal(file.suggestedFilename(), 'decisions.json');
  const path = await file.path();
  const data = JSON.parse(await readFile(path, 'utf8'));
  assert.ok(validation(data), JSON.stringify(validation.errors));
  return { data, path };
}

async function makeDecisions(page, touch = false, source = url) {
  const activate = (locator) => touch ? locator.tap() : locator.click();
  await activate(pending(page, 'cancelled-reminder').getByRole('button', { name: '接受', exact: true }));
  await activate(pending(page, 'late-policy').getByRole('button', { name: '否决', exact: true }));
  await page.getByLabel('理由（可选）').fill(literal);
  await activate(page.getByRole('button', { name: '保存否决' }));
  await activate(pending(page, 'waitlist').getByRole('button', { name: '选择选项' }));
  await page.getByLabel('选项', { exact: true }).selectOption('1');
  await page.getByLabel('理由（可选）').fill('前台确认后通知');
  await activate(page.getByRole('button', { name: '保存选择' }));
  await page.goto(source + '#/map/appointment');
  await waitForView(page, 'reserve', { detail: 'appointment' });
  await activate(page.locator('#detail').getByRole('button', { name: '写批注' }));
  await page.getByLabel('批注', { exact: true }).fill(literal);
  await activate(page.getByRole('button', { name: '保存批注' }));
  await activate(page.locator('#detail').getByRole('button', { name: '关闭详情' }));
  await activate(tab(page, 'decisions'));
  assert.equal(await page.locator('.decision-item').count(), 4);
}

for (const name of names) {
  test(`${name}: the entries and the pages behind them keep the selected object, deep links and history`, async (t) => {
    const { page, errors, requests } = await openReading(t, name, 'map');
    const tabs = await page.locator('#readings button').evaluateAll((buttons) =>
      buttons.map((button) => button.dataset.mode));
    assert.deepEqual(tabs, entries);
    await page.goto(url + '#/map/appointment');
    await waitForView(page, 'reserve', { detail: 'appointment' });
    for (const mode of modes) {
      await openMode(page, mode);
      assert.equal((await state(page)).selected, 'appointment');
      assert.ok(page.url().endsWith('#/' + mode + '/appointment'));
      const offset = await page.locator('.reading-page').evaluate((body) => {
        const contentLeft = body.getBoundingClientRect().left + parseFloat(getComputedStyle(body).paddingLeft);
        return document.querySelector('#view-title').getBoundingClientRect().left - contentLeft;
      });
      assert.ok(Math.abs(offset) <= 1, mode + ' title offset: ' + offset);
    }
    await page.goBack();
    await waitForView(page, 'clinic', { mode: 'changes', selected: 'appointment' });
    await page.goForward();
    await waitForView(page, 'clinic', { mode: 'decisions', selected: 'appointment' });
    for (const mode of modes) {
      await page.goto(url + '#/' + mode + '/reserve-api');
      await waitForView(page, 'clinic', { mode, selected: 'reserve-api' });
      assert.ok(await page.locator('.reading-page').isVisible());
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
  });

  test(`${name}: inventory combines filters, clears an empty result and opens a row`, async (t) => {
    const { page } = await openReading(t, name, 'inventory');
    const rows = page.locator('.inventory-table tbody tr');
    assert.equal(await rows.count(), Object.values(inventoryRows(index, input.evidence)).flat().length);
    await page.getByLabel('设计状态').selectOption('accepted');
    await page.getByLabel('实现情况').selectOption('stale');
    await page.getByLabel('所属模块').selectOption('reserve');
    assert.equal(await rows.count(), 1);
    await rows.locator('td').last().click();
    assert.equal((await state(page)).detail, 'reserve-api');
    await page.locator('#detail').getByRole('button', { name: '关闭详情' }).click();
    await page.getByLabel('设计状态').selectOption('proposed');
    assert.equal(await rows.count(), 0);
    assert.match(await page.locator('.inventory-results').innerText(), /当前筛选没有结果/);
    await page.getByRole('button', { name: '清除筛选' }).click();
    assert.equal(await page.getByLabel('所属模块').inputValue(), '');
    assert.equal(await page.locator('.inventory-table').count(), 6);
  });

  test(`${name}: progress counts and each drill-down match the shared calculation`, async (t) => {
    const { page } = await openReading(t, name, 'progress');
    const expected = progressGroups(index, input.evidence);
    for (const group of expected.groups) {
      const owner = page.locator(`.progress-group[data-module="${group.owner.id}"]`);
      const counts = { implementation: group.implementation, verification: group.verification };
      for (const [kind, rows] of Object.entries(counts)) {
        for (const [value, objects] of Object.entries(rows)) {
          const count = owner.locator(`button[data-kind="${kind}"][data-state="${value}"]`);
          assert.equal(await count.getAttribute('data-count'), String(objects.length));
          if (!objects.length) continue;
          await count.click();
          assert.equal(await page.locator('#browse .reading-object-list > li').count(), objects.length);
          await page.locator('#browse-close').click();
        }
      }
    }
    assert.doesNotMatch(await page.locator('.progress-page').innerText(), /%/);
    assert.equal(await page.locator('.review-evidence').count(), expected.review.length);
  });

  test(`${name}: historical fields and map marks follow the selected record, independent of dragging`, async (t) => {
    const { page } = await openReading(t, name, 'changes', { timezoneId: 'Asia/Shanghai' });
    const record = page.locator('.change-record').filter({ hasText: '补充凭证访问约束并清理旧规则' });
    const time = record.locator('time');
    assert.equal(await time.innerText(), '2026-11-20 21:22');
    assert.equal(await time.getAttribute('datetime'), '2026-11-20T13:22:18.306Z');
    await record.click();
    assert.equal(await page.locator('.change-section').count(), 3);
    assert.equal(await page.locator('.changed-field .field-path').innerText(), '摘要');
    assert.match(await page.locator('.diff-pair del').innerText(), /一/);
    assert.match(await page.locator('.diff-pair ins').innerText(), /二/);
    await tab(page, 'map').click();
    assert.ok(await card(page, 'booking').locator('.card-change').isVisible());
    await page.locator('#rev').click();
    await page.getByRole('button', { name: '取消选中' }).click();
    await tab(page, 'map').click();
    assert.equal(await page.locator('.card-change').count(), 0);
    const bounds = await card(page, 'booking').boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 12, bounds.y + bounds.height / 2 + 10, { steps: 5 });
    await page.mouse.up();
    assert.ok((await state(page)).layout.views.clinic.booking);
    assert.equal(await page.locator('.card-change').count(), 0);
  });

  test(name + ': decision rows expose the actions and context for each kind', async (t) => {
    const design = { ...input.design, objects: input.design.objects.map((object) =>
      object.id === 'first-visit' ? { ...object, body: { question: object.body.question } } : object) };
    const fixture = await writePage(t, pageInput(design));
    const { page } = await openPage(t, browsers.get(name), fixture + '#/decisions/clinic');
    for (const [id, names] of [
      ['waitlist', ['选择选项', '否决', '写批注']],
      ['first-visit', ['接受', '否决', '写批注']],
      ['cancelled-reminder', ['接受', '否决', '写批注']],
      ['receipt-expiry', ['接受', '否决', '写批注']]
    ]) {
      assert.deepEqual(await pending(page, id).locator('.reading-actions button').allTextContents(), names, id);
    }
    const conclusion = pending(page, 'receipt-expiry');
    assert.equal(await conclusion.locator('.decision-conclusion').innerText(), '结论：签到窗口结束时失效');
    assert.equal(await conclusion.locator('.decision-rationale').innerText(),
      '理由：凭证与签到窗口同步，迟到患者由前台核实预约后处理。');
  });

  test(`${name}: decisions persist, export inert strings, offer manual copy and support undo`, async (t) => {
    const { page } = await openReading(t, name, 'decisions');
    assert.match(await tab(page, 'decisions').getAttribute('aria-label'), /5 项/);
    await makeDecisions(page);
    await page.reload();
    assert.match(await tab(page, 'decisions').getAttribute('aria-label'), /2 项/);
    assert.equal(await pending(page, 'waitlist').locator('.decision-recorded').innerText(), '已记录 · 选择');
    assert.equal(await page.locator('.decision-item').count(), 4);
    assert.equal(await page.locator('.decision-item script').count(), 0);
    assert.equal(await page.evaluate(() => window.arkigoInjected), undefined);
    assert.ok((await page.locator('.decision-list').first().textContent()).includes(literal));
    const { data } = await downloadDecisions(page);
    assert.equal(data.items[1].rationale, literal);
    assert.equal(data.items[2].chosen, 1);
    assert.deepEqual(data.items[3], { op: 'comment', id: 'appointment', text: literal });
    const entries = data.items.map((item) => ({ item, rev: data.base }));
    const expected = decisionPrompt(index, entries, input.rev, input.designDir);
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: () => Promise.reject(new Error('Denied')) }
    }));
    await page.getByRole('button', { name: '复制给 AI' }).click();
    assert.equal(await page.locator('.decision-copy').inputValue(), expected);
    await page.locator('#browse-close').click();
    await page.getByRole('button', { name: '撤销第 2 条' }).click();
    assert.equal(await page.locator('.decision-item').count(), 3);
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: '清空已做的决定' }).click();
    assert.equal(await page.locator('.decision-item').count(), 3);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '清空已做的决定' }).click();
    assert.equal(await page.locator('.decision-item').count(), 0);
  });

  test(`${name}: all added readings fit touch screens and decisions can be made and exported`, async (t) => {
    for (const viewport of [mobile, { width: 320, height: 568 }]) {
      const { page } = await openReading(t, name, 'map', { viewport, hasTouch: true, isMobile: true });
      for (const mode of modes) {
        await openMode(page, mode, true);
        assert.equal((await state(page)).mode, mode);
        const report = await page.evaluate(() => {
          const content = document.querySelector('#view-content');
          const active = [...document.querySelectorAll('#readings button, .reading-page :is(button, select, a)')];
          const small = active.filter((el) => !el.disabled && !el.classList.contains('inline-reference') &&
            el.getClientRects().length && (el.getBoundingClientRect().width < 44 ||
              el.getBoundingClientRect().height < 44)).map((el) => el.textContent);
          return { overflow: content.scrollWidth > content.clientWidth ||
            document.documentElement.scrollWidth > innerWidth, small };
        });
        assert.deepEqual(report, { overflow: false, small: [] }, viewport.width + ' ' + mode);
      }
      await makeDecisions(page, true);
      assert.equal((await downloadDecisions(page, true)).data.items.length, 4);
    }
  });

  if (name !== 'chromium') continue;

  test('chromium: exported decisions write back to the clinic through the CLI', async (t) => {
    const temp = await mkdtemp(join(tmpdir(), 'arkigo-decisions-'));
    t.after(() => rm(temp, { recursive: true, force: true }));
    const dir = join(temp, 'docs', 'arkigo');
    await mkdir(dir, { recursive: true });
    await cp(new URL('design.json', clinicDir), join(dir, 'design.json'));
    await cp(new URL('assets/', clinicDir), join(dir, 'assets'), { recursive: true });
    const file = join(dir, 'index.html');
    await writeFile(file, buildPage(input));
    const source = pathToFileURL(file).href;
    const { page } = await openPage(t, browsers.get(name), source + '#/decisions/clinic');
    await makeDecisions(page, false, source);
    assert.match(await tab(page, 'decisions').getAttribute('aria-label'), /2 项/);
    const { data, path } = await downloadDecisions(page);
    const script = fileURLToPath(new URL('../../scripts/arkigo.mjs', import.meta.url));
    const { stdout } = await exec(process.execPath,
      [script, 'change', '--dir', dir, '--root', temp, '--from-decisions', path, '--reason', '用户在页面上拍板']);
    const report = JSON.parse(stdout);
    assert.equal(report.applied, 3);
    assert.deepEqual(report.page, { ok: true, path: 'docs/arkigo/index.html' });
    assert.deepEqual(report.decisions.comments, [{ op: 'comment', id: 'appointment', text: literal }]);
    const design = JSON.parse(await readFile(join(dir, 'design.json'), 'utf8'));
    const objects = indexDesign(design).objects;
    assert.equal(objects.get('cancelled-reminder').status, 'accepted');
    assert.equal(objects.get('late-policy').status, 'retired');
    assert.equal(objects.get('waitlist').status, 'accepted');
    assert.equal(objects.get('waitlist').body.chosen, 1);
    assert.equal(objects.get('waitlist').body.rationale, '前台确认后通知');
    assert.equal(data.base, input.rev);
    await page.reload();
    assert.equal(await pending(page, 'waitlist').count(), 0);
    assert.equal(await page.locator('.decision-row').count(), 2);
    assert.match(await tab(page, 'decisions').getAttribute('aria-label'), /2 项/);
    assert.equal(await page.locator('.decision-item').count(), 1);
    assert.ok((await page.locator('.decision-item').textContent()).includes(literal));
    const after = await downloadDecisions(page);
    assert.deepEqual(after.data.items, [{ op: 'comment', id: 'appointment', text: literal }]);
    await page.locator('#rev').click();
    await page.locator('.change-record').filter({ hasText: '用户在页面上拍板' }).click();
    const changed = page.locator('.change-entry').filter({
      has: page.locator('button[data-object="waitlist"]')
    });
    const labels = await changed.locator('.field-path').allTextContents();
    assert.ok(labels.includes('结论'));
    assert.ok(labels.includes('设计状态'));
  });

  test('chromium: copy writes the exact instruction to clipboard and keeps queued actions', async (t) => {
    const { page } = await openReading(t, name, 'decisions', { permissions: ['clipboard-read', 'clipboard-write'] });
    await makeDecisions(page);
    const { data } = await downloadDecisions(page);
    const entries = data.items.map((item) => ({ item, rev: data.base }));
    const expected = decisionPrompt(index, entries, input.rev, input.designDir);
    await page.getByRole('button', { name: '复制给 AI' }).click();
    await page.locator('#decision-feedback').getByText('已复制').waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected);
    assert.equal(await page.locator('.decision-item').count(), 4);
  });

  test('chromium: keyboard can filter, decide and export with visible focus', async (t) => {
    const { page } = await openReading(t, name, 'inventory', { reducedMotion: 'reduce' });
    async function focus(selector) {
      for (let i = 0; i < 100; i++) {
        await page.keyboard.press('Tab');
        const match = await page.evaluate((value) => document.activeElement.matches(value), selector);
        if (match) return;
      }
      assert.fail('Could not reach ' + selector);
    }
    await focus('.inventory-page select');
    assert.ok(await page.locator(':focus').evaluate((el) => el.matches(':focus-visible')));
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await page.getByLabel('设计状态').inputValue(), 'proposed');
    await focus('#readings [data-mode="decisions"]');
    await page.keyboard.press('Enter');
    await focus('.decision-row[data-id="cancelled-reminder"] .reading-actions button');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.decision-item').count(), 1);
    await focus('.decision-queue .reading-actions button:nth-child(2)');
    const file = page.waitForEvent('download');
    await page.keyboard.press('Enter');
    assert.equal((await file).suggestedFilename(), 'decisions.json');
  });

  test('chromium: dark reading text meets 4.5:1 and empty views provide next steps', async (t) => {
    const { page } = await openReading(t, name, 'inventory', { colorScheme: 'dark' });
    for (const mode of modes) {
      await page.goto(url + '#/' + mode + '/clinic');
      await waitForView(page, 'clinic', { mode });
      const contrast = await page.locator('.reading-page').evaluate((reading) => {
        const rgb = (color) => color.match(/[\d.]+/g).map(Number);
        const light = ([r, g, b]) => [r, g, b].map((value) => value / 255).map((value) =>
          value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
          .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
        return [...reading.querySelectorAll('h2, h3, p, td, th, a, button, time, code, .progress-bar span')]
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
      assert.deepEqual(contrast, [], mode);
    }
    const empty = await writePage(t, pageInput(createBoundaries().empty));
    for (const mode of modes) {
      await page.goto(empty + '#/' + mode + '/empty');
      assert.ok(await page.locator('.reading-empty svg').isVisible());
    }
  });
}
