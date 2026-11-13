import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { boundedPage, boundedValue, diagnostic, inspectDocument, main, parseArgs, queryDocument, queryFile, serializeQuery } from '../scripts/query.mjs';

const cli = fileURLToPath(new URL('../scripts/query.mjs', import.meta.url));
const makeNode = (id, kind = 'module', parentId = 'root') => ({ id, kind, title: `Title ${id}`, summary: `Summary ${id}`, parentId, designStatus: 'proposed', provenance: { origin: 'example', references: [`src/${id}.mjs`] }, details: { note: `Detail ${id}` } });
function model(count = 3) {
  return { schemaVersion: '0.1-draft', project: { id: 'demo', title: 'Demo', goal: 'Example', scope: [], assumptions: [] }, revision: 'r1', nodes: [makeNode('root', 'system', null), ...Array.from({ length: count }, (_, i) => makeNode(`m${i}`))], relations: [] };
}
const canvasNode = (id) => ({ id, title: `Title ${id}`, summary: `Summary ${id}`, kind: 'module', x: 0, y: 0, details: { note: `Detail ${id}` }, sources: [`src/${id}.mjs`] });
const view = (id, count = 3) => ({ id, title: `View ${id}`, subtitle: `Subtitle ${id}`, zones: [], nodes: Array.from({ length: count }, (_, i) => canvasNode(`n${i}`)), edges: [], walkthrough: [] });
function canvas(count = 3) {
  return { schemaVersion: 'arkigo-canvas/1', id: 'canvas', revision: 'r1', title: 'Demo', description: '', views: [view('overview', count)] };
}
function nestedCanvas() {
  const doc = canvas();
  doc.views[0].nodes[0].targetViewId = 'child';
  doc.views.push(view('child'));
  return doc;
}
const expectError = (fn, code) => assert.throws(fn, (error) => error.code === code);
const encodedBytes = (value) => Buffer.byteLength(serializeQuery(value));
const freeze = (value) => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; };

test('default model index lists modules and flows, not their details', () => {
  const input = model();
  input.nodes.push({ ...makeNode('flow', 'flow'), details: { startStepId: 'step', terminalStepIds: ['step'] } });
  input.nodes.push(makeNode('step', 'step', 'flow'));
  const result = queryDocument(input);
  assert.equal(result.mode, 'index');
  assert.deepEqual(result.items.map((row) => row.value.id), ['m0', 'm1', 'm2', 'flow']);
  assert.equal(result.items[0].projection, 'summary');
  assert.equal('details' in result.items[0].value, false);
  assert.match(result.checks, /not full business or layout validation/);
});

test('canvas index lists views, and --view narrows to node summaries', () => {
  const input = nestedCanvas();
  assert.deepEqual(queryDocument(input).items.map((row) => row.value.id), ['overview', 'child']);
  const result = queryDocument(input, { view: 'child' });
  assert.equal(result.mode, 'view');
  assert.equal(result.items.length, 3);
  assert.ok(result.items.every((row) => row.value.viewId === 'child'));
  expectError(() => queryDocument(input, { view: 'unknown' }), 'VIEW_NOT_FOUND');
  expectError(() => queryDocument(model(), { view: 'm0' }), 'VIEW_NOT_SUPPORTED');
});

test('search covers IDs, titles, summaries, and source paths, but not semantic details', () => {
  const input = model();
  input.nodes[1].title = 'Authentication';
  input.nodes[2].summary = 'Special summary';
  input.nodes[3].provenance.references = ['src/credential-store.mjs'];
  input.nodes[1].details.note = 'Secret-only-details';
  for (const [search, expected] of [['AUTHENTICATION', 'm0'], ['special', 'm1'], ['credential-store', 'm2'], ['m2', 'm2']]) {
    assert.equal(queryDocument(input, { search }).items[0].value.id, expected);
  }
  assert.equal(queryDocument(input, { search: 'Secret-only-details' }).pagination.total, 0);
  const canv = nestedCanvas();
  canv.views[1].nodes[0].sources.push('src/target.ts');
  assert.equal(queryDocument(canv, { search: 'target.ts', view: 'overview' }).pagination.total, 0);
  assert.equal(queryDocument(canv, { search: 'target.ts', view: 'child' }).pagination.total, 1);
});

test('ID query returns semantic detail, one-hop relations/neighbors, and immediate children only', () => {
  const input = model(4);
  input.nodes[2].parentId = 'm0';
  input.nodes[3].parentId = 'm1';
  input.relations = [
    { id: 'r1', kind: 'depends_on', from: 'm0', to: 'm3' },
    { id: 'r2', kind: 'depends_on', from: 'm3', to: 'm2' },
    { id: 'r3', kind: 'depends_on', from: 'm0', to: 'm3' },
  ];
  const result = queryDocument(input, { id: 'm0' });
  assert.equal(result.target.value.details.note, 'Detail m0');
  assert.deepEqual(result.items.map((row) => [row.role, row.value.id]), [['relation', 'r1'], ['relation', 'r3'], ['neighbor', 'm3'], ['child', 'm1']]);
  assert.equal(result.items.some((row) => row.value.id === 'm2'), false);
});

test('canvas child-view nodes are immediate children and are not recursively expanded', () => {
  const input = nestedCanvas();
  input.views[1].nodes[0].targetViewId = 'grandchild';
  input.views.push(view('grandchild'));
  const result = queryDocument(input, { id: 'n0', view: 'overview' });
  assert.equal(result.items.length, 3);
  assert.ok(result.items.every((row) => row.role === 'child' && row.value.viewId === 'child'));
});

test('duplicate node IDs across views require explicit disambiguation', () => {
  const input = nestedCanvas();
  assert.throws(() => queryDocument(input, { id: 'n0' }), (error) => {
    assert.equal(error.code, 'AMBIGUOUS_ID');
    assert.deepEqual(error.extra.candidates.map((row) => row.viewId), ['overview', 'child']);
    return true;
  });
  assert.equal(queryDocument(input, { id: 'n0', view: 'child' }).target.locator, '/views/1/nodes/0');
  expectError(() => queryDocument(input, { id: 'absent' }), 'ID_NOT_FOUND');
});

test('RFC 6901 field retrieval supports escaped keys, null, and scoped selection', () => {
  const input = model();
  input.nodes[1].details['a/b~c'] = { empty: '', value: null };
  assert.equal(queryDocument(input, { field: '/nodes/1/details/a~1b~0c/empty' }).items[0].value, '');
  assert.equal(queryDocument(input, { id: 'm0', field: '/nodes/1/details/a~1b~0c/value' }).items[0].value, null);
  expectError(() => queryDocument(input, { id: 'm0', field: '/nodes/2' }), 'FIELD_OUTSIDE_SCOPE');
  expectError(() => queryDocument(input, { field: '/nodes/01' }), 'FIELD_NOT_FOUND');
  expectError(() => queryDocument(input, { field: '/nodes/1/details/toString' }), 'FIELD_NOT_FOUND');
  expectError(() => queryDocument(input, { field: '/missing' }), 'FIELD_NOT_FOUND');
  assert.equal(queryDocument(input, { field: '' }).items[0].value.schemaVersion, '0.1-draft');
});

test('UTF-8 cap includes newline for Chinese, emoji, quotes, escapes, and enormous metadata', () => {
  const input = model(35), huge = '中文😀"\\\n\u0000'.repeat(18000);
  input.project = { id: huge, title: huge, goal: huge, scope: [huge], assumptions: [huge] };
  input.revision = huge;
  for (const node of input.nodes.slice(1)) {
    node.title = huge;
    node.summary = huge;
    node.details = { huge, [huge]: huge };
    node.provenance.references = [huge];
  }
  for (const maxBytes of [1024, 2048, 12000, 65536]) {
    for (const options of [{}, { id: 'm0' }, { field: '/nodes/1/details/huge' }]) {
      const result = queryDocument(input, { ...options, maxBytes, limit: 100 });
      assert.ok(encodedBytes(result) <= maxBytes, `${encodedBytes(result)} > ${maxBytes}`);
      assert.ok(result.truncatedPaths.length > 0);
      assert.equal(result.partial, true);
      assert.match(result.note, /--field/);
      assert.equal(JSON.stringify(JSON.parse(serializeQuery(result))), JSON.stringify(result));
      if (options.id) assert.equal(result.target.locator, '/nodes/1');
    }
  }
  assert.ok(encodedBytes(queryDocument(input)) <= 12000);
});

test('huge identifiers and source paths stay bounded while preserving a stable locator', () => {
  const input = model(1), longId = '中😀'.repeat(30000);
  input.nodes[1].id = longId;
  const result = queryDocument(input, { id: longId, maxBytes: 1024 });
  assert.equal(result.target.locator, '/nodes/1');
  assert.equal(result.target.omitted, true);
  assert.ok(encodedBytes(result) <= 1024);
  assert.ok(result.truncatedPaths.includes('/nodes/1'));
});

test('large field budget retrieves a value beyond ordinary summary size', () => {
  const input = model(1);
  input.nodes[1].details.note = '汉😀'.repeat(4000);
  const small = queryDocument(input, { field: '/nodes/1/details/note' });
  const large = queryDocument(input, { field: '/nodes/1/details/note', maxBytes: 65536 });
  assert.equal(small.items[0].omitted, true);
  assert.equal(large.items[0].value, input.nodes[1].details.note);
  assert.deepEqual(large.truncatedPaths, []);
});

test('pagination advances only through rows actually returned under the byte cap', () => {
  const input = model(57), seen = [];
  input.nodes.slice(1).forEach((node) => { node.title = '标题😀'.repeat(1000); });
  let offset = 0, iterations = 0;
  do {
    const result = queryDocument(input, { offset, limit: 17, maxBytes: 1024 });
    assert.equal(result.pagination.total, 57);
    assert.ok(result.items.length > 0 && result.items.length <= 17);
    assert.ok(encodedBytes(result) <= 1024);
    seen.push(...result.items.map((row) => row.locator));
    if (result.pagination.nextOffset !== null) assert.equal(result.pagination.nextOffset, offset + result.items.length);
    offset = result.pagination.nextOffset;
    iterations++;
    assert.ok(iterations <= 57);
  } while (offset !== null);
  assert.deepEqual(seen, Array.from({ length: 57 }, (_, i) => `/nodes/${i + 1}`));
  const empty = queryDocument(input, { offset: 100 });
  assert.deepEqual(empty.items, []);
  assert.equal(empty.pagination.nextOffset, null);
});

test('item limit defaults to 20, has hard maximum 100, and counts related rows too', () => {
  const input = model(120);
  assert.equal(queryDocument(input).pagination.returned, 20);
  assert.equal(queryDocument(input, { limit: 100, maxBytes: 65536 }).pagination.returned, 100);
  input.relations = input.nodes.slice(2).map((node, i) => ({ id: `r${i}`, kind: 'depends_on', from: 'm0', to: node.id }));
  const result = queryDocument(input, { id: 'm0', limit: 7 });
  assert.equal(result.pagination.returned, 7);
  assert.equal(result.pagination.total, 238);
  assert.equal(result.pagination.nextOffset, 7);
});

test('10,000-node model query is bounded and does not run flow/business validation', () => {
  const input = model(9999);
  input.relations = input.nodes.slice(2).map((node, i) => ({ id: `r${i}`, kind: 'depends_on', from: 'm0', to: node.id }));
  const start = performance.now();
  const result = queryDocument(input, { id: 'm0' });
  assert.equal(result.pagination.total, 19996);
  assert.ok(result.items.length <= 20);
  assert.ok(encodedBytes(result) <= 12000);
  assert.ok(performance.now() - start < 5000, 'linear query smoke budget (not rendered-graph performance)');
});

test('10,000-node canvas can be queried despite overlapping coordinates', () => {
  const input = canvas(10000);
  input.views[0].edges = input.views[0].nodes.slice(1).map((node, i) => ({ id: `e${i}`, from: 'n0', to: node.id, kind: 'relation', label: '' }));
  const result = queryDocument(input, { view: 'overview', id: 'n0' });
  assert.equal(result.pagination.total, 19998);
  assert.ok(encodedBytes(result) <= 12000);
  assert.equal(result.target.value.id, 'n0');
});

test('source arrays and deep details do not require argument spreading or recursive expansion', () => {
  const input = model(1);
  input.nodes[1].provenance.references = Array.from({ length: 150000 }, (_, i) => `src/${i}`);
  input.nodes[1].details = { nested: {} };
  let cursor = input.nodes[1].details.nested;
  for (let i = 0; i < 1000; i++) { cursor.child = {}; cursor = cursor.child; }
  const result = queryDocument(input, { search: 'src/149999' });
  assert.equal(result.pagination.total, 1);
  assert.ok(encodedBytes(result) <= 12000);
  assert.ok(queryDocument(input, { id: 'm0' }).target.omitted);
});

test('read-only queries do not mutate either supported input format', () => {
  for (const input of [model(), nestedCanvas()]) {
    const before = JSON.stringify(input);
    freeze(input);
    queryDocument(input);
    queryDocument(input, { search: 'title' });
    queryDocument(input, { field: '' });
    assert.equal(JSON.stringify(input), before);
  }
});

test('BOM files are accepted and left byte-for-byte unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arkigo-query-'));
  try {
    const file = join(dir, 'bom.json');
    const original = '\uFEFF' + JSON.stringify(model());
    writeFileSync(file, original);
    assert.equal(queryFile(file).pagination.total, 3);
    const processResult = spawnSync(process.execPath, [cli, file, '--max-bytes', '1024'], { encoding: 'utf8' });
    assert.equal(processResult.status, 0);
    assert.equal(processResult.stderr, '');
    assert.ok(Buffer.byteLength(processResult.stdout) <= 1024);
    assert.equal(JSON.parse(processResult.stdout).mode, 'index');
    assert.equal(readFileSync(file, 'utf8'), original);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('malformed files produce compact JSON diagnostics on stderr and empty stdout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arkigo-query-invalid-'));
  try {
    const file = join(dir, 'invalid.json');
    writeFileSync(file, '{broken ' + '中'.repeat(10000));
    for (const args of [[file], [join(dir, 'missing.json')], [file, '--unknown'], [file, '--limit', '1000']]) {
      const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, '');
      assert.equal(JSON.parse(result.stderr).ok, false);
      assert.ok(Buffer.byteLength(result.stderr) < 1024);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI rejects unknown, repeated, missing, malformed and incompatible flags', () => {
  for (const args of [[], ['x', 'y'], ['x', '--unknown'], ['x', '-x'], ['x', '--limit'], ['x', '--limit', '1', '--limit', '2'], ['x', '--limit=5'], ['x', '--search', ''], ['x', '--search', 'a', '--id', 'm0'], ['x', '--search', 'a', '--field', '/nodes'], ['x', '--field', 'nodes'], ['x', '--field', '/bad~2'], ['x', '--offset', '-1'], ['x', '--limit', '0'], ['x', '--limit', '101'], ['x', '--limit', '1.2'], ['x', '--offset', '1e2'], ['x', '--offset', '9007199254740992'], ['x', '--max-bytes', '1023'], ['x', '--max-bytes', '65537']]) {
    assert.throws(() => parseArgs(args), undefined, args.join(' '));
  }
  assert.equal(parseArgs(['x', '--max-bytes', '65536']).maxBytes, 65536);
  assert.equal(parseArgs(['x', '--max-bytes', '1024']).maxBytes, 1024);
  assert.equal(parseArgs(['x', '--field', '']).field, '');
  assert.deepEqual(parseArgs(['--help']), { help: true });
});

test('unsupported schema and malformed identity structures fail explicitly', () => {
  for (const value of [null, [], {}, { schemaVersion: 'future' }]) assert.throws(() => inspectDocument(value));
  const duplicate = model(); duplicate.nodes[2].id = duplicate.nodes[1].id;
  expectError(() => queryDocument(duplicate), 'DUPLICATE_ID');
  const collision = model(); collision.relations.push({ id: 'm0', from: 'm0', to: 'm1' });
  expectError(() => queryDocument(collision), 'DUPLICATE_ID');
  const badNode = model(); badNode.nodes[1].id = '';
  expectError(() => queryDocument(badNode), 'SHAPE_INVALID');
  const badSources = canvas(); badSources.views[0].nodes[0].sources = [null];
  expectError(() => queryDocument(badSources), 'SHAPE_INVALID');
});

test('model rejects dangling references, broken roots, and parent cycles', () => {
  const dangling = model(); dangling.nodes[1].parentId = 'absent';
  expectError(() => queryDocument(dangling), 'REFERENCE_MISSING');
  const edge = model(); edge.relations.push({ id: 'r', kind: 'depends_on', from: 'm0', to: 'absent' });
  expectError(() => queryDocument(edge), 'REFERENCE_MISSING');
  const flow = model(); flow.nodes[1].kind = 'flow'; flow.nodes[1].details = { startStepId: 'missing', terminalStepIds: ['m1'] };
  expectError(() => queryDocument(flow), 'REFERENCE_MISSING');
  const cycle = model(); cycle.nodes[1].parentId = 'm1'; cycle.nodes[2].parentId = 'm0';
  expectError(() => queryDocument(cycle), 'PARENT_CYCLE');
  const roots = model(); roots.nodes[1].parentId = null;
  expectError(() => queryDocument(roots), 'ROOT_COUNT');
  const wrongRoot = model(); wrongRoot.nodes[0].kind = 'module';
  expectError(() => queryDocument(wrongRoot), 'SYSTEM_ROOT');
});

test('canvas rejects missing references and invalid view hierarchy', () => {
  const cases = [
    [(doc) => { doc.views[0].nodes[0].targetViewId = 'missing'; }, 'REFERENCE_MISSING'],
    [(doc) => { doc.views[0].nodes[0].zoneId = 'missing'; }, 'REFERENCE_MISSING'],
    [(doc) => { doc.views[0].edges.push({ id: 'e', from: 'n0', to: 'missing' }); }, 'REFERENCE_MISSING'],
    [(doc) => { doc.views[0].walkthrough.push({ nodeId: 'missing' }); }, 'REFERENCE_MISSING'],
    [(doc) => { doc.views[0].walkthrough.push({ nodeId: 'n0', edgeId: 'missing' }); }, 'REFERENCE_MISSING'],
    [(doc) => { doc.views[0].nodes[0].targetViewId = 'overview'; }, 'VIEW_SELF_LINK'],
    [(doc) => { doc.views[0].nodes[1].targetViewId = 'child'; }, 'VIEW_MULTIPLE_PARENTS'],
    [(doc) => { doc.views[1].nodes[0].targetViewId = 'overview'; }, 'VIEW_CYCLE'],
    [(doc) => { delete doc.views[0].nodes[0].targetViewId; }, 'VIEW_UNREACHABLE'],
    [(doc) => { doc.rootViewId = 'child'; }, 'ROOT_VIEW_HAS_PARENT'],
    [(doc) => { doc.views[1].id = 'overview'; }, 'DUPLICATE_ID'],
  ];
  for (const [mutate, code] of cases) { const input = nestedCanvas(); mutate(input); expectError(() => queryDocument(input), code); }
});

test('query shape checks do not claim to validate all business semantics', () => {
  const input = model();
  input.nodes[1].kind = 'flow';
  input.nodes[1].details = { startStepId: 'm1', terminalStepIds: ['m2'] };
  // Existing identities are queryable; flow-step kinds/reachability need validate.mjs.
  assert.equal(queryDocument(input).mode, 'index');
});

test('deep model hierarchy is checked iteratively without call-stack overflow', () => {
  const input = model(10000);
  for (let i = 2; i < input.nodes.length; i++) input.nodes[i].parentId = input.nodes[i - 1].id;
  assert.equal(queryDocument(input, { id: 'm9998' }).items[0].value.id, 'm9999');
});

test('bounded output handles huge object keys and prototype-like field names safely', () => {
  const input = model(1);
  input.nodes[1].details = JSON.parse('{"__proto__":"safe","constructor":"safe"}');
  input.nodes[1].details['a'.repeat(100000)] = 'huge key';
  const result = queryDocument(input, { field: '/nodes/1/details', maxBytes: 1024 });
  assert.ok(encodedBytes(result) <= 1024);
  assert.equal(result.items[0].value.__proto__, 'safe');
  assert.equal(result.items[0].omitted, true);
  assert.equal(queryDocument(input, { field: '/nodes/1/details/__proto__' }).items[0].value, 'safe');
});

test('generic bounding utility and diagnostics cap adversarial metadata and locators', () => {
  const huge = '😀"\u0000'.repeat(10000);
  for (const maxBytes of [1024, 12000, 65536]) {
    const result = boundedPage({ schemaVersion: 'test', mode: 'test', metadata: { huge }, target: { locator: huge, role: huge, value: { huge } }, items: [{ locator: huge, role: huge, value: huge }], maxBytes });
    assert.ok(encodedBytes(result) <= maxBytes);
    assert.equal(result.items.length, 1);
    assert.ok(result.partial);
  }
  assert.ok(Buffer.byteLength(diagnostic(Object.assign(new Error(huge), { path: huge }), 1024)) <= 1024);
  const result = boundedValue(huge, 200);
  assert.ok(Buffer.byteLength(JSON.stringify(result.value)) <= 200);
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(boundedValue(null, 2).value)) <= 2);
});

test('exact field with an oversized pointer discloses locator truncation', () => {
  const input = model(1), key = 'key'.repeat(10000);
  input.nodes[1].details[key] = 'retrieved';
  const result = queryDocument(input, { field: `/nodes/1/details/${key}`, maxBytes: 1024 });
  assert.equal(result.items[0].value, 'retrieved');
  assert.equal(result.items[0].locatorTruncated, true);
  assert.equal(result.items[0].omitted, true);
  assert.ok(encodedBytes(result) <= 1024);
});

test('large ambiguity diagnostics retain candidate locators and disclose omitted candidates', () => {
  const input = canvas(30);
  for (let i = 0; i < 30; i++) {
    const childId = `child${i}-` + 'x'.repeat(5000);
    input.views[0].nodes[i].targetViewId = childId;
    input.views.push(view(childId, 1));
  }
  assert.throws(() => queryDocument(input, { id: 'n0' }), (error) => {
    const output = diagnostic(error, 1024), parsed = JSON.parse(output);
    assert.equal(parsed.code, 'AMBIGUOUS_ID');
    assert.equal(parsed.totalCandidates, 31);
    assert.equal(parsed.omitted, true);
    assert.equal(parsed.candidates[0].locator, '/views/0/nodes/0');
    assert.ok(Buffer.byteLength(output) <= 1024);
    return true;
  });
});

test('CLI entrypoint is testable with injected streams', () => {
  let stdout = '', stderr = '';
  const io = { stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } } };
  assert.equal(main(['--help'], io), 0);
  assert.match(stdout, /12000/);
  stdout = '';
  assert.equal(main(['x', '--limit', '0'], io), 1);
  assert.equal(stdout, '');
  assert.equal(JSON.parse(stderr).code, 'ARGUMENT_INVALID');
});

test('existing repository examples remain queryable with bounded output', () => {
  for (const name of ['login.base.json', 'login.candidate.json']) {
    const input = JSON.parse(readFileSync(new URL(`../../../docs/examples/${name}`, import.meta.url), 'utf8'));
    const result = queryDocument(input);
    assert.ok(result.items.length > 0);
    assert.ok(encodedBytes(result) <= 12000);
  }
});
