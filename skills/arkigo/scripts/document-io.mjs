import { readFileSync, realpathSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

export function identity(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('输入必须是 JSON 对象。');
  const model = document.schemaVersion === '0.1-draft';
  if (!model && document.schemaVersion !== 'arkigo-canvas/1') throw new Error('不支持的文档协议。');
  const id = model ? document.project?.id : document.id;
  if (typeof id !== 'string' || !id.trim() || typeof document.revision !== 'string' || !document.revision.trim()) throw new Error('文档需要非空 ID 与 revision。');
  return { schemaVersion: document.schemaVersion, id, revision: document.revision };
}

export function resolvedPath(file) {
  const absolute = resolve(file);
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent = dirname(absolute);
  return parent === absolute ? absolute : join(resolvedPath(parent), basename(absolute));
}

export function assertDistinctFiles(files) {
  const seenPaths = new Set(), seenInodes = new Set();
  for (const file of files) {
    let name = resolvedPath(file);
    if (process.platform === 'win32') name = name.toLowerCase();
    if (seenPaths.has(name)) throw new Error('输入、基线、目标与 HTML 必须是不同文件。');
    seenPaths.add(name);
    if (existsSync(file)) {
      const info = statSync(file, { bigint: true });
      const inode = `${info.dev}:${info.ino}`;
      if (info.ino !== 0n && seenInodes.has(inode)) throw new Error('路径指向同一个文件，不能覆盖输入。');
      seenInodes.add(inode);
    }
  }
}

export const compactError = error => JSON.stringify({ ok: false, code: error.code ?? 'COMMAND_FAILED', message: String(error.message).slice(0, 600) });
