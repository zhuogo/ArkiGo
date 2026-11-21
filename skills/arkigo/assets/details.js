const fieldLabels = {
  summary: '摘要', status: '设计状态', implementation: '实现情况', verification: '验收结果', sources: '依据',
  audience: '面向用户', goals: '目标', scopeIn: '范围内', scopeOut: '范围外', success: '成功标准',
  assumptions: '假设', description: '角色说明', inputs: '输入',
  outputs: '输出', trigger: '触发条件', preconditions: '前置条件', steps: '步骤', transitions: '流转',
  start: '起点', ends: '终点', when: '当', constraint: '约束', exceptions: '例外', rationale: '理由',
  fields: '字段', states: '状态', stateTransitions: '状态流转', ownership: '归属', retention: '保留期限',
  kind: '接口类型', signature: '签名', request: '请求', response: '响应', errors: '错误', auth: '权限',
  route: '页面路由', purpose: '用途', elements: '界面元素', media: '界面图片', given: '给定', then: '那么',
  question: '问题', options: '选项', chosen: '结论', decidedBy: '决定人', decidedAt: '决定时间',
  action: '动作', actor: '执行角色', failure: '失败处理', name: '名称', type: '类型', required: '必填',
  from: '从', to: '到', code: '错误码'
};
const evidenceLabels = { ok: '正常', changed: '内容已变', missing: '文件缺失', unrecorded: '待核对' };
const verificationStates = { passed: '通过', failed: '未通过', unknown: '未验证' };
const origins = { user: '来自用户', ai: '来自 AI', code: '来自代码', doc: '来自文档' };

function detailSection(title, content, key) {
  const section = make('section', 'detail-section');
  if (key) section.dataset.field = key;
  if (title) section.append(make('h3', '', title));
  section.append(content);
  return section;
}

function detailList(items, ctx, ordered = false) {
  const list = make(ordered ? 'ol' : 'ul');
  for (const item of items) list.append(rich(make('li'), item, ctx));
  return list;
}

function detailTable(columns, rows, ctx) {
  const wrapper = make('div', 'table-scroll');
  const table = make('table');
  const heading = table.createTHead().insertRow();
  for (const label of columns) {
    const th = rich(make('th'), label, ctx);
    th.scope = 'col';
    heading.append(th);
  }
  const body = table.createTBody();
  for (const values of rows) {
    const row = body.insertRow();
    for (const value of values) rich(row.insertCell(), value ?? '—', ctx);
  }
  wrapper.append(table);
  return wrapper;
}

function detailImage(item, ctx) {
  const figure = make('figure');
  const image = make('img');
  const segments = item.path.split('/');
  if (segments.every((part) => part && part !== '.' && part !== '..' && !part.includes('\\'))) {
    image.src = 'assets/' + segments.map(encodeURIComponent).join('/');
  }
  image.alt = item.caption ? inlinePlain(item.caption, ctx) : item.path;
  image.addEventListener('error', () => {
    image.replaceWith(make('p', 'muted', '图片无法打开 · ' + item.path));
  }, { once: true });
  figure.append(image);
  if (item.caption) figure.append(rich(make('figcaption'), item.caption, ctx));
  return figure;
}

function stateDiagram(value, ctx) {
  const list = make('ul', 'state-diagram');
  for (const { from, to, when } of value) {
    const row = make('li');
    row.append(rich(make('span', 'state-node'), from, ctx), icon('step'),
      rich(make('span', 'state-node'), to, ctx));
    if (when) row.append(rich(make('small'), when, ctx));
    list.append(row);
  }
  return list;
}

function bodyContent(key, value, object, ctx) {
  if (['fields', 'request', 'response', 'errors', 'transitions'].includes(key)) {
    const columns = key === 'errors' ? ['code', 'when'] : key === 'transitions' ? ['from', 'to', 'when']
      : ['name', 'type', 'required', 'description'];
    return detailTable(columns.map((name) => fieldLabels[name]), value.map((item) => columns.map((field) =>
      typeof item[field] === 'boolean' ? item[field] ? '是' : '否' : item[field])), ctx);
  }
  if (key === 'stateTransitions') return stateDiagram(value, ctx);
  if (key === 'media') {
    const gallery = make('div', 'media-list');
    gallery.append(...value.map((item) => detailImage(item, ctx)));
    return gallery;
  }
  if (key === 'steps' || key === 'options' || key === 'states' && typeof value[0] === 'object') {
    const list = make(key === 'states' ? 'ul' : 'ol', 'body-entries');
    for (const [i, item] of value.entries()) {
      const row = make('li');
      const title = key === 'steps'
        ? objectLink(ctx, object.id + '#' + item.id, inlinePlain(item.title, ctx))
        : rich(make('strong'), item.title ?? item.name, ctx);
      row.append(title);
      if (key === 'options' && object.body.chosen === i) row.append(make('span', 'chosen', '已选'));
      for (const field of ['detail', 'description', 'action', 'inputs', 'outputs', 'failure', 'actor']) {
        if (item[field] === undefined) continue;
        row.append(bodyRow(field, item[field], object, ctx));
      }
      list.append(row);
    }
    return list;
  }
  if (key === 'actor') return objectLink(ctx, value);
  if (key === 'start' || key === 'ends') {
    const line = make('p', 'step-links');
    for (const id of [value].flat()) line.append(objectLink(ctx, object.id + '#' + id));
    return line;
  }
  if (key === 'chosen') {
    const option = value == null ? null : object.body.options?.[value];
    return rich(make('p'), option ? option.title : '待定', ctx);
  }
  if (Array.isArray(value)) return detailList(value, ctx);
  return rich(make('p'), String(value), ctx);
}

function bodyRow(key, value, object, ctx) {
  const row = make('div', 'body-row');
  if (fieldLabels[key] && !['detail', 'description', 'action'].includes(key)) {
    row.append(make('span', 'muted', fieldLabels[key]));
  }
  row.append(bodyContent(key, value, object, ctx));
  return row;
}

const bodyFields = {
  system: ['audience', 'goals', 'scopeIn', 'scopeOut', 'success', 'assumptions'],
  actor: ['description', 'goals'],
  flow: ['trigger', 'preconditions', 'steps', 'transitions', 'start', 'ends'],
  step: ['action', 'actor', 'inputs', 'outputs', 'failure'],
  rule: ['when', 'constraint', 'exceptions', 'rationale'],
  entity: ['fields', 'states', 'stateTransitions', 'ownership', 'retention'],
  interface: ['kind', 'signature', 'request', 'response', 'errors', 'auth'],
  screen: ['route', 'purpose', 'elements', 'states', 'media'],
  acceptance: ['given', 'when', 'then'],
  decision: ['question', 'options', 'chosen', 'rationale', 'decidedBy', 'decidedAt']
};

function renderNote(note, ctx) {
  let content;
  switch (note.type) {
    case 'text': content = rich(make('p'), note.text, ctx); break;
    case 'list': content = detailList(note.items, ctx, note.ordered); break;
    case 'table': content = detailTable(note.columns, note.rows, ctx); break;
    case 'image': content = detailImage(note, ctx); break;
    case 'code': {
      content = make('pre');
      content.append(rich(make('code'), note.text, ctx));
      if (note.lang) content.dataset.language = note.lang;
      break;
    }
    case 'callout': {
      content = make('div', 'callout');
      content.dataset.tone = note.tone;
      content.append(icon(note.tone === 'warn' ? 'warning' : 'info'), rich(make('p'), note.text, ctx));
      break;
    }
  }
  const section = detailSection('', content);
  section.dataset.block = note.type;
  if (note.title) section.prepend(rich(make('h3'), note.title, ctx));
  return section;
}

function sourceStatus(ctx, id, of, path, occurrence) {
  const entries = Object.hasOwn(ctx.evidence, id) ? ctx.evidence[id] : [];
  return entries.filter((item) => item.of === of && item.path === path)[occurrence]?.state ?? 'unrecorded';
}

function editorLink(ctx, path) {
  if (!['vscode', 'cursor'].includes(ctx.editor) || !ctx.projectRoot) return null;
  if (/^(?:[\\/]|[a-z]:)/i.test(path) || path.includes('\0')) return null;
  const relative = [];
  for (const part of path.split(/[\\/]/)) {
    if (!part || part === '.') continue;
    if (part !== '..') relative.push(part);
    else if (relative.length) relative.pop();
    else return null;
  }
  if (!relative.length) return null;
  const normalizedRoot = ctx.projectRoot.replaceAll('\\', '/').replace(/\/$/, '');
  const chunks = [...normalizedRoot.split('/'), ...relative].map(encodeURIComponent);
  if (/^[a-z]:$/i.test(normalizedRoot.slice(0, 2))) chunks[0] = normalizedRoot.slice(0, 2);
  return ctx.editor + '://file/' + chunks.join('/').replace(/^\//, '');
}

async function copySource(path) {
  try {
    await navigator.clipboard.writeText(path);
  } catch {
    const area = make('textarea', 'sr-only');
    const focus = document.activeElement;
    area.value = path;
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    focus?.focus();
    if (!copied) {
      announce('复制失败');
      return;
    }
  }
  announce('已复制路径');
}

function evidenceEntries(ctx, object, items, of) {
  const occurrences = new Map();
  return items.map((item) => {
    const path = item.path ?? item.ref;
    const isFile = Boolean(item.path) || item.kind === 'file';
    const occurrence = occurrences.get(path) ?? 0;
    if (isFile) occurrences.set(path, occurrence + 1);
    const state = isFile ? sourceStatus(ctx, object.id, of, path, occurrence) : 'unrecorded';
    return { path, isFile, state, symbols: item.symbol ? [item.symbol] : [] };
  });
}

function evidenceRows(ctx, entries) {
  const list = make('ul', 'evidence-list');
  for (const { path, isFile, state, symbols } of entries) {
    const row = make('li', 'evidence-row');
    const location = make('div');
    const href = isFile && editorLink(ctx, path);
    const target = make(href ? 'a' : 'code', 'source-path', path);
    if (href) target.href = href;
    location.append(target);
    for (const symbol of symbols) location.append(make('small', 'muted', symbol));
    row.append(location, checkMark(state === 'ok' ? 'checked' : state, evidenceLabels[state],
      state === 'ok' ? 'checked' : ['changed', 'missing'].includes(state) ? 'warning' : 'unchecked'),
      iconButton('copy', '复制路径', () => copySource(path)));
    list.append(row);
  }
  return list;
}

function appendModuleContent(content, object, ctx) {
  const description = make('div');
  if (object.summary) description.append(make('p', '', object.summary));
  const responsibilities = (object.body.responsibilities ?? []).filter((item) => item !== object.summary);
  if (responsibilities.length) description.append(detailList(responsibilities, ctx));
  if (!description.children.length) description.append(make('p', 'muted', '暂无作用说明'));
  content.append(detailSection('模块作用', description, 'purpose'));

  const priorities = ['unrecorded', 'ok', 'changed', 'missing'];
  const files = new Map();
  const entries = [
    ...evidenceEntries(ctx, object, object.implementation?.evidence ?? [], 'implementation'),
    ...evidenceEntries(ctx, object, (object.sources ?? []).filter(({ kind }) => kind === 'file'), 'source')
  ];
  for (const entry of entries) {
    const current = files.get(entry.path);
    if (!current) {
      files.set(entry.path, entry);
      continue;
    }
    current.symbols = [...new Set([...current.symbols, ...entry.symbols])];
    if (priorities.indexOf(entry.state) > priorities.indexOf(current.state)) current.state = entry.state;
  }
  const relatedFiles = files.size ? evidenceRows(ctx, files.values()) : make('p', 'muted', '暂无关联文件');
  content.append(detailSection('关联文件', relatedFiles, 'files'));
}

function relationRows(ctx, entries, subject) {
  const groups = make('div', 'relation-groups');
  for (const [type, group] of groupBy(entries, (entry) => entry.type)) {
    const list = make('ul');
    for (const relation of group) {
      const row = make('li', 'relation-row');
      if (subject) {
        const outgoing = subject === relation.from;
        row.append(make('span', 'muted', outgoing ? '→ ' : '← '),
          objectLink(ctx, outgoing ? relation.to : relation.from));
      } else {
        row.append(objectLink(ctx, relation.from), make('span', 'muted', ' → '), objectLink(ctx, relation.to));
      }
      if (relation.label) row.append(rich(make('span', 'relation-note'), relation.label, ctx));
      if (relation.when) row.append(rich(make('span', 'relation-note'), relation.when, ctx));
      list.append(row);
    }
    groups.append(detailSection(relationNames[type], list));
  }
  return groups;
}

function renderDetails(ctx, address, close) {
  const object = ctx.index.get(address);
  const heading = make('div', 'detail-head');
  const title = make('h2', '', inlinePlain(object.title, ctx));
  title.id = 'detail-title';
  title.tabIndex = -1;
  const closeButton = iconButton('close', '关闭详情', close);
  const content = make('div', 'detail-content');
  if (object.type === 'module') {
    const row = make('div', 'module-detail-title');
    row.append(title);
    if (ctx.canEnter(address)) row.append(iconButton('step', '进入模块', () => ctx.enter(address)));
    row.append(closeButton);
    heading.append(row);
    appendModuleContent(content, object, ctx);
  } else {
    const meta = make('div', 'detail-meta');
    meta.append(typeMark(object.type), make('span', '', types[object.type] ?? '步骤'));
    if (object.status && object.status !== 'accepted') meta.append(statusMark(object.status, statuses, 'design-status'));
    if (object.origin) meta.append(make('span', 'muted', origins[object.origin]));
    heading.append(meta, closeButton, title);
    if (object.type !== 'step' && object.summary) heading.append(make('p', '', object.summary));
    if (ctx.canEnter(address)) {
      const actions = make('div', 'detail-actions');
      actions.append(button('查看流程', () => ctx.enter(address), 'tool primary'));
      heading.append(actions);
    }
    appendObjectContent(content, object, ctx);
    appendChildren(content, object, ctx);
    const related = ctx.design.relations.filter(({ from, to }) => from === address || to === address);
    if (related.length) content.append(detailSection('相关关系', relationRows(ctx, related, address)));
    appendEvidence(content, object, ctx);
    content.append(make('code', 'detail-id', object.id));
  }
  byId('detail').replaceChildren(heading, content);
  byId('detail').scrollTop = 0;
  return title;
}

function appendObjectContent(content, object, ctx) {
  for (const key of bodyFields[object.type]) {
    const value = object.body[key];
    if (key !== 'chosen' && (value == null || Array.isArray(value) && !value.length)) continue;
    content.append(detailSection(fieldLabels[key], bodyContent(key, value, object, ctx), key));
  }
  for (const note of object.notes ?? []) content.append(renderNote(note, ctx));
}

// The details of a block are its document, so they also say what the block contains.
function appendChildren(content, object, ctx) {
  for (const [type, group] of groupBy(ctx.index.children.get(object.id) ?? [], (child) => child.type)) {
    const list = make('ul', 'child-list');
    for (const child of group) {
      const row = make('li');
      row.append(objectLink(ctx, child.id));
      if (child.summary) row.append(make('span', 'relation-note', inlinePlain(child.summary, ctx)));
      list.append(row);
    }
    const section = detailSection(types[type], list, 'children');
    section.firstChild.append(make('span', 'count', group.length));
    content.append(section);
  }
}

function appendEvidence(content, object, ctx) {
  if (implementationState(object, ctx.evidence)) {
    const body = make('div', 'implementation-detail');
    body.append(codeCheckMark(object, ctx.evidence));
    if (object.implementation?.note) body.append(rich(make('p'), object.implementation.note, ctx));
    if (object.implementation?.evidence?.length) {
      body.append(evidenceRows(ctx, evidenceEntries(ctx, object, object.implementation.evidence, 'implementation')));
    }
    content.append(detailSection(fieldLabels.implementation, body));
  }
  if (object.type === 'acceptance') {
    const verification = object.verification;
    const body = make('div');
    body.append(make('p', 'muted', verificationStates[verification?.status ?? 'unknown']));
    if (verification?.note) body.append(rich(make('p'), verification.note, ctx));
    if (verification?.evidence?.length) {
      body.append(evidenceRows(ctx, evidenceEntries(ctx, object, verification.evidence, 'verification')));
    }
    content.append(detailSection(fieldLabels.verification, body));
  }
  if (object.sources?.length) {
    content.append(detailSection(fieldLabels.sources, evidenceRows(ctx, evidenceEntries(ctx, object, object.sources, 'source'))));
  }
}

function inlinePlain(value, ctx) {
  const flatten = (tokens) => tokens.map((token) => token.children ? flatten(token.children) :
    token.value ?? ctx.index.get(token.target)?.title ?? token.target).join('');
  return flatten(parseInline(value));
}
