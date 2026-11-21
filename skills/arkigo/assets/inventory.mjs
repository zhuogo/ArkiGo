import { compareObjects, implementationState } from './model.mjs';

const inventoryTypes = ['rule', 'acceptance', 'decision', 'entity', 'interface', 'screen'];

export function inventoryRows(index, evidence, filters = {}) {
  const tables = Object.fromEntries(inventoryTypes.map((type) => [type, []]));
  for (const object of [...index.objects.values()].sort(compareObjects)) {
    if (!Object.hasOwn(tables, object.type)) continue;
    const module = index.pathTo(object.id).slice(0, -1).findLast((ancestor) => ancestor.type === 'module');
    const implementation = implementationState(object, evidence);
    if (filters.status && filters.status !== object.status ||
        filters.implementation && filters.implementation !== implementation ||
        filters.module && filters.module !== (module?.id ?? '@root')) continue;
    tables[object.type].push({ object, module, implementation });
  }
  return tables;
}
