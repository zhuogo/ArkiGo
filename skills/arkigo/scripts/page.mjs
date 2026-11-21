import { readFileSync } from 'node:fs';

const readings = ['map', 'flow', 'inventory'];
const scripts = [
  'model.mjs', 'layout.mjs', 'routing.mjs', 'inline.mjs', 'search.mjs',
  'inventory.mjs',
  'icons.js', 'dom.js', 'details.js', 'directory.js', 'graph.js', 'camera.js',
  ...readings.map((name) => 'readings/' + name + '.js'),
  'app.js'
];
const asset = (name) => readFileSync(new URL('../assets/' + name, import.meta.url), 'utf8');

export function buildPage({ design, rev, layout, evidence, generatedAt, editor, projectRoot }) {
  const runtime = scripts.map((name) => asset(name).replace(/^import [^\n]+\n|^export /gm, '')).join('\n\n');
  const markup = {
    STYLE: asset('page.css') + '\n' + asset('readings.css'), DATA: inertJson({ design, rev, layout, evidence, generatedAt, editor, projectRoot }), SCRIPT: runtime
  };
  return asset('page.html').replace(/<!--(STYLE|DATA|SCRIPT)-->/g, (_, name) => markup[name]);
}

function inertJson(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}
