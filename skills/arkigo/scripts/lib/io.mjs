import {
  closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync,
  renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fail } from './errors.mjs';
import { physicalPath } from './paths.mjs';

export const jsonLine = value => JSON.stringify(value) + '\n';

export function readJson(file) {
  const source = readFileSync(file, 'utf8');
  try { return JSON.parse(source.replace(/^\uFEFF/, '')); }
  catch { fail('INVALID_JSON', 'Input is not valid JSON.'); }
}

function stage(path, bytes) {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o666;
  const fd = openSync(temporary, 'wx', mode);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  } finally {
    closeSync(fd);
  }
  return temporary;
}

export function writeAtomic(path, bytes) {
  const temporary = stage(path, bytes);
  try { renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
}

export function assertDistinct(path, protectedFiles) {
  const target = physicalPath(path);
  const stats = existsSync(path) ? statSync(path, { bigint: true }) : null;
  for (const file of protectedFiles) {
    const source = physicalPath(file);
    const samePath = process.platform === 'win32' ? target.toLowerCase() === source.toLowerCase() : target === source;
    const input = stats && existsSync(file) ? statSync(file, { bigint: true }) : null;
    if (samePath || (input?.ino && input.ino === stats.ino && input.dev === stats.dev)) {
      fail('FILE_ALIAS', 'Output would overwrite an ArkiGo input.');
    }
  }
}

function clearLock(lock) {
  let entries;
  try { entries = readdirSync(lock); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const match = /^(\d+)-[a-f\d-]+$/.exec(entry);
    if (!match || Number(match[1]) < 1) continue;
    try { process.kill(Number(match[1]), 0); }
    catch (error) {
      if (error.code === 'ESRCH') rmSync(join(lock, entry), { force: true });
      else if (error.code !== 'EPERM') throw error;
    }
  }
  try { rmdirSync(lock); }
  catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
  }
}

export async function withLock(dir, action) {
  const lock = join(dir, '.arkigo.lock');
  const owner = `${process.pid}-${randomUUID()}`;
  const staged = join(dir, `.arkigo-lock-${owner}`);
  const start = performance.now();
  mkdirSync(staged);
  let held = false;
  try {
    writeFileSync(join(staged, owner), '', { flag: 'wx' });
    do {
      try {
        renameSync(staged, lock);
        held = true;
      } catch (error) {
        const contention = ['EEXIST', 'ENOTEMPTY'].includes(error.code)
          || (['EPERM', 'EACCES'].includes(error.code) && existsSync(lock));
        if (!contention) throw error;
        clearLock(lock);
        await delay(25 + Math.floor(Math.random() * 25));
      }
    } while (!held && performance.now() - start < 5000);
    if (!held) fail('LOCK_TIMEOUT', 'Could not obtain the ArkiGo lock within five seconds.');
    return await action();
  } finally {
    if (held) {
      rmSync(join(lock, owner), { force: true });
      try { rmdirSync(lock); }
      catch (error) {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
      }
    }
    rmSync(staged, { recursive: true, force: true });
  }
}

export function writeBatch(entries) {
  const staged = [];
  const published = [];
  try {
    for (const { path, bytes, create = false } of entries) {
      const previous = !create && existsSync(path) ? readFileSync(path) : null;
      staged.push({ path, temporary: stage(path, bytes), previous, create });
    }
    for (const entry of staged) {
      if (entry.create) linkSync(entry.temporary, entry.path);
      else renameSync(entry.temporary, entry.path);
      published.push(entry);
    }
  } catch (error) {
    let failed = false;
    for (const { path, previous } of published.reverse()) {
      try {
        if (previous === null) unlinkSync(path);
        else writeAtomic(path, previous);
      } catch { failed = true; }
    }
    if (failed) fail('ROLLBACK_FAILED', 'Publishing failed and could not restore an original file.');
    throw error;
  } finally {
    for (const { temporary } of staged) rmSync(temporary, { force: true });
  }
}
