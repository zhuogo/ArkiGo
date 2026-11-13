import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { diffDocuments, diffPage } from '../scripts/diff.mjs';
import { applyCandidate } from '../scripts/apply.mjs';
import { installSkill } from '../scripts/install.mjs';
import { renderCanvas } from '../scripts/render.mjs';

const load = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const canvas = () => load('../../../docs/poc/canvas-engine/registration.canvas.json');
const model = () => load('../../../docs/examples/login.base.json');
const fixture = fn => { const dir = mkdtempSync(join(tmpdir(), 'arkigo-workflow-')); try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };
const save = (dir, name, document) => { const path = join(dir, name); writeFileSync(path, JSON.stringify(document)); return path; };

test('diff separates content, layout, metadata and ignores object-key ordering', () => {
  const base = canvas(), next = structuredClone(base), original = structuredClone(base);
  next.revision += '-2'; next.views[0].nodes[0].x += 5; next.views[0].nodes[1].summary += ' 新要求';
  const report = diffDocuments(base, next);
  assert.deepEqual(report.summary, { content: 1, layout: 1, metadata: 1 });
  assert.deepEqual(base, original);
  assert.deepEqual(diffDocuments(base, Object.fromEntries(Object.entries(base).reverse())).changes, []);
});

test('model diff reports stable object IDs and relation edits without echoing full text', () => {
  const base = model(), next = structuredClone(base);
  next.nodes[1].title = 'Changed'; next.nodes[1].details.extra = 'private prose';
  next.relations.pop();
  const result = diffDocuments(base, next);
  assert.ok(result.changes.some(row => row.id === next.nodes[1].id && row.fields.includes('details')));
  assert.ok(result.changes.some(row => row.kind === 'relation' && row.change === 'removed'));
  assert.equal(JSON.stringify(result).includes('private prose'), false);
  const reordered = Object.fromEntries(Object.entries(base).reverse());
  assert.deepEqual(diffDocuments(base, reordered).changes, []);
});

test('canvas diff detects effective root changes and rejects duplicate identities', () => {
  const base = canvas(), next = structuredClone(base); next.views.reverse();
  delete base.rootViewId; delete next.rootViewId;
  assert.ok(diffDocuments(base, next).changes.some(row => row.fields.includes('effectiveRootViewId')));
  next.views[0].nodes.push(structuredClone(next.views[0].nodes[0]));
  assert.throws(() => diffDocuments(base, next), /重复/);
  next.id += '-other'; assert.throws(() => diffDocuments(base, next), /同一/);
});

test('diff pagination reports every change exactly once within its byte budget', () => {
  const base = model(), next = structuredClone(base);
  for (const node of next.nodes) node.summary += ' changed';
  const report = diffDocuments(base, next), rows = [];
  let offset = 0;
  do {
    const page = diffPage(report, { offset, limit: 3, maxBytes: 1024 });
    assert.ok(Buffer.byteLength(JSON.stringify(page) + '\n') <= 1024);
    rows.push(...page.changes); offset = page.pagination.nextOffset;
  } while (offset !== null);
  assert.deepEqual(rows, report.changes);
});

test('diff remains bounded for escaped and multibyte metadata and field names', () => {
  const giant = '\u0000中文😀'.repeat(2000);
  const report = { schemaVersion: 'arkigo-diff/1', documentId: giant, baseRevision: giant, candidateRevision: giant,
    summary: { content: 1, layout: 0, metadata: 0 }, changes: [{ kind: 'node', viewId: giant, id: giant, change: 'changed', category: 'content', fields: [giant] }] };
  const page = diffPage(report, { maxBytes: 1024 });
  assert.ok(Buffer.byteLength(JSON.stringify(page) + '\n') <= 1024); assert.equal(page.truncated, true);
  assert.equal(page.pagination.returned, 1); assert.equal(page.pagination.nextOffset, null);
});

test('applying a candidate validates, publishes JSON and byte-identical rendered HTML', () => fixture(dir => {
  const base = canvas(), candidate = structuredClone(base); candidate.revision += '-next'; candidate.views[0].nodes[0].summary += ' 修改说明';
  const b = save(dir, 'base.json', base), c = save(dir, 'candidate.json', candidate), target = save(dir, 'canvas.json', base), html = join(dir, 'canvas.html');
  writeFileSync(html, 'old html');
  const result = applyCandidate(b, c, target, html);
  assert.equal(result.ok, true); assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), candidate);
  assert.equal(readFileSync(html, 'utf8'), renderCanvas(candidate));
  assert.deepEqual(JSON.parse(readFileSync(b, 'utf8')), base); assert.deepEqual(JSON.parse(readFileSync(c, 'utf8')), candidate);
}));

test('conflicted, invalid, stale-revision and aliasing updates leave artifacts intact', () => fixture(dir => {
  const base = canvas(), candidate = structuredClone(base); candidate.revision += '-next';
  const b = save(dir, 'base.json', base), c = save(dir, 'candidate.json', candidate), target = save(dir, 'canvas.json', base), html = join(dir, 'canvas.html');
  writeFileSync(html, 'old html');
  const before = readFileSync(target, 'utf8');
  assert.throws(() => applyCandidate(target, c, target, html), /不同/);
  const invalid = structuredClone(candidate); invalid.views[0].nodes[0].targetViewId = 'absent'; save(dir, 'candidate.json', invalid);
  assert.throws(() => applyCandidate(b, c, target, html), /校验/);
  assert.equal(readFileSync(target, 'utf8'), before); assert.equal(readFileSync(html, 'utf8'), 'old html');
  const stale = structuredClone(base); stale.title += ' new'; save(dir, 'candidate.json', stale);
  assert.throws(() => applyCandidate(b, c, target, html), /revision/);
  save(dir, 'candidate.json', candidate); const changed = structuredClone(base); changed.title += ' concurrent'; save(dir, 'canvas.json', changed);
  assert.throws(() => applyCandidate(b, c, target, html), error => error.code === 'BASE_CONFLICT');
  assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), changed); assert.equal(readFileSync(html, 'utf8'), 'old html');
}));

test('staging failure and mismatched layouts do not publish partial data', () => fixture(dir => {
  const base = canvas(), candidate = structuredClone(base); candidate.revision += '-next';
  const b = save(dir, 'base.json', base), c = save(dir, 'candidate.json', candidate), target = save(dir, 'canvas.json', base);
  const blocked = join(dir, 'not-a-folder'); writeFileSync(blocked, 'file');
  assert.throws(() => applyCandidate(b, c, target, join(blocked, 'canvas.html')));
  assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), base);
  const layout = save(dir, 'layout.json', { schemaVersion: 'arkigo-layout/1', documentId: base.id, revision: base.revision, views: [] });
  assert.throws(() => applyCandidate(b, c, target, join(dir, 'canvas.html'), { layoutFile: layout }), /不匹配/);
  assert.equal(existsSync(join(dir, 'canvas.html')), false);
}));

test('runtime installation is self-contained and rejects overwriting existing skills', () => fixture(dir => {
  const destination = join(dir, 'skill');
  assert.equal(installSkill(destination).ok, true);
  for (const name of ['SKILL.md', 'scripts/render.mjs', 'assets/canvas.html', 'schemas/canvas-v1.schema.json', 'references/canvas.md', 'package-lock.json']) assert.equal(existsSync(join(destination, name)), true);
  assert.equal(existsSync(join(destination, 'node_modules')), false); assert.equal(existsSync(join(destination, 'tests')), false);
  const instructions = [join(destination, 'SKILL.md'), ...readdirSync(join(destination, 'references')).map(name => join(destination, 'references', name))];
  for (const file of instructions) for (const match of readFileSync(file, 'utf8').matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    if (/^https?:/.test(match[1]) || match[1].startsWith('#')) continue;
    assert.equal(existsSync(resolve(dirname(file), match[1].split('#')[0])), true, `Unresolved installed reference: ${file} -> ${match[1]}`);
  }
  assert.throws(() => installSkill(destination), /已存在/);
}));

test('installer rejects nested targets including dot-prefix names and junction aliases', () => fixture(dir => {
  const source = join(dir, 'isolated-skill'); installSkill(source);
  const script = join(source, 'scripts', 'install.mjs');
  const direct = spawnSync(process.execPath, [script, join(source, '..nested')], { encoding: 'utf8' });
  assert.equal(direct.status, 2); assert.equal(existsSync(join(source, '..nested')), false);
  const alias = join(dir, 'alias'); symlinkSync(source, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const nested = spawnSync(process.execPath, [script, join(alias, 'references', 'nested-install')], { encoding: 'utf8' });
  assert.equal(nested.status, 2); assert.equal(existsSync(join(source, 'references', 'nested-install')), false);
}));

test('workflow command-line help and invalid arguments produce deterministic exits', () => {
  for (const file of ['diff.mjs', 'apply.mjs', 'install.mjs']) {
    const script = fileURLToPath(new URL('../scripts/' + file, import.meta.url));
    assert.equal(spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' }).status, 0);
    const invalid = spawnSync(process.execPath, [script, '--bogus'], { encoding: 'utf8' });
    assert.equal(invalid.status, 2); assert.equal(JSON.parse(invalid.stderr).ok, false); assert.equal(invalid.stdout, '');
  }
});

test('user installation respects an explicit CODEX_HOME without touching the real profile', () => fixture(dir => {
  const script = fileURLToPath(new URL('../scripts/install.mjs', import.meta.url));
  const codexRoot = join(dir, 'custom home');
  const result = spawnSync(process.execPath, [script, '--user'], { encoding: 'utf8', env: { ...process.env, CODEX_HOME: codexRoot } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).destination, join(codexRoot, 'skills', 'arkigo'));
  assert.equal(existsSync(join(codexRoot, 'skills', 'arkigo', 'SKILL.md')), true);
}));
