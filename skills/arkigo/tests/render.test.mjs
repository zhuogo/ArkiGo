import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { renderModel } from '../scripts/render.mjs';

const load = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const dataIn = (html) => JSON.parse(/<script id="arkigo-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);

test('both POC models render with all IDs and diagnostics intact', () => {
  for (const name of ['new-system', 'existing-system']) {
    const model = load(`../../../docs/poc/${name}/model.json`);
    const html = renderModel(model);
    assert.deepEqual(dataIn(html).model, model);
    assert.equal(dataIn(html).report.valid, true);
    assert.equal(dataIn(html).report.warnings.length, 1);
    const scripts = [...html.matchAll(/<script>\s*([\s\S]*?)<\/script>/g)].map(match => match[1]);
    assert.equal(scripts.length, 2); // Theme bootstrap and the self-contained runtime.
    for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script));
    assert.equal(/<script[^>]+src=|<link[^>]+href=|fetch\(/i.test(html), false);
  }
});

test('model strings cannot escape inert data or replace the template', () => {
  const model = load('../../../docs/poc/new-system/model.json');
  const hostile = '</script><script>globalThis.injected=true</script><img src=x onerror=alert(1)> $& $` $\'';
  model.project.title = hostile;
  model.nodes[0].title = hostile;
  const html = renderModel(model);
  assert.equal(dataIn(html).model.project.title, hostile);
  assert.equal(html.includes('<script>globalThis.injected'), false);
  assert.equal((html.match(/<script\b/g) ?? []).length, 3);
});

test('invalid models cannot be presented as validated canvases', () => {
  const model = load('../../../docs/poc/new-system/model.json');
  model.nodes[1].parentId = 'missing';
  assert.throws(() => renderModel(model), (error) => error.report.valid === false);
});
