import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { validateModel } from './validate.mjs';
import { buildHierarchy } from '../assets/canvas-navigation.mjs';

const schema = JSON.parse(readFileSync(new URL('../schemas/canvas-v1.schema.json', import.meta.url), 'utf8'));
const check = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true }).compile(schema);
const diagnostic = (code, path, message, objectId = null) => ({ code, objectId, path, message });

export function validateCanvas(document) {
  const errors = [], warnings = [];
  if (!check(document)) {
    return { valid: false, errors: check.errors.map((error) => diagnostic('CANVAS_SCHEMA_INVALID', error.instancePath, error.message)), warnings };
  }
  const viewIds = new Set();
  document.views.forEach((view, index) => {
    if (viewIds.has(view.id)) errors.push(diagnostic('DUPLICATE_VIEW_ID', `/views/${index}/id`, '视图 ID 重复。', view.id));
    viewIds.add(view.id);
  });
  document.views.forEach((view, vi) => {
    const base = `/views/${vi}`, ids = new Set();
    for (const key of ['zones', 'nodes', 'edges']) view[key].forEach((item, index) => {
      if (ids.has(item.id)) errors.push(diagnostic('DUPLICATE_CANVAS_ID', `${base}/${key}/${index}/id`, '同一视图内 ID 必须唯一。', item.id));
      ids.add(item.id);
    });
    const nodes = new Map(view.nodes.map((n) => [n.id, n]));
    const zones = new Map(view.zones.map((z) => [z.id, z]));
    view.nodes.forEach((n, index) => {
      const path = `${base}/nodes/${index}`;
      if (n.zoneId && !zones.has(n.zoneId)) errors.push(diagnostic('ZONE_MISSING', `${path}/zoneId`, '分区不存在。', n.id));
      if (n.targetViewId && !viewIds.has(n.targetViewId)) errors.push(diagnostic('TARGET_VIEW_MISSING', `${path}/targetViewId`, '目标视图不存在。', n.id));
      const z = zones.get(n.zoneId);
      if (z && (n.x < z.x + 12 || n.y < z.y + 38 || n.x + (n.width ?? 260) > z.x + z.width - 12 || n.y + (n.height ?? 154) > z.y + z.height - 12)) {
        errors.push(diagnostic('NODE_OUTSIDE_ZONE', path, '节点须完整位于所属分区内，并留出标题空间。', n.id));
      }
      for (const other of view.nodes.slice(0, index)) {
        if (n.x < other.x + (other.width ?? 260) && n.x + (n.width ?? 260) > other.x && n.y < other.y + (other.height ?? 154) && n.y + (n.height ?? 154) > other.y) {
          errors.push(diagnostic('NODE_OVERLAP', path, `节点与 ${other.id} 重叠，请调整位置。`, n.id));
        }
      }
    });
    view.edges.forEach((edge, index) => {
      for (const end of ['from', 'to']) if (!nodes.has(edge[end])) errors.push(diagnostic('CANVAS_REFERENCE_MISSING', `${base}/edges/${index}/${end}`, '连线端点不存在。', edge.id));
    });
    view.walkthrough.forEach((step, index) => {
      const path = `${base}/walkthrough/${index}`;
      if (!nodes.has(step.nodeId)) errors.push(diagnostic('WALK_NODE_MISSING', `${path}/nodeId`, '走读节点不存在。', step.nodeId));
      const edge = view.edges.find((item) => item.id === step.edgeId);
      if (step.edgeId && !edge) errors.push(diagnostic('WALK_EDGE_MISSING', `${path}/edgeId`, '走读连线不存在。'));
      if (edge && edge.from !== step.nodeId && edge.to !== step.nodeId) errors.push(diagnostic('WALK_EDGE_UNRELATED', `${path}/edgeId`, '走读连线须关联当前节点。', step.nodeId));
    });
  });
  try { buildHierarchy(document); }
  catch (error) {
    if (!errors.some((item) => item.code === error.code && item.path === error.path)) {
      errors.push(diagnostic(error.code, error.path, error.message, error.objectId));
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

// Existing design models remain supported; their generated layout is a reading projection.
export function modelToCanvas(model) {
  const report = validateModel(model);
  if (!report.valid) throw Object.assign(new Error('模型未通过校验。'), { report });
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const root = model.nodes.find((n) => n.parentId === null);
  const kinds = { system: '系统', module: '模块', flow: '流程', step: '步骤', rule: '规则', acceptance: '验收', question: '问题' };
  const card = (n, x, y, zoneId) => ({ id: n.id, title: n.title, summary: n.summary, kind: kinds[n.kind], x, y, zoneId,
    designStatus: n.designStatus, sourceOrigin: n.provenance.origin, details: Object.fromEntries(Object.entries(n.details).map(([k,v]) => [k, typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string')) ? v : JSON.stringify(v)])), sources: n.provenance.references });
  const owner = (n) => { let p = byId.get(n.parentId); while (p && p.kind !== 'flow') p = byId.get(p.parentId); return p?.id; };
  const views = [];
  const overviewNodes = model.nodes.filter((n) => ['module', 'flow'].includes(n.kind));
  if (!overviewNodes.length) overviewNodes.push(root);
  const overview = { id: 'overview', title: '系统全景', subtitle: model.project.goal, zones: [], nodes: [], edges: [], walkthrough: [] };
  const columns = Math.min(3, overviewNodes.length), rows = Math.ceil(overviewNodes.length / columns);
  overview.zones.push({ id: 'zone-overview', title: '已建模范围 · ' + model.project.scope.join(' / '), x: 36, y: 110, width: columns * 340 + 20, height: rows * 220 + 70 });
  overviewNodes.forEach((n, i) => {
    const item = card(n, 66 + i % columns * 340, 164 + Math.floor(i / columns) * 220, 'zone-overview');
    if (n.kind === 'flow') item.targetViewId = `flow:${n.id}`;
    overview.nodes.push(item);
    if (overviewNodes.some((p) => p.id === n.parentId)) overview.edges.push({ id: `contains:${n.id}`, from: n.parentId, to: n.id, label: '包含流程', kind: 'structure' });
  });
  views.push(overview);
  for (const flow of model.nodes.filter((n) => n.kind === 'flow')) {
    const members = model.nodes.filter((n) => owner(n) === flow.id && n.kind !== 'flow');
    const steps = members.filter((n) => n.kind === 'step');
    const other = members.filter((n) => n.kind !== 'step');
    // BFS preserves the declared journey; branches and retry edges retain their exact labels.
    const order = [], pending = [flow.details.startStepId], seen = new Set();
    for (let i = 0; i < pending.length; i++) {
      const id = pending[i]; if (seen.has(id)) continue; seen.add(id);
      if (steps.some((n) => n.id === id)) order.push(byId.get(id));
      for (const edge of model.relations.filter((r) => r.kind === 'next' && r.from === id)) pending.push(edge.to);
    }
    for (const n of steps) if (!seen.has(n.id)) order.push(n);
    const height = Math.max(Math.ceil(order.length / 3), Math.ceil(other.length / 2), 1) * 214 + 70;
    const view = { id: `flow:${flow.id}`, title: flow.title, subtitle: flow.summary,
      zones: [{ id: 'zone-behavior', title: '行为与分支', x: 36, y: 110, width: 1040, height },
        ...(other.length ? [{ id: 'zone-rules', title: '规则 · 验收 · 未决问题', x: 1120, y: 110, width: 700, height }] : [])], nodes: [], edges: [], walkthrough: [] };
    order.forEach((n, i) => view.nodes.push(card(n, 66 + i % 3 * 340, 164 + Math.floor(i / 3) * 214, 'zone-behavior')));
    other.forEach((n, i) => view.nodes.push(card(n, 1150 + i % 2 * 340, 164 + Math.floor(i / 2) * 214, 'zone-rules')));
    const ids = new Set(view.nodes.map((n) => n.id));
    view.edges = model.relations.filter((r) => ids.has(r.from) && ids.has(r.to)).map((r) => ({ id: r.id, from: r.from, to: r.to, label: r.condition ?? r.label ?? ({ governed_by: '受规则约束', verifies: '验收覆盖', questions: '待决策影响', depends_on: '依赖', next: '继续' }[r.kind]), kind: r.kind }));
    view.walkthrough = order.map((n) => ({ nodeId: n.id, title: n.title, text: n.details.action }));
    views.push(view);
  }
  return { document: { schemaVersion: 'arkigo-canvas/1', id: model.project.id.replace(/[^A-Za-z0-9_.:-]/g, '-'), revision: model.revision, title: model.project.title,
    description: '设计模型的阅读投影。范围：' + model.project.scope.join('；') + '。假设：' + model.project.assumptions.join('；'), views }, report };
}
