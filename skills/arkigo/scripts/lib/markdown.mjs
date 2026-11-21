import { relative, sep } from 'node:path';
import { inline } from './inline.mjs';

const labels = {
  audience: '用户', goals: '目标', scopeIn: '范围内', scopeOut: '范围外', success: '成功标准', assumptions: '假设',
  description: '说明', responsibilities: '职责', boundaries: '边界', inputs: '输入', outputs: '输出', trigger: '触发',
  preconditions: '前置条件', steps: '步骤', transitions: '流转', start: '起点', ends: '终点', when: '当',
  constraint: '约束', exceptions: '例外', rationale: '理由', fields: '字段', states: '状态',
  stateTransitions: '状态流转', ownership: '归属', retention: '保留', kind: '类型', signature: '签名',
  request: '请求', response: '响应', errors: '错误', auth: '权限', route: '路由', purpose: '用途',
  elements: '元素', media: '图片', given: '给定', then: '那么', question: '问题', options: '选项', chosen: '结论',
  decidedBy: '决定者', decidedAt: '决定时间', name: '名称', type: '类型', required: '必填', code: '代码',
  title: '标题', action: '动作', actor: '角色', failure: '失败处理', from: '从', to: '到', id: 'ID',
};

const bt = '\x60';
const escape = value => String(value).replace(/[\\&<>[\]*_~|#`]/g, '\\$&');
const single = value => String(value).replace(/\r?\n/g, ' ↵ ');
function maxTicks(value) {
  let length = 0;
  for (const match of String(value).matchAll(/\x60+/g)) length = Math.max(length, match[0].length);
  return length;
}
const span = value => {
  const delimiter = bt.repeat(maxTicks(value) + 1);
  return delimiter + ' ' + single(value) + ' ' + delimiter;
};

export function prose(value) {
  if (typeof value !== 'string') return value === null ? '未决' : String(value);
  return [...inline(value)].map(part => {
    if (part.kind === 'code') return span(part.text);
    if (part.kind === 'bold') return '**' + escape(part.text) + '**';
    if (part.kind === 'ref') return '[' + escape(part.text) + '](#' + part.ref.replace('#', '--step-') + ')';
    return escape(part.text);
  }).join('');
}

function fence(text, language = '') {
  const delimiter = bt.repeat(Math.max(3, maxTicks(text) + 1));
  return delimiter + language + '\n' + text + '\n' + delimiter;
}

function table(headers, rows) {
  const line = cells => '| ' + cells.map(cell => single(cell).replace(/(?<!\\)\|/g, '\\|')).join(' | ') + ' |';
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

function image(path, caption, folder) {
  const href = folder + '/' + path.replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/');
  return '![' + prose(caption ?? '') + '](' + href + ')' + (caption ? '\n\n' + prose(caption) : '');
}

function noteBlock(note, folder) {
  switch (note.type) {
    case 'text': return prose(note.text);
    case 'list': return note.items.map((item, i) => (note.ordered ? (i + 1) + '. ' : '- ') + prose(item)).join('\n');
    case 'table': return table(note.columns.map(prose), note.rows.map(row => row.map(prose)));
    case 'code': return fence(note.text, /^[\w+-]+$/.test(note.lang ?? '') ? note.lang : '');
    case 'image': return image(note.path, note.caption, folder);
    case 'callout': return '> **' + (note.tone === 'warn' ? '注意' : '说明') + '**\n' +
      prose(note.text).split('\n').map(line => '> ' + line).join('\n');
  }
}

function mermaid(nodes, edges) {
  const encode = value => single(value).replace(/[#"<>&|[\]{}]/g, char => '#' + char.charCodeAt(0) + ';');
  const ids = new Map(nodes.map(([id], i) => [id, 'n' + i]));
  const lines = nodes.map(([id, title]) => '  ' + ids.get(id) + '["' + encode(title) + '"]');
  for (const { from, to, when } of edges) {
    if (!ids.has(from) || !ids.has(to)) continue;
    const label = when ? ' |"' + encode(when) + '"| ' : ' ';
    lines.push('  ' + ids.get(from) + ' -->' + label + ids.get(to));
  }
  return fence(['flowchart TD', ...lines].join('\n'), 'mermaid');
}

function generic(value) {
  if (Array.isArray(value)) {
    return '\n' + value.map((item, i) => {
      if (!item || typeof item !== 'object') return '- ' + prose(item);
      return '- ' + (item.title ? '**' + prose(item.title) + '** ' : '') + Object.entries(item)
        .filter(([key]) => key !== 'title')
        .map(([key, value]) => (labels[key] ?? key) + ' · ' + (Array.isArray(value) ? value.map(prose) : prose(value)))
        .join('，') + (item.title ? '' : (Object.keys(item).length ? '' : String(i + 1)));
    }).join('\n');
  }
  return ' ' + prose(value);
}

export function objectMarkdown(item, { level = 3, folder = 'assets' } = {}) {
  const h = '#'.repeat(Math.min(level, 6));
  const parts = ['<a id="' + item.id + '"></a>\n' + h + ' ' + prose(item.title),
    span(item.id) + ' · ' + item.type + ' · ' + item.status + ' · ' + item.origin];
  if (item.summary) parts.push(prose(item.summary));
  if (item.group !== undefined || item.order !== undefined || item.parent !== null) {
    const fields = { parent: item.parent, group: item.group, order: item.order };
    parts.push(Object.entries(fields).filter(([, value]) => value != null)
      .map(([key, value]) => '**' + key + '** ' + prose(value)).join(' · '));
  }
  const { body } = item;
  if (item.type === 'flow') {
    parts.push(mermaid(body.steps.map(step => [step.id, step.title]), body.transitions ?? []));
  }
  if (item.type === 'entity' && body.states?.length) {
    parts.push(mermaid(body.states.map(state => [state.name, state.name]), body.stateTransitions ?? []));
  }
  const order = item.type === 'system' ? ['goals', 'audience', 'scopeIn', 'scopeOut', 'assumptions', 'success']
    : item.type === 'acceptance' ? ['given', 'when', 'then'] : Object.keys(body);
  for (const key of order) {
    const value = body[key];
    if (value === undefined) continue;
    const label = '**' + (labels[key] ?? key) + '**';
    if (key === 'steps') {
      parts.push(label + '\n\n' + value.map((step, i) => {
        const detail = Object.entries(step).filter(([field]) => !['id', 'title'].includes(field))
          .map(([field, text]) => (labels[field] ?? field) + ' · ' +
            (Array.isArray(text) ? text.map(prose).join('、') : prose(text)));
        return '<a id="' + item.id + '--step-' + step.id + '"></a>\n' + (i + 1) + '. **'
          + prose(step.title) + '** ' + span(step.id) + '\n   ' + detail.join('\n   ');
      }).join('\n\n'));
    } else if (['fields', 'request', 'response', 'errors'].includes(key)) {
      const columns = key === 'errors' ? ['code', 'when'] : ['name', 'type', 'required', 'description'];
      parts.push(label + '\n\n' + table(columns.map(key => labels[key]),
        value.map(row => columns.map(field => row[field] === undefined ? '' : prose(row[field])))));
    } else if (key === 'media') {
      parts.push(label + '\n\n' + value.map(media => image(media.path, media.caption, folder)).join('\n\n'));
    } else parts.push(label + generic(value));
  }
  for (const block of item.notes ?? []) {
    parts.push((block.title ? '**' + prose(block.title) + '**\n\n' : '') + noteBlock(block, folder));
  }
  for (const [key, title] of [['sources', '依据'], ['implementation', '实现情况'], ['verification', '验收结果']]) {
    if (item[key] !== undefined) {
      parts.push('**' + title + '**\n\n' + fence(JSON.stringify(item[key], null, 2), 'json'));
    }
  }
  return parts.filter(Boolean).join('\n\n');
}

export function assetFolder(from, to) {
  return relative(from, to).split(sep).map(encodeURIComponent).join('/') || '.';
}
