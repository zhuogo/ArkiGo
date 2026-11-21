// Whose work the map shows comes before the map, and how much of it is built.
function mapFacts(ctx, container, people) {
  const facts = [];
  if (people.length) {
    const group = make('div', 'fact people');
    group.append(make('span', 'fact-name', types.actor));
    for (const person of people) {
      const chip = button(undefined, () => ctx.select(person.id, true), 'tool person');
      chip.dataset.object = person.id;
      chip.title = person.summary;
      chip.append(icon('actor'), textNode(person.title));
      group.append(chip);
    }
    facts.push(group);
  }
  const counts = new Map();
  for (const object of ctx.index.objects.values()) {
    if (object.id === container.id || !ctx.index.pathTo(object.id).includes(container)) continue;
    const state = implementationState(object, ctx.evidence);
    if (state) counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  if (counts.size) {
    const progress = button(undefined, () => ctx.navigate('progress', container.id), 'tool fact progress-fact');
    progress.append(make('span', 'fact-name', '实现情况'));
    for (const state of Object.keys(implementations)) {
      if (!counts.has(state)) continue;
      const part = statusMark(state, implementations, 'implementation-status');
      part.append(make('b', '', counts.get(state)));
      progress.append(part);
    }
    facts.push(progress);
  }
  return facts;
}

registerRead('map', {
  label: '地图',
  icon: 'system',
  entry: true,
  resolve(ctx, address, intent) {
    const object = ctx.index.get(address);
    const enter = intent === 'enter' || intent === 'address' && object.type === 'module';
    const viewId = enter || object.id === ctx.index.root.id ? object.id : ctx.index.containerFor(object.parent).id;
    return { viewId, selected: enter || object.id === viewId ? null : address };
  },
  render(ctx) {
    const container = ctx.index.get(ctx.viewId);
    const children = ctx.index.children.get(container.id) ?? [];
    const annotations = children.filter((item) => Object.values(annotationTypes).includes(item.type));
    const drawn = children.filter((item) => !annotations.includes(item));
    // People are named above the map. They become cards only when the level holds nothing else.
    const people = drawn.some((item) => item.type !== 'actor') ? drawn.filter((item) => item.type === 'actor') : [];
    const cards = drawn.filter((item) => !people.includes(item));
    ctx.heading(container.title, container.summary, mapFacts(ctx, container, people));
    if (!cards.length) {
      showSceneEmpty(annotations.length ? '此层只有规则、验收或决策' : '此层暂无对象');
      return null;
    }
    const records = new Map(cards.map((card) => [card.id, card]));
    const projected = projectRelations(ctx.index, ctx.design.relations, container.id, new Set(records.keys()));
    const plan = layoutMap(cards, projected.edges, {
      direction: ctx.direction, availableWidth: ctx.availableWidth, positions: ctx.positions(container.id)
    });
    const scene = renderGraph(ctx, plan, records, projected.annotations, true);
    if (plan.edges.some((edge) => !edge.main)) scene.hint = '只画主要关系，选中卡片看它的全部关系';
    scene.related = (address) => new Set(ctx.design.relations
      .filter(({ from, to }) => (from === address) !== (to === address))
      .map(({ from, to }) => projected.owner(from === address ? to : from)).filter(Boolean));
    return scene;
  }
});
