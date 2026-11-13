#!/usr/bin/env node
import { cpSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { compactError, resolvedPath } from './document-io.mjs';

const source = fileURLToPath(new URL('..', import.meta.url));
const files = ['SKILL.md', 'package.json', 'package-lock.json', 'scripts', 'references', 'assets', 'schemas'];

export function installSkill(destination) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('需要 Node.js 22 或以上。');
  const target = resolvedPath(destination), origin = realpathSync(source);
  if (existsSync(target)) throw new Error('目标已存在；为避免覆盖其他版本，请选择空目录或自行备份后更新。');
  const rel = relative(origin, target);
  if (!rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))) throw new Error('不能安装到 Skill 源目录内部。');
  for (const name of files) if (!existsSync(join(source, name))) throw new Error(`Skill 文件缺失：${name}`);
  mkdirSync(target, { recursive: true });
  for (const name of files) cpSync(join(source, name), join(target, name), { recursive: true, errorOnExist: true, force: false });
  return { ok: true, destination: target, dependencyStep: '在目标 Skill 目录执行 npm ci --omit=dev --ignore-scripts --no-audit --no-fund。', runtime: 'Node.js >=22；安装依赖后日常离线运行。' };
}

function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { console.log('用法：node install.mjs <空目标目录> | --user（安装到 $CODEX_HOME/skills/arkigo，默认 ~/.codex/skills/arkigo；不覆盖已存在目录）'); return 0; }
  try {
    if (args.length !== 1 || (args[0].startsWith('--') && args[0] !== '--user')) throw new Error('需要一个空目标目录或 --user。');
    console.log(JSON.stringify(installSkill(args[0] === '--user' ? join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills', 'arkigo') : args[0]))); return 0;
  } catch (error) { console.error(compactError(error)); return 2; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
