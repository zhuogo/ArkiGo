import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { validateFile, validateModel } from '../scripts/validate.mjs';

const examples = new URL('../../../docs/examples/', import.meta.url);
const fixtures = new URL('./fixtures/', import.meta.url);
const cli = fileURLToPath(new URL('../scripts/validate.mjs', import.meta.url));
const load = (name) => JSON.parse(readFileSync(new URL(name, examples), 'utf8'));
const base = () => load('login.base.json');
const candidate = () => load('login.candidate.json');
const node = (model, id) => model.nodes.find((item) => item.id === id);
const relation = (model, id) => model.relations.find((item) => item.id === id);
const hasError = (report, code, path) => {
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => error.code === code && (path === undefined || error.path === path)), JSON.stringify(report));
};

test('both original login models pass without changing the model', () => {
  for (const name of ['login.base.json', 'login.candidate.json']) {
    const model = load(name);
    const before = JSON.stringify(model);
    assert.equal(validateModel(model).valid, true);
    assert.equal(JSON.stringify(model), before);
  }
  assert.deepEqual(validateModel(base()).warnings, []);
  assert.deepEqual(validateModel(candidate()).warnings.map(({ code, objectId }) => [code, objectId]), [
    ['QUESTION_UNRESOLVED', 'q-limit-key'],
    ['QUESTION_UNRESOLVED', 'q-limit-store'],
  ]);
});

const invalidExamples = [
  ['duplicate-id.json', 'DUPLICATE_ID', 'step-end', '/nodes/4/id'],
  ['dangling-reference.json', 'REFERENCE_MISSING', 'rel-main', '/relations/0/to'],
  ['parent-cycle.json', 'PARENT_CYCLE', 'flow-main', '/nodes/1/parentId'],
  ['multiple-roots.json', 'ROOT_COUNT', null, '/nodes'],
  ['foreign-start.json', 'FLOW_STEP_MEMBERSHIP', 'flow-main', '/nodes/1/details/startStepId'],
  ['foreign-terminal.json', 'FLOW_STEP_MEMBERSHIP', 'flow-main', '/nodes/1/details/terminalStepIds/0'],
  ['unreachable-step.json', 'STEP_UNREACHABLE', 'step-orphan', '/nodes/4/id'],
];
for (const [name, code, objectId, path] of invalidExamples) {
  test(`failure fixture: ${name}`, () => {
    const report = validateFile(new URL(name, fixtures));
    hasError(report, code, path);
    assert.ok(report.errors.some((error) => error.code === code && error.objectId === objectId));
  });
}

for (const [name, change, path] of [
  ['unsupported schema version', (m) => { m.schemaVersion = '1.0'; }, '/schemaVersion'],
  ['missing project', (m) => { delete m.project; }, '/project'],
  ['unknown node kind', (m) => { m.nodes[0].kind = 'screen'; }, '/nodes/0/kind'],
  ['empty title', (m) => { m.nodes[0].title = '  '; }, '/nodes/0/title'],
  ['invalid status', (m) => { m.nodes[0].designStatus = 'verified'; }, '/nodes/0/designStatus'],
  ['missing source', (m) => { delete m.nodes[0].provenance; }, '/nodes/0/provenance'],
  ['invalid source', (m) => { m.nodes[0].provenance.origin = 'guessed'; }, '/nodes/0/provenance/origin'],
  ['missing source references', (m) => { m.nodes[0].provenance.references = []; }, '/nodes/0/provenance/references'],
  ['unknown common field', (m) => { m.nodes[0]['bad/field~'] = true; }, '/nodes/0/bad~1field~0'],
  ['missing action', (m) => { delete m.nodes[3].details.action; }, '/nodes/3/details/action'],
  ['invalid flow boundaries', (m) => { m.nodes[2].details.terminalStepIds = []; }, '/nodes/2/details/terminalStepIds'],
  ['duplicate terminals', (m) => { m.nodes[2].details.terminalStepIds.push('step-success'); }, '/nodes/2/details/terminalStepIds'],
  ['wrong given type', (m) => { m.nodes[8].details.given = 'text'; }, '/nodes/8/details/given'],
  ['empty expectation', (m) => { m.nodes[8].details.then = []; }, '/nodes/8/details/then'],
]) {
  test(`schema: ${name}`, () => {
    const model = base();
    change(model);
    hasError(validateModel(model), 'SCHEMA_INVALID', path);
  });
}

test('malformed roots return schema errors instead of throwing', () => {
  for (const input of [null, [], true, 42, 'text', {}, { nodes: [null] }]) {
    hasError(validateModel(input), 'SCHEMA_INVALID');
  }
});

test('additional semantic detail is allowed; relation provenance is optional', () => {
  const model = base();
  model.nodes[0].details.contract = { note: 'Future detail, not a checked interface contract.' };
  delete model.relations[0].provenance;
  assert.equal(validateModel(model).valid, true);
});

for (const [name, change, code, path] of [
  ['duplicate relation ID', (m) => { m.relations[1].id = m.relations[0].id; }, 'DUPLICATE_ID', '/relations/1/id'],
  ['shared node and relation ID', (m) => { m.relations[0].id = m.nodes[0].id; }, 'DUPLICATE_ID', '/relations/0/id'],
  ['missing parent', (m) => { m.nodes[1].parentId = 'absent'; }, 'REFERENCE_MISSING', '/nodes/1/parentId'],
  ['self parent', (m) => { m.nodes[1].parentId = m.nodes[1].id; }, 'PARENT_CYCLE', '/nodes/1/parentId'],
  ['zero roots', (m) => { m.nodes[0].parentId = m.nodes[1].id; }, 'ROOT_COUNT', '/nodes'],
  ['non-system root', (m) => { m.nodes[1].parentId = null; }, 'SYSTEM_ROOT', '/nodes/1/parentId'],
  ['non-root system', (m) => { m.nodes.push({ ...structuredClone(m.nodes[0]), id: 'sys-second', parentId: m.nodes[0].id }); }, 'SYSTEM_ROOT', '/nodes/10/parentId'],
  ['missing start', (m) => { m.nodes[2].details.startStepId = 'absent'; }, 'REFERENCE_MISSING', '/nodes/2/details/startStepId'],
  ['start is a rule', (m) => { m.nodes[2].details.startStepId = 'rule-credential'; }, 'FLOW_STEP_MEMBERSHIP', '/nodes/2/details/startStepId'],
  ['step outside flow', (m) => { m.nodes[3].parentId = 'mod-user'; }, 'STEP_WITHOUT_FLOW', '/nodes/3/parentId'],
  ['missing relation source', (m) => { m.relations[0].from = 'absent'; }, 'REFERENCE_MISSING', '/relations/0/from'],
  ['next points to rule', (m) => { m.relations[0].to = 'rule-credential'; }, 'RELATION_ENDPOINT_KIND', '/relations/0/to'],
  ['governed_by from module', (m) => { m.relations[4].from = 'mod-user'; }, 'RELATION_ENDPOINT_KIND', '/relations/4/from'],
  ['governed_by points to step', (m) => { m.relations[4].to = 'step-success'; }, 'RELATION_ENDPOINT_KIND', '/relations/4/to'],
  ['verifies from rule', (m) => { m.relations[5].from = 'rule-credential'; }, 'RELATION_ENDPOINT_KIND', '/relations/5/from'],
  ['verifies points to system', (m) => { m.relations[5].to = 'sys-demo'; }, 'RELATION_ENDPOINT_KIND', '/relations/5/to'],
  ['missing branch condition', (m) => { delete m.relations[1].condition; }, 'BRANCH_CONDITION_MISSING', '/relations/1/condition'],
  ['missing failure handling', (m) => { delete m.nodes[4].details.failureHandling; }, 'FAILURE_HANDLING_MISSING', '/nodes/4/details/failureHandling'],
  ['terminal has outgoing edge', (m) => { m.relations.push({ id: 'rel-after-end', kind: 'next', from: 'step-success', to: 'step-failure' }); }, 'TERMINAL_HAS_NEXT', '/nodes/5/id'],
]) {
  test(`graph: ${name}`, () => {
    const model = base();
    change(model);
    hasError(validateModel(model), code, path);
  });
}

test('cross-flow transitions cannot make another flow reachable', () => {
  const model = JSON.parse(readFileSync(new URL('foreign-start.json', fixtures), 'utf8'));
  node(model, 'flow-main').details.startStepId = 'step-start';
  model.relations[0].to = 'step-other';
  hasError(validateModel(model), 'NEXT_CROSS_FLOW', '/relations/0/to');
});

test('nested steps belong to their nearest flow ancestor', () => {
  const model = base();
  node(model, 'step-success').parentId = 'step-credential';
  assert.equal(validateModel(model).valid, true);
});

test('a retry loop with an exit is valid; a trapped loop is not', () => {
  const model = base();
  model.relations.push({ id: 'rel-retry', kind: 'next', from: 'step-credential', to: 'step-receive', condition: '重试' });
  assert.equal(validateModel(model).valid, true);
  for (const edge of model.relations.filter((r) => r.kind === 'next' && r.from === 'step-credential')) edge.to = 'step-receive';
  hasError(validateModel(model), 'NO_TERMINAL_PATH', '/nodes/3/id');
});

test('failure handling may be explicitly deferred to a linked question', () => {
  const model = candidate();
  delete node(model, 'step-limit').details.failureHandling;
  relation(model, 'rel-question-store').to = 'step-limit';
  assert.equal(validateModel(model).valid, true);
  relation(model, 'rel-question-store').to = 'flow-login';
  assert.equal(validateModel(model).valid, true);
  node(model, 'q-limit-store').designStatus = 'retired';
  hasError(validateModel(model), 'FAILURE_HANDLING_MISSING');
});

test('questions relations must originate at questions', () => {
  const model = candidate();
  relation(model, 'rel-question-key').from = 'rule-limit';
  hasError(validateModel(model), 'RELATION_ENDPOINT_KIND');
});

test('only direct, non-retired acceptance links count as rule coverage', () => {
  const model = base();
  for (const edge of model.relations.filter((r) => r.kind === 'verifies')) edge.to = 'flow-login';
  const report = validateModel(model);
  assert.equal(report.valid, true);
  assert.deepEqual(report.warnings.map((w) => w.code), ['RULE_WITHOUT_ACCEPTANCE']);
  relation(model, 'rel-verify-success').to = 'rule-credential';
  node(model, 'acc-success').designStatus = 'retired';
  assert.equal(validateModel(model).warnings[0].code, 'RULE_WITHOUT_ACCEPTANCE');
  node(model, 'rule-credential').designStatus = 'retired';
  assert.deepEqual(validateModel(model).warnings, []);
});

test('accepting a question does not answer it; retiring it removes the warning', () => {
  const model = candidate();
  node(model, 'q-limit-key').designStatus = 'accepted';
  assert.equal(validateModel(model).warnings.length, 2);
  node(model, 'q-limit-key').designStatus = 'retired';
  assert.deepEqual(validateModel(model).warnings.map((w) => w.objectId), ['q-limit-store']);
});

test('deep parent chains do not overflow, and valid dependencies may form cycles', () => {
  const model = base();
  let parent = 'sys-demo';
  for (let index = 0; index < 12000; index++) {
    const id = `deep-${index}`;
    model.nodes.push({ ...model.nodes[1], id, parentId: parent });
    parent = id;
  }
  node(model, 'mod-user').parentId = parent;
  model.relations.push(
    { id: 'dep-a', kind: 'depends_on', from: 'step-success', to: 'step-failure' },
    { id: 'dep-b', kind: 'depends_on', from: 'step-failure', to: 'step-success' },
  );
  assert.equal(validateModel(model).valid, true);
});

test('CLI: outputs JSON, uses correct exit codes, reads UTF-8 BOM, and writes no files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'arkigo-test-'));
  const file = join(directory, 'design with spaces.json');
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: directory, encoding: 'utf8' });
  try {
    const content = '\uFEFF' + JSON.stringify(candidate());
    writeFileSync(file, content);
    const valid = run(file, '--json');
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(valid.stdout).warnings.length, 2);
    assert.equal(valid.stderr, '');
    assert.equal(readFileSync(file, 'utf8'), content);
    assert.deepEqual(readdirSync(directory), ['design with spaces.json']);
    assert.match(run(file).stdout, /PASS.*0 个错误，2 个提示/);
    const invalid = run(fileURLToPath(new URL('duplicate-id.json', fixtures)), '--json');
    assert.equal(invalid.status, 1);
    assert.equal(JSON.parse(invalid.stdout).errors[0].code, 'DUPLICATE_ID');
    const missing = run(join(directory, 'missing.json'), '--json');
    assert.equal(missing.status, 2);
    assert.equal(JSON.parse(missing.stdout).errors[0].code, 'FILE_READ_ERROR');
    writeFileSync(file, '{broken');
    const malformed = run(file, '--json');
    assert.equal(malformed.status, 2);
    assert.equal(JSON.parse(malformed.stdout).errors[0].code, 'JSON_PARSE_ERROR');
    for (const args of [[], ['--unknown'], [file, file], [file, '--json', '--json']]) {
      const badUsage = run(...args);
      assert.equal(badUsage.status, 2);
      assert.match(badUsage.stderr, /用法/);
    }
    assert.equal(run('--help').status, 0);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('arkigo-test-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
