import { ownerId, summary, types, openDecision } from '../lib/design.mjs';
import { implementationState } from '../lib/evidence.mjs';
import { fail, readPointer } from '../lib/errors.mjs';
import { getObject, readModel, scope } from '../lib/read-model.mjs';
import { strings } from '../lib/inline.mjs';
import { bytes, page } from '../lib/output.mjs';

export const flags = { id: 1, search: 1, type: 1, status: 1, implementation: 1, under: 1, field: 2 };
export const paging = true;

function filter(options, index, root) {
  const ids = scope(index, options.under), cache = new Map();
  for (const [key, accepted] of [
    ['type', types],
    ['status', ['proposed', 'accepted', 'retired']],
    ['implementation', ['planned', 'partial', 'implemented', 'unknown', 'stale']],
  ]) {
    if (options[key] !== undefined && !accepted.includes(options[key])) {
      fail('INVALID_ARGUMENT', 'Invalid value for --' + key + '.');
    }
  }
  return item => (!ids || ids.has(item.id))
    && (!options.type || item.type === options.type)
    && (!options.status || item.status === options.status)
    && (!options.implementation || implementationState(item, root, cache) === options.implementation);
}

function matches(item, needle) {
  const match = value => value.toLowerCase().includes(needle);
  const paths = [];
  for (const key of ['id', 'title', 'summary', 'body', 'notes', 'sources', 'implementation', 'verification']) {
    for (const { value, path } of strings(item[key], '/' + key)) {
      if (match(value)) paths.push(path);
    }
  }
  return paths;
}

export default function query(options) {
  const { design, index, locations, rev } = readModel(options);
  const { id, field, search } = options;
  const meta = { ok: true, rev };
  const filterNames = ['type', 'status', 'implementation', 'under'];
  const filtered = filterNames.some(key => options[key] !== undefined);
  if ((id !== undefined || field) && (filtered || search !== undefined || (id !== undefined && field))) {
    fail('INVALID_ARGUMENT', '--id and --field are standalone query modes.');
  }
  if (field) {
    const [id, path] = field;
    const value = readPointer(getObject(index, id), path);
    const format = { ...meta, mode: 'field' };
    const max = options['max-bytes'] ?? 12000;
    const row = { id, path, value };
    if (bytes(JSON.stringify(row)) + 250 <= max) return page(format, 'items', [row], options);
    const encoded = JSON.stringify(value);
    const chunk = Math.max(64, Math.floor((max - 550) / 6));
    const rows = [];
    for (let start = 0; start < encoded.length; start += chunk) {
      rows.push({ id, part: rows.length, value: encoded.slice(start, start + chunk) });
    }
    return page({ ...format, path, encoding: 'json' }, 'items', rows, options);
  }
  if (id !== undefined) {
    const item = getObject(index, id);
    const rows = [{ role: 'object', id, value: item }];
    for (const value of design.relations) {
      if (ownerId(value.from) === id || ownerId(value.to) === id) rows.push({ role: 'relation', value });
    }
    for (const child of index.children.get(id) ?? []) rows.push({ role: 'child', ...summary(child) });
    return page({ ...meta, mode: 'id' }, 'items', rows, options);
  }
  if (search !== undefined || filtered) {
    if (search !== undefined && !search.trim()) fail('INVALID_ARGUMENT', '--search needs text.');
    const select = filter(options, index, locations.root);
    const rows = [];
    for (const item of design.objects.filter(select)) {
      if (search === undefined) rows.push(summary(item));
      else {
        for (const path of matches(item, search.toLowerCase())) rows.push({ ...summary(item), path });
      }
    }
    return page({ ...meta, mode: search === undefined ? 'filter' : 'search' }, 'items', rows, options);
  }
  const rows = [];
  for (const item of index.children.get(index.system.id) ?? []) {
    rows.push({ ...summary(item), depth: 1 });
    for (const child of index.children.get(item.id) ?? []) rows.push({ ...summary(child), depth: 2 });
  }
  const counts = Object.fromEntries(types.map(type => [type, 0]));
  for (const item of design.objects) counts[item.type]++;
  return page({ ...meta, mode: 'directory', project: { id: design.id, title: design.title, system: index.system.id },
    counts, openDecisions: design.objects.filter(openDecision).length }, 'items', rows, options);
}
