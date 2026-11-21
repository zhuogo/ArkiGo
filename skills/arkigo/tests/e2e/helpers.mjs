import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cli = fileURLToPath(new URL('../../scripts/arkigo.mjs', import.meta.url));

export async function project(t, designDir = 'docs/arkigo') {
  const temp = await mkdtemp(join(tmpdir(), 'arkigo-e2e-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const root = join(temp, '项目 空格');
  await mkdir(root);
  const dir = join(root, designDir);
  const run = (args, options = {}) => command(args, { cwd: root, ...options });
  const change = (ops, args = [], options = {}) => run(['change', '--reason', '端到端测试', '--ops', '-', ...args],
    { input: ops, ...options });
  const init = (args = []) => run(['init', '--id', 'shop', '--title', '邻里下单', '--no-rules', ...args]);
  return { temp, root, dir, html: join(dir, 'index.html'), run, init, change };
}

function command(args, { cwd, input, code = 0 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, timeout: 20_000 });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.stdin.on('error', reject);
    child.on('error', reject);
    child.on('close', (status, signal) => {
      try {
        assert.equal(status, code, `${args.join(' ')} (${signal ?? status})\n${stderr || stdout}`);
        assert.equal(code === 0 ? stderr : stdout, '');
        const line = code === 0 ? stdout : stderr;
        assert.match(line, /^[^\n]+\n$/);
        resolve(JSON.parse(line));
      } catch (error) { reject(error); }
    });
    child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
  });
}

export async function openPage(t, browser, html, hash = '') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (/^(?:https?|wss?):/i.test(request.url())) requests.push(request.url()); });
  const navigate = async (target = hash) => {
    await page.goto(pathToFileURL(html).href + target);
    await page.waitForFunction(() => Boolean(window.arkigoCanvas));
  };
  await navigate();
  return { page, navigate, errors, requests };
}

export const data = page => page.locator('#arkigo-data').evaluate(element => JSON.parse(element.textContent));
export const state = page => page.evaluate(() => window.arkigoCanvas.getState());

export function add(id, type, title, body = {}, parent = 'shop', extra = {}) {
  return {
    op: 'add',
    object: { id, type, title, summary: '', parent, status: 'proposed', origin: 'ai', body, ...extra },
  };
}

export const update = (id, set) => ({ op: 'update', id, set });
