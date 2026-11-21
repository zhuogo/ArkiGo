import { jsonLine } from './io.mjs';

export const bytes = text => Buffer.byteLength(text, 'utf8');
const size = output => bytes(jsonLine(output));

function preview(row) {
  if (!row || typeof row !== 'object') return { omitted: true };
  const identity = ['id', 'code', 'path', 'kind', 'role', 'file', 'rev', 'type', 'op', 'key', 'of',
    'from', 'to', 'state'];
  const items = Object.entries(row).filter(([key, value]) => identity.includes(key) && typeof value === 'string');
  const clipped = items.map(([key, value]) => [key, [...value].slice(0, 70).join('')]);
  return { ...Object.fromEntries(clipped), omitted: true };
}

export function page(meta, key, rows, options = {}) {
  const { offset = 0, limit = 20, 'max-bytes': max = 12000 } = options;
  const output = { ...meta, [key]: [], offset, limit, total: rows.length, nextOffset: null, omitted: false };
  const update = () => {
    const next = offset + output[key].length;
    output.nextOffset = next < rows.length ? next : null;
    output.omitted = offset > 0 || output.nextOffset !== null || output[key].some(row => row?.omitted === true);
  };
  update();
  if (size(output) > max) {
    for (const name of Object.keys(meta)) {
      if (['ok', 'mode', 'rev', 'base', 'code', 'message', 'encoding'].includes(name)) continue;
      delete output[name];
    }
    output.metadataOmitted = true;
  }
  for (const row of rows.slice(offset, offset + limit)) {
    output[key].push(row);
    update();
    if (size(output) <= max) continue;
    output[key].pop();
    if (!output[key].length) {
      output[key].push(preview(row));
      update();
      if (size(output) <= max) continue;
      output[key].pop();
      output[key].push({ omitted: true });
    }
    update();
    break;
  }
  if (output.metadataOmitted) output.omitted = true;
  return output;
}
