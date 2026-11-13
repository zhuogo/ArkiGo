#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { canonical, identity, readJson, compactError } from './document-io.mjs';

const geometry = new Set(['x', 'y', 'width', 'height', 'zoneId', 'fromSide', 'toSide']);
const omit = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.has(key)));

function entries(document) {
  const map = new Map();
  const add = (kind, value, viewId = null) => {
    if (!value || typeof value.id !== 'string' || !value.id.trim()) throw new Error('对象需要非空 ID。');
    const key = JSON.stringify([kind, viewId, value.id]);
    if (map.has(key)) throw new Error('同类对象 ID 重复，不能可靠比较。');
    map.set(key, { kind, viewId, id: value.id, value });
  };
  if (document.schemaVersion === '0.1-draft') {
    if (!Array.isArray(document.nodes) || !Array.isArray(document.relations)) throw new Error('模型缺少节点或关系数组。');
    add('document', { ...omit(document, new Set(['nodes', 'relations'])), id: document.project.id });
    for (const node of document.nodes) add('node', node);
    for (const relation of document.relations) add('relation', relation);
  } else {
    if (!Array.isArray(document.views) || !document.views.length) throw new Error('画布缺少视图。');
    add('document', { ...omit(document, new Set(['views'])), effectiveRootViewId: document.rootViewId ?? document.views[0].id });
    for (const view of document.views) {
      add('view', omit(view, new Set(['nodes', 'edges', 'zones'])));
      for (const [collection, kind] of [['nodes', 'node'], ['edges', 'relation'], ['zones', 'zone']]) {
        if (!Array.isArray(view[collection])) throw new Error(`视图缺少 ${collection} 数组。`);
        for (const value of view[collection]) add(kind, value, view.id);
      }
    }
  }
  return map;
}

// Reports field names rather than echoing old/new prose into the AI context.
export function diffDocuments(base, candidate) {
  const a = identity(base), b = identity(candidate);
  if (a.schemaVersion !== b.schemaVersion || a.id !== b.id) throw new Error('只能比较同一协议、同一文档 ID 的设计。');
  const before = entries(base), after = entries(candidate), changes = [];
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const old = before.get(key), next = after.get(key), item = next ?? old;
    if (!old || !next) {
      changes.push({ kind: item.kind, viewId: item.viewId, id: item.id, change: old ? 'removed' : 'added', category: item.kind === 'zone' ? 'layout' : 'content', fields: [] });
      continue;
    }
    const fields = [...new Set([...Object.keys(old.value), ...Object.keys(next.value)])].sort().filter(field => canonical(old.value[field]) !== canonical(next.value[field]));
    for (const category of ['content', 'layout', 'metadata']) {
      const selected = fields.filter(field => (item.kind === 'document' && field === 'revision' ? 'metadata' : geometry.has(field) ? 'layout' : 'content') === category);
      if (selected.length) changes.push({ kind: item.kind, viewId: item.viewId, id: item.id, change: 'changed', category, fields: selected });
    }
  }
  return { schemaVersion: 'arkigo-diff/1', documentId: a.id, baseRevision: a.revision, candidateRevision: b.revision,
    summary: Object.fromEntries(['content', 'layout', 'metadata'].map(category => [category, changes.filter(change => change.category === category).length])), changes };
}

export function diffPage(report, { offset = 0, limit = 20, maxBytes = 12000 } = {}) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 65536) throw new Error('offset ≥ 0，limit 为 1–100，max-bytes 为 1024–65536。');
  const clip = value => typeof value === 'string' && value.length > 40 ? value.slice(0, 40) + '…' : value;
  const output = { ...report, documentId: clip(report.documentId), baseRevision: clip(report.baseRevision), candidateRevision: clip(report.candidateRevision), changes: [],
    truncated: [report.documentId, report.baseRevision, report.candidateRevision].some(value => value.length > 40), pagination: { offset, total: report.changes.length, returned: 0, nextOffset: null } };
  const size = () => Buffer.byteLength(JSON.stringify(output) + '\n');
  for (let index = offset; index < Math.min(report.changes.length, offset + limit); index++) {
    const raw = report.changes[index];
    let row = { ...raw, id: clip(raw.id), viewId: clip(raw.viewId), fields: raw.fields.slice(0, 20).map(clip) };
    if (canonical(row) !== canonical(raw)) row.truncated = true;
    output.changes.push(row); output.pagination.returned++;
    output.pagination.nextOffset = index + 1 < report.changes.length ? index + 1 : null;
    if (size() > maxBytes && output.changes.length > 1) {
      output.changes.pop(); output.pagination.returned--; output.pagination.nextOffset = index; break;
    }
    if (size() > maxBytes) {
      row = { kind: raw.kind, id: String(raw.id).slice(0, 40), change: raw.change, category: raw.category, truncated: true, omitted: '字段过长，请直接核对输入对象。' };
      output.changes[0] = row;
    }
    if (row.truncated) output.truncated = true;
  }
  if (!output.changes.length && offset < report.changes.length) output.pagination.nextOffset = offset;
  while (size() > maxBytes) {
    for (const key of ['documentId', 'baseRevision', 'candidateRevision']) output[key] = output[key].slice(0, Math.max(1, Math.floor(output[key].length / 2)));
    output.truncated = true;
  }
  return output;
}

function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { console.log('用法：node diff.mjs <base.json> <candidate.json> [--offset 0] [--limit 20] [--max-bytes 12000]'); return 0; }
  try {
    if (args.length < 2 || args[0].startsWith('--') || args[1].startsWith('--')) throw new Error('需要基线与候选路径。');
    const options = {}, seen = new Set(), names = { '--offset': 'offset', '--limit': 'limit', '--max-bytes': 'maxBytes' };
    for (let i = 2; i < args.length; i += 2) {
      const key = names[args[i]], value = args[i + 1];
      if (!key || seen.has(key) || !/^\d+$/.test(value ?? '')) throw new Error('未知、重复或无效参数。');
      seen.add(key); options[key] = Number(value);
    }
    console.log(JSON.stringify(diffPage(diffDocuments(readJson(args[0]), readJson(args[1])), options))); return 0;
  } catch (error) { console.error(compactError(error)); return 2; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
