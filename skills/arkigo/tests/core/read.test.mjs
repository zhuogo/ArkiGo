import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { shop, item, workspace } from './helpers.mjs';
import { generateDesign } from './generate.mjs';
import { validateDesign } from '../../scripts/lib/validate.mjs';

test('06 directory, id, field and five categories of searchable paths', t => {
  const area = workspace(t);
  area.save();
  const query = (...args) => area.json(['query', ...args]);
  const directory = query();
  assert.equal(directory.openDecisions, 1);
  assert.equal(directory.project.system, 'shop');
  assert.equal(directory.counts.module, 2);
  assert.ok(directory.items.some(row => row.id === 'pickup' && row.depth === 2));
  assert.ok(directory.items.every(row => row.depth <= 2));
  const found = query('--id', 'checkout');
  assert.equal(found.items[0].value.body.responsibilities[0], '校验库存');
  assert.ok(found.items.some(row => row.role === 'relation' && row.value.type === 'blocks'));
  assert.ok(found.items.some(row => row.role === 'child' && row.id === 'cart'));
  for (const [needle, id, path] of [
    ['创建订单接口', 'create-order', '/title'], ['库存不可扣', 'stock-limit', '/summary'],
    ['原子校验库存', 'stock-limit', '/body/constraint'], ['参见', 'checkout', '/notes/0/text'],
    ['第一次试营业', 'checkout', '/sources/0/ref'], ['PLACE-ORDER', 'place-order', '/id'],
  ]) assert.ok(query('--search', needle).items.some(row => row.id === id && row.path === path));
  assert.equal(query('--field', 'stock-window', '/body/chosen').items[0].value, null);
  assert.equal(query('--field', 'checkout', '/body/responsibilities/1').items[0].value, '创建订单');
  assert.equal(area.json(['query', '--field', 'cart', '/not-found'], { code: 1 }).code, 'FIELD_NOT_FOUND');
  assert.equal(area.json(['query', '--field', 'cart', '/~2'], { code: 2 }).code, 'INVALID_POINTER');
});

test('06 query filters compose and page by UTF-8 bytes and rows', t => {
  const area = workspace(t);
  const design = shop();
  writeFileSync(join(area.root, 'a.js'), 'test');
  item(design, 'checkout').implementation = { status: 'planned' };
  item(design, 'pickup').implementation = { status: 'implemented', evidence: [{ path: 'a.js' }] };
  item(design, 'create-order').implementation = { status: 'partial', note: '先写请求', evidence: [{ path: 'a.js' }] };
  item(design, 'cart').notes = [{ type: 'text', text: '\u0000引号"😀'.repeat(1000) }];
  area.save(design);
  const query = (...args) => area.json(['query', ...args]);
  const ids = report => report.items.map(row => row.id);
  assert.deepEqual(ids(query('--type', 'module')).sort(), ['checkout', 'pickup']);
  assert.deepEqual(ids(query('--status', 'proposed')).sort(), ['cart', 'console', 'stock-window']);
  assert.deepEqual(ids(query('--implementation', 'planned')), ['checkout']);
  assert.deepEqual(ids(query('--implementation', 'partial')), ['create-order']);
  assert.deepEqual(ids(query('--implementation', 'implemented')), ['pickup']);
  assert.ok(ids(query('--implementation', 'unknown')).includes('cart'));
  assert.ok(ids(query('--under', 'pickup')).every(id => !['order', 'shop'].includes(id)));
  const filters = ['--search', '核销', '--type', 'module', '--status', 'accepted',
    '--implementation', 'implemented', '--under', 'checkout'];
  assert.ok(query(...filters).items.every(row => row.id === 'pickup'));
  assert.ok(query(...filters).total > 0);
  const raw = area.run(['query', '--field', 'cart', '/notes/0/text', '--max-bytes', '1024']).stdout;
  assert.ok(Buffer.byteLength(raw) <= 1024);
  assert.equal(JSON.parse(raw).omitted, true);
  assert.equal(JSON.parse(raw).path, '/notes/0/text');
  assert.equal(JSON.parse(raw).encoding, 'json');
  let encoded = '', cursor = 0;
  do {
    const page = query('--field', 'cart', '/notes/0/text', '--max-bytes', '2048', '--offset', String(cursor));
    encoded += page.items.map(row => row.value).join('');
    cursor = page.nextOffset;
  } while (cursor !== null);
  assert.equal(JSON.parse(encoded), item(design, 'cart').notes[0].text);
  let offset = 0;
  const all = [];
  do {
    const raw = area.run(['query', '--type', 'module', '--limit', '1', '--max-bytes', '1024',
      '--offset', String(offset)]).stdout;
    assert.ok(Buffer.byteLength(raw) <= 1024);
    const page = JSON.parse(raw);
    assert.ok(page.items.length <= 1);
    assert.equal(page.omitted, page.nextOffset !== null || offset > 0);
    all.push(...ids(page));
    offset = page.nextOffset;
  } while (offset !== null);
  assert.deepEqual(all, ['checkout', 'pickup']);
});

test('06 diff tracks project, object fields and relation edits, history pages by change', t => {
  const area = workspace(t);
  const design = shop();
  area.save(design);
  const related = design.relations[0];
  area.change([
    { op: 'update', id: 'order', set: { 'body.retention': '一年', summary: '新的摘要' } },
    { op: 'unlink', relation: related },
    { op: 'link', relation: { ...related, label: '依赖下单' } },
  ]);
  area.put('next.json', { ...design, title: '候选标题' });
  const diff = area.json(['diff', 'next.json']);
  assert.equal(diff.changes[0].op, 'project');
  const order = diff.changes.find(row => row.id === 'order');
  assert.deepEqual(order.fields, ['body.retention', 'summary']);
  assert.equal(order.before.body.retention, '一年');
  assert.equal(order.after.body.retention, undefined);
  assert.equal(diff.changes.filter(row => row.relation).length, 2);
  const list = area.json(['history']);
  assert.equal(list.total, 1);
  const shown = area.json(['history', '--show', list.records[0].file, '--limit', '1']);
  assert.equal(shown.total, 3);
  assert.equal(shown.nextOffset, 1);
  assert.equal(area.json(['history', '--show', '../layout.json'], { code: 1 }).code, 'HISTORY_NOT_FOUND');
  area.put('bad.json', {});
  assert.equal(area.json(['diff', 'bad.json'], { code: 1 }).code, 'VALIDATION_FAILED');
});

const headings = ['目标对象', '树中位置、项目目标与范围', '直接下级', '相关规则', '相关验收', '数据与接口',
  '双向依赖', '未决问题', '实现情况与依据', '省略清单'];

test('07 context renders all ten parts and keeps protected content whole', t => {
  const area = workspace(t);
  const design = shop();
  item(design, 'checkout').implementation = { status: 'planned' };
  item(design, 'stock-acceptance').verification = { status: 'failed', checkedAt: '2026-11-20T09:00:00.000Z' };
  design.relations.push({ from: 'checkout', type: 'reads', to: 'order' });
  item(design, 'checkout').notes[0].text += '长段正文'.repeat(3000);
  area.save(design);
  const unpack = max => area.run(['context', 'checkout', '--max-bytes', String(max)]).stdout;
  const large = unpack(65536);
  assert.ok(large.startsWith('# 开工材料：下单\n\n这是设计里「下单」（\x60checkout\x60）'));
  for (const heading of headings) assert.ok(large.includes('\n## ' + heading + '\n'), heading);
  assert.match(large, /写订单时原子校验库存/);
  assert.match(large, /不创建订单/);
  assert.match(large, /提交前要不要预留库存/);
  assert.match(large, /pickupCode/);
  assert.match(large, /"status": "failed"/);
  const packed = unpack(6200);
  assert.ok(Buffer.byteLength(packed) <= 6200);
  assert.match(packed, /此处已截断/);
  assert.match(packed, /query --field 'checkout' '\/notes\/0'/);
  assert.match(packed, /写订单时原子校验库存/);
  assert.match(packed, /不创建订单/);
  assert.match(packed, /提交前要不要预留库存/);
  const omitted = unpack(3400);
  assert.ok(Buffer.byteLength(omitted) <= 3400);
  assert.match(omitted.split('## 省略清单')[1], /checkout|stock-limit|stock-acceptance|stock-window/);
});

test('07 context compacts giant body strings and oversized omission lists', t => {
  const area = workspace(t);
  const design = generateDesign();
  const target = item(design, 'bench');
  target.body.goals = ['Long body'.repeat(10000)];
  area.save(design);
  assert.deepEqual(validateDesign(design, area), []);
  const raw = area.run(['context', 'bench', '--max-bytes', '1024']).stdout;
  assert.ok(Buffer.byteLength(raw) <= 1024);
  assert.match(raw, /此处已截断/);
  assert.match(raw, /query --field 'bench' '\/body/);
  const minimumTitle = '𐍈'.repeat(80);
  target.title = minimumTitle;
  target.summary = '㍿'.repeat(300);
  area.save(design);
  const result = area.run(['context', 'bench', '--max-bytes', '1024']).stdout;
  assert.ok(Buffer.byteLength(result) <= 1024, String(Buffer.byteLength(result)));
  assert.match(result, /此处已截断/);
  assert.equal(area.json(['context', 'missing'], { code: 1 }).code, 'OBJECT_NOT_FOUND');
});

test('11 export includes every object and emits diagrams, tables and inert Markdown', t => {
  const area = workspace(t);
  const design = shop();
  item(design, 'cart').body.purpose = '**确认商品** \x60check\x60 [[pickup|自提]] <script>bad</script>';
  area.save(design);
  const md = area.run(['export', 'md']).stdout;
  for (const object of design.objects) {
    assert.ok(md.includes('(#' + object.id + ')'), object.id);
    assert.ok(md.includes('<a id="' + object.id + '"></a>'), object.id);
  }
  assert.ok(md.indexOf('## 概述') < md.indexOf('## 角色'));
  assert.ok(md.indexOf('## 角色') < md.indexOf('<a id="checkout">'));
  assert.match(md, /flowchart TD\n {2}n0\["检查库存"\]/);
  assert.match(md, /--\> \|"有货"\| n1/);
  assert.match(md, /n0\["待备货"\]/);
  assert.match(md, /#place-order--step-inspect/);
  assert.match(md, /\| 名称 \| 类型 \| 必填 \| 说明 \|/);
  assert.match(md, /\*\*确认商品\*\*/);
  assert.match(md, /\[自提\]\(#pickup\)/);
  assert.ok(!md.includes('<script>'));
  const result = area.json(['export', 'md', '--under', 'pickup', '--out', 'reading.md']);
  const file = readFileSync(join(area.root, 'reading.md'));
  assert.equal(file.length, result.bytes);
  assert.ok(!file.toString().includes('<a id="cart">'));
  assert.equal(area.json(['export', 'md', '--out', area.design], { code: 2 }).code, 'FILE_ALIAS');
});
