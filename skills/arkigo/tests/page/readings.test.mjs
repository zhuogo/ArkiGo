import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Ajv from 'ajv';
import { indexDesign } from '../../assets/model.mjs';
import { inventoryRows } from '../../assets/inventory.mjs';
import { progressGroups } from '../../assets/progress.mjs';
import { changeText, fieldChanges, historyChanges, historyMarks } from '../../assets/change-history.mjs';
import {
  decisionActions, decisionFile, decisionPrompt, pendingDecisions, queueDecision, retainDecisions, undoDecision
} from '../../assets/decisions.mjs';
import { clinicInput } from './fixtures.mjs';

const clinic = clinicInput();
const index = indexDesign(clinic.design);
const middle = clinic.history.findIndex(({ result }) => result === '7a939d32a011');
const decisions = [
  { op: 'accept', id: 'first-visit' },
  { op: 'retire', id: 'late-policy', rationale: '允许护士判断' },
  { op: 'decide', id: 'waitlist', chosen: 1, rationale: '由前台确认' },
  { op: 'comment', id: 'appointment', text: '<script>原样保留</script>' }
];

test('inventory has six typed groups, stable order and composable nearest-module filters', () => {
  const rows = inventoryRows(index, clinic.evidence);
  assert.deepEqual(Object.keys(rows), ['rule', 'acceptance', 'decision', 'entity', 'interface', 'screen']);
  for (const [type, items] of Object.entries(rows)) {
    assert.ok(items.length && items.every(({ object }) => object.type === type));
  }
  assert.deepEqual(inventoryRows(indexDesign({ ...clinic.design, objects: [...clinic.design.objects].reverse() }),
    clinic.evidence), rows);
  const count = (filters) => Object.values(inventoryRows(index, clinic.evidence, filters)).flat().length;
  assert.ok(count({ status: 'proposed' }) > 0);
  assert.equal(count({ implementation: 'stale' }), 1);
  assert.equal(rows.entity.find(({ object }) => object.id === 'appointment').module.id, 'reserve');
  assert.equal(count({ module: 'booking' }), 2);
  assert.equal(count({ status: 'accepted', implementation: 'stale', module: 'reserve' }), 1);
  assert.equal(count({ status: 'proposed', implementation: 'stale', module: 'reserve' }), 0);
});

test('progress classifies each implementable object once and stale evidence overrides its prior status', () => {
  const { groups, review } = progressGroups(index, clinic.evidence);
  const implementation = groups.flatMap((group) => Object.entries(group.implementation));
  const ids = implementation.flatMap(([, objects]) => objects.map(({ id }) => id));
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(ids.length, clinic.design.objects.filter(({ type }) =>
    ['module', 'flow', 'rule', 'entity', 'interface', 'screen'].includes(type)).length);
  for (const state of ['planned', 'partial', 'implemented', 'unknown', 'stale']) {
    assert.ok(implementation.some(([label, objects]) => label === state && objects.length));
  }
  assert.deepEqual(implementation.filter(([state]) => state === 'stale').flatMap(([, rows]) =>
    rows.map(({ id }) => id)), ['reserve-api']);
  assert.deepEqual(review.map(({ state }) => state), ['changed', 'missing']);
  for (const state of ['passed', 'failed', 'unknown']) assert.ok(groups.some((row) => row.verification[state].length));
  const unchecked = progressGroups(index, {});
  assert.equal(unchecked.matched, false);
  assert.ok(unchecked.groups.every((row) => !Object.hasOwn(row.implementation, 'stale')));
});

test('history groups changes and reconstructs the middle revision from newer before snapshots', () => {
  const changes = historyChanges(index, clinic.history, middle);
  assert.deepEqual(changes.add.map(({ op }) => op), ['add', 'link']);
  assert.deepEqual(changes.remove.map(({ op }) => op), ['remove', 'unlink']);
  const fields = fieldChanges(changes.update.find(({ id }) => id === 'appointment'));
  assert.deepEqual(fields.map(({ path }) => path), ['summary']);
  assert.match(fields[0].before, /第一版/);
  assert.match(fields[0].after, /第二版/);
  const draft = historyChanges(index, clinic.history, middle + 1).add.find(({ id }) => id === 'receipt-draft');
  assert.match(draft.after.title, /旧凭证/);
  const marks = historyMarks(index, clinic.history[middle]);
  assert.ok(marks.get('booking').has('remove'));
  assert.ok(marks.get('appointment').has('update'));
  assert.equal(historyMarks(index, undefined).size, 0);
});

test('field diff finds nested values and highlights only the changed region with nearby context', () => {
  assert.deepEqual(fieldChanges({ fields: ['body.chosen', 'body.options'], before: { body: {} },
    after: { body: { chosen: 0, options: ['a'] } } }), [
    { path: 'body.chosen', before: undefined, after: 0 }, { path: 'body.options', before: undefined, after: ['a'] }
  ]);
  const prefix = '保持不变'.repeat(20);
  const [before, after] = changeText(prefix + '甲' + prefix, prefix + '乙' + prefix);
  assert.equal(before.changed, '甲');
  assert.equal(after.changed, '乙');
  assert.ok(before.leading.startsWith('…') && before.trailing.endsWith('…'));
});

test('decisions can supersede, co-exist with comments, undo and reconcile a newer revision', () => {
  assert.deepEqual(pendingDecisions(index).map(({ id }) => id).sort(),
    ['cancelled-reminder', 'first-visit', 'late-policy', 'receipt-expiry', 'waitlist']);
  const entries = decisions.reduce((rows, item) => queueDecision(rows, item, clinic.rev), []);
  const changed = queueDecision(entries, { op: 'retire', id: 'first-visit' }, clinic.rev);
  assert.deepEqual(changed.map(({ item }) => item.id), ['late-policy', 'waitlist', 'appointment', 'first-visit']);
  const withComment = queueDecision(changed, { op: 'comment', id: 'first-visit', text: '另记' }, clinic.rev);
  assert.deepEqual(undoDecision(withComment, 4), changed);
  const next = indexDesign({ ...clinic.design, objects: clinic.design.objects.map((object) =>
    object.id === 'first-visit' ? { ...object, status: 'accepted' } :
      object.id === 'waitlist' ? { ...object, status: 'accepted', body: { ...object.body, chosen: 1 } } : object) });
  assert.deepEqual(retainDecisions(entries, next, '123456789abc').map(({ item }) => item.id),
    ['late-policy', 'appointment']);
  assert.deepEqual(retainDecisions(entries, next, clinic.rev), entries);
});

test('decision actions follow the entry state and keep unresolved choices available', () => {
  const waitlist = index.get('waitlist');
  const openEnded = { ...waitlist, body: { question: waitlist.body.question } };
  assert.deepEqual(decisionActions(waitlist), ['decide', 'retire', 'comment']);
  for (const object of [openEnded, index.get('cancelled-reminder'), index.get('receipt-expiry')]) {
    assert.deepEqual(decisionActions(object), ['accept', 'retire', 'comment'], object.id);
  }
  const nextIndex = (object) => indexDesign({ ...clinic.design, objects: clinic.design.objects.map((item) =>
    item.id === object.id ? object : item) });
  const acceptedChoice = nextIndex({ ...waitlist, status: 'accepted' });
  const acceptedOpenEnded = nextIndex({ ...openEnded, status: 'accepted' });
  assert.ok(pendingDecisions(acceptedChoice).some(({ id }) => id === waitlist.id));
  assert.ok(!pendingDecisions(acceptedOpenEnded).some(({ id }) => id === waitlist.id));
  const queued = queueDecision([], { op: 'retire', id: waitlist.id }, clinic.rev);
  assert.deepEqual(retainDecisions(queued, acceptedChoice, '123456789abc'), queued);
});

test('decision export passes the schema and the AI instruction matches section 11.3', () => {
  const entries = decisions.map((item) => ({ item, rev: clinic.rev }));
  const file = decisionFile(entries, '123456789abc');
  const schema = JSON.parse(readFileSync(new URL('../../schemas/decisions-v1.schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv().compile(schema);
  assert.ok(validate(file), JSON.stringify(validate.errors));
  assert.deepEqual(file, { format: 'arkigo-decisions/1', base: clinic.rev, items: decisions });
  const decision = index.get('waitlist');
  const expected = [
    '我在 ArkiGo 页面上做了下面这些决定，请用 arkigo 技能把它们写进设计。',
    '',
    '设计目录：docs/arkigo',
    '我看到的版本：' + clinic.rev,
    '',
    '1. 接受「' + index.get('first-visit').title + '」（first-visit）',
    '2. 否决「' + index.get('late-policy').title + '」（late-policy）。理由：允许护士判断',
    '3. 「' + decision.body.question + '」（waitlist）选第 2 项「' + decision.body.options[1].title + '」。理由：由前台确认',
    '4. 对「预约单」（appointment）的批注：<script>原样保留</script>',
    '',
    '请这样处理：接受、否决和选择直接用 change 写入，原因写「用户在页面上拍板」。' +
      '批注是我的意见，请先读相关内容再处理：意见明确的按它修改；需要你来设计、或有不止一种改法的，' +
      '把你的方案作为提议写进设计，等我确认。' +
      '如果设计现在的版本和我看到的不一样，先看这几个对象有没有变化，变了的先问我再写。' +
      '做完后告诉我写入了哪些、哪些没写入以及原因。'
  ];
  assert.equal(decisionPrompt(index, entries, clinic.rev, 'docs/arkigo'), expected.join('\n'));
  const noReason = entries.map(({ item: { rationale, ...item }, rev }) => ({ item, rev }));
  assert.equal(decisionPrompt(index, noReason, clinic.rev, 'docs/arkigo'),
    expected.join('\n').replace('。理由：允许护士判断', '').replace('。理由：由前台确认', ''));
});
