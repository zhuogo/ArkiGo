const iconPaths = {
  system: 'M4 4h16v16H4z M4 9h16 M9 9v11 M12 13h5 M12 16h3',
  module: 'm12 3 9 5-9 5-9-5 9-5z M3 12l9 5 9-5 M3 16l9 5 9-5',
  actor: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  flow: 'M3 4h6v5H3z M15 15h6v5h-6z M6 9v5a3 3 0 0 0 3 3h6 M12 6h7 M16 3l3 3-3 3',
  rule: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8.5 12l2.5 2.5 4.5-5',
  entity: 'M20 5c0 4-16 4-16 0s16-4 16 0v14c0 4-16 4-16 0V5 M4 12c0 4 16 4 16 0',
  interface: 'm8 6-6 6 6 6 M16 6l6 6-6 6 M14 4l-4 16',
  screen: 'M3 4h18v13H3z M8 21h8 M12 17v4',
  acceptance: 'M8 5H5v16h14V5h-3 M8 3h8v4H8z M8 14l3 3 5-6',
  inventory: 'M4 5h16v14H4z M4 10h16 M4 14h16 M10 5v14',
  progress: 'M4 18h16 M6 14v-3 M12 14V7 M18 14V4',
  decision: 'm12 2 10 10-10 10L2 12z M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-1 .5-1 1.5-1 2.2 M12 17h.01',
  step: 'M4 12h15 M13 6l6 6-6 6',
  search: 'M20 20l-4-4 M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0',
  moon: 'M20.5 15a8.5 8.5 0 0 1-11.5-11.5A8.5 8.5 0 1 0 20.5 15z',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
  close: 'm6 6 12 12M18 6 6 18',
  right: 'm9 6 6 6-6 6', down: 'm6 9 6 6 6-6',
  plus: 'M12 5v14 M5 12h14', minus: 'M5 12h14',
  fit: 'M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4 M9 9h6v6H9z',
  reset: 'M3 11a9 9 0 1 1 2 6 M3 5v6h6',
  export: 'M12 3v12 M7 10l5 5 5-5 M4 16v4h16v-4',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 11v6 M12 7h.01',
  copy: 'M9 9h11v12H9z M16 9V3H4v12h5',
  warning: 'm12 3 10 17H2z M12 9v4 M12 17h.01',
  link: 'M10 13l4-4 M8 16l-2 2a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0 M14 14a3 3 0 0 0 4 0l4-4a3 3 0 0 0-4-4l-2 2'
};

function svgElement(tag, attributes) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function icon(name) {
  const svg = svgElement('svg', {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true'
  });
  svg.append(svgElement('path', { d: iconPaths[name] }));
  if (name === 'sun') svg.append(svgElement('circle', { cx: 12, cy: 12, r: 4 }));
  return svg;
}

function emptyIllustration() {
  const svg = svgElement('svg', { viewBox: '0 0 160 108', 'aria-hidden': true, class: 'empty-art' });
  svg.append(
    svgElement('rect', { x: 13, y: 13, width: 134, height: 82, rx: 10, class: 'empty-zone' }),
    svgElement('path', { d: 'M54 54h26v-19h22m-22 19v19h22', class: 'empty-lines' }),
    ...[[31, 42], [102, 23], [102, 61]].map(([x, y]) =>
      svgElement('rect', { x, y, width: 26, height: 24, rx: 4, class: 'empty-node' }))
  );
  return svg;
}
