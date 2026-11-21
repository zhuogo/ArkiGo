const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const transform = ({ x, y, k }) => 'translate(' + x + 'px,' + y + 'px) scale(' + k + ')';

function createCamera(ctx) {
  const viewport = byId('viewport');
  const world = byId('world');
  const touches = new Map();
  const dimensions = () => ({ width: viewport.clientWidth, height: viewport.clientHeight });
  let value = { x: 0, y: 0, k: 1 };
  let home = 1;
  let scene = null;
  let gesture = null;
  let pinch;
  let cancelTransition;
  let suppressed = 0;
  let locked = 0;
  let wheeling = { last: 0 };
  let wheelUsed = false;
  let drawFrame = 0;
  let edgeScale = 1;
  let preservingCamera = false;

  const worldPoint = (event) => {
    const rect = viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const center = (card) => ({ x: card.x + card.width / 2, y: card.y + card.height / 2 });
  const screen = ({ x, y }) => ({ x: x * value.k + value.x, y: y * value.k + value.y });

  function apply() {
    world.style.transform = transform(value);
    byId('scale').textContent = Math.round(value.k * 100) + '%';
    if (largeTargets.matches && edgeScale !== value.k) {
      edgeScale = value.k;
      requestEdges();
    }
  }

  // The whole map. With `readable` a map too large for that opens at a size its cards can still be read at,
  // from its top; the fit control then shows all of it.
  function fit(readable = false) {
    const { width, height } = dimensions();
    const box = scene?.bounds;
    if (!box?.width) return { x: 0, y: 0, k: 1 };
    const vertical = scene.direction === 'vertical';
    const pad = vertical ? 18 : 28;
    const ratio = Math.min((width - 2 * pad) / box.width, (height - 2 * pad) / box.height, 1);
    const k = vertical ? 1 : clamp(ratio, readable ? .7 : .14, 1);
    return {
      k,
      x: Math.max(pad, (width - box.width * k) / 2) - box.x * k,
      y: (vertical ? 15 : Math.max(pad, (height - box.height * k) / 2)) - box.y * k
    };
  }

  function setScene(next, previous) {
    scene = next;
    edgeScale = 1;
    const initial = fit(true);
    home = initial.k;
    const size = dimensions();
    value = previous ? {
      k: previous.k, x: previous.x + (size.width - previous.width) / 2,
      y: previous.y + (size.height - previous.height) / 2
    } : initial;
    apply();
  }

  function reveal(card, centered = false) {
    if (!card) return;
    const { width, height } = dimensions();
    const p = screen(center(card));
    const horizontal = Math.min(card.width * value.k / 2 + 12, width / 2);
    const vertical = Math.min(card.height * value.k / 2 + 12, height / 2);
    value.x += (centered ? width / 2 : clamp(p.x, horizontal, width - horizontal)) - p.x;
    value.y += (centered ? height / 2 : clamp(p.y, vertical, height - vertical)) - p.y;
    apply();
  }

  function focusWithoutMoving(element) {
    preservingCamera = true;
    element.focus({ preventScroll: true });
    preservingCamera = false;
  }

  function revealFocusedCard(card) {
    if (!preservingCamera) reveal(card);
  }

  function stopTransition() {
    cancelTransition?.();
  }

  function snapshot() {
    stopTransition();
    if (reducedMotion.matches || document.documentElement.dataset.input === 'keyboard' || !scene?.cards.length) {
      return null;
    }
    const clone = world.cloneNode(true);
    clone.removeAttribute('id');
    clone.classList.add('scene-ghost');
    for (const child of clone.querySelectorAll('[id]')) child.removeAttribute('id');
    clone.setAttribute('aria-hidden', 'true');
    clone.inert = true;
    return clone;
  }

  function animateLevel(clone, oldScene, owner, parent, entering) {
    locked = performance.now() + 260;
    if (!clone || !owner || !scene?.cards.length) return;
    const box = entering ? scene.bounds : oldScene.bounds;
    const k = parent.k * Math.min((owner.width - 12) / box.width, (owner.height - 12) / box.height);
    const inside = {
      k,
      x: parent.x + center(owner).x * parent.k - (box.x + box.width / 2) * k,
      y: parent.y + center(owner).y * parent.k - (box.y + box.height / 2) * k
    };
    viewport.append(clone);
    const timing = { duration: 230, easing: 'cubic-bezier(.23,1,.32,1)', fill: 'both' };
    const animations = entering
      ? [world.animate([{ transform: transform(inside), opacity: .15 }, { opacity: 1 }], timing),
        clone.animate([{ opacity: 1 }, { opacity: 0 }], timing)]
      : [clone.animate([{ opacity: 1 }, { transform: transform(inside), opacity: 0 }], timing),
        world.animate([{ opacity: .18 }, { opacity: 1 }], timing)];
    const done = () => {
      if (cancelTransition !== done) return;
      cancelTransition = null;
      clone.remove();
      for (const animation of animations) animation.cancel();
    };
    cancelTransition = done;
    Promise.allSettled(animations.map((animation) => animation.finished)).then(done);
  }

  function zoom(factor, anchor, beforeGesture) {
    if (!scene || cancelTransition || gesture?.card) return false;
    const selected = scene.cardsByAddress.get(ctx.selection());
    const { width, height } = dimensions();
    const before = save();
    const point = anchor ?? (selected && factor > 1 ? screen(center(selected.card)) : { x: width / 2, y: height / 2 });
    const k = clamp(value.k * factor, .14, 12);
    const ratio = k / value.k;
    value = { k, x: point.x - (point.x - value.x) * ratio, y: point.y - (point.y - value.y) * ratio };
    if (!anchor && selected && factor > 1) reveal(selected.card);
    else apply();
    if (performance.now() < locked) return false;
    if (factor < 1 && k <= home * .62) return ctx.back(true);
    if (!selected || factor <= 1 || !ctx.canEnter(ctx.selection())) return false;
    const card = selected.card;
    const a = screen(card);
    const b = screen({ x: card.x + card.width, y: card.y + card.height });
    const w = b.x - a.x;
    const h = b.y - a.y;
    const visible = Math.max(0, Math.min(width, b.x) - Math.max(0, a.x)) *
      Math.max(0, Math.min(height, b.y) - Math.max(0, a.y));
    if (Math.max(w / width, h / height) < .58 || visible / (w * h) < .8) return false;
    if (anchor && (point.x < a.x - 32 || point.x > b.x + 32 || point.y < a.y - 32 || point.y > b.y + 32)) return false;
    ctx.enter(ctx.selection(), beforeGesture ?? before);
    return true;
  }

  function save() {
    return { ...value, ...dimensions() };
  }

  function requestEdges() {
    if (drawFrame) return;
    drawFrame = requestAnimationFrame(() => {
      drawFrame = 0;
      scene?.drawEdges(value.k);
    });
  }

  function abortGesture() {
    if (gesture?.card) {
      Object.assign(gesture.card, { x: gesture.x, y: gesture.y });
      cssBox(gesture.element, gesture.card);
      gesture.element.classList.remove('dragging');
      requestEdges();
    }
    gesture = null;
    viewport.classList.remove('panning');
  }

  function pinchGeometry() {
    const [a, b] = [...touches.values()];
    return { x: midpoint(a.x, b.x), y: midpoint(a.y, b.y), distance: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  for (const name of ['selectstart', 'dragstart']) {
    viewport.addEventListener(name, (event) => {
      if (event.target.closest('#world')) event.preventDefault();
    });
  }
  viewport.addEventListener('pointerdown', (event) => {
    if (!scene || event.button !== 0 || event.target.closest('.edge-label, #view-content')) return;
    stopTransition();
    const point = worldPoint(event);
    if (event.pointerType === 'touch') {
      touches.set(event.pointerId, point);
      if (touches.size >= 2) {
        abortGesture();
        if (touches.size === 2) pinch = { ...pinchGeometry(), before: save() };
        viewport.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
    }
    if (gesture) return;
    const element = event.target.closest('.graph-card');
    const record = element && scene.cardsByAddress.get(element.dataset.id);
    if (element && !scene.draggable && event.pointerType !== 'touch') return;
    const card = scene.draggable ? record?.card : null;
    focusWithoutMoving(element ?? viewport);
    (element ?? viewport).setPointerCapture(event.pointerId);
    if (event.pointerType === 'mouse') event.preventDefault();
    gesture = { pointer: event.pointerId, point, card, element, x: card?.x ?? value.x, y: card?.y ?? value.y };
  });

  viewport.addEventListener('pointermove', (event) => {
    const point = worldPoint(event);
    if (touches.has(event.pointerId)) touches.set(event.pointerId, point);
    if (pinch) {
      if (touches.size !== 2 || pinch.used) return;
      const next = pinchGeometry();
      if (pinch.distance > 0 && next.distance > 0) {
        const used = zoom(next.distance / pinch.distance, pinch, pinch.before);
        if (!used) {
          value.x += next.x - pinch.x;
          value.y += next.y - pinch.y;
          apply();
        }
        pinch = { ...next, before: pinch.before, used };
      }
      return;
    }
    if (gesture?.pointer !== event.pointerId) return;
    const dx = point.x - gesture.point.x;
    const dy = point.y - gesture.point.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 5) return;
    gesture.moved = true;
    if (gesture.card) {
      const { card, element } = gesture;
      card.x = Math.round(gesture.x + dx / value.k);
      card.y = Math.round(gesture.y + dy / value.k);
      if (scene.direction === 'vertical') card.x = clamp(card.x, 0, Math.max(0, ctx.availableWidth - card.width - 16));
      cssBox(element, card);
      element.classList.add('dragging');
      requestEdges();
    } else {
      value.x = gesture.x + dx;
      value.y = gesture.y + dy;
      viewport.classList.add('panning');
      apply();
    }
  });

  function endPointer(event) {
    touches.delete(event.pointerId);
    if (pinch) {
      if (touches.size === 0) pinch = null;
      suppressed = performance.now() + 250;
      return;
    }
    if (gesture?.pointer !== event.pointerId) return;
    const current = gesture;
    if (current.moved) suppressed = performance.now() + 250;
    if (event.type !== 'pointerup' || current.card && current.moved &&
        scene.cards.some((card) => card !== current.card && overlaps(card, current.card))) {
      if (event.type === 'pointerup') announce('位置与其他卡片重叠，已恢复');
      abortGesture();
      return;
    }
    gesture = null;
    viewport.classList.remove('panning');
    if (current.card && current.moved) ctx.move(current.card);
  }
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    viewport.addEventListener(name, endPointer);
  }
  viewport.addEventListener('wheel', (event) => {
    if (!scene) return;
    event.preventDefault();
    const now = performance.now();
    if (now - wheeling.last > 200) {
      wheelUsed = false;
      wheeling.before = save();
    }
    wheeling.last = now;
    if (wheelUsed) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
    if (delta) {
      wheelUsed = zoom(Math.exp(-clamp(delta, -120, 120) * .0025), worldPoint(event), wheeling.before);
    }
  }, { passive: false });

  const reset = () => {
    stopTransition();
    value = fit();
    home = value.k;
    apply();
  };
  viewport.addEventListener('keydown', (event) => {
    if (event.target !== viewport || !scene || event.altKey) return;
    const delta = { ArrowRight: [-48, 0], ArrowLeft: [48, 0], ArrowUp: [0, 48], ArrowDown: [0, -48] }[event.key];
    if (delta) {
      value.x += delta[0];
      value.y += delta[1];
      apply();
    } else if (event.key === '=' || event.key === '+') zoom(1.2);
    else if (event.key === '-') zoom(1 / 1.2);
    else if (event.key === '0') reset();
    else if (event.key === 'Enter' && ctx.canEnter(ctx.selection())) ctx.enter(ctx.selection());
    else return;
    event.preventDefault();
  });
  return {
    setScene, save, reveal, revealFocusedCard, focusWithoutMoving, snapshot, animateLevel, stopTransition, reset, zoom,
    transitioning: () => Boolean(cancelTransition),
    consumeClick: (event) => event.detail > 0 && performance.now() < suppressed,
    abortGesture
  };
}
