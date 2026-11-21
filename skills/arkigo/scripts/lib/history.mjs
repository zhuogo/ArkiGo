import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readFormat } from './validate.mjs';

const pattern = /^\d{8}-\d{6}-\d{3}-[a-f0-9]{12}\.json$/;

export function historyFiles(dir) {
  try { return readdirSync(dir).filter(file => pattern.test(file)).sort().reverse(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return []; }
}

export const readHistory = (dir, file) => readFormat(join(dir, file), 'change-v1');
