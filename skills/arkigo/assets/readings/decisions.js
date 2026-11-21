function drawDecisionCount() {
  const tab = byId('readings').querySelector('[data-mode="decisions"]');
  if (!tab) return;
  let badge = tab.querySelector('.reading-badge');
  if (!badge) tab.append(badge = make('span', 'reading-badge'));
  const pending = pendingDecisions(index);
  const count = pending.filter((object) => !decisions.some(({ item }) =>
    item.id === object.id && item.op !== 'comment')).length;
  badge.textContent = count;
  tab.setAttribute('aria-label', '待拍板，' + count + ' 项待决定');
}

function decisionSave(ctx, item) {
  const saved = ctx.setDecisions(queueDecision(ctx.decisions, item, ctx.rev));
  announce(saved ? '已记录' : '浏览器无法保存，请导出后再关闭页面。');
}

function editDecision(ctx, object, op) {
  const existing = ctx.decisions.find(({ item }) => item.id === object.id && item.op === op)?.item;
  const form = make('form', 'decision-form');
  let choice;
  if (op === 'decide') {
    const field = make('label', 'reading-field');
    choice = make('select');
    choice.setAttribute('aria-label', '选项');
    choice.required = true;
    const placeholder = make('option', '', '选择一项');
    placeholder.value = '';
    choice.append(placeholder);
    for (const [i, item] of (object.body.options ?? []).entries()) {
      const option = make('option', '', item.title);
      option.value = i;
      choice.append(option);
    }
    choice.value = existing?.chosen ?? '';
    field.append(make('span', '', '选项'), choice);
    form.append(make('p', '', object.body.question), field);
  }
  const notes = make('label', 'reading-field');
  const text = make('textarea');
  text.rows = 4;
  text.value = existing?.text ?? existing?.rationale ?? '';
  text.required = op === 'comment';
  notes.append(make('span', '', op === 'comment' ? '批注' : '理由（可选）'), text);
  const submit = make('button', 'tool primary', '保存' + decisionVerbs[op]);
  submit.type = 'submit';
  form.append(notes, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (op === 'comment' && !text.value.trim()) {
      text.focus();
      return;
    }
    const item = { op, id: object.id };
    if (op === 'decide') item.chosen = Number(choice.value);
    if (op === 'comment') item.text = text.value;
    else if (text.value.trim()) item.rationale = text.value;
    ctx.directory.close();
    decisionSave(ctx, item);
    if (ctx.mode === 'decisions') focusDecision(object.id);
  });
  ctx.directory.open('decision-form', decisionVerbs[op] + ' · ' + object.title, form, choice ?? text);
}

function focusDecision(id) {
  const target = id && byId('view-content').querySelector('.decision-row[data-id="' + id + '"] button');
  (target ?? byId('view-content').querySelector('button') ?? byId('viewport')).focus();
}

async function copyDecisions(ctx) {
  const value = decisionPrompt(ctx.index, ctx.decisions, ctx.rev, ctx.designDir);
  try {
    await navigator.clipboard.writeText(value);
    announce('已复制给 AI');
    const feedback = byId('decision-feedback');
    if (feedback) feedback.textContent = '已复制';
  } catch {
    const field = make('label', 'reading-field');
    const text = make('textarea', 'decision-copy');
    text.readOnly = true;
    text.value = value;
    text.rows = 14;
    field.append(make('span', '', '剪贴板不可用，可全选并手动复制。'), text);
    ctx.directory.open('decision-copy', '复制给 AI', field, text);
    text.select();
  }
}

function pendingRow(ctx, object) {
  const row = make('li', 'decision-row');
  row.dataset.id = object.id;
  const head = make('div', 'decision-object');
  const title = inspectButton(ctx, object);
  title.prepend(typeMark(object.type));
  head.append(title, make('p', 'muted', object.body.question ?? object.summary));
  const queued = ctx.decisions.find(({ item }) => item.id === object.id && item.op !== 'comment');
  if (queued) head.append(make('p', 'decision-recorded', '已记录 · ' + decisionVerbs[queued.item.op]));
  if (object.type === 'decision' && object.body.chosen != null) {
    const { chosen, options, rationale } = object.body;
    head.append(make('p', 'decision-conclusion', fieldLabels.chosen + '：' + options[chosen].title));
    if (rationale) head.append(make('p', 'muted decision-rationale', fieldLabels.rationale + '：' + rationale));
  }
  const actions = make('div', 'reading-actions');
  for (const op of decisionActions(object)) {
    if (op === 'accept') {
      actions.append(button('接受', () => {
        decisionSave(ctx, { op, id: object.id });
        focusDecision(object.id);
      }));
    } else {
      const label = { decide: '选择选项', retire: '否决', comment: '写批注' }[op];
      actions.append(button(label, () => editDecision(ctx, object, op), op === 'decide' ? 'tool primary' : 'tool'));
    }
  }
  row.append(head, actions);
  return row;
}

registerRead('decisions', {
  label: '待拍板', icon: 'decision', article: true, entry: true,
  render(ctx) {
    const page = articleReading(ctx, '项目拍板', 'decisions-page');
    const queue = make('section', 'decision-queue');
    const count = ctx.decisions.length;
    queue.append(make('h2', '', '待交回的决定 · ' + count));
    if (count) {
      const actions = make('div', 'reading-actions');
      const feedback = make('output', 'muted');
      feedback.id = 'decision-feedback';
      feedback.setAttribute('aria-live', 'polite');
      actions.append(button('复制给 AI', () => copyDecisions(ctx), 'tool primary'),
        button('导出决定', () => downloadJson(decisionFile(ctx.decisions, ctx.rev), 'decisions.json')),
        button('清空已做的决定', () => {
          if (window.confirm('清空本项目尚保存在浏览器中的决定和批注？')) {
            ctx.setDecisions([]);
            focusDecision();
          }
        }), feedback);
      queue.append(actions);
      const list = make('ol', 'decision-list');
      for (const [i, { item, rev }] of ctx.decisions.entries()) {
        const row = make('li', 'decision-item');
        const text = make('div');
        text.append(make('p', '', decisionLine(ctx.index, item)), make('code', 'muted', rev));
        const undo = button('撤销', () => { ctx.setDecisions(undoDecision(ctx.decisions, i)); focusDecision(item.id); });
        undo.setAttribute('aria-label', '撤销第 ' + (i + 1) + ' 条');
        row.append(text, undo);
        list.append(row);
      }
      queue.append(list);
    }
    const items = pendingDecisions(ctx.index);
    if (count) page.append(queue);
    if (!items.length) {
      page.append(readingEmpty('暂无待决定事项，可在对象详情中写批注。'));
      return;
    }
    const list = make('ul', 'decision-list');
    for (const object of items) list.append(pendingRow(ctx, object));
    page.append(make('h2', '', '待决定事项 · ' + items.length), list);
  }
});
