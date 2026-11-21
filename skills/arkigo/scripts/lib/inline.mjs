import { pointer } from './errors.mjs';

const token = /(?<!\\)(\x60[^\x60\n]+\x60|\*\*[^*\n]+\*\*|\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\])/gu;

export function* inline(value) {
  let offset = 0;
  for (const match of value.matchAll(token)) {
    const [, text, ref, label] = match;
    const at = match.index;
    if (at > offset) yield { kind: 'text', text: value.slice(offset, at) };
    if (ref !== undefined) yield { kind: 'ref', ref, text: label ?? ref };
    else if (text.startsWith('**')) yield { kind: 'bold', text: text.slice(2, -2) };
    else yield { kind: 'code', text: text.slice(1, -1) };
    offset = at + text.length;
  }
  if (offset < value.length) yield { kind: 'text', text: value.slice(offset) };
}

export function* strings(value, path = '') {
  if (typeof value === 'string') yield { value, path };
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) yield* strings(child, path + '/' + pointer(key));
  }
}

export function* references(item) {
  for (const [value, base] of [[item.body, '/body'], [item.notes, '/notes']]) {
    for (const field of strings(value, base)) {
      for (const part of inline(field.value)) if (part.kind === 'ref') yield { ref: part.ref, path: field.path };
    }
  }
  if (item.type === 'flow') {
    for (const [i, step] of (item.body?.steps ?? []).entries()) {
      if (step.actor) yield { ref: step.actor, path: '/body/steps/' + i + '/actor' };
    }
  }
}
