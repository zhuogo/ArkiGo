import { openDecision, ownerId, implementable } from './design.mjs';
import { evidenceFor, needsReview } from './evidence.mjs';

export function warningsFor(design, index, root, selected) {
  const targets = new Set(), verified = new Set(), blocked = new Set();
  for (const relation of design.relations) {
    const to = ownerId(relation.to);
    targets.add(to);
    if (relation.type === 'verifies') verified.add(to);
    if (relation.type === 'blocks' && openDecision(index.objects.get(ownerId(relation.from)))) blocked.add(to);
  }
  const result = [], cache = new Map();
  for (const item of design.objects) {
    const { id, type, body, origin, status } = item;
    if (selected && !selected.has(id)) continue;
    const warn = (code, message) => result.push({ code, id, message });
    if (type === 'system' && (!body.audience?.length || !body.goals?.length
        || (!body.scopeIn?.length && !body.scopeOut?.length))) warn('SYSTEM_INCOMPLETE', '补充用户、目标和范围。');
    if (type === 'module' && !body.responsibilities?.length && !index.children.get(id)?.length) {
      warn('THIN_MODULE', '模块没有职责或下级。');
    }
    if (type === 'flow' && !body.steps.some(step => step.failure?.trim())) warn('FLOW_NO_FAILURE', '补充失败处理。');
    if (type === 'rule' && !verified.has(id)) warn('RULE_NO_ACCEPTANCE', '没有指向该规则的验收。');
    if (status === 'accepted' && blocked.has(id)) warn('ACCEPTED_BUT_BLOCKED', '已接受，但仍受未决问题阻塞。');
    if (openDecision(item)) warn('OPEN_DECISION', '需要用户定结论。');
    if ([...item.summary].length > 90) warn('SUMMARY_LONG', '摘要超过 90 字符。');
    if (['code', 'doc'].includes(origin) && !item.sources?.length) warn('NO_SOURCE', '缺少内容依据。');
    if (['entity', 'interface'].includes(type) && !targets.has(id)) {
      warn('UNUSED_' + type.toUpperCase(), '没有指向该对象的关系。');
    }
    if (implementable.has(type) && !item.implementation) warn('NOT_CHECKED', '尚未核对实现情况。');
    for (const row of evidenceFor(item, root, cache)) {
      if (needsReview(row)) warn('STALE_EVIDENCE', '依据需复查：' + row.path + (row.symbol ? '#' + row.symbol : ''));
    }
  }
  return result;
}
