export function progressGroups(index, evidence) {
  const matched = Object.keys(evidence).length > 0;
  const review = [];
  const groups = new Map();
  for (const object of [...index.objects.values()].sort(compareObjects)) {
    if (object.parent === null) continue;
    const implementation = implementationState(object, evidence);
    if (!implementation && object.type !== 'acceptance') continue;
    const owner = index.pathTo(object.id).slice(1).find((ancestor) => ancestor.type === 'module') ?? index.root;
    if (!groups.has(owner.id)) groups.set(owner.id, {
      owner,
      implementation: Object.fromEntries(Object.keys(implementations)
        .filter((state) => matched || state !== 'stale').map((state) => [state, []])),
      verification: Object.fromEntries(Object.keys(verificationStates).map((state) => [state, []]))
    });
    const group = groups.get(owner.id);
    if (implementation) group.implementation[implementation].push(object);
    else group.verification[object.verification?.status ?? 'unknown'].push(object);
    if (implementation === 'stale') {
      for (const item of evidence[object.id]) {
        if (item.of === 'implementation' && ['changed', 'missing'].includes(item.state)) {
          review.push({ object, ...item });
        }
      }
    }
  }
  return { matched, review, groups: [...groups.values()].sort((a, b) => compareObjects(a.owner, b.owner)) };
}
import { compareObjects, implementationState, implementations } from './model.mjs';

const verificationStates = { passed: '通过', failed: '未通过', unknown: '未验证' };

