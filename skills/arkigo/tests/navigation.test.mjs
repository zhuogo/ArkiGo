import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildHierarchy, moduleProjection, shouldEnterModule, fitViewCamera, frameNodeCamera } from '../assets/canvas-navigation.mjs';
import { boundsOf } from '../assets/canvas-geometry.mjs';
import { validateCanvas } from '../scripts/canvas-document.mjs';

const load = (name = 'registration') => JSON.parse(readFileSync(new URL(`../../../docs/poc/canvas-engine/${name}.canvas.json`, import.meta.url), 'utf8'));
const invalid = (mutate, code) => {
  const doc = load(); mutate(doc);
  assert.throws(() => buildHierarchy(doc), (error) => error.code === code);
  assert.ok(validateCanvas(doc).errors.some((error) => error.code === code));
};

test('all canvas fixtures form valid rooted hierarchies, without changing data', () => {
  for (const name of ['arkigo', 'tasks', 'registration']) {
    const doc = load(name), before = structuredClone(doc), hierarchy = buildHierarchy(doc);
    assert.deepEqual(validateCanvas(doc), { valid: true, errors: [], warnings: [] });
    assert.equal(hierarchy.parents.size, doc.views.length - 1);
    for (const view of doc.views) {
      const path = hierarchy.pathTo(view.id);
      assert.equal(path[0].viewId, hierarchy.rootId);
      assert.equal(path.at(-1).viewId, view.id);
    }
    assert.deepEqual(doc, before);
  }
});

test('deep paths preserve the module used at each entry and root supports reordered views', () => {
  const doc = load();
  doc.views.reverse();
  const hierarchy = buildHierarchy(doc);
  assert.deepEqual(hierarchy.pathTo('persistence'), [
    { viewId: 'system' }, { viewId: 'users', viaNodeId: 'users' },
    { viewId: 'registration', viaNodeId: 'register' }, { viewId: 'persistence', viaNodeId: 'persist' }
  ]);
  assert.deepEqual(hierarchy.parents.get('registration'), { viewId: 'users', nodeId: 'register' });
  assert.deepEqual(hierarchy.pathTo('system'), [{ viewId: 'system' }]);
  assert.throws(() => hierarchy.pathTo('unknown'), (error) => error.code === 'TARGET_VIEW_MISSING');
  assert.equal(validateCanvas(doc).valid, true);
});

test('root is optional for existing documents and first view stays the default', () => {
  const doc = load(); delete doc.rootViewId;
  assert.equal(buildHierarchy(doc).rootId, 'system');
  assert.equal(validateCanvas(doc).valid, true);
  doc.views = [doc.views[0]]; delete doc.views[0].nodes[0].targetViewId;
  assert.equal(buildHierarchy(doc).parents.size, 0);
  assert.equal(validateCanvas(doc).valid, true);
});

test('missing root, unknown children and repeated view IDs are rejected', () => {
  invalid((doc) => { doc.rootViewId = 'missing'; }, 'ROOT_VIEW_MISSING');
  invalid((doc) => { doc.views[0].nodes[0].targetViewId = 'missing'; }, 'TARGET_VIEW_MISSING');
  invalid((doc) => { doc.views.push(structuredClone(doc.views[0])); }, 'DUPLICATE_VIEW_ID');
});

test('self links, cycles, duplicate parent nodes and unreachable views are rejected', () => {
  invalid((doc) => { doc.views[0].nodes[0].targetViewId = 'system'; }, 'VIEW_SELF_LINK');
  invalid((doc) => { doc.views[3].nodes[0].targetViewId = 'system'; }, 'VIEW_CYCLE');
  invalid((doc) => { doc.views[0].nodes[1].targetViewId = 'users'; }, 'VIEW_MULTIPLE_PARENTS');
  invalid((doc) => { doc.views[3].nodes[0].targetViewId = 'users'; }, 'VIEW_MULTIPLE_PARENTS');
  invalid((doc) => { delete doc.views[0].nodes[0].targetViewId; }, 'VIEW_UNREACHABLE');
});

test('a designated root cannot have a parent and disconnected cycles are checked', () => {
  invalid((doc) => { doc.rootViewId = 'users'; }, 'ROOT_VIEW_HAS_PARENT');
  invalid((doc) => {
    delete doc.views[0].nodes[0].targetViewId;
    doc.views[3].nodes[0].targetViewId = 'users';
  }, 'VIEW_CYCLE');
});

const viewport = { x: 20, y: 30, width: 1000, height: 600 };
const node = { id: 'module', x: 100, y: 80, targetViewId: 'child' };
const deliberateIn = { direction: 'in', deliberate: true };

test('entry is based on projected size, visibility and a deliberate inward gesture', () => {
  const large = frameNodeCamera(node, viewport), small = frameNodeCamera(node, viewport, .3);
  assert.equal(shouldEnterModule(node, large, viewport, deliberateIn), true);
  assert.equal(shouldEnterModule(node, small, viewport, deliberateIn), false);
  assert.equal(shouldEnterModule(node, large, viewport), false);
  assert.equal(shouldEnterModule(node, large, viewport, { direction: 'out', deliberate: true }), false);
  assert.equal(shouldEnterModule(node, large, viewport, { direction: 'in', deliberate: false }), false);
  assert.equal(shouldEnterModule({ ...node, targetViewId: undefined }, large, viewport, deliberateIn), false);
  assert.equal(shouldEnterModule(null, large, viewport, deliberateIn), false);
});

test('a large offscreen or mostly occluded module cannot trigger entry', () => {
  const camera = frameNodeCamera(node, viewport);
  assert.equal(shouldEnterModule(node, { ...camera, x: camera.x - 2000 }, viewport, deliberateIn), false);
  const halfHidden = { ...camera, x: viewport.x - node.x * camera.k - 130 * camera.k };
  assert.ok(moduleProjection(node, halfHidden, viewport).visibleRatio < .8);
  assert.equal(shouldEnterModule(node, halfHidden, viewport, deliberateIn), false);
  assert.equal(shouldEnterModule(node, frameNodeCamera(node, viewport, 2), viewport, deliberateIn), false);
});

test('usable viewport insets and responsive size alter the entry threshold', () => {
  const camera = frameNodeCamera(node, viewport);
  assert.equal(shouldEnterModule(node, camera, { x: 0, y: 0, width: 2000, height: 1200 }, deliberateIn), false);
  assert.equal(shouldEnterModule(node, camera, { x: 900, y: 30, width: 100, height: 600 }, deliberateIn), false);
  for (const size of [{ width: 360, height: 640 }, { width: 1800, height: 1000 }]) {
    const projected = moduleProjection(node, frameNodeCamera(node, size), size);
    assert.ok(Math.abs(projected.occupancy - .62) < 1e-9);
    assert.ok(Math.abs(projected.visibleRatio - 1) < 1e-9);
  }
});

test('entry threshold has a deterministic boundary and invalid geometry is inert', () => {
  const square = { ...node, width: 200, height: 200 }, vp = { width: 1000, height: 1000 };
  assert.equal(shouldEnterModule(square, frameNodeCamera(square, vp, .58), vp, deliberateIn), true);
  assert.equal(shouldEnterModule(square, frameNodeCamera(square, vp, .579), vp, deliberateIn), false);
  for (const camera of [{ k: 0, x: 0, y: 0 }, { k: NaN, x: 0, y: 0 }]) {
    assert.equal(shouldEnterModule(node, camera, vp, deliberateIn), false);
  }
  assert.equal(shouldEnterModule(node, frameNodeCamera(node, vp), { width: 0, height: 0 }, deliberateIn), false);
});

test('child fit includes title space and honors a usable viewport offset', () => {
  const doc = load(), vp = { x: 40, y: 50, width: 1000, height: 700 };
  for (const view of doc.views) {
    const bounds = boundsOf(view), camera = fitViewCamera(bounds, vp);
    assert.ok(bounds.x * camera.k + camera.x >= vp.x + 38 - 1e-9);
    assert.ok(bounds.y * camera.k + camera.y >= vp.y + 38 - 1e-9);
    assert.ok((bounds.x + bounds.width) * camera.k + camera.x <= vp.x + vp.width - 38 + 1e-9);
    assert.ok((bounds.y + bounds.height) * camera.k + camera.y <= vp.y + vp.height - 38 + 1e-9);
  }
});

test('deep fixture is a proposal, has navigable modules and a terminal leaf level', () => {
  const doc = load();
  assert.equal(buildHierarchy(doc).pathTo('persistence').length, 4);
  for (const view of doc.views) for (const node of view.nodes) {
    assert.equal(node.designStatus, 'proposed');
    assert.equal(node.sourceOrigin, 'example');
  }
  assert.equal(doc.views.at(-1).nodes.some((node) => node.targetViewId), false);
});
