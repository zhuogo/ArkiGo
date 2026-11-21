import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { generateDesign } from '../core/generate.mjs';
import { add, data, openPage, project, state, update } from './helpers.mjs';

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

const read = async path => JSON.parse(await readFile(path, 'utf8'));
const point = ({ x, y }) => ({ x, y });
const snapshot = async path => ({ bytes: await readFile(path), mtime: (await stat(path, { bigint: true })).mtimeNs });

test('01 init creates an offline page whose visible title and revision match query', async t => {
  const area = await project(t);
  const init = await area.init();
  assert.deepEqual(init.page, { ok: true, path: 'docs/arkigo/index.html' });
  const { page, errors, requests } = await openPage(t, browser, area.html);
  const query = await area.run(['query']);
  assert.equal(await page.title(), '邻里下单 · ArkiGo');
  assert.equal(await page.locator('#project-name').innerText(), query.project.title);
  assert.equal(await page.locator('#rev').innerText(), query.rev);
  assert.equal(query.rev, init.rev);
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
});

test('02 change regenerates deep links, relations, revision and embedded history', async t => {
  const area = await project(t);
  await area.init();
  const previous = await area.change([update('shop', { summary: '邻里下单说明' })]);
  const relations = [
    { from: 'place-order', to: 'order', type: 'writes' },
    { from: 'place-order#confirm', to: 'one-pickup', type: 'governed_by' },
  ];
  const result = await area.change([
    add('checkout', 'module', '结算服务', { responsibilities: ['生成订单'] }),
    add('place-order', 'flow', '提交订单', {
      start: 'confirm', ends: ['confirm'], steps: [{ id: 'confirm', title: '确认下单', action: '写入订单记录' }],
    }, 'checkout'),
    add('order', 'entity', '订单记录', { fields: [{ name: 'pickupCode', type: 'string' }] }, 'checkout'),
    add('one-pickup', 'rule', '自提规则', { constraint: '每单限一个自提点' }, 'checkout'),
    ...relations.map(relation => ({ op: 'link', relation })),
  ]);
  assert.deepEqual(result.page, { ok: true, path: 'docs/arkigo/index.html' });
  const { page, navigate } = await openPage(t, browser, area.html, '#/map/checkout');
  assert.equal(await page.locator('#view-title').innerText(), '结算服务');
  await page.locator('#view-detail').click();
  assert.match(await page.locator('#detail').innerText(), /生成订单/);
  await navigate('#/flow/place-order');
  assert.equal(await page.locator('#view-title').innerText(), '提交订单');
  assert.match(await page.locator('#world').innerText(), /确认下单/);
  await navigate('#/map/order');
  assert.equal(await page.locator('#detail-title').innerText(), '订单记录');
  assert.match(await page.locator('#detail').innerText(), /pickupCode/);
  assert.ok(await page.locator('#detail a[href="#/flow/place-order"]').isVisible());
  await navigate('#/map/one-pickup');
  assert.equal(await page.locator('#detail-title').innerText(), '自提规则');
  assert.match(await page.locator('#detail').innerText(), /每单限一个自提点/);
  assert.equal(await page.locator('#rev').innerText(), result.rev);
  const input = await data(page);
  assert.deepEqual(input.design.relations, relations);
  assert.deepEqual(input.history, await Promise.all([result, previous].map(row => read(join(area.root, row.history)))));
});

test('03 dry runs, no-ops and validation failures preserve published files', async t => {
  const area = await project(t);
  await area.init();
  const committed = await area.change([update('shop', { summary: '当前设计' })]);
  const design = join(area.dir, 'design.json');
  const history = join(area.dir, 'history');
  const record = join(area.root, committed.history);
  const paths = [design, record, area.html];
  const before = await Promise.all(paths.map(snapshot));
  const files = await readdir(history);
  const dry = await area.change([update('shop', { summary: '预览' })], ['--dry-run']);
  assert.equal(dry.dryRun, true);
  assert.notEqual(dry.rev, committed.rev);
  const noop = await area.change([update('shop', { summary: '当前设计' })]);
  assert.equal(noop.rev, committed.rev);
  assert.equal(dry.page, undefined);
  assert.equal(noop.page, undefined);
  const invalid = await area.change([add('x', 'module', '断开的对象', {}, 'absent', {
    notes: [{ type: 'text', text: '[[missing]]' }],
  })], [], { code: 1 });
  assert.equal(invalid.code, 'VALIDATION_FAILED');
  assert.deepEqual(invalid.errors.map(row => row.code).sort(), ['PARENT_NOT_FOUND', 'REFERENCE_NOT_FOUND']);
  assert.deepEqual(await Promise.all(paths.map(snapshot)), before);
  assert.deepEqual(await readdir(history), files);
  const { page } = await openPage(t, browser, area.html);
  assert.equal(await page.locator('#rev').innerText(), committed.rev);

});

test('04 evidence statuses in verify, render and the details agree', async t => {
  const area = await project(t);
  await area.init();
  const path = 'orders.js';
  const file = join(area.root, path);
  await writeFile(file, 'initial code\n');
  await area.change([
    add('orders', 'module', '订单服务', {}, 'shop', { sources: [{ kind: 'file', ref: path }] }),
    { op: 'implement', id: 'orders', status: 'implemented', evidence: [{ path, symbol: 'orders' }] },
  ]);
  const open = () => openPage(t, browser, area.html, '#/map/orders');
  const check = async (expected, labels, code, rendered) => {
    const verify = await area.run(['verify'], { code });
    const { page } = await open();
    await page.locator('#view-detail').click();
    const input = await data(page);
    assert.equal(input.rev, verify.rev);
    assert.deepEqual(input.evidence.orders.map(row => row.state), expected);
    assert.deepEqual(input.evidence.orders, verify.evidence.map(({ of, path, state }) => ({ of, path, state })));
    assert.deepEqual(await page.locator('#detail .evidence-status').allTextContents(), labels);
    if (rendered) {
      assert.deepEqual(rendered.evidence, {
        ok: expected.filter(state => state === 'ok').length,
        changed: expected.filter(state => state === 'changed').length,
        missing: expected.filter(state => state === 'missing').length,
        unrecorded: 0,
      });
      assert.equal(rendered.bytes, (await stat(area.html)).size);
    }
  };
  await check(['ok', 'ok'], ['正常', '正常'], 0);
  await writeFile(file, 'new code\n');
  await check(['changed', 'ok'], ['内容已变', '正常'], 1, await area.run(['render']));
  await rm(file);
  await check(['missing', 'missing'], ['文件缺失', '文件缺失'], 1, await area.run(['render']));
  const refused = await area.change([{ op: 'confirm-evidence', id: 'orders' }], [], { code: 1 });
  assert.equal(refused.code, 'EVIDENCE_MISSING');
  await writeFile(file, 'restored code\n');
  assert.ok((await area.change([{ op: 'confirm-evidence', id: 'orders' }])).page.ok);
  await check(['ok', 'ok'], ['正常', '正常'], 0);
});

test('05 editor paths are encoded, carried forward only at the same project root and cleared on request', async t => {
  const area = await project(t);
  await area.init();
  const name = '订单 收据.js';
  await writeFile(join(area.root, name), 'export const order = 1;\n');
  await area.change([add('orders', 'module', '订单', {}, 'shop', { sources: [{ kind: 'file', ref: name }] })]);
  const check = async (html, editor, root = area.root) => {
    const { page } = await openPage(t, browser, html, '#/map/orders');
    await page.locator('#view-detail').click();
    const input = await data(page);
    const links = page.locator('#detail a.source-path');
    assert.equal(input.editor, editor);
    if (editor) {
      assert.equal(input.projectRoot, root);
      const href = await links.getAttribute('href');
      const url = new URL(href);
      assert.equal(url.protocol, editor + ':');
      assert.equal(url.hostname, 'file');
      assert.equal(decodeURIComponent(url.pathname), join(root, name).replaceAll('\\', '/').replace(/^([^/])/, '/$1'));
      assert.match(href, /%20/);
      assert.match(href, /%[A-F0-9]{2}%[A-F0-9]{2}/);
      assert.doesNotMatch(href, /[\u4e00-\u9fff ]/u);
    } else {
      assert.equal(Object.hasOwn(input, 'projectRoot'), false);
      assert.equal(await links.count(), 0);
      const source = await readFile(html, 'utf8');
      assert.equal(source.includes(root), false);
      assert.equal(source.includes(area.root), false);
    }
  };
  await check(area.html, null);
  for (const editor of ['vscode', 'cursor']) {
    const rendered = await area.run(['render', '--editor', editor]);
    assert.equal(rendered.path, 'docs/arkigo/index.html');
    await check(area.html, editor);
  }
  await area.change([update('orders', { summary: '沿用编辑器' })]);
  await check(area.html, 'cursor');
  await area.run(['render']);
  await check(area.html, null);
  await area.run(['render', '--editor', 'cursor']);
  await writeFile(area.html, '<!doctype html><html>broken</html>');
  await area.change([update('orders', { summary: '坏页面回退' })]);
  await check(area.html, null);
  await area.run(['render', '--editor', 'cursor']);
  const moved = join(area.temp, '移走的项目');
  await rename(area.root, moved);
  await area.change([update('orders', { summary: '新路径' })], [], { cwd: moved });
  await check(join(moved, 'docs', 'arkigo', 'index.html'), null, moved);
});

test('06 drag, export, CLI import and reset update layout in fresh browser contexts', async t => {
  const area = await project(t);
  await area.init();
  const change = await area.change([add('orders', 'module', '订单')]);
  const { page } = await openPage(t, browser, area.html);
  const initial = point((await state(page)).cards[0]);
  const { x, y, width, height } = await page.locator('#world .graph-card[data-id="orders"]').boundingBox();
  const startX = x + width / 2, startY = y + height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 45, startY + 35, { steps: 6 });
  await page.mouse.up();
  const dragged = point((await state(page)).cards[0]);
  assert.notDeepEqual(dragged, initial);
  const pending = page.waitForEvent('download', { timeout: 5000 });
  await page.locator('#export').click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), 'layout.json');
  const imported = join(area.root, 'layout-export.json');
  await download.saveAs(imported);
  assert.deepEqual(await read(imported), { format: 'arkigo-layout/2', views: { shop: { orders: dragged } } });
  await area.run(['render', '--editor', 'vscode']);
  assert.ok((await area.run(['layout', 'import', imported])).page.ok);
  const importedPage = (await openPage(t, browser, area.html)).page;
  assert.equal((await data(importedPage)).editor, 'vscode');
  assert.deepEqual(point((await state(importedPage)).cards[0]), dragged);
  assert.ok((await area.run(['layout', 'reset'])).page.ok);
  const reset = (await openPage(t, browser, area.html)).page;
  assert.equal((await data(reset)).layout, null);
  assert.equal((await data(reset)).editor, 'vscode');
  assert.deepEqual(point((await state(reset)).cards[0]), initial);
  assert.equal(await reset.locator('#rev').innerText(), change.rev);
  assert.deepEqual(await readdir(join(area.dir, 'history')), [change.history.split('/').at(-1)]);
});

test('07 a referenced asset image really loads from disk', async t => {
  const area = await project(t);
  await area.init();
  await writeFile(join(area.dir, 'assets', '订单 原型.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12"/></svg>');
  await area.change([add('order-screen', 'screen', '订单页面', { media: [{ path: '订单 原型.svg' }] })]);
  const { page, requests, errors } = await openPage(t, browser, area.html, '#/map/order-screen');
  const image = page.locator('#detail img');
  await image.waitFor({ state: 'visible' });
  assert.equal(await image.evaluate(element => element.naturalWidth), 16);
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
});

test('08 explicit dir and root control the output path and embedded design directory', async t => {
  const relative = 'designs/架构 图';
  const area = await project(t, relative);
  const flags = ['--dir', relative, '--root', '.'];
  const init = await area.init(flags);
  const rendered = await area.run(['render', ...flags]);
  assert.equal(rendered.path, relative + '/index.html');
  assert.equal(init.page.path, rendered.path);
  await assert.rejects(stat(join(area.root, 'docs', 'arkigo', 'index.html')), { code: 'ENOENT' });
  const { page } = await openPage(t, browser, area.html);
  assert.equal((await data(page)).designDir, relative);
  assert.equal((await data(page)).rev, rendered.rev);
});

test('09 a failed page write leaves committed design and history available for render to retry', async t => {
  const area = await project(t);
  await mkdir(area.html, { recursive: true });
  const init = await area.init();
  assert.equal(init.page.ok, false);
  const changed = await area.change([add('orders', 'module', '已保存的订单')]);
  assert.equal(changed.ok, true);
  assert.equal(changed.page.ok, false);
  assert.match(changed.page.error, /render/);
  assert.equal((await area.run(['query'])).rev, changed.rev);
  assert.equal((await read(join(area.root, changed.history))).result, changed.rev);
  assert.equal((await area.run(['render'], { code: 2 })).code, 'IO_ERROR');
  assert.deepEqual((await readdir(area.dir)).sort(), ['assets', 'design.json', 'history', 'index.html']);
  await rm(area.html, { recursive: true });
  assert.equal((await area.run(['render'])).rev, changed.rev);
  const { page } = await openPage(t, browser, area.html, '#/map/orders');
  assert.equal(await page.locator('#view-title').innerText(), '已保存的订单');
});

test('10 concurrent changes and render leave one current revision, complete history and no lock', async t => {
  const area = await project(t);
  await area.init();
  const ids = ['apple', 'banana', 'cherry', 'date'];
  const results = await Promise.all([
    ...ids.map(id => area.change([add(id, 'module', id)])),
    area.run(['render']),
    area.change([add('conflict', 'module', '旧版本')], ['--base', '000000000000'], { code: 3 }),
  ]);
  assert.equal(results.at(-1).code, 'BASE_CONFLICT');
  const query = await area.run(['query']);
  assert.deepEqual(query.items.map(row => row.id).sort(), [...ids].sort());
  const { page } = await openPage(t, browser, area.html);
  assert.equal(await page.locator('#rev').innerText(), query.rev);
  const input = await data(page);
  assert.deepEqual(input.design.objects.map(row => row.id).sort(), [...ids, 'shop'].sort());
  const successful = results.slice(0, ids.length);
  assert.deepEqual(input.history.map(row => row.result).sort(), successful.map(row => row.rev).sort());
  assert.equal(input.history[0].result, query.rev);
  assert.ok(successful.every(row => row.page.ok));
  assert.deepEqual((await readdir(area.dir)).sort(), ['assets', 'design.json', 'history', 'index.html']);
  assert.deepEqual((await readdir(join(area.dir, 'history'))).sort(),
    successful.map(row => row.history.split('/').at(-1)).sort());
});

test('11 a 500-object, 800-relation design renders after a CLI change', async t => {
  const area = await project(t);
  const design = generateDesign();
  await area.run(['init', '--id', design.id, '--title', design.title, '--no-rules']);
  const { body, summary } = design.objects[0];
  await area.change([
    update(design.id, { body, summary }),
    ...design.objects.slice(1).map(object => ({ op: 'add', object })),
    ...design.relations.map(relation => ({ op: 'link', relation })),
  ]);
  const changed = await area.change([update('module-1-000', { summary: '规模样例实测' })]);
  assert.ok(changed.page.ok);
  const { page } = await openPage(t, browser, area.html, '#/map/module-1-000');
  const input = await data(page);
  assert.equal(input.design.objects.length, 500);
  assert.equal(input.design.relations.length, 800);
  assert.equal(await page.locator('#rev').innerText(), changed.rev);
  assert.equal(await page.locator('#view-summary').innerText(), '规模样例实测');
});
