import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';
import { buildPage } from '../../scripts/page.mjs';
import { clinicDir } from '../page/fixtures.mjs';

export const engines = { chromium, webkit };
export const desktop = { width: 1440, height: 960 };
export const mobile = { width: 390, height: 844 };
export const state = (page) => page.evaluate(() => window.arkigoCanvas.getState());
export const card = (page, id) => page.locator(`#world .graph-card[data-id="${id}"]`);

export async function waitForView(page, viewId, extra = {}) {
  await page.waitForFunction(({ viewId, extra }) => {
    const current = window.arkigoCanvas?.getState();
    return current?.viewId === viewId && !current.transitioning &&
      Object.entries(extra).every(([key, value]) => current[key] === value);
  }, { viewId, extra });
}

export async function writePage(t, input) {
  const directory = await mkdtemp(join(tmpdir(), 'arkigo-page-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'index.html');
  await writeFile(file, buildPage(input));
  if (input.design.id === 'clinic') await cp(new URL('assets/', clinicDir), join(directory, 'assets'), {
    recursive: true
  });
  return pathToFileURL(file).href;
}

export async function openPage(t, browser, url, options = {}) {
  const context = await browser.newContext({ viewport: desktop, colorScheme: 'light', ...options });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', (request) => { if (/^https?:/i.test(request.url())) requests.push(request.url()); });
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.arkigoCanvas));
  return { page, context, errors, requests };
}
