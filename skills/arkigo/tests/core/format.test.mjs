import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { writeFileSync, symlinkSync } from 'node:fs';
import { validateDesign } from '../../scripts/lib/validate.mjs';
import { revision, serializeDesign, types, indexDesign } from '../../scripts/lib/design.mjs';
import { warningsFor } from '../../scripts/lib/warnings.mjs';
import { shop, item, workspace } from './helpers.mjs';

const objectFor = ['shop', 'customer', 'checkout', 'place-order', 'one-pickup', 'order',
  'create-order', 'cart', 'stock-acceptance', 'stock-window'];
const locations = { root: process.cwd(), assets: process.cwd() };

function expected(design, location, code, id, path) {
  const errors = validateDesign(design, location);
  assert.ok(errors.some(issue => issue.code === code && issue.id === id && issue.path === path),
    JSON.stringify(errors));
}

test('01 passes every object type, content block and relation', t => {
  const area = workspace(t);
  const design = shop();
  area.save(design);
  writeFileSync(join(area.assets, 'cart.png'), 'fixture');
  item(design, 'cart').body.media = [{ path: 'cart.png' }];
  item(design, 'checkout').notes.push({ type: 'image', path: 'cart.png', caption: '购物车' });
  assert.deepEqual(validateDesign(design, area), []);
  for (const type of types) {
    assert.ok(design.objects.filter(row => row.type === type).length >= (type === 'system' ? 1 : 2));
  }
  assert.equal(new Set(design.relations.map(row => row.type)).size, 9);
  assert.equal(new Set(item(design, 'checkout').notes.map(row => row.type)).size, 6);
});

for (const id of objectFor) test('01 rejects invalid body for ' + id, () => {
  const design = shop(), row = item(design, id);
  row.body.unexpected = 'invalid';
  expected(design, locations, 'SCHEMA_INVALID', id, '/objects/' + design.objects.indexOf(row) + '/body/unexpected');
});

for (const [type, bad, field] of [
  ['text', { text: 1 }, 'text'], ['list', { items: [true] }, 'items/0'],
  ['table', { columns: [], rows: [1] }, 'rows/0'], ['code', { text: null }, 'text'],
  ['image', { path: [] }, 'path'], ['callout', { text: '', tone: 'quiet' }, 'tone'],
]) test('01 rejects invalid block ' + type, () => {
  const design = shop(), row = item(design, 'checkout');
  row.notes = [{ type, ...bad }];
  expected(design, locations, 'SCHEMA_INVALID', 'checkout', '/objects/3/notes/0/' + field);
});

for (const type of new Set(shop().relations.map(row => row.type))) {
  test('01 rejects malformed ' + type + ' relation', () => {
    const design = shop();
    const i = design.relations.findIndex(row => row.type === type), relation = design.relations[i];
    relation.to = 'MALFORMED';
    expected(design, locations, 'SCHEMA_INVALID', relation.from.split('#')[0], '/relations/' + i + '/to');
  });
}

test('02 canonical form preserves nested array order, false, zero and required empty values', () => {
  const input = shop();
  const reverse = value => {
    if (Array.isArray(value)) return value.map(reverse);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverse(v)]));
    }
    return value;
  };
  const other = reverse(input);
  other.objects.reverse();
  other.relations.reverse();
  item(other, 'checkout').group = '';
  item(other, 'cart').notes = [];
  assert.equal(serializeDesign(other), serializeDesign(input));
  assert.equal(revision(other), revision(input));
  assert.equal(serializeDesign(input).endsWith('\n'), true);
  for (const mutate of [
    value => { item(value, 'shop').summary += '变化'; },
    value => { item(value, 'order').body.fields.reverse(); },
    value => { item(value, 'checkout').notes.reverse(); },
    value => { item(value, 'order').order = 0; },
    value => { item(value, 'stock-window').body.chosen = 0; },
    value => { item(value, 'place-order').body.transitions.reverse(); },
    value => { value.relations[0].label = '变化'; },
  ]) {
    const next = shop();
    mutate(next);
    assert.notEqual(serializeDesign(next), serializeDesign(input));
    assert.notEqual(revision(next), revision(input));
  }
});

const relationChecks = [
  ['reads', 'to', 'cart'], ['writes', 'to', 'cart'], ['governed_by', 'to', 'cart'],
  ['verifies', 'from', 'cart'], ['blocks', 'from', 'cart'], ['uses', 'from', 'cart'],
];
for (const [type, end, id] of relationChecks) test('03 constrained endpoint for ' + type, () => {
  const design = shop(), i = design.relations.findIndex(row => row.type === type);
  design.relations[i][end] = id;
  const from = design.relations[i].from.split('#')[0];
  expected(design, locations, 'RELATION_ENDPOINT_TYPE', from, '/relations/' + i + '/' + end);
});

const errors = [
  ['ID_DUPLICATE', 'cart', '/objects/19/id', d => d.objects.push(structuredClone(item(d, 'cart')))],
  ['PARENT_NOT_FOUND', 'cart', '/objects/13/parent', d => { item(d, 'cart').parent = 'missing'; }],
  ['PARENT_CYCLE', 'checkout', '/objects/3/parent', d => { item(d, 'checkout').parent = 'pickup'; }],
  ['ROOT_COUNT', null, '/objects', d => { item(d, 'cart').parent = null; }],
  ['SYSTEM_ROOT', 'cart', '/objects/13/parent', d => { item(d, 'cart').parent = null; }],
  ['RELATION_ENDPOINT_NOT_FOUND', 'pickup', '/relations/0/to', d => { d.relations[0].to = 'missing'; }],
  ['RELATION_ENDPOINT_NOT_FOUND', 'place-order', '/relations/1/from', d => { d.relations[1].from = 'place-order#x'; }],
  ['RELATION_DUPLICATE', 'pickup', '/relations/14', d => d.relations.push(d.relations[0])],
  ['SCHEMA_INVALID', 'cart', '/relations/10/label', d => { delete d.relations[10].label; }],
  ['STEP_ID_DUPLICATE', 'place-order', '/objects/5/body/steps/1/id',
    d => { item(d, 'place-order').body.steps[1].id = 'inspect'; }],
  ['STEP_NOT_FOUND', 'place-order', '/objects/5/body/start', d => { item(d, 'place-order').body.start = 'bad'; }],
  ['STEP_NOT_FOUND', 'place-order', '/objects/5/body/ends/0', d => { item(d, 'place-order').body.ends[0] = 'bad'; }],
  ['STEP_NOT_FOUND', 'place-order', '/objects/5/body/transitions/0/from',
    d => { item(d, 'place-order').body.transitions[0].from = 'bad'; }],
  ['STEP_NOT_FOUND', 'place-order', '/objects/5/body/transitions/0/to',
    d => { item(d, 'place-order').body.transitions[0].to = 'bad'; }],
  ['STEP_UNREACHABLE', 'place-order', '/objects/5/body/steps/2/id',
    d => { item(d, 'place-order').body.transitions.pop(); }],
  ['STEP_NO_EXIT', 'place-order', '/objects/5/body/steps/1/id', d => { item(d, 'place-order').body.ends.shift(); }],
  ['BRANCH_WHEN_REQUIRED', 'place-order', '/objects/5/body/transitions/1/when',
    d => { delete item(d, 'place-order').body.transitions[1].when; }],
  ['STEP_ACTOR_INVALID', 'place-order', '/objects/5/body/steps/0/actor',
    d => { item(d, 'place-order').body.steps[0].actor = 'cart'; }],
  ['REFERENCE_NOT_FOUND', 'checkout', '/objects/3/notes/0/text',
    d => { item(d, 'checkout').notes[0].text = '[[missing]]'; }],
  ['REFERENCE_NOT_FOUND', 'checkout', '/objects/3/notes/0/text',
    d => { item(d, 'checkout').notes[0].text = '[[place-order#missing]]'; }],
  ['IMPLEMENTATION_INVALID', 'cart', '/objects/13/implementation/evidence',
    d => { item(d, 'cart').implementation = { status: 'implemented' }; }],
  ['IMPLEMENTATION_INVALID', 'cart', '/objects/13/implementation/note',
    d => { item(d, 'cart').implementation = { status: 'partial', evidence: [{ path: 'src.js' }] }; }],
  ['IMPLEMENTATION_INVALID', 'shop', '/objects/0/implementation',
    d => { item(d, 'shop').implementation = { status: 'planned' }; }],
  ['VERIFICATION_INVALID', 'stock-acceptance', '/objects/15/verification/status',
    d => { item(d, 'stock-acceptance').verification = { status: 'unknown', checkedAt: new Date().toISOString() }; }],
  ['VERIFICATION_INVALID', 'cart', '/objects/13/verification',
    d => { item(d, 'cart').verification = { status: 'passed', checkedAt: new Date().toISOString() }; }],
  ['DECISION_OUT_OF_BOUNDS', 'stock-window', '/objects/17/body/chosen',
    d => { item(d, 'stock-window').body.chosen = 2; }],
  ['ASSET_MISSING', 'cart', '/objects/13/body/media/0/path',
    d => { item(d, 'cart').body.media = [{ path: 'missing.png' }]; }],
  ['ASSET_PATH_INVALID', 'cart', '/objects/13/notes/0/path',
    d => { item(d, 'cart').notes = [{ type: 'image', path: '../outside.png' }]; }],
  ['EVIDENCE_PATH_INVALID', 'cart', '/objects/13/sources/0/ref',
    d => { item(d, 'cart').sources = [{ kind: 'file', ref: 'C:\\outside.js' }]; }],
];
for (const [code, id, path, mutate] of errors) test('03 ' + code + ' ' + path, () => {
  const design = shop();
  mutate(design);
  expected(design, locations, code, id, path);
});

test('03 paths cannot escape with a symlink and code spans suppress markup', t => {
  const area = workspace(t), design = shop();
  area.save(design);
  writeFileSync(join(area.root, 'outside.png'), 'file');
  symlinkSync(join(area.root, 'outside.png'), join(area.assets, 'alias.png'));
  item(design, 'cart').body.media = [{ path: 'alias.png' }];
  expected(design, area, 'ASSET_PATH_INVALID', 'cart', '/objects/13/body/media/0/path');
  delete item(design, 'cart').body.media;
  item(design, 'cart').notes = [{ type: 'text', text: '\x60[[missing]]\x60[[shop]][[order]]' }];
  assert.deepEqual(validateDesign(design, area), []);
  item(design, 'cart').notes[0].text += '[[missing]]';
  expected(design, area, 'REFERENCE_NOT_FOUND', 'cart', '/objects/13/notes/0/text');
});

const hints = [
  ['SYSTEM_INCOMPLETE', 'shop', d => { delete item(d, 'shop').body.goals; }, false],
  ['THIN_MODULE', 'pickup', d => { item(d, 'pickup').body = {}; d.objects
    .filter(row => row.parent === 'pickup').forEach(row => { row.parent = 'checkout'; }); }, false],
  ['FLOW_NO_FAILURE', 'place-order', d => { delete item(d, 'place-order').body.steps[0].failure; }, false],
  ['RULE_NO_ACCEPTANCE', 'stock-limit', d => {
    d.relations = d.relations.filter(row => row.to !== 'stock-limit');
  }, false],
  ['ACCEPTED_BUT_BLOCKED', 'checkout', d => { item(d, 'checkout').status = 'proposed'; }, true],
  ['OPEN_DECISION', 'stock-window', d => { item(d, 'stock-window').body.chosen = 0; }, true],
  ['SUMMARY_LONG', 'cart', d => { item(d, 'cart').summary = '字'.repeat(91); }, false],
  ['NO_SOURCE', 'cart', d => { item(d, 'cart').origin = 'code'; }, false],
  ['UNUSED_ENTITY', 'order', d => { d.relations = d.relations.filter(row => row.to !== 'order'); }, false],
  ['UNUSED_INTERFACE', 'create-order', d => {
    d.relations = d.relations.filter(row => row.to !== 'create-order');
  }, false],
  ['NOT_CHECKED', 'cart', d => { item(d, 'cart').implementation = { status: 'planned' }; }, true],
  ['STALE_EVIDENCE', 'cart', d => { item(d, 'cart').sources = [{ kind: 'file', ref: 'not-present.js' }]; }, false],
];
for (const [code, id, toggle, initial] of hints) test('03 toggles ' + code, () => {
  const design = shop();
  const has = () => warningsFor(design, indexDesign(design), locations.root)
    .some(row => row.code === code && row.id === id);
  assert.equal(has(), initial);
  toggle(design);
  assert.equal(has(), !initial);
});
