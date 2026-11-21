import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { overlaps } from '../../assets/layout.mjs';
import { clinicInput, pageInput } from '../page/fixtures.mjs';
import { createBoundaries, createDense } from '../page/generate.mjs';
import { card, engines, mobile, openPage, state, waitForView, writePage } from './helpers.mjs';

const browsers = new Map();
const selected = process.env.ARKIGO_BROWSERS?.split(',') ?? Object.keys(engines);
let clinicUrl;

before(async (t) => {
  for (const name of selected) browsers.set(name, await engines[name].launch());
  clinicUrl = await writePage(t, clinicInput());
});
after(async () => {
  await Promise.all([...browsers.values()].map((browser) => browser.close()));
});

const within = (inner, outer) => inner.x >= outer.x - 1 && inner.y >= outer.y - 1 &&
  inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1;
const position = ({ x, y }) => ({ x, y });

async function assertTouchTargets(page, selector, label) {
  const targets = await page.locator(selector).evaluateAll((elements) => {
    return elements.flatMap((element) => {
      if (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') return [];
      const box = element.getBoundingClientRect().toJSON();
      const name = element.getAttribute('aria-label') || element.textContent.trim() || element.id;
      const clip = { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const bounds = parent.getBoundingClientRect();
        if (style.overflowX !== 'visible') {
          clip.left = Math.max(clip.left, bounds.left + parent.clientLeft);
          clip.right = Math.min(clip.right, bounds.left + parent.clientLeft + parent.clientWidth);
        }
        if (style.overflowY !== 'visible') {
          clip.top = Math.max(clip.top, bounds.top + parent.clientTop);
          clip.bottom = Math.min(clip.bottom, bounds.top + parent.clientTop + parent.clientHeight);
        }
      }
      const x = (box.left + box.right) / 2;
      const y = (box.top + box.bottom) / 2;
      const points = [[x, y], [box.left + 1, y], [box.right - 1, y], [x, box.top + 1], [x, box.bottom - 1]];
      const covered = points.filter(([x, y]) => x >= clip.left && x < clip.right &&
        y >= clip.top && y < clip.bottom && !element.contains(document.elementFromPoint(x, y)));
      const visible = {
        left: Math.max(box.left, clip.left), right: Math.min(box.right, clip.right),
        top: Math.max(box.top, clip.top), bottom: Math.min(box.bottom, clip.bottom)
      };
      return [{ name, box, covered, visible }];
    });
  });
  assert.ok(targets.length, label);
  for (const [i, { name, box, covered, visible }] of targets.entries()) {
    assert.ok(box.width >= 43.99 && box.height >= 43.99, `${label} / ${name}: ${box.width}×${box.height}`);
    assert.deepEqual(covered, [], `${label} / ${name}: target is covered`);
    for (const other of targets.slice(i + 1)) {
      const intersectionWidth = Math.min(visible.right, other.visible.right) -
        Math.max(visible.left, other.visible.left);
      const intersectionHeight = Math.min(visible.bottom, other.visible.bottom) -
        Math.max(visible.top, other.visible.top);
      assert.ok(intersectionWidth <= 0.02 || intersectionHeight <= 0.02, `${label}: ${name} / ${other.name}`);
    }
  }
}

for (const name of selected) {
  const open = (t, hash = '', options, url = clinicUrl) => openPage(t, browsers.get(name), url + hash, options);

  test(`${name}: offline roadmap has three regions and a read-only snapshot`, async (t) => {
    const { page, errors, requests } = await open(t);
    const initial = await state(page);
    assert.equal(initial.viewId, 'clinic');
    assert.equal(initial.mode, 'map');
    assert.equal(initial.cards.length, 5);
    const canvas = await page.locator('#viewport').boundingBox();
    for (const { id } of initial.cards) assert.ok(within(await card(page, id).boundingBox(), canvas), id);
    assert.deepEqual(await page.locator('.topbar + #workspace #reading > *').evaluateAll((regions) =>
      regions.map(({ id }) => id)), ['viewport', 'controls']);
    assert.equal(await page.locator('#crumbs [aria-current]').innerText(), '青禾诊所');
    assert.equal(await page.locator('#brand-icon, #rev, .view-heading, #readings, #controls #enter, #controls #inspect').count(), 0);
    assert.doesNotMatch(await page.locator('#world').innerText(), /未核对|已实现|待实现|部分实现/);
    const clone = await page.evaluate(() => {
      const result = window.arkigoCanvas.getState();
      result.cards.pop();
      return window.arkigoCanvas.getState().cards.length;
    });
    assert.equal(clone, initial.cards.length);
    const merged = page.locator('#world button.edge-label', { hasText: '×' }).first();
    await merged.click();
    assert.equal((await state(page)).panel, 'relations');
    assert.ok(await page.locator('#browse-body .relation-row').count() > 1);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
  });

  test(`${name}: only main lines are drawn until a card is selected, a pair of cards shares one line`, async (t) => {
    const design = createDense();
    for (const item of design.objects.filter(({ type }) => type === 'module')) {
      item.group = ['a', 'c'].includes(item.id) ? '业务' : '服务';
    }
    const url = await writePage(t, pageInput(design));
    const { page, errors } = await open(t, '', undefined, url);
    const shown = () => page.locator('#world .graph-edge').evaluateAll((lines) => lines
      .filter((line) => getComputedStyle(line).visibility === 'visible')
      .map((line) => [line.dataset.from, line.dataset.to].sort().join('/')).sort());
    assert.equal(await page.locator('#world .graph-edge').count(), 6);
    assert.deepEqual(await shown(), ['a/b', 'b/c', 'c/d']);
    assert.match(await page.locator('#hint').innerText(), /主要关系/);
    const both = page.locator('#world .graph-edge[data-from="a"][data-to="b"]');
    assert.ok(await both.getAttribute('marker-start') && await both.getAttribute('marker-end'));
    const label = page.locator('#world button.edge-label', { hasText: '×3' });
    const hues = () => page.locator('#world .graph-edge').evaluateAll((lines) => {
      const stroke = (line) => getComputedStyle(line).stroke;
      return Object.fromEntries(lines.map((line) => [line.dataset.from + '/' + line.dataset.to, stroke(line)]));
    });
    const colorsMatch = () => label.evaluate((tag) => {
      const world = document.querySelector('#world');
      const path = [...world.querySelectorAll('.graph-edge')].find((line) =>
        line.dataset.from === tag.dataset.from && line.dataset.to === tag.dataset.to);
      const marker = world.querySelector(path.getAttribute('marker-end').slice(4, -1));
      const stroke = getComputedStyle(path).stroke;
      const expected = document.createElement('span');
      const tint = tag.matches(':hover, :focus-visible, .edge-selected') ? 24 : 16;
      expected.style.backgroundColor = 'color-mix(in srgb, ' + stroke + ' ' + tint + '%, transparent)';
      world.append(expected);
      const match = getComputedStyle(tag).backgroundColor === getComputedStyle(expected).backgroundColor &&
        getComputedStyle(marker.firstElementChild).stroke === stroke;
      expected.remove();
      return match;
    });
    const light = await hues();
    assert.equal(new Set(Object.values(light)).size, 6);
    assert.ok(await colorsMatch());
    await label.hover();
    assert.match(await both.getAttribute('class'), /edge-emphasized/);
    assert.ok(await colorsMatch());
    await page.locator('#theme').click();
    const dark = await hues();
    assert.equal(new Set(Object.values(dark)).size, 6);
    assert.notDeepEqual(dark, light);
    assert.ok(await colorsMatch());
    // Follow the same SVG path inside each partition and through the gap between their frames.
    const partitions = await both.evaluate((line) => {
      const zones = [...document.querySelectorAll('#world .graph-zone')];
      const layer = getComputedStyle(line.ownerSVGElement);
      if (layer.overflow !== 'visible' || zones.some((zone) =>
        Number(getComputedStyle(zone).zIndex) >= Number(layer.zIndex))) return [];
      const boxes = zones.map((zone) => ({ x: zone.offsetLeft, y: zone.offsetTop,
        right: zone.offsetLeft + zone.offsetWidth, bottom: zone.offsetTop + zone.offsetHeight }));
      const sequence = [];
      for (let length = 0; length <= line.getTotalLength(); length += 2) {
        const point = line.getPointAtLength(length);
        const zone = boxes.findIndex(({ x, y, right, bottom }) =>
          point.x > x && point.x < right && point.y > y && point.y < bottom);
        if (sequence.at(-1) !== zone) sequence.push(zone);
      }
      return sequence;
    });
    assert.equal(partitions.length, 3);
    assert.equal(partitions[1], -1);
    assert.deepEqual([partitions[0], partitions[2]].sort(), [0, 1]);
    await card(page, 'a').click();
    assert.equal((await state(page)).detail, 'a');
    assert.deepEqual(await shown(), ['a/b', 'a/c', 'a/d', 'b/c', 'c/d']);
    assert.deepEqual(await hues(), dark);
    assert.ok(await colorsMatch());
    assert.equal(await page.locator('#hint').isVisible(), false);
    await label.click();
    assert.equal(await page.locator('#browse-title').innerText(), '模块 A 与 模块 B · 3 条关系');
    assert.equal(await page.locator('#browse-body .relation-row').count(), 3);
    assert.deepEqual(errors, []);
  });

  test(`${name}: a module shows its purpose and files and can be entered from the title`, async (t) => {
    const { page } = await open(t);
    await card(page, 'booking').click();
    assert.deepEqual({ selected: (await state(page)).selected, detail: (await state(page)).detail },
      { selected: 'booking', detail: 'booking' });
    const detail = page.locator('#detail');
    assert.deepEqual(await detail.locator('h3').allTextContents(), ['模块作用', '关联文件']);
    assert.match(await detail.locator('[data-field="purpose"]').innerText(), /管理医生排班.*锁定号源并写入预约单/s);
    assert.deepEqual(await detail.locator('.source-path').allTextContents(), ['src/booking/reserve.ts']);
    assert.equal(await detail.locator('.detail-meta').count(), 0);
    await detail.locator('.module-detail-title').getByRole('button', { name: '进入模块' }).click();
    await waitForView(page, 'booking');
    assert.equal(await page.locator('#crumbs').isVisible(), true);
    assert.deepEqual(await page.locator('#crumbs .crumb').allTextContents(), ['青禾诊所', '预约服务']);
    await page.locator('#view-detail').click();
    assert.equal((await state(page)).detail, 'booking');
    await page.locator('#crumbs button').first().click();
    await waitForView(page, 'clinic', { mode: 'map' });
  });

  test(`${name}: enter, breadcrumb and browser back/forward restore selection and camera`, async (t) => {
    const { page } = await open(t);
    const booking = card(page, 'booking');
    await booking.click();
    await page.locator('#detail').getByRole('button', { name: '关闭详情' }).click();
    await page.locator('#viewport').press('ArrowLeft');
    const before = await state(page);
    await page.locator('#viewport').press('Enter');
    await waitForView(page, 'booking');
    assert.ok(page.url().endsWith('#/map/booking'));
    await page.goBack();
    await waitForView(page, 'clinic', { selected: 'booking' });
    assert.deepEqual((await state(page)).camera, before.camera);
    await page.goForward();
    await waitForView(page, 'booking');
    await page.locator('#crumbs button').first().click();
    await waitForView(page, 'clinic', { selected: 'booking' });
    assert.deepEqual((await state(page)).camera, before.camera);
    const { page: direct } = await open(t, '#/map/booking');
    assert.equal((await state(direct)).viewId, 'booking');
  });

  test(`${name}: flow conditions, feedback loop, and step deep links`, async (t) => {
    const { page, errors } = await open(t, '#/map/reserve');
    await card(page, 'make-booking').dblclick();
    await waitForView(page, 'make-booking', { mode: 'flow' });
    for (const label of ['还有名额', '号源已满', '改选时段后重试', '退出预约']) {
      assert.ok(await page.locator('#world .edge-label').getByText(label, { exact: true }).isVisible());
    }
    assert.equal(await page.locator('#world .graph-edge.back-edge').count(), 1);
    const retry = card(page, 'make-booking#retry');
    assert.match(await retry.innerText(), /患者.*失败处理/s);
    assert.ok(await card(page, 'make-booking#lock').locator('.card-count').count() >= 2);
    const { page: direct } = await open(t, '#/flow/make-booking#retry');
    await waitForView(direct, 'make-booking', { selected: 'make-booking#retry', detail: 'make-booking#retry' });
    assert.match(await direct.locator('#detail').innerText(), /释放本次临时占位/);
    assert.deepEqual(errors, []);
  });

  test(`${name}: zoom enters and returns with the previous selection`, async (t) => {
    const { page } = await open(t);
    await card(page, 'booking').click();
    for (let i = 0; i < 12 && (await state(page)).viewId === 'clinic'; i++) {
      await page.locator('#zoom-in').click();
    }
    await waitForView(page, 'booking');
    for (let i = 0; i < 8 && (await state(page)).viewId === 'booking'; i++) {
      await page.locator('#zoom-out').click();
    }
    await waitForView(page, 'clinic', { selected: 'booking' });
    assert.ok(within(await card(page, 'booking').boundingBox(), await page.locator('#viewport').boundingBox()));
  });

  test(`${name}: overlay details, cross-level references, relationships, and evidence links`, async (t) => {
    const url = await writePage(t, clinicInput({ editor: 'vscode', projectRoot: '/a project' }));
    const { page, errors } = await open(t, '#/map/appointment', {}, url);
    await waitForView(page, 'reserve', { detail: 'appointment' });
    const canvas = await page.locator('#viewport').boundingBox();
    const panel = await page.locator('#detail').boundingBox();
    assert.ok(canvas.x < panel.x && panel.x + panel.width <= canvas.x + canvas.width);
    assert.equal(panel.y + panel.height, canvas.y + canvas.height);
    const detail = page.locator('#detail');
    assert.equal(await detail.evaluate((element) => getComputedStyle(element).scrollbarWidth), 'none');
    assert.equal(await detail.getByText('已接受', { exact: true }).count(), 0);
    const camera = (await state(page)).camera;
    await detail.getByRole('button', { name: '关闭详情' }).click();
    assert.deepEqual(await page.locator('#viewport').boundingBox(), canvas);
    assert.deepEqual((await state(page)).camera, camera);
    await card(page, 'appointment').click();
    assert.deepEqual(await page.locator('#viewport').boundingBox(), canvas);
    assert.deepEqual((await state(page)).camera, camera);
    assert.ok(within(await card(page, 'appointment').boundingBox(), canvas));
    const statuses = await page.locator('#detail .evidence-row .check-status').evaluateAll((marks) =>
      marks.map((mark) => mark.getAttribute('aria-label')));
    assert.deepEqual(statuses, ['正常', '正常']);
    const editorUrl = await page.locator('#detail .source-path').first().getAttribute('href');
    assert.match(editorUrl, /^vscode:\/\/file\/a%20project/);
    assert.ok(await page.getByRole('button', { name: '复制路径' }).first().isVisible());
    await page.locator('#detail [data-field="fields"] a').first().click();
    await waitForView(page, 'schedule', { selected: 'slot', detail: 'slot' });
    await page.goto(url + '#/map/appointment');
    await waitForView(page, 'reserve', { detail: 'appointment' });
    const link = page.locator('#detail .relation-row a').filter({ hasText: '确认预约成功' });
    await link.click();
    await waitForView(page, 'make-booking', { mode: 'flow', selected: 'make-booking#confirm' });
    await page.goto(url + '#/map/reserve-api');
    await waitForView(page, 'reserve', { detail: 'reserve-api' });
    assert.deepEqual(await page.locator('#detail .evidence-row .check-status').evaluateAll((marks) =>
      marks.map((mark) => mark.getAttribute('aria-label'))), ['内容已变', '文件缺失', '待核对']);
    assert.deepEqual(errors, []);
  });

  test(name + ': editor links normalize project-relative evidence paths', async (t) => {
    const input = clinicInput({ editor: 'vscode', projectRoot: '/a project' });
    const paths = [
      'src/../src/./文件.js', 'src\\子目录\\..\\带 空格.js', 'src/../../outside.js',
      '/absolute.js', 'C:\\absolute.js', '\\\\server\\share\\absolute.js'
    ];
    const object = input.design.objects.find(({ id }) => id === 'appointment');
    object.sources = paths.map((ref) => ({ kind: 'file', ref }));
    const url = await writePage(t, input);
    const { page } = await open(t, '#/map/appointment', {}, url);
    const links = page.locator('#detail .source-path');
    assert.deepEqual(await links.evaluateAll((items) => items.slice(-6).map((item) => ({
      path: item.textContent, href: item.getAttribute('href')
    }))), paths.map((path, i) => ({
      path, href: [
        'vscode://file/a%20project/src/%E6%96%87%E4%BB%B6.js',
        'vscode://file/a%20project/src/%E5%B8%A6%20%E7%A9%BA%E6%A0%BC.js'
      ][i] ?? null
    })));
  });

  test(`${name}: one find panel searches, lists the contents as a tree and leads to the other pages`, async (t) => {
    const { page } = await open(t);
    await page.getByRole('button', { name: '查找' }).click();
    const tree = page.locator('#browse[data-panel="search"]');
    assert.ok(await tree.locator('.tree-list').first().isVisible());
    await page.getByRole('searchbox').fill('visit-record');
    assert.equal(await tree.locator('.tree-list').first().isVisible(), false);
    const result = page.locator('.search-result').first();
    assert.match(await result.innerText(), /青禾诊所.*问诊服务.*诊室问诊.*问诊记录/s);
    await result.click();
    await waitForView(page, 'encounter', { selected: 'visit-record' });
    await page.locator('#search-open').click();
    await tree.getByRole('button', { name: '按类型列出全部' }).click();
    await waitForView(page, 'clinic', { mode: 'inventory', selected: 'visit-record' });
    await page.goBack();
    await waitForView(page, 'encounter', { selected: 'visit-record' });
    await page.locator('#search-open').click();
    await tree.getByRole('button', { name: '展开 患者端' }).click();
    await tree.getByRole('button', { name: '展开 患者预约' }).click();
    await tree.getByRole('button', { name: '折叠 患者预约' }).click();
    assert.equal(await tree.getByRole('link', { name: '选择就诊时段' }).isVisible(), false);
    await tree.getByRole('button', { name: '展开 患者预约' }).click();
    await tree.getByRole('link', { name: '选择就诊时段' }).click();
    await waitForView(page, 'booking-ui', { selected: 'slot-picker', detail: 'slot-picker' });
    await page.waitForFunction(() => [...document.querySelectorAll('#detail img')].length === 2 &&
      [...document.querySelectorAll('#detail img')].every((image) => image.naturalWidth > 0));
  });

  test(`${name}: panning and dragging never select canvas text or outline its edges`, async (t) => {
    const { page } = await open(t, '#/map/reserve');
    const viewport = page.locator('#viewport');
    const box = await viewport.boundingBox();
    const start = await state(page);
    await page.mouse.move(box.x + 8, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 5, box.y + box.height - 5, { steps: 12 });
    assert.equal(await viewport.evaluate((element) => getComputedStyle(element).outlineStyle), 'none');
    assert.equal(await page.evaluate(() => getSelection().toString()), '');
    await page.mouse.up();
    assert.notDeepEqual((await state(page)).camera, start.camera);
    await viewport.press('0');
    const label = page.locator('#world .edge-label').first();
    assert.equal(await label.evaluate((element) => getComputedStyle(element).userSelect), 'none');
    const labelBox = await label.boundingBox();
    await page.mouse.move(labelBox.x + labelBox.width / 2, labelBox.y + labelBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 8, box.y + 8, { steps: 10 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => getSelection().toString()), '');
    await viewport.press('ArrowRight');
    assert.equal(await viewport.evaluate((element) => getComputedStyle(element).outlineStyle), 'solid');
  });

  test(`${name}: layout drag persists, exports version 2 and resets`, async (t) => {
    const { page } = await open(t, '#/map/reserve');
    const initial = await state(page);
    const id = 'make-booking';
    const box = await card(page, id).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 26, box.y + box.height / 2 + 16, { steps: 6 });
    await page.mouse.up();
    const moved = await state(page);
    assert.notDeepEqual(position(moved.cards.find((item) => item.id === id)),
      position(initial.cards.find((item) => item.id === id)));
    await page.reload();
    assert.deepEqual((await state(page)).layout, moved.layout);
    assert.deepEqual((await state(page)).cards, moved.cards);
    const downloadPromise = page.waitForEvent('download', { timeout: 5000 });
    await page.locator('#export').click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'layout.json');
    const point = position(moved.cards.find((item) => item.id === id));
    assert.deepEqual(JSON.parse(await readFile(await download.path(), 'utf8')),
      { format: 'arkigo-layout/2', views: { reserve: { [id]: point } } });
    await page.locator('#reset').click();
    assert.deepEqual((await state(page)).cards, initial.cards);
    assert.deepEqual((await state(page)).layout.views, {});
  });

  test(`${name}: vertical layout, readable titles and full-screen detail at 390 × 844`, async (t) => {
    const { page } = await open(t, '', { viewport: mobile, hasTouch: true });
    const initial = await state(page);
    assert.equal(initial.direction, 'vertical');
    assert.ok(await page.locator('#crumbs').isVisible());
    const titleSize = await page.locator('#world .card-title').first().evaluate((el) =>
      parseFloat(getComputedStyle(el).fontSize));
    assert.ok(titleSize * initial.camera.k >= 12);
    assert.ok(initial.cards.every((item) => item.x === initial.cards[0].x));
    await page.locator('#view-detail').tap();
    await page.waitForFunction(() => !document.querySelector('#detail').getAnimations().length);
    assert.deepEqual(await page.locator('#detail').boundingBox(), { x: 0, y: 0, ...mobile });
    assert.ok(await page.locator('#reading').evaluate((el) => el.inert));
    await page.locator('#detail').getByRole('button', { name: '关闭详情' }).tap();
    await page.goto(clinicUrl + '#/flow/make-booking');
    await waitForView(page, 'make-booking', { direction: 'vertical' });
    const flow = await state(page);
    assert.ok(flow.cards.every((item) => item.x === flow.cards[0].x));
    assert.ok(titleSize * flow.camera.k >= 12);
  });

  test(`${name}: touch targets are at least 44 × 44 and do not overlap`, async (t) => {
    const url = await writePage(t, clinicInput({ editor: 'vscode', projectRoot: '/a project' }));
    const panel = 'button, a[href]:not(.inline-reference), input';
    const on = (root) => `${root} :is(${panel})`;
    const map = '.topbar button, #controls button, #world button';
    for (const viewport of [mobile, { width: 320, height: 568 }]) {
      const { page } = await open(t, '', { viewport, hasTouch: true, isMobile: true }, url);
      const check = (selector, stage) => assertTouchTargets(page, selector, `${viewport.width} ${stage}`);
      await check(map, 'root map');
      await page.locator('#zoom-out').tap();
      await page.waitForFunction(() => {
        const label = document.querySelector('button.edge-label');
        return label.getBoundingClientRect().height >= 44;
      });
      await check(map, 'zoomed map');
      await page.locator('#fit').tap();
      const edge = page.locator('button.edge-label').first();
      const canvas = await page.locator('#viewport').boundingBox();
      for (let i = 0; i < 30; i++) {
        const box = await edge.boundingBox();
        if (within(box, canvas)) break;
        await page.locator('#viewport').press(box.y > canvas.y ? 'ArrowDown' : 'ArrowUp');
      }
      await check(map, 'panned map');
      await edge.tap();
      assert.equal((await state(page)).panel, 'relations');
      await check(on('#browse'), 'relation list');
      await page.locator('#browse-close').tap();

      await page.locator('#search-open').tap();
      await page.getByRole('searchbox').fill('预约');
      await check(on('#browse'), 'search');
      await page.getByRole('button', { name: '清除搜索' }).tap();
      assert.equal(await page.getByRole('searchbox').inputValue(), '');
      await page.getByRole('button', { name: '展开 预约服务' }).tap();
      await page.getByRole('button', { name: '展开 预约单管理' }).tap();
      await page.locator('.tree-object[href="#/map/appointment"]').scrollIntoViewIfNeeded();
      await check(on('#browse'), 'directory');
      await page.locator('.tree-object[href="#/map/appointment"]').tap();
      await waitForView(page, 'reserve', { detail: 'appointment' });
      await check(on('#detail'), 'data detail');
      await page.locator('#detail a.source-path').first().scrollIntoViewIfNeeded();
      await check(on('#detail'), 'data evidence');

      await page.goto(url + '#/map/booking');
      await waitForView(page, 'booking');
      await card(page, 'schedule').focus();
      await card(page, 'schedule').tap();
      await waitForView(page, 'booking', { detail: 'schedule' });
      assert.ok(await page.getByRole('button', { name: '进入模块' }).isVisible());
      await check(on('#detail'), 'module detail');

      await page.goto(url + '#/flow/make-booking');
      await waitForView(page, 'make-booking');
      assert.ok(await page.locator('span.edge-label').count());
      assert.equal(await page.locator('button.edge-label').count(), 0);
      await check(map, 'flow');
      await page.locator('#view-detail').tap();
      await page.locator('.step-links a').first().scrollIntoViewIfNeeded();
      await check(on('#detail'), 'flow detail');
    }
  });

  test(`${name}: keyboard-only reading, reduced motion and theme persisted after reload`, async (t) => {
    const { page } = await open(t, '', { reducedMotion: 'reduce' });
    let focused;
    for (let i = 0; i < 30 && focused !== 'booking'; i++) {
      await page.keyboard.press('Tab');
      focused = await page.evaluate(() => document.activeElement.dataset.id);
    }
    assert.equal(focused, 'booking');
    await page.keyboard.press('Enter');
    assert.equal((await state(page)).selected, 'booking');
    assert.equal((await state(page)).detail, 'booking');
    await page.getByRole('button', { name: '进入模块' }).press('Enter');
    await waitForView(page, 'booking');
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    await page.keyboard.press('Escape');
    await waitForView(page, 'clinic', { selected: 'booking' });
    await page.keyboard.press('/');
    await page.keyboard.type('visit-record');
    await page.keyboard.press('Enter');
    await waitForView(page, 'encounter', { selected: 'visit-record' });
    await page.locator('#theme').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.locator('#theme').click();
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  });

  if (name !== 'chromium') continue;

  test('chromium: all object bodies and notes have typed detail content', async (t) => {
    const { page, errors } = await open(t);
    const records = {
      clinic: ['system', 'audience'], patient: ['actor', 'goals'], booking: ['module', 'purpose'],
      'make-booking': ['flow', 'steps'], capacity: ['rule', 'constraint'], appointment: ['entity', 'fields'],
      'reserve-api': ['interface', 'request'], 'slot-picker': ['screen', 'media'], 'last-slot': ['acceptance', 'then'],
      waitlist: ['decision', 'chosen']
    };
    const blocks = new Set();
    for (const [id, [type, field]] of Object.entries(records)) {
      const hash = '#/' + (type === 'flow' ? 'flow/' : 'map/') + id;
      await page.goto(clinicUrl + hash);
      if (['system', 'module', 'flow'].includes(type) && (await state(page)).detail !== id) {
        await page.locator('#view-detail').click();
      }
      await page.waitForFunction((item) => window.arkigoCanvas.getState().detail === item, id);
      assert.ok(await page.locator(`#detail [data-field="${field}"]`).isVisible(), id + ': ' + field);
      const values = await page.locator('#detail [data-block]').evaluateAll((els) => els.map((el) => el.dataset.block));
      for (const value of values) blocks.add(value);
      if (type === 'entity') {
        assert.equal(await page.locator('#detail [data-field="fields"] tbody tr').count(), 5);
        assert.equal(await page.locator('#detail .state-diagram li').count(), 3);
      }
      if (type === 'interface') assert.equal(await page.locator('#detail table').count(), 3);
      if (type === 'flow') assert.equal(await page.locator('#detail [data-field="steps"] ol > li').count(), 5);
    }
    assert.deepEqual(blocks, new Set(['text', 'table', 'callout', 'list', 'image', 'code']));
    assert.deepEqual(errors, []);
  });

  test('chromium: real touch input drags a card and spreads two touch points', async (t) => {
    const { page, context } = await open(t, '', { viewport: mobile, hasTouch: true, isMobile: true });
    const session = await context.newCDPSession(page);
    const touch = (type, touchPoints) => session.send('Input.dispatchTouchEvent', { type, touchPoints });
    const initial = await state(page);
    const first = initial.cards[0];
    const box = await card(page, first.id).boundingBox();
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    await touch('touchStart', [{ x, y, id: 1 }]);
    await touch('touchMove', [{ x: x + 14, y: y + 44, id: 1 }]);
    await touch('touchEnd', []);
    const dragged = await state(page);
    assert.ok(dragged.layout.views.clinic[first.id].y > first.y);
    await touch('touchStart', [{ x: 60, y: 430, id: 1 }, { x: 150, y: 430, id: 2 }]);
    await touch('touchMove', [{ x: 36, y: 430, id: 1 }, { x: 200, y: 430, id: 2 }]);
    await touch('touchEnd', []);
    assert.ok((await state(page)).camera.k > dragged.camera.k * 1.4);
  });

  test('chromium: empty, forty cards with a cycle, and long or dangerous text render intact', async (t) => {
    const boundaries = createBoundaries();
    for (const [kind, design] of Object.entries(boundaries)) {
      const url = await writePage(t, pageInput(design));
      const { page, errors, requests } = await open(t, '', { viewport: mobile }, url);
      if (kind === 'empty') assert.ok(await page.locator('.empty-scene svg').isVisible());
      if (kind === 'crowded') {
        const boxes = await page.locator('#world .graph-card').evaluateAll((elements) =>
          elements.map((element) => element.getBoundingClientRect().toJSON()));
        assert.equal(boxes.length, 40);
        for (const [i, box] of boxes.entries()) {
          for (const other of boxes.slice(i + 1)) assert.ok(!overlaps(box, other));
        }
        assert.ok(await page.locator('#world .back-edge').count());
      }
      if (kind === 'long' || kind === 'dangerous') {
        const literal = design.objects[1];
        await card(page, literal.id).click();
        const detail = page.locator('#detail');
        assert.equal(await detail.locator('h2').textContent(), literal.title);
        const summary = literal.type === 'module' ? '[data-field="purpose"] p' : '.detail-head > p';
        assert.equal(await detail.locator(summary).textContent(), literal.summary);
        assert.ok(await detail.evaluate((element) => element.scrollWidth <= element.clientWidth));
        assert.equal(await page.evaluate(() => window.intruded), undefined);
        assert.equal(await detail.locator('script').count(), 0);
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(requests, []);
    }
  });
}
