import { createHash } from 'node:crypto';
import schema from '../../schemas/design-v2.schema.json' with { type: 'json' };

const topKeys = ['format', 'id', 'title', 'objects', 'relations'];
const objectKeys = [
  'id', 'type', 'title', 'summary', 'parent', 'group', 'order', 'status', 'origin', 'body',
  'notes', 'sources', 'implementation', 'verification',
];
const relationKeys = ['from', 'to', 'type', 'label', 'when'];
const definitions = schema.definitions;
const required = new Set(definitions.object.required);
const bodySchemas = new Map(definitions.object.allOf.map(rule =>
  [rule.if.properties.type.const, rule.then.properties.body]));
const blockSchemas = new Map(definitions.block.allOf.map(rule => [rule.if.properties.type.const, rule.then]));
export const implementable = new Set(['module', 'flow', 'rule', 'entity', 'interface', 'screen']);
export const types = ['system', 'actor', 'module', 'flow', 'rule', 'entity', 'interface', 'screen',
  'acceptance', 'decision'];
const optionalEmpty = value => value === '' || (Array.isArray(value) && value.length === 0);
export const compare = (a, b) => Number(a > b) - Number(a < b);
export const relationKey = ({ from, type, to }) => `${from}\0${type}\0${to}`;
export const ownerId = endpoint => endpoint.split('#', 1)[0];
export const openDecision = item => item?.type === 'decision' && item.body.chosen == null;

export function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort(compare).map(key => [key, ordered(value[key])]));
}

function clean(value, shape) {
  if (shape?.$ref) shape = definitions[shape.$ref.split('/').at(-1)];
  if (Array.isArray(value)) return value.map(item => clean(item, shape?.items));
  if (!value || typeof value !== 'object') return value;
  if (shape === definitions.block) shape = blockSchemas.get(value.type);
  return Object.fromEntries(Object.keys(value).sort(compare)
    .filter(key => shape?.required?.includes(key) || !optionalEmpty(value[key]))
    .map(key => [key, clean(value[key], shape?.properties?.[key])]));
}

function pick(value, keys) {
  return Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
}

export function normalizeDesign(design) {
  const result = pick(design, topKeys);
  result.objects = [...design.objects].sort((a, b) => compare(a.id, b.id)).map(item => {
    const entries = Object.entries(pick(item, objectKeys)).filter(([key, value]) =>
      required.has(key) || !optionalEmpty(value));
    return Object.fromEntries(entries.map(([key, value]) => [
      key, clean(value, key === 'body' ? bodySchemas.get(item.type) : definitions.object.properties[key]),
    ]));
  });
  result.relations = [...design.relations].sort((a, b) => compare(relationKey(a), relationKey(b)))
    .map(item => pick(clean(item, definitions.relation), relationKeys));
  return result;
}

export const serializeDesign = design => JSON.stringify(normalizeDesign(design), null, 2) + '\n';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const revision = design => sha256(serializeDesign(design)).slice(0, 12);

export function indexDesign(design) {
  const objects = new Map(design.objects.map(item => [item.id, item]));
  const children = new Map();
  for (const item of design.objects) {
    if (!children.has(item.parent)) children.set(item.parent, []);
    children.get(item.parent).push(item);
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || compare(a.id, b.id));
  }
  return { objects, children, system: children.get(null)?.[0] };
}

export function descendants(index, id) {
  const ids = new Set(), pending = [id];
  while (pending.length) {
    const current = pending.pop();
    if (ids.has(current)) continue;
    ids.add(current);
    for (const child of index.children.get(current) ?? []) pending.push(child.id);
  }
  return ids;
}

export function ancestry(index, id) {
  const result = [];
  for (let item = index.objects.get(id); item; item = index.objects.get(item.parent)) result.push(item);
  return result.reverse();
}

export const summary = ({ id, type, title, summary, parent, status }) => ({ id, type, title, summary, parent, status });
