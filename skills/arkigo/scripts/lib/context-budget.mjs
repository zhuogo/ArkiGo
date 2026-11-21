import { bytes } from './output.mjs';
import { strings } from './inline.mjs';
import { readPointer } from './errors.mjs';

function largest(value, base) {
  return [...strings(value, base)].sort((a, b) => bytes(b.value) - bytes(a.value));
}

export function escapeArg(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export const fieldCommand = (id, path) => 'arkigo query --field ' + escapeArg(id) + ' ' + escapeArg(path);

export function fitContext(header, parts, target, max, settings) {
  const { renderTarget, sections, id, flags, minimalHeader } = settings;
  const omitted = new Map();
  let countsOnly = false;
  const add = (section, ids) => {
    if (!ids.length) return;
    if (!omitted.has(section)) omitted.set(section, new Set());
    for (const value of ids) omitted.get(section).add(value);
  };
  const list = () => {
    const lines = [];
    for (const [section, ids] of omitted) {
      const [title, fetch] = sections[section];
      lines.push('- ' + title + ' · ' + (countsOnly ? ids.size + ' 项' : [...ids].join('、')) + ' · ' + fetch);
    }
    return lines.join('\n') || '无。';
  };
  const output = () => header + parts.map((rows, i) =>
    '\n\n## ' + sections[i][0] + '\n\n' +
    (i === 0 ? renderTarget(target) : i === 9 ? list() : rows.map(row => row.text).join('\n\n') || '无。')
  ).join('') + '\n';
  const tryFit = () => {
    const full = output();
    if (bytes(full) <= max) return full;
    return null;
  };
  let fit = tryFit();
  if (fit) return fit;
  for (const section of [6, 2, 5]) {
    const dropped = parts[section].filter(row => row.short !== row.text);
    for (const row of dropped) row.text = row.short;
    add(section, dropped.map(row => row.id));
    if ((fit = tryFit())) return fit;
  }
  const notice = path => '此处已截断 · ' + fieldCommand(id, path) + flags;
  for (const [i, note] of (target.notes ?? []).map((note, i) => [i, note])
    .sort((a, b) => bytes(JSON.stringify(b[1])) - bytes(JSON.stringify(a[1])))) {
    const path = '/notes/' + i;
    const text = largest(note, path).find(field => !/(\/type|\/tone|\/path)$/.test(field.path));
    const shorter = {
      type: 'text',
      text: (text ? [...text.value].slice(0, 35).join('') + '… ' : '') + notice(path),
    };
    if (bytes(JSON.stringify(shorter)) >= bytes(JSON.stringify(note))) continue;
    target.notes[i] = shorter;
    add(0, [id]);
    if ((fit = tryFit())) return fit;
  }
  for (const section of [3, 4, 7]) {
    while (parts[section].length) {
      add(section, [parts[section].pop().id]);
      if ((fit = tryFit())) return fit;
    }
  }
  countsOnly = true;
  if ((fit = tryFit())) return fit;
  for (const section of [6, 2, 5, 8, 1]) {
    while (parts[section].length) {
      add(section, [parts[section].pop().id]);
      if ((fit = tryFit())) return fit;
    }
  }
  if (target.notes?.length) {
    delete target.notes;
    add(0, [id]);
  }
  for (const key of ['sources', 'implementation', 'verification']) {
    if (target[key] !== undefined) {
      delete target[key];
      add(0, [id]);
    }
  }
  if ((fit = tryFit())) return fit;
  for (const { path, value } of largest(target.body, '/body')) {
    if (value.length < 32) break;
    const last = path.lastIndexOf('/');
    const parent = readPointer(target, path.slice(0, last));
    const key = path.slice(last + 1).replaceAll('~1', '/').replaceAll('~0', '~');
    parent[key] = [...value].slice(0, 18).join('') + '… ' + notice(path);
    add(0, [id]);
    if ((fit = tryFit())) return fit;
  }
  const final = header + '\n\n## ' + sections[0][0] + '\n\n' + target.summary +
    '\n\n## ' + sections[9][0] + '\n\n' + notice('/body') + '\n';
  if (bytes(final) <= max) return final;
  const concise = header + '\n\n此处已截断\nquery --field ' + id + ' /body\n';
  if (bytes(concise) <= max) return concise;
  return minimalHeader + '\n\n此处已截断\nquery --field ' + id + ' /body\n';
}
