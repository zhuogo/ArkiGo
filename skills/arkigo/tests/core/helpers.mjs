import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const skill = fileURLToPath(new URL('../..', import.meta.url));
export const cli = join(skill, 'scripts', 'arkigo.mjs');
export const fixture = new URL('./fixtures/shop/design.json', import.meta.url);
export const shop = () => JSON.parse(readFileSync(fixture, 'utf8'));
export const item = (design, id) => design.objects.find(object => object.id === id);

export function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'arkigo-core-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'docs', 'arkigo');
  const design = join(dir, 'design.json');
  const history = join(dir, 'history');
  const assets = join(dir, 'assets');
  const put = (name, value) => writeFileSync(join(root, name), JSON.stringify(value));
  const run = (args, { input, code = 0, cwd = root, env, inferRoot = false } = {}) => {
    const flags = inferRoot || args.includes('--root') ? args : [...args, '--root', root];
    const result = spawnSync(process.execPath, [cli, ...flags], { cwd, input, encoding: 'utf8', env });
    assert.equal(result.status, code, result.stderr || result.stdout || String(result.error));
    return result;
  };
  const json = (args, options) => {
    const result = run(args, options);
    return JSON.parse(options?.code ? result.stderr : result.stdout);
  };
  const init = (...args) => json(['init', '--id', 'shop', '--title', '邻里下单', ...args]);
  const change = (ops, options = {}, args = []) => json(['change', '--reason', '测试', '--ops', '-', ...args],
    { input: JSON.stringify(ops), ...options });
  const save = (doc = shop()) => {
    mkdirSync(assets, { recursive: true });
    writeFileSync(design, JSON.stringify(doc));
  };
  return { root, dir, design, history, assets, put, run, json, init, change, save };
}
