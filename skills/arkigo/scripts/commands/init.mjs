import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fail } from '../lib/errors.mjs';
import { project, projectPath } from '../lib/paths.mjs';
import { withLock, writeBatch } from '../lib/io.mjs';
import { assertDesign } from '../lib/validate.mjs';
import { revision, serializeDesign } from '../lib/design.mjs';
import { regeneratePage } from '../lib/render-page.mjs';

const start = '<!-- arkigo:start -->';
const end = '<!-- arkigo:end -->';

function rules(dir) {
  return [
    start, '## 项目设计', '',
    '这个项目的设计只有一份，放在 `' + dir + '/design.json`，由 ArkiGo 技能管理。' +
      '需求、模块、流程、规则、数据、接口、界面、验收和还没定的问题都在里面，项目里没有另外的需求文档和设计文档；' +
      '用户通过 `' + dir + '/index.html` 浏览路线图。设计和代码对得上，这份设计才有用，所以每次改代码请按下面的顺序做。',
    '',
    '- 动手之前先读设计。用 arkigo 技能的 `context <对象id>` 取得要改的那部分的材料，' +
      '里面有它的规则、验收、数据、接口和还没定的问题；不知道对象 id 时先用 `query --search <关键词>` 找。',
    '- 要做的事设计里没有，或者和设计不一致时，先用 `change` 把设计改成要做的样子，再写代码。' +
      '用户已经明确要求的改动可以改完设计直接开工；你自己提出的改动保持「提议」状态，告诉用户改了什么，等用户认可。',
    '- 写完代码后回写。用 `change` 记录实现情况和代码位置；实际跑过的验收记录结果，没跑过的不要写成通过。',
    '- 被设计里还没定的问题挡住时，停下来问用户，不要替用户选。',
    '- `design.json` 只通过 arkigo 技能的命令修改，不要直接编辑；也不要另写需求文档和设计文档，' +
      '该写的内容写进设计。',
    end,
  ].join('\n');
}

function updateRules(previous, fragment) {
  const from = previous.indexOf(start);
  const to = previous.indexOf(end);
  if (from === -1 && to === -1) {
    const gap = previous.length ? (previous.at(-1) === 10 ? '\n' : '\n\n') : '';
    return Buffer.concat([previous, Buffer.from(gap + fragment + '\n')]);
  }
  if (from < 0 || to < from || previous.indexOf(start, from + start.length) !== -1
      || previous.indexOf(end, to + end.length) !== -1) fail('INVALID_RULES_MARKERS', 'Invalid ArkiGo rule markers.');
  return Buffer.concat([previous.subarray(0, from), Buffer.from(fragment), previous.subarray(to + end.length)]);
}

export const flags = { id: 1, title: 1, 'no-rules': 0 };

export default async function init(options) {
  const locations = project(options, true);
  const fallback = basename(locations.root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = options.id ?? (fallback.slice(0, 64) || 'project');
  const title = options.title ?? ([...id].slice(0, 80).join(''));
  const design = {
    format: 'arkigo/2', id, title,
    objects: [{ id, type: 'system', title, summary: '', parent: null, status: 'accepted', origin: 'user', body: {} }],
    relations: [],
  };
  assertDesign(design, locations);
  mkdirSync(locations.dir, { recursive: true });
  return withLock(locations.dir, async () => {
    if (existsSync(locations.design)) fail('DESIGN_EXISTS', 'design.json already exists.');
    const entries = [{ path: locations.design, bytes: serializeDesign(design), create: true }];
    const dir = projectPath(locations.root, locations.dir);
    if (!options['no-rules']) {
      for (const name of ['AGENTS.md', 'CLAUDE.md']) {
        const path = join(locations.root, name);
        const exists = existsSync(path);
        if (!exists && name === 'CLAUDE.md') continue;
        const previous = exists ? readFileSync(path) : Buffer.alloc(0);
        const next = updateRules(previous, rules(dir));
        if (!previous.equals(next)) entries.push({ path, bytes: next, create: !exists });
      }
    }
    mkdirSync(locations.assets, { recursive: true });
    mkdirSync(locations.history, { recursive: true });
    writeBatch(entries);
    const rev = revision(design);
    return { ok: true, id, rev, design: projectPath(locations.root, locations.design),
      rules: entries.slice(1).map(entry => projectPath(locations.root, entry.path)),
      page: await regeneratePage(locations, { design, rev }) };
  });
}
