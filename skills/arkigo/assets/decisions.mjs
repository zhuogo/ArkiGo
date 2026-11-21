const decisionVerbs = { accept: '接受', retire: '否决', decide: '选择', comment: '批注' };
const unchosen = (object) => object.type === 'decision' && object.status !== 'retired' && object.body.chosen == null;
const canChoose = (object) => unchosen(object) && Boolean(object.body.options?.length);
const needsDecision = (object) => object.status === 'proposed' || canChoose(object);

export function pendingDecisions(index) {
  return [...index.objects.values()].filter(needsDecision).sort(compareObjects);
}

export function decisionActions(object) {
  const primary = canChoose(object) ? 'decide' : 'accept';
  return [primary, 'retire', 'comment'];
}

export function queueDecision(entries, item, rev) {
  return [...entries.filter(({ item: other }) =>
    other.id !== item.id || (other.op === 'comment') !== (item.op === 'comment')), { rev, item }];
}

export function undoDecision(entries, i) {
  return entries.filter((_, index) => index !== i);
}

export function retainDecisions(entries, index, rev) {
  return entries.filter(({ rev: base, item }) => {
    if (base === rev || item.op === 'comment') return true;
    const object = index.objects.get(item.id);
    if (!object) return true;
    if (item.op === 'decide') return unchosen(object);
    if (item.op === 'retire') return needsDecision(object);
    return object.status === 'proposed';
  });
}

export function decisionFile(entries, rev) {
  return { format: 'arkigo-decisions/1', base: entries[0]?.rev ?? rev, items: entries.map(({ item }) => item) };
}

export function decisionLine(index, item) {
  const object = index.objects.get(item.id);
  const target = '「' + (object?.title ?? item.id) + '」（' + item.id + '）';
  const reason = item.rationale ? '。理由：' + item.rationale : '';
  if (item.op === 'accept') return '接受' + target;
  if (item.op === 'retire') return '否决' + target + reason;
  if (item.op === 'comment') return '对' + target + '的批注：' + item.text;
  const question = '「' + (object?.body.question ?? item.id) + '」（' + item.id + '）';
  const option = object?.body.options?.[item.chosen]?.title ?? '';
  return question + '选第 ' + (item.chosen + 1) + ' 项「' + option + '」' + reason;
}

export function decisionPrompt(index, entries, rev, directory) {
  const file = decisionFile(entries, rev);
  return [
    '我在 ArkiGo 页面上做了下面这些决定，请用 arkigo 技能把它们写进设计。',
    '',
    '设计目录：' + directory,
    '我看到的版本：' + file.base,
    '',
    ...file.items.map((item, i) => (i + 1) + '. ' + decisionLine(index, item)),
    '',
    '请这样处理：接受、否决和选择直接用 change 写入，原因写「用户在页面上拍板」。' +
      '批注是我的意见，请先读相关内容再处理：意见明确的按它修改；需要你来设计、或有不止一种改法的，' +
      '把你的方案作为提议写进设计，等我确认。' +
      '如果设计现在的版本和我看到的不一样，先看这几个对象有没有变化，变了的先问我再写。' +
      '做完后告诉我写入了哪些、哪些没写入以及原因。'
  ].join('\n');
}
import { compareObjects } from './model.mjs';

