import { lstatSync, readFileSync } from 'node:fs';
import { revision } from './design.mjs';
import { CliError } from './errors.mjs';
import { designEvidence } from './evidence.mjs';
import { historyFiles, readHistory } from './history.mjs';
import { writeAtomic } from './io.mjs';
import { projectPath } from './paths.mjs';
import { loadDesign, readFormat } from './validate.mjs';

export const editors = ['vscode', 'cursor'];

function previousEditor(path, root) {
  try {
    if (!lstatSync(path).isFile()) return null;
    const html = readFileSync(path, 'utf8');
    if (!html.startsWith('<!doctype html>') || !html.trimEnd().endsWith('</html>')) return null;
    const block = /^\s*<script type="application\/json" id="arkigo-data">([^<]*)<\/script>\s*$/m.exec(html);
    if (!block) return null;
    const input = JSON.parse(block[1]);
    return input?.projectRoot === root && editors.includes(input.editor) ? input.editor : null;
  } catch {
    return null;
  }
}

function readLayout(path) {
  try { return readFormat(path, 'layout-v2'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}

export async function renderPage(locations, { design = loadDesign(locations), rev = revision(design), editor = null }) {
  const { buildPage } = await import('../page.mjs');
  const designDir = projectPath(locations.root, locations.dir);
  const layout = readLayout(locations.layout);
  const history = historyFiles(locations.history).slice(0, 30).map(file => readHistory(locations.history, file));
  const evidence = Object.create(null);
  const counts = { ok: 0, changed: 0, missing: 0, unrecorded: 0 };
  for (const { id, of, path, state } of designEvidence(design, locations.root)) {
    (evidence[id] ??= []).push({ of, path, state });
    counts[state]++;
  }
  const html = buildPage({
    design, rev, layout, history, evidence, designDir, generatedAt: new Date().toISOString(), editor,
    ...(editor && { projectRoot: locations.root }),
  });
  writeAtomic(locations.page, html);
  const path = projectPath(locations.root, locations.page);
  return { ok: true, rev, path, bytes: Buffer.byteLength(html), evidence: counts };
}

export async function regeneratePage(locations, snapshot = {}) {
  try {
    const editor = previousEditor(locations.page, locations.root);
    const { path } = await renderPage(locations, { ...snapshot, editor });
    return { ok: true, path };
  } catch (error) {
    const message = error instanceof CliError ? error.message
      : 'Unable to generate index.html' + (error.code ? ` (${error.code}).` : '.');
    return { ok: false, error: message + ' Run render to regenerate the page.' };
  }
}
