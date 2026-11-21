import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { serializeDesign, revision } from '../../scripts/lib/design.mjs';
import { loadDesign } from '../../scripts/lib/validate.mjs';
import { writeBatch } from '../../scripts/lib/io.mjs';
import { workspace, shop, item, cli, skill } from './helpers.mjs';

const update = (id, set) => ({ op: 'update', id, set });
const object = (id, parent = 'shop') => ({
  id, parent, type: 'module', title: id, summary: '', status: 'proposed', origin: 'ai', body: {},
});
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const records = area => existsSync(area.history)
  ? readdirSync(area.history).sort().map(n => read(join(area.history, n))) : [];

test('04 all operations write a single record of actual changes', t => {
  const area = workspace(t);
  area.save();
  const before = shop();
  const original = item(before, 'order');
  writeFileSync(join(area.root, 'code.js'), 'export const code = 1;\n');
  const link = { from: 'service', type: 'depends_on', to: 'pickup' };
  const relation = before.relations[0];
  const ops = [
    { op: 'add', object: object('service') },
    { op: 'add', object: object('transient') },
    update('place-order', { 'body.steps[inspect].failure': '检查失败' }),
    update('order', { 'body.fields[pickupCode].required': false, 'body.fields[+]': { name: 'email', type: 'string' } }),
    update('order', { 'body.fields[email]': null, 'body.ownership': null }),
    { op: 'move', id: 'service', parent: 'checkout' },
    { op: 'link', relation: link },
    { op: 'unlink', relation },
    { op: 'accept', id: 'cart' },
    { op: 'retire', id: 'console' },
    { op: 'decide', id: 'stock-window', chosen: 1, rationale: '门店确认', by: '店主' },
    { op: 'implement', id: 'checkout', status: 'partial', note: '已有一部分', evidence: [{ path: 'code.js' }] },
    { op: 'confirm-evidence', id: 'checkout' },
    { op: 'verify', id: 'stock-acceptance', status: 'passed', evidence: [{ kind: 'file', ref: 'code.js' }] },
    { op: 'remove', id: 'transient' },
  ];
  const result = area.change(ops, {}, ['--by', 'tester']);
  assert.equal(result.applied, ops.length);
  assert.equal(result.base, revision(before));
  const design = loadDesign(area);
  assert.equal(result.rev, revision(design));
  assert.deepEqual(readFileSync(area.design, 'utf8'), serializeDesign(design));
  assert.equal(item(design, 'service').parent, 'checkout');
  assert.equal(item(design, 'place-order').body.steps[0].failure, '检查失败');
  assert.equal(item(design, 'order').body.fields[1].required, false);
  assert.equal(item(design, 'order').body.ownership, undefined);
  assert.equal(item(design, 'cart').status, 'accepted');
  assert.equal(item(design, 'console').status, 'retired');
  assert.equal(item(design, 'stock-window').body.chosen, 1);
  assert.equal(item(design, 'stock-window').body.decidedBy, '店主');
  assert.match(item(design, 'checkout').implementation.evidence[0].hash, /^[a-f0-9]{64}$/);
  assert.equal(item(design, 'stock-acceptance').verification.status, 'passed');
  const [record] = records(area);
  assert.equal(records(area).length, 1);
  assert.equal(record.by, 'tester');
  assert.equal(record.result, result.rev);
  assert.equal(record.base, result.base);
  assert.ok(record.changes.find(change => change.op === 'link' && change.relation.from === 'service'));
  assert.ok(record.changes.find(change => change.op === 'unlink' && change.relation.from === relation.from));
  const changed = record.changes.find(change => change.id === 'order');
  assert.deepEqual(changed.before, original);
  assert.deepEqual(changed.fields, ['body.fields', 'body.ownership']);
  assert.ok(record.changes.every(change => change.id !== 'transient'));
  assert.match(result.history, /history\/\d{8}-\d{6}-\d{3}-[a-f0-9]{12}\.json/);
  assert.equal(area.json(['history', '--show', result.rev]).record.at, record.at);
  area.change([{ op: 'implement', id: 'checkout', status: null }]);
  assert.equal(item(read(area.design), 'checkout').implementation, undefined);
});

test('04 stage validation, invalid paths, dry runs, no-ops and base conflicts preserve bytes', t => {
  const area = workspace(t);
  area.save();
  const before = readFileSync(area.design);
  const edit = update('cart', { summary: '新摘要' });
  assert.equal(area.change([edit, update('cart', { title: null })], { code: 1 }).code, 'VALIDATION_FAILED');
  for (const path of ['id', 'parent', 'implementation', 'verification', 'body.constructor', 'body.fields[missing]']) {
    assert.equal(area.change([edit, update('cart', { [path]: true })], { code: 1 }).code, 'OP_INVALID');
  }
  assert.equal(area.change([edit], { code: 3 }, ['--base', '000000000000']).code, 'BASE_CONFLICT');
  const dry = area.change([edit], {}, ['--dry-run']);
  assert.equal(dry.dryRun, true);
  assert.equal(dry.history, null);
  assert.notEqual(dry.base, dry.rev);
  const noop = area.change([update('cart', { summary: item(shop(), 'cart').summary })]);
  assert.equal(noop.rev, noop.base);
  assert.equal(noop.history, null);
  assert.deepEqual(noop.changed, []);
  assert.deepEqual(readFileSync(area.design), before);
  assert.deepEqual(readdirSync(area.dir).sort(), ['assets', 'design.json']);
});

for (const initial of ['proposed', 'accepted', 'retired']) {
  test('04 decide records the option and handles initial status ' + initial, t => {
    const area = workspace(t);
    const design = shop();
    item(design, 'stock-window').status = initial;
    area.save(design);
    area.change([{ op: 'decide', id: 'stock-window', chosen: 1 }]);

    const resolved = item(loadDesign(area), 'stock-window');
    assert.equal(resolved.body.chosen, 1);
    assert.equal(resolved.status, initial === 'proposed' ? 'accepted' : initial);
    const [record] = records(area);
    const change = record.changes.find(({ id }) => id === 'stock-window');
    assert.equal(change.before.status, initial);
    assert.ok(change.fields.includes('body.chosen'));
    assert.equal(change.fields.includes('status'), initial === 'proposed');
  });
}

test('04 cascade reports every removal and leaves references to be fixed in the same batch', t => {
  const area = workspace(t);
  const design = shop();
  item(design, 'checkout').notes[0].text = '[[staff]] [[staff|值班人]]';
  area.save(design);
  let result = area.change([{ op: 'remove', id: 'staff' }], { code: 1 });
  assert.equal(result.code, 'REMOVE_REFERENCED');
  result = area.change([{ op: 'remove', id: 'staff', cascade: true }], { code: 1 });
  assert.equal(result.errors.filter(row => row.code === 'REFERENCE_NOT_FOUND' && row.id === 'checkout').length, 2);
  assert.ok(result.errors.some(row => row.code === 'STEP_ACTOR_INVALID' && row.id === 'hand-over'
    && row.path.endsWith('/actor')));
  const before = readFileSync(area.design);
  assert.deepEqual(before, Buffer.from(JSON.stringify(design)));
  const fixed = area.change([
    { op: 'remove', id: 'staff', cascade: true },
    update('checkout', { notes: [] }),
    update('hand-over', { 'body.steps[handover].actor': null }),
  ]);
  assert.deepEqual(fixed.removed.objects, ['staff']);
  assert.equal(fixed.removed.relations.length, 1);
  const cascade = area.change([{ op: 'remove', id: 'pickup', cascade: true }]);
  assert.deepEqual(cascade.removed.objects,
    ['console', 'hand-over', 'one-pickup', 'pickup', 'pickup-acceptance', 'pickup-reminder', 'redeem']);
  assert.ok(cascade.removed.relations.some(row => row.to === 'hand-over#handover'));
  assert.equal(cascade.removed.objects.length, records(area).at(-1).changes.filter(row => row.op === 'remove').length);
});

test('05 concurrent change processes serialize without lost updates', async t => {
  const area = workspace(t);
  area.save();
  const ids = ['cart', 'console', 'order', 'pickup', 'checkout', 'staff', 'customer', 'stock-window'];
  await Promise.all(ids.map(id => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'change', '--reason', id, '--ops', '-'], { cwd: area.root });
    let error = '';
    child.stdout.resume();
    child.stderr.setEncoding('utf8').on('data', data => { error += data; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(error)));
    child.stdin.end(JSON.stringify([update(id, { title: '改过 ' + id })]));
  })));
  const design = loadDesign(area);
  for (const id of ids) assert.equal(item(design, id).title, '改过 ' + id);
  const history = records(area);
  assert.equal(history.length, ids.length);
  assert.equal(new Set(history.map(row => row.result)).size, ids.length);
  for (let i = 1; i < history.length; i++) assert.equal(history[i].base, history[i - 1].result);
});

test('05 publish failure restores original bytes and cleans temporary files', t => {
  const area = workspace(t);
  area.save();
  const existing = join(area.dir, 'already-there');
  writeFileSync(existing, 'do not overwrite');
  const prior = readFileSync(area.design);
  assert.throws(() => writeBatch([
    { path: area.design, bytes: 'new' }, { path: existing, bytes: 'new', create: true },
  ]), { code: 'EEXIST' });
  assert.deepEqual(readFileSync(area.design), prior);
  assert.equal(readFileSync(existing, 'utf8'), 'do not overwrite');
  assert.deepEqual(readdirSync(area.dir).sort(), ['already-there', 'assets', 'design.json']);
  writeFileSync(area.history, 'history is not a directory');
  assert.equal(area.change([update('cart', { title: '新' })], { code: 2 }).code, 'IO_ERROR');
  assert.deepEqual(readFileSync(area.design), prior);
});

test('05 clears a dead owner and advances a colliding history stamp', t => {
  const area = workspace(t);
  area.save();
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  assert.equal(dead.status, 0);
  const lock = join(area.dir, '.arkigo.lock');
  mkdirSync(lock);
  writeFileSync(join(lock, dead.stdout + '-dead'), '');
  area.change([update('cart', { title: '新' })]);
  assert.equal(existsSync(lock), false);
  const freeze = join(area.root, 'freeze.cjs');
  writeFileSync(freeze, [
    'const DateBase = Date;',
    "global.Date = class extends DateBase { constructor(...args) { super(...(args.length ? args : [0])); } };",
  ].join('\n'));
  const options = { env: { ...process.env, NODE_OPTIONS: '--require ' + freeze } };
  const edit = title => area.change([update('cart', { title })], options);
  const a = edit('A');
  edit('B');
  const again = edit('A');
  assert.equal(a.rev, again.rev);
  assert.notEqual(a.history, again.history);
  const first = read(join(area.root, a.history)), last = read(join(area.root, again.history));
  assert.equal(Date.parse(last.at) - Date.parse(first.at), 1);
});

test('08 Git evidence distinguishes all states and confirm updates the hash', t => {
  const area = workspace(t);
  const git = (args, input) => {
    const result = spawnSync('git', args, { cwd: area.root, encoding: 'utf8', input });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(['init', '-q', '-b', 'main']);
  git(['fast-import', '--quiet'], [
    'commit refs/heads/main', 'committer Test <test@example.com> 1700000000 +0000', 'data 4', 'base',
    'M 100644 inline service.js', 'data 8', 'original', '',
  ].join('\n'));
  git(['read-tree', 'HEAD']);
  writeFileSync(join(area.root, 'service.js'), 'original');
  writeFileSync(join(area.root, 'record.js'), 'record');
  writeFileSync(join(area.root, 'missing.js'), 'present');
  const baseline = git(['rev-parse', 'HEAD']);
  const design = shop();
  item(design, 'order').implementation = { status: 'partial', note: 'untracked hash',
    evidence: [{ path: 'record.js' }] };
  item(design, 'cart').sources = [{ kind: 'file', ref: 'missing.js' }];
  area.save(design);
  area.change([{ op: 'implement', id: 'checkout', status: 'implemented', evidence: [{ path: 'service.js' }] }]);
  const verify = (args = [], options) => area.json(['verify', ...args], options);
  const healthy = verify([], { inferRoot: true });
  assert.equal(healthy.evidence.find(row => row.id === 'checkout').state, 'ok');
  assert.equal(healthy.evidence.find(row => row.id === 'order').state, 'unrecorded');
  assert.equal(healthy.evidence.find(row => row.id === 'cart').state, 'ok');
  writeFileSync(join(area.root, 'service.js'), 'edited');
  rmSync(join(area.root, 'missing.js'));
  const stale = verify(['--since', baseline], { code: 1 });
  assert.equal(stale.code, 'EVIDENCE_STALE');
  assert.equal(stale.evidence.find(row => row.id === 'checkout').changedSince, true);
  assert.equal(stale.evidence.find(row => row.id === 'checkout').state, 'changed');
  assert.equal(stale.evidence.find(row => row.id === 'cart').state, 'missing');
  assert.equal(area.json(['query', '--implementation', 'stale']).items[0].id, 'checkout');
  area.change([{ op: 'confirm-evidence', id: 'checkout' }]);
  writeFileSync(join(area.root, 'missing.js'), 'restored');
  assert.equal(verify().evidence.find(row => row.id === 'checkout').state, 'ok');
  assert.equal(verify(['--since', 'no-such-rev'], { code: 2 }).code, 'GIT_ERROR');
  const bad = area.change([update('cart', { sources: [{ kind: 'file', ref: '../escape' }] })], { code: 1 });
  assert.equal(bad.errors[0].code, 'EVIDENCE_PATH_INVALID');
});

test('09 init inserts literal rule text, preserves surrounding bytes and refuses overwrite', t => {
  const area = workspace(t);
  const agents = join(area.root, 'AGENTS.md'), claude = join(area.root, 'CLAUDE.md');
  const prefix = Buffer.from([0xef, 0xbb, 0xbf, 0x41, 0x0d, 0x0a]);
  const suffix = Buffer.from('\r\n结束\r\n');
  const fragment = Buffer.from('<!-- arkigo:start -->\n旧内容\n<!-- arkigo:end -->');
  writeFileSync(agents, Buffer.concat([prefix, fragment, suffix]));
  writeFileSync(claude, 'existing\n');
  const result = area.init();
  assert.deepEqual(result.rules, ['AGENTS.md', 'CLAUDE.md']);
  const after = readFileSync(agents);
  assert.ok(after.subarray(0, prefix.length).equals(prefix));
  assert.ok(after.subarray(-suffix.length).equals(suffix));
  assert.equal(after.toString().match(/<!-- arkigo:start -->/g).length, 1);
  assert.match(after.toString(), /docs\/arkigo\/design\.json/);
  assert.match(readFileSync(claude, 'utf8'), /^existing\n\n<!-- arkigo:start -->/);
  const original = readFileSync(area.design);
  assert.equal(area.json(['init'], { code: 2 }).code, 'DESIGN_EXISTS');
  assert.deepEqual(readFileSync(area.design), original);
  const custom = join(area.root, 'custom');
  area.json(['init', '--dir', custom, '--root', area.root]);
  assert.equal(readFileSync(agents, 'utf8').match(/<!-- arkigo:start -->/g).length, 1);
  assert.match(readFileSync(agents, 'utf8'), /custom\/design\.json/);
});

test('09 no-rules skips both rule files', t => {
  const area = workspace(t);
  writeFileSync(join(area.root, 'CLAUDE.md'), 'untouched');
  area.init('--no-rules');
  assert.equal(existsSync(join(area.root, 'AGENTS.md')), false);
  assert.equal(readFileSync(join(area.root, 'CLAUDE.md'), 'utf8'), 'untouched');
});

test('10 decision import applies valid stale choices and returns comments verbatim', t => {
  const area = workspace(t);
  area.save();
  const comment = { op: 'comment', id: 'order', text: '保留批注\n原样', link: 'https://example.test' };
  const data = {
    format: 'arkigo-decisions/1', base: '000000000000', items: [
      { op: 'accept', id: 'cart' }, { op: 'retire', id: 'console', rationale: '不采用' },
      { op: 'decide', id: 'stock-window', chosen: 1, rationale: '已拍板' }, comment,
      { op: 'accept', id: 'gone' }, { op: 'decide', id: 'stock-window', chosen: 5 },
    ],
  };
  area.put('decisions.json', data);
  const args = ['change', '--reason', '页面拍板', '--from-decisions', 'decisions.json'];
  const report = area.json(args);
  assert.equal(report.applied, 3);
  assert.deepEqual(report.decisions.comments, [comment]);
  assert.equal(report.decisions.stale, true);
  assert.deepEqual(report.decisions.skipped.map(row => [row.index, row.code]),
    [[4, 'OBJECT_NOT_FOUND'], [5, 'OP_INVALID']]);
  const design = read(area.design);
  assert.equal(item(design, 'cart').status, 'accepted');
  assert.equal(item(design, 'console').status, 'retired');
  assert.equal(item(design, 'stock-window').body.chosen, 1);
  assert.equal(item(design, 'stock-window').body.rationale, '已拍板');
  data.base = report.rev;
  area.put('decisions.json', data);
  assert.equal(area.json(args, { code: 1 }).code, 'OBJECT_NOT_FOUND');
  assert.equal(records(area).length, 1);
});

test('11 layout rejects malformed values and reset is idempotent', t => {
  const area = workspace(t);
  area.save();
  area.put('layout.json', { format: 'arkigo-layout/2', views: { checkout: { cart: { x: 'x', y: 0 } } } });
  assert.equal(area.json(['layout', 'import', 'layout.json'], { code: 1 }).code, 'VALIDATION_FAILED');
  const layout = join(area.dir, 'layout.json');
  assert.equal(existsSync(layout), false);
  const input = { format: 'arkigo-layout/2',
    views: { checkout: { missing: { x: -4, y: 2.2 }, cart: { x: 1, y: 2 } } } };
  area.put('layout.json', input);
  assert.equal(area.json(['layout', 'import', 'layout.json']).views, 1);
  assert.deepEqual(read(layout), input);
  assert.equal(area.json(['layout', 'reset']).changed, true);
  assert.equal(area.json(['layout', 'reset']).changed, false);
  assert.deepEqual(records(area), []);
});

test('12 arity, duplicate flags, all exit codes and installer behavior', t => {
  const area = workspace(t);
  for (const [args, code] of [
    [['render'], 'DESIGN_NOT_FOUND'], [['query', '--bogus'], 'UNKNOWN_ARGUMENT'],
    [['render', '--editor', 'other'], 'INVALID_ARGUMENT'], [['init', '--editor', 'vscode'], 'UNKNOWN_ARGUMENT'],
    [['render', '--editor', 'cursor', '--editor', 'vscode'], 'DUPLICATE_ARGUMENT'],
    [['query', '--id', 'shop', '--id', 'shop'], 'DUPLICATE_ARGUMENT'],
    [['query', '--field', 'shop'], 'ARGUMENT_REQUIRED'], [['context'], 'ARGUMENT_REQUIRED'],
    [['change', '--ops', '-'], 'ARGUMENT_REQUIRED'], [['query', '--limit', '101'], 'INVALID_ARGUMENT'],
  ]) assert.equal(area.json(args, { code: 2 }).code, code);
  assert.match(area.json(['bogus'], { code: 2 }).message, /\brender\b/);
  const version = area.json(['version']);
  assert.equal(version.version, read(join(skill, 'package.json')).version);
  assert.equal(version.dependencies.ajv, true);
  assert.ok(version.commands.includes('render'));
  const installed = area.json(['install', 'new-skill']);
  assert.equal(installed.destination, join(area.root, 'new-skill'));
  assert.equal(existsSync(join(installed.destination, 'scripts', 'arkigo.mjs')), true);
  assert.deepEqual(readFileSync(join(installed.destination, 'LICENSE')), readFileSync(join(skill, 'LICENSE')));
  assert.equal(existsSync(join(installed.destination, 'node_modules')), false);
  assert.equal(area.json(['install', 'new-skill'], { code: 2 }).code, 'INSTALL_TARGET_EXISTS');
  assert.equal(area.json(['install', join(skill, 'ignored')], { code: 2 }).code, 'INSTALL_TARGET_INVALID');
  const custom = join(area.root, 'codex');
  const result = area.json(['install', '--user'], { env: { ...process.env, CODEX_HOME: custom } });
  assert.equal(result.destination, join(custom, 'skills', 'arkigo'));
  area.init('--no-rules');
  assert.equal(area.json(['check', '--strict'], { code: 1 }).code, 'CHECK_WARNINGS');
  assert.equal(area.change([], { code: 3 }, ['--base', '000000000000']).code, 'BASE_CONFLICT');
});

test('12 render reports all design errors and preserves the published page', t => {
  const area = workspace(t);
  area.init('--no-rules');
  const html = join(area.dir, 'index.html');
  const previous = readFileSync(html);
  const broken = read(area.design);
  broken.objects.push({ id: 'broken', type: 'module', title: 'Broken', summary: '', parent: 'absent',
    status: 'proposed', origin: 'ai', body: {}, notes: [{ type: 'text', text: '[[missing]]' }] });
  area.save(broken);
  const result = area.json(['render'], { code: 1 });
  assert.equal(result.code, 'VALIDATION_FAILED');
  assert.deepEqual(result.errors.map(row => row.code).sort(), ['PARENT_NOT_FOUND', 'REFERENCE_NOT_FOUND']);
  assert.deepEqual(readFileSync(html), previous);
});

test('13 uses only CLI commands to author, query, implement, verify and detect changes', t => {
  const area = workspace(t);
  const design = shop();
  const initial = area.init('--no-rules');
  const ops = [update('shop', { summary: design.objects[0].summary, body: design.objects[0].body }),
    ...design.objects.slice(1).map(object => ({ op: 'add', object })),
    ...design.relations.map(relation => ({ op: 'link', relation }))];
  const authoring = area.change(ops, {}, ['--base', initial.rev]);
  assert.equal(authoring.rev, revision(design));
  assert.equal(Object.values(area.json(['query']).counts).filter(Boolean).length, 10);
  assert.match(area.run(['context', 'checkout']).stdout, /预留库存多久/);
  writeFileSync(join(area.root, 'app.js'), 'export const placeOrder = () => true;\n');
  area.change([
    { op: 'implement', id: 'checkout', status: 'implemented', evidence: [{ path: 'app.js', symbol: 'placeOrder' }] },
    { op: 'verify', id: 'stock-acceptance', status: 'failed', note: '缺货路径待实现' },
  ]);
  assert.equal(area.json(['verify']).evidence[0].state, 'ok');
  assert.equal(area.json(['query', '--field', 'stock-acceptance', '/verification/status']).items[0].value, 'failed');
  writeFileSync(join(area.root, 'app.js'), 'new code\n');
  assert.equal(area.json(['verify'], { code: 1 }).evidence[0].state, 'changed');
  assert.ok(area.json(['check']).warnings.some(row => row.id === 'checkout' && row.code === 'STALE_EVIDENCE'));
});
