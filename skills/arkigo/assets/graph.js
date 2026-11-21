function graphCard(ctx, card, data, marks) {
  const element = make('button', 'graph-card');
  element.type = 'button';
  element.dataset.id = data.id;
  element.dataset.type = data.type;
  element.dataset.enterable = String(ctx.canEnter(data.id));
  element.setAttribute('aria-pressed', 'false');
  element.title = inlinePlain(data.title, ctx) + (data.summary ? '\n' + data.summary : '');
  cssBox(element, card);
  const head = make('span', 'card-meta');
  const kind = make('span', 'card-kind');
  kind.append(typeMark(data.type), textNode(data.actor ? ctx.index.get(data.actor).title : types[data.type] ?? '步骤'));
  head.append(kind);
  const implementation = implementationState(data, ctx.evidence);
  if (data.phase) head.append(make('span', 'step-phase', data.phase));
  else if (implementation) head.append(codeCheckMark(data, ctx.evidence));
  const flags = make('span', 'card-flags');
  for (const [type, relations] of Object.entries(marks ?? {})) {
    const label = annotationTypes[type];
    const mark = make('span', 'card-count');
    mark.title = types[label] + ' ' + relations.length;
    mark.append(icon(label), textNode(String(relations.length)));
    flags.append(mark);
  }
  if (data.failure) {
    const mark = make('span', 'card-count failure');
    mark.append(icon('warning'), textNode('失败处理'));
    flags.append(mark);
  }
  if (ctx.canEnter(data.id)) flags.append(icon('right'));
  element.append(head, make('strong', 'card-title', inlinePlain(data.title, ctx)),
    make('span', 'card-summary', inlinePlain(data.summary, ctx)), flags);
  let touch = false;
  element.addEventListener('pointerdown', (event) => { touch = event.pointerType === 'touch'; });
  element.addEventListener('click', (event) => {
    if (ctx.camera.consumeClick(event)) return;
    ctx.select(data.id, true);
  });
  element.addEventListener('dblclick', () => {
    if (!touch && ctx.canEnter(data.id)) ctx.enter(data.id);
  });
  element.addEventListener('focus', () => ctx.camera.revealFocusedCard(card));
  return element;
}

const connectionPalette = [
  ['#2861b4', '#83b6ff'], ['#a74f17', '#ffab71'], ['#287854', '#6fd9a2'],
  ['#7646ae', '#c9a2fc'], ['#aa3c6d', '#f498c0'], ['#167980', '#68d7dc'],
  ['#856500', '#eac35b'], ['#4b5598', '#a4afff'], ['#903c97', '#e8a3e7'],
  ['#5d711f', '#b9d674'], ['#b13e42', '#ff9b99'], ['#286f96', '#76cbe8']
].map(([light, dark]) => 'light-dark(' + light + ', ' + dark + ')');

function renderGraph(ctx, plan, records, annotations = new Map(), draggable = false) {
  const world = byId('world');
  const cardElements = new Map();
  const visible = new Map(plan.cards.map((card) => [card.id, card]));
  const vertical = plan.direction === 'vertical';
  const colors = plan.edges.map((_, index) => {
    if (index < connectionPalette.length) return connectionPalette[index];
    // Space additional hues apart while keeping contrast consistent within each theme.
    const hue = index * 137.508 % 360;
    return 'light-dark(oklch(48% .12 ' + hue + '), oklch(76% .12 ' + hue + '))';
  });
  const routes = svgElement('svg', { class: 'graph-edges', width: 1, height: 1, 'aria-hidden': true });
  const defs = svgElement('defs', {});
  for (const [index, color] of colors.entries()) {
    const arrow = svgElement('marker', {
      id: 'graph-arrow-' + index, viewBox: '0 0 10 10', refX: 9, refY: 5,
      markerWidth: 9, markerHeight: 9, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse'
    });
    arrow.append(svgElement('path', { d: 'M1 1l8 4-8 4', class: 'arrow-tip', style: '--connection-color:' + color }));
    defs.append(arrow);
  }
  routes.append(defs);
  const paths = svgElement('g', {});
  const emphasizedPaths = svgElement('g', {});
  routes.append(paths, emphasizedPaths);
  const labels = make('div', 'edge-labels');
  for (const zone of plan.zones) {
    const box = make('div', 'graph-zone');
    cssBox(box, zone);
    if (zone.height > plan.cards[0].height) box.append(make('span', '', types[zone.group] ?? zone.group));
    world.append(box);
  }
  world.append(routes, labels);
  for (const card of plan.cards) {
    const data = records.get(card.id);
    const element = graphCard(ctx, card, data, annotations.get(card.id));
    if (draggable) element.dataset.draggable = card.id;
    cardElements.set(data.id, { card, element });
    world.append(element);
  }
  function drawEdges(scale = 1) {
    paths.replaceChildren();
    emphasizedPaths.replaceChildren();
    labels.replaceChildren();
    const occupied = [];
    const ports = new Map();
    const used = new Map();
    const connections = [];
    // Lines drawn by default claim their label positions first.
    const ordered = [...plan.edges].sort((a, b) => Number(a.main === false) - Number(b.main === false));
    for (const [index, edge] of ordered.entries()) {
      const from = visible.get(edge.from);
      const to = visible.get(edge.to);
      // On a map every line of a card leaves from its own place, so lines that share a corridor stay apart.
      const pair = edge.from + '/' + edge.to;
      const lane = edge.relations ? Math.max(used.get(edge.from) ?? 0, used.get(edge.to) ?? 0) : ports.get(pair) ?? 0;
      ports.set(pair, lane + 1);
      used.set(edge.from, lane + 1);
      used.set(edge.to, lane + 1);
      const points = routeConnection(from, to, plan.cards, vertical, edge.back,
        (lane % 2 ? 1 : -1) * Math.min(edge.relations ? 44 : 28, Math.ceil(lane / 2) * (edge.relations ? 11 : 8)));
      if (!points) continue;
      const ends = { 'data-from': records.get(edge.from).id, 'data-to': records.get(edge.to).id };
      const selected = ctx.selection() === ends['data-from'] || ctx.selection() === ends['data-to'];
      const kind = (edge.back ? ' back-edge' : '') + (edge.main === false ? ' minor-edge' : '') +
        (selected ? ' edge-selected' : '');
      const color = colors[index];
      const arrow = 'url(#graph-arrow-' + index + ')';
      const path = svgElement('path', {
        class: 'graph-edge' + kind, ...ends, d: roundedPath(points, plan.cards), style: '--connection-color:' + color,
        'marker-end': arrow, ...(edge.mutual && { 'marker-start': arrow })
      });
      paths.append(path);
      connections.push({ edge, points, kind, ends, path, color });
    }
    const mainRoutes = connections.filter(({ edge }) => edge.main !== false).map(({ points }) => points);
    for (const { edge, points, kind, ends, path, color } of connections) {
      const name = relationNames[edge.type];
      const exactLabel = edge.count === 1 ? edge.relations[0].label ?? edge.relations[0].when : undefined;
      const label = edge.when ?? exactLabel ?? name;
      const title = label ? inlinePlain(label, ctx) : '';
      if (!title) continue;
      const caption = title + (edge.count > 1 ? ' ×' + edge.count : '');
      const between = () => inlinePlain(records.get(edge.from).title, ctx) + ' 与 ' +
        inlinePlain(records.get(edge.to).title, ctx);
      const tag = edge.relations
        ? button(undefined, () => ctx.directory.relations(between() + ' · ' + edge.count + ' 条关系', edge.relations),
          'edge-label' + kind)
        : make('span', 'edge-label' + kind);
      tag.append(make('span', '', caption));
      tag.title = caption;
      tag.dataset.from = ends['data-from'];
      tag.dataset.to = ends['data-to'];
      tag.style.setProperty('--connection-color', color);
      const emphasize = () => {
        const active = tag.matches(':hover, :focus-visible');
        path.classList.toggle('edge-emphasized', active);
        (active ? emphasizedPaths : paths).append(path);
      };
      for (const event of ['pointerenter', 'pointerleave', 'focus', 'blur']) {
        tag.addEventListener(event, emphasize);
      }
      const textWidth = [...caption].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 12 : 7), 0);
      const separate = largeTargets.matches && Boolean(edge.relations);
      const target = separate ? Math.ceil(44 / scale) : 0;
      const width = Math.max(target, Math.min(190, 14 + textWidth));
      const height = Math.max(target, 23);
      let position = placeConnectionLabel(
        points, width, height, plan.cards, occupied, plan.bounds, vertical, separate,
        edge.main === false ? [...mainRoutes, points] : mainRoutes
      );
      // A label too long for the gap between two cards is cut to the gap; its title keeps the full text.
      const blocking = plan.cards.filter((card) => overlaps(card, position));
      if (blocking.length) {
        const middle = position.x + position.width / 2;
        const before = blocking.filter((card) => card.x + card.width / 2 < middle);
        const left = Math.max(position.x, ...before.map((card) => card.x + card.width + 4));
        const right = Math.min(position.x + position.width,
          ...blocking.filter((card) => !before.includes(card)).map((card) => card.x - 4));
        if (right - left >= Math.max(target, 40)) position = { ...position, x: left, width: right - left };
      }
      cssBox(tag, position);
      occupied.push(position);
      labels.append(tag);
    }
  }
  drawEdges();
  return { ...plan, cardsByAddress: cardElements, drawEdges, draggable };
}

function showSceneEmpty(title, content) {
  const empty = make('div', 'empty-scene');
  empty.append(emptyIllustration(), make('h2', '', title));
  if (content) empty.append(content);
  byId('view-content').hidden = false;
  byId('view-content').append(empty);
}
