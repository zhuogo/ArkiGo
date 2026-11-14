import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IMPLEMENTATION_STATES, implementationStatus } from '../assets/canvas-implementation.mjs';
import { validateCanvas, modelToCanvas } from '../scripts/canvas-document.mjs';
import { validateModel } from '../scripts/validate.mjs';
import { queryDocument, parseArgs, serializeQuery } from '../scripts/query.mjs';
import { diffDocuments } from '../scripts/diff.mjs';
import { applyCandidate } from '../scripts/apply.mjs';

const load = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const canvas = () => load('../../../docs/poc/canvas-engine/registration.canvas.json');
const model = () => load('../../../docs/poc/new-system/model.json');
const plain = value => JSON.parse(JSON.stringify(value));
const observation = status => ({ status, ...(status === 'partial' ? { note: 'Only the basic path exists; the exception branch remains planned.' } : {}), ...(['implemented', 'partial'].includes(status) ? { sources: ['src/feature.mjs — execute'] } : {}) });

test('implementation states are optional, independent of design approval, and preserve old inputs', () => {
  for (const status of Object.keys(IMPLEMENTATION_STATES)) {
    const document = canvas(), input = structuredClone(document);
    assert.equal(implementationStatus(document.views[0].nodes[0]), 'unknown');
    assert.equal(validateCanvas(document).valid, true);
    assert.deepEqual(document, input);
    document.views[0].nodes[0].implementation = observation(status);
    assert.equal(validateCanvas(document).valid, true, status);
    assert.equal(document.views[0].nodes[0].designStatus, input.views[0].nodes[0].designStatus);
    const legacy = model(); legacy.nodes[0].implementation = observation(status);
    assert.equal(validateModel(legacy).valid, true, status);
  }
});

test('both schemas reject unsupported states, unsubstantiated claims, and unexplained partial implementation', () => {
  for (const implementation of [{ status: 'done' }, { status: 'implemented' }, { status: 'implemented', sources: [] }, { status: 'partial', sources: ['src/x'] }, { status: 'partial', note: ' ', sources: ['src/x'] }, { status: 'unknown', progress: 50 }]) {
    const document = canvas(); document.views[0].nodes[0].implementation = implementation;
    assert.equal(validateCanvas(document).valid, false, JSON.stringify(implementation));
    const legacy = model(); legacy.nodes[0].implementation = implementation;
    assert.equal(validateModel(legacy).valid, false, JSON.stringify(implementation));
  }
});

test('legacy projection retains implementation notes and sources without aliasing or inferring from provenance', () => {
  const input = model(), module = input.nodes.find(n => n.kind === 'module');
  module.implementation = observation('partial');
  const before = structuredClone(input), { document } = modelToCanvas(input);
  const projected = document.views.flatMap(v => v.nodes).find(n => n.id === module.id);
  assert.deepEqual(projected.implementation, module.implementation);
  projected.implementation.sources.push('another-source');
  assert.deepEqual(input, before);
  for (const node of document.views.flatMap(v => v.nodes).filter(n => n.id !== module.id)) assert.equal(implementationStatus(node), 'unknown');
});

test('bounded query returns compact state summaries and full observations only for the target', () => {
  const input = canvas(), node = input.views[0].nodes[0]; node.implementation = { ...observation('partial'), note: 'A private long implementation note.' };
  const before = structuredClone(input);
  const summary = queryDocument(input, { view: input.views[0].id }).items.find(row => row.value.id === node.id);
  assert.deepEqual(plain(summary.value.implementation), { status: 'partial' });
  const detail = queryDocument(input, { view: input.views[0].id, id: node.id });
  assert.deepEqual(plain(detail.target.value.implementation), node.implementation);
  assert.deepEqual(input, before);
  const other = input.views[0].nodes.find(n => n !== node);
  assert.deepEqual(plain(queryDocument(input, { view: input.views[0].id, id: other.id }).target.value.implementation), { status: 'unknown' });
});

test('implementation filters respect scope, search, pagination, and unknown defaults without aggregating parents', () => {
  const input = canvas(), parent = input.views[0].nodes.find(n => n.targetViewId), child = input.views.find(v => v.id === parent.targetViewId).nodes[0];
  child.implementation = observation('implemented');
  const selected = queryDocument(input, { implementation: 'implemented' });
  assert.deepEqual(selected.items.map(row => row.value.id), [child.id]);
  assert.equal(queryDocument(input, { implementation: 'implemented', view: input.views[0].id }).pagination.total, 0);
  assert.equal(queryDocument(input, { implementation: 'implemented', search: 'src/feature.mjs' }).pagination.total, 1);
  assert.equal(queryDocument(input, { implementation: 'unknown', view: input.views[0].id }).items.find(row => row.value.id === parent.id).value.implementation.status, 'unknown');
  const page = queryDocument(input, { implementation: 'unknown', limit: 1 });
  assert.equal(page.items.length, 1); assert.equal(page.pagination.nextOffset, 1);
  assert.equal('implementation' in parent, false);
  const legacy = model(); legacy.nodes[0].implementation = observation('planned');
  assert.equal(queryDocument(legacy, { implementation: 'planned' }).items[0].value.id, legacy.nodes[0].id);
});

test('query validates status shapes and filter arguments without importing full validators', () => {
  assert.equal(parseArgs(['input.json', '--implementation', 'planned']).implementation, 'planned');
  for (const args of [['input.json', '--implementation', 'done'], ['input.json', '--implementation', 'partial', '--id', 'a'], ['input.json', '--implementation', 'unknown', '--field', '']]) assert.throws(() => parseArgs(args), { code: 'ARGUMENT_INVALID' });
  const input = canvas(); input.views[0].nodes[0].implementation = { status: 'done' };
  assert.throws(() => queryDocument(input), { code: 'SHAPE_INVALID' });
});

test('large implementation observations remain subject to query byte caps and omission markers', () => {
  const input = canvas(), node = input.views[0].nodes[0];
  node.implementation = { status: 'partial', note: '实现范围🙂'.repeat(20000), sources: ['src/x'] };
  const result = queryDocument(input, { view: input.views[0].id, id: node.id, maxBytes: 2048 });
  assert.ok(Buffer.byteLength(serializeQuery(result)) <= 2048);
  assert.equal(result.partial, true);
  assert.ok(result.truncatedPaths.length > 0);
});

test('implementation updates are content changes and apply preserves their meaning and original geometry', () => {
  const base = canvas(), candidate = structuredClone(base), node = candidate.views[0].nodes[0];
  node.implementation = observation('partial'); candidate.revision += '-implementation';
  const diff = diffDocuments(base, candidate);
  assert.deepEqual(diff.summary, { content: 1, layout: 0, metadata: 1 });
  assert.deepEqual(diff.changes.find(change => change.kind === 'node').fields, ['implementation']);
  const dir = mkdtempSync(join(tmpdir(), 'arkigo-implementation-'));
  try {
    const files = ['base.json', 'candidate.json', 'current.json', 'canvas.html'].map(name => join(dir, name));
    for (const [index, value] of [[0, base], [1, candidate], [2, base]]) writeFileSync(files[index], JSON.stringify(value));
    assert.equal(applyCandidate(...files).ok, true);
    const published = JSON.parse(readFileSync(files[2], 'utf8'));
    assert.deepEqual(published, candidate);
    const embedded = JSON.parse(/<script id="arkigo-data" type="application\/json">([\s\S]*?)<\/script>/.exec(readFileSync(files[3], 'utf8'))[1]);
    assert.deepEqual(embedded.document.views[0].nodes[0].implementation, node.implementation);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
