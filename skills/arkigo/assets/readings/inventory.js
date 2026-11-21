const inventoryColumns = {
  rule: [['触发条件', ({ body }) => body.when], ['约束', ({ body }) => body.constraint]],
  acceptance: [['当', ({ body }) => body.when], ['验收结果', (object) =>
    verificationStates[object.verification?.status ?? 'unknown']]],
  decision: [['问题', ({ body }) => body.question], ['结论', ({ body }) => body.chosen == null
    ? '待定' : body.options?.[body.chosen]?.title]],
  entity: [['字段数', ({ body }) => body.fields?.length ?? 0], ['归属', ({ body }) => body.ownership]],
  interface: [['类型', ({ body }) => body.kind], ['签名', ({ body }) => body.signature]],
  screen: [['路由', ({ body }) => body.route], ['用途', ({ body }) => body.purpose]]
};

function filterSelect(label, entries) {
  const field = make('label', 'reading-field');
  const select = make('select');
  select.setAttribute('aria-label', label);
  field.append(make('span', '', label), select);
  for (const [key, text] of [['', '全部'], ...entries]) {
    const option = make('option', '', text);
    option.value = key;
    select.append(option);
  }
  return { field, select };
}

function inventoryTable(ctx, type, rows) {
  const section = make('section', 'inventory-section');
  const title = type === 'decision' ? '待定与决策' : types[type];
  section.append(make('h2', '', title + ' · ' + rows.length));
  if (!rows.length) return section;
  const table = make('table', 'inventory-table');
  table.setAttribute('aria-label', title);
  const columns = [['名称'], ...inventoryColumns[type], ['所属模块'], ['设计状态']];
  const head = table.createTHead().insertRow();
  for (const [name] of columns) {
    const cell = make('th', '', name);
    cell.scope = 'col';
    head.append(cell);
  }
  const body = table.createTBody();
  for (const { object, module } of rows) {
    const row = body.insertRow();
    const first = row.insertCell();
    const action = inspectButton(ctx, object);
    first.append(action);
    const values = [...inventoryColumns[type].map(([, value]) => value(object)),
      module?.title, statuses[object.status]];
    for (const [i, value] of values.entries()) {
      const cell = row.insertCell();
      cell.append(make('span', 'inventory-cell-label', columns[i + 1][0]));
      cell.append(rich(make('span'), String(value ?? '—'), ctx));
    }
    row.addEventListener('click', (event) => { if (!event.target.closest('a, button')) action.click(); });
  }
  section.append(table);
  return section;
}

registerRead('inventory', {
  label: '清单', article: true,
  render(ctx) {
    const page = articleReading('项目清单', 'inventory-page');
    const toolbar = make('div', 'reading-toolbar');
    const modules = [...ctx.index.objects.values()].filter(({ type }) => type === 'module').sort(compareObjects);
    const filters = {
      status: filterSelect('设计状态', Object.entries(statuses)),
      module: filterSelect('所属模块', [['@root', '项目直属'], ...modules.map(({ id, title }) => [id, title])])
    };
    const results = make('div', 'inventory-results');
    const count = make('output', 'muted');
    count.setAttribute('aria-live', 'polite');
    const entries = Object.entries(filters);
    const clear = button('清除筛选', () => {
      for (const [, { select }] of entries) select.value = '';
      show();
      filters.status.select.focus();
    });
    function show() {
      const values = Object.fromEntries(entries.map(([key, { select }]) => [key, select.value]));
      const tables = inventoryRows(ctx.index, ctx.evidence, values);
      const total = Object.values(tables).reduce((sum, rows) => sum + rows.length, 0);
      const filtered = Object.values(values).some(Boolean);
      clear.disabled = !filtered;
      count.textContent = total + ' 项';
      results.replaceChildren(...(total
        ? Object.entries(tables).map(([type, rows]) => inventoryTable(ctx, type, rows))
        : [readingEmpty(filtered ? '当前筛选没有结果，可清除筛选查看全部。' : '暂无清单条目，可从地图查看项目。')]));
    }
    for (const [, { field, select }] of entries) {
      select.addEventListener('change', show);
      toolbar.append(field);
    }
    toolbar.append(clear, count);
    page.append(toolbar, results);
    show();
  }
});
