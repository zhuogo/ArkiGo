function showProgressObjects(ctx, title, objects) {
  const list = make('ul', 'reading-object-list');
  for (const object of objects) {
    const row = make('li');
    const action = inspectButton(ctx, object);
    action.addEventListener('click', () => ctx.directory.close(), { capture: true });
    row.append(action);
    list.append(row);
  }
  ctx.directory.open('progress', title, objects.length ? list : readingEmpty('此项为 0，可返回进度查看其他状态。'));
}

function progressCounts(ctx, owner, kind, labels, groups) {
  const counts = make('div', 'progress-counts');
  for (const [state, items] of Object.entries(groups)) {
    const title = labels[state];
    const control = button(title + ' ' + items.length,
      () => showProgressObjects(ctx, owner.title + ' · ' + title, items), 'tool progress-count');
    control.dataset.kind = kind;
    control.dataset.state = state;
    control.dataset.count = items.length;
    counts.append(control);
  }
  return counts;
}

registerRead('progress', {
  label: '进度', icon: 'progress', article: true,
  render(ctx) {
    const result = progressGroups(ctx.index, ctx.evidence);
    const page = articleReading(ctx, '项目进度', 'progress-page');
    if (!result.matched) page.append(make('p', 'reading-notice', '本次生成未核对依据。'));
    if (!result.groups.length) {
      page.append(readingEmpty('暂无实现或验收条目，可从地图查看项目。'));
      return;
    }
    for (const { owner, implementation, verification } of result.groups) {
      const row = make('section', 'progress-group');
      row.dataset.module = owner.id;
      row.append(make('h2', '', owner.type === 'system' ? '项目直属' : owner.title));
      const bar = make('div', 'progress-bar');
      bar.setAttribute('aria-label', '实现情况分布');
      for (const [state, items] of Object.entries(implementation)) {
        if (!items.length) continue;
        const segment = make('span', '', items.length);
        segment.dataset.state = state;
        segment.style.flexGrow = items.length;
        segment.title = implementations[state] + ' ' + items.length;
        bar.append(segment);
      }
      if (bar.children.length) row.append(bar);
      row.append(progressCounts(ctx, owner, 'implementation', implementations, implementation),
        make('h3', '', '验收结果'), progressCounts(ctx, owner, 'verification', verificationStates, verification));
      page.append(row);
    }
    if (!result.review.length) return;
    const review = make('section', 'progress-group');
    review.append(make('h2', '', '需复查的依据'));
    const list = make('ul', 'reading-object-list');
    for (const { object, path, state } of result.review) {
      const row = make('li', 'review-evidence');
      row.append(inspectButton(ctx, object), make('code', '', path), make('span', 'muted', evidenceLabels[state]));
      list.append(row);
    }
    review.append(list);
    page.append(review);
  }
});
