const portVectors = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
const midpoint = (a, b) => (a + b) / 2;

function port(card, side, offset) {
  const [x, y] = portVectors[side];
  const point = {
    x: card.x + card.width * (x + 1) / 2 + (y ? offset : 0),
    y: card.y + card.height * (y + 1) / 2 + (x ? offset : 0)
  };
  return [point, { x: point.x + x * 8, y: point.y + y * 8 }];
}

export function segmentHitsBox(a, b, box) {
  if (a.x === b.x) {
    return a.x > box.x && a.x < box.x + box.width &&
      Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height;
  }
  if (a.y === b.y) {
    return a.y > box.y && a.y < box.y + box.height &&
      Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width;
  }
  return true;
}

function simplifyRoute(points) {
  const result = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (previous?.x === point.x && previous.y === point.y) continue;
    const earlier = result.at(-2);
    if ((earlier?.x === point.x && previous.x === point.x) ||
        (earlier?.y === point.y && previous.y === point.y)) result.pop();
    result.push(point);
  }
  return result;
}

function gridRoute(start, end, cards, clear) {
  const xs = [...new Set([start.x, end.x, ...cards.flatMap(({ x, width }) => [x, x + width])])].sort((a, b) => a - b);
  const ys = [...new Set([start.y, end.y, ...cards.flatMap(({ y, height }) => [y, y + height])])].sort((a, b) => a - b);
  const goal = xs.indexOf(end.x) + ys.indexOf(end.y) * xs.length;
  const first = xs.indexOf(start.x) + ys.indexOf(start.y) * xs.length;
  const trail = new Map([[first, -1]]);
  const queue = [first];
  const point = (i) => ({ x: xs[i % xs.length], y: ys[Math.floor(i / xs.length)] });
  for (let i = 0; i < queue.length; i++) {
    const index = queue[i];
    const a = point(index);
    if (index === goal) {
      const result = [];
      for (let current = index; current >= 0; current = trail.get(current)) result.push(point(current));
      return result.reverse();
    }
    const column = index % xs.length;
    const neighbors = [
      column > 0 ? index - 1 : -1, column + 1 < xs.length ? index + 1 : -1,
      index - xs.length, index + xs.length
    ];
    for (const next of neighbors) {
      if (next < 0 || next >= xs.length * ys.length || trail.has(next) || !clear(a, point(next))) continue;
      trail.set(next, index);
      queue.push(next);
    }
  }
}

export function routeConnection(from, to, cards, vertical, back, lane = 0) {
  const obstacles = cards.map(({ x, y, width, height }) =>
    ({ x: x - 5, y: y - 5, width: width + 10, height: height + 10 }));
  const clear = (a, b) => !obstacles.some((box) => segmentHitsBox(a, b, box));
  const forward = vertical ? ['bottom', 'top'] : ['right', 'left'];
  const returnSide = vertical ? 'right' : 'top';
  const pairs = back
    ? [[returnSide, from === to ? forward[1] : returnSide], forward]
    : [forward, ['bottom', 'top'], ['top', 'bottom'], ['right', 'left'], ['left', 'right']];
  const candidates = [];
  const detours = [];
  for (const [fromSide, toSide] of pairs) {
    const [a, start] = port(from, fromSide, lane);
    const [b, end] = port(to, toSide, from === to ? -lane : lane);
    if (cards.some((card) => card !== from && segmentHitsBox(a, start, card)) ||
        cards.some((card) => card !== to && segmentHitsBox(end, b, card))) continue;
    const right = (vertical ? Math.max(from.x + from.width, to.x + to.width)
      : Math.max(...cards.map((card) => card.x + card.width))) + 26 + lane / 2;
    const top = (vertical ? Math.min(from.y, to.y) : Math.min(...cards.map((card) => card.y))) - 24 - lane / 2;
    const mx = midpoint(start.x, end.x) + lane;
    const my = midpoint(start.y, end.y) + lane;
    const viaX = (x) => [start, { x, y: start.y }, { x, y: end.y }, end];
    const viaY = (y) => [start, { x: start.x, y }, { x: end.x, y }, end];
    // A line that leaves sideways turns in the gap beside the card, one that leaves up or down in the gap below.
    const sideways = back ? !vertical : Boolean(portVectors[fromSide][0]);
    const inner = sideways ? [viaX(mx), viaY(my)] : [viaY(my), viaX(mx)];
    const outer = vertical ? [viaX(right), viaY(top)] : [viaY(top), viaX(right)];
    const elbows = [viaX(start.x), viaY(start.y)];
    const straight = !back && (start.x === end.x || start.y === end.y) ? [[start, end]] : [];
    const passes = (points) => points.every((p, i) => !i || clear(points[i - 1], p));
    // A forward line goes around the whole drawing only when no pair of sides connects directly.
    const direct = (back ? [...outer, ...inner, ...elbows] : [...straight, ...inner, ...elbows]).find(passes);
    if (direct) return simplifyRoute([a, ...direct, b]);
    const detour = back ? undefined : outer.find(passes);
    if (detour) detours.push(simplifyRoute([a, ...detour, b]));
    candidates.push({ a, start, end, b });
  }
  if (detours.length) return detours[0];
  for (const { a, start, end, b } of candidates) {
    const points = gridRoute(start, end, obstacles, clear);
    if (points) return simplifyRoute([a, ...points, b]);
  }
}

export function roundedPath(points) {
  let path = 'M' + points[0].x + ',' + points[0].y;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const next = points[i + 1];
    if (!next) return path + ' L' + p.x + ',' + p.y;
    const previous = points[i - 1];
    const radius = Math.min(4, Math.hypot(p.x - previous.x, p.y - previous.y) / 2,
      Math.hypot(next.x - p.x, next.y - p.y) / 2);
    const round = (neighbor) => (p.x + Math.sign(neighbor.x - p.x) * radius) + ',' +
      (p.y + Math.sign(neighbor.y - p.y) * radius);
    path += ' L' + round(previous) + ' Q' + p.x + ',' + p.y + ' ' + round(next);
  }
  return path;
}

export function placeConnectionLabel(points, width, height, cards, occupied, bounds, vertical, separate = false) {
  const candidates = [];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = points.slice(i - 1, i + 1);
    const horizontal = a.y === b.y;
    const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (length < 8) continue;
    for (const fraction of [.5, .35, .65, .2, .8]) {
      for (const side of [-1, 1]) {
        const left = a.x + (b.x - a.x) * fraction + (horizontal ? -width / 2 : side > 0 ? 7 : -width - 7);
        const x = separate && vertical
          ? Math.max(bounds.x, Math.min(left, bounds.x + bounds.width - width)) : left;
        const y = a.y + (b.y - a.y) * fraction + (horizontal ? side > 0 ? 5 : -height - 5 : -height / 2);
        const label = { x, y, width, height };
        const collisions = cards.filter((card) => overlaps(card, label)).length * 10000 +
          occupied.filter((other) => overlaps(other, label)).length * 1000;
        const overflow = vertical ? Math.max(0, bounds.x - x, x + width - bounds.x - bounds.width) : 0;
        candidates.push({ ...label, collisions, score: length - collisions - overflow * 100 });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const fallback = candidates[0] ?? { x: points[0].x, y: points[0].y, width, height };
  if (!separate) return fallback;
  const clear = candidates.find(({ collisions }) => collisions === 0);
  if (clear) return clear;
  // Choose the nearest free slot above or below the preferred point if the route has no space.
  const obstacles = [...cards, ...occupied].filter(({ x, width }) =>
    x < fallback.x + fallback.width && x + width > fallback.x);
  const stops = obstacles.flatMap((box) => [box.y - height, box.y + box.height]);
  stops.sort((a, b) => Math.abs(a - fallback.y) - Math.abs(b - fallback.y));
  return { ...fallback, y: stops.find((y) => obstacles.every((box) => !overlaps({ ...fallback, y }, box))) ??
    fallback.y };
}
