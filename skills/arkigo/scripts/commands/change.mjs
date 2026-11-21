import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fail } from '../lib/errors.mjs';
import { project, projectPath } from '../lib/paths.mjs';
import { readJson, withLock, writeBatch } from '../lib/io.mjs';
import { loadDesign, assertDesign, readFormat } from '../lib/validate.mjs';
import { normalizeDesign, indexDesign, serializeDesign, sha256 } from '../lib/design.mjs';
import { changesBetween, changedIds } from '../lib/changes.mjs';
import { applyDecisions, applyOperations } from '../lib/operations.mjs';
import { warningsFor } from '../lib/warnings.mjs';
import { page } from '../lib/output.mjs';
import { regeneratePage } from '../lib/render-page.mjs';

export const flags = { reason: 1, ops: 1, by: 1, base: 1, 'dry-run': 0, 'from-decisions': 1 };

function input(options) {
  if (!options.reason?.trim() || (options.ops === undefined) === (options['from-decisions'] === undefined)) {
    fail('ARGUMENT_REQUIRED', 'Provide --reason and exactly one of --ops and --from-decisions.');
  }
  if (options.by !== undefined && !options.by.trim()) fail('INVALID_ARGUMENT', '--by needs a name.');
  if (options.base !== undefined && !/^[a-f0-9]{12}$/.test(options.base)) {
    fail('INVALID_ARGUMENT', '--base must be a revision.');
  }
  if (options['from-decisions'] !== undefined) return readFormat(resolve(options['from-decisions']), 'decisions-v1');
  if (options.ops !== '-') return readJson(resolve(options.ops));
  const text = readFileSync(0, 'utf8');
  try { return JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { fail('INVALID_JSON', 'Standard input is not valid JSON.'); }
}

function recordPath(history, result, now) {
  let time = Date.parse(now);
  while (true) {
    const at = new Date(time).toISOString();
    const stamp = at.replace(/[:\-]/g, '').replace(/[T.]/g, '-').slice(0, -1);
    const path = join(history, stamp + '-' + result + '.json');
    if (!existsSync(path)) return { path, at };
    time++;
  }
}

export default async function change(options) {
  const operations = input(options);
  const locations = project(options);
  const by = options.by ?? 'ai';
  return withLock(locations.dir, async () => {
    const before = normalizeDesign(loadDesign(locations));
    const prior = serializeDesign(before);
    const base = sha256(prior).slice(0, 12);
    if (options.base && options.base !== base) {
      fail('BASE_CONFLICT', 'Design revision differs from --base.', 3, { base: options.base, rev: base });
    }

    const now = new Date().toISOString();
    const operationOptions = { root: locations.root, now, by };
    let candidate, applied, decisions;
    if (options['from-decisions']) {
      const stale = operations.base !== base;
      const decisionResult = applyDecisions(before, operations.items, operationOptions, stale);
      const { result, comments, skipped, applied: count } = decisionResult;
      candidate = result;
      applied = count;
      decisions = { base: operations.base, stale, comments, skipped };
    } else {
      candidate = applyOperations(before, operations, operationOptions);
      applied = operations.length;
    }
    assertDesign(candidate, locations);
    const after = normalizeDesign(candidate);
    const bytes = serializeDesign(after);
    const rev = sha256(bytes).slice(0, 12);
    const changes = bytes === prior ? [] : changesBetween(before, after);
    const changed = changedIds(changes);
    let history = null;
    const warnings = [];
    if (changes.length) {
      const existing = new Set(warningsFor(before, indexDesign(before), locations.root).map(JSON.stringify));
      for (const warning of warningsFor(after, indexDesign(after), locations.root)) {
        if (!existing.has(JSON.stringify(warning))) warnings.push(warning);
      }
      if (!options['dry-run']) {
        mkdirSync(locations.history, { recursive: true });
        const { path, at } = recordPath(locations.history, rev, now);
        const record = { format: 'arkigo-change/1', at, by, reason: options.reason, base, result: rev, changes };
        writeBatch([
          { path: locations.design, bytes },
          { path, bytes: JSON.stringify(record, null, 2) + '\n', create: true },
        ]);
        history = projectPath(locations.root, path);
      }
    }
    const warningPage = page({}, 'warnings', warnings);
    const removed = {
      objects: changes.filter(row => row.op === 'remove').map(row => row.id),
      relations: changes.filter(row => row.op === 'unlink').map(row => row.relation),
    };
    return { ok: true, rev, base, applied, changed, history, warnings: warningPage.warnings,
      ...(history && { page: await regeneratePage(locations, { design: after, rev }) }),
      ...(warningPage.omitted && { warningNextOffset: warningPage.nextOffset, warningsOmitted: true }),
      ...(removed.objects.length && { removed }),
      ...(options['dry-run'] && { dryRun: true }),
      ...(decisions && { decisions }) };
  });
}
