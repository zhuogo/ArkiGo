import { readFileSync } from 'node:fs';

const readings = ['map', 'flow', 'inventory', 'progress', 'changes', 'decisions'];
const scripts = [
  'model.mjs', 'layout.mjs', 'routing.mjs', 'inline.mjs', 'search.mjs',
  'inventory.mjs', 'progress.mjs', 'change-history.mjs', 'decisions.mjs',
  'icons.js', 'dom.js', 'details.js', 'directory.js', 'graph.js', 'camera.js',
  ...readings.map((name) => 'readings/' + name + '.js'),
  'app.js'
];
const asset = (name) => readFileSync(new URL('../assets/' + name, import.meta.url), 'utf8');

export function buildPage(input) {
  const history = [];
  let bytes = 2;
  for (const entry of (input.history ?? []).slice(0, 30)) {
    bytes += Buffer.byteLength(inertJson(entry)) + Number(history.length > 0);
    if (bytes > 512 * 1024) break;
    history.push(entry);
  }
  const runtime = scripts.map((name) => asset(name).replace(/^import [^\n]+\n|^export /gm, '')).join('\n\n');
  const markup = {
    STYLE: asset('page.css') + '\n' + asset('readings.css'), DATA: inertJson({ ...input, history }), SCRIPT: runtime
  };
  return asset('page.html').replace(/<!--(STYLE|DATA|SCRIPT)-->/g, (_, name) => markup[name]);
}

function inertJson(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}
