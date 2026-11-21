import { resolve } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { fail } from '../lib/errors.mjs';
import { project, projectPath } from '../lib/paths.mjs';
import { readFormat } from '../lib/validate.mjs';
import { ordered } from '../lib/design.mjs';
import { withLock, writeAtomic } from '../lib/io.mjs';
import { regeneratePage } from '../lib/render-page.mjs';

export const positionals = [1, 2];

export default async function layout(options, [action, file]) {
  if ((action !== 'import' && action !== 'reset') || (action === 'import') !== (file !== undefined)) {
    fail('INVALID_ARGUMENT', 'Expected layout import <file> or layout reset.');
  }
  const locations = project(options);
  const path = projectPath(locations.root, locations.layout);
  return withLock(locations.dir, async () => {
    if (!existsSync(locations.design)) fail('DESIGN_NOT_FOUND', 'No design.json in the selected directory.');
    if (action === 'reset') {
      const changed = existsSync(locations.layout);
      if (changed) unlinkSync(locations.layout);
      return { ok: true, action, path, changed, ...(changed && { page: await regeneratePage(locations) }) };
    }
    const { format, views } = readFormat(resolve(file), 'layout-v2');
    writeAtomic(locations.layout, JSON.stringify({ format, views: ordered(views) }, null, 2) + '\n');
    return { ok: true, action, path, views: Object.keys(views).length, page: await regeneratePage(locations) };
  });
}
