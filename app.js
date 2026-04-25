/* ===== SeeStack ===== */
'use strict';

const state = {
  nodes:[], edges:[], zones:[],
  selectedNodes:new Set(), selectedEdge:null, selectedZone:null,
  searchMatches:new Set(),
  focusNodeId:null,
  tool:'select',
  zoom:1, pan:{x:0,y:0},
  nextId:1,
};

/* ── DOM ── */
const svg        = document.getElementById('svg-canvas');
const zonesGroup = document.getElementById('zones-group');
const nodesGroup = document.getElementById('nodes-group');
const edgesGroup = document.getElementById('edges-group');
const dragEdge   = document.getElementById('drag-edge');
const canvasWrap = document.getElementById('canvas-wrap');
const minimap    = document.getElementById('minimap');
const mmCtx      = minimap.getContext('2d');
const statusMsg  = document.getElementById('status-msg');
const zoomLabel  = document.getElementById('zoom-label');
const searchInput= document.getElementById('search-input');
const searchClear= document.getElementById('search-clear');
const searchCount= document.getElementById('search-count');
const modalNode    = document.getElementById('modal-node');
const modalEdge    = document.getElementById('modal-edge');
const modalZone    = document.getElementById('modal-zone');
const modalConfirm = document.getElementById('modal-confirm');
const edgeTooltip  = document.getElementById('edge-tooltip');
const infoPanel      = document.getElementById('info-panel');
const infoPanelBody  = document.getElementById('info-panel-body');
const infoPanelTitle = document.getElementById('info-panel-title');
let _infoPanelNodeId = null;

/* ── Palettes ── */
const NODE_COLORS=[
  {fill:'#1a3a5c',border:'#3a8fff'},{fill:'#2d1f4a',border:'#9b6fff'},
  {fill:'#1a3d2e',border:'#4de8b2'},{fill:'#3d1a1a',border:'#ff6b6b'},
  {fill:'#3d3519',border:'#f7d96f'},{fill:'#1a2d3d',border:'#4dc8e8'},
  {fill:'#1f1f3d',border:'#7c6ff7'},{fill:'#1f2e20',border:'#78c96b'},
];
const EDGE_COLORS=['#4de8b2','#ff8f4d','#7c6ff7','#f7d96f','#f76fd9','#ff5a5a','#4dc8e8','#78c96b'];
const ZONE_PRESETS=[
  {fill:'rgba(58,143,255,0.08)',border:'rgba(58,143,255,0.35)'},
  {fill:'rgba(77,232,178,0.08)',border:'rgba(77,232,178,0.35)'},
  {fill:'rgba(247,217,111,0.08)',border:'rgba(247,217,111,0.35)'},
  {fill:'rgba(255,107,107,0.08)',border:'rgba(255,107,107,0.35)'},
  {fill:'rgba(155,111,255,0.08)',border:'rgba(155,111,255,0.35)'},
  {fill:'rgba(247,111,217,0.08)',border:'rgba(247,111,217,0.35)'},
  {fill:'rgba(120,201,107,0.08)',border:'rgba(120,201,107,0.35)'},
  {fill:'rgba(255,143,77,0.08)', border:'rgba(255,143,77,0.35)'},
];

const uid=()=>`n${state.nextId++}`;
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function trunc(s,n){return s&&s.length>n?s.slice(0,n-1)+'…':(s||'');}

/* ── Persistence ── */
const LS_KEY='seestack_diagram';
function persistSave(){
  try{
    localStorage.setItem(LS_KEY,JSON.stringify({
      version:3,
      nodes:state.nodes,edges:state.edges,zones:state.zones,
      nextId:state.nextId,pan:state.pan,zoom:state.zoom,
    }));
  }catch(e){console.warn('localStorage save failed',e);}
}
function persistLoad(){
  try{
    const raw=localStorage.getItem(LS_KEY);
    if(!raw) return false;
    const d=JSON.parse(raw);
    state.nodes  = d.nodes  ||[];
    state.edges  = d.edges  ||[];
    state.zones  = d.zones  ||[];
    state.nextId = d.nextId ||100;
    if(d.pan){state.pan.x=d.pan.x;state.pan.y=d.pan.y;}
    if(d.zoom) state.zoom=d.zoom;
    return true;
  }catch(e){return false;}
}
function renderAndSave(){render();persistSave();}

/* ── Coords ── */
function svgPt(cx,cy){
  const r=svg.getBoundingClientRect();
  return{x:(cx-r.left-state.pan.x)/state.zoom, y:(cy-r.top-state.pan.y)/state.zoom};
}
function applyTransform(){
  const t=`translate(${state.pan.x},${state.pan.y}) scale(${state.zoom})`;
  zonesGroup.setAttribute('transform',t);
  nodesGroup.setAttribute('transform',t);
  edgesGroup.setAttribute('transform',t);
  zoomLabel.textContent=`${Math.round(state.zoom*100)}%`;
  drawMinimap();
}
function showStatus(msg,ms=2000){
  statusMsg.textContent=msg;statusMsg.classList.add('visible');
  clearTimeout(showStatus._t);
  showStatus._t=setTimeout(()=>statusMsg.classList.remove('visible'),ms);
}
function setTool(tool){
  state.tool=tool;
  document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
  const map={select:'btn-select',fn:'btn-add-fn',cond:'btn-add-cond',connect:'btn-connect',zone:'btn-add-zone'};
  if(map[tool]) document.getElementById(map[tool])?.classList.add('active');
  canvasWrap.className=tool==='connect'?'tool-connect':tool==='zone'?'tool-zone':'';
}

/* ── Node radius ── */
const FN_R_BASE=44;
function nodeRadius(node){
  if(node.sizeOverride!=null) return node.sizeOverride;
  return computeAutoRadius(node,new Set());
}
function computeAutoRadius(node,visited){
  if(visited.has(node.id)) return FN_R_BASE;
  visited.add(node.id);
  const parents=state.edges
    .filter(e=>e.to===node.id&&(e.type==='call'||e.type==='cond'||e.type==='param'))
    .map(e=>state.nodes.find(n=>n.id===e.from&&n.type==='fn'))
    .filter(n=>n&&n.id!==node.id);
  if(!parents.length) return FN_R_BASE;
  const parentR=Math.max(...parents.map(n=>n.sizeOverride!=null?n.sizeOverride:computeAutoRadius(n,new Set(visited))));
  return Math.max(16,parentR*0.75);
}
function nodeBorderPoint(node,tx,ty){
  const dx=tx-node.x,dy=ty-node.y,len=Math.sqrt(dx*dx+dy*dy)||1;
  const r=nodeRadius(node)+2;
  if(node.type==='fn') return{x:node.x+dx/len*r,y:node.y+dy/len*r};
  const t=r/(Math.abs(dx)+Math.abs(dy)||1);
  return{x:node.x+dx*t,y:node.y+dy*t};
}

/* ── SVG helpers ── */
function svgEl(tag,attrs){
  const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const[k,v] of Object.entries(attrs)) if(v!=null) el.setAttribute(k,v);
  return el;
}
function svgTxt(text,attrs){const el=svgEl('text',attrs);el.textContent=text;return el;}
function getNodeColor(node){
  if(node.color){const p=NODE_COLORS.find(c=>c.fill===node.color);return p||{fill:node.color,border:lighten(node.color)};}
  return node.type==='fn'?NODE_COLORS[0]:NODE_COLORS[1];
}
function lighten(hex){
  try{const n=parseInt(hex.slice(1),16),r=Math.min(255,((n>>16)&0xff)+60),g=Math.min(255,((n>>8)&0xff)+60),b=Math.min(255,(n&0xff)+60);return`#${((r<<16)|(g<<8)|b).toString(16).padStart(6,'0')}`;}
  catch{return'#888';}
}

/* ── Infer auto edge type from node types ── */
function inferEdgeType(fromNode,toNode){
  if(fromNode.type==='fn'  && toNode.type==='cond') return 'cond';
  if(fromNode.type==='cond'&& toNode.type==='fn')   return 'call';
  return 'call';
}

/* ── Focus highlight helpers ── */
// Returns {litNodes: Set<id>, litEdges: Set<id>}.
// fn click: immediate fn parents + fn children (hopping through cond chains).
// cond click: upstream fn (hopping back through cond chains) + all downstream fn branches.
function computeFocusSet(nodeId){
  const litNodes=new Set([nodeId]);
  const litEdges=new Set();

  // Walk downstream: light edges+nodes; recurse through cond, stop at fn.
  function walkDown(fromId,visited=new Set()){
    if(visited.has(fromId)) return; visited.add(fromId);
    state.edges.filter(e=>e.from===fromId).forEach(e=>{
      const t=state.nodes.find(n=>n.id===e.to); if(!t) return;
      litEdges.add(e.id); litNodes.add(t.id);
      if(t.type==='cond') walkDown(t.id,visited);
    });
  }

  // Walk upstream: light edges+nodes; recurse through cond, stop at fn.
  function walkUp(fromId,visited=new Set()){
    if(visited.has(fromId)) return; visited.add(fromId);
    state.edges.filter(e=>e.to===fromId).forEach(e=>{
      const s=state.nodes.find(n=>n.id===e.from); if(!s) return;
      litEdges.add(e.id); litNodes.add(s.id);
      if(s.type==='cond') walkUp(s.id,visited);
    });
  }

  const node=state.nodes.find(n=>n.id===nodeId);
  if(!node) return{litNodes,litEdges};
  walkDown(nodeId);
  walkUp(nodeId);
  return{litNodes,litEdges};
}


function render(){renderZones();renderEdges();renderNodes();drawMinimap();}

/* ── Zones ── */
function renderZones(){
  const existing=new Set([...zonesGroup.querySelectorAll('[data-zid]')].map(e=>e.dataset.zid));
  const current=new Set(state.zones.map(z=>z.id));
  existing.forEach(id=>{if(!current.has(id)) zonesGroup.querySelector(`[data-zid="${id}"]`)?.remove();});
  state.zones.forEach(zone=>{
    let g=zonesGroup.querySelector(`[data-zid="${zone.id}"]`);
    if(!g){g=svgEl('g',{'data-zid':zone.id});zonesGroup.appendChild(g);attachZoneEvents(g,zone);}
    g.innerHTML='';
    const sel=state.selectedZone===zone.id;
    // Fill rect
    const rect=svgEl('rect',{x:zone.x,y:zone.y,width:zone.w,height:zone.h,rx:8,
      fill:zone.fill||'rgba(58,143,255,0.08)',
      stroke:zone.border||(sel?'rgba(255,255,255,0.5)':'rgba(58,143,255,0.35)'),
      'stroke-width':sel?2:1,'stroke-dasharray':sel?'':'6 4',
    });
    g.appendChild(rect);
    // Label
    if(zone.label){
      const lx=zone.x+12,ly=zone.y+20;
      g.appendChild(svgTxt(zone.label,{x:lx,y:ly,'font-family':"'DM Sans',sans-serif",'font-size':13,'font-weight':'500',fill:zone.border||'rgba(58,143,255,0.8)',opacity:0.85,'pointer-events':'none'}));
    }
    // Resize handle (bottom-right corner)
    const hx=zone.x+zone.w-6,hy=zone.y+zone.h-6;
    const handle=svgEl('rect',{x:hx,y:hy,width:12,height:12,rx:2,fill:zone.border||'rgba(58,143,255,0.5)',class:'zone-handle',cursor:'nwse-resize'});
    g.appendChild(handle);
    handle.addEventListener('mousedown',e=>{e.stopPropagation();startZoneResize(e,zone);});
  });
}

function attachZoneEvents(g,zone){
  g.addEventListener('mousedown',e=>{
    if(state.tool!=='select') return;
    if(e.target.classList.contains('zone-handle')) return;
    e.stopPropagation();
    if(e.button!==0) return;
    state.selectedZone=zone.id;
    state.selectedNodes.clear();state.selectedEdge=null;
    renderZones();renderNodes();renderEdges();
    const sp=svgPt(e.clientX,e.clientY);
    zoneDragState={zone,sp,ox:zone.x,oy:zone.y};
  });
  g.addEventListener('dblclick',e=>{e.stopPropagation();openZoneModal(zone.id);});
  g.addEventListener('contextmenu',e=>{
    e.preventDefault();
    showCtxMenu(e.clientX,e.clientY,[
      {label:'Edit Zone',action:()=>openZoneModal(zone.id)},
      {sep:true},
      {label:'Delete Zone',danger:true,action:()=>{state.zones=state.zones.filter(z=>z.id!==zone.id);if(state.selectedZone===zone.id) state.selectedZone=null;renderAndSave();}},
    ]);
  });
}

let zoneDragState=null,zoneResizeState=null;
function startZoneResize(e,zone){
  state.selectedZone=zone.id;
  const sp=svgPt(e.clientX,e.clientY);
  zoneResizeState={zone,sp,ow:zone.w,oh:zone.h};
}

/* ── Zone modal ── */
let _editZoneId=null;
function openZoneModal(id){
  _editZoneId=id;
  const zone=state.zones.find(z=>z.id===id);if(!zone) return;
  document.getElementById('zone-label-input').value=zone.label||'';
  // Build zone color picker
  buildZoneColorPicker('zone-color-row',zone.fill||ZONE_PRESETS[0].fill,zone.border||ZONE_PRESETS[0].border);
  modalZone.hidden=false;
  setTimeout(()=>document.getElementById('zone-label-input').focus(),50);
}
function buildZoneColorPicker(cid,currentFill,currentBorder){
  const c=document.getElementById(cid);c.innerHTML='';
  c.dataset.fill=currentFill;c.dataset.border=currentBorder;
  ZONE_PRESETS.forEach(p=>{
    const sw=document.createElement('div');
    sw.className='zone-color-swatch'+(p.fill===currentFill?' selected':'');
    sw.style.background=p.fill;
    sw.style.border=`2px solid ${p.border}`;
    sw.dataset.fill=p.fill;sw.dataset.border=p.border;
    sw.addEventListener('click',()=>{c.querySelectorAll('.zone-color-swatch').forEach(s=>s.classList.remove('selected'));sw.classList.add('selected');c.dataset.fill=p.fill;c.dataset.border=p.border;});
    c.appendChild(sw);
  });
}
document.getElementById('modal-zone-save').addEventListener('click',()=>{
  const zone=state.zones.find(z=>z.id===_editZoneId);if(!zone) return;
  zone.label=document.getElementById('zone-label-input').value.trim();
  const cr=document.getElementById('zone-color-row');
  zone.fill=cr.dataset.fill;zone.border=cr.dataset.border;
  modalZone.hidden=true;renderAndSave();showStatus('Zone saved');
});
document.getElementById('modal-zone-cancel').addEventListener('click',()=>{modalZone.hidden=true;});
document.getElementById('modal-zone-close').addEventListener('click',  ()=>{modalZone.hidden=true;});

/* ── Nodes ── */
function renderNodes(){
  const existing=new Set([...nodesGroup.querySelectorAll('[data-nid]')].map(e=>e.dataset.nid));
  const current=new Set(state.nodes.map(n=>n.id));
  existing.forEach(id=>{if(!current.has(id)) nodesGroup.querySelector(`[data-nid="${id}"]`)?.remove();});
  const focus=state.focusNodeId?computeFocusSet(state.focusNodeId):null;
  state.nodes.forEach(node=>{
    let g=nodesGroup.querySelector(`[data-nid="${node.id}"]`);
    if(!g){g=svgEl('g',{'data-nid':node.id,class:'node'});nodesGroup.appendChild(g);attachNodeEvents(g,node);}
    g.innerHTML='';
    const col=getNodeColor(node),sel=state.selectedNodes.has(node.id),hit=state.searchMatches.has(node.id);
    if(node.type==='fn') drawFnNode(g,node,col,sel,hit);
    else drawCondNode(g,node,col,sel,hit);
    drawPorts(g,node);
    sel?g.classList.add('selected'):g.classList.remove('selected');
    g.style.opacity=(focus&&!focus.litNodes.has(node.id))?'0.15':'';
  });
}

function drawFnNode(g,node,col,sel,hit){
  const R=nodeRadius(node),sc=R/FN_R_BASE;
  const fs=Math.max(6,Math.round(11.5*sc)),sf=Math.max(5,Math.round(8.5*sc)),mc=Math.max(4,Math.round(13*sc));
  g.appendChild(svgEl('circle',{cx:node.x,cy:node.y,r:R+2,fill:'rgba(0,0,0,0.28)'}));
  if(hit){g.appendChild(svgEl('circle',{cx:node.x,cy:node.y,r:R+6,fill:'none',stroke:'#ffe066','stroke-width':2,opacity:0.7,'stroke-dasharray':'4 3'}));}
  const body=svgEl('circle',{cx:node.x,cy:node.y,r:R,fill:col.fill,stroke:hit?'#ffe066':col.border,'stroke-width':sel?2.5:hit?2.5:1.5,class:'node-body node-border'});
  if(sel||hit) body.setAttribute('filter','url(#glow)');
  g.appendChild(body);
  g.appendChild(svgEl('circle',{cx:node.x,cy:node.y,r:Math.max(3,R-6),fill:'none',stroke:col.border,'stroke-width':0.5,opacity:0.3}));
  g.appendChild(svgTxt('fn()',{x:node.x,y:node.y-R*0.18,'text-anchor':'middle','dominant-baseline':'middle',fill:col.border,'font-family':"'Martian Mono',monospace",'font-size':Math.max(5,fs-1),opacity:0.7}));
  g.appendChild(svgTxt(trunc(node.name||'function',mc),{x:node.x,y:node.y+R*0.16,'text-anchor':'middle','dominant-baseline':'middle',class:'node-label','font-size':fs}));
  if(node.returnType){
    const bw=Math.max(28,Math.round(48*sc)),by=node.y+R+13;
    g.appendChild(svgEl('rect',{x:node.x-bw/2,y:by-8,width:bw,height:16,rx:8,fill:'rgba(255,143,77,0.2)',stroke:'var(--edge-return)','stroke-width':0.8}));
    g.appendChild(svgTxt(trunc(node.returnType,Math.max(3,Math.round(8*sc))),{x:node.x,y:by+1,'text-anchor':'middle','dominant-baseline':'middle',class:'node-sublabel',fill:'var(--edge-return)','font-size':sf}));
  }
  if(node.params?.length>0){
    const bx=node.x-R-2,by=node.y-R+2;
    g.appendChild(svgEl('circle',{cx:bx,cy:by,r:9,fill:'rgba(124,111,247,0.25)',stroke:'var(--edge-param)','stroke-width':0.8}));
    g.appendChild(svgTxt(node.params.length,{x:bx,y:by+1,'text-anchor':'middle','dominant-baseline':'middle',class:'node-sublabel',fill:'var(--edge-param)','font-size':9}));
  }
}

function drawCondNode(g,node,col,sel,hit){
  const h=nodeRadius(node),sc=h/FN_R_BASE;
  const fs=Math.max(6,Math.round(11.5*sc)),mc=Math.max(3,Math.round(11*sc));
  const pts=`${node.x},${node.y-h} ${node.x+h},${node.y} ${node.x},${node.y+h} ${node.x-h},${node.y}`;
  g.appendChild(svgEl('polygon',{points:pts,fill:'rgba(0,0,0,0.3)',transform:'translate(2,3)'}));
  if(hit){const hp=`${node.x},${node.y-h-6} ${node.x+h+6},${node.y} ${node.x},${node.y+h+6} ${node.x-h-6},${node.y}`;g.appendChild(svgEl('polygon',{points:hp,fill:'none',stroke:'#ffe066','stroke-width':2,opacity:0.7,'stroke-dasharray':'4 3'}));}
  const body=svgEl('polygon',{points:pts,fill:col.fill,stroke:hit?'#ffe066':col.border,'stroke-width':sel?2.5:hit?2.5:1.5,class:'node-body node-border'});
  if(sel||hit) body.setAttribute('filter','url(#glow)');
  g.appendChild(body);
  g.appendChild(svgTxt('if',{x:node.x,y:node.y-h*0.22,'text-anchor':'middle','dominant-baseline':'middle',fill:col.border,'font-family':"'Martian Mono',monospace",'font-size':Math.max(5,fs-1),opacity:0.7}));
  g.appendChild(svgTxt(trunc(node.name||'condition',mc),{x:node.x,y:node.y+h*0.14,'text-anchor':'middle','dominant-baseline':'middle',class:'node-label','font-size':fs}));
  if(node.branches?.length>0){
    const bx=node.x+h+2,by=node.y-h+2;
    g.appendChild(svgEl('circle',{cx:bx,cy:by,r:9,fill:'rgba(247,217,111,0.25)',stroke:'var(--edge-cond)','stroke-width':0.8}));
    g.appendChild(svgTxt(node.branches.length,{x:bx,y:by+1,'text-anchor':'middle','dominant-baseline':'middle',class:'node-sublabel',fill:'var(--edge-cond)','font-size':9}));
  }
}

function drawPorts(g,node){
  const r=nodeRadius(node);
  [{dx:0,dy:-1,role:'io'},{dx:0,dy:1,role:'io'},{dx:-1,dy:0,role:'in'},{dx:1,dy:0,role:'out'}].forEach(p=>{
    const px=node.x+p.dx*(r+2),py=node.y+p.dy*(r+2);
    const pt=svgEl('circle',{cx:px,cy:py,r:4,class:`port port-${p.role}`,'data-nid':node.id});
    g.appendChild(pt);
    pt.addEventListener('mousedown',e=>{e.stopPropagation();startEdgeDrag(node,px,py);});
  });
}

/* ── Edges ── */
function edgeStrokeColor(edge){
  if(edge.color) return edge.color;
  return{call:'var(--edge-default)',return:'var(--edge-return)',param:'var(--edge-param)',cond:'var(--edge-cond)'}[edge.type]||'var(--edge-default)';
}

// Curved path for call/cond/param edges
function curved(x1,y1,x2,y2){
  const dx=x2-x1,dy=y2-y1,dist=Math.sqrt(dx*dx+dy*dy);
  const cp=Math.max(dist*0.45,40);
  const ax=Math.abs(dx),ay=Math.abs(dy);
  let cx1,cy1,cx2,cy2;
  if(ax>ay){cx1=x1+Math.sign(dx)*cp;cy1=y1;cx2=x2-Math.sign(dx)*cp;cy2=y2;}
  else{cx1=x1;cy1=y1+Math.sign(dy)*cp;cx2=x2;cy2=y2-Math.sign(dy)*cp;}
  return`M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`;
}
// Straight line for return edges
function straight(x1,y1,x2,y2){return`M${x1},${y1} L${x2},${y2}`;}

const COLOR_MAP={
  'var(--edge-default)':'#4de8b2','var(--edge-return)':'#ff8f4d',
  'var(--edge-param)':'#7c6ff7','var(--edge-cond)':'#f7d96f',
};
function resolveColor(c){return COLOR_MAP[c]||c;}

function ensureMarker(id,color){
  const defs=svg.querySelector('defs');
  if(defs.querySelector(`#${id}`)) return;
  const m=svgEl('marker',{id,markerWidth:8,markerHeight:8,refX:6,refY:3,orient:'auto'});
  m.appendChild(svgEl('path',{d:'M0,0 L0,6 L8,3 z',fill:color}));
  defs.appendChild(m);
}

function renderEdges(){
  const existing=new Set([...edgesGroup.querySelectorAll('[data-eid]')].map(e=>e.dataset.eid));
  const current=new Set(state.edges.map(e=>e.id));
  existing.forEach(id=>{if(!current.has(id)) edgesGroup.querySelector(`[data-eid="${id}"]`)?.remove();});
  const focus=state.focusNodeId?computeFocusSet(state.focusNodeId):null;
  state.edges.forEach(edge=>{
    const fn=state.nodes.find(n=>n.id===edge.from),tn=state.nodes.find(n=>n.id===edge.to);
    if(!fn||!tn) return;
    let g=edgesGroup.querySelector(`[data-eid="${edge.id}"]`);
    if(!g){g=svgEl('g',{'data-eid':edge.id});edgesGroup.appendChild(g);attachEdgeEvents(g,edge);}
    g.innerHTML='';
    const fp=nodeBorderPoint(fn,tn.x,tn.y),tp=nodeBorderPoint(tn,fn.x,fn.y);
    // Return = straight, everything else = curved
    const d=edge.type==='return'?straight(fp.x,fp.y,tp.x,tp.y):curved(fp.x,fp.y,tp.x,tp.y);
    const col=edgeStrokeColor(edge),resolvedCol=resolveColor(col);
    const markerId=`arrowhead-${resolvedCol.replace(/[#().,\s]/g,'')}`;
    ensureMarker(markerId,resolvedCol);
    g.appendChild(svgEl('path',{d,fill:'none',stroke:'transparent','stroke-width':16,class:'edge-hit'}));
    const path=svgEl('path',{d,class:`edge type-${edge.type}`,'marker-end':`url(#${markerId})`});
    path.style.stroke=col;
    if(edge.type==='return') path.setAttribute('stroke-dasharray','7 3');
    if(state.selectedEdge===edge.id){path.classList.add('selected');path.setAttribute('filter','url(#glow)');}
    g.appendChild(path);
    if(edge.label){
      const mx=(fp.x+tp.x)/2,my=(fp.y+tp.y)/2-12,lw=edge.label.length*6.5+10;
      g.appendChild(svgEl('rect',{x:mx-lw/2,y:my-9,width:lw,height:16,rx:3,class:'edge-label-bg'}));
      g.appendChild(svgTxt(edge.label,{x:mx,y:my+1,class:'edge-label'}));
    }
    g.style.opacity=(focus&&!focus.litEdges.has(edge.id))?'0.08':'';
  });
}

/* ── Node events ── */
let dragState=null;
function attachNodeEvents(g,node){
  g.addEventListener('mousedown',e=>{
    if(state.tool==='connect') return;
    e.stopPropagation();if(e.button!==0) return;
    if(e.shiftKey){state.selectedNodes.has(node.id)?state.selectedNodes.delete(node.id):state.selectedNodes.add(node.id);renderNodes();return;}
    if(!state.selectedNodes.has(node.id)){state.selectedNodes.clear();state.selectedNodes.add(node.id);state.selectedEdge=null;state.selectedZone=null;}
    const sp=svgPt(e.clientX,e.clientY),starts={};
    state.selectedNodes.forEach(id=>{const n=state.nodes.find(nn=>nn.id===id);if(n) starts[id]={x:n.x,y:n.y};});
    dragState={type:'node',sp,starts,moved:false,nodeId:node.id};
    renderNodes();renderEdges();
  });
  g.addEventListener('mouseup',e=>{
    if(e.button!==0) return;
    if(dragState&&dragState.nodeId===node.id&&!dragState.moved) showInfoPanel(node.id);
  });
  g.addEventListener('dblclick',e=>{e.stopPropagation();openNodeModal(node.id);});
  g.addEventListener('contextmenu',e=>{
    e.preventDefault();
    showCtxMenu(e.clientX,e.clientY,[
      {label:'Edit',action:()=>openNodeModal(node.id)},
      {label:'Duplicate',action:()=>duplicateNode(node.id)},
      {sep:true},
      {label:'Delete',danger:true,action:()=>confirmDelete(()=>deleteNode(node.id))},
    ]);
  });
}

/* ── Info Panel ── */
function showInfoPanel(nodeId){
  const node=state.nodes.find(n=>n.id===nodeId);if(!node) return;
  _infoPanelNodeId=nodeId;
  state.focusNodeId=nodeId;
  render();
  infoPanelTitle.textContent=node.type==='fn'?'Function':'Conditional';
  infoPanel.classList.remove('info-panel--hidden');
  const R=Math.round(nodeRadius(node)),isOv=node.sizeOverride!=null;
  const typeIcon=node.type==='fn'
    ?`<svg width="11" height="11" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>`
    :`<svg width="11" height="11" viewBox="0 0 16 16"><path d="M8 2L14 8L8 14L2 8Z" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>`;
  let h='';
  h+=`<div class="ip-section" style="margin-bottom:10px"><span class="ip-type-chip ${node.type}">${typeIcon} ${node.type==='fn'?'function':'conditional'}</span></div>`;
  h+=`<div class="ip-section"><div class="ip-label">Name</div><div class="ip-value ip-name">${esc(node.name||'(unnamed)')}</div></div>`;
  h+=`<div class="ip-section"><div class="ip-label">Radius</div><div class="ip-size-tag"><span>${R}px</span>&nbsp;${isOv?`<span style="color:var(--accent-2);font-size:10px">● overridden</span>`:`<span style="color:var(--text-dimmer);font-size:10px">○ auto</span>`}</div></div>`;
  h+=`<div class="ip-divider"></div>`;
  if(node.type==='fn'){
    h+=`<div class="ip-section"><div class="ip-label">Parameters${node.params?.length?` <span class="ip-badge param">${node.params.length}</span>`:''}</div>`;
    if(node.params?.length>0){h+=`<ul class="ip-param-list">`;node.params.forEach(p=>{h+=`<li class="ip-param-item"><div class="ip-param-name">${esc(p.name||'(unnamed)')}</div>${p.type?`<div class="ip-param-type">: ${esc(p.type)}</div>`:''}${p.example?`<div class="ip-param-ex">= ${esc(p.example)}</div>`:''}</li>`;});h+=`</ul>`;}
    else{h+=`<div style="color:var(--text-dimmer);font-size:11px;font-family:var(--font-mono)">none</div>`;}
    h+=`</div>`;
    h+=`<div class="ip-section"><div class="ip-label">Returns</div>`;
    if(node.returnType){h+=`<div style="margin-top:2px"><span class="ip-badge">${esc(node.returnType)}</span></div>`;if(node.returnExample) h+=`<div style="color:var(--text-dimmer);font-size:11px;font-family:var(--font-mono);margin-top:5px">ex: ${esc(node.returnExample)}</div>`;}
    else{h+=`<div style="color:var(--text-dimmer);font-size:11px;font-family:var(--font-mono)">void</div>`;}
    h+=`</div>`;
  }else{
    if(node.branches?.length>0){h+=`<div class="ip-section"><div class="ip-label">Branches <span class="ip-badge cond">${node.branches.length}</span></div><ul class="ip-param-list">`;node.branches.forEach(b=>{h+=`<li class="ip-param-item"><div class="ip-param-name">${esc(b||'(unnamed)')}</div></li>`;});h+=`</ul></div>`;}
  }
  const callers=state.edges.filter(e=>e.to===node.id&&e.type==='call').map(e=>state.nodes.find(n=>n.id===e.from)).filter(Boolean);
  const callees=state.edges.filter(e=>e.from===node.id&&e.type==='call').map(e=>state.nodes.find(n=>n.id===e.to)).filter(Boolean);
  if(callers.length){h+=`<div class="ip-section"><div class="ip-label">Called by</div>`;callers.forEach(n=>{h+=`<div class="ip-value ip-nav-link" data-goto="${n.id}" style="font-size:11px">← ${esc(n.name||n.id)}</div>`;});h+=`</div>`;}
  if(callees.length){h+=`<div class="ip-section"><div class="ip-label">Calls</div>`;callees.forEach(n=>{h+=`<div class="ip-value ip-nav-link" data-goto="${n.id}" style="font-size:11px">→ ${esc(n.name||n.id)}</div>`;});h+=`</div>`;}
  if(node.notes){h+=`<div class="ip-divider"></div><div class="ip-section"><div class="ip-label">Notes</div><div class="ip-notes">${esc(node.notes)}</div></div>`;}
  h+=`<div class="ip-edit-btn"><button id="ip-edit-btn">✎&nbsp; Edit Node</button></div>`;
  infoPanelBody.innerHTML=h;
  infoPanelBody.querySelectorAll('.ip-nav-link[data-goto]').forEach(el=>{el.style.cursor='pointer';el.style.textDecoration='underline';el.addEventListener('click',()=>showInfoPanel(el.dataset.goto));});
  document.getElementById('ip-edit-btn')?.addEventListener('click',()=>openNodeModal(nodeId));
}
function hideInfoPanel(){infoPanel.classList.add('info-panel--hidden');_infoPanelNodeId=null;state.focusNodeId=null;render();}
document.getElementById('info-panel-close').addEventListener('click',hideInfoPanel);

/* ── Search ── */
function runSearch(query){
  state.searchMatches.clear();
  const q=query.trim().toLowerCase();
  if(q){state.nodes.forEach(node=>{if((node.name||'').toLowerCase().includes(q)||(node.notes||'').toLowerCase().includes(q)||node.params?.some(p=>(p.name||'').toLowerCase().includes(q)||(p.type||'').toLowerCase().includes(q))||(node.returnType||'').toLowerCase().includes(q)) state.searchMatches.add(node.id);});}
  const cnt=state.searchMatches.size;
  searchCount.textContent=q?(cnt?`${cnt} match${cnt>1?'es':''}`:' no matches'):'';
  searchCount.style.color=q&&!cnt?'var(--danger)':'var(--text-dimmer)';
  searchClear.style.opacity=q?'1':'0';searchClear.style.pointerEvents=q?'auto':'none';
  render();
  if(cnt>0) panToNode([...state.searchMatches][0]);
}
function panToNode(nodeId){
  const node=state.nodes.find(n=>n.id===nodeId);if(!node) return;
  const r=svg.getBoundingClientRect();
  state.pan.x=r.width/2-node.x*state.zoom;state.pan.y=r.height/2-node.y*state.zoom;
  applyTransform();
}
searchInput.addEventListener('input',()=>runSearch(searchInput.value));
searchInput.addEventListener('keydown',e=>{
  if(e.key==='Escape'){searchInput.value='';runSearch('');}
  if(e.key==='Enter'&&state.searchMatches.size>1){const ids=[...state.searchMatches];const cur=ids.findIndex(id=>state.selectedNodes.has(id));const next=ids[(cur+1)%ids.length];state.selectedNodes.clear();state.selectedNodes.add(next);renderNodes();panToNode(next);}
});
searchClear.addEventListener('click',()=>{searchInput.value='';runSearch('');searchInput.focus();});

/* ── Edge tooltip/events ── */
function showEdgeTip(e,edge){
  let h=`<div class="tt-type">${edge.type.toUpperCase()} edge</div>`;
  if(edge.dtype)   h+=`<div class="tt-data">type: <strong>${edge.dtype}</strong></div>`;
  if(edge.example) h+=`<div class="tt-example">ex: ${edge.example}</div>`;
  if(edge.label)   h+=`<div class="tt-data">label: ${edge.label}</div>`;
  if(!edge.dtype&&!edge.example&&!edge.label) h+=`<div class="tt-example">(double-click to edit)</div>`;
  edgeTooltip.innerHTML=h;edgeTooltip.hidden=false;moveEdgeTip(e);
}
function moveEdgeTip(e){edgeTooltip.style.left=(e.clientX+14)+'px';edgeTooltip.style.top=(e.clientY-8)+'px';}

function attachEdgeEvents(g,edge){
  let clickTimer=null;
  g.addEventListener('click',e=>{
    e.stopPropagation();
    clickTimer=setTimeout(()=>{state.selectedEdge=edge.id;state.selectedNodes.clear();state.selectedZone=null;renderEdges();renderNodes();renderZones();},200);
  });
  g.addEventListener('dblclick',e=>{e.stopPropagation();clearTimeout(clickTimer);edgeTooltip.hidden=true;openEdgeModal(edge.id);});
  g.addEventListener('mouseenter',e=>showEdgeTip(e,edge));
  g.addEventListener('mousemove', e=>moveEdgeTip(e));
  g.addEventListener('mouseleave',()=>{edgeTooltip.hidden=true;});
  g.addEventListener('contextmenu',e=>{
    e.preventDefault();
    showCtxMenu(e.clientX,e.clientY,[
      {label:'Edit Edge',action:()=>openEdgeModal(edge.id)},
      {sep:true},
      {label:'Delete Edge',danger:true,action:()=>{state.edges=state.edges.filter(ee=>ee.id!==edge.id);renderAndSave();}},
    ]);
  });
}

/* ── Edge drag ── */
// Move dragEdge into edgesGroup so it shares the pan+zoom transform.
// In HTML it sits directly in <svg> (no transform), causing the preview
// path to be offset whenever pan/zoom != identity.
edgesGroup.appendChild(dragEdge);

let edgeDrag=null;
function startEdgeDrag(fromNode,px,py){
  edgeDrag={fromNode,px,py};
  dragEdge.setAttribute('opacity','1');
  dragEdge.setAttribute('d',`M${px},${py} L${px},${py}`);
}

/* ── Zone drag-to-create ── */
let zoneDraw=null; // drawing a new zone
function startZoneDraw(pt){
  const z={id:uid(),x:pt.x,y:pt.y,w:0,h:0,label:'',fill:ZONE_PRESETS[0].fill,border:ZONE_PRESETS[0].border};
  state.zones.push(z);
  zoneDraw={zone:z,sx:pt.x,sy:pt.y};
  render();
}

/* ── Selection box (screen-space div) ── */
let panning=false,panStart=null,selBoxStart=null,selBoxEl=null;
function getOrMakeSelBox(){if(!selBoxEl){selBoxEl=document.createElement('div');selBoxEl.id='selection-box-div';canvasWrap.appendChild(selBoxEl);}return selBoxEl;}
function removeSelBox(){if(selBoxEl){selBoxEl.remove();selBoxEl=null;}}

/* ── Canvas mouse ── */
canvasWrap.addEventListener('mousedown',e=>{
  if(e.button===1||(e.button===0&&e.altKey)){panning=true;panStart={x:e.clientX-state.pan.x,y:e.clientY-state.pan.y};canvasWrap.classList.add('tool-pan');return;}
  if(state.tool==='fn'||state.tool==='cond'){
    const pt=svgPt(e.clientX,e.clientY);
    const node=createNode(state.tool,pt.x,pt.y);
    openNodeModal(node.id,true);setTool('select');return;
  }
  if(state.tool==='zone'&&(e.target===svg||e.target.id==='bg-grid')){
    const pt=svgPt(e.clientX,e.clientY);
    startZoneDraw(pt);return;
  }
  if(state.tool==='select'&&(e.target===svg||e.target.id==='bg-grid')){
    state.selectedNodes.clear();state.selectedEdge=null;state.selectedZone=null;
    const r=canvasWrap.getBoundingClientRect();
    selBoxStart={x:e.clientX-r.left,y:e.clientY-r.top};
    const box=getOrMakeSelBox();
    Object.assign(box.style,{left:selBoxStart.x+'px',top:selBoxStart.y+'px',width:'0',height:'0'});
    renderNodes();renderEdges();renderZones();
  }
});

document.addEventListener('mousemove',e=>{
  if(panning){state.pan.x=e.clientX-panStart.x;state.pan.y=e.clientY-panStart.y;applyTransform();return;}
  if(dragState&&dragState.type==='node'){
    const pt=svgPt(e.clientX,e.clientY),dx=pt.x-dragState.sp.x,dy=pt.y-dragState.sp.y;
    if(Math.sqrt(dx*dx+dy*dy)>3) dragState.moved=true;
    if(dragState.moved){state.selectedNodes.forEach(id=>{const n=state.nodes.find(nn=>nn.id===id);if(n&&dragState.starts[id]){n.x=dragState.starts[id].x+dx;n.y=dragState.starts[id].y+dy;}});render();}
    return;
  }
  if(zoneDragState){
    const pt=svgPt(e.clientX,e.clientY);
    zoneDragState.zone.x=zoneDragState.ox+(pt.x-zoneDragState.sp.x);
    zoneDragState.zone.y=zoneDragState.oy+(pt.y-zoneDragState.sp.y);
    renderZones();return;
  }
  if(zoneResizeState){
    const pt=svgPt(e.clientX,e.clientY);
    zoneResizeState.zone.w=Math.max(60,zoneResizeState.ow+(pt.x-zoneResizeState.sp.x));
    zoneResizeState.zone.h=Math.max(40,zoneResizeState.oh+(pt.y-zoneResizeState.sp.y));
    renderZones();return;
  }
  if(zoneDraw){
    const pt=svgPt(e.clientX,e.clientY);
    zoneDraw.zone.x=Math.min(pt.x,zoneDraw.sx);
    zoneDraw.zone.y=Math.min(pt.y,zoneDraw.sy);
    zoneDraw.zone.w=Math.abs(pt.x-zoneDraw.sx);
    zoneDraw.zone.h=Math.abs(pt.y-zoneDraw.sy);
    renderZones();return;
  }
  if(edgeDrag){
    const pt=svgPt(e.clientX,e.clientY);
    dragEdge.setAttribute('d',curved(edgeDrag.px,edgeDrag.py,pt.x,pt.y));return;
  }
  if(selBoxStart&&selBoxEl){
    const r=canvasWrap.getBoundingClientRect(),cx=e.clientX-r.left,cy=e.clientY-r.top;
    const x=Math.min(selBoxStart.x,cx),y=Math.min(selBoxStart.y,cy),w=Math.abs(cx-selBoxStart.x),h=Math.abs(cy-selBoxStart.y);
    Object.assign(selBoxEl.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});
    const p0=svgPt(x+r.left,y+r.top),p1=svgPt(x+w+r.left,y+h+r.top);
    state.selectedNodes.clear();
    state.nodes.forEach(n=>{if(n.x>=p0.x&&n.x<=p1.x&&n.y>=p0.y&&n.y<=p1.y) state.selectedNodes.add(n.id);});
    renderNodes();
  }
});

document.addEventListener('mouseup',e=>{
  if(panning){panning=false;canvasWrap.classList.remove('tool-pan');}
  if(dragState){if(dragState.moved) persistSave();dragState=null;}
  if(zoneDragState){persistSave();zoneDragState=null;}
  if(zoneResizeState){persistSave();zoneResizeState=null;}
  if(zoneDraw){
    const z=zoneDraw.zone;
    if(z.w<20||z.h<20){state.zones=state.zones.filter(zz=>zz.id!==z.id);render();}
    else{renderAndSave();openZoneModal(z.id);}
    zoneDraw=null;setTool('select');
  }
  if(edgeDrag){
    const pt=svgPt(e.clientX,e.clientY);
    const target=state.nodes.find(n=>{if(n.id===edgeDrag.fromNode.id) return false;const dx=n.x-pt.x,dy=n.y-pt.y;return Math.sqrt(dx*dx+dy*dy)<nodeRadius(n)+10;});
    if(target){
      // Auto-infer edge type
      const autoType=inferEdgeType(edgeDrag.fromNode,target);
      const edge={id:uid(),from:edgeDrag.fromNode.id,to:target.id,type:autoType,dtype:'',example:'',label:'',color:''};
      state.edges.push(edge);renderAndSave();openEdgeModal(edge.id);
    }
    dragEdge.setAttribute('opacity','0');edgeDrag=null;
  }
  if(selBoxStart){selBoxStart=null;removeSelBox();}
});

canvasWrap.addEventListener('click',()=>{removeCtxMenu();});

/* ── Zoom ── */
canvasWrap.addEventListener('wheel',e=>{
  e.preventDefault();
  const r=svg.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
  const f=e.deltaY<0?1.1:0.9,nz=Math.max(0.15,Math.min(3,state.zoom*f));
  state.pan.x=mx-(mx-state.pan.x)*(nz/state.zoom);state.pan.y=my-(my-state.pan.y)*(nz/state.zoom);
  state.zoom=nz;applyTransform();persistSave();
},{passive:false});
document.getElementById('btn-zoom-in').addEventListener('click',()=>{state.zoom=Math.min(3,state.zoom*1.2);applyTransform();persistSave();});
document.getElementById('btn-zoom-out').addEventListener('click',()=>{state.zoom=Math.max(0.15,state.zoom*0.8);applyTransform();persistSave();});
document.getElementById('btn-fit').addEventListener('click',fitAll);

function fitAll(){
  if(!state.nodes.length&&!state.zones.length) return;
  const r=svg.getBoundingClientRect(),pad=80;
  let mnX=Infinity,mnY=Infinity,mxX=-Infinity,mxY=-Infinity;
  state.nodes.forEach(n=>{const rr=nodeRadius(n);mnX=Math.min(mnX,n.x-rr);mnY=Math.min(mnY,n.y-rr);mxX=Math.max(mxX,n.x+rr);mxY=Math.max(mxY,n.y+rr);});
  state.zones.forEach(z=>{mnX=Math.min(mnX,z.x);mnY=Math.min(mnY,z.y);mxX=Math.max(mxX,z.x+z.w);mxY=Math.max(mxY,z.y+z.h);});
  const w=mxX-mnX+pad*2,h=mxY-mnY+pad*2;
  state.zoom=Math.max(0.15,Math.min(3,Math.min(r.width/w,r.height/h)));
  state.pan.x=(r.width-w*state.zoom)/2-(mnX-pad)*state.zoom;
  state.pan.y=(r.height-h*state.zoom)/2-(mnY-pad)*state.zoom;
  applyTransform();persistSave();
}

/* ── CRUD ── */
function createNode(type,x,y){
  const node={id:uid(),type,x,y,name:'',params:[],returnType:'',returnExample:'',branches:['if','else'],color:'',notes:'',sizeOverride:null};
  state.nodes.push(node);render();return node;
}
function duplicateNode(id){
  const src=state.nodes.find(n=>n.id===id);if(!src) return;
  const node=JSON.parse(JSON.stringify(src));node.id=uid();node.x+=60;node.y+=60;
  state.nodes.push(node);state.selectedNodes.clear();state.selectedNodes.add(node.id);renderAndSave();
}
function deleteNode(id){
  state.nodes=state.nodes.filter(n=>n.id!==id);
  state.edges=state.edges.filter(e=>e.from!==id&&e.to!==id);
  state.selectedNodes.delete(id);
  if(_infoPanelNodeId===id) hideInfoPanel();
  renderAndSave();
}

/* ── Node modal ── */
let _editNodeId=null,_isNew=false,_savedSize=null;
function openNodeModal(id,isNew=false){
  _editNodeId=id;_isNew=isNew;
  const node=state.nodes.find(n=>n.id===id);if(!node) return;
  _savedSize=node.sizeOverride??null;
  document.getElementById('modal-node-title').textContent=node.type==='fn'?(isNew?'New Function':'Edit Function'):(isNew?'New Conditional':'Edit Conditional');
  document.getElementById('node-name').value=node.name||'';
  document.getElementById('node-notes').value=node.notes||'';
  const fnF=document.getElementById('fn-fields'),condF=document.getElementById('cond-fields');
  if(node.type==='fn'){fnF.hidden=false;condF.hidden=true;document.getElementById('return-type').value=node.returnType||'';document.getElementById('return-example').value=node.returnExample||'';buildParamList(node.params||[]);}
  else{fnF.hidden=true;condF.hidden=false;buildBranchList(node.branches||['if','else']);}
  const slider=document.getElementById('node-size-slider'),sizeVal=document.getElementById('node-size-val');
  const autoR=Math.round(computeAutoRadius(node,new Set()));
  slider.value=node.sizeOverride!=null?node.sizeOverride:autoR;
  sizeVal.textContent=node.sizeOverride!=null?String(Math.round(node.sizeOverride)):'—';
  slider.oninput=()=>{const v=parseInt(slider.value);sizeVal.textContent=String(v);node.sizeOverride=v;render();if(_infoPanelNodeId===id)showInfoPanel(id);};
  document.getElementById('node-size-reset').onclick=()=>{node.sizeOverride=null;slider.value=autoR;sizeVal.textContent='—';render();if(_infoPanelNodeId===id)showInfoPanel(id);};
  buildColorPicker('node-color-row',NODE_COLORS.map(c=>c.fill),node.color||NODE_COLORS[node.type==='fn'?0:1].fill,true);
  modalNode.hidden=false;
  setTimeout(()=>document.getElementById('node-name').focus(),50);
}
function buildParamList(params){
  const list=document.getElementById('params-list');list.innerHTML='';
  params.forEach((p,i)=>{
    const row=document.createElement('div');row.className='param-row';
    row.innerHTML=`<input type="text" class="field-input pn" placeholder="name"    value="${esc(p.name||'')}"/>
                   <input type="text" class="field-input pt" placeholder="type"    value="${esc(p.type||'')}"/>
                   <input type="text" class="field-input pe" placeholder="example" value="${esc(p.example||'')}"/>
                   <button class="btn-remove">✕</button>`;
    row.querySelector('.btn-remove').onclick=()=>{const nd=state.nodes.find(n=>n.id===_editNodeId);if(nd){nd.params.splice(i,1);buildParamList(nd.params);}};
    list.appendChild(row);
  });
}
function buildBranchList(branches){
  const list=document.getElementById('branches-list');list.innerHTML='';
  branches.forEach((b,i)=>{
    const row=document.createElement('div');row.className='branch-row';
    row.innerHTML=`<input type="text" class="field-input branch-name" placeholder="branch label" value="${esc(b||'')}"/>
                   <button class="btn-remove">✕</button>`;
    row.querySelector('.btn-remove').onclick=()=>{const nd=state.nodes.find(n=>n.id===_editNodeId);if(nd){nd.branches.splice(i,1);buildBranchList(nd.branches);}};
    list.appendChild(row);
  });
}
document.getElementById('add-param-btn').addEventListener('click',()=>{const nd=state.nodes.find(n=>n.id===_editNodeId);if(!nd) return;nd.params=nd.params||[];nd.params.push({name:'',type:'',example:''});buildParamList(nd.params);});
document.getElementById('add-branch-btn').addEventListener('click',()=>{const nd=state.nodes.find(n=>n.id===_editNodeId);if(!nd) return;nd.branches=nd.branches||[];nd.branches.push('');buildBranchList(nd.branches);});
function saveNodeModal(){
  const node=state.nodes.find(n=>n.id===_editNodeId);if(!node) return;
  node.name=document.getElementById('node-name').value.trim()||(node.type==='fn'?'function':'condition');
  node.notes=document.getElementById('node-notes').value.trim();
  if(node.type==='fn'){node.params=[...document.querySelectorAll('#params-list .param-row')].map(r=>({name:r.querySelector('.pn').value.trim(),type:r.querySelector('.pt').value.trim(),example:r.querySelector('.pe').value.trim()})).filter(p=>p.name||p.type);node.returnType=document.getElementById('return-type').value.trim();node.returnExample=document.getElementById('return-example').value.trim();if(node.returnType) autoReturnEdge(node);}
  else{node.branches=[...document.querySelectorAll('#branches-list .branch-name')].map(i=>i.value.trim()).filter(Boolean);}
  const sv=document.getElementById('node-size-val');
  node.sizeOverride=sv.textContent==='—'?null:parseInt(document.getElementById('node-size-slider').value);
  node.color=getPickedColor('node-color-row');
  modalNode.hidden=true;renderAndSave();
  if(_infoPanelNodeId===_editNodeId) showInfoPanel(_editNodeId);
  showStatus('Saved');
}
function cancelNodeModal(){
  if(_isNew){deleteNode(_editNodeId);}
  else{const nd=state.nodes.find(n=>n.id===_editNodeId);if(nd){nd.sizeOverride=_savedSize;render();}}
  modalNode.hidden=true;
}
document.getElementById('modal-node-save').addEventListener('click',pushHistory,true);
document.getElementById('modal-node-save').addEventListener('click',saveNodeModal);
document.getElementById('modal-node-cancel').addEventListener('click',cancelNodeModal);
document.getElementById('modal-node-close').addEventListener('click',cancelNodeModal);
function autoReturnEdge(node){
  state.edges.filter(e=>e.to===node.id&&e.type==='call').map(e=>e.from).forEach(cid=>{
    if(!state.edges.some(e=>e.from===node.id&&e.to===cid&&e.type==='return'))
      state.edges.push({id:uid(),from:node.id,to:cid,type:'return',dtype:node.returnType,example:node.returnExample,label:'',color:''});
  });
}

/* ── Edge modal ── */
let _editEdgeId=null;
function openEdgeModal(id){
  _editEdgeId=id;
  const edge=state.edges.find(e=>e.id===id);if(!edge) return;
  document.querySelectorAll('#edge-type-group input').forEach(r=>{r.checked=r.value===edge.type;});
  document.getElementById('edge-dtype').value=edge.dtype||'';
  document.getElementById('edge-example').value=edge.example||'';
  document.getElementById('edge-label').value=edge.label||'';
  buildColorPicker('edge-color-row',EDGE_COLORS,edge.color||'',false);
  modalEdge.hidden=false;
}
document.getElementById('modal-edge-save').addEventListener('click',pushHistory,true);
document.getElementById('modal-edge-save').addEventListener('click',()=>{
  const edge=state.edges.find(e=>e.id===_editEdgeId);if(!edge) return;
  edge.type=document.querySelector('#edge-type-group input:checked')?.value||'call';
  edge.dtype=document.getElementById('edge-dtype').value.trim();
  edge.example=document.getElementById('edge-example').value.trim();
  edge.label=document.getElementById('edge-label').value.trim();
  edge.color=getPickedColor('edge-color-row');
  modalEdge.hidden=true;renderAndSave();
  if(_infoPanelNodeId) showInfoPanel(_infoPanelNodeId);
});
document.getElementById('modal-edge-cancel').addEventListener('click',()=>{modalEdge.hidden=true;});
document.getElementById('modal-edge-close').addEventListener('click', ()=>{modalEdge.hidden=true;});
document.getElementById('modal-edge-delete').addEventListener('click',()=>{state.edges=state.edges.filter(e=>e.id!==_editEdgeId);modalEdge.hidden=true;renderAndSave();});

/* ── Color picker ── */
function buildColorPicker(cid,colors,current,isNode){
  const c=document.getElementById(cid);c.innerHTML='';c.dataset.selected=current;
  colors.forEach(col=>{
    const sw=document.createElement('div');sw.className='color-swatch'+(col===current?' selected':'');sw.style.background=col;sw.style.borderColor=isNode?(NODE_COLORS.find(nc=>nc.fill===col)?.border||col):col;sw.dataset.color=col;
    sw.addEventListener('click',()=>{c.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('selected'));sw.classList.add('selected');c.dataset.selected=col;});c.appendChild(sw);
  });
  const cu=document.createElement('div');cu.className='color-swatch-custom';cu.title='Custom';cu.innerHTML=`<span>+</span><input type="color" value="${current||'#1a3a5c'}"/>`;
  cu.querySelector('input').addEventListener('input',e=>{const v=e.target.value;c.dataset.selected=v;cu.style.background=v;c.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('selected'));});
  c.appendChild(cu);
}
function getPickedColor(cid){return document.getElementById(cid).dataset.selected||'';}

/* ── Context menu ── */
function showCtxMenu(x,y,items){
  removeCtxMenu();
  const m=document.createElement('div');m.id='ctx-menu';
  items.forEach(item=>{
    if(item.sep){const s=document.createElement('div');s.className='ctx-sep';m.appendChild(s);return;}
    const b=document.createElement('button');b.textContent=item.label;if(item.danger) b.classList.add('ctx-danger');
    b.addEventListener('click',()=>{item.action();removeCtxMenu();});m.appendChild(b);
  });
  m.style.left=x+'px';m.style.top=y+'px';document.body.appendChild(m);
}
function removeCtxMenu(){document.getElementById('ctx-menu')?.remove();}

/* ── Confirm ── */
function confirmDelete(onOk,msg='Delete this?'){
  document.getElementById('confirm-msg').textContent=msg;modalConfirm.hidden=false;
  document.getElementById('confirm-ok').onclick=()=>{modalConfirm.hidden=true;onOk();};
  document.getElementById('confirm-cancel').onclick=()=>{modalConfirm.hidden=true;};
}

/* ── Toolbar ── */
document.getElementById('btn-select').addEventListener('click',  ()=>setTool('select'));
document.getElementById('btn-add-fn').addEventListener('click',  ()=>setTool('fn'));
document.getElementById('btn-add-cond').addEventListener('click',()=>setTool('cond'));
document.getElementById('btn-connect').addEventListener('click', ()=>setTool('connect'));
document.getElementById('btn-add-zone').addEventListener('click',()=>setTool('zone'));
document.getElementById('btn-delete').addEventListener('click',()=>{
  if(state.selectedZone){const zid=state.selectedZone;state.zones=state.zones.filter(z=>z.id!==zid);state.selectedZone=null;renderAndSave();return;}
  if(state.selectedNodes.size){confirmDelete(()=>{state.selectedNodes.forEach(id=>deleteNode(id));state.selectedNodes.clear();renderAndSave();},`Delete ${state.selectedNodes.size} node(s)?`);}
  else if(state.selectedEdge){state.edges=state.edges.filter(e=>e.id!==state.selectedEdge);state.selectedEdge=null;renderAndSave();}
});
document.getElementById('btn-clear').addEventListener('click',()=>{
  confirmDelete(()=>{state.nodes=[];state.edges=[];state.zones=[];state.selectedNodes.clear();state.selectedEdge=null;state.selectedZone=null;hideInfoPanel();renderAndSave();},'Clear entire canvas?');
});

/* ── Keyboard ── */
document.addEventListener('keydown',e=>{
  if(e.target===searchInput) return;
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  const k=e.key.toLowerCase();
  if(k==='v') setTool('select');
  if(k==='f') setTool('fn');
  if(k==='c') setTool('cond');
  if(k==='e') setTool('connect');
  if(k==='z'&&!e.ctrlKey&&!e.metaKey) setTool('zone');
  if(k==='delete'||k==='backspace'){
    if(state.selectedZone){const zid=state.selectedZone;state.zones=state.zones.filter(z=>z.id!==zid);state.selectedZone=null;renderAndSave();}
    state.selectedNodes.forEach(id=>deleteNode(id));
    if(state.selectedEdge){state.edges=state.edges.filter(ee=>ee.id!==state.selectedEdge);state.selectedEdge=null;}
    state.selectedNodes.clear();renderAndSave();
  }
  if(k==='escape'){state.selectedNodes.clear();state.selectedEdge=null;state.selectedZone=null;modalNode.hidden=true;modalEdge.hidden=true;modalZone.hidden=true;modalConfirm.hidden=true;hideInfoPanel();removeCtxMenu();searchInput.value='';runSearch('');render();}
  if((e.ctrlKey||e.metaKey)&&k==='a'){e.preventDefault();state.nodes.forEach(n=>state.selectedNodes.add(n.id));render();}
  if((e.ctrlKey||e.metaKey)&&k==='s'){e.preventDefault();saveFile();}
  if((e.ctrlKey||e.metaKey)&&k==='z'){e.preventDefault();undo();}
  if((e.ctrlKey||e.metaKey)&&k==='f'){e.preventDefault();searchInput.focus();searchInput.select();}
});

/* ── Undo ── */
const history=[],HMAX=40;
function pushHistory(){history.push(JSON.stringify({nodes:state.nodes,edges:state.edges,zones:state.zones,nextId:state.nextId}));if(history.length>HMAX) history.shift();}
document.getElementById('confirm-ok').addEventListener('click',pushHistory,true);
function undo(){
  if(!history.length){showStatus('Nothing to undo');return;}
  const s=JSON.parse(history.pop());
  state.nodes=s.nodes;state.edges=s.edges;state.zones=s.zones||[];state.nextId=s.nextId;
  state.selectedNodes.clear();state.selectedEdge=null;state.selectedZone=null;
  if(_infoPanelNodeId&&!state.nodes.find(n=>n.id===_infoPanelNodeId)) hideInfoPanel();
  else if(_infoPanelNodeId) showInfoPanel(_infoPanelNodeId);
  renderAndSave();showStatus('Undo');
}

/* ── Export/File ── */
document.getElementById('btn-export').addEventListener('click',()=>{
  const c=svg.cloneNode(true);c.setAttribute('width',svg.clientWidth);c.setAttribute('height',svg.clientHeight);
  const blob=new Blob([c.outerHTML],{type:'image/svg+xml'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='seestack.svg';a.click();URL.revokeObjectURL(url);
  showStatus('Exported SVG');
});
function saveFile(){
  const data=JSON.stringify({version:3,nodes:state.nodes,edges:state.edges,zones:state.zones,nextId:state.nextId,pan:state.pan,zoom:state.zoom},null,2);
  const blob=new Blob([data],{type:'application/json'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='diagram.seestack.json';a.click();URL.revokeObjectURL(url);
  showStatus('Saved');
}
document.getElementById('btn-save').addEventListener('click',saveFile);
document.getElementById('btn-load').addEventListener('click',()=>document.getElementById('file-load-input').click());
document.getElementById('file-load-input').addEventListener('change',e=>{
  const file=e.target.files[0];if(!file) return;
  const reader=new FileReader();
  reader.onload=ev=>{
    try{const d=JSON.parse(ev.target.result);pushHistory();state.nodes=d.nodes||[];state.edges=d.edges||[];state.zones=d.zones||[];state.nextId=d.nextId||100;if(d.pan){state.pan.x=d.pan.x;state.pan.y=d.pan.y;}if(d.zoom) state.zoom=d.zoom;state.selectedNodes.clear();state.selectedEdge=null;state.selectedZone=null;hideInfoPanel();renderAndSave();applyTransform();if(!d.pan) fitAll();showStatus('Loaded');}
    catch{showStatus('Error loading file');}
  };
  reader.readAsText(file);e.target.value='';
});

/* ── Minimap ── */
function drawMinimap(){
  const W=minimap.width,H=minimap.height;
  mmCtx.clearRect(0,0,W,H);mmCtx.fillStyle='#12151c';mmCtx.fillRect(0,0,W,H);
  if(!state.nodes.length&&!state.zones.length) return;
  let mnX=Infinity,mnY=Infinity,mxX=-Infinity,mxY=-Infinity;
  state.nodes.forEach(n=>{const r=nodeRadius(n);mnX=Math.min(mnX,n.x-r);mnY=Math.min(mnY,n.y-r);mxX=Math.max(mxX,n.x+r);mxY=Math.max(mxY,n.y+r);});
  state.zones.forEach(z=>{mnX=Math.min(mnX,z.x);mnY=Math.min(mnY,z.y);mxX=Math.max(mxX,z.x+z.w);mxY=Math.max(mxY,z.y+z.h);});
  if(mnX===Infinity) return;
  const pad=12,scX=(W-pad*2)/(mxX-mnX||1),scY=(H-pad*2)/(mxY-mnY||1),sc=Math.min(scX,scY);
  const ox=pad+((W-pad*2)-(mxX-mnX)*sc)/2,oy=pad+((H-pad*2)-(mxY-mnY)*sc)/2;
  const mm=(x,y)=>({x:ox+(x-mnX)*sc,y:oy+(y-mnY)*sc});
  // Zones
  state.zones.forEach(z=>{const p=mm(z.x,z.y);mmCtx.fillStyle=z.fill||'rgba(58,143,255,0.08)';mmCtx.strokeStyle=z.border||'rgba(58,143,255,0.35)';mmCtx.lineWidth=0.5;mmCtx.fillRect(p.x,p.y,z.w*sc,z.h*sc);mmCtx.strokeRect(p.x,p.y,z.w*sc,z.h*sc);});
  // Edges
  mmCtx.strokeStyle='rgba(77,232,178,0.3)';mmCtx.lineWidth=0.8;
  state.edges.forEach(edge=>{const fn=state.nodes.find(n=>n.id===edge.from),tn=state.nodes.find(n=>n.id===edge.to);if(!fn||!tn) return;const fp=mm(fn.x,fn.y),tp=mm(tn.x,tn.y);mmCtx.beginPath();mmCtx.moveTo(fp.x,fp.y);mmCtx.lineTo(tp.x,tp.y);mmCtx.stroke();});
  // Nodes
  state.nodes.forEach(n=>{const p=mm(n.x,n.y),col=getNodeColor(n),r=nodeRadius(n);mmCtx.fillStyle=col.fill;mmCtx.strokeStyle=state.searchMatches.has(n.id)?'#ffe066':col.border;mmCtx.lineWidth=0.8;if(n.type==='fn'){mmCtx.beginPath();mmCtx.arc(p.x,p.y,Math.max(2,r*sc),0,Math.PI*2);mmCtx.fill();mmCtx.stroke();}else{const s=Math.max(2,r*sc);mmCtx.beginPath();mmCtx.moveTo(p.x,p.y-s);mmCtx.lineTo(p.x+s,p.y);mmCtx.lineTo(p.x,p.y+s);mmCtx.lineTo(p.x-s,p.y);mmCtx.closePath();mmCtx.fill();mmCtx.stroke();}});
  const svgR=svg.getBoundingClientRect(),vp=mm(-state.pan.x/state.zoom,-state.pan.y/state.zoom);
  mmCtx.strokeStyle='rgba(77,232,178,0.5)';mmCtx.lineWidth=1;
  mmCtx.strokeRect(vp.x,vp.y,(svgR.width/state.zoom)*sc,(svgR.height/state.zoom)*sc);
}
minimap.addEventListener('click',e=>{
  const r=minimap.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
  const W=minimap.width,H=minimap.height;if(!state.nodes.length&&!state.zones.length) return;
  let mnX=Infinity,mnY=Infinity,mxX=-Infinity,mxY=-Infinity;
  state.nodes.forEach(n=>{const r=nodeRadius(n);mnX=Math.min(mnX,n.x-r);mnY=Math.min(mnY,n.y-r);mxX=Math.max(mxX,n.x+r);mxY=Math.max(mxY,n.y+r);});
  state.zones.forEach(z=>{mnX=Math.min(mnX,z.x);mnY=Math.min(mnY,z.y);mxX=Math.max(mxX,z.x+z.w);mxY=Math.max(mxY,z.y+z.h);});
  const pad=12,scX=(W-pad*2)/(mxX-mnX||1),scY=(H-pad*2)/(mxY-mnY||1),sc=Math.min(scX,scY);
  const ox=pad+((W-pad*2)-(mxX-mnX)*sc)/2,oy=pad+((H-pad*2)-(mxY-mnY)*sc)/2;
  const worldX=(mx-ox)/sc+mnX,worldY=(my-oy)/sc+mnY;
  const sr=svg.getBoundingClientRect();
  state.pan.x=sr.width/2-worldX*state.zoom;state.pan.y=sr.height/2-worldY*state.zoom;
  applyTransform();
});

/* ── Demo ── */
function loadDemo(){
  state.nodes=[
    {id:'n1',type:'fn',  x:220,y:250,name:'main',       params:[{name:'args',type:'string[]',example:'["--verbose"]'}],returnType:'void',        returnExample:'',branches:[],color:'',        notes:'Entry point',sizeOverride:null},
    {id:'n2',type:'fn',  x:460,y:140,name:'fetchData',  params:[{name:'url',type:'string',   example:'"https://api.example.com"'}],returnType:'Promise<Data>',returnExample:'{ id:1 }',branches:[],color:'',notes:'',sizeOverride:null},
    {id:'n3',type:'cond',x:460,y:360,name:'isValid?',   params:[],returnType:'',returnExample:'',branches:['true','false'],color:'',notes:'',sizeOverride:null},
    {id:'n4',type:'fn',  x:660,y:250,name:'processData',params:[{name:'data',type:'Data',    example:'{ id:1 }'}],    returnType:'Result',     returnExample:'{ status:"ok" }',branches:[],color:'',notes:'',sizeOverride:null},
    {id:'n5',type:'fn',  x:660,y:460,name:'handleError',params:[{name:'err',type:'Error',    example:'new Error("404")'}],returnType:'void',    returnExample:'',branches:[],color:'#3d1a1a',notes:'',sizeOverride:null},
    {id:'n6',type:'fn',  x:220,y:460,name:'render',     params:[{name:'result',type:'Result',example:'{ status:"ok" }'}],returnType:'void',    returnExample:'',branches:[],color:'#1a3d2e',notes:'',sizeOverride:null},
  ];
  state.edges=[
    {id:'e1',from:'n1',to:'n2',type:'call',  dtype:'string',      example:'"https://api.example.com"',label:'',      color:''},
    {id:'e2',from:'n2',to:'n1',type:'return',dtype:'Promise<Data>',example:'{ id:1 }',               label:'data',  color:''},
    {id:'e3',from:'n1',to:'n3',type:'cond',  dtype:'Data',        example:'{ id:1 }',                label:'',      color:''},
    {id:'e4',from:'n3',to:'n4',type:'call',  dtype:'boolean',     example:'true',                    label:'true',  color:''},
    {id:'e5',from:'n3',to:'n5',type:'call',  dtype:'boolean',     example:'false',                   label:'false', color:''},
    {id:'e6',from:'n4',to:'n1',type:'return',dtype:'Result',      example:'{ status:"ok" }',         label:'result',color:''},
    {id:'e7',from:'n1',to:'n6',type:'call',  dtype:'Result',      example:'{ status:"ok" }',         label:'',      color:''},
  ];
  state.zones=[
    {id:'z1',x:130,y:60, w:260,h:460,label:'Core',   fill:'rgba(77,232,178,0.06)',border:'rgba(77,232,178,0.25)'},
    {id:'z2',x:400,y:60, w:340,h:460,label:'Services',fill:'rgba(58,143,255,0.06)',border:'rgba(58,143,255,0.25)'},
  ];
  state.nextId=100;
}

/* ── Init ── */
if(!persistLoad()){loadDemo();}
// Double rAF ensures the browser has fully laid out the SVG before we
// apply the stored transform or compute fitAll — otherwise
// getBoundingClientRect() returns 0 and the view appears broken until
// the user interacts.
requestAnimationFrame(()=>{
  requestAnimationFrame(()=>{
    const hasSavedView = !!localStorage.getItem(LS_KEY);
    applyTransform();
    render();
    if(!hasSavedView) fitAll();
  });
});
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
