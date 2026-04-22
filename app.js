/* ===== CallFlow App ===== */
'use strict';

// ─── State ──────────────────────────────────────────────────────────────────
const state = {
  nodes: [],        // { id, type:'fn'|'cond', x, y, name, params, returnType, returnExample, branches, color, notes }
  edges: [],        // { id, from, to, type:'call'|'return'|'param'|'cond', dtype, example, label, color }
  selectedNodes: new Set(),
  selectedEdge: null,
  tool: 'select',   // 'select' | 'fn' | 'cond' | 'connect'
  zoom: 1,
  pan: { x: 0, y: 0 },
  nextId: 1,
};

// ─── DOM refs ────────────────────────────────────────────────────────────────
const svg         = document.getElementById('svg-canvas');
const nodesGroup  = document.getElementById('nodes-group');
const edgesGroup  = document.getElementById('edges-group');
const dragEdge    = document.getElementById('drag-edge');
const canvasWrap  = document.getElementById('canvas-wrap');
const minimap     = document.getElementById('minimap');
const mmCtx       = minimap.getContext('2d');
const statusMsg   = document.getElementById('status-msg');
const zoomLabel   = document.getElementById('zoom-label');

// Modals
const modalNode     = document.getElementById('modal-node');
const modalEdge     = document.getElementById('modal-edge');
const modalConfirm  = document.getElementById('modal-confirm');
const edgeTooltip   = document.getElementById('edge-tooltip');

// ─── Color palettes ──────────────────────────────────────────────────────────
const NODE_COLORS = [
  { label: 'Navy',     fill: '#1a3a5c', border: '#3a8fff' },
  { label: 'Purple',   fill: '#2d1f4a', border: '#9b6fff' },
  { label: 'Green',    fill: '#1a3d2e', border: '#4de8b2' },
  { label: 'Red',      fill: '#3d1a1a', border: '#ff6b6b' },
  { label: 'Amber',    fill: '#3d3519', border: '#f7d96f' },
  { label: 'Teal',     fill: '#1a2d3d', border: '#4dc8e8' },
  { label: 'Indigo',   fill: '#1f1f3d', border: '#7c6ff7' },
  { label: 'Forest',   fill: '#1f2e20', border: '#78c96b' },
];
const EDGE_COLORS = [
  { label: 'Teal',   val: '#4de8b2' },
  { label: 'Orange', val: '#ff8f4d' },
  { label: 'Purple', val: '#7c6ff7' },
  { label: 'Yellow', val: '#f7d96f' },
  { label: 'Pink',   val: '#f76fd9' },
  { label: 'Red',    val: '#ff5a5a' },
  { label: 'Blue',   val: '#4dc8e8' },
  { label: 'Green',  val: '#78c96b' },
];

// ─── Utility ─────────────────────────────────────────────────────────────────
const uid = () => `n${state.nextId++}`;

function svgPt(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  return {
    x: (clientX - rect.left - state.pan.x) / state.zoom,
    y: (clientY - rect.top  - state.pan.y) / state.zoom,
  };
}

function applyTransform() {
  nodesGroup.setAttribute('transform', `translate(${state.pan.x},${state.pan.y}) scale(${state.zoom})`);
  edgesGroup.setAttribute('transform', `translate(${state.pan.x},${state.pan.y}) scale(${state.zoom})`);
  zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  drawMinimap();
}

function showStatus(msg, ms = 2000) {
  statusMsg.textContent = msg;
  statusMsg.classList.add('visible');
  clearTimeout(showStatus._t);
  showStatus._t = setTimeout(() => statusMsg.classList.remove('visible'), ms);
}

function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll('.tool-btn[id^="btn-"]').forEach(b => b.classList.remove('active'));
  const map = { select: 'btn-select', fn: 'btn-add-fn', cond: 'btn-add-cond', connect: 'btn-connect' };
  if (map[tool]) document.getElementById(map[tool])?.classList.add('active');
  canvasWrap.className = '';
  if (tool === 'connect') canvasWrap.classList.add('tool-connect');
}

// ─── Node geometry ────────────────────────────────────────────────────────────
const FN_R   = 44;   // function node radius
const COND_H = 44;   // half-size of diamond

function nodeCenter(node) { return { x: node.x, y: node.y }; }

function nodeBorderPoint(node, tx, ty) {
  const dx = tx - node.x, dy = ty - node.y;
  const len = Math.sqrt(dx*dx + dy*dy) || 1;
  if (node.type === 'fn') {
    const r = FN_R + 2;
    return { x: node.x + dx/len*r, y: node.y + dy/len*r };
  } else {
    // diamond: find intersection with rhombus
    const h = COND_H + 2;
    const t1 = h / (Math.abs(dx) + Math.abs(dy) || 1);
    return { x: node.x + dx*t1, y: node.y + dy*t1 };
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  renderEdges();
  renderNodes();
  drawMinimap();
}

function getNodeColor(node) {
  if (node.color) {
    const preset = NODE_COLORS.find(c => c.fill === node.color);
    return preset || { fill: node.color, border: '#888' };
  }
  return node.type === 'fn'
    ? { fill: '#1a3a5c', border: '#3a8fff' }
    : { fill: '#2d1f4a', border: '#9b6fff' };
}

function renderNodes() {
  // Remove stale
  const existingIds = new Set(nodesGroup.querySelectorAll('[data-node-id]') ? [...nodesGroup.querySelectorAll('[data-node-id]')].map(e => e.dataset.nodeId) : []);
  const currentIds  = new Set(state.nodes.map(n => n.id));
  existingIds.forEach(id => { if (!currentIds.has(id)) nodesGroup.querySelector(`[data-node-id="${id}"]`)?.remove(); });

  state.nodes.forEach(node => {
    let g = nodesGroup.querySelector(`[data-node-id="${node.id}"]`);
    const isNew = !g;
    if (isNew) {
      g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('data-node-id', node.id);
      g.classList.add('node');
      nodesGroup.appendChild(g);
      attachNodeEvents(g, node);
    }

    g.innerHTML = '';
    const col = getNodeColor(node);
    const sel  = state.selectedNodes.has(node.id);

    if (node.type === 'fn') {
      renderFnNode(g, node, col, sel);
    } else {
      renderCondNode(g, node, col, sel);
    }

    // port indicators
    renderPorts(g, node);

    if (sel) g.classList.add('selected'); else g.classList.remove('selected');
  });
}

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k, v));
  return el;
}
function svgText(t, attrs) {
  const el = svgEl('text', attrs);
  el.textContent = t;
  return el;
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max-1)+'…' : str;
}

function renderFnNode(g, node, col, sel) {
  // Shadow circle
  g.appendChild(svgEl('circle', { cx: node.x, cy: node.y, r: FN_R+2, fill: 'rgba(0,0,0,0.3)', 'class': 'node-shadow' }));
  // Body
  const c = svgEl('circle', { cx: node.x, cy: node.y, r: FN_R, fill: col.fill, stroke: col.border, 'stroke-width': sel?2.5:1.5, 'class': 'node-body node-border' });
  if (sel) c.setAttribute('filter', 'url(#glow)');
  g.appendChild(c);

  // Icon ring
  g.appendChild(svgEl('circle', { cx: node.x, cy: node.y, r: FN_R-6, fill: 'none', stroke: col.border, 'stroke-width': 0.5, opacity: 0.3 }));

  // fn() symbol
  const sym = svgEl('text', { x: node.x, y: node.y - 8, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: col.border, 'font-family': "'Martian Mono',monospace", 'font-size': '11', opacity: 0.7 });
  sym.textContent = 'fn()';
  g.appendChild(sym);

  // Name
  g.appendChild(svgText(truncate(node.name || 'function', 14), { x: node.x, y: node.y+7, 'class': 'node-label', fill: 'var(--text)' }));

  // Return badge
  if (node.returnType) {
    const badge = svgEl('g', {});
    const bx = node.x, by = node.y + FN_R + 12;
    badge.appendChild(svgEl('rect', { x: bx-24, y: by-8, width: 48, height: 16, rx: 8, fill: 'rgba(255,143,77,0.2)', stroke: 'var(--edge-return)', 'stroke-width': 0.8 }));
    badge.appendChild(svgText(truncate(node.returnType, 8), { x: bx, y: by+1, 'class': 'node-sublabel', fill: 'var(--edge-return)' }));
    g.appendChild(badge);
  }

  // Param count badge
  if (node.params && node.params.length > 0) {
    const bx = node.x - FN_R - 2, by = node.y - FN_R + 2;
    g.appendChild(svgEl('circle', { cx: bx, cy: by, r: 9, fill: 'rgba(124,111,247,0.25)', stroke: 'var(--edge-param)', 'stroke-width': 0.8 }));
    g.appendChild(svgText(node.params.length, { x: bx, y: by+1, 'class': 'node-sublabel', fill: 'var(--edge-param)', 'font-size': 9 }));
  }
}

function renderCondNode(g, node, col, sel) {
  const h = COND_H;
  const pts = `${node.x},${node.y-h} ${node.x+h},${node.y} ${node.x},${node.y+h} ${node.x-h},${node.y}`;

  // Shadow
  g.appendChild(svgEl('polygon', { points: pts, fill: 'rgba(0,0,0,0.35)', transform: 'translate(2,3)' }));
  // Body
  const poly = svgEl('polygon', { points: pts, fill: col.fill, stroke: col.border, 'stroke-width': sel?2.5:1.5, 'class': 'node-body node-border' });
  if (sel) poly.setAttribute('filter', 'url(#glow)');
  g.appendChild(poly);

  // if symbol
  g.appendChild(svgText('if', { x: node.x, y: node.y - 10, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: col.border, 'font-family': "'Martian Mono',monospace", 'font-size': '11', opacity: 0.7 }));

  // Name
  g.appendChild(svgText(truncate(node.name || 'condition', 12), { x: node.x, y: node.y+6, 'class': 'node-label', fill: 'var(--text)' }));

  // Branch count
  if (node.branches && node.branches.length > 0) {
    const bx = node.x + h + 2, by = node.y - h + 2;
    g.appendChild(svgEl('circle', { cx: bx, cy: by, r: 9, fill: 'rgba(247,217,111,0.25)', stroke: 'var(--edge-cond)', 'stroke-width': 0.8 }));
    g.appendChild(svgText(node.branches.length, { x: bx, y: by+1, 'class': 'node-sublabel', fill: 'var(--edge-cond)', 'font-size': 9 }));
  }
}

function renderPorts(g, node) {
  const r = node.type === 'fn' ? FN_R : COND_H;
  const ports = [
    { id: 'top',    dx:  0, dy: -1, role: 'io' },
    { id: 'bottom', dx:  0, dy:  1, role: 'io' },
    { id: 'left',   dx: -1, dy:  0, role: 'in' },
    { id: 'right',  dx:  1, dy:  0, role: 'out' },
  ];
  ports.forEach(p => {
    const px = node.x + p.dx * (r + 2);
    const py = node.y + p.dy * (r + 2);
    const pt = svgEl('circle', { cx: px, cy: py, r: 4, 'class': `port port-${p.role}`, 'data-port': p.id, 'data-node-id': node.id });
    g.appendChild(pt);
    pt.addEventListener('mousedown', e => { e.stopPropagation(); startEdgeDrag(e, node, px, py); });
  });
}

// ─── Edge rendering ───────────────────────────────────────────────────────────

function getEdgeColor(edge) {
  if (edge.color) return edge.color;
  return { call: 'var(--edge-default)', return: 'var(--edge-return)', param: 'var(--edge-param)', cond: 'var(--edge-cond)' }[edge.type] || 'var(--edge-default)';
}

function getMarkerId(edge) {
  if (edge.color) return 'arrow-default';
  return { call: 'arrow-default', return: 'arrow-return', param: 'arrow-param', cond: 'arrow-cond' }[edge.type] || 'arrow-default';
}

function cubicPath(x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1) * 0.55;
  const dy = Math.abs(y2 - y1) * 0.55;
  const cx = Math.max(dx, 40);
  const cy = Math.max(dy, 40);
  return `M${x1},${y1} C${x1+cx},${y1} ${x2-cx},${y2} ${x2},${y2}`;
}

function renderEdges() {
  const existingIds = new Set([...edgesGroup.querySelectorAll('[data-edge-id]')].map(e => e.dataset.edgeId));
  const currentIds  = new Set(state.edges.map(e => e.id));
  existingIds.forEach(id => { if (!currentIds.has(id)) edgesGroup.querySelector(`[data-edge-id="${id}"]`)?.remove(); });

  state.edges.forEach(edge => {
    const fromNode = state.nodes.find(n => n.id === edge.from);
    const toNode   = state.nodes.find(n => n.id === edge.to);
    if (!fromNode || !toNode) return;

    let g = edgesGroup.querySelector(`[data-edge-id="${edge.id}"]`);
    const isNew = !g;
    if (isNew) {
      g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('data-edge-id', edge.id);
      edgesGroup.appendChild(g);
      attachEdgeEvents(g, edge);
    }

    g.innerHTML = '';

    const fp = nodeBorderPoint(fromNode, toNode.x, toNode.y);
    const tp = nodeBorderPoint(toNode,   fromNode.x, fromNode.y);
    const d  = cubicPath(fp.x, fp.y, tp.x, tp.y);
    const col = getEdgeColor(edge);
    const mId = edge.color ? 'arrow-default' : getMarkerId(edge);

    // Invisible hit area
    const hit = svgEl('path', { d, 'class': 'edge-hit' });
    g.appendChild(hit);

    // Visible path
    const path = svgEl('path', { d, 'class': `edge type-${edge.type}`, stroke: col, 'stroke-dasharray': edge.type==='return'?'7 3':undefined });
    if (edge.type === 'return') path.setAttribute('stroke-dasharray', '7 3');
    else path.removeAttribute('stroke-dasharray');
    path.setAttribute('marker-end', `url(#arrow-default)`);
    path.style.stroke = col;
    if (state.selectedEdge === edge.id) {
      path.classList.add('selected');
      path.setAttribute('filter', 'url(#glow)');
    }
    g.appendChild(path);

    // Blips
    if (fromNode.type === 'fn' && fromNode.params && fromNode.params.length > 0) {
      renderBlip(g, fp.x + (tp.x - fp.x) * 0.2, fp.y + (tp.y - fp.y) * 0.2, 'var(--edge-param)');
    }
    if (fromNode.type === 'fn' && fromNode.returnType) {
      renderBlip(g, fp.x + (tp.x - fp.x) * 0.8, fp.y + (tp.y - fp.y) * 0.8, 'var(--edge-return)');
    }

    // Label
    if (edge.label) {
      const mx = (fp.x + tp.x) / 2, my = (fp.y + tp.y) / 2 - 12;
      const lw = edge.label.length * 6.5 + 10;
      g.appendChild(svgEl('rect', { x: mx - lw/2, y: my - 9, width: lw, height: 16, rx: 3, 'class': 'edge-label-bg' }));
      g.appendChild(svgText(edge.label, { x: mx, y: my+1, 'class': 'edge-label' }));
    }
  });
}

function renderBlip(parent, x, y, fill) {
  parent.appendChild(svgEl('circle', { cx: x, cy: y, r: 4, fill, opacity: 0.9, 'pointer-events': 'none' }));
}

// ─── Interaction: Node drag ───────────────────────────────────────────────────
let dragState = null;

function attachNodeEvents(g, node) {
  g.addEventListener('mousedown', e => {
    if (state.tool === 'connect') return;
    e.stopPropagation();
    if (e.button !== 0) return;

    if (e.shiftKey) {
      if (state.selectedNodes.has(node.id)) state.selectedNodes.delete(node.id);
      else state.selectedNodes.add(node.id);
      renderNodes();
      return;
    }
    if (!state.selectedNodes.has(node.id)) {
      state.selectedNodes.clear();
      state.selectedNodes.add(node.id);
      state.selectedEdge = null;
    }

    const startPt = svgPt(e.clientX, e.clientY);
    const starts  = {};
    state.selectedNodes.forEach(id => {
      const n = state.nodes.find(nn => nn.id === id);
      if (n) starts[id] = { x: n.x, y: n.y };
    });

    dragState = { type: 'node', startPt, starts };
    renderNodes();
    renderEdges();
  });

  g.addEventListener('dblclick', e => {
    e.stopPropagation();
    openNodeModal(node.id);
  });

  g.addEventListener('contextmenu', e => {
    e.preventDefault();
    showCtxMenu(e.clientX, e.clientY, [
      { label: 'Edit', action: () => openNodeModal(node.id) },
      { label: 'Duplicate', action: () => duplicateNode(node.id) },
      { sep: true },
      { label: 'Delete', action: () => confirmDelete(() => deleteNode(node.id)), danger: true },
    ]);
  });
}

function attachEdgeEvents(g, edge) {
  g.addEventListener('click', e => {
    e.stopPropagation();
    state.selectedEdge = edge.id;
    state.selectedNodes.clear();
    renderEdges();
    renderNodes();
  });

  g.addEventListener('dblclick', e => {
    e.stopPropagation();
    openEdgeModal(edge.id);
  });

  g.addEventListener('mouseenter', e => showEdgeTooltip(e, edge));
  g.addEventListener('mousemove',  e => moveEdgeTooltip(e));
  g.addEventListener('mouseleave', ()  => { edgeTooltip.hidden = true; });

  g.addEventListener('contextmenu', e => {
    e.preventDefault();
    showCtxMenu(e.clientX, e.clientY, [
      { label: 'Edit Edge', action: () => openEdgeModal(edge.id) },
      { sep: true },
      { label: 'Delete Edge', action: () => { state.edges = state.edges.filter(ee => ee.id !== edge.id); render(); }, danger: true },
    ]);
  });
}

// ─── Edge tooltip ─────────────────────────────────────────────────────────────
function showEdgeTooltip(e, edge) {
  let html = `<div class="tt-type">${edge.type.toUpperCase()} edge</div>`;
  if (edge.dtype)   html += `<div class="tt-data">type: <strong>${edge.dtype}</strong></div>`;
  if (edge.example) html += `<div class="tt-example">ex: ${edge.example}</div>`;
  if (edge.label)   html += `<div class="tt-data">label: ${edge.label}</div>`;
  if (!edge.dtype && !edge.example && !edge.label) html += `<div class="tt-example">(no metadata — double-click to edit)</div>`;
  edgeTooltip.innerHTML = html;
  edgeTooltip.hidden = false;
  moveEdgeTooltip(e);
}
function moveEdgeTooltip(e) {
  edgeTooltip.style.left = (e.clientX + 14) + 'px';
  edgeTooltip.style.top  = (e.clientY - 8) + 'px';
}

// ─── Interaction: Edge drag (connect tool) ────────────────────────────────────
let edgeDragState = null;

function startEdgeDrag(e, fromNode, portX, portY) {
  edgeDragState = { fromNode, portX, portY };
  dragEdge.setAttribute('opacity', '1');
  const d = `M${portX},${portY} L${portX},${portY}`;
  dragEdge.setAttribute('d', d);
}

// ─── Canvas mouse events ──────────────────────────────────────────────────────
let panning = false, panStart = null;
let selBoxStart = null;
let selBox = null;

canvasWrap.addEventListener('mousedown', e => {
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    panning = true;
    panStart = { x: e.clientX - state.pan.x, y: e.clientY - state.pan.y };
    canvasWrap.classList.add('tool-pan');
    return;
  }
  if (state.tool === 'fn' || state.tool === 'cond') {
    const pt = svgPt(e.clientX, e.clientY);
    const node = createNode(state.tool === 'fn' ? 'fn' : 'cond', pt.x, pt.y);
    openNodeModal(node.id, true);
    setTool('select');
    return;
  }
  if (state.tool === 'select' && e.target === svg || e.target.id === 'bg-grid') {
    state.selectedNodes.clear();
    state.selectedEdge = null;
    // start selection box
    const pt = svgPt(e.clientX, e.clientY);
    selBoxStart = pt;
    if (!selBox) {
      selBox = svgEl('rect', { id: 'selection-box' });
      svg.appendChild(selBox);
    }
    selBox.setAttribute('x', pt.x); selBox.setAttribute('y', pt.y);
    selBox.setAttribute('width', 0); selBox.setAttribute('height', 0);
    renderNodes();
    renderEdges();
  }
});

document.addEventListener('mousemove', e => {
  if (panning) {
    state.pan.x = e.clientX - panStart.x;
    state.pan.y = e.clientY - panStart.y;
    applyTransform();
    return;
  }

  if (dragState && dragState.type === 'node') {
    const pt = svgPt(e.clientX, e.clientY);
    const dx = pt.x - dragState.startPt.x;
    const dy = pt.y - dragState.startPt.y;
    state.selectedNodes.forEach(id => {
      const n = state.nodes.find(nn => nn.id === id);
      if (n && dragState.starts[id]) {
        n.x = dragState.starts[id].x + dx;
        n.y = dragState.starts[id].y + dy;
      }
    });
    render();
    return;
  }

  if (edgeDragState) {
    const pt = svgPt(e.clientX, e.clientY);
    const { portX, portY } = edgeDragState;
    dragEdge.setAttribute('d', cubicPath(portX, portY, pt.x, pt.y));
    return;
  }

  if (selBoxStart && selBox) {
    const pt = svgPt(e.clientX, e.clientY);
    const x  = Math.min(selBoxStart.x, pt.x);
    const y  = Math.min(selBoxStart.y, pt.y);
    const w  = Math.abs(pt.x - selBoxStart.x);
    const h  = Math.abs(pt.y - selBoxStart.y);
    selBox.setAttribute('x', x); selBox.setAttribute('y', y);
    selBox.setAttribute('width', w); selBox.setAttribute('height', h);
    // highlight nodes in box
    state.selectedNodes.clear();
    state.nodes.forEach(n => {
      if (n.x >= x && n.x <= x+w && n.y >= y && n.y <= y+h) state.selectedNodes.add(n.id);
    });
    renderNodes();
  }
});

document.addEventListener('mouseup', e => {
  if (panning) { panning = false; canvasWrap.classList.remove('tool-pan'); }

  if (dragState) { dragState = null; }

  if (edgeDragState) {
    const { fromNode } = edgeDragState;
    const pt = svgPt(e.clientX, e.clientY);
    // Find target node
    const target = state.nodes.find(n => {
      if (n.id === fromNode.id) return false;
      const dx = n.x - pt.x, dy = n.y - pt.y;
      const r = n.type === 'fn' ? FN_R + 10 : COND_H + 10;
      return Math.sqrt(dx*dx+dy*dy) < r;
    });
    if (target) {
      const edge = { id: uid(), from: fromNode.id, to: target.id, type: 'call', dtype: '', example: '', label: '', color: '' };
      state.edges.push(edge);
      render();
      openEdgeModal(edge.id);
    }
    dragEdge.setAttribute('opacity', '0');
    edgeDragState = null;
  }

  if (selBoxStart) {
    selBoxStart = null;
    if (selBox) { selBox.remove(); selBox = null; }
  }
});

// ─── Canvas click: close context menu ─────────────────────────────────────────
canvasWrap.addEventListener('click', () => removeCtxMenu());

// ─── Zoom ─────────────────────────────────────────────────────────────────────
canvasWrap.addEventListener('wheel', e => {
  e.preventDefault();
  const rect   = svg.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  const newZoom = Math.max(0.15, Math.min(3, state.zoom * factor));
  state.pan.x = mouseX - (mouseX - state.pan.x) * (newZoom / state.zoom);
  state.pan.y = mouseY - (mouseY - state.pan.y) * (newZoom / state.zoom);
  state.zoom  = newZoom;
  applyTransform();
}, { passive: false });

document.getElementById('btn-zoom-in').addEventListener('click',  () => zoomBy(1.2));
document.getElementById('btn-zoom-out').addEventListener('click', () => zoomBy(0.8));
document.getElementById('btn-fit').addEventListener('click',       fitAll);

function zoomBy(f) {
  const rect = svg.getBoundingClientRect();
  const cx = rect.width / 2, cy = rect.height / 2;
  state.zoom = Math.max(0.15, Math.min(3, state.zoom * f));
  applyTransform();
}

function fitAll() {
  if (!state.nodes.length) return;
  const rect = svg.getBoundingClientRect();
  const pad  = 80;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  state.nodes.forEach(n => {
    const r = n.type === 'fn' ? FN_R : COND_H;
    minX = Math.min(minX, n.x - r); minY = Math.min(minY, n.y - r);
    maxX = Math.max(maxX, n.x + r); maxY = Math.max(maxY, n.y + r);
  });
  const w = maxX - minX + pad*2, h = maxY - minY + pad*2;
  state.zoom = Math.max(0.15, Math.min(3, Math.min(rect.width/w, rect.height/h)));
  state.pan.x = (rect.width  - w * state.zoom) / 2 - (minX - pad) * state.zoom;
  state.pan.y = (rect.height - h * state.zoom) / 2 - (minY - pad) * state.zoom;
  applyTransform();
}

// ─── Node creation ────────────────────────────────────────────────────────────
function createNode(type, x, y) {
  const node = { id: uid(), type, x, y, name: '', params: [], returnType: '', returnExample: '', branches: ['if', 'else'], color: '', notes: '' };
  state.nodes.push(node);
  render();
  return node;
}

function duplicateNode(id) {
  const src = state.nodes.find(n => n.id === id);
  if (!src) return;
  const node = JSON.parse(JSON.stringify(src));
  node.id = uid();
  node.x += 60; node.y += 60;
  state.nodes.push(node);
  state.selectedNodes.clear();
  state.selectedNodes.add(node.id);
  render();
}

function deleteNode(id) {
  state.nodes  = state.nodes.filter(n => n.id !== id);
  state.edges  = state.edges.filter(e => e.from !== id && e.to !== id);
  state.selectedNodes.delete(id);
  render();
}

// ─── Node modal ───────────────────────────────────────────────────────────────
let _editingNodeId = null;
let _isNewNode     = false;

function openNodeModal(id, isNew = false) {
  _editingNodeId = id;
  _isNewNode     = isNew;
  const node = state.nodes.find(n => n.id === id);
  if (!node) return;

  document.getElementById('modal-node-title').textContent = node.type === 'fn' ? (isNew ? 'New Function' : 'Edit Function') : (isNew ? 'New Conditional' : 'Edit Conditional');
  document.getElementById('node-name').value  = node.name || '';
  document.getElementById('node-notes').value = node.notes || '';

  const fnFields   = document.getElementById('fn-fields');
  const condFields = document.getElementById('cond-fields');

  if (node.type === 'fn') {
    fnFields.hidden   = false;
    condFields.hidden = true;
    document.getElementById('return-type').value    = node.returnType || '';
    document.getElementById('return-example').value = node.returnExample || '';
    renderParamsList(node.params || []);
  } else {
    fnFields.hidden   = true;
    condFields.hidden = false;
    renderBranchesList(node.branches || ['if', 'else']);
  }

  renderColorPicker('node-color-row', NODE_COLORS.map(c => c.fill), node.color || NODE_COLORS[node.type === 'fn' ? 0 : 1].fill, true);
  modalNode.hidden = false;
  setTimeout(() => document.getElementById('node-name').focus(), 50);
}

function renderParamsList(params) {
  const list = document.getElementById('params-list');
  list.innerHTML = '';
  params.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'param-row';
    row.innerHTML = `
      <input type="text" class="field-input param-name" placeholder="name" value="${esc(p.name||'')}" />
      <input type="text" class="field-input param-type" placeholder="type" value="${esc(p.type||'')}" />
      <input type="text" class="field-input param-ex"   placeholder="example" value="${esc(p.example||'')}" />
      <button class="btn-remove" data-idx="${i}">✕</button>
    `;
    row.querySelector('.btn-remove').addEventListener('click', () => {
      const node = state.nodes.find(n => n.id === _editingNodeId);
      if (node) { node.params.splice(i, 1); renderParamsList(node.params); }
    });
    list.appendChild(row);
  });
}

function renderBranchesList(branches) {
  const list = document.getElementById('branches-list');
  list.innerHTML = '';
  branches.forEach((b, i) => {
    const row = document.createElement('div');
    row.className = 'branch-row';
    row.innerHTML = `
      <input type="text" class="field-input branch-name" placeholder="branch label (e.g. else if, error…)" value="${esc(b||'')}" />
      <button class="btn-remove" data-idx="${i}">✕</button>
    `;
    row.querySelector('.btn-remove').addEventListener('click', () => {
      const node = state.nodes.find(n => n.id === _editingNodeId);
      if (node) { node.branches.splice(i, 1); renderBranchesList(node.branches); }
    });
    list.appendChild(row);
  });
}

document.getElementById('add-param-btn').addEventListener('click', () => {
  const node = state.nodes.find(n => n.id === _editingNodeId);
  if (!node) return;
  node.params = node.params || [];
  node.params.push({ name: '', type: '', example: '' });
  renderParamsList(node.params);
});

document.getElementById('add-branch-btn').addEventListener('click', () => {
  const node = state.nodes.find(n => n.id === _editingNodeId);
  if (!node) return;
  node.branches = node.branches || [];
  node.branches.push('');
  renderBranchesList(node.branches);
});

document.getElementById('modal-node-save').addEventListener('click', () => {
  const node = state.nodes.find(n => n.id === _editingNodeId);
  if (!node) return;
  node.name  = document.getElementById('node-name').value.trim() || (node.type === 'fn' ? 'function' : 'condition');
  node.notes = document.getElementById('node-notes').value.trim();

  if (node.type === 'fn') {
    // Collect params
    node.params = [...document.querySelectorAll('#params-list .param-row')].map(row => ({
      name:    row.querySelector('.param-name').value.trim(),
      type:    row.querySelector('.param-type').value.trim(),
      example: row.querySelector('.param-ex').value.trim(),
    })).filter(p => p.name || p.type);
    node.returnType    = document.getElementById('return-type').value.trim();
    node.returnExample = document.getElementById('return-example').value.trim();

    // Auto-create return edge if returnType set and a caller exists
    if (node.returnType) autoCreateReturnEdge(node);
  } else {
    node.branches = [...document.querySelectorAll('#branches-list .branch-name')].map(i => i.value.trim()).filter(Boolean);
  }

  node.color = getSelectedColor('node-color-row');
  modalNode.hidden = true;
  render();
  showStatus('Saved');
});

function autoCreateReturnEdge(node) {
  const callers = state.edges.filter(e => e.to === node.id && e.type === 'call').map(e => e.from);
  callers.forEach(callerId => {
    const exists = state.edges.some(e => e.from === node.id && e.to === callerId && e.type === 'return');
    if (!exists) {
      state.edges.push({ id: uid(), from: node.id, to: callerId, type: 'return', dtype: node.returnType, example: node.returnExample, label: '', color: '' });
    }
  });
}

document.getElementById('modal-node-cancel').addEventListener('click', () => {
  if (_isNewNode) deleteNode(_editingNodeId);
  modalNode.hidden = true;
});
document.getElementById('modal-node-close').addEventListener('click', () => {
  if (_isNewNode) deleteNode(_editingNodeId);
  modalNode.hidden = true;
});

// ─── Edge modal ───────────────────────────────────────────────────────────────
let _editingEdgeId = null;

function openEdgeModal(id) {
  _editingEdgeId = id;
  const edge = state.edges.find(e => e.id === id);
  if (!edge) return;

  document.querySelectorAll('#edge-type-group input').forEach(r => { r.checked = r.value === edge.type; });
  document.getElementById('edge-dtype').value   = edge.dtype   || '';
  document.getElementById('edge-example').value = edge.example || '';
  document.getElementById('edge-label').value   = edge.label   || '';
  renderColorPicker('edge-color-row', EDGE_COLORS.map(c => c.val), edge.color || '', false);
  modalEdge.hidden = false;
}

document.getElementById('modal-edge-save').addEventListener('click', () => {
  const edge = state.edges.find(e => e.id === _editingEdgeId);
  if (!edge) return;
  edge.type    = document.querySelector('#edge-type-group input:checked')?.value || 'call';
  edge.dtype   = document.getElementById('edge-dtype').value.trim();
  edge.example = document.getElementById('edge-example').value.trim();
  edge.label   = document.getElementById('edge-label').value.trim();
  edge.color   = getSelectedColor('edge-color-row');
  modalEdge.hidden = true;
  render();
});
document.getElementById('modal-edge-cancel').addEventListener('click', () => { modalEdge.hidden = true; });
document.getElementById('modal-edge-close').addEventListener('click',  () => { modalEdge.hidden = true; });
document.getElementById('modal-edge-delete').addEventListener('click', () => {
  state.edges = state.edges.filter(e => e.id !== _editingEdgeId);
  modalEdge.hidden = true;
  render();
});

// ─── Color picker ─────────────────────────────────────────────────────────────
function renderColorPicker(containerId, colors, current, isNode) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  container.dataset.selected = current;

  colors.forEach(c => {
    const sw = document.createElement('div');
    sw.className   = 'color-swatch' + (c === current ? ' selected' : '');
    sw.style.background = c;
    sw.style.borderColor = isNode
      ? (NODE_COLORS.find(nc => nc.fill === c)?.border || c)
      : c;
    sw.dataset.color = c;
    sw.addEventListener('click', () => {
      container.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      container.dataset.selected = c;
    });
    container.appendChild(sw);
  });

  // Custom color
  const custom = document.createElement('div');
  custom.className = 'color-swatch-custom';
  custom.title = 'Custom color';
  custom.innerHTML = `<span>+</span><input type="color" value="${current || '#1a3a5c'}" />`;
  custom.querySelector('input').addEventListener('input', e => {
    const val = e.target.value;
    container.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
    container.dataset.selected = val;
    custom.style.background = val;
  });
  container.appendChild(custom);
}

function getSelectedColor(containerId) {
  return document.getElementById(containerId).dataset.selected || '';
}

// ─── Context menu ─────────────────────────────────────────────────────────────
function showCtxMenu(x, y, items) {
  removeCtxMenu();
  const menu = document.createElement('div');
  menu.id = 'ctx-menu';
  items.forEach(item => {
    if (item.sep) { const sep = document.createElement('div'); sep.className = 'ctx-sep'; menu.appendChild(sep); return; }
    const btn = document.createElement('button');
    btn.textContent = item.label;
    if (item.danger) btn.classList.add('ctx-danger');
    btn.addEventListener('click', () => { item.action(); removeCtxMenu(); });
    menu.appendChild(btn);
  });
  menu.style.left = x + 'px'; menu.style.top = y + 'px';
  document.body.appendChild(menu);
}
function removeCtxMenu() { document.getElementById('ctx-menu')?.remove(); }

// ─── Confirm dialog ───────────────────────────────────────────────────────────
function confirmDelete(onOk, msg = 'Are you sure you want to delete this?') {
  document.getElementById('confirm-msg').textContent = msg;
  modalConfirm.hidden = false;
  document.getElementById('confirm-ok').onclick = () => { modalConfirm.hidden = true; onOk(); };
  document.getElementById('confirm-cancel').onclick = () => { modalConfirm.hidden = true; };
}

// ─── Toolbar buttons ──────────────────────────────────────────────────────────
document.getElementById('btn-select').addEventListener('click',   () => setTool('select'));
document.getElementById('btn-add-fn').addEventListener('click',   () => setTool('fn'));
document.getElementById('btn-add-cond').addEventListener('click', () => setTool('cond'));
document.getElementById('btn-connect').addEventListener('click',  () => setTool('connect'));
document.getElementById('btn-delete').addEventListener('click',   () => {
  if (state.selectedNodes.size) {
    confirmDelete(() => { state.selectedNodes.forEach(id => deleteNode(id)); state.selectedNodes.clear(); render(); }, `Delete ${state.selectedNodes.size} node(s)?`);
  } else if (state.selectedEdge) {
    state.edges = state.edges.filter(e => e.id !== state.selectedEdge);
    state.selectedEdge = null; render();
  }
});
document.getElementById('btn-clear').addEventListener('click', () => {
  confirmDelete(() => { state.nodes = []; state.edges = []; state.selectedNodes.clear(); state.selectedEdge = null; render(); }, 'Clear entire canvas?');
});

// ─── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const k = e.key.toLowerCase();
  if (k === 'v') setTool('select');
  if (k === 'f') setTool('fn');
  if (k === 'c') setTool('cond');
  if (k === 'e') setTool('connect');
  if (k === 'delete' || k === 'backspace') {
    state.selectedNodes.forEach(id => deleteNode(id));
    if (state.selectedEdge) { state.edges = state.edges.filter(ee => ee.id !== state.selectedEdge); state.selectedEdge = null; }
    state.selectedNodes.clear();
    render();
  }
  if (k === 'escape') {
    state.selectedNodes.clear(); state.selectedEdge = null;
    modalNode.hidden = true; modalEdge.hidden = true; modalConfirm.hidden = true;
    removeCtxMenu();
    render();
  }
  if ((e.ctrlKey || e.metaKey) && k === 'a') {
    e.preventDefault();
    state.nodes.forEach(n => state.selectedNodes.add(n.id));
    render();
  }
  if ((e.ctrlKey || e.metaKey) && k === 's') {
    e.preventDefault(); saveToFile();
  }
  if ((e.ctrlKey || e.metaKey) && k === 'z') {
    e.preventDefault(); undo();
  }
});

// ─── Undo ─────────────────────────────────────────────────────────────────────
const history = [];
const HISTORY_MAX = 40;

function pushHistory() {
  history.push(JSON.stringify({ nodes: state.nodes, edges: state.edges, nextId: state.nextId }));
  if (history.length > HISTORY_MAX) history.shift();
}

function undo() {
  if (!history.length) { showStatus('Nothing to undo'); return; }
  const snap = JSON.parse(history.pop());
  state.nodes  = snap.nodes;
  state.edges  = snap.edges;
  state.nextId = snap.nextId;
  state.selectedNodes.clear();
  state.selectedEdge = null;
  render();
  showStatus('Undo');
}

// Wrap createNode/deleteNode to push history
const _origCreateNode = createNode;
// Monkey-patch render to auto-push after meaningful ops — simple approach: push before each modal save
document.getElementById('modal-node-save').addEventListener('click', () => pushHistory(), true);
document.getElementById('modal-edge-save').addEventListener('click', () => pushHistory(), true);
document.getElementById('confirm-ok').addEventListener('click',      () => pushHistory(), true);

// ─── Export ───────────────────────────────────────────────────────────────────
document.getElementById('btn-export').addEventListener('click', () => {
  const svgEl2 = svg.cloneNode(true);
  svgEl2.setAttribute('width',  svg.clientWidth);
  svgEl2.setAttribute('height', svg.clientHeight);
  const blob = new Blob([svgEl2.outerHTML], { type: 'image/svg+xml' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'callflow.svg';
  a.click(); URL.revokeObjectURL(url);
  showStatus('Exported SVG');
});

function saveToFile() {
  const data = JSON.stringify({ version: 1, nodes: state.nodes, edges: state.edges, nextId: state.nextId }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'diagram.callflow.json';
  a.click(); URL.revokeObjectURL(url);
  showStatus('Saved to file');
}
document.getElementById('btn-save').addEventListener('click', saveToFile);

document.getElementById('btn-load').addEventListener('click', () => {
  document.getElementById('file-load-input').click();
});
document.getElementById('file-load-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      pushHistory();
      state.nodes  = data.nodes  || [];
      state.edges  = data.edges  || [];
      state.nextId = data.nextId || 100;
      state.selectedNodes.clear();
      state.selectedEdge = null;
      render(); fitAll();
      showStatus('Loaded');
    } catch { showStatus('Error loading file'); }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ─── Minimap ──────────────────────────────────────────────────────────────────
function drawMinimap() {
  const W = minimap.width, H = minimap.height;
  mmCtx.clearRect(0, 0, W, H);
  mmCtx.fillStyle = '#12151c';
  mmCtx.fillRect(0, 0, W, H);

  if (!state.nodes.length) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  state.nodes.forEach(n => {
    const r = n.type === 'fn' ? FN_R : COND_H;
    minX = Math.min(minX, n.x - r); minY = Math.min(minY, n.y - r);
    maxX = Math.max(maxX, n.x + r); maxY = Math.max(maxY, n.y + r);
  });

  const pad   = 12;
  const scaleX = (W - pad*2) / (maxX - minX || 1);
  const scaleY = (H - pad*2) / (maxY - minY || 1);
  const scale  = Math.min(scaleX, scaleY);
  const offX   = pad + ((W - pad*2) - (maxX - minX) * scale) / 2;
  const offY   = pad + ((H - pad*2) - (maxY - minY) * scale) / 2;

  const toMM = (x, y) => ({ x: offX + (x - minX) * scale, y: offY + (y - minY) * scale });

  // Draw edges
  mmCtx.strokeStyle = 'rgba(77,232,178,0.3)';
  mmCtx.lineWidth = 0.8;
  state.edges.forEach(edge => {
    const fn = state.nodes.find(n => n.id === edge.from);
    const tn = state.nodes.find(n => n.id === edge.to);
    if (!fn || !tn) return;
    const fp = toMM(fn.x, fn.y), tp = toMM(tn.x, tn.y);
    mmCtx.beginPath();
    mmCtx.moveTo(fp.x, fp.y);
    mmCtx.lineTo(tp.x, tp.y);
    mmCtx.stroke();
  });

  // Draw nodes
  state.nodes.forEach(n => {
    const p = toMM(n.x, n.y);
    const col = getNodeColor(n);
    mmCtx.fillStyle = col.fill;
    mmCtx.strokeStyle = col.border;
    mmCtx.lineWidth = 0.8;
    if (n.type === 'fn') {
      mmCtx.beginPath(); mmCtx.arc(p.x, p.y, Math.max(3, FN_R * scale), 0, Math.PI*2); mmCtx.fill(); mmCtx.stroke();
    } else {
      const s = Math.max(3, COND_H * scale);
      mmCtx.beginPath();
      mmCtx.moveTo(p.x, p.y-s); mmCtx.lineTo(p.x+s, p.y); mmCtx.lineTo(p.x, p.y+s); mmCtx.lineTo(p.x-s, p.y);
      mmCtx.closePath(); mmCtx.fill(); mmCtx.stroke();
    }
  });

  // Viewport rect
  const rect = svg.getBoundingClientRect();
  const vpX1 = (-state.pan.x) / state.zoom;
  const vpY1 = (-state.pan.y) / state.zoom;
  const vpW  = rect.width  / state.zoom;
  const vpH  = rect.height / state.zoom;
  const vp   = toMM(vpX1, vpY1);
  mmCtx.strokeStyle = 'rgba(77,232,178,0.5)';
  mmCtx.lineWidth = 1;
  mmCtx.strokeRect(vp.x, vp.y, vpW * scale, vpH * scale);
}

minimap.addEventListener('click', e => {
  const rect  = minimap.getBoundingClientRect();
  const mx    = e.clientX - rect.left, my = e.clientY - rect.top;
  const W = minimap.width, H = minimap.height;
  if (!state.nodes.length) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  state.nodes.forEach(n => { const r = n.type==='fn'?FN_R:COND_H; minX=Math.min(minX,n.x-r); minY=Math.min(minY,n.y-r); maxX=Math.max(maxX,n.x+r); maxY=Math.max(maxY,n.y+r); });
  const pad=12, scaleX=(W-pad*2)/(maxX-minX||1), scaleY=(H-pad*2)/(maxY-minY||1), scale=Math.min(scaleX,scaleY);
  const offX=pad+((W-pad*2)-(maxX-minX)*scale)/2, offY=pad+((H-pad*2)-(maxY-minY)*scale)/2;

  const worldX = (mx - offX) / scale + minX;
  const worldY = (my - offY) / scale + minY;
  const svgRect = svg.getBoundingClientRect();
  state.pan.x = svgRect.width/2  - worldX * state.zoom;
  state.pan.y = svgRect.height/2 - worldY * state.zoom;
  applyTransform();
});

// ─── Escape helper ────────────────────────────────────────────────────────────
function esc(str) { return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

// ─── Demo starter graph ───────────────────────────────────────────────────────
function loadDemo() {
  state.nodes = [
    { id:'n1', type:'fn',   x:200,  y:200,  name:'main',        params:[{name:'args',type:'string[]',example:'["--verbose"]'}], returnType:'void', returnExample:'', color:'', notes:'Entry point' },
    { id:'n2', type:'fn',   x:440,  y:120,  name:'fetchData',   params:[{name:'url',type:'string',example:'"https://api.example.com"'}], returnType:'Promise<Data>', returnExample:'{ id:1, name:"Alice" }', color:'', notes:'' },
    { id:'n3', type:'cond', x:440,  y:320,  name:'isValid?',    params:[], returnType:'', returnExample:'', branches:['true','false'], color:'', notes:'' },
    { id:'n4', type:'fn',   x:620,  y:220,  name:'processData', params:[{name:'data',type:'Data',example:'{ id:1 }'}], returnType:'Result', returnExample:'{ status:"ok" }', color:'', notes:'' },
    { id:'n5', type:'fn',   x:620,  y:420,  name:'handleError', params:[{name:'err',type:'Error',example:'new Error("404")'}], returnType:'void', returnExample:'', color:'#3d1a1a', notes:'' },
    { id:'n6', type:'fn',   x:200,  y:420,  name:'render',      params:[{name:'result',type:'Result',example:'{ status:"ok" }'}], returnType:'void', returnExample:'', color:'#1a3d2e', notes:'' },
  ];
  state.edges = [
    { id:'e1', from:'n1', to:'n2',   type:'call',   dtype:'string',        example:'"https://api.example.com"', label:'',      color:'' },
    { id:'e2', from:'n2', to:'n1',   type:'return',  dtype:'Promise<Data>', example:'{ id:1 }',                 label:'data',  color:'' },
    { id:'e3', from:'n1', to:'n3',   type:'call',   dtype:'Data',          example:'{ id:1 }',                  label:'',      color:'' },
    { id:'e4', from:'n3', to:'n4',   type:'cond',   dtype:'boolean',       example:'true',                      label:'true',  color:'' },
    { id:'e5', from:'n3', to:'n5',   type:'cond',   dtype:'boolean',       example:'false',                     label:'false', color:'' },
    { id:'e6', from:'n4', to:'n1',   type:'return',  dtype:'Result',        example:'{ status:"ok" }',           label:'result',color:'' },
    { id:'e7', from:'n1', to:'n6',   type:'call',   dtype:'Result',        example:'{ status:"ok" }',           label:'',      color:'' },
  ];
  state.nextId = 100;
  render();
  setTimeout(fitAll, 100);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
applyTransform();
loadDemo();

// ─── PWA Service Worker ───────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
