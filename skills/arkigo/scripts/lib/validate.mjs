import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pointer, fail, CliError } from './errors.mjs';
import { readJson } from './io.mjs';
import { containedFile } from './paths.mjs';
import { implementable, ownerId, relationKey, indexDesign } from './design.mjs';
import { isFile } from './evidence.mjs';
import { references } from './inline.mjs';

const require = createRequire(import.meta.url);
let ajv;
const schemas = new Map();
const directory = new URL('../../schemas/', import.meta.url);

function schema(name) {
  if (schemas.has(name)) return schemas.get(name);
  if (!ajv) {
    let Ajv;
    try { Ajv = require('ajv'); }
    catch { fail('DEPENDENCY_MISSING', 'Install the ArkiGo dependencies with npm ci.'); }
    ajv = new Ajv({ allErrors: true, strict: false, ownProperties: true });
    ajv.addSchema(shape('design-v2'));
  }
  const validator = name === 'design-v2' ? ajv.getSchema('design-v2.schema.json') : ajv.compile(shape(name));
  schemas.set(name, validator);
  return validator;
}

const shape = name => JSON.parse(readFileSync(new URL(name + '.schema.json', directory), 'utf8'));

function schemaIssues(name, data) {
  const validate = schema(name);
  if (validate(data)) return [];
  return validate.errors.filter(error => error.keyword !== 'if').map(error => {
    let path = error.instancePath;
    const property = error.params.missingProperty ?? error.params.additionalProperty ?? error.params.propertyName;
    if (property !== undefined) path += '/' + pointer(property);
    const object = /^\/objects\/(\d+)/.exec(path);
    const relation = /^\/relations\/(\d+)/.exec(path);
    const id = object ? data.objects[object[1]]?.id : relation ? data.relations[relation[1]]?.from : null;
    const code = /\/implementation(?:\/|$)/.test(path) ? 'IMPLEMENTATION_INVALID'
      : /\/verification(?:\/|$)/.test(path) ? 'VERIFICATION_INVALID' : 'SCHEMA_INVALID';
    return { code, id: typeof id === 'string' ? ownerId(id) : null, path, message: error.message };
  });
}

function flowIssues(item, path, objects, issue) {
  const { steps, start, ends, transitions = [] } = item.body;
  const indexed = new Map();
  const outgoing = new Map();
  for (const [i, step] of steps.entries()) {
    const field = path + '/steps/' + i;
    if (indexed.has(step.id)) issue('STEP_ID_DUPLICATE', item.id, field + '/id', 'Step id is already used.');
    indexed.set(step.id, i);
    if (step.actor && objects.get(step.actor)?.type !== 'actor') {
      issue('STEP_ACTOR_INVALID', item.id, field + '/actor', 'Step actor must be an actor object.');
    }
  }
  const stepExists = (id, field) => {
    if (!indexed.has(id)) issue('STEP_NOT_FOUND', item.id, path + field, 'Step does not exist in this flow.');
    return indexed.has(id);
  };
  const validStart = stepExists(start, '/start');
  ends.forEach((id, i) => stepExists(id, '/ends/' + i));
  for (const [i, edge] of transitions.entries()) {
    const from = stepExists(edge.from, '/transitions/' + i + '/from');
    stepExists(edge.to, '/transitions/' + i + '/to');
    if (!from) continue;
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push([edge, i]);
  }
  const reached = new Set(), pending = [start], terminal = new Set(ends);
  while (pending.length) {
    const id = pending.pop();
    if (reached.has(id)) continue;
    reached.add(id);
    for (const [edge] of outgoing.get(id) ?? []) pending.push(edge.to);
  }
  for (const [id, i] of indexed) {
    const stepPath = path + '/steps/' + i + '/id';
    if (validStart && !reached.has(id)) issue('STEP_UNREACHABLE', item.id, stepPath, 'Step is unreachable from start.');
    const edges = outgoing.get(id) ?? [];
    if (!edges.length && !terminal.has(id)) issue('STEP_NO_EXIT', item.id, stepPath, 'Non-terminal step has no exit.');
    if (edges.length < 2) continue;
    for (const [edge, n] of edges) {
      if (!edge.when?.trim()) {
        issue('BRANCH_WHEN_REQUIRED', item.id, path + '/transitions/' + n + '/when', 'Branch requires a condition.');
      }
    }
  }
  return indexed;
}

function pathIssues(item, path, locations, issue) {
  const inspect = (base, value, field, asset = false) => {
    let resolved;
    try { resolved = containedFile(base, value); }
    catch (error) {
      if (!(error instanceof CliError)) throw error;
      issue(asset ? 'ASSET_PATH_INVALID' : 'EVIDENCE_PATH_INVALID', item.id, path + field, error.message);
      return;
    }
    if (asset && !isFile(resolved)) issue('ASSET_MISSING', item.id, path + field, 'Asset does not exist.');
  };
  for (const [i, media] of (item.body.media ?? []).entries()) {
    inspect(locations.assets, media.path, '/body/media/' + i + '/path', true);
  }
  for (const [i, note] of (item.notes ?? []).entries()) {
    if (note.type === 'image') inspect(locations.assets, note.path, '/notes/' + i + '/path', true);
  }
  for (const [sources, base] of [[item.sources, '/sources'], [item.verification?.evidence, '/verification/evidence']]) {
    for (const [i, source] of (sources ?? []).entries()) {
      if (source.kind === 'file') inspect(locations.root, source.ref, base + '/' + i + '/ref');
    }
  }
  for (const [i, row] of (item.implementation?.evidence ?? []).entries()) {
    inspect(locations.root, row.path, '/implementation/evidence/' + i + '/path');
  }
}

export function validateDesign(design, locations) {
  const errors = schemaIssues('design-v2', design);
  if (errors.length) return errors;
  const issue = (code, id, path, message) => errors.push({ code, id, path, message });
  const { objects } = indexDesign(design);
  const paths = new Map(), completed = new Set(), steps = new Map();
  const roots = design.objects.filter(item => item.parent === null);
  if (roots.length !== 1) issue('ROOT_COUNT', null, '/objects', 'Expected exactly one root.');
  for (const [i, item] of design.objects.entries()) {
    const path = '/objects/' + i;
    if (paths.has(item.id)) issue('ID_DUPLICATE', item.id, path + '/id', 'Object id is already used.');
    paths.set(item.id, path);
    if ((item.type === 'system') !== (item.parent === null)) {
      issue('SYSTEM_ROOT', item.id, path + '/parent', 'Only the system is the root.');
    }
    if (item.parent !== null && !objects.has(item.parent)) {
      issue('PARENT_NOT_FOUND', item.id, path + '/parent', 'Parent does not exist.');
    }
    if (item.type === 'flow') steps.set(item.id, flowIssues(item, path + '/body', objects, issue));
    if (item.implementation && !implementable.has(item.type)) {
      issue('IMPLEMENTATION_INVALID', item.id, path + '/implementation', 'Object type does not allow implementation.');
    }
    if (item.verification && item.type !== 'acceptance') {
      issue('VERIFICATION_INVALID', item.id, path + '/verification', 'Only acceptance allows verification.');
    }
    if (item.type === 'decision' && item.body.chosen != null && item.body.chosen >= (item.body.options?.length ?? 0)) {
      issue('DECISION_OUT_OF_BOUNDS', item.id, path + '/body/chosen', 'Chosen index is outside the list of options.');
    }
    pathIssues(item, path, locations, issue);
  }
  function endpoint(id) {
    const [object, step] = id.split('#');
    return step === undefined || steps.get(object)?.has(step) ? objects.get(object) : undefined;
  }
  for (const [i, item] of design.objects.entries()) {
    const chain = new Set();
    for (let current = item; current && !completed.has(current.id); current = objects.get(current.parent)) {
      if (chain.has(current.id)) {
        issue('PARENT_CYCLE', current.id, paths.get(current.id) + '/parent', 'Parent chain has a cycle.');
        break;
      }
      chain.add(current.id);
    }
    for (const id of chain) completed.add(id);
    for (const { ref, path } of references(item)) {
      if (path.endsWith('/actor') && /^\/body\/steps\/\d+\/actor$/.test(path)) continue;
      if (!endpoint(ref)) issue('REFERENCE_NOT_FOUND', item.id, '/objects/' + i + path, 'Reference not found: ' + ref);
    }
  }
  const limits = {
    reads: ['to', 'entity'], writes: ['to', 'entity'], governed_by: ['to', 'rule'],
    verifies: ['from', 'acceptance'], blocks: ['from', 'decision'], uses: ['from', 'actor'],
  };
  const relations = new Set();
  for (const [i, relation] of design.relations.entries()) {
    const path = '/relations/' + i, id = ownerId(relation.from), key = relationKey(relation);
    if (relations.has(key)) issue('RELATION_DUPLICATE', id, path, 'Relation is already present.');
    relations.add(key);
    for (const end of ['from', 'to']) {
      const target = endpoint(relation[end]);
      if (!target) issue('RELATION_ENDPOINT_NOT_FOUND', id, path + '/' + end, 'Endpoint does not exist.');
      else {
        const [constrained, type] = limits[relation.type] ?? [];
        if (end === constrained && (relation[end].includes('#') || target.type !== type)) {
          issue('RELATION_ENDPOINT_TYPE', id, path + '/' + end, 'Endpoint must be a ' + type + '.');
        }
      }
    }
  }
  return errors;
}

export function assertDesign(design, locations) {
  const errors = validateDesign(design, locations);
  if (errors.length) fail('VALIDATION_FAILED', 'Design validation failed.', 1, { errors });
  return design;
}

export function loadDesign(locations, file = locations.design) {
  return assertDesign(readJson(file), locations);
}

export function readFormat(file, name) {
  const data = readJson(file);
  const errors = schemaIssues(name, data);
  if (errors.length) fail('VALIDATION_FAILED', 'File validation failed.', 1, { errors });
  return data;
}
