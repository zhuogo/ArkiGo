import { lstatSync, realpathSync, existsSync } from 'node:fs';
import { dirname, basename, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { fail } from './errors.mjs';

export function physicalPath(path) {
  const absolute = resolve(path);
  try { return realpathSync(absolute); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    try { lstatSync(absolute); }
    catch (entryError) {
      if (entryError.code !== 'ENOENT') throw entryError;
      return join(physicalPath(parent), basename(absolute));
    }
    fail('UNSAFE_PATH', 'A dangling symbolic link cannot be resolved.');
  }
}

function ancestor(path, test) {
  for (let current = path; ; current = dirname(current)) {
    if (test(current)) return current;
    if (current === dirname(current)) return undefined;
  }
}

export function project(options, init = false) {
  const cwd = process.cwd();
  const found = options.dir === undefined && !init
    ? ancestor(cwd, parent => existsSync(join(parent, 'docs', 'arkigo', 'design.json')))
    : undefined;
  if (!options.dir && !init && !found) fail('DESIGN_NOT_FOUND', 'No docs/arkigo/design.json found.');
  const dir = physicalPath(options.dir ?? join(found ?? cwd, 'docs', 'arkigo'));
  const defaultRoot = basename(dir) === 'arkigo' && basename(dirname(dir)) === 'docs'
    ? dirname(dirname(dir)) : dirname(dir);
  const root = options.root
    ? physicalPath(options.root)
    : ancestor(dir, path => existsSync(join(path, '.git'))) ?? defaultRoot;
  return {
    dir, root, design: join(dir, 'design.json'), layout: join(dir, 'layout.json'),
    history: join(dir, 'history'), assets: join(dir, 'assets'), page: join(dir, 'index.html'),
  };
}

export const projectPath = (root, path) => relative(root, path).split(sep).join('/') || '.';

function within(base, path) {
  const rel = relative(base, path);
  return !!rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
}

export function containedFile(base, ref) {
  if (!ref || ref.includes('\0') || isAbsolute(ref) || win32.isAbsolute(ref) || /^[a-z]:/i.test(ref)) {
    fail('UNSAFE_PATH', 'Expected a relative file path.');
  }
  const path = resolve(base, ref.replaceAll('\\', '/'));
  if (!within(base, path) || !within(base, physicalPath(path))) {
    fail('UNSAFE_PATH', 'File path leaves its allowed directory.');
  }
  return path;
}
