import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutFlow, layoutMap, overlaps } from '../../assets/layout.mjs';
import { indexDesign, projectRelations } from '../../assets/model.mjs';
import { parseInline } from '../../assets/inline.mjs';
import { routeConnection, segmentHitsBox } from '../../assets/routing.mjs';
import { buildSearchIndex, searchDesign } from '../../assets/search.mjs';
import { buildPage } from '../../scripts/page.mjs';
import { clinicInput, pageInput } from './fixtures.mjs';
import { createBoundaries, generateScale } from './generate.mjs';

const { design } = clinicInput();
const index = indexDesign(design);
const edge = (from, to, type = 'depends_on') => ({ from, to, type });
const mapItems = ['a', 'b', 'c', 'd', 'e'].map((id, i) =>
  ({ id, type: 'module', group: i % 2 ? '后续' : '办理' }));
const mapEdges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a'), edge('c', 'd')];

function disjoint(boxes) {
  for (const [i, box] of boxes.entries()) {
    for (const other of boxes.slice(i + 1)) assert.ok(!overlaps(box, other), `${box.id} / ${other.id}`);
  }
}

function contains(zone, card) {
  return zone.x <= card.x && zone.y <= card.y &&
    zone.x + zone.width >= card.x + card.width && zone.y + zone.height >= card.y + card.height;
}

function assertRanked(plan, direction) {
  const coordinate = direction === 'vertical' ? 'y' : 'x';
  const cards = new Map(plan.cards.map((card) => [card.id, card]));
  for (const { from, to, back } of plan.edges) {
    if (!back) assert.ok(cards.get(from)[coordinate] < cards.get(to)[coordinate], `${from} → ${to}`);
  }
}

// A horizontal map puts its partitions side by side, so it only promises the order inside each of them.
function assertMapRanked(plan, direction) {
  if (direction === 'vertical') return assertRanked(plan, direction);
  const cards = new Map(plan.cards.map((card) => [card.id, card]));
  for (const { from, to, back } of plan.edges) {
    const [a, b] = [cards.get(from), cards.get(to)];
    if (!back && a.group === b.group) assert.ok(a.y < b.y || a.y === b.y && a.x < b.x, `${from} → ${to}`);
  }
}

for (const direction of ['horizontal', 'vertical']) {
  test(`map ${direction}: deterministic, grouped and ranked with a cycle`, () => {
    const plan = layoutMap(mapItems, mapEdges, { direction, availableWidth: 354 });
    assert.deepEqual(layoutMap(mapItems, mapEdges, { direction, availableWidth: 354 }), plan);
    disjoint(plan.cards);
    disjoint(plan.zones);
    assert.ok(plan.cards.every((card) => plan.zones.some((zone) => zone.group === card.group && contains(zone, card))));
    assertMapRanked(plan, direction);
    assert.ok(plan.edges.some(({ back }) => back));
    if (direction === 'vertical') assert.ok(plan.bounds.width <= 354);
  });

  test(`map ${direction}: fixed coordinates, automatic avoidance and stale records`, () => {
    const card = layoutMap(mapItems, mapEdges, { direction }).cards.find(({ id }) => id === 'a');
    const point = { x: card.x, y: card.y };
    const withoutStale = { direction, positions: { e: point } };
    const withStale = { direction, positions: { ...withoutStale.positions, removed: { x: 500, y: 999 } } };
    const plan = layoutMap(mapItems, mapEdges, withStale);
    assert.deepEqual(plan, layoutMap(mapItems, mapEdges, withoutStale));
    const fixed = plan.cards.find(({ id }) => id === 'e');
    assert.deepEqual({ x: fixed.x, y: fixed.y, fixed: fixed.fixed }, { ...point, fixed: true });
    disjoint(plan.cards);
    disjoint(plan.zones);
    assert.ok(plan.cards.every((card) => plan.zones.some((zone) => zone.group === card.group && contains(zone, card))));
    assertMapRanked(plan, direction);
    if (direction === 'vertical') assert.ok(plan.bounds.width <= 390);
  });

  test(`flow ${direction}: sequence, branching, convergence, retry and multiple ends`, () => {
    const steps = ['start', 'branch', 'ok', 'retry', 'join', 'done', 'reject'].map((id) => ({ id }));
    const transitions = [
      edge('start', 'branch'), edge('branch', 'ok'), edge('branch', 'retry'), edge('retry', 'branch'),
      edge('ok', 'join'), edge('retry', 'join'), edge('join', 'done'), edge('join', 'reject')
    ];
    const plan = layoutFlow({ start: 'start', steps, transitions, ends: ['done', 'reject'] }, { direction });
    assert.deepEqual(plan.edges.filter(({ back }) => back).map(({ from, to }) => [from, to]), [['retry', 'branch']]);
    assert.equal(plan.cards.length, steps.length);
    assertRanked(plan, direction);
    disjoint(plan.cards);
    for (const link of plan.edges) {
      const from = plan.cards.find(({ id }) => id === link.from);
      const to = plan.cards.find(({ id }) => id === link.to);
      const points = routeConnection(from, to, plan.cards, direction === 'vertical', link.back);
      assert.ok(points?.length >= 2);
      for (let i = 1; i < points.length; i++) {
        assert.ok(plan.cards.every((card) => !segmentHitsBox(points[i - 1], points[i], card)));
      }
    }
  });
}

test('horizontal map keeps cards at full size: partitions side by side, wrapped to the width', () => {
  const items = [
    ...['a', 'b', 'c'].map((id) => ({ id, type: 'module', group: '业务' })),
    ...['p', 'q', 'r', 's'].map((id) => ({ id, type: 'module', group: '平台' }))
  ];
  const chain = [edge('a', 'b'), edge('b', 'c')];
  const wide = layoutMap(items, chain, { availableWidth: 2600 });
  const card = (plan, id) => plan.cards.find((item) => item.id === id);
  assert.ok(wide.cards.every(({ width, height }) => width === 264 && height === 136));
  assert.deepEqual(wide.zones.map(({ group }) => group), ['业务', '平台']);
  assert.equal(wide.zones[0].y, wide.zones[1].y);
  assert.ok(wide.zones[0].x + wide.zones[0].width < wide.zones[1].x);
  assert.ok(card(wide, 'a').x < card(wide, 'b').x && card(wide, 'b').x < card(wide, 'c').x);
  // Cards with no order among them stand side by side instead of in one tall column.
  assert.equal(new Set(['p', 'q', 'r', 's'].map((id) => card(wide, id).y)).size, 1);
  const narrow = layoutMap(items, chain, { availableWidth: 1000 });
  assert.ok(narrow.bounds.width <= 1000);
  assert.ok(narrow.zones[0].y + narrow.zones[0].height < narrow.zones[1].y);
  assert.equal(new Set(['p', 'q', 'r', 's'].map((id) => card(narrow, id).y)).size, 2);
  disjoint(narrow.cards);
  disjoint(narrow.zones);
  // A relation that is not drawn by default does not decide the order.
  const minor = layoutMap(items, [...chain, { ...edge('c', 'a'), main: false }], { availableWidth: 2600 });
  assert.deepEqual(minor.cards.map(({ id, x, y }) => ({ id, x, y })), wide.cards.map(({ id, x, y }) => ({ id, x, y })));
  assert.ok(minor.edges.every(({ back }) => !back));
});

test('projection lifts endpoints, merges parallel relations and counts annotations', () => {
  const relations = [
    edge('appointment', 'visit-record'), edge('reserve-api', 'visit-api'), edge('appointment', 'reserve-api'),
    edge('make-booking#hold', 'capacity', 'governed_by'), edge('duplicate', 'appointment', 'verifies'),
    edge('waitlist', 'appointment', 'blocks')
  ];
  const { edges, annotations } = projectRelations(index, relations, 'clinic', new Set(['booking', 'consult']));
  assert.deepEqual(edges.map(({ from, to, count }) => ({ from, to, count })),
    [{ from: 'booking', to: 'consult', count: 2 }]);
  assert.deepEqual(edges[0].relations, relations.slice(0, 2));
  assert.deepEqual(annotations.get('booking'), {
    governed_by: [relations[3]], verifies: [relations[4]], blocks: [relations[5]]
  });
});

test('projection draws one line per pair of cards and marks each card\'s weightiest line as main', () => {
  const objects = [
    { id: 'root', type: 'system' },
    ...['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'module', parent: 'root' })),
    ...['a', 'b', 'c', 'd'].map((id) => ({ id: id + '1', type: 'entity', parent: id }))
  ];
  const local = indexDesign({ objects, relations: [] });
  const cards = new Set(['a', 'b', 'c', 'd']);
  const relations = [
    edge('a1', 'b1', 'calls'), edge('b1', 'a1', 'reads'), edge('a', 'b', 'calls'),
    edge('a', 'c', 'relates'), edge('b', 'c', 'writes'), edge('c', 'd', 'reads'),
    edge('a', 'd', 'relates'), edge('b', 'd', 'relates')
  ];
  const { edges, owner } = projectRelations(local, relations, 'root', cards);
  const line = (id) => edges.find((item) => item.id === id);
  assert.equal(edges.length, 6);
  assert.deepEqual({ ...line('a/b'), relations: undefined }, {
    id: 'a/b', from: 'a', to: 'b', type: 'calls', relations: undefined, count: 3, weight: 10, mutual: true, main: true
  });
  assert.deepEqual(line('a/b').relations, relations.slice(0, 3));
  assert.deepEqual(edges.filter(({ main }) => main).map(({ id }) => id), ['a/b', 'b/c', 'c/d']);
  assert.ok(edges.filter(({ id }) => id !== 'a/b').every(({ mutual }) => !mutual));
  assert.equal(owner('b1'), 'b');
  // With no more lines than cards nothing is held back.
  const sparse = projectRelations(local, relations.slice(0, 5), 'root', cards).edges;
  assert.deepEqual(sparse.map(({ id, main }) => [id, main]), [['a/b', true], ['a/c', true], ['b/c', true]]);
});

test('inline syntax returns typed nodes and keeps unclosed syntax literal', () => {
  assert.deepEqual(parseInline('**加粗 `code` [[a#s|标题]]**'), [{
    kind: 'strong', children: [
      { kind: 'text', value: '加粗 ' }, { kind: 'code', value: 'code' }, { kind: 'text', value: ' ' },
      { kind: 'reference', target: 'a#s', children: [{ kind: 'text', value: '标题' }] }
    ]
  }]);
  assert.deepEqual(parseInline('[[a|**标题**]]'), [{
    kind: 'reference', target: 'a', children: [{ kind: 'strong', children: [{ kind: 'text', value: '标题' }] }]
  }]);
  for (const value of ['**未闭合', '`未闭合', '[[未闭合', '<img onerror="a">']) {
    assert.deepEqual(parseInline(value), [{ kind: 'text', value }]);
  }
  assert.deepEqual(parseInline('`**[[a]]**`'), [{ kind: 'code', value: '**[[a]]**' }]);
});

test('search covers title, summary, body, notes and both forms of evidence', () => {
  const object = {
    ...design.objects.find(({ id }) => id === 'appointment'),
    title: '标题词', summary: '摘要词', body: { fields: [{ description: '正文字段' }] },
    notes: [{ type: 'table', rows: [['备注字段']] }], sources: [{ ref: '依据路径' }]
  };
  const objects = design.objects.map((item) => item.id === object.id ? object : item);
  const local = indexDesign({ ...design, objects });
  const entries = buildSearchIndex(local, { appointment: [{ path: '核对依据' }] });
  for (const query of ['标题词', '摘要词', '正文字段', '备注字段', '依据路径', '核对依据']) {
    const [result] = searchDesign(entries, query);
    assert.equal(result.object.id, 'appointment');
    assert.deepEqual(result.path.map(({ id }) => id), ['clinic', 'booking', 'reserve', 'appointment']);
  }
  assert.deepEqual(searchDesign(entries, '预约'), searchDesign([...entries].reverse(), '预约'));
  assert.deepEqual(searchDesign(entries, '   '), []);
});

test('generation is deterministic, offline and keeps dangerous values in inert JSON', () => {
  const input = pageInput(createBoundaries().dangerous);
  const html = buildPage(input);
  assert.equal(buildPage(input), html);
  assert.doesNotMatch(html, /(?:src|href)=["']https?:\/\//i);
  assert.doesNotMatch(html, /<script>window\.intruded/);
  const payload = /id="arkigo-data">([^<]*)<\/script>/.exec(html)[1];
  assert.deepEqual(JSON.parse(payload), input);
  assert.match(payload, /\\u003cscript>/);
  assert.match(payload, /\\u2028.*\\u2029/);
  const clinic = clinicInput();
  assert.deepEqual(JSON.parse(/id="arkigo-data">([^<]*)<\/script>/.exec(buildPage(clinic))[1]), clinic);
});

test('generation bounds history by record count and escaped byte size', () => {
  const input = clinicInput({ history: Array.from({ length: 38 }, (_, i) => ({ i })) });
  const embedded = (value) => JSON.parse(/id="arkigo-data">([^<]*)<\/script>/.exec(buildPage(value))[1]);
  assert.deepEqual(embedded(input).history, input.history.slice(0, 30));
  const large = { reason: '<'.repeat(50_000) };
  assert.deepEqual(embedded({ ...input, history: [large, large, { i: 1 }] }).history, [large]);
});

test('scale fixture has 500 objects, 800 distinct relationships and five levels', () => {
  const sample = generateScale();
  const tree = indexDesign(sample);
  assert.equal(sample.objects.length, 500);
  assert.equal(sample.relations.length, 800);
  assert.equal(new Set(sample.relations.map(({ from, to, type }) => `${from}/${to}/${type}`)).size, 800);
  assert.equal(Math.max(...sample.objects.map(({ id }) => tree.pathTo(id).length)), 5);
  assert.equal(tree.children.get(sample.id).length, 40);
});
