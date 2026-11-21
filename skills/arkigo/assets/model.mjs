export const types = {
  system: '系统', actor: '角色', module: '模块', flow: '流程', rule: '规则',
  entity: '数据', interface: '接口', screen: '界面', acceptance: '验收', decision: '决策'
};
export const statuses = { proposed: '提议', accepted: '已接受', retired: '已作废' };
export const implementations = {
  planned: '待实现', partial: '部分实现', implemented: '已实现', unknown: '未核对', stale: '需复查'
};
export const relationNames = {
  depends_on: '依赖', calls: '调用', reads: '读取', writes: '写入', governed_by: '受规则约束',
  verifies: '验证', blocks: '卡住', uses: '使用', relates: '关联'
};
export const annotationTypes = { governed_by: 'rule', verifies: 'acceptance', blocks: 'decision' };
export const objectId = (address) => address.split('#')[0];
export const compareObjects = (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) ||
  (a.id < b.id ? -1 : Number(a.id > b.id));

export function indexDesign(design) {
  const objects = new Map(design.objects.map((object) => [object.id, object]));
  const children = new Map();
  const root = design.objects.find((object) => object.parent === null);
  for (const object of design.objects) {
    if (object.parent === null) continue;
    if (!children.has(object.parent)) children.set(object.parent, []);
    children.get(object.parent).push(object);
  }
  for (const siblings of children.values()) siblings.sort(compareObjects);
  function pathTo(id) {
    const path = [];
    for (let object = objects.get(objectId(id)); object; object = objects.get(object.parent)) path.push(object);
    return path.reverse();
  }
  function get(address) {
    const [id, stepId] = address.split('#');
    const object = objects.get(id);
    if (stepId === undefined) return object;
    const step = object?.body.steps?.find((item) => item.id === stepId);
    if (step) return { ...step, id: address, parent: id, type: 'step', summary: step.action, body: step };
  }
  function containerFor(id) {
    let object = objects.get(objectId(id));
    while (object && !['system', 'module'].includes(object.type)) object = objects.get(object.parent);
    return object ?? root;
  }
  return { objects, children, root, get, pathTo, containerFor };
}

// How much a relation counts when one line stands for all relations between two cards, and when the map
// chooses the lines it draws before anything is selected.
const relationWeights = { calls: 4, writes: 3, depends_on: 3, reads: 2, uses: 2, relates: 1 };

// Projects the design's relations onto the cards of one map level. Every pair of cards gets a single line that
// carries all relations between them; `main` marks each card's weightiest line.
export function projectRelations(index, relations, container, cardIds) {
  const pairs = new Map();
  const annotations = new Map();
  const owners = new Map();
  function owner(address) {
    const id = objectId(address);
    if (owners.has(id)) return owners.get(id);
    let current = index.objects.get(id);
    while (current && current.parent !== container) current = index.objects.get(current.parent);
    const result = cardIds.has(current?.id) ? current.id : undefined;
    owners.set(id, result);
    return result;
  }
  for (const relation of relations) {
    const { type } = relation;
    const from = owner(relation.from);
    const to = owner(relation.to);
    if (Object.hasOwn(annotationTypes, type)) {
      const id = type === 'governed_by' ? from : to;
      if (!id) continue;
      if (!annotations.has(id)) annotations.set(id, {});
      (annotations.get(id)[type] ??= []).push(relation);
      continue;
    }
    if (!from || !to || from === to) continue;
    const [a, b] = from < to ? [from, to] : [to, from];
    const key = a + '/' + b;
    if (!pairs.has(key)) pairs.set(key, { id: key, a, b, relations: [], types: new Map(), forward: 0, backward: 0 });
    const pair = pairs.get(key);
    const weight = relationWeights[type] ?? 1;
    pair.relations.push(relation);
    pair.types.set(type, (pair.types.get(type) ?? 0) + weight);
    pair[from === a ? 'forward' : 'backward'] += weight;
  }
  const edges = [...pairs.values()].map(({ id, a, b, relations, types, forward, backward }) => {
    const [from, to] = forward >= backward ? [a, b] : [b, a];
    const type = [...types].reduce((best, entry) => entry[1] > best[1] ? entry : best)[0];
    return {
      id, from, to, type, relations, count: relations.length, weight: forward + backward,
      mutual: forward > 0 && backward > 0, main: false
    };
  });
  const heaviest = new Map();
  for (const edge of edges) {
    for (const id of [edge.from, edge.to]) {
      if (!heaviest.has(id) || edge.weight > heaviest.get(id).weight) heaviest.set(id, edge);
    }
  }
  for (const edge of heaviest.values()) edge.main = true;
  // A level with no more lines than cards is already easy to read, so nothing is held back there.
  if (edges.length <= cardIds.size) for (const edge of edges) edge.main = true;
  return { edges, annotations, owner };
}

export function implementationState(object, evidence) {
  if (!['module', 'flow', 'rule', 'entity', 'interface', 'screen'].includes(object.type)) return null;
  const stale = Object.hasOwn(evidence, object.id) && evidence[object.id].some((item) =>
    item.of === 'implementation' && ['changed', 'missing'].includes(item.state));
  return stale ? 'stale' : object.implementation?.status ?? 'unknown';
}
