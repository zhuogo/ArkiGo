#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv from 'ajv';

const schema = JSON.parse(readFileSync(new URL('../schemas/model-0.1-draft.schema.json', import.meta.url), 'utf8'));
const checkSchema = new Ajv({ allErrors: true, strict: true }).compile(schema);
const escapePointer = (value) => value.replaceAll('~', '~0').replaceAll('/', '~1');
const issue = (code, objectId, path, message) => ({ code, objectId, path, message });
const result = (errors, warnings = []) => ({ valid: errors.length === 0, errors, warnings });

function schemaIssues(model) {
  return checkSchema.errors.filter((error) => error.keyword !== 'if').map((error) => {
    let path = error.instancePath;
    if (error.keyword === 'required') path += `/${escapePointer(error.params.missingProperty)}`;
    if (error.keyword === 'additionalProperties') path += `/${escapePointer(error.params.additionalProperty)}`;
    const match = /^\/(nodes|relations)\/(\d+)(?:\/|$)/.exec(path);
    const id = match ? model?.[match[1]]?.[Number(match[2])]?.id : null;
    return issue('SCHEMA_INVALID', typeof id === 'string' ? id : null, path, error.message);
  });
}

function reachable(starts, adjacency) {
  const seen = new Set();
  const pending = [...starts];
  while (pending.length) {
    const id = pending.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of adjacency.get(id) ?? []) pending.push(next);
  }
  return seen;
}

// This function never edits its input. Graph checks run only after the schema passes.
export function validateModel(model) {
  if (!checkSchema(model)) return result(schemaIssues(model));
  const errors = [];
  const warnings = [];
  const nodes = new Map();
  const ids = new Map();
  const nodePaths = new Map();
  const addError = (code, objectId, path, message) => errors.push(issue(code, objectId, path, message));

  for (const collection of ['nodes', 'relations']) {
    model[collection].forEach((object, index) => {
      const path = `/${collection}/${index}`;
      if (ids.has(object.id)) {
        addError('DUPLICATE_ID', object.id, `${path}/id`, `ID 已在 ${ids.get(object.id)}/id 使用。`);
      } else {
        ids.set(object.id, path);
      }
      if (collection === 'nodes') {
        nodes.set(object.id, object);
        nodePaths.set(object.id, path);
      }
    });
  }
  // Duplicate IDs make graph identity ambiguous; avoid misleading follow-up errors.
  if (errors.length) return result(errors);

  const roots = model.nodes.filter((node) => node.parentId === null);
  if (roots.length !== 1) {
    addError('ROOT_COUNT', null, '/nodes', `必须有且仅有一个根节点，当前为 ${roots.length} 个。`);
  }
  for (const node of model.nodes) {
    const path = nodePaths.get(node.id);
    if ((node.kind === 'system') !== (node.parentId === null)) {
      addError('SYSTEM_ROOT', node.id, `${path}/parentId`, '系统必须是唯一根节点，其他对象必须有归属。');
    }
    if (node.parentId !== null && !nodes.has(node.parentId)) {
      addError('REFERENCE_MISSING', node.id, `${path}/parentId`, `归属对象 ${node.parentId} 不存在。`);
    }
  }

  // Walk each parent chain once, without recursion (deep models cannot overflow the stack).
  const completed = new Set();
  for (const node of model.nodes) {
    const chain = new Set();
    let current = node;
    while (current && !completed.has(current.id)) {
      if (chain.has(current.id)) {
        addError('PARENT_CYCLE', current.id, `${nodePaths.get(current.id)}/parentId`, '归属链存在循环。');
        break;
      }
      chain.add(current.id);
      current = nodes.get(current.parentId);
    }
    for (const id of chain) completed.add(id);
  }

  const validRelations = [];
  const endpointKinds = {
    governed_by: [['flow', 'step'], ['rule']],
    verifies: [['acceptance'], ['flow', 'step', 'rule']],
    next: [['step'], ['step']],
    questions: [['question'], null],
    depends_on: [null, null],
  };
  model.relations.forEach((relation, index) => {
    let valid = true;
    for (const [position, field] of ['from', 'to'].entries()) {
      const endpoint = nodes.get(relation[field]);
      const allowed = endpointKinds[relation.kind][position];
      if (!endpoint) {
        addError('REFERENCE_MISSING', relation.id, `/relations/${index}/${field}`, `引用对象 ${relation[field]} 不存在。`);
        valid = false;
      } else if (allowed && !allowed.includes(endpoint.kind)) {
        addError('RELATION_ENDPOINT_KIND', relation.id, `/relations/${index}/${field}`, `${relation.kind} 的 ${field} 必须是 ${allowed.join(' / ')}。`);
        valid = false;
      }
    }
    if (valid) validRelations.push({ ...relation, path: `/relations/${index}` });
  });

  // Flow ownership cannot be inferred reliably from a broken parent tree.
  if (errors.some((error) => ['ROOT_COUNT', 'SYSTEM_ROOT', 'PARENT_CYCLE'].includes(error.code)
    || error.path.endsWith('/parentId'))) return result(errors);

  // The nearest flow ancestor owns a step; nested flows keep their own steps.
  const ownerCache = new Map();
  function enclosingFlow(id) {
    const chain = [];
    let current = nodes.get(id);
    while (current && current.kind !== 'flow' && !ownerCache.has(current.id)) {
      chain.push(current.id);
      current = nodes.get(current.parentId);
    }
    const owner = current?.kind === 'flow' ? current.id : (ownerCache.get(current?.id) ?? null);
    for (const member of chain) ownerCache.set(member, owner);
    return owner;
  }
  const flowSteps = new Map();
  for (const node of model.nodes) {
    if (node.kind !== 'step') continue;
    const owner = enclosingFlow(node.id);
    if (!owner) {
      addError('STEP_WITHOUT_FLOW', node.id, `${nodePaths.get(node.id)}/parentId`, '步骤必须归属于一个流程。');
      continue;
    }
    if (!flowSteps.has(owner)) flowSteps.set(owner, []);
    flowSteps.get(owner).push(node);
  }

  const outgoing = new Map();
  const forward = new Map();
  const backward = new Map();
  const questionTargets = new Set();
  const coveredRules = new Set();
  for (const relation of validRelations) {
    if (relation.kind === 'questions' && nodes.get(relation.from).designStatus !== 'retired') {
      questionTargets.add(relation.to);
    }
    if (relation.kind === 'verifies' && nodes.get(relation.from).designStatus !== 'retired') {
      coveredRules.add(relation.to);
    }
    if (relation.kind !== 'next') continue;
    const fromFlow = enclosingFlow(relation.from);
    if (!fromFlow || fromFlow !== enclosingFlow(relation.to)) {
      addError('NEXT_CROSS_FLOW', relation.id, `${relation.path}/to`, 'next 关系的两端必须属于同一个流程。');
      continue;
    }
    if (!outgoing.has(relation.from)) outgoing.set(relation.from, []);
    if (!forward.has(relation.from)) forward.set(relation.from, []);
    if (!backward.has(relation.to)) backward.set(relation.to, []);
    outgoing.get(relation.from).push(relation);
    forward.get(relation.from).push(relation.to);
    backward.get(relation.to).push(relation.from);
  }

  for (const flow of model.nodes.filter((node) => node.kind === 'flow')) {
    const path = nodePaths.get(flow.id);
    const steps = flowSteps.get(flow.id) ?? [];
    const belongs = (id) => nodes.get(id)?.kind === 'step' && enclosingFlow(id) === flow.id;
    const start = flow.details.startStepId;
    const terminals = flow.details.terminalStepIds;
    const terminalSet = new Set(terminals);
    const checkBoundary = (id, field) => {
      if (!nodes.has(id)) {
        addError('REFERENCE_MISSING', flow.id, `${path}/details/${field}`, `引用步骤 ${id} 不存在。`);
      } else if (!belongs(id)) {
        addError('FLOW_STEP_MEMBERSHIP', flow.id, `${path}/details/${field}`, `${id} 必须是该流程所属的步骤。`);
      }
    };
    checkBoundary(start, 'startStepId');
    terminals.forEach((id, index) => checkBoundary(id, `terminalStepIds/${index}`));
    const visited = belongs(start) ? reachable([start], forward) : null;
    const canFinish = terminals.every(belongs) ? reachable(terminals, backward) : null;
    for (const step of steps) {
      const stepPath = nodePaths.get(step.id);
      if (visited && !visited.has(step.id)) {
        addError('STEP_UNREACHABLE', step.id, `${stepPath}/id`, `从流程 ${flow.id} 的起点无法到达该步骤。`);
      }
      if (canFinish && !canFinish.has(step.id)) {
        addError('NO_TERMINAL_PATH', step.id, `${stepPath}/id`, '该步骤没有通向任何已声明终点的路径。');
      }
      const edges = outgoing.get(step.id) ?? [];
      if (terminalSet.has(step.id) && edges.length) {
        addError('TERMINAL_HAS_NEXT', step.id, `${stepPath}/id`, '已声明的终点不能继续通过 next 流转。');
      }
      if (edges.length < 2) continue;
      for (const edge of edges) {
        if (!edge.condition) {
          addError('BRANCH_CONDITION_MISSING', edge.id, `${edge.path}/condition`, '同一步骤有多个出口时，每条 next 关系都须声明条件。');
        }
      }
      if (!step.details.failureHandling && !questionTargets.has(step.id) && !questionTargets.has(flow.id)) {
        addError('FAILURE_HANDLING_MISSING', step.id, `${stepPath}/details/failureHandling`, '分支步骤须记录异常处理，或用 questions 关系关联该步骤或流程的待决策问题。');
      }
    }
  }

  for (const node of model.nodes) {
    if (node.designStatus === 'retired') continue;
    if (node.kind === 'rule' && !coveredRules.has(node.id)) {
      warnings.push(issue('RULE_WITHOUT_ACCEPTANCE', node.id, `${nodePaths.get(node.id)}/id`, '规则没有来自有效验收对象的 verifies 关联。'));
    }
    if (node.kind === 'question') {
      warnings.push(issue('QUESTION_UNRESOLVED', node.id, `${nodePaths.get(node.id)}/details/question`, `待决策：${node.details.question}`));
    }
  }
  return result(errors, warnings);
}

export function validateFile(file) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch (error) {
    return result([issue('FILE_READ_ERROR', null, '', `无法读取文件（${error.code}）。`)]);
  }
  let model;
  try {
    model = JSON.parse(content.replace(/^\uFEFF/, ''));
  } catch (error) {
    return result([issue('JSON_PARSE_ERROR', null, '', error.message)]);
  }
  return validateModel(model);
}

function main(args) {
  const usage = '用法：node scripts/validate.mjs <model.json> [--json]\n退出码：0 校验通过（可含提示）；1 模型无效；2 参数或文件错误。';
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(usage);
    return 0;
  }
  const files = args.filter((arg) => !arg.startsWith('--'));
  if (files.length !== 1 || args.some((arg) => arg.startsWith('--') && arg !== '--json')
    || args.filter((arg) => arg === '--json').length > 1) {
    console.error(usage);
    return 2;
  }
  const report = validateFile(files[0]);
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`${report.valid ? 'PASS' : 'FAIL'} ${files[0]} — ${report.errors.length} 个错误，${report.warnings.length} 个提示`);
    for (const [label, issues] of [['ERROR', report.errors], ['WARN', report.warnings]]) {
      for (const item of issues) console.log(`${label} ${item.code} ${item.objectId ?? '-'} ${item.path || '/'}: ${item.message}`);
    }
  }
  if (report.errors.some((error) => ['FILE_READ_ERROR', 'JSON_PARSE_ERROR'].includes(error.code))) return 2;
  return report.valid ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
