import { compare, ordered, relationKey, ownerId } from './design.mjs';

const equal = (a, b) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));

export function fieldsChanged(before, after, prefix = '') {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(compare);
  return keys.flatMap(key => {
    const a = before[key], b = after[key], path = prefix + key;
    if (equal(a, b)) return [];
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      return fieldsChanged(a, b, path + '.');
    }
    return [path];
  });
}

export function changesBetween(before, after) {
  const previous = new Map(before.objects.map(item => [item.id, item]));
  const current = new Map(after.objects.map(item => [item.id, item]));
  const changes = [];
  for (const id of [...new Set([...previous.keys(), ...current.keys()])].sort(compare)) {
    const a = previous.get(id), b = current.get(id);
    if (!a) changes.push({ op: 'add', id });
    else if (!b) changes.push({ op: 'remove', id, before: a });
    else {
      const fields = fieldsChanged(a, b);
      if (fields.length) changes.push({ op: 'update', id, fields, before: a });
    }
  }
  const oldRelations = new Map(before.relations.map(item => [relationKey(item), item]));
  const newRelations = new Map(after.relations.map(item => [relationKey(item), item]));
  for (const [key, relation] of oldRelations) {
    if (!equal(relation, newRelations.get(key))) changes.push({ op: 'unlink', relation });
  }
  for (const [key, relation] of newRelations) {
    if (!equal(relation, oldRelations.get(key))) changes.push({ op: 'link', relation });
  }
  return changes;
}

export function changedIds(changes) {
  const ids = new Set();
  for (const { id, relation } of changes) {
    if (id) ids.add(id);
    else for (const end of ['from', 'to']) ids.add(ownerId(relation[end]));
  }
  return [...ids].sort(compare);
}
