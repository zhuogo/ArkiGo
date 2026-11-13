#!/usr/bin/env node
// Bounded semantic reads. Deliberately does not import the renderer or full validator.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_MAX_BYTES = 12000;
export const MAX_BYTES = 65536;
export const DEFAULT_LIMIT = 20;
const CHECKS = 'identity-reference-hierarchy-only; not full business or layout validation';
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const escapePointer = (value) => value.replaceAll('~', '~0').replaceAll('/', '~1');

export class QueryError extends Error {
  constructor(code, message, path = '', extra = {}) {
    super(message);
    this.code = code;
    this.path = path;
    this.extra = extra;
  }
}
const fail = (code, message, path = '', extra) => { throw new QueryError(code, message, path, extra); };
const requireObject = (value, path) => { if (!object(value)) fail('SHAPE_INVALID', 'Expected an object.', path); };
const requireArray = (value, path) => { if (!Array.isArray(value)) fail('SHAPE_INVALID', 'Expected an array.', path); };
function requireText(value, path, empty = false, canvasId = false) {
  if (typeof value !== 'string' || (!empty && !/\S/u.test(value)) || (canvasId && !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value))) {
    fail('SHAPE_INVALID', canvasId ? 'Expected a canvas identifier.' : 'Expected a string.', path);
  }
}
function strings(value, path) {
  requireArray(value, path);
  value.forEach((entry, index) => requireText(entry, `${path}/${index}`));
}
function identity(map, value, path, canvas = false) {
  requireObject(value, path);
  requireText(value.id, `${path}/id`, false, canvas);
  if (map.has(value.id)) fail('DUPLICATE_ID', 'Identity is duplicated in its scope.', `${path}/id`);
  map.set(value.id, { value, locator: path });
}
function reference(map, id, path, canvas = false) {
  requireText(id, path, false, canvas);
  if (!map.has(id)) fail('REFERENCE_MISSING', 'Referenced identity does not exist.', path);
}
function checkParentCycles(entries, parent, path, code) {
  const complete = new Set();
  for (const id of entries.keys()) {
    const active = new Set();
    let current = id;
    while (current !== null && current !== undefined && !complete.has(current)) {
      if (active.has(current)) fail(code, 'Hierarchy contains a cycle.', path(current));
      active.add(current);
      current = parent(current);
    }
    for (const member of active) complete.add(member);
  }
}
function commonNode(node, path, canvas) {
  requireText(node.title, `${path}/title`);
  requireText(node.summary, `${path}/summary`, canvas);
  requireText(node.kind, `${path}/kind`);
  requireObject(node.details, `${path}/details`);
  if (canvas) strings(node.sources, `${path}/sources`);
  else {
    if (!['system', 'module', 'flow', 'step', 'rule', 'acceptance', 'question'].includes(node.kind)) {
      fail('SHAPE_INVALID', 'Unknown model node kind.', `${path}/kind`);
    }
    requireObject(node.provenance, `${path}/provenance`);
    strings(node.provenance.references, `${path}/provenance/references`);
  }
}

// Checks only the shape necessary to query safely and identity/reference/hierarchy integrity.
// It intentionally does not check business rules, flow reachability, coordinates or overlaps.
export function inspectDocument(document) {
  requireObject(document, '');
  if (!['0.1-draft', 'arkigo-canvas/1'].includes(document.schemaVersion)) {
    fail('UNSUPPORTED_SCHEMA', 'Supported schemas: 0.1-draft and arkigo-canvas/1.', '/schemaVersion');
  }
  requireText(document.revision, '/revision');
  const nodes = [], views = new Map(), byId = new Map(), children = new Map();
  const addNode = (entry) => {
    nodes.push(entry);
    if (!byId.has(entry.value.id)) byId.set(entry.value.id, []);
    byId.get(entry.value.id).push(entry);
  };
  if (document.schemaVersion === '0.1-draft') {
    requireObject(document.project, '/project');
    requireText(document.project.id, '/project/id');
    requireText(document.project.title, '/project/title');
    requireArray(document.nodes, '/nodes');
    requireArray(document.relations, '/relations');
    const identities = new Map(), nodeMap = new Map(), relations = [];
    document.nodes.forEach((value, index) => {
      const locator = `/nodes/${index}`;
      identity(identities, value, locator);
      commonNode(value, locator, false);
      if (value.parentId !== null) requireText(value.parentId, `${locator}/parentId`);
      const entry = { value, locator, relations: [], view: null };
      nodeMap.set(value.id, entry);
      addNode(entry);
    });
    const roots = nodes.filter((entry) => entry.value.parentId === null);
    if (roots.length !== 1) fail('ROOT_COUNT', 'The model must have exactly one root.', '/nodes');
    for (const entry of nodes) {
      const { value, locator } = entry;
      if ((value.kind === 'system') !== (value.parentId === null)) {
        fail('SYSTEM_ROOT', 'Only the system node may be the root.', `${locator}/parentId`);
      }
      if (value.parentId !== null) {
        reference(nodeMap, value.parentId, `${locator}/parentId`);
        if (!children.has(value.parentId)) children.set(value.parentId, []);
        children.get(value.parentId).push(entry);
      }
      if (value.kind === 'flow') {
        reference(nodeMap, value.details.startStepId, `${locator}/details/startStepId`);
        requireArray(value.details.terminalStepIds, `${locator}/details/terminalStepIds`);
        value.details.terminalStepIds.forEach((id, i) => reference(nodeMap, id, `${locator}/details/terminalStepIds/${i}`));
      }
    }
    checkParentCycles(nodeMap, (id) => nodeMap.get(id).value.parentId, (id) => `${nodeMap.get(id).locator}/parentId`, 'PARENT_CYCLE');
    document.relations.forEach((value, index) => {
      const locator = `/relations/${index}`;
      identity(identities, value, locator);
      reference(nodeMap, value.from, `${locator}/from`);
      reference(nodeMap, value.to, `${locator}/to`);
      const entry = { value, locator, nodeMap };
      relations.push(entry);
      nodeMap.get(value.from).relations.push(entry);
      if (value.to !== value.from) nodeMap.get(value.to).relations.push(entry);
    });
    return { document, nodes, views, byId, children, relations };
  }

  requireText(document.id, '/id', false, true);
  requireText(document.title, '/title');
  requireArray(document.views, '/views');
  if (!document.views.length) fail('ROOT_COUNT', 'Canvas must contain a view.', '/views');
  document.views.forEach((value, index) => {
    const locator = `/views/${index}`;
    identity(views, value, locator, true);
    requireText(value.title, `${locator}/title`);
    requireText(value.subtitle, `${locator}/subtitle`, true);
    for (const key of ['nodes', 'edges', 'zones', 'walkthrough']) requireArray(value[key], `${locator}/${key}`);
  });
  const parents = new Map();
  for (const view of views.values()) {
    const ids = new Map(), nodeMap = new Map(), zones = new Map(), edges = new Map();
    view.nodes = [];
    view.value.zones.forEach((value, i) => {
      identity(ids, value, `${view.locator}/zones/${i}`, true);
      zones.set(value.id, value);
    });
    view.value.nodes.forEach((value, i) => {
      const locator = `${view.locator}/nodes/${i}`;
      identity(ids, value, locator, true);
      commonNode(value, locator, true);
      const entry = { value, locator, view, relations: [] };
      nodeMap.set(value.id, entry);
      view.nodes.push(entry);
      addNode(entry);
      if (own(value, 'zoneId')) reference(zones, value.zoneId, `${locator}/zoneId`, true);
      if (own(value, 'targetViewId')) {
        reference(views, value.targetViewId, `${locator}/targetViewId`, true);
        if (value.targetViewId === view.value.id) fail('VIEW_SELF_LINK', 'A view cannot link to itself.', `${locator}/targetViewId`);
        if (parents.has(value.targetViewId)) fail('VIEW_MULTIPLE_PARENTS', 'A child view has more than one parent module.', `${locator}/targetViewId`);
        parents.set(value.targetViewId, view.value.id);
      }
    });
    view.value.edges.forEach((value, i) => {
      const locator = `${view.locator}/edges/${i}`;
      identity(ids, value, locator, true);
      reference(nodeMap, value.from, `${locator}/from`, true);
      reference(nodeMap, value.to, `${locator}/to`, true);
      const entry = { value, locator, nodeMap };
      edges.set(value.id, entry);
      nodeMap.get(value.from).relations.push(entry);
      if (value.from !== value.to) nodeMap.get(value.to).relations.push(entry);
    });
    view.value.walkthrough.forEach((step, i) => {
      const path = `${view.locator}/walkthrough/${i}`;
      requireObject(step, path);
      reference(nodeMap, step.nodeId, `${path}/nodeId`, true);
      if (own(step, 'edgeId')) {
        reference(edges, step.edgeId, `${path}/edgeId`, true);
        const edge = edges.get(step.edgeId).value;
        if (edge.from !== step.nodeId && edge.to !== step.nodeId) fail('WALK_EDGE_UNRELATED', 'Walkthrough edge is unrelated to its node.', `${path}/edgeId`);
      }
    });
  }
  const root = document.rootViewId ?? document.views[0].id;
  reference(views, root, '/rootViewId', true);
  checkParentCycles(views, (id) => parents.get(id), (id) => views.get(id).locator, 'VIEW_CYCLE');
  if (parents.has(root)) fail('ROOT_VIEW_HAS_PARENT', 'The root view cannot have a parent.', '/rootViewId');
  for (const [id, entry] of views) {
    if (id !== root && !parents.has(id)) fail('VIEW_UNREACHABLE', 'A view is outside the root hierarchy.', entry.locator);
  }
  return { document, nodes, views, byId, children };
}

function integer(value, flag, min, max) {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
    fail('ARGUMENT_INVALID', `${flag} must be an integer from ${min} to ${max}.`);
  }
  return Number(value);
}
export function parseArgs(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  const options = {};
  const flags = new Map([['--search', 'search'], ['--view', 'view'], ['--id', 'id'], ['--field', 'field'], ['--offset', 'offset'], ['--limit', 'limit'], ['--max-bytes', 'maxBytes']]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('-')) {
      const key = flags.get(arg);
      if (!key || own(options, key)) fail('ARGUMENT_INVALID', 'Unknown or repeated flag. Use --help for usage.');
      if (i + 1 === args.length || args[i + 1].startsWith('--')) fail('ARGUMENT_INVALID', 'A flag value is missing.');
      options[key] = args[++i];
    } else {
      if (own(options, 'input')) fail('ARGUMENT_INVALID', 'Provide exactly one input JSON file.');
      options.input = arg;
    }
  }
  if (!options.input) fail('ARGUMENT_INVALID', 'Provide an input JSON file.');
  return normalizeOptions(options);
}
function normalizeOptions(options) {
  const out = { ...options };
  out.offset = integer(out.offset ?? 0, '--offset', 0, Number.MAX_SAFE_INTEGER);
  out.limit = integer(out.limit ?? DEFAULT_LIMIT, '--limit', 1, 100);
  out.maxBytes = integer(out.maxBytes ?? DEFAULT_MAX_BYTES, '--max-bytes', 1024, MAX_BYTES);
  for (const key of ['search', 'view', 'id']) if (own(out, key)) requireText(out[key], `--${key}`);
  if (own(out, 'field') && (typeof out.field !== 'string' || (out.field !== '' && !out.field.startsWith('/')) || /~(?![01])/u.test(out.field))) {
    fail('ARGUMENT_INVALID', '--field must be an absolute RFC 6901 JSON pointer (empty means the document).');
  }
  if (own(out, 'search') && (own(out, 'id') || own(out, 'field'))) fail('ARGUMENT_INVALID', '--search may combine with --view, but not --id or --field.');
  return out;
}

// JSON representation bytes, rather than code points or tokens, determine all budgets.
// No full serialization of a potentially enormous user value is needed to make its preview.
function boundedString(value, budget) {
  let end = Math.min(value.length, budget);
  const prefix = (n) => value.slice(0, n > 0 && /[\uD800-\uDBFF]/.test(value[n - 1]) ? n - 1 : n);
  let candidate = prefix(end);
  if (candidate.length === value.length && bytes(candidate) <= budget) return { value, truncated: false };
  let lo = 0, hi = end;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (bytes(prefix(mid) + '…') <= budget) lo = mid;
    else hi = mid - 1;
  }
  candidate = budget >= 5 ? prefix(lo) + '…' : '';
  return { value: candidate, truncated: true };
}
export function boundedValue(value, budget, depth = 0) {
  budget = Math.max(2, Math.floor(budget));
  if (typeof value === 'string') return boundedString(value, budget);
  if (value === null || typeof value !== 'object') {
    const safe = value === undefined ? null : value;
    return bytes(safe) <= budget ? { value: safe, truncated: false } : { value: {}, truncated: true };
  }
  const array = Array.isArray(value), result = array ? [] : Object.create(null);
  if (depth >= 10) return { value: result, truncated: true };
  let used = 2, truncated = false, count = 0;
  const keys = array ? value.keys() : Object.keys(value);
  for (const key of keys) {
    const overhead = (count ? 1 : 0) + (array ? 0 : (typeof key === 'string' && key.length <= budget ? bytes(key) + 1 : budget + 1));
    const available = budget - used - overhead;
    if (available < 4) { truncated = true; break; }
    const child = boundedValue(value[key], available, depth + 1);
    if (array) result.push(child.value); else result[key] = child.value;
    used += overhead + bytes(child.value);
    count++;
    truncated ||= child.truncated;
  }
  return { value: result, truncated };
}

function boundRecord(record, budget) {
  const locator = boundedString(record.locator ?? '', 120);
  const role = boundedString(record.role ?? 'item', 32);
  const result = { role: role.value, locator: locator.value };
  if (record.projection) result.projection = boundedString(record.projection, 40).value;
  if (locator.truncated) result.locatorTruncated = true;
  const preview = boundedValue(record.value, Math.max(4, budget - bytes(result) - 35));
  result.value = preview.value;
  if (preview.truncated || locator.truncated || role.truncated) result.omitted = true;
  return result;
}

// Each row is consumed only when it is present in output, even if its value is a preview.
// Consumers can share this utility without importing a renderer or a schema validator.
export function boundedPage({ schemaVersion, mode, metadata = {}, target, items = [], offset = 0, limit = DEFAULT_LIMIT, maxBytes = DEFAULT_MAX_BYTES }) {
  ({ offset, limit, maxBytes } = normalizeOptions({ offset, limit, maxBytes }));
  const result = {
    schemaVersion: boundedString(String(schemaVersion ?? ''), 60).value,
    mode: boundedString(String(mode ?? ''), 40).value,
    checks: CHECKS,
    metadata: boundedValue(metadata, Math.min(1000, Math.floor(maxBytes / 10))).value,
    items: [],
    pagination: { offset, limit, total: items.length, returned: 0, nextOffset: null },
    truncatedPaths: [],
  };
  const metadataPreview = boundedValue(metadata, Math.min(1000, Math.floor(maxBytes / 10)));
  result.metadata = metadataPreview.value;
  if (metadataPreview.truncated) result.truncatedPaths.push('');
  if (target) result.target = boundRecord(target, Math.floor(maxBytes / 3));
  const note = 'Values at truncatedPaths are previews; use --field with an exact input JSON pointer or a higher --max-bytes. Summary projections omit semantic details. No recursive expansion.';
  const update = () => {
    result.pagination.returned = result.items.length;
    result.pagination.nextOffset = offset + result.items.length < items.length ? offset + result.items.length : null;
    result.truncatedPaths = [...new Set([
      ...(metadataPreview.truncated ? [''] : []),
      ...(result.target?.omitted ? [result.target.locator] : []),
      ...result.items.filter((row) => row.omitted).map((row) => row.locator),
    ])];
    result.partial = result.truncatedPaths.length > 0 || offset > 0 || result.pagination.nextOffset !== null;
    if (result.truncatedPaths.length) result.note = note; else delete result.note;
  };
  update();
  for (let i = offset; i < items.length && result.items.length < limit; i++) {
    let added = false;
    const remaining = maxBytes - bytes(result) - 1;
    for (const allowance of [...new Set([Math.min(mode === 'field' ? maxBytes : 2400, remaining - 250), Math.min(700, remaining - 250), 200, 80])]) {
      if (allowance < 4) continue;
      result.items.push(boundRecord(items[i], allowance));
      update();
      if (bytes(result) + 1 <= maxBytes) { added = true; break; }
      result.items.pop();
      update();
    }
    if (!added) break;
  }
  // At the minimum budget a large target/metadata can crowd out every row. Shrink
  // those previews, retaining all locators and the exact pagination contract.
  if (bytes(result) + 1 > maxBytes || (offset < items.length && !result.items.length)) {
    result.metadata = {};
    metadataPreview.truncated = Object.keys(metadata).length > 0;
    if (target) result.target = boundRecord(target, 80);
    update();
    if (offset < items.length && !result.items.length) {
      result.items.push(boundRecord(items[offset], 80));
      update();
    }
  }
  if (bytes(result) + 1 > maxBytes) {
    // This fallback only affects unusually long caller-supplied locators/roles.
    if (result.target) result.target = { role: 'target', locator: boundedString(target.locator ?? '', 60).value, value: {}, omitted: true };
    result.items = result.items.slice(0, 1).map((row) => ({ role: 'item', locator: boundedString(row.locator, 60).value, value: {}, omitted: true }));
    update();
  }
  if (bytes(result) + 1 > maxBytes) fail('BUDGET_TOO_SMALL', 'Response metadata cannot fit the requested byte budget.');
  return result;
}
export const serializeQuery = (result) => JSON.stringify(result) + '\n';

function summary(entry, role = 'node') {
  const n = entry.value;
  const value = { id: n.id, title: n.title, kind: n.kind, summary: n.summary };
  if (entry.view) value.viewId = entry.view.value.id;
  for (const key of ['parentId', 'targetViewId', 'designStatus']) if (own(n, key)) value[key] = n[key];
  value.sources = n.sources ?? n.provenance?.references ?? [];
  return { role, locator: entry.locator, projection: 'summary', value };
}
function semantic(entry) {
  const value = {};
  for (const key of ['id', 'kind', 'title', 'summary', 'parentId', 'targetViewId', 'designStatus', 'sourceOrigin', 'provenance', 'sources', 'details']) {
    if (own(entry.value, key)) value[key] = entry.value[key];
  }
  if (entry.view) value.viewId = entry.view.value.id;
  return { role: 'target', locator: entry.locator, projection: 'semantic', value };
}
export function selectPointer(document, pointer) {
  let value = document;
  if (!pointer) return value;
  for (const segment of pointer.slice(1).split('/')) {
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (value === null || typeof value !== 'object' || !own(value, key) || (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key))) {
      fail('FIELD_NOT_FOUND', 'JSON pointer does not resolve to an input field.', pointer);
    }
    value = value[key];
  }
  return value;
}

export function queryDocument(document, options = {}) {
  const opts = normalizeOptions(options), index = inspectDocument(document);
  let mode = 'index', items, target, selectedView, selectedNode;
  if (own(opts, 'view')) {
    if (document.schemaVersion !== 'arkigo-canvas/1') fail('VIEW_NOT_SUPPORTED', 'Model documents have no native views; use --id for a module or flow.');
    selectedView = index.views.get(opts.view);
    if (!selectedView) fail('VIEW_NOT_FOUND', 'Requested view does not exist.');
  }
  if (own(opts, 'id')) {
    const candidates = (index.byId.get(opts.id) ?? []).filter((entry) => !selectedView || entry.view === selectedView);
    if (!candidates.length) fail('ID_NOT_FOUND', 'Requested node does not exist in the selected scope.');
    if (candidates.length !== 1) fail('AMBIGUOUS_ID', 'Node ID occurs in multiple views; supply --view.', '', {
      totalCandidates: candidates.length,
      candidates: candidates.slice(0, 20).map((entry) => ({ locator: entry.locator, viewId: entry.view.value.id })),
      candidatesOmitted: Math.max(0, candidates.length - 20),
    });
    [selectedNode] = candidates;
  }
  if (own(opts, 'field')) {
    const scope = selectedNode?.locator ?? selectedView?.locator;
    if (scope && opts.field !== scope && !opts.field.startsWith(`${scope}/`)) fail('FIELD_OUTSIDE_SCOPE', '--field must point within the selected node or view.');
    mode = 'field';
    items = [{ role: 'field', locator: opts.field, projection: 'exact-field', value: selectPointer(document, opts.field) }];
  } else if (selectedNode) {
    mode = 'node';
    target = semantic(selectedNode);
    const neighbors = new Map();
    items = selectedNode.relations.map((entry) => {
      const otherId = entry.value.from === selectedNode.value.id ? entry.value.to : entry.value.from;
      if (otherId !== selectedNode.value.id) neighbors.set(otherId, entry.nodeMap.get(otherId));
      return { role: 'relation', locator: entry.locator, projection: 'semantic', value: entry.value };
    });
    for (const entry of neighbors.values()) items.push(summary(entry, 'neighbor'));
    const immediate = selectedNode.view
      ? (index.views.get(selectedNode.value.targetViewId)?.nodes ?? [])
      : (index.children.get(selectedNode.value.id) ?? []);
    // Avoid spreading potentially unbounded child arrays into a function call.
    for (const entry of immediate) items.push(summary(entry, 'child'));
  } else if (own(opts, 'search')) {
    mode = 'search';
    const needle = opts.search.toLocaleLowerCase();
    const matches = (value) => [value.id, value.title, value.summary, value.kind].some((text) => text.toLocaleLowerCase().includes(needle))
      || (value.sources ?? value.provenance?.references ?? []).some((text) => text.toLocaleLowerCase().includes(needle));
    items = (selectedView?.nodes ?? index.nodes).filter(({ value }) => matches(value)).map((entry) => summary(entry));
  } else if (selectedView) {
    mode = 'view';
    items = selectedView.nodes.map((entry) => summary(entry));
  } else if (document.schemaVersion === '0.1-draft') {
    items = index.nodes.filter(({ value }) => ['module', 'flow'].includes(value.kind)).map((entry) => summary(entry));
  } else {
    items = Array.from(index.views.values(), (entry) => ({ role: 'view', locator: entry.locator, projection: 'summary', value: {
      id: entry.value.id, title: entry.value.title, summary: entry.value.subtitle, nodeCount: entry.nodes.length,
    } }));
  }
  const metadata = document.schemaVersion === '0.1-draft'
    ? { project: document.project, revision: document.revision }
    : { id: document.id, title: document.title, revision: document.revision, description: document.description, rootViewId: document.rootViewId ?? document.views[0].id };
  return boundedPage({ schemaVersion: document.schemaVersion, mode, metadata, target, items, ...opts });
}
export function queryFile(file, options = {}) {
  let source;
  try { source = readFileSync(file, 'utf8'); }
  catch { fail('FILE_READ_ERROR', 'Unable to read the input JSON file.'); }
  let document;
  try { document = JSON.parse(source.replace(/^\uFEFF/u, '')); }
  catch { fail('JSON_PARSE_ERROR', 'Input is not valid JSON.'); }
  return queryDocument(document, options);
}
export function diagnostic(error, maxBytes = DEFAULT_MAX_BYTES) {
  const report = { ok: false, code: error instanceof QueryError ? error.code : 'QUERY_ERROR', message: error instanceof QueryError ? error.message : 'Unable to query the input.', path: error.path ?? '', ...(error.extra ?? {}) };
  const bounded = boundedValue(report, Math.min(maxBytes - 100, 6000));
  return serializeQuery(bounded.truncated ? { ...bounded.value, omitted: true } : bounded.value);
}
export function main(args, io = { stdout: process.stdout, stderr: process.stderr }) {
  let opts;
  try {
    opts = parseArgs(args);
    if (opts.help) {
      io.stdout.write('Usage: node query.mjs <input.json> [--search text] [--view id] [--id nodeId] [--field JSON-pointer] [--offset n] [--limit n] [--max-bytes n]\nSearch combines with view; id combines with view; field is an absolute input JSON pointer and may narrow id/view. Output cap includes the final LF: default 12000, range 1024..65536 bytes. Limit: default 20, range 1..100. Checks cover identity, references, and hierarchy only.\n');
      return 0;
    }
    io.stdout.write(serializeQuery(queryFile(opts.input, opts)));
    return 0;
  } catch (error) {
    io.stderr.write(diagnostic(error, opts?.maxBytes));
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
