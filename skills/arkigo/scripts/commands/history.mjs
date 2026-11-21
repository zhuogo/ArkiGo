import { project, projectPath } from '../lib/paths.mjs';
import { page } from '../lib/output.mjs';
import { historyFiles, readHistory } from '../lib/history.mjs';
import { fail } from '../lib/errors.mjs';
import { join } from 'node:path';

export const flags = { show: 1 };
export const paging = true;

export default function history(options) {
  const locations = project(options);
  const files = historyFiles(locations.history);
  const read = file => readHistory(locations.history, file);
  if (options.show !== undefined) {
    const found = files.find(file => file === options.show || file.endsWith('-' + options.show + '.json'));
    if (!found) fail('HISTORY_NOT_FOUND', 'Change record not found.', 1);
    const { changes, ...record } = read(found);
    return page({ ok: true, file: projectPath(locations.root, join(locations.history, found)), record },
      'changes', changes, options);
  }
  const rows = files.map(file => {
    const { changes, ...record } = read(file);
    return { file, ...record, changes: changes.length };
  });
  return page({ ok: true }, 'records', rows, options);
}
