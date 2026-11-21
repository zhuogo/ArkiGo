const input = JSON.parse(byId('arkigo-data').textContent);
const index = indexDesign(input.design);
const root = index.root.id;
const detail = byId('detail');
const restored = new Map();
const storageKey = 'arkigo-layout-v2:' + input.design.id;
const originalPositions = input.layout?.views ?? {};
const savedPositions = readStorage(storageKey, {});
const firstRead = readModes.keys().next().value;
let state;
let scene;
let renderedDetail;

function entriesFor(record, id) {
  return Object.hasOwn(record, id) ? record[id] : {};
}

function positions(id) {
  return Object.hasOwn(savedPositions, id) ? savedPositions[id] : entriesFor(originalPositions, id);
}

function exportData() {
  const views = [];
  for (const id of new Set([...Object.keys(originalPositions), ...Object.keys(savedPositions)])) {
    if (!index.objects.has(id)) continue;
    const entries = Object.entries(positions(id)).filter(([card, point]) => {
      const object = index.objects.get(card);
      return object?.parent === id && !Object.values(annotationTypes).includes(object.type) &&
        Number.isFinite(point?.x) && Number.isFinite(point?.y);
    });
    if (entries.length) views.push([id, Object.fromEntries(entries)]);
  }
  return { format: 'arkigo-layout/2', views: Object.fromEntries(views) };
}

function modeFor(address) {
  return ['step', 'flow'].includes(index.get(address)?.type) ? 'flow' : 'map';
}

function canEnter(address) {
  const object = address && index.get(address);
  return object?.type === 'flow' && state.viewId !== address ||
    object?.type === 'module' && index.children.has(address) && state.viewId !== address;
}

const ctx = {
  ...input, index, positions, modeFor, canEnter,
  get viewId() { return state.viewId; },
  get direction() { return narrowScreen.matches ? 'vertical' : 'horizontal'; },
  get availableWidth() { return Math.max(1, byId('viewport').clientWidth - 36); },
  selection: () => state?.selected,
  select, enter, back, move, jump,
  navigate: (mode, address, intent = 'switch') => navigate(mode, address, intent)
};
ctx.camera = createCamera(ctx);
ctx.directory = createDirectory(ctx);

function stateFor(mode, address, intent, showDetail = false) {
  const definition = readModes.get(mode);
  const resolved = definition.resolve?.(ctx, address, intent) ??
    { viewId: root, selected: address === root ? null : address };
  return {
    mode, address, viewId: resolved.viewId, selected: resolved.selected,
    detail: showDetail ? address : resolved.detail ?? null
  };
}

function locationState() {
  const match = /^#\/([^/]+)\/(.+)$/.exec(location.hash);
  let address;
  try { address = decodeURIComponent(match?.[2] ?? root); } catch { address = root; }
  if (match && !readModes.has(match[1])) return stateFor(firstRead, root, 'address');
  const mode = match?.[1] ?? firstRead;
  if (!index.get(address)) return stateFor(firstRead, root, 'address');
  const remembered = history.state?.arkigo;
  if (remembered?.mode === mode && remembered.address === address && index.objects.has(remembered.viewId)) {
    return remembered;
  }
  const type = index.get(address).type;
  const showDetail = !readModes.get(mode).article && !['system', 'module', 'flow'].includes(type);
  return stateFor(mode, address, 'address', showDetail);
}

function saveHistory(replace = true, camera = ctx.camera.save()) {
  history[replace ? 'replaceState' : 'pushState']({ arkigo: { ...state, camera } }, '',
    addressHash(state.mode, state.address));
}

function drawNavigation() {
  const crumbs = byId('crumbs');
  crumbs.replaceChildren();
  const trail = index.pathTo(state.viewId).filter((object) => ['system', 'module', 'flow'].includes(object.type))
    .map((item, i) => ({ title: i === 0 ? input.design.title : item.title, open: () => returnTo(item.id) }));
  if (state.mode === 'inventory') trail.push({ title: readModes.get(state.mode).label });
  for (const [i, { title, open }] of trail.entries()) {
    if (i) crumbs.append(icon('right'));
    const last = i === trail.length - 1;
    const crumb = button(title, last ? () => inspect(state.viewId) : open, 'crumb');
    crumb.title = title;
    if (last) {
      crumb.id = 'view-detail';
      crumb.setAttribute('aria-current', 'location');
    }
    crumbs.append(crumb);
  }
  crumbs.scrollLeft = crumbs.scrollWidth;
}

function paintSelection() {
  const selected = state.selected && index.get(state.selected);
  const onCard = Boolean(scene?.cardsByAddress.has(state.selected));
  const related = selected && !onCard ? scene?.related?.(state.selected) : null;
  for (const [id, { element }] of scene?.cardsByAddress ?? []) {
    element.setAttribute('aria-pressed', String(id === state.selected));
    element.classList.toggle('card-related', Boolean(related?.has(id)));
  }
  for (const edge of byId('world').querySelectorAll('.graph-edge, .edge-label')) {
    edge.classList.toggle('edge-selected', edge.dataset.from === state.selected || edge.dataset.to === state.selected);
  }
  byId('world').classList.toggle('has-selection', onCard);
  for (const item of document.querySelectorAll('#view-content [data-object]')) {
    if (item.dataset.object === state.selected) item.setAttribute('aria-current', 'true');
    else item.removeAttribute('aria-current');
  }
  byId('hint').textContent = scene?.hint ?? '';
  byId('hint').hidden = Boolean(selected) || !scene?.hint;
}

function paintDetail(focus = false) {
  const show = Boolean(state.detail);
  byId('reading').inert = show && narrowScreen.matches;
  document.querySelector('.topbar').inert = show && narrowScreen.matches;
  detail.inert = !show;
  detail.hidden = !show;
  if (show && (renderedDetail !== state.detail || focus)) {
    const title = renderDetails(ctx, state.detail, () => closeDetail(true));
    if (focus) title.focus({ preventScroll: true });
  }
  renderedDetail = state.detail;
}

function render(camera = null, focus = false) {
  paintDetail(focus);
  byId('world').replaceChildren();
  scene = renderReading();
  byId('world').hidden = !scene;
  byId('controls').hidden = !scene;
  byId('reset').hidden = byId('export').hidden = !scene?.draggable;
  drawNavigation();
  ctx.camera.setScene(scene, camera);
  if (!camera || state.detail) ctx.camera.reveal(scene?.cardsByAddress.get(state.selected)?.card);
  paintSelection();
}

function renderReading() {
  byId('view-content').onscroll = null;
  byId('view-content').replaceChildren();
  byId('view-content').hidden = true;
  document.body.dataset.reading = state.mode;
  return readModes.get(state.mode).render(ctx);
}

function navigate(mode, address, intent, options = {}) {
  if (!readModes.has(mode) || !index.get(address)) return;
  const previous = state;
  const camera = options.before ?? ctx.camera.save();
  const owner = scene?.cardsByAddress.get(address)?.card;
  const oldScene = scene;
  const clone = options.transition ? ctx.camera.snapshot() : null;
  const next = options.saved ?? stateFor(mode, address, intent, options.detail);
  if (previous && !options.pop) {
    restored.set(previous.viewId, { ...previous, camera });
    saveHistory(true, camera);
  }
  ctx.camera.abortGesture();
  ctx.camera.stopTransition();
  ctx.directory.close();
  state = next;
  render(next.camera, Boolean(next.detail));
  if (!next.detail) {
    const target = scene?.cardsByAddress.get(next.selected)?.element;
    (options.transition || options.focus ? target ?? byId('viewport') : null)?.focus({ preventScroll: true });
  }
  if (!options.pop) saveHistory(false);
  if (options.transition === 'in') ctx.camera.animateLevel(clone, oldScene, owner, camera, true);
  if (options.transition === 'out') {
    const enclosing = scene?.cardsByAddress.get(options.via)?.card;
    ctx.camera.animateLevel(clone, oldScene, enclosing, ctx.camera.save(), false);
  }
  announce('当前视图 ' + byId('view-detail').textContent);
}

function select(address, showDetail = false) {
  state = { ...state, address, selected: address, detail: showDetail ? address : null };
  paintDetail(showDetail);
  if (!showDetail) ctx.camera.reveal(scene?.cardsByAddress.get(address)?.card);
  paintSelection();
  saveHistory();
}

function inspect(address) {
  if (address) select(address, true);
}

function closeDetail(focus = false) {
  if (!state.detail) return;
  state = { ...state, detail: null };
  paintDetail();
  paintSelection();
  saveHistory();
  if (focus) ctx.camera.focusWithoutMoving(scene?.cardsByAddress.get(state.selected)?.element ??
    byId('view-content').querySelector('[data-object="' + state.selected + '"]') ??
    byId('view-detail'));
}

function enter(address, before) {
  if (!canEnter(address)) return;
  navigate(modeFor(address), address, 'enter', { transition: 'in', before });
}

function jump(address, locate = false) {
  const type = index.get(address).type;
  const mode = type === 'flow' && locate ? 'map' : modeFor(address);
  navigate(mode, address, 'jump', { detail: !['module', 'system', 'flow'].includes(type), focus: true });
}

function returnTo(id, animated = true) {
  if (id === state.viewId && state.mode === 'map') return false;
  const path = index.pathTo(state.viewId);
  const via = path[path.findIndex((object) => object.id === id) + 1]?.id;
  const saved = restored.get(id);
  const next = saved?.mode === 'map' ? { ...saved, detail: null }
    : { ...stateFor('map', id, 'enter'), address: via ?? id, selected: via ?? null };
  navigate('map', next.address, 'enter', { saved: next, transition: animated ? 'out' : null, via, focus: true });
  return true;
}

function back(animated = true) {
  const parent = index.pathTo(state.viewId).slice(0, -1).reverse().find((item) =>
    ['system', 'module'].includes(item.type));
  if (parent) return returnTo(parent.id, animated);
  if (state.mode !== 'map') return returnTo(root, animated);
  return false;
}

function setPositions(viewId, value) {
  Object.defineProperty(savedPositions, viewId, { value, enumerable: true, configurable: true, writable: true });
  const saved = writeStorage(storageKey, savedPositions);
  announce(saved ? '布局已保存' : '浏览器无法保存位置，可导出布局文件');
}

function move(card) {
  setPositions(state.viewId, { ...positions(state.viewId), [card.id]: { x: card.x, y: card.y } });
  render(ctx.camera.save());
}

function downloadLayout() {
  downloadJson(exportData(), 'layout.json');
}

function restoreLocation() {
  const next = locationState();
  if (next.address === state.address && next.mode === state.mode && next.viewId === state.viewId &&
      next.selected === state.selected && next.detail === state.detail) {
    if (location.hash !== addressHash(next.mode, next.address)) saveHistory();
    return;
  }
  navigate(next.mode, next.address, 'address', { saved: next, pop: true, focus: true });
  if (location.hash !== addressHash(next.mode, next.address)) saveHistory();
}

function initialize() {
  document.title = input.design.title + ' · ArkiGo';
  const toolIcons = {
    'search-open': 'search',
    'zoom-in': 'plus', 'zoom-out': 'minus', fit: 'fit', reset: 'reset', export: 'export'
  };
  for (const [id, glyph] of Object.entries(toolIcons)) {
    const tool = byId(id);
    const label = tool.getAttribute('aria-label');
    if (label) tool.title = label;
    tool.prepend(icon(glyph));
  }
  byId('search-open').onclick = ctx.directory.search;
  byId('zoom-in').onclick = () => ctx.camera.zoom(1.22);
  byId('zoom-out').onclick = () => ctx.camera.zoom(1 / 1.22);
  byId('fit').onclick = ctx.camera.reset;
  byId('reset').onclick = () => {
    setPositions(state.viewId, {});
    render();
  };
  byId('export').onclick = downloadLayout;
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  const effectiveTheme = () => document.documentElement.dataset.theme ?? (systemTheme.matches ? 'dark' : 'light');
  const theme = byId('theme');
  function paintTheme() {
    const dark = effectiveTheme() === 'dark';
    theme.replaceChildren(icon(dark ? 'sun' : 'moon'));
    theme.setAttribute('aria-label', dark ? '切换到浅色' : '切换到深色');
    theme.title = theme.getAttribute('aria-label');
  }
  theme.onclick = () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('arkigo-theme', next); } catch {}
    paintTheme();
  };
  systemTheme.addEventListener('change', paintTheme);
  paintTheme();

  document.addEventListener('pointerdown', () => { document.documentElement.dataset.input = 'pointer'; }, true);
  document.addEventListener('keydown', (event) => {
    document.documentElement.dataset.input = 'keyboard';
    const editing = event.target.closest('input, textarea, select, [contenteditable="true"]');
    const browse = ctx.directory.active();
    if (event.key === 'Escape' && !browse) {
      if (state.detail) closeDetail(true);
      else back(false);
      event.preventDefault();
    } else if (event.altKey && event.key === 'ArrowLeft' && !editing && !browse) {
      back(false);
      event.preventDefault();
    } else if (!editing && !browse && !detail.contains(event.target) &&
        (event.key === '/' || event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      ctx.directory.search();
    } else if (!editing && !browse && event.key.toLowerCase() === 'i' && state.selected) {
      inspect(state.selected);
      event.preventDefault();
    }
  });
  window.addEventListener('popstate', restoreLocation);
  window.addEventListener('hashchange', restoreLocation);
  narrowScreen.addEventListener('change', () => {
    ctx.camera.stopTransition();
    render();
  });
  largeTargets.addEventListener('change', () => render(ctx.camera.save()));
  reducedMotion.addEventListener('change', () => ctx.camera.stopTransition());
  state = locationState();
  render(state.camera);
  saveHistory();
  let lastWidth = window.innerWidth;
  let lastHeight = window.innerHeight;
  window.addEventListener('resize', () => {
    if (lastWidth === window.innerWidth && lastHeight === window.innerHeight) return;
    lastWidth = window.innerWidth;
    lastHeight = window.innerHeight;
    render();
  });
  window.arkigoCanvas = Object.freeze({
    getState: () => structuredClone({
      mode: state.mode, address: state.address, viewId: state.viewId, selected: state.selected, detail: state.detail,
      path: index.pathTo(state.viewId).map((object) => object.id), camera: ctx.camera.save(),
      direction: ctx.direction, transitioning: ctx.camera.transitioning(), panel: ctx.directory.active(),
      layout: exportData(), cards: scene?.cards ?? [], zones: scene?.zones ?? []
    })
  });
}

initialize();
