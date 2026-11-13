#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { canonical, identity, readJson, assertDistinctFiles, compactError } from './document-io.mjs';
import { renderCanvas } from './render.mjs';
import { diffDocuments } from './diff.mjs';

export function applyCandidate(baseFile, candidateFile, targetFile, htmlFile, { layoutFile } = {}) {
  assertDistinctFiles([baseFile, candidateFile, targetFile, htmlFile, ...(layoutFile ? [layoutFile] : [])]);
  if (!targetFile.toLowerCase().endsWith('.json') || !htmlFile.toLowerCase().endsWith('.html')) throw new Error('目标需要 .json 与 .html 扩展名。');
  const base = readJson(baseFile), candidate = readJson(candidateFile), current = readJson(targetFile);
  const before = identity(base), after = identity(candidate), target = identity(current);
  if (before.id !== after.id || before.id !== target.id || before.schemaVersion !== after.schemaVersion || before.schemaVersion !== target.schemaVersion) throw new Error('基线、候选、目标必须属于同一份设计。');
  if (canonical(base) !== canonical(current)) throw Object.assign(new Error('当前设计已偏离基线，请重新读取并合并，不覆盖当前文件。'), { code: 'BASE_CONFLICT' });
  if (canonical(base) !== canonical(candidate) && before.revision === after.revision) throw new Error('候选有改动时必须更新 revision。');
  const layout = layoutFile ? readJson(layoutFile) : null;
  // Finish all validation and HTML generation before touching current artifacts.
  const html = renderCanvas(candidate, { layout });
  const report = diffDocuments(base, candidate);
  const outputs = [[targetFile, JSON.stringify(candidate, null, 2) + '\n'], [htmlFile, html]];
  const prior = outputs.map(([path]) => existsSync(path) ? readFileSync(path) : null);
  const staged = [], committed = [];
  try {
    for (const [path, text] of outputs) {
      mkdirSync(dirname(resolve(path)), { recursive: true });
      const temp = path + '.' + randomUUID() + '.tmp';
      staged.push(temp); writeFileSync(temp, text, { encoding: 'utf8', flag: 'wx' });
    }
    if (canonical(readJson(targetFile)) !== canonical(base)) throw Object.assign(new Error('准备写入期间基线发生变化。'), { code: 'BASE_CONFLICT' });
    for (let i = 0; i < outputs.length; i++) { renameSync(staged[i], outputs[i][0]); committed.push(i); }
  } catch (error) {
    const rollbackErrors = [];
    for (const index of committed.reverse()) {
      try { if (prior[index] === null) rmSync(outputs[index][0], { force: true }); else writeFileSync(outputs[index][0], prior[index]); }
      catch { rollbackErrors.push(outputs[index][0]); }
    }
    if (rollbackErrors.length) throw Object.assign(new Error('写入失败且恢复失败；保留 base/candidate，检查目标 JSON 与 HTML 后重试。'), { code: 'ROLLBACK_FAILED' });
    throw error;
  } finally { for (const path of staged) rmSync(path, { force: true }); }
  return { ok: true, revision: after.revision.slice(0, 160), revisionTruncated: after.revision.length > 160, summary: report.summary };
}

function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { console.log('用法：node apply.mjs <base.json> <candidate.json> <target.json> <canvas.html> [--layout saved.layout.json]'); return 0; }
  try {
    if (![4, 6].includes(args.length) || args.slice(0, 4).some(arg => arg.startsWith('--')) || (args.length === 6 && args[4] !== '--layout')) throw new Error('需要四个独立文件路径，可选 --layout。');
    console.log(JSON.stringify(applyCandidate(...args.slice(0, 4), { layoutFile: args[5] }))); return 0;
  } catch (error) { console.error(compactError(error)); return error.report ? 1 : 2; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
