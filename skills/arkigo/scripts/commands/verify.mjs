import { readModel, scope } from '../lib/read-model.mjs';
import { designEvidence, gitChanges, needsReview } from '../lib/evidence.mjs';
import { page } from '../lib/output.mjs';
import { CliError } from '../lib/errors.mjs';

export const flags = { under: 1, since: 1 };
export const paging = true;

export default function verify(options) {
  const { locations, design, index, rev } = readModel(options);
  const selected = scope(index, options.under);
  const changed = options.since === undefined ? null : gitChanges(locations.root, options.since);
  const rows = [], affected = new Set();
  for (const evidence of designEvidence(design, locations.root, selected)) {
    const since = changed ? changed(evidence.path) : undefined;
    if (since) affected.add(evidence.id);
    rows.push({ ...evidence, ...(since !== undefined && { changedSince: since }) });
  }
  const bad = rows.some(needsReview);
  const meta = { ok: !bad, rev, ...(bad && { code: 'EVIDENCE_STALE', message: 'Evidence is missing or changed.' }),
    ...(changed && { since: options.since, changedCount: affected.size }) };
  const selectedRows = changed ? rows.filter(row => row.changedSince || needsReview(row)) : rows;
  const result = page(meta, 'evidence', selectedRows, options);
  if (bad) throw new CliError('EVIDENCE_STALE', 'Evidence is missing or changed.', 1, result);
  return result;
}
