const portVectors = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
const midpoint = (a, b) => (a + b) / 2;
const cornerRadius = 20;
const preferredLead = 28;

function port(card, side, offset, clearance) {
  const [x, y] = portVectors[side];
  const point = {
    x: card.x + card.width * (x + 1) / 2 + (y ? offset : 0),
    y: card.y + card.height * (y + 1) / 2 + (x ? offset : 0)
  };
  return [point, { x: point.x + x * clearance, y: point.y + y * clearance }];
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
    if ((earlier?.x === point.x && previous.x === point.x && (previous.y - earlier.y) * (point.y - previous.y) > 0) ||
        (earlier?.y === point.y && previous.y === point.y && (previous.x - earlier.x) * (point.x - previous.x) > 0)) {
      result.pop();
    }
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

function findRoute(from, to, cards, vertical, back, lane, clearance) {
  const obstacles = cards.map(({ x, y, width, height }) =>
    ({ x: x - clearance, y: y - clearance, width: width + 2 * clearance, height: height + 2 * clearance }));
  const clear = (a, b) => !obstacles.some((box) => segmentHitsBox(a, b, box));
  const forward = vertical ? ['bottom', 'top'] : ['right', 'left'];
  const returnSide = vertical ? 'right' : 'top';
  const preferred = back ? [returnSide, from === to ? forward[1] : returnSide] : forward;
  const sides = Object.keys(portVectors);
  const pairs = [preferred, ...sides.flatMap((a) => sides
    .filter((b) => (from !== to || a !== b) && (a !== preferred[0] || b !== preferred[1]))
    .map((b) => [a, b]))];
  const outside = Math.abs(lane) / 2 + 8;
  const left = Math.min(...obstacles.map((box) => box.x)) - outside;
  const right = Math.max(...obstacles.map((box) => box.x + box.width)) + outside;
  const top = Math.min(...obstacles.map((box) => box.y)) - outside;
  const bottom = Math.max(...obstacles.map((box) => box.y + box.height)) + outside;
  const entrances = [];
  let best;
  let bestScore = Infinity;
  for (const [fromSide, toSide] of pairs) {
    const [a, start] = port(from, fromSide, lane, clearance);
    const [b, end] = port(to, toSide, from === to ? -lane : lane, clearance);
    if (cards.some((card) => card !== from && segmentHitsBox(a, start, card)) ||
        cards.some((card) => card !== to && segmentHitsBox(end, b, card))) continue;
    const sideCost = (Number(fromSide !== preferred[0]) + Number(toSide !== preferred[1])) * (back ? 18 : 8);
    const minimum = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + sideCost;
    if (minimum >= bestScore) continue;
    entrances.push({ a, start, end, b, sideCost });
    const viaX = (x) => [start, { x, y: start.y }, { x, y: end.y }, end];
    const viaY = (y) => [start, { x: start.x, y }, { x: end.x, y }, end];
    const [fromX, fromY] = portVectors[fromSide];
    const [toX, toY] = portVectors[toSide];
    const xs = [midpoint(start.x, end.x) + lane, start.x, end.x,
      a.x + fromX * preferredLead, b.x + toX * preferredLead, left, right];
    const ys = [midpoint(start.y, end.y) + lane, start.y, end.y,
      a.y + fromY * preferredLead, b.y + toY * preferredLead, top, bottom];
    const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y);
    for (const card of obstacles) {
      if (minX < card.x + card.width && maxX > card.x) {
        ys.push(card.y, card.y + card.height);
      }
      if (minY < card.y + card.height && maxY > card.y) {
        xs.push(card.x, card.x + card.width);
      }
    }
    for (const route of [...new Set(xs)].map(viaX).concat([...new Set(ys)].map(viaY))) {
      if (!route.every((point, i) => i === 0 || clear(route[i - 1], point))) continue;
      const points = simplifyRoute([a, ...route, b]);
      const score = routeScore(points, sideCost);
      if (score < bestScore) {
        best = points;
        bestScore = score;
      }
    }
  }
  if (best) return best;
  for (const { a, start, end, b } of entrances) {
    const points = gridRoute(start, end, obstacles, clear);
    if (points) return simplifyRoute([a, ...points, b]);
  }
}

function routeScore(points, sideCost) {
  let score = sideCost + (points.length - 2) * 24;
  for (let i = 1; i < points.length; i++) {
    const length = Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
    score += length;
    // Tight passages remain usable, but a bend against a card loses to a little extra length.
    if (points.length > 2 && (i === 1 || i === points.length - 1)) {
      score += 4 * Math.max(0, preferredLead - length);
    }
  }
  return score;
}

export function routeConnection(from, to, cards, vertical, back, lane = 0) {
  return findRoute(from, to, cards, vertical, back, lane, 12) ??
    findRoute(from, to, cards, vertical, back, lane, 2);
}

export function roundedPath(points, cards) {
  let path = 'M' + points[0].x + ',' + points[0].y;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const next = points[i + 1];
    if (!next) return path + ' L' + p.x + ',' + p.y;
    const previous = points[i - 1];
    let radius = Math.min(cornerRadius, Math.hypot(p.x - previous.x, p.y - previous.y) / 2,
      Math.hypot(next.x - p.x, next.y - p.y) / 2);
    // The quadratic stays within 1/4 of its radius from at least one leg of the corner.
    // Reduce the radius where a tight route leaves less clearance than that.
    const legs = [previous, next].map(({ x, y }) => [Math.sign(x - p.x), Math.sign(y - p.y)]);
    const [dx, dy] = [legs[0][0] + legs[1][0], legs[0][1] + legs[1][1]];
    if (dx && dy) {
      for (const card of cards) {
        const nearX = dx > 0 ? card.x - p.x : p.x - card.x - card.width;
        const nearY = dy > 0 ? card.y - p.y : p.y - card.y - card.height;
        if (nearX >= radius || nearY >= radius || nearX + card.width <= 0 || nearY + card.height <= 0) continue;
        radius = Math.min(radius, Math.max(nearX, nearY, 4 * Math.min(nearX, nearY), 0));
      }
    }
    const round = (neighbor) => (p.x + Math.sign(neighbor.x - p.x) * radius) + ',' +
      (p.y + Math.sign(neighbor.y - p.y) * radius);
    path += ' L' + round(previous) + ' Q' + p.x + ',' + p.y + ' ' + round(next);
  }
  return path;
}

export function placeConnectionLabel(points, width, height, cards, occupied, bounds, vertical, separate = false,
  routes = [points]) {
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
        const crossesLine = routes.some((route) => route.some((point, j) =>
          j > 0 && segmentHitsBox(route[j - 1], point, label)));
        const overflow = vertical ? Math.max(0, bounds.x - x, x + width - bounds.x - bounds.width) : 0;
        candidates.push({ ...label, collisions, score: Math.min(length, 240) - collisions -
          (crossesLine ? 250 : 0) - overflow * 100 });
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
