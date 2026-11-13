#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { modelToCanvas, validateCanvas } from './canvas-document.mjs';

export function applyLayout(document, layout) {
  if (layout.schemaVersion !== 'arkigo-layout/1' || layout.documentId !== document.id || layout.revision !== document.revision || !Array.isArray(layout.views)) {
    throw new Error('布局格式、文档 ID 或版本不匹配。');
  }
  const output = structuredClone(document), seenViews = new Set();
  for (const view of layout.views) {
    const target = output.views.find((v) => v.id === view.id);
    if (!target || !Array.isArray(view.nodes) || seenViews.has(view.id)) throw new Error('布局包含未知或重复视图。');
    seenViews.add(view.id); const seen = new Set();
    for (const position of view.nodes) {
      const node = target.nodes.find((n) => n.id === position.id);
      if (!node || seen.has(position.id) || !Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error('布局包含未知、重复节点或无效坐标。');
      seen.add(position.id);node.x = position.x;node.y = position.y;
    }
  }
  return output;
}

export function renderCanvas(input, options = {}) {
  const sourceIsModel = input.schemaVersion === '0.1-draft';
  const converted = sourceIsModel ? modelToCanvas(input) : { document: structuredClone(input), report: null };
  const document = options.layout ? applyLayout(converted.document, options.layout) : converted.document;
  const report = validateCanvas(document);
  if (!report.valid) {
    const error = new Error('画布数据未通过校验，请先修复报告中的字段。');
    error.report = report;
    throw error;
  }
  // The model is inert JSON, never HTML or executable JavaScript.
  const payload = JSON.stringify({ document, report: converted.report ?? report, ...(sourceIsModel ? { model: input } : {}) }).replaceAll('<', '\\u003c');
  const template = readFileSync(new URL('../assets/canvas.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../assets/canvas.css', import.meta.url), 'utf8');
  const geometry = readFileSync(new URL('../assets/canvas-geometry.mjs', import.meta.url), 'utf8').replace(/^export /gm, '');
  const navigation = readFileSync(new URL('../assets/canvas-navigation.mjs', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const runtime = readFileSync(new URL('../assets/canvas-runtime.js', import.meta.url), 'utf8');
  return template.replace('/*ARKIGO_STYLE*/', () => css)
    .replace('/*ARKIGO_RUNTIME*/', () => geometry + '\n' + navigation + '\n' + runtime)
    .replace('<!--ARKIGO_DATA-->', () => payload);
}

export const renderModel = (model) => renderCanvas(model);

function main(args) {
  if (args.length === 1 && ['-h', '--help'].includes(args[0])) {
    console.log('用法：node scripts/render.mjs <canvas.json|model.json> <canvas.html> [--layout layout.json]');
    return 0;
  }
  if (![2, 4].includes(args.length) || (args.length === 4 && args[2] !== '--layout') || args.slice(0, 2).some((arg) => arg.startsWith('--'))) {
    console.error('用法：node scripts/render.mjs <canvas.json|model.json> <canvas.html> [--layout layout.json]');
    return 2;
  }
  try {
    const [input, output] = args.slice(0, 2).map((arg) => resolve(arg));
    if (input.toLowerCase() === output.toLowerCase() || (args[3] && resolve(args[3]).toLowerCase() === output.toLowerCase()) || !output.toLowerCase().endsWith('.html')) {
      throw new Error('输出必须是独立的 .html 文件。');
    }
    const document = JSON.parse(readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
    const layout = args[3] ? JSON.parse(readFileSync(args[3], 'utf8').replace(/^\uFEFF/, '')) : null;
    const html = renderCanvas(document, { layout });
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, html, 'utf8');
    console.log(`已生成 ${output}（ArkiGo 画布引擎 v1；可离线打开）`);
    return 0;
  } catch (error) {
    console.error(error.report ? JSON.stringify(error.report, null, 2) : error.message);
    return error.report ? 1 : 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
