import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { serializeDesign } from '../../scripts/lib/design.mjs';

export function generateDesign() {
  const objects = [], relations = [];
  const counts = [1, 40, 79, 120, 260];
  let previous = [];
  for (const [depth, count] of counts.entries()) {
    const level = [];
    for (let index = 0; index < count; index++) {
      const id = depth === 0 ? 'bench' : 'module-' + depth + '-' + String(index).padStart(3, '0');
      const parent = depth === 0 ? null : previous[index % previous.length];
      const body = depth === 0 ? { audience: ['维护人员'], goals: ['查询规模样例'], scopeIn: ['四层能力树'] }
        : { responsibilities: ['下单能力 ' + index], boundaries: ['模块负责本层状态'] };
      level.push(id);
      objects.push({ id, type: depth === 0 ? 'system' : 'module', title: '下单 · ' + id,
        summary: '规模样例中的下单职责和模块边界。', parent, status: 'accepted', origin: 'ai', body });
    }
    previous = level;
  }
  for (let index = 1; index <= 800; index++) {
    const from = index % (objects.length - 1) + 1;
    const to = (from + (index <= 499 ? 1 : 2)) % objects.length;
    relations.push({ from: objects[from].id, to: objects[to].id, type: 'depends_on' });
  }
  return { format: 'arkigo/2', id: 'bench', title: '下单规模基准', objects, relations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = serializeDesign(generateDesign());
  if (process.argv[2]) writeFileSync(process.argv[2], output);
  else process.stdout.write(output);
}
