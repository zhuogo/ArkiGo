const backtick = String.fromCharCode(96);
const referencePattern = /^[a-z0-9][a-z0-9._-]{0,63}(#[a-z0-9][a-z0-9._-]{0,63})?$/;

export function parseInline(text) {
  function read(start, end, close = '', links = true, depth = 0) {
    const nodes = [];
    let plain = start;
    let i = start;
    const flush = () => {
      if (i > plain) nodes.push({ kind: 'text', value: text.slice(plain, i) });
    };
    while (i < end) {
      if (close && text.startsWith(close, i)) {
        flush();
        return { nodes, next: i + close.length };
      }
      let node;
      let next;
      if (text[i] === backtick) {
        const stop = text.indexOf(backtick, i + 1);
        if (stop > i + 1 && stop < end) {
          node = { kind: 'code', value: text.slice(i + 1, stop) };
          next = stop + 1;
        }
      } else if (depth < 24 && text.startsWith('**', i) && !close && text.indexOf('**', i + 2) < end) {
        const inner = text.indexOf('**', i + 2) < 0 ? null : read(i + 2, end, '**', links, depth + 1);
        if (inner?.nodes.length) {
          node = { kind: 'strong', children: inner.nodes };
          next = inner.next;
        }
      } else if (depth < 24 && links && text.startsWith('[[', i)) {
        const stop = text.indexOf(']]', i + 2);
        const separator = text.indexOf('|', i + 2);
        const hasLabel = separator >= 0 && separator < stop;
        const target = text.slice(i + 2, hasLabel ? separator : stop);
        if (stop >= 0 && stop + 2 <= end && referencePattern.test(target)) {
          node = { kind: 'reference', target };
          if (hasLabel) node.children = read(separator + 1, stop, '', false, depth + 1).nodes;
          next = stop + 2;
        }
      }
      if (node) {
        flush();
        nodes.push(node);
        i = plain = next;
      } else i++;
    }
    flush();
    return close ? null : { nodes };
  }
  return read(0, text.length).nodes;
}
