import { ownerId, summary, descendants, ancestry, openDecision } from '../lib/design.mjs';
import { evidenceFor } from '../lib/evidence.mjs';
import { getObject, readModel } from '../lib/read-model.mjs';
import { projectPath } from '../lib/paths.mjs';
import { assetFolder, objectMarkdown, prose } from '../lib/markdown.mjs';
import { escapeArg, fieldCommand, fitContext } from '../lib/context-budget.mjs';

export const positionals = [1, 1];
export const budget = 24000;

const brief = item => '- **' + prose(item.title) + '** (`' + item.id + '`)';
const summarized = item => brief(item) + (item.summary ? ' · ' + prose(item.summary) : '');

export default function context(options, [id]) {
  const { locations, design, index, rev } = readModel(options);
  const item = getObject(index, id);
  const dir = projectPath(locations.root, locations.dir);
  const folder = assetFolder(locations.root, locations.assets);
  const target = descendants(index, id);
  const prelude = title => [
    '# 开工材料：' + title, '',
    '这是设计里「' + title + '」（`' + id + '`）及其相关内容，取自设计版本 `' + rev + '`。' +
      '实现时以其中的规则和验收为准；标为未决的问题由用户决定，不要自行选择；这里没有列出的内容见末尾的省略清单。' +
      '写完代码后用 `change` 回写实现情况和验收结果。',
  ].join('\n');
  const query = 'arkigo query --id ' + id;
  const sections = [
    ['目标对象', fieldCommand(id, '')], ['树中位置、项目目标与范围', 'arkigo query --id ' + index.system.id],
    ['直接下级', 'arkigo query --under ' + id], ['相关规则', 'arkigo query --type rule'],
    ['相关验收', 'arkigo query --type acceptance'], ['数据与接口', query], ['双向依赖', query],
    ['未决问题', 'arkigo query --type decision'], ['实现情况与依据', query], ['省略清单', query],
  ];
  const row = (item, text, short = text) => ({ id: item.id, text, short });
  const full = item => objectMarkdown(item, { folder });
  const parts = Array.from({ length: sections.length }, () => []);
  parts[1].push(row(item, ancestry(index, id).map(node => prose(node.title) + ' (`' + node.id + '`)').join(' → ')));
  const overview = {};
  for (const key of ['goals', 'scopeIn', 'scopeOut']) {
    if (index.system.body[key]) overview[key] = index.system.body[key];
  }
  if (Object.keys(overview).length) {
    const { notes, ...system } = index.system;
    parts[1].push(row(system, full({ ...system, body: overview })));
  }
  parts[2] = (index.children.get(id) ?? []).map(child => row(child, summarized(child), brief(child)));
  const seen = new Set();
  const add = (section, endpoint) => {
    const other = index.objects.get(ownerId(endpoint));
    const key = section + ':' + other.id;
    if (seen.has(key)) return;
    seen.add(key);
    const text = section === 6 ? summarized(other) : full(other);
    parts[section].push(row(other, text, section === 6 ? brief(other) : section === 5 ? summarized(other) : text));
  };
  for (const relation of design.relations) {
    const { from, to, type } = relation;
    const a = ownerId(from), b = ownerId(to);
    if (type === 'governed_by' && target.has(a)) add(3, to);
    if (type === 'verifies' && target.has(b)) add(4, from);
    if (['reads', 'writes', 'calls'].includes(type) && a === id) {
      if (['entity', 'interface'].includes(index.objects.get(b).type)) add(5, to);
    }
    if (type === 'calls' && b === id && item.type === 'interface') add(5, to);
    if (type === 'depends_on' && a === id && b !== id) add(6, to);
    if (type === 'depends_on' && b === id && a !== id) add(6, from);
    if (type === 'blocks' && b === id && openDecision(index.objects.get(a))) add(7, from);
  }
  for (const child of index.children.get(id) ?? []) if (child.type === 'interface') add(5, child.id);
  const relevant = new Set([id, ...parts.flat().map(row => row.id)]);
  const cache = new Map();
  for (const id of relevant) {
    const target = index.objects.get(id);
    const evidence = evidenceFor(target, locations.root, cache);
    if (!target.implementation && !evidence.length && id !== item.id) continue;
    const state = target.implementation?.status ?? '未核对';
    const lines = [brief(target) + ' · ' + state];
    if (target.implementation?.note) lines.push('  - ' + prose(target.implementation.note));
    for (const entry of evidence) {
      const status = { missing: '缺失，需复查', changed: '内容已变，需复查', unrecorded: '未记录哈希', ok: '正常' };
      lines.push('  - ' + prose(entry.path) + (entry.symbol ? ' · ' + prose(entry.symbol) : '') + ' · ' +
        status[entry.state]);
    }
    parts[8].push(row(target, lines.join('\n')));
  }
  const flags = dir === 'docs/arkigo' ? '' : ' --dir ' + escapeArg(dir);
  for (const section of sections) section[1] += flags;
  return fitContext(prelude(item.title), parts, structuredClone(item), options['max-bytes'] ?? budget, {
    id, sections, renderTarget: full, flags, minimalHeader: prelude([...item.title].slice(0, 35).join('') + '…'),
  });
}
