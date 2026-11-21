import { dirname, resolve, join } from 'node:path';
import { fail } from '../lib/errors.mjs';
import { readModel, scope } from '../lib/read-model.mjs';
import { assetFolder, objectMarkdown, prose } from '../lib/markdown.mjs';
import { assertDistinct, writeAtomic } from '../lib/io.mjs';
import { containedFile, projectPath } from '../lib/paths.mjs';

export const flags = { under: 1, out: 1 };
export const positionals = [1, 1];

const sections = [
  ['flow', '流程'], ['rule', '规则'], ['entity', '数据'], ['interface', '接口'], ['screen', '界面'],
  ['acceptance', '验收'], ['decision', '待定与决策'],
];

function document(design, index, selected, folder) {
  const ordered = [], pending = [[index.system, null, 2]];
  while (pending.length) {
    const [item, owner, depth] = pending.pop();
    if (!selected || selected.has(item.id)) ordered.push({ item, owner, depth });
    const container = item.type === 'module' || item.type === 'system' ? item : owner;
    const nextDepth = item.type === 'module' ? depth + 1 : depth;
    for (const child of [...(index.children.get(item.id) ?? [])].reverse()) pending.push([child, container, nextDepth]);
  }
  const result = ['# ' + prose(design.title)];
  const readOrder = [];
  const push = (item, level) => readOrder.push({ item, content: objectMarkdown(item, { level, folder }) });
  const root = ordered.find(({ item }) => item.type === 'system');
  if (root) {
    readOrder.push({ content: '## 概述' });
    push(root.item, 3);
  }
  const actors = ordered.filter(({ item }) => item.type === 'actor');
  if (actors.length) {
    readOrder.push({ content: '## 角色' });
    for (const { item } of actors) push(item, 3);
  }
  const modules = ordered.filter(({ item }) => item.type === 'module');
  const moduleIds = new Set(modules.map(({ item }) => item.id));
  const group = (container, level) => {
    for (const [type, label] of sections) {
      const rows = ordered.filter(({ item, owner }) => item.type === type
        && (container ? owner?.id === container : !moduleIds.has(owner?.id)));
      if (!rows.length) continue;
      readOrder.push({ content: '#'.repeat(Math.min(level, 6)) + ' ' + label });
      for (const { item } of rows) push(item, level + 1);
    }
  };
  group(null, 2);
  for (const { item, depth } of modules) {
    push(item, depth);
    group(item.id, depth + 1);
  }
  result.push('## 目录\n\n' + readOrder.filter(row => row.item).map(({ item }) =>
    '- [' + prose(item.title) + '](#' + item.id + ')').join('\n'));
  result.push(...readOrder.map(row => row.content));
  const included = new Set(ordered.map(({ item }) => item.id));
  const relations = design.relations.filter(row =>
    included.has(row.from.split('#')[0]) || included.has(row.to.split('#')[0]));
  if (relations.length) result.push('## 关系\n\n' + relations.map(row => '- ' + prose('[[' + row.from + ']]') +
    ' · ' + row.type + ' → ' + prose('[[' + row.to + ']]') + (row.label ? ' · ' + prose(row.label) : '') +
    (row.when ? ' · ' + prose(row.when) : '')).join('\n'));
  return result.join('\n\n') + '\n';
}

export default function exportCommand(options, [mode]) {
  if (mode !== 'md') fail('INVALID_ARGUMENT', 'Expected export md.');
  const { locations, design, index } = readModel(options);
  const selected = scope(index, options.under);
  const out = options.out === undefined ? null : resolve(options.out);
  if (out && options.out === '-') fail('INVALID_ARGUMENT', 'Omit --out to write to stdout.');
  if (out) {
    const path = projectPath(locations.root, out);
    containedFile(locations.root, path);
    const historyPath = projectPath(locations.history, out);
    if (!historyPath.startsWith('../') || /\.json$/i.test(out)) {
      fail('FILE_ALIAS', 'Markdown output cannot overwrite ArkiGo JSON or history.');
    }
    assertDistinct(out, [locations.design, locations.layout, join(locations.dir, 'index.html'),
      join(locations.root, 'AGENTS.md'), join(locations.root, 'CLAUDE.md')]);
  }
  const folder = assetFolder(out ? dirname(out) : locations.root, locations.assets);
  const markdown = document(design, index, selected, folder);
  if (!out) return markdown;
  writeAtomic(out, markdown);
  return { ok: true, path: projectPath(locations.root, out), bytes: Buffer.byteLength(markdown) };
}
