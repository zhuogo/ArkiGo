export function historyChanges(index, records, selected) {
  const next = new Map(index.objects);
  for (const record of records.slice(0, selected)) {
    for (const change of record.changes) {
      if (change.op === 'add') next.delete(change.id);
      else if (change.before) next.set(change.id, change.before);
    }
  }
  const result = { add: [], update: [], remove: [] };
  for (const entry of records[selected]?.changes ?? []) {
    if (entry.op === 'link') result.add.push(entry);
    else if (entry.op === 'unlink') result.remove.push(entry);
    else if (entry.op === 'remove') result.remove.push(entry);
    else result[entry.op].push({ ...entry, after: next.get(entry.id) });
  }
  return result;
}

const fieldAt = (object, path) => path.split('.').reduce((value, key) =>
  value && Object.hasOwn(value, key) ? value[key] : undefined, object);

export function fieldChanges({ fields, before, after }) {
  return fields.map((path) => ({ path, before: fieldAt(before, path), after: fieldAt(after, path) }));
}

export function changeText(before, after) {
  const a = [...before];
  const b = [...after];
  let start = 0;
  let end = 0;
  while (start < Math.min(a.length, b.length) && a[start] === b[start]) start++;
  while (end < Math.min(a.length, b.length) - start && a[a.length - end - 1] === b[b.length - end - 1]) end++;
  const leading = (start > 36 ? '…' : '') + a.slice(Math.max(0, start - 36), start).join('');
  const trailing = a.slice(a.length - end, a.length - end + 36).join('') + (end > 36 ? '…' : '');
  return [a, b].map((text) => ({ leading, changed: text.slice(start, text.length - end).join(''), trailing }));
}

export function historyMarks(index, record) {
  const marks = new Map();
  const paths = (id, parent, op) => {
    const address = index.objects.has(id) ? id : parent;
    if (!address) return;
    for (const object of index.pathTo(address)) {
      if (!marks.has(object.id)) marks.set(object.id, new Set());
      marks.get(object.id).add(op);
    }
  };
  for (const { id, before, relation, op } of record?.changes ?? []) {
    if (relation) {
      paths(objectId(relation.from), null, op);
      paths(objectId(relation.to), null, op);
    } else {
      paths(id, before?.parent, op);
      if (before?.parent !== index.objects.get(id)?.parent) paths(before?.parent, null, op);
    }
  }
  return marks;
}
import { objectId } from './model.mjs';

