// Hierarchy and screen-space navigation policy shared by validation and the browser.
// No document or DOM mutation: targetViewId remains the only child-view link.
const hierarchyError = (code, path, message, objectId = null) => {
  throw Object.assign(new Error(message), { code, path, objectId });
};

export function buildHierarchy(document) {
  const views = new Map(), parents = new Map(), links = new Map();
  for (const [index, view] of document.views.entries()) {
    if (views.has(view.id)) hierarchyError('DUPLICATE_VIEW_ID', `/views/${index}/id`, '视图 ID 重复。', view.id);
    views.set(view.id, view);
    links.set(view.id, []);
  }
  const rootId = document.rootViewId ?? document.views[0]?.id;
  if (!views.has(rootId)) hierarchyError('ROOT_VIEW_MISSING', '/rootViewId', '根视图不存在。', rootId);
  document.views.forEach((view, vi) => view.nodes.forEach((node, ni) => {
    const child = node.targetViewId;
    if (!child) return;
    const path = `/views/${vi}/nodes/${ni}/targetViewId`;
    if (!views.has(child)) hierarchyError('TARGET_VIEW_MISSING', path, '目标视图不存在。', node.id);
    if (child === view.id) hierarchyError('VIEW_SELF_LINK', path, '模块不能指向当前视图。', node.id);
    if (parents.has(child)) hierarchyError('VIEW_MULTIPLE_PARENTS', path, '子视图只能属于一个模块节点。', node.id);
    parents.set(child, { viewId: view.id, nodeId: node.id });
    links.get(view.id).push({ child, path, nodeId: node.id });
  }));
  // Check every component, including unreachable cycles, without recursive depth limits.
  const complete = new Set();
  for (const viewId of views.keys()) {
    const active = new Set();
    let current = viewId;
    while (current && !complete.has(current)) {
      if (active.has(current)) hierarchyError('VIEW_CYCLE', '/views', '视图层级不能包含循环。', current);
      active.add(current);
      current = parents.get(current)?.viewId;
    }
    for (const id of active) complete.add(id);
  }
  if (parents.has(rootId)) hierarchyError('ROOT_VIEW_HAS_PARENT', '/rootViewId', '根视图不能属于其他模块。', rootId);
  const reached = new Set([rootId]), pending = [rootId];
  for (let i = 0; i < pending.length; i++) for (const { child } of links.get(pending[i])) {
    reached.add(child);
    pending.push(child);
  }
  for (const [index, view] of document.views.entries()) {
    if (!reached.has(view.id)) hierarchyError('VIEW_UNREACHABLE', `/views/${index}`, '视图必须可从根视图沿模块层级到达。', view.id);
  }
  return {
    rootId, parents,
    pathTo(viewId) {
      if (!views.has(viewId)) hierarchyError('TARGET_VIEW_MISSING', '/views', '目标视图不存在。', viewId);
      const path = [];
      for (let id = viewId; id;) {
        const parent = parents.get(id);
        path.push(parent ? { viewId: id, viaNodeId: parent.nodeId } : { viewId: id });
        id = parent?.viewId;
      }
      return path.reverse();
    }
  };
}

export const SEMANTIC_ZOOM = Object.freeze({ enterOccupancy: .58, minVisibleRatio: .8 });

export function moduleProjection(node, camera, viewport) {
  const x = node.x * camera.k + camera.x, y = node.y * camera.k + camera.y;
  const width = (node.width ?? 260) * camera.k, height = (node.height ?? 154) * camera.k;
  const vx = viewport.x ?? 0, vy = viewport.y ?? 0;
  if (![x, y, width, height, vx, vy, viewport.width, viewport.height].every(Number.isFinite)
    || width <= 0 || height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { x, y, width, height, occupancy: 0, visibleRatio: 0, centerVisible: false };
  }
  const visibleWidth = Math.max(0, Math.min(x + width, vx + viewport.width) - Math.max(x, vx));
  const visibleHeight = Math.max(0, Math.min(y + height, vy + viewport.height) - Math.max(y, vy));
  return { x, y, width, height,
    occupancy: Math.max(width / viewport.width, height / viewport.height),
    visibleRatio: visibleWidth * visibleHeight / (width * height),
    centerVisible: x + width / 2 >= vx && x + width / 2 <= vx + viewport.width
      && y + height / 2 >= vy && y + height / 2 <= vy + viewport.height
  };
}

// Call only for the selected module. Runtime owns gesture accumulation and hysteresis.
// Programmatic fit, search, restoration and walkthrough never supply deliberate=true.
export function shouldEnterModule(node, camera, viewport, intent = {}) {
  if (!node?.targetViewId || intent.direction !== 'in' || intent.deliberate !== true) return false;
  const projected = moduleProjection(node, camera, viewport);
  return projected.occupancy >= SEMANTIC_ZOOM.enterOccupancy
    && projected.visibleRatio >= SEMANTIC_ZOOM.minVisibleRatio && projected.centerVisible;
}

export function fitViewCamera(bounds, viewport, padding = 38) {
  const k = Math.max(.01, Math.min((viewport.width - padding * 2) / bounds.width,
    (viewport.height - padding * 2) / bounds.height, 1));
  return { k, x: (viewport.x ?? 0) + (viewport.width - bounds.width * k) / 2 - bounds.x * k,
    y: (viewport.y ?? 0) + (viewport.height - bounds.height * k) / 2 - bounds.y * k };
}

export function frameNodeCamera(node, viewport, occupancy = .62) {
  const width = node.width ?? 260, height = node.height ?? 154;
  const k = Math.min(6, Math.max(.01, occupancy * Math.min(viewport.width / width, viewport.height / height)));
  return { k, x: (viewport.x ?? 0) + viewport.width / 2 - (node.x + width / 2) * k,
    y: (viewport.y ?? 0) + viewport.height / 2 - (node.y + height / 2) * k };
}
