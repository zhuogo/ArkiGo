import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { physicalPath } from '../lib/paths.mjs';
import { fail } from '../lib/errors.mjs';

const files = ['SKILL.md', 'LICENSE', 'package.json', 'package-lock.json', 'scripts', 'references', 'assets', 'schemas'];
export const flags = { user: 0 };
export const positionals = [0, 1];

export default function install(options, [destination]) {
  if (options.user === (destination !== undefined) || (!options.user && !destination)) {
    fail('INVALID_ARGUMENT', 'Provide one new target directory or --user.');
  }
  if (Number(process.versions.node.split('.')[0]) < 22) fail('NODE_UNSUPPORTED', 'Node.js 22 or later is required.');
  const profile = process.env.CODEX_HOME || join(homedir(), '.codex');
  const target = physicalPath(destination ?? join(profile, 'skills', 'arkigo'));
  const origin = physicalPath(fileURLToPath(new URL('../..', import.meta.url)));
  const rel = relative(origin, target);
  if (!rel || (rel !== '..' && !rel.startsWith('..' + sep))) {
    fail('INSTALL_TARGET_INVALID', 'Target is inside the skill.');
  }
  if (existsSync(target)) fail('INSTALL_TARGET_EXISTS', 'Installation target already exists.');
  for (const name of files) {
    if (!existsSync(join(origin, name))) fail('INSTALL_SOURCE_MISSING', 'Installation is missing ' + name + '.');
  }
  mkdirSync(dirname(target), { recursive: true });
  const staging = mkdtempSync(join(dirname(target), '.arkigo-install-'));
  try {
    for (const name of files) cpSync(join(origin, name), join(staging, name), { recursive: true, errorOnExist: true });
    mkdirSync(target);
    try { renameSync(staging, target); }
    catch (error) { rmSync(target, { force: true, recursive: true }); throw error; }
  } finally { rmSync(staging, { force: true, recursive: true }); }
  return { ok: true, destination: target, dependencyStep: 'npm ci --omit=dev --ignore-scripts --no-audit --no-fund',
    runtime: 'Node.js >=22' };
}
