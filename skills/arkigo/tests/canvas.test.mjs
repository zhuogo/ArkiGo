import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { validateCanvas, modelToCanvas } from '../scripts/canvas-document.mjs';
import { applyLayout, renderCanvas } from '../scripts/render.mjs';
import { boundsOf, fitCamera, zoomCamera, routeEdge, segmentHitsBox, roundedPath, placeLabel } from '../assets/canvas-geometry.mjs';

const load = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const demo = () => load('../../../docs/poc/canvas-engine/arkigo.canvas.json');
const codes = (document) => validateCanvas(document).errors.map((e) => e.code);
const box = (id, x, y) => ({ id, x, y, width: 100, height: 80 });
const embedded = (html) => JSON.parse(/<script id="arkigo-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);

test('both independent canvas demos validate and render without changing input', () => {
  for (const name of ['arkigo', 'tasks']) {
    const doc = load(`../../../docs/poc/canvas-engine/${name}.canvas.json`), before = structuredClone(doc);
    assert.deepEqual(validateCanvas(doc), { valid: true, errors: [], warnings: [] });
    const html = renderCanvas(doc);
    assert.deepEqual(embedded(html).document, doc);
    assert.deepEqual(doc, before);
    assert.equal(/<script[^>]+src=|<link[^>]+href=|fetch\(/i.test(html), false);
    assert.equal(html.includes('/*ARKIGO_RUNTIME*/'), false);
  }
});

test('canvas rejects malformed fields and executable markup fields', () => {
  const doc = demo(); doc.views[0].nodes[0].html = '<b>injected</b>';
  assert.deepEqual(codes(doc), ['CANVAS_SCHEMA_INVALID']);
  assert.equal(validateCanvas(null).valid, false);
});

test('view IDs must be unique', () => {
  const doc = demo(); doc.views.push(structuredClone(doc.views[0]));
  assert.ok(codes(doc).includes('DUPLICATE_VIEW_ID'));
});

test('zone, node and edge IDs share a uniqueness space inside each view', () => {
  const doc = demo(); doc.views[0].edges[0].id = doc.views[0].nodes[0].id;
  assert.ok(codes(doc).includes('DUPLICATE_CANVAS_ID'));
});

test('zone, view and edge references are checked', () => {
  const doc = demo(), view = doc.views[0];
  view.nodes[0].zoneId = 'missing-zone'; view.nodes[1].targetViewId = 'missing-view'; view.edges[0].to = 'missing-node';
  for (const code of ['ZONE_MISSING', 'TARGET_VIEW_MISSING', 'CANVAS_REFERENCE_MISSING']) assert.ok(codes(doc).includes(code));
});

test('cards must leave zone title space and must not overlap', () => {
  const doc = demo(), view = doc.views[0];
  view.nodes[0].y = view.zones[0].y;
  Object.assign(view.nodes[1], { x: view.nodes[0].x, y: view.nodes[0].y });
  assert.ok(codes(doc).includes('NODE_OUTSIDE_ZONE'));
  assert.ok(codes(doc).includes('NODE_OVERLAP'));
});

test('walkthrough cannot reference missing or unrelated objects', () => {
  const doc = demo(), view = doc.views[0];
  view.walkthrough = [{ nodeId: 'absent', title: 'x', text: 'x', edgeId: 'absent' }];
  assert.ok(codes(doc).includes('WALK_NODE_MISSING'));
  assert.ok(codes(doc).includes('WALK_EDGE_MISSING'));
  const edge = view.edges[0], other = view.nodes.find((n) => n.id !== edge.from && n.id !== edge.to);
  view.walkthrough = [{ nodeId: other.id, title: 'x', text: 'x', edgeId: edge.id }];
  assert.ok(codes(doc).includes('WALK_EDGE_UNRELATED'));
});

test('legacy model adapter retains flow members, statuses and source references', () => {
  for (const name of ['new-system', 'existing-system']) {
    const model = load(`../../../docs/poc/${name}/model.json`), before = structuredClone(model);
    const { document } = modelToCanvas(model);
    assert.equal(validateCanvas(document).valid, true);
    for (const original of model.nodes.filter((n) => n.kind !== 'system')) {
      const card = document.views.flatMap((v) => v.nodes).find((n) => n.id === original.id);
      assert.ok(card, original.id);
      assert.equal(card.designStatus, original.designStatus);
      assert.equal(card.sourceOrigin, original.provenance.origin);
      assert.deepEqual(card.sources, original.provenance.references);
    }
    assert.deepEqual(model, before);
  }
});

test('camera fit contains bounds and cursor zoom preserves the world anchor', () => {
  const bounds = boundsOf(demo().views[0]), c = fitCamera(bounds, 1440, 800);
  assert.ok(bounds.x * c.k + c.x >= 0);
  assert.ok((bounds.x + bounds.width) * c.k + c.x <= 1440);
  assert.ok((bounds.y + bounds.height) * c.k + c.y <= 800);
  const point = { x: 380, y: 310 }, next = zoomCamera(c, 1.3, point);
  assert.ok(Math.abs((point.x - c.x) / c.k - (point.x - next.x) / next.k) < 1e-9);
  assert.ok(Math.abs((point.y - c.y) / c.k - (point.y - next.y) / next.k) < 1e-9);
  assert.equal(zoomCamera(c, 1000, point).k, 2.5);
  assert.equal(zoomCamera(c, .0001, point).k, .08);
});

test('orthogonal routing avoids a blocking card', () => {
  const nodes = [box('a', 0, 200), box('b', 600, 200), box('blocker', 300, 170)];
  const route = routeEdge({ from: 'a', to: 'b' }, nodes);
  assert.equal(route.fallback, false);
  assert.deepEqual(route.points[0], { x: 100, y: 240 });
  assert.deepEqual(route.points.at(-1), { x: 600, y: 240 });
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1], b = route.points[i];
    assert.ok(a.x === b.x || a.y === b.y);
    for (const node of nodes) assert.equal(segmentHitsBox(a, b, node), false, node.id);
  }
  assert.match(roundedPath(route.points), /^M/);
  assert.match(roundedPath(route.points), /Q/);
});

test('routing supports authored ports and self loops', () => {
  const nodes = [box('a', 100, 100), box('b', 500, 100)];
  const route = routeEdge({ from: 'a', to: 'b', fromSide: 'bottom', toSide: 'bottom' }, nodes);
  assert.equal(route.fallback, false);
  assert.deepEqual(route.points[0], { x: 150, y: 180 });
  assert.deepEqual(route.points.at(-1), { x: 550, y: 180 });
  const loop = routeEdge({ from: 'a', to: 'a' }, nodes);
  assert.equal(loop.fallback, false);
  assert.ok(loop.points.length >= 4);
  for (let i = 1; i < loop.points.length; i++) assert.equal(segmentHitsBox(loop.points[i - 1], loop.points[i], nodes[0]), false);
});

test('trapped ports produce an explicit fallback rather than a missing path', () => {
  const nodes = [box('a', 100, 100), box('b', 180, 100)];
  const route = routeEdge({ from: 'a', to: 'b' }, nodes);
  assert.equal(route.fallback, true);
  assert.ok(route.points.length >= 2);
  assert.throws(() => routeEdge({ from: 'a', to: 'missing' }, nodes), /endpoint/);
});

test('label placement chooses available space away from cards and earlier labels', () => {
  const path = [{ x: 0, y: 200 }, { x: 600, y: 200 }], nodes = [box('blocker', 250, 150)];
  const first = placeLabel(path, 50, 15, nodes), second = placeLabel(path, 50, 15, nodes, [first]);
  assert.notEqual(first.x, 275);
  assert.notDeepEqual({ x: first.x, y: first.y }, { x: second.x, y: second.y });
});

test('layout roundtrip updates coordinates without changing content or source input', () => {
  const doc = demo(), before = structuredClone(doc), view = doc.views[0], node = view.nodes[0];
  const layout = { schemaVersion: 'arkigo-layout/1', documentId: doc.id, revision: doc.revision,
    views: [{ id: view.id, nodes: [{ id: node.id, x: node.x + 12, y: node.y + 12 }] }] };
  const result = embedded(renderCanvas(doc, { layout })).document;
  assert.equal(result.views[0].nodes[0].x, node.x + 12);
  assert.deepEqual(result.views[0].nodes[0].details, node.details);
  assert.deepEqual(doc, before);
  assert.deepEqual(applyLayout(doc, layout), result);
});

test('layout import rejects stale identity, duplicate IDs, invalid geometry and unknown nodes', () => {
  const doc = demo(), view = doc.views[0], node = view.nodes[0];
  const base = { schemaVersion: 'arkigo-layout/1', documentId: doc.id, revision: doc.revision,
    views: [{ id: view.id, nodes: [{ id: node.id, x: node.x, y: node.y }] }] };
  for (const mutate of [
    (x) => { x.revision = 'outdated'; },
    (x) => { x.views.push(structuredClone(x.views[0])); },
    (x) => { x.views[0].nodes.push(structuredClone(x.views[0].nodes[0])); },
    (x) => { x.views[0].nodes[0].id = 'unknown'; },
    (x) => { x.views[0].nodes[0].x = Infinity; },
    (x) => { x.views[0].nodes[0].y = 0; }
  ]) {
    const layout = structuredClone(base); mutate(layout);
    assert.throws(() => renderCanvas(doc, { layout }));
  }
});

test('raw canvas strings cannot execute or alter template replacement', () => {
  const doc = demo(), hostile = '</script><script>window.injected=true</script><img src=x onerror=alert(1)> $&';
  doc.title = hostile; doc.views[0].nodes[0].details.note = hostile; doc.views[0].nodes[0].sources = [hostile];
  const html = renderCanvas(doc);
  assert.deepEqual(embedded(html).document, doc);
  assert.equal((html.match(/<script\b/g) ?? []).length, 3);
  assert.equal(html.includes('<script>window.injected'), false);
});

test('invalid CLI input leaves an existing output untouched', () => {
  const directory = mkdtempSync(join(tmpdir(), 'arkigo-canvas-'));
  try {
    const input = join(directory, 'invalid.json'), output = join(directory, 'canvas.html');
    const doc = demo(); doc.views[0].edges[0].from = 'missing';
    writeFileSync(input, JSON.stringify(doc)); writeFileSync(output, 'KEEP');
    const cli = fileURLToPath(new URL('../scripts/render.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [cli, input, output], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /CANVAS_REFERENCE_MISSING/);
    assert.equal(readFileSync(output, 'utf8'), 'KEEP');
    const sameFile = spawnSync(process.execPath, [cli, input, input], { encoding: 'utf8' });
    assert.equal(sameFile.status, 2);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
