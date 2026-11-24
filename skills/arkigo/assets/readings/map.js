registerRead('map', {
  label: '地图',
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
    const people = drawn.some((item) => item.type !== 'actor') ? drawn.filter((item) => item.type === 'actor') : [];
    const cards = drawn.filter((item) => !people.includes(item));
    if (!cards.length) {
      showSceneEmpty(annotations.length ? '此层只有规则、验收或决策' : '此层暂无对象');
      return null;
    }
    const records = new Map(cards.map((card) => [card.id, card]));
    const projected = projectRelations(ctx.index, ctx.design.relations, container.id, new Set(records.keys()));
    const plan = layoutMap(cards, projected.edges, { positions: ctx.positions(container.id) });
    const scene = renderGraph(ctx, plan, records, projected.annotations, true);
    if (plan.edges.some((edge) => !edge.main)) scene.hint = '只画主要关系，选中卡片看它的全部关系';
    scene.related = (address) => new Set(ctx.design.relations
      .filter(({ from, to }) => (from === address) !== (to === address))
      .map(({ from, to }) => projected.owner(from === address ? to : from)).filter(Boolean));
    return scene;
  }
});
