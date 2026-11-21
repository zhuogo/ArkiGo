import { resolve } from 'node:path';
import { readModel } from '../lib/read-model.mjs';
import { loadDesign } from '../lib/validate.mjs';
import { normalizeDesign, revision } from '../lib/design.mjs';
import { changesBetween, fieldsChanged } from '../lib/changes.mjs';
import { page } from '../lib/output.mjs';
import { projectPath } from '../lib/paths.mjs';

export const positionals = [1, 1];
export const paging = true;

export default function diff(options, [file]) {
  const { locations, design, rev } = readModel(options);
  const path = resolve(file);
  const next = loadDesign(locations, path);
  const candidate = normalizeDesign(next);
  const objects = new Map(candidate.objects.map(item => [item.id, item]));
  const changes = changesBetween(normalizeDesign(design), candidate).map(row =>
    row.op === 'add' || row.op === 'update' ? { ...row, after: objects.get(row.id) } : row);
  const before = { id: design.id, title: design.title };
  const after = { id: next.id, title: next.title };
  const fields = fieldsChanged(before, after);
  if (fields.length) changes.unshift({ op: 'project', fields, before, after });
  return page({ ok: true, base: rev, rev: revision(next), file: projectPath(locations.root, path) },
    'changes', changes, options);
}
