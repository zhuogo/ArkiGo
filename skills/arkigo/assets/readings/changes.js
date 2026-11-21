const changeLabels = { add: '新增', update: '修改', remove: '删除', link: '新增关系', unlink: '删除关系' };

function changeValue(value) {
  if (value === undefined) return '（无）';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function compareField({ path, before, after }) {
  const field = make('div', 'changed-field');
  const key = path.replace(/^body\./, '');
  const label = Object.hasOwn(fieldLabels, key) ? fieldLabels[key] : null;
  field.append(make(label ? 'span' : 'code', 'field-path', label ?? path));
  const pair = make('div', 'diff-pair');
  const values = changeText(changeValue(before), changeValue(after));
  for (const [i, { leading, changed, trailing }] of values.entries()) {
    const cell = make('div', 'diff-cell');
    const value = make('pre');
    const mark = make(i === 0 ? 'del' : 'ins', '', changed);
    value.append(textNode(leading), mark, textNode(trailing));
    cell.append(make('span', 'muted', i === 0 ? '修改前' : '修改后'), value);
    pair.append(cell);
  }
  field.append(pair);
  return field;
}

function changeEntry(ctx, entry) {
  const item = make('li', 'change-entry');
  if (entry.relation) {
    const { from, to, type, label, when } = entry.relation;
    const subject = (id) => ctx.index.get(id)?.title ?? id;
    const description = subject(from) + ' → ' + subject(to);
    item.append(make('strong', '', description), make('p', 'muted', [relationNames[type], label, when]
      .filter(Boolean).join(' · ')));
    return item;
  }
  const object = entry.after ?? entry.before;
  const live = ctx.index.objects.get(entry.id);
  if (live) item.append(inspectButton(ctx, live, object?.title ?? entry.id));
  else item.append(make('strong', '', object?.title ?? entry.id));
  if (entry.op === 'update') {
    for (const field of fieldChanges(entry)) item.append(compareField(field));
  }
  return item;
}

registerRead('changes', {
  label: '变更', icon: 'reset', article: true,
  render(ctx) {
    const page = articleReading(ctx, '设计变更', 'changes-page');
    if (!ctx.history.length) {
      page.append(readingEmpty('暂无变更记录，设计更新后可在此查看。'));
      return;
    }
    const archive = make('ol', 'change-archive');
    const detail = make('div', 'change-details');
    const timestamp = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
    const controls = [];
    function show() {
      for (const [i, control] of controls.entries()) {
        control.setAttribute('aria-pressed', String(ctx.activeChange === i));
      }
      detail.replaceChildren();
      if (ctx.activeChange === null) {
        detail.append(readingEmpty('请选择一条变更记录查看详情。'));
        return;
      }
      const record = ctx.history[ctx.activeChange];
      const heading = make('div', 'reading-actions');
      heading.append(make('h2', '', record.reason), button('取消选中', () => {
        const previous = controls[ctx.activeChange];
        ctx.setChange(null);
        show();
        previous.focus();
      }));
      detail.append(heading, make('p', 'muted', record.base + ' → ' + record.result));
      for (const [kind, entries] of Object.entries(historyChanges(ctx.index, ctx.history, ctx.activeChange))) {
        const section = make('section', 'change-section');
        section.dataset.change = kind;
        section.append(make('h3', '', changeLabels[kind] + ' · ' + entries.length));
        const list = make('ul');
        for (const entry of entries) list.append(changeEntry(ctx, entry));
        section.append(list);
        detail.append(section);
      }
    }
    for (const [i, record] of ctx.history.entries()) {
      const row = make('li');
      const control = button(undefined, () => { ctx.setChange(i); show(); }, 'tool change-record');
      const time = make('time', '', timestamp.format(new Date(record.at)));
      time.dateTime = record.at;
      control.append(make('strong', '', record.reason), time, make('small', 'muted', record.by));
      controls.push(control);
      row.append(control);
      archive.append(row);
    }
    page.append(archive, detail);
    show();
  }
});
