registerRead('flow', {
  label: '流程',
  resolve(ctx, address, intent) {
    const object = ctx.index.get(address);
    const flow = object.type === 'step' ? ctx.index.get(object.parent) : object;
    if (flow.type === 'flow') {
      return { viewId: flow.id, selected: object.type === 'step' || intent === 'switch' ? address : null };
    }
    return { viewId: ctx.index.root.id, selected: address === ctx.index.root.id ? null : address };
  },
  render(ctx) {
    const flow = ctx.index.get(ctx.viewId);
    if (flow.type !== 'flow') {
      const list = make('ul', 'flow-index');
      for (const item of ctx.design.objects.filter((object) => object.type === 'flow')) {
        const entry = make('li');
        entry.append(typeMark('flow'), objectLink(ctx, item.id),
          make('small', 'muted', ctx.index.pathTo(item.id).slice(0, -1).map((parent) => parent.title).join(' / ')));
        list.append(entry);
      }
      showSceneEmpty(list.children.length ? '选择流程' : '暂无流程', list.children.length ? list : null);
      return null;
    }
    const plan = layoutFlow(flow.body, { direction: ctx.direction, availableWidth: ctx.availableWidth });
    const records = new Map();
    const annotations = new Map();
    for (const step of flow.body.steps) {
      const id = flow.id + '#' + step.id;
      const phase = [flow.body.start === step.id ? '开始' : '', flow.body.ends.includes(step.id) ? '结束' : '']
        .filter(Boolean).join(' · ');
      records.set(step.id, { ...ctx.index.get(id), phase });
      const marks = ctx.design.relations.filter((edge) =>
        edge.type === 'governed_by' && edge.from === id || edge.type === 'verifies' && edge.to === id);
      annotations.set(step.id, Object.fromEntries(groupBy(marks, (mark) => mark.type)));
    }
    return renderGraph(ctx, plan, records, annotations);
  }
});
