import { fail } from '../lib/errors.mjs';
import { withLock } from '../lib/io.mjs';
import { project } from '../lib/paths.mjs';
import { editors, renderPage } from '../lib/render-page.mjs';

export const flags = { editor: 1 };

export default function render(options) {
  const editor = options.editor ?? null;
  if (editor !== null && !editors.includes(editor)) {
    fail('INVALID_ARGUMENT', 'Usage: render [--editor <vscode|cursor>]');
  }
  const locations = project(options);
  return withLock(locations.dir, () => renderPage(locations, { editor }));
}
