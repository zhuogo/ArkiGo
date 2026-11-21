const byId = (id) => document.getElementById(id);
const make = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const textNode = (value) => document.createTextNode(value);
const announce = (message) => { byId('live').textContent = message; };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const narrowScreen = matchMedia('(max-width: 760px)');
const largeTargets = matchMedia('(pointer: coarse), (max-width: 640px)');

function button(label, callback, className = 'tool') {
  const element = make('button', className, label);
  element.type = 'button';
  element.addEventListener('click', callback);
  return element;
}

function iconButton(name, label, callback) {
  const element = button(undefined, callback);
  element.title = label;
  element.setAttribute('aria-label', label);
  element.append(icon(name));
  return element;
}

function typeMark(type) {
  const mark = make('span', 'type-mark');
  mark.dataset.type = type;
  mark.append(icon(type));
  return mark;
}

function statusMark(state, labels, name) {
  const mark = make('span', name, labels[state]);
  mark.dataset.state = state;
  return mark;
}

function checkMark(state, label, glyph) {
  const mark = make('span', 'check-status');
  mark.dataset.state = state;
  mark.setAttribute('role', 'img');
  mark.setAttribute('aria-label', label);
  mark.title = label;
  mark.append(icon(glyph));
  return mark;
}

function codeCheckMark(object, evidence) {
  const entries = Object.hasOwn(evidence, object.id) ? evidence[object.id] : [];
  const files = entries.filter(({ of }) => of === 'implementation');
  const checked = files.length > 0 && files.length === object.implementation?.evidence?.length &&
    files.every(({ state }) => state === 'ok');
  return checked
    ? checkMark('checked', '代码依据已核对', 'checked')
    : checkMark('unchecked', '代码依据待核对', 'unchecked');
}

function cssBox(element, { x, y, width, height }) {
  Object.assign(element.style, {
    left: x + 'px', top: y + 'px', width: width + 'px', height: height + 'px'
  });
}

function addressHash(mode, address) {
  return '#/' + mode + '/' + encodeURIComponent(address).replace(/%23/g, '#');
}

function objectLink(ctx, address, label, className = 'object-link', locate = false) {
  const link = make('a', className, label ?? ctx.index.get(address)?.title ?? address);
  link.setAttribute('href', addressHash(ctx.modeFor(address), address));
  link.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    ctx.jump(address, locate);
  });
  return link;
}

function rich(element, value, ctx) {
  function nodes(tokens) {
    return tokens.map((token) => {
      if (token.kind === 'text') return textNode(token.value);
      if (token.kind === 'code') return make('code', '', token.value);
      const child = token.kind === 'strong' ? make('strong') :
        objectLink(ctx, token.target, undefined, 'object-link inline-reference');
      if (token.children) child.replaceChildren(...nodes(token.children));
      return child;
    });
  }
  element.append(...nodes(parseInline(value)));
  return element;
}

function readStorage(key, fallback = null) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const readModes = new Map();
const registerRead = (name, definition) => readModes.set(name, definition);

function articleReading(title, className) {
  const frame = byId('view-content');
  frame.hidden = false;
  frame.scrollTop = 0;
  const page = make('div', 'reading-page ' + className);
  page.setAttribute('aria-label', title);
  frame.append(page);
  return page;
}

function readingEmpty(message) {
  const empty = make('div', 'reading-empty');
  empty.append(emptyIllustration(), make('p', '', message));
  return empty;
}

function inspectButton(ctx, object, label = object.title) {
  const control = button(label, () => ctx.select(object.id, true), 'tool reading-link');
  control.dataset.object = object.id;
  if (object.id === ctx.selection()) control.setAttribute('aria-current', 'true');
  return control;
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = make('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
