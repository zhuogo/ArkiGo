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
  else if (implementation) head.append(statusMark(implementation, implementations, 'implementation-status'));
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
  const changes = ctx.mode === 'map' && ctx.marksFor(card.id);
  if (changes?.size) {
    const label = [...changes].map((op) => changeLabels[op]).join('、');
    const mark = make('span', 'card-change', '变更');
    mark.title = label;
    mark.setAttribute('aria-label', label);
    flags.append(mark);
  }
  if (ctx.canEnter(data.id)) flags.append(icon('right'));
  element.append(head, make('strong', 'card-title', inlinePlain(data.title, ctx)),
    make('span', 'card-summary', inlinePlain(data.summary, ctx)), flags);
  element.addEventListener('click', (event) => {
    if (ctx.camera.consumeClick(event)) return;
    const enterable = ctx.canEnter(data.id);
    if (enterable && event.detail === 0 && ctx.selection() === data.id) ctx.enter(data.id);
    // Beside a wide map the details open at once. On a narrow screen they would cover the map, so a card that
    // can be entered is only selected there and the bar below offers its details and its inside.
    else ctx.select(data.id, !enterable || ctx.direction !== 'vertical');
  });
  element.addEventListener('dblclick', () => {
    if (ctx.canEnter(data.id)) ctx.enter(data.id);
  });
  element.addEventListener('focus', () => ctx.camera.reveal(card));
  return element;
}

function renderGraph(ctx, plan, records, annotations = new Map(), draggable = false) {
  const world = byId('world');
  const cardElements = new Map();
  const visible = new Map(plan.cards.map((card) => [card.id, card]));
  const vertical = plan.direction === 'vertical';
  const suffix = 'graph-arrow';
  const routes = svgElement('svg', { class: 'graph-edges', width: 1, height: 1, 'aria-hidden': true });
  const arrow = svgElement('marker', {
    id: suffix, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse'
  });
  arrow.append(svgElement('path', { d: 'M0 0l10 5-10 5z', class: 'arrow-tip' }));
  const defs = svgElement('defs', {});
  defs.append(arrow);
  routes.append(defs);
  const paths = svgElement('g', {});
  routes.append(paths);
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
    labels.replaceChildren();
    const occupied = [];
    const ports = new Map();
    const used = new Map();
    // Lines drawn by default claim their label positions first.
    for (const edge of [...plan.edges].sort((a, b) => Number(a.main === false) - Number(b.main === false))) {
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
      const kind = (edge.back ? ' back-edge' : '') + (edge.main === false ? ' minor-edge' : '');
      paths.append(svgElement('path', {
        class: 'graph-edge' + kind, ...ends, d: roundedPath(points),
        'marker-end': 'url(#' + suffix + ')', ...(edge.mutual && { 'marker-start': 'url(#' + suffix + ')' })
      }));
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
      const textWidth = [...caption].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 12 : 7), 0);
      const separate = largeTargets.matches && Boolean(edge.relations);
      const target = separate ? Math.ceil(44 / scale) : 0;
      const width = Math.max(target, Math.min(190, 14 + textWidth));
      const height = Math.max(target, 23);
      let position = placeConnectionLabel(
        points, width, height, plan.cards, occupied, plan.bounds, vertical, separate
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
