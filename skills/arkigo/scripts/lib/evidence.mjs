import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { containedFile, projectPath } from './paths.mjs';
import { sha256 } from './design.mjs';
import { fail } from './errors.mjs';

export function isFile(path) {
  try { return statSync(path).isFile(); }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

export function evidenceFor(item, root, cache = new Map()) {
  const result = [];
  for (const evidence of item.implementation?.evidence ?? []) {
    const file = containedFile(root, evidence.path);
    if (!cache.has(file)) cache.set(file, isFile(file) ? sha256(readFileSync(file)) : null);
    const hash = cache.get(file);
    const state = hash === null ? 'missing' : !evidence.hash ? 'unrecorded' : evidence.hash === hash ? 'ok' : 'changed';
    result.push({ of: 'implementation', path: evidence.path, state,
      ...(evidence.symbol && { symbol: evidence.symbol }) });
  }
  for (const source of item.sources ?? []) {
    if (source.kind !== 'file') continue;
    const state = isFile(containedFile(root, source.ref)) ? 'ok' : 'missing';
    result.push({ of: 'source', path: source.ref, state, ...(source.symbol && { symbol: source.symbol }) });
  }
  return result;
}

export function* designEvidence(design, root, selected) {
  const cache = new Map();
  for (const item of design.objects) {
    if (selected && !selected.has(item.id)) continue;
    for (const evidence of evidenceFor(item, root, cache)) yield { id: item.id, ...evidence };
  }
}

export const needsReview = row => row.state === 'missing' || row.state === 'changed';

export function implementationState(item, root, cache) {
  if (evidenceFor(item, root, cache).some(row => row.of === 'implementation' && needsReview(row))) return 'stale';
  return item.implementation?.status ?? 'unknown';
}

export function stampEvidence(evidence, root, checkedAt) {
  const file = containedFile(root, evidence.path);
  if (!isFile(file)) fail('EVIDENCE_MISSING', 'Cannot hash a missing evidence file.', 1, { path: evidence.path });
  return { ...evidence, hash: sha256(readFileSync(file)), checkedAt };
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) fail('GIT_ERROR', 'Unable to read Git history for the given reference.');
  return result.stdout;
}

export function gitChanges(root, ref) {
  const commit = git(root, ['rev-parse', '--verify', '--end-of-options', ref + '^{commit}']).trim();
  const gitRoot = git(root, ['rev-parse', '--show-toplevel']).trimEnd();
  const history = git(gitRoot, ['log', '-m', '--format=', '--name-only', '-z', commit + '..HEAD', '--']);
  const diff = git(gitRoot, ['diff', '--name-only', '-z', commit, '--']);
  const other = git(gitRoot, ['ls-files', '-z', '--others', '--exclude-standard']);
  const names = new Set((history + '\0' + diff + '\0' + other).split('\0').filter(Boolean));
  return path => names.has(projectPath(gitRoot, containedFile(root, path)));
}
