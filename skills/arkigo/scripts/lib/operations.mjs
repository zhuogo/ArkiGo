import { fail, CliError } from './errors.mjs';
import { indexDesign, descendants, ownerId, implementable, relationKey } from './design.mjs';
import { stampEvidence } from './evidence.mjs';
import { references } from './inline.mjs';

const idPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const endpointPattern = /^[a-z0-9][a-z0-9._-]{0,63}(#[a-z0-9][a-z0-9._-]{0,63})?$/;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string';
const protectedFields = new Set(['id', 'parent', 'implementation', 'verification']);
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
const invalid = (message, details) => fail('OP_INVALID', message, 1, details);

function stamp(row, root, now) {
  try { return stampEvidence(row, root, now); }
  catch (error) {
    if (error instanceof CliError && error.code === 'UNSAFE_PATH') {
      fail('EVIDENCE_PATH_INVALID', error.message, 1, { path: row.path });
    }
    throw error;
  }
}

const shapes = {
  add: ['object'], update: ['id', 'set'], remove: ['id', 'cascade'], move: ['id', 'parent'],
  link: ['relation'], unlink: ['relation'], accept: ['id'], retire: ['id'],
  decide: ['id', 'chosen', 'rationale', 'by'], implement: ['id', 'status', 'note', 'evidence'],
  'confirm-evidence': ['id'], verify: ['id', 'status', 'note', 'evidence'],
};

function setPath(item, path, value) {
  const segments = path.match(/(?:[^.\[\]]|\[[^\[\]]*\])+/g) ?? [];
  if (!segments.length || segments.join('.') !== path) invalid('Invalid update path.', { path });
  let target = item;
  for (const [i, segment] of segments.entries()) {
    const match = /^([A-Za-z][A-Za-z0-9_]*)(?:\[([^\[\]]+)\])?$/.exec(segment);
    if (!match || !record(target)) invalid('Update path does not resolve to an object field.', { path });
    const [, key, selector] = match;
    if (unsafe.has(key) || (i === 0 && protectedFields.has(key)) || (i > 0 && key === 'id')) {
      invalid('This field cannot be changed by update.', { path });
    }
    const last = i === segments.length - 1;
    if (selector !== undefined) {
      if (selector === '+') {
        if (!last || value === null) invalid('[+] needs a value at the end of a path.', { path });
        if (!Object.hasOwn(target, key)) target[key] = [];
        if (!Array.isArray(target[key])) invalid('Update selector needs an array.', { path });
        target[key].push(structuredClone(value));
        return;
      }
      const array = target[key];
      if (!Array.isArray(array)) invalid('Update selector needs an array.', { path });
      const selected = array.map((row, j) => record(row) && (row.id === selector || row.name === selector) ? j : -1)
        .filter(j => j !== -1);
      if (selected.length !== 1) invalid('Update selector must match exactly one item.', { path });
      const [index] = selected;
      if (last) {
        if (value === null) array.splice(index, 1);
        else {
          if (array[index].id !== undefined && value?.id !== array[index].id) {
            invalid('Replacing an array element must preserve its id.', { path });
          }
          array[index] = structuredClone(value);
        }
      } else target = array[index];
    } else if (last) {
      if (value === null) delete target[key];
      else target[key] = structuredClone(value);
    } else {
      if (!Object.hasOwn(target, key)) target[key] = {};
      target = target[key];
    }
  }
}

function remove(design, item, cascade) {
  const ids = descendants(indexDesign(design), item.id);
  const related = relation => ids.has(ownerId(relation.from)) || ids.has(ownerId(relation.to));
  const relations = design.relations.filter(related);
  if (!cascade) {
    if (ids.size > 1 || relations.length || design.objects.some(other =>
      other.id !== item.id && [...references(other)].some(ref => ownerId(ref.ref) === item.id))) {
      fail('REMOVE_REFERENCED', 'Object has descendants or incoming references.', 1, { id: item.id });
    }
  }
  design.objects = design.objects.filter(other => !ids.has(other.id));
  design.relations = design.relations.filter(relation => !related(relation));
}

function modifyImplementation(item, op, root, now) {
  if (!implementable.has(item.type)) invalid('Object type does not allow implementation.');
  if (op.op === 'confirm-evidence') {
    if (!item.implementation?.evidence?.length) invalid('There is no implementation evidence to confirm.');
    item.implementation.evidence = item.implementation.evidence.map(({ path, symbol }) =>
      stamp({ path, ...(symbol !== undefined && { symbol }) }, root, now));
    return;
  }
  if (op.status === null) {
    delete item.implementation;
    return;
  }
  if (!['planned', 'partial', 'implemented'].includes(op.status) || !Array.isArray(op.evidence)) {
    invalid('Expected an implementation status and evidence array.');
  }
  const evidence = op.evidence.map(row => {
    if (!record(row) || !text(row.path) || (row.symbol !== undefined && !text(row.symbol))
        || Object.keys(row).some(key => key !== 'path' && key !== 'symbol')) {
      invalid('Evidence input allows path and symbol. Hashes and dates are generated.');
    }
    return stamp(row, root, now);
  });
  item.implementation = { status: op.status, ...(op.note !== undefined && { note: op.note }), evidence };
}

function apply(design, op, { root, now, by }) {
  if (!record(op) || !Object.hasOwn(shapes, op.op) || Object.keys(op).some(key =>
    key !== 'op' && !shapes[op.op].includes(key))) invalid('Unknown operation or unexpected field.');
  if (op.op === 'add') {
    if (!record(op.object) || op.object.implementation !== undefined || op.object.verification !== undefined) {
      invalid('Add expects an object. Use implement and verify to set results.');
    }
    design.objects.push(structuredClone(op.object));
    return;
  }
  if (op.op === 'link' || op.op === 'unlink') {
    const relation = op.relation;
    if (!record(relation) || typeof relation.type !== 'string' || !text(relation.from) || !text(relation.to)
        || !endpointPattern.test(relation.from) || !endpointPattern.test(relation.to)) invalid('Invalid relation.');
    if (op.op === 'link') design.relations.push(structuredClone(relation));
    else {
      if (Object.keys(relation).some(key => !['from', 'type', 'to'].includes(key))) invalid('Unlink expects a triple.');
      const index = design.relations.findIndex(row => relationKey(row) === relationKey(relation));
      if (index === -1) fail('RELATION_NOT_FOUND', 'Relation does not exist.', 1);
      design.relations.splice(index, 1);
    }
    return;
  }
  if (!text(op.id) || !idPattern.test(op.id)) invalid('Expected an object id.');
  const item = design.objects.find(row => row.id === op.id);
  if (!item) fail('OBJECT_NOT_FOUND', 'Object does not exist.', 1, { id: op.id });
  switch (op.op) {
    case 'update':
      if (!record(op.set)) invalid('Update expects a set object.');
      for (const [path, value] of Object.entries(op.set)) setPath(item, path, value);
      break;
    case 'remove':
      if (op.cascade !== undefined && typeof op.cascade !== 'boolean') invalid('Cascade must be a boolean.');
      remove(design, item, op.cascade);
      break;
    case 'move':
      if (op.parent !== null && (!text(op.parent) || !idPattern.test(op.parent))) invalid('Expected a parent id.');
      item.parent = op.parent;
      break;
    case 'accept':
    case 'retire':
      item.status = op.op === 'accept' ? 'accepted' : 'retired';
      break;
    case 'decide':
      if (item.type !== 'decision' || !Number.isInteger(op.chosen) || op.chosen < 0
          || (op.rationale !== undefined && !text(op.rationale)) || (op.by !== undefined && !text(op.by))) {
        invalid('Decide expects a decision object and a non-negative chosen index.');
      }
      if (op.chosen >= (item.body.options?.length ?? 0)) invalid('Chosen index is outside the list of options.');
      if (item.status === 'proposed') item.status = 'accepted';
      item.body.chosen = op.chosen;
      item.body.decidedAt = now;
      item.body.decidedBy = op.by ?? by;
      if (op.rationale !== undefined) item.body.rationale = op.rationale;
      break;
    case 'implement':
    case 'confirm-evidence':
      modifyImplementation(item, op, root, now);
      break;
    case 'verify':
      if (item.type !== 'acceptance' || !['passed', 'failed'].includes(op.status)) {
        invalid('Verify expects an acceptance object and a passed or failed status.');
      }
      item.verification = { status: op.status, checkedAt: now };
      for (const field of ['note', 'evidence']) {
        if (op[field] !== undefined) item.verification[field] = structuredClone(op[field]);
      }
      break;
  }
}

export function applyOperations(design, ops, options) {
  if (!Array.isArray(ops)) invalid('Expected a JSON array of operations.');
  const result = structuredClone(design);
  for (const [index, op] of ops.entries()) {
    try { apply(result, op, options); }
    catch (error) {
      if (error instanceof CliError) error.details = { index, ...(text(op?.id) && { id: op.id }), ...error.details };
      throw error;
    }
  }
  return result;
}

export function applyDecisions(design, items, options, stale) {
  let result = design;
  const comments = [], skipped = [];
  let applied = 0;
  for (const [index, item] of items.entries()) {
    if (item.op === 'comment') {
      comments.push(item);
      continue;
    }
    const { op, id, chosen, rationale, by } = item;
    const operation = op === 'decide' ? { op, id, chosen, rationale, by } : { op, id };
    try {
      result = applyOperations(result, [operation], options);
      applied++;
    } catch (error) {
      if (!stale || !(error instanceof CliError) || error.status !== 1) throw error;
      skipped.push({ index, id, op, code: error.code, message: error.message });
    }
  }
  return { result, comments, skipped, applied };
}
