const ZONE_TOP = 38;
const ZONE_GAP = 34;
const WIDE_GAP = 88;
const CARD_GAP = 32;
const ZONE_PAD = 16;

export function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function layoutBounds(boxes) {
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x, y, width: right - x, height: bottom - y };
}

// Remove DFS back edges before ranking so a retry never pulls later steps ahead of the start.
function rankGraph(ids, edges) {
  const outgoing = new Map(ids.map((id) => [id, []]));
  const ranks = new Map(ids.map((id) => [id, 0]));
  const visited = new Set();
  const active = new Set();
  const back = new Set();
  const ordered = [];
  for (const edge of edges) outgoing.get(edge.from)?.push(edge);
  for (const id of ids) {
    if (visited.has(id)) continue;
    const stack = [{ id, next: 0 }];
    visited.add(id);
    active.add(id);
    while (stack.length) {
      const frame = stack.at(-1);
      const edge = outgoing.get(frame.id)[frame.next++];
      if (!edge) {
        ordered.push(frame.id);
        active.delete(frame.id);
        stack.pop();
      } else if (active.has(edge.to)) {
        back.add(edge);
      } else if (!visited.has(edge.to) && outgoing.has(edge.to)) {
        visited.add(edge.to);
        active.add(edge.to);
        stack.push({ id: edge.to, next: 0 });
      }
    }
  }
  for (const id of ordered.reverse()) {
    for (const edge of outgoing.get(id)) {
      if (!back.has(edge) && ranks.has(edge.to)) ranks.set(edge.to, Math.max(ranks.get(edge.to), ranks.get(id) + 1));
    }
  }
  return { ranks, back };
}

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function zoneFor(group, cards, padding = ZONE_PAD, heading = ZONE_TOP) {
  const box = layoutBounds(cards);
  return {
    group, x: box.x - padding, y: box.y - heading,
    width: box.width + padding * 2, height: box.height + heading + padding
  };
}

// Vertical reading: one column, ranks top to bottom, adjacent ranks of one group share a partition.
function columnSlots(cards, height) {
  const slots = [];
  let y = ZONE_TOP;
  const bands = [];
  for (const rank of groupBy(cards, (card) => card.rank).values()) {
    for (const [group, items] of groupBy(rank, (card) => card.group)) {
      if (bands.at(-1)?.[0] === group) bands.at(-1)[1].push(...items);
      else bands.push([group, items]);
    }
  }
  for (const [band, [group, items]] of bands.entries()) {
    const positions = items.map((card, i) => ({ ...card, x: ZONE_PAD, y: y + i * (height + 70), band }));
    const zone = zoneFor(group, positions);
    slots.push(...positions);
    y = zone.y + zone.height + ZONE_GAP + ZONE_TOP;
  }
  return slots;
}

// Horizontal reading: every group is a partition, partitions follow each other left to right and move to a new
// line when the next one would not fit, so the whole map can be read at full size.
function flowSlots(cards, width, height, availableWidth) {
  const step = width + WIDE_GAP;
  const zoneGap = WIDE_GAP - ZONE_PAD * 2;
  const most = Math.max(1, Math.floor((availableWidth - ZONE_PAD * 2 + WIDE_GAP) / step));
  const slots = [];
  let x = 0;
  let y = 0;
  let lineHeight = 0;
  for (const [band, [group, items]] of [...groupBy(cards, (card) => card.group)].entries()) {
    const ranks = [...groupBy(items, (card) => card.rank).values()];
    // Cards with no order among them read better side by side than as one tall column.
    const columns = ranks.length === 1 && items.length > 2
      ? Array.from({ length: Math.ceil(items.length / most) }, (_, row) => items.slice(row * most, (row + 1) * most))
        .flatMap((row) => row.map((card) => [card]))
      : ranks;
    const rows = [];
    for (let first = 0; first < columns.length; first += most) rows.push(columns.slice(first, first + most));
    const placed = [];
    let top = ZONE_TOP;
    for (const row of rows) {
      for (const [column, members] of row.entries()) {
        for (const [i, card] of members.entries()) {
          placed.push({ ...card, x: ZONE_PAD + column * step, y: top + i * (height + CARD_GAP), band });
        }
      }
      top += Math.max(...row.map((members) => members.length)) * (height + CARD_GAP) + CARD_GAP;
    }
    const zone = zoneFor(group, placed);
    if (x > 0 && x + zone.width > availableWidth) {
      x = 0;
      y += lineHeight + zoneGap;
      lineHeight = 0;
    }
    for (const card of placed) slots.push({ ...card, x: card.x + x, y: card.y + y });
    x += zone.width + zoneGap;
    lineHeight = Math.max(lineHeight, zone.height);
  }
  return slots;
}

function preservePositions(slots, positions, vertical) {
  const fixed = [];
  const automatic = [];
  for (const slot of slots) {
    const point = Object.hasOwn(positions, slot.id) ? positions[slot.id] : undefined;
    if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) {
      fixed.push({ ...slot, x: point.x, y: point.y, fixed: true });
    } else automatic.push(slot);
  }
  const placed = [...fixed];
  for (const slot of automatic) {
    const card = { ...slot };
    const laterThan = placed.filter((other) => other.rank < card.rank);
    if (vertical && laterThan.length) {
      card.y = Math.max(card.y, ...laterThan.map((other) => other.y + other.height + CARD_GAP));
    }
    let hit;
    while ((hit = placed.find((other) => overlaps(card, other)))) card.y = hit.y + hit.height + CARD_GAP;
    placed.push(card);
  }
  const byId = new Map(placed.map((card) => [card.id, card]));
  return slots.map((card) => byId.get(card.id));
}

export function layoutMap(items, edges, {
  direction = 'horizontal', availableWidth = direction === 'vertical' ? 390 : 1280, positions = {}
} = {}) {
  const vertical = direction === 'vertical';
  const width = vertical ? Math.min(260, Math.max(1, availableWidth - ZONE_PAD * 2)) : 264;
  const height = 136;
  // Only the lines drawn by default decide the order, so a seldom used relation cannot stretch the map.
  const { ranks, back } = rankGraph(items.map((item) => item.id), edges.filter((edge) => edge.main !== false));
  const cards = items.map((item) => ({
    id: item.id, group: item.group ?? item.type, width, height, rank: ranks.get(item.id)
  })).sort((a, b) => a.rank - b.rank);
  const slots = vertical ? columnSlots(cards, height) : flowSlots(cards, width, height, availableWidth);
  const placed = preservePositions(slots, positions, vertical);
  let zones = [...groupBy(placed, (card) => card.band).values()].map((band) => zoneFor(band[0].group, band));
  // A fixed position can interleave groups. Split the affected partitions around their cards.
  const split = zones.map((zone) => zones.some((other) => zone !== other && overlaps(zone, other)));
  if (split.some(Boolean)) {
    zones = zones.flatMap((zone, i) => split[i]
      ? placed.filter((card) => card.band === i).map((card) => zoneFor(card.group, [card], 0, 0))
      : [zone]);
  }
  return {
    direction, cards: placed, zones, bounds: layoutBounds(zones),
    edges: edges.map((edge) => ({ ...edge, back: back.has(edge) }))
  };
}

export function layoutFlow(body, { direction = 'horizontal', availableWidth = 390 } = {}) {
  const vertical = direction === 'vertical';
  const width = vertical ? Math.min(246, Math.max(1, availableWidth - 96)) : 212;
  const height = 126;
  const ids = [body.start, ...body.steps.map((step) => step.id).filter((id) => id !== body.start)];
  const transitions = body.transitions ?? [];
  const { ranks, back } = rankGraph(ids, transitions);
  const layers = [...groupBy(body.steps, (step) => ranks.get(step.id))].sort(([a], [b]) => a - b);
  const crossSize = Math.max(1, ...layers.map(([, layer]) => layer.length));
  const cards = [];
  for (const [rank, layer] of layers) {
    for (const [index, step] of layer.entries()) {
      const row = index + (crossSize - layer.length) / 2;
      cards.push({
        id: step.id, rank, width, height,
        x: vertical ? 48 : rank * (width + 100),
        y: vertical ? cards.length * (height + 122) : row * (height + 52)
      });
    }
  }
  return {
    direction, cards, zones: [], bounds: layoutBounds(cards),
    edges: transitions.map((edge, index) => ({ ...edge, id: index, back: back.has(edge) }))
  };
}
