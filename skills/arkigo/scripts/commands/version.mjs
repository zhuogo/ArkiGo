import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readJson } from '../lib/io.mjs';
import { commands } from '../lib/commands.mjs';

const require = createRequire(import.meta.url);

export default function version() {
  const skillDir = fileURLToPath(new URL('../..', import.meta.url));
  const { version } = readJson(new URL('../../package.json', import.meta.url));
  let ajv = false;
  try { require('ajv'); ajv = true; } catch {}
  return { ok: true, version, node: process.versions.node, dependencies: { ajv }, skillDir, commands };
}
