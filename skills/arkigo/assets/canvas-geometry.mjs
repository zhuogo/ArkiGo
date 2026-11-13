export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const widthOf = (node) => node.width ?? 260;
export const heightOf = (node) => node.height ?? 154;

export function boundsOf(view) {
  const boxes = [...view.nodes.map((n) => ({ ...n, width: widthOf(n), height: heightOf(n) })), ...view.zones];
  const left = Math.min(0, ...boxes.map((b) => b.x - 32));
  const top = Math.min(0, ...boxes.map((b) => b.y - 32));
  return { x: left, y: top, width: Math.max(700, ...boxes.map((b) => b.x + b.width + 36)) - left,
    height: Math.max(430, ...boxes.map((b) => b.y + b.height + 36)) - top };
}

export function fitCamera(bounds, width, height, padding = 38) {
  const k = clamp(Math.min((width - padding * 2) / bounds.width, (height - padding * 2) / bounds.height, 1), 0.08, 2.5);
  return { k, x: (width - bounds.width * k) / 2 - bounds.x * k, y: (height - bounds.height * k) / 2 - bounds.y * k };
}

export function zoomCamera(camera, factor, point, { min = 0.08, max = 2.5 } = {}) {
  const k = clamp(camera.k * factor, min, max), ratio = k / camera.k;
  return { k, x: point.x - (point.x - camera.x) * ratio, y: point.y - (point.y - camera.y) * ratio };
}

export function segmentHitsBox(a, b, box) {
  const left = box.x, right = box.x + box.width, top = box.y, bottom = box.y + box.height;
  if (a.x === b.x) return a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom;
  if (a.y === b.y) return a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right;
  return true;
}

function simplify(points) {
  const output = [];
  for (const p of points) {
    if (output.length && p.x === output.at(-1).x && p.y === output.at(-1).y) continue;
    while (output.length > 1) {
      const a = output.at(-2), b = output.at(-1);
      if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) output.pop(); else break;
    }
    output.push(p);
  }
  return output;
}

function endpoint(node, side) {
  const w = widthOf(node), h = heightOf(node);
  return side === 'left' ? { x: node.x, y: node.y + h / 2 } : side === 'right' ? { x: node.x + w, y: node.y + h / 2 }
    : side === 'top' ? { x: node.x + w / 2, y: node.y } : { x: node.x + w / 2, y: node.y + h };
}

// Orthogonal A* on obstacle boundary coordinates; edge endpoints are authored or inferred.
export function routeEdge(edge, nodes) {
  const from = nodes.find((n) => n.id === edge.from), to = nodes.find((n) => n.id === edge.to);
  if (!from || !to) throw new Error('Missing edge endpoint');
  const dx = to.x + widthOf(to) / 2 - from.x - widthOf(from) / 2;
  const dy = to.y + heightOf(to) / 2 - from.y - heightOf(from) / 2;
  let fromSide = edge.fromSide, toSide = edge.toSide;
  if (from === to) { fromSide ??= 'right'; toSide ??= 'bottom'; }
  else if (Math.abs(dx) >= Math.abs(dy)) { fromSide ??= dx >= 0 ? 'right' : 'left'; toSide ??= dx >= 0 ? 'left' : 'right'; }
  else { fromSide ??= dy >= 0 ? 'bottom' : 'top'; toSide ??= dy >= 0 ? 'top' : 'bottom'; }
  const vectors = { left: [-1,0], right: [1,0], top: [0,-1], bottom: [0,1] };
  const a = endpoint(from, fromSide), b = endpoint(to, toSide), av = vectors[fromSide], bv = vectors[toSide];
  const start = { x: a.x + av[0] * 26, y: a.y + av[1] * 26 };
  const end = { x: b.x + bv[0] * 26, y: b.y + bv[1] * 26 };
  const boxes = nodes.map((n) => ({ x: n.x - 10, y: n.y - 10, width: widthOf(n) + 20, height: heightOf(n) + 20 }));
  const xs = [...new Set([start.x, end.x, ...boxes.flatMap((r) => [r.x - 16, r.x + r.width + 16])])].sort((x,y) => x-y);
  const ys = [...new Set([start.y, end.y, ...boxes.flatMap((r) => [r.y - 16, r.y + r.height + 16])])].sort((x,y) => x-y);
  const sx = xs.indexOf(start.x), sy = ys.indexOf(start.y), ex = xs.indexOf(end.x), ey = ys.indexOf(end.y);
  const heap = [], costs = new Map(), parents = new Map();
  const key = (x,y,d) => `${x},${y},${d}`;
  const push = (v) => { heap.push(v); let i = heap.length-1; while (i) { const p=(i-1)>>1; if(heap[p].f<=v.f)break;heap[i]=heap[p];i=p; } heap[i]=v; };
  const pop = () => { const top=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1].f<heap[j].f)j++;if(last.f<=heap[j].f)break;heap[i]=heap[j];i=j;}heap[i]=last;}return top; };
  const first = key(sx,sy,av[0]?0:1); costs.set(first,0);push({x:sx,y:sy,d:av[0]?0:1,k:first,g:0,f:0});let goal;
  while(heap.length) {
    const current=pop();if(current.g!==costs.get(current.k))continue;
    if(current.x===ex&&current.y===ey){goal=current.k;break;}
    for(const [mx,my] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx=current.x+mx,ny=current.y+my;if(nx<0||ny<0||nx>=xs.length||ny>=ys.length)continue;
      const p={x:xs[current.x],y:ys[current.y]},q={x:xs[nx],y:ys[ny]};
      if(boxes.some((box)=>segmentHitsBox(p,q,box)))continue;
      const d=mx?0:1,g=current.g+Math.abs(q.x-p.x)+Math.abs(q.y-p.y)+(current.d===d?0:28),k=key(nx,ny,d);
      if(g>=(costs.get(k)??Infinity))continue;costs.set(k,g);parents.set(k,current.k);
      push({x:nx,y:ny,d,k,g,f:g+Math.abs(q.x-end.x)+Math.abs(q.y-end.y)});
    }
  }
  if(!goal) {
    // Overlapping dragged nodes may trap a port. Keep a continuous orthogonal line, flagged for the UI.
    return { points: simplify([a,start,{x:start.x,y:end.y},end,b]), fallback: true };
  }
  const middle=[];for(let k=goal;k;k=parents.get(k)){const [x,y]=k.split(',').map(Number);middle.unshift({x:xs[x],y:ys[y]});}
  return { points: simplify([a,...middle,b]), fallback: false };
}

export function roundedPath(points) {
  let path = `M${points[0].x},${points[0].y}`;
  for(let i=1;i<points.length;i++) {
    const p=points[i];if(i===points.length-1){path+=` L${p.x},${p.y}`;continue;}
    const a=points[i-1],b=points[i+1],r=Math.min(10,Math.hypot(p.x-a.x,p.y-a.y)/2,Math.hypot(b.x-p.x,b.y-p.y)/2);
    path+=` L${p.x+Math.sign(a.x-p.x)*r},${p.y+Math.sign(a.y-p.y)*r} Q${p.x},${p.y} ${p.x+Math.sign(b.x-p.x)*r},${p.y+Math.sign(b.y-p.y)*r}`;
  }
  return path;
}

export function placeLabel(points, width, height, nodes, occupied=[]) {
  const candidates=[];
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],horizontal=a.y===b.y,length=Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
    if(length<24)continue;
    for(const fraction of [.5,.25,.75]) {
      const x=a.x+(b.x-a.x)*fraction-(horizontal?width/2:-10);
      const y=a.y+(b.y-a.y)*fraction-(horizontal?height+7:height/2);
      const box={x,y,width,height};
      const hit=(r)=>x<r.x+r.width+8&&x+width+8>r.x&&y<r.y+r.height+5&&y+height+5>r.y;
      const collisions=nodes.map((n)=>({...n,width:widthOf(n),height:heightOf(n)})).filter(hit).length*2+occupied.filter(hit).length;
      candidates.push({...box,score:length+(horizontal?80:0)-collisions*100000-(fraction===.5?0:8)});
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  return candidates[0]??{x:points[0].x,y:points[0].y-height-8,width,height};
}
