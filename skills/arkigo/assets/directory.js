function createDirectory(ctx) {
  const dialog = byId('browse');
  const body = byId('browse-body');
  const title = byId('browse-title');
  const close = byId('browse-close');
  let mode;
  const expanded = new Set([ctx.index.root.id]);
  const searchIndex = buildSearchIndex(ctx.index, ctx.evidence);
  close.append(icon('close'));
  close.setAttribute('aria-label', '关闭浏览面板');
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  function open(name, heading, content, focus = close) {
    mode = name;
    dialog.dataset.panel = name;
    title.textContent = heading;
    body.replaceChildren(content);
    body.scrollTop = 0;
    if (!dialog.open) dialog.showModal();
    focus.focus();
  }

  // One panel finds things: the project's contents as a tree, and the matches once something is typed.
  function search() {
    const contents = make('div', 'search-contents');
    const field = make('div', 'search-field');
    const input = make('input');
    input.type = 'search';
    input.placeholder = '输入标题、内容或依据';
    input.setAttribute('aria-label', '搜索全部对象');
    const clear = iconButton('close', '清除搜索', () => {
      input.value = '';
      render();
      input.focus();
    });
    clear.classList.add('search-clear');
    field.append(icon('search'), input, clear);
    const list = make('div', 'search-results');
    const count = make('output', 'muted');
    count.setAttribute('aria-live', 'polite');
    const contentsTree = make('div', 'search-directory');
    // The pages without an entry of their own are found here as well.
    const pages = make('div', 'browse-pages');
    for (const [mode, label, glyph] of [
      ['inventory', '按类型列出全部', 'inventory'], ['progress', '实现情况', 'progress'], ['changes', '最近变更', 'reset']
    ]) {
      const page = button(label, () => ctx.navigate(mode, ctx.selection() ?? ctx.viewId), 'tool');
      page.dataset.mode = mode;
      page.prepend(icon(glyph));
      pages.append(page);
    }
    contentsTree.append(tree(), pages);
    const render = () => {
      const typed = Boolean(input.value.trim());
      const entries = searchDesign(searchIndex, input.value);
      count.textContent = typed ? entries.length + ' 个结果' : '';
      contentsTree.hidden = typed;
      list.replaceChildren();
      for (const { object, path } of entries) {
        const link = objectLink(ctx, object.id, undefined, 'search-result', true);
        const labels = make('span');
        labels.append(make('strong', '', object.title),
          make('small', 'muted', path.map((item) => item.title).join(' / ')));
        link.replaceChildren(typeMark(object.type), labels, icon('right'));
        list.append(link);
      }
    };
    input.addEventListener('input', render);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        (list.querySelector('a') ?? contentsTree.querySelector('a'))?.focus();
      }
      if (event.key === 'Enter') list.querySelector('a')?.click();
    });
    contents.append(field, count, list, contentsTree);
    open('search', '查找', contents, input);
  }

  function tree() {
    const list = make('ul', 'tree-list');
    for (const object of ctx.index.pathTo(ctx.selection() ?? ctx.index.root.id).slice(0, -1)) {
      expanded.add(object.id);
    }
    function branch(object) {
      const item = make('li');
      const row = make('div', 'tree-row');
      const children = ctx.index.children.get(object.id) ?? [];
      const sub = make('ul', 'tree-list');
      if (children.length) {
        let populated = false;
        const toggle = iconButton('right', '展开 ' + object.title, () => {
          if (expanded.has(object.id)) expanded.delete(object.id);
          else expanded.add(object.id);
          sync();
        });
        function sync() {
          const visible = expanded.has(object.id);
          toggle.replaceChildren(icon(visible ? 'down' : 'right'));
          const label = (visible ? '折叠 ' : '展开 ') + object.title;
          toggle.setAttribute('aria-label', label);
          toggle.title = label;
          toggle.setAttribute('aria-expanded', String(visible));
          sub.hidden = !visible;
          if (visible && !populated) {
            sub.append(...children.map(branch));
            populated = true;
          }
        }
        sync();
        row.append(toggle);
      } else row.append(make('span', 'tree-indent'));
      const link = objectLink(ctx, object.id, undefined, 'tree-object', true);
      link.prepend(typeMark(object.type));
      if (object.id === ctx.selection()) link.setAttribute('aria-current', 'true');
      row.append(link, statusMark(object.status, statuses, 'design-status'));
      const state = implementationState(object, ctx.evidence);
      if (state) row.append(statusMark(state, implementations, 'implementation-status'));
      item.append(row);
      if (children.length) item.append(sub);
      return item;
    }
    list.append(branch(ctx.index.root));
    return list;
  }

  function relations(title, entries) {
    open('relations', title, relationRows(ctx, entries));
  }
  return {
    search, relations, open,
    close: () => { if (dialog.open) dialog.close(); },
    active: () => dialog.open ? mode : null
  };
}
