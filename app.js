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


function render(){renderZones();renderEdges();renderNodes();drawMinimap();renderLoops();}

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
  if(modalZone._loopZone){
    const zone=modalZone._loopZone,loop=modalZone._loopZoneLoop;
    zone.label=document.getElementById('zone-label-input').value.trim();
    const cr=document.getElementById('zone-color-row');
    zone.fill=cr.dataset.fill;zone.border=cr.dataset.border;
    modalZone._loopZone=null;modalZone._loopZoneLoop=null;
    modalZone.hidden=true;renderLoopGraph();persistSave();showStatus('Zone saved');
    return;
  }
  const zone=state.zones.find(z=>z.id===_editZoneId);if(!zone) return;
  zone.label=document.getElementById('zone-label-input').value.trim();
  const cr=document.getElementById('zone-color-row');
  zone.fill=cr.dataset.fill;zone.border=cr.dataset.border;
  modalZone.hidden=true;renderAndSave();showStatus('Zone saved');
});
document.getElementById('modal-zone-cancel').addEventListener('click',()=>{modalZone._loopZone=null;modalZone._loopZoneLoop=null;modalZone.hidden=true;});
document.getElementById('modal-zone-close').addEventListener('click',  ()=>{modalZone._loopZone=null;modalZone._loopZoneLoop=null;modalZone.hidden=true;});

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
function loopEnsureMarker(id,color){
  // Write markers into loop SVG defs so they resolve correctly inside loop-svg
  const loopDefs=loopSvg?loopSvg.querySelector('defs'):null;
  if(loopDefs){
    if(!loopDefs.querySelector(`#${id}`)){
      const m=svgEl('marker',{id,markerWidth:8,markerHeight:8,refX:6,refY:3,orient:'auto'});
      m.appendChild(svgEl('path',{d:'M0,0 L0,6 L8,3 z',fill:color}));
      loopDefs.appendChild(m);
    }
  } else {
    ensureMarker(id,color);
  }
}

function renderEdges(){
  const existing=new Set([...edgesGroup.querySelectorAll('[data-eid]')].map(e=>e.dataset.eid));
  const current=new Set(state.edges.map(e=>e.id));
  existing.forEach(id=>{if(!current.has(id)) edgesGroup.querySelector(`[data-eid="${id}"]`)?.remove();});
  const focus=state.focusNodeId?computeFocusSet(state.focusNodeId):null;
  state.edges.forEach(edge=>{
    const fn=state.nodes.find(n=>n.id===edge.from);
    let tn=state.nodes.find(n=>n.id===edge.to);
    // Compute border points — handle loop targets specially (rect shape)
    let fpFn=null, tpFn=null;
    let loopTarget=null;
    if(!tn){
      loopTarget=state.loops.find(l=>l.id===edge.to);
      if(loopTarget){
        const W=loopTarget.w||240,H=loopTarget.h||200;
        const cx=loopTarget.x+W/2, cy=loopTarget.y+H/2;
        // fake node just for fp computation
        tn={id:loopTarget.id,type:'fn',x:cx,y:cy,sizeOverride:0};
      }
    }
    if(!fn||!tn) return;

    let fp,tp;
    if(loopTarget){
      // fp = border of from-node toward loop center
      fp=nodeBorderPoint(fn,tn.x,tn.y);
      // tp = intersection of line (fn.x,fn.y)->(cx,cy) with loop rect border
      const W=loopTarget.w||240,H=loopTarget.h||200;
      const lx=loopTarget.x,ly=loopTarget.y;
      const cx=lx+W/2,cy=ly+H/2;
      tp=rectBorderPoint(lx,ly,W,H,fn.x,fn.y);
    } else {
      fp=nodeBorderPoint(fn,tn.x,tn.y);
      tp=nodeBorderPoint(tn,fn.x,fn.y);
    }

    let g=edgesGroup.querySelector(`[data-eid="${edge.id}"]`);
    if(!g){g=svgEl('g',{'data-eid':edge.id});edgesGroup.appendChild(g);attachEdgeEvents(g,edge);}
    g.innerHTML='';
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

// Returns point on rect border closest to (fromX,fromY) from rect center
function rectBorderPoint(rx,ry,rw,rh,fromX,fromY){
  const cx=rx+rw/2,cy=ry+rh/2;
  const dx=fromX-cx,dy=fromY-cy;
  if(dx===0&&dy===0) return{x:cx,y:ry};
  const scaleX=dx!==0?(rw/2)/Math.abs(dx):Infinity;
  const scaleY=dy!==0?(rh/2)/Math.abs(dy):Infinity;
  const scale=Math.min(scaleX,scaleY);
  return{x:cx+dx*scale,y:cy+dy*scale};
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
    document.body.style.userSelect='none';
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
function showInfoPanel(nodeId,loop){
  // When loop context: render into the loop info panel; otherwise use main info panel
  const isLoopCtx=!!loop;
  let node=isLoopCtx?(loop.nodes||[]).find(n=>n.id===nodeId):null;
  if(!node) node=state.nodes.find(n=>n.id===nodeId);
  if(!node) return;

  // Choose which panel to populate
  const panel     = isLoopCtx ? loopInfoPanel      : infoPanel;
  const panelBody = isLoopCtx ? loopInfoPanelBody  : infoPanelBody;
  const panelTitle= isLoopCtx ? loopInfoPanelTitle : infoPanelTitle;

  if(!isLoopCtx){_infoPanelNodeId=nodeId;state.focusNodeId=nodeId;render();}

  panelTitle.textContent=node.type==='fn'?'Function':'Conditional';
  panel.classList.remove('info-panel--hidden');
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
  const edgeSrc=loop?(loop.edges||[]):state.edges;
  const nodeSrc=loop?(loop.nodes||[]):state.nodes;
  const callers=edgeSrc.filter(e=>e.to===node.id&&e.type==='call').map(e=>nodeSrc.find(n=>n.id===e.from)).filter(Boolean);
  const callees=edgeSrc.filter(e=>e.from===node.id&&e.type==='call').map(e=>nodeSrc.find(n=>n.id===e.to)).filter(Boolean);
  if(callers.length){h+=`<div class="ip-section"><div class="ip-label">Called by</div>`;callers.forEach(n=>{h+=`<div class="ip-value ip-nav-link" data-goto="${n.id}" style="font-size:11px">← ${esc(n.name||n.id)}</div>`;});h+=`</div>`;}
  if(callees.length){h+=`<div class="ip-section"><div class="ip-label">Calls</div>`;callees.forEach(n=>{h+=`<div class="ip-value ip-nav-link" data-goto="${n.id}" style="font-size:11px">→ ${esc(n.name||n.id)}</div>`;});h+=`</div>`;}
  if(node.notes){h+=`<div class="ip-divider"></div><div class="ip-section"><div class="ip-label">Notes</div><div class="ip-notes">${esc(node.notes)}</div></div>`;}
  h+=`<div class="ip-edit-btn"><button id="${isLoopCtx?'loop-':''}ip-edit-btn">✎&nbsp; Edit Node</button></div>`;
  panelBody.innerHTML=h;
  panelBody.querySelectorAll('.ip-nav-link[data-goto]').forEach(el=>{el.style.cursor='pointer';el.style.textDecoration='underline';el.addEventListener('click',()=>showInfoPanel(el.dataset.goto,loop));});
  panelBody.querySelector(`#${isLoopCtx?'loop-':''}ip-edit-btn`)?.addEventListener('click',()=>loop?openLoopNodeModal(nodeId,loop):openNodeModal(nodeId));
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
  if(dragState){if(dragState.moved) persistSave();dragState=null;document.body.style.userSelect='';}
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
    // Check if dropping onto a loop node (loop box on main canvas)
    const targetLoop=state.loops.find(l=>{
      const W=l.w||200,H=l.h||160;
      return pt.x>=l.x&&pt.x<=l.x+W&&pt.y>=l.y&&pt.y<=l.y+H;
    });
    if(targetLoop){
      // Edge to loop → always cond type
      const edge={id:uid(),from:edgeDrag.fromNode.id,to:targetLoop.id,type:'cond',dtype:'',example:'',label:'',color:''};
      state.edges.push(edge);renderAndSave();openEdgeModal(edge.id);
    } else {
      const target=state.nodes.find(n=>{if(n.id===edgeDrag.fromNode.id) return false;const dx=n.x-pt.x,dy=n.y-pt.y;return Math.sqrt(dx*dx+dy*dy)<nodeRadius(n)+10;});
      if(target){
        // Auto-infer edge type
        const autoType=inferEdgeType(edgeDrag.fromNode,target);
        const edge={id:uid(),from:edgeDrag.fromNode.id,to:target.id,type:autoType,dtype:'',example:'',label:'',color:''};
        state.edges.push(edge);renderAndSave();openEdgeModal(edge.id);
      }
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

/* ════════════════════════════════════════════════
   LOOP FEATURE
   ════════════════════════════════════════════════ */

/* ── State ── */
state.loops = state.loops || [];

/* ── Render loops on main canvas (in zonesGroup layer) ── */
function renderLoops(){
  // Remove stale
  [...zonesGroup.querySelectorAll('[data-lid]')].forEach(el=>{
    if(!state.loops.find(l=>l.id===el.dataset.lid)) el.remove();
  });
  state.loops.forEach(loop=>{
    let g=zonesGroup.querySelector(`[data-lid="${loop.id}"]`);
    if(!g){
      g=svgEl('g',{'data-lid':loop.id,'class':'loop-box-group'});
      zonesGroup.appendChild(g);
      attachLoopBoxEvents(g,loop);
    }
    g.innerHTML='';
    const sel=state.selectedZone===loop.id;
    const W=loop.w||240, H=loop.h||200;
    const HEADER=28, PAD=8;

    // Search hit highlight
    const hasSearchHit=state.loopSearchMatches&&state.loopSearchMatches.has(loop.id);
    if(hasSearchHit){
      g.appendChild(svgEl('rect',{x:loop.x-4,y:loop.y-4,width:W+8,height:H+8,rx:12,
        fill:'none',stroke:'#ffe066','stroke-width':2,opacity:0.7,'stroke-dasharray':'4 3','pointer-events':'none'}));
    }

    // Outer glow
    g.appendChild(svgEl('rect',{x:loop.x-2,y:loop.y-2,width:W+4,height:H+4,rx:11,
      fill:'none',stroke:'rgba(255,200,80,0.1)','stroke-width':5,'pointer-events':'none'}));

    // Main body
    const bodyRect=svgEl('rect',{x:loop.x,y:loop.y,width:W,height:H,rx:9,
      'class':'loop-box-rect',
      fill:'rgba(14,16,22,0.92)',
      stroke:sel?'rgba(255,200,80,0.95)':hasSearchHit?'#ffe066':'rgba(255,200,80,0.5)',
      'stroke-width':sel?2.5:1.8,'stroke-dasharray':'7 3'});
    g.appendChild(bodyRect);

    // Header bar
    g.appendChild(svgEl('rect',{x:loop.x,y:loop.y,width:W,height:HEADER,rx:9,
      fill:'rgba(255,200,80,0.1)','pointer-events':'none'}));
    g.appendChild(svgEl('rect',{x:loop.x,y:loop.y+HEADER-8,width:W,height:8,
      fill:'rgba(255,200,80,0.1)','pointer-events':'none'}));

    // ↺ icon
    const icon=svgEl('text',{x:loop.x+10,y:loop.y+HEADER-8,
      'font-size':15,'font-family':'sans-serif',fill:'#ffc850','pointer-events':'none',opacity:0.9});
    icon.textContent='↺';
    g.appendChild(icon);

    // Title
    const maxTitleChars=Math.floor((W-54)/7);
    g.appendChild(svgTxt(trunc(loop.label||'loop',maxTitleChars),{
      x:loop.x+28,y:loop.y+HEADER-8,
      'font-family':"'Martian Mono',monospace",'font-size':11,'font-weight':'600',
      fill:'#ffc850','pointer-events':'none',opacity:0.95}));

    // Search hit badge in header
    if(hasSearchHit){
      const hits=state.loopSearchMatches.get(loop.id);
      const n=hits.size;
      g.appendChild(svgEl('rect',{x:loop.x+W-46,y:loop.y+6,width:38,height:15,rx:7,
        fill:'rgba(255,224,102,0.2)',stroke:'rgba(255,224,102,0.5)','stroke-width':0.8,'pointer-events':'none'}));
      g.appendChild(svgTxt(`${n} hit${n>1?'s':''}`,{x:loop.x+W-27,y:loop.y+15,
        'text-anchor':'middle','font-family':"'DM Sans',sans-serif",'font-size':8,
        fill:'#ffe066','pointer-events':'none'}));
    }

    // ── Mini-preview of inner graph ──
    const previewX=loop.x+PAD, previewY=loop.y+HEADER+PAD;
    const previewW=W-PAD*2, previewH=H-HEADER-PAD*2;
    const nodes=loop.nodes||[], edges=loop.edges||[];

    // Clip rect for preview area
    const clipId=`lclip-${loop.id}`;
    let clipEl=svg.querySelector(`#${clipId}`);
    if(!clipEl){
      const defs=svg.querySelector('defs');
      clipEl=svgEl('clipPath',{id:clipId});
      defs.appendChild(clipEl);
    }
    clipEl.innerHTML='';
    clipEl.appendChild(svgEl('rect',{x:previewX,y:previewY,width:previewW,height:previewH,rx:4}));

    const previewG=svgEl('g',{'clip-path':`url(#${clipId})`,'pointer-events':'none'});
    g.appendChild(previewG);

    // Preview background
    previewG.appendChild(svgEl('rect',{x:previewX,y:previewY,width:previewW,height:previewH,rx:4,
      fill:'rgba(255,200,80,0.025)'}));

    if(nodes.length===0){
      // Empty state
      previewG.appendChild(svgTxt('empty — click to add nodes',{
        x:previewX+previewW/2,y:previewY+previewH/2,
        'text-anchor':'middle','dominant-baseline':'middle',
        'font-family':"'DM Sans',sans-serif",'font-size':9,
        fill:'rgba(255,200,80,0.3)'}));
    } else {
      // Compute bounds of inner nodes
      let mnX=Infinity,mnY=Infinity,mxX=-Infinity,mxY=-Infinity;
      nodes.forEach(n=>{
        const r=nodeRadius(n)+4;
        mnX=Math.min(mnX,n.x-r); mnY=Math.min(mnY,n.y-r);
        mxX=Math.max(mxX,n.x+r); mxY=Math.max(mxY,n.y+r);
      });
      const pad=12;
      const scX=(previewW-pad*2)/(mxX-mnX||1);
      const scY=(previewH-pad*2)/(mxY-mnY||1);
      const sc=Math.min(scX,scY,1); // never scale up, only down
      const ox=previewX+pad+((previewW-pad*2)-(mxX-mnX)*sc)/2;
      const oy=previewY+pad+((previewH-pad*2)-(mxY-mnY)*sc)/2;
      const mp=(x,y)=>({x:ox+(x-mnX)*sc, y:oy+(y-mnY)*sc});

      // Draw edges first
      edges.forEach(edge=>{
        const fn=nodes.find(n=>n.id===edge.from),tn=nodes.find(n=>n.id===edge.to);
        if(!fn||!tn) return;
        const fp=mp(fn.x,fn.y),tp=mp(tn.x,tn.y);
        const edgeCol=edge.color||{call:'rgba(77,232,178,0.5)',return:'rgba(255,143,77,0.5)',param:'rgba(124,111,247,0.5)',cond:'rgba(247,217,111,0.5)'}[edge.type]||'rgba(77,232,178,0.5)';
        const path=svgEl('path',{
          d:`M${fp.x},${fp.y} L${tp.x},${tp.y}`,
          fill:'none',stroke:edgeCol,'stroke-width':1.2,opacity:0.7
        });
        previewG.appendChild(path);
      });

      // Draw nodes
      nodes.forEach(n=>{
        const r=Math.max(4, nodeRadius(n)*sc);
        const p=mp(n.x,n.y);
        const col=getNodeColor(n);
        const isLoopCond=n.id===loop.loopCondId;
        if(n.type==='fn'){
          // Circle
          previewG.appendChild(svgEl('circle',{cx:p.x,cy:p.y,r:r+1,fill:'rgba(0,0,0,0.3)'}));
          const circ=svgEl('circle',{cx:p.x,cy:p.y,r,
            fill:col.fill,stroke:isLoopCond?'#ffc850':col.border,'stroke-width':isLoopCond?1.5:1});
          previewG.appendChild(circ);
          // Label if big enough
          if(r>10){
            const fs=Math.max(6,Math.min(9,r*0.55));
            const lbl=svgTxt(trunc(n.name||'fn',Math.floor(r/3.5)),{
              x:p.x,y:p.y,'text-anchor':'middle','dominant-baseline':'middle',
              'font-family':"'DM Sans',sans-serif",'font-size':fs,fill:'rgba(255,255,255,0.75)',
            });
            previewG.appendChild(lbl);
          }
        } else {
          // Diamond
          const pts=`${p.x},${p.y-r} ${p.x+r},${p.y} ${p.x},${p.y+r} ${p.x-r},${p.y}`;
          previewG.appendChild(svgEl('polygon',{points:`${p.x},${p.y-r-1} ${p.x+r+1},${p.y} ${p.x},${p.y+r+1} ${p.x-r-1},${p.y}`,fill:'rgba(0,0,0,0.3)'}));
          previewG.appendChild(svgEl('polygon',{points:pts,
            fill:col.fill,stroke:isLoopCond?'#ffc850':col.border,'stroke-width':isLoopCond?1.5:1}));
          if(r>10){
            const fs=Math.max(6,Math.min(9,r*0.5));
            previewG.appendChild(svgTxt(trunc(n.name||'cond',Math.floor(r/3.5)),{
              x:p.x,y:p.y,'text-anchor':'middle','dominant-baseline':'middle',
              'font-family':"'DM Sans',sans-serif",'font-size':fs,fill:'rgba(255,255,255,0.75)',
            }));
          }
        }
        // Loop-condition gold dot
        if(isLoopCond){
          previewG.appendChild(svgEl('circle',{cx:p.x+r*0.7,cy:p.y-r*0.7,r:Math.max(2,r*0.28),
            fill:'#ffc850',opacity:0.9}));
        }
      });
    }

    // Preview border (drawn after clip content)
    g.appendChild(svgEl('rect',{x:previewX,y:previewY,width:previewW,height:previewH,rx:4,
      fill:'none',stroke:'rgba(255,200,80,0.2)','stroke-width':0.8,'pointer-events':'none'}));

    // Resize handle
    const hx=loop.x+W-6,hy=loop.y+H-6;
    const handle=svgEl('rect',{x:hx,y:hy,width:12,height:12,rx:2,
      fill:'rgba(255,200,80,0.5)','class':'zone-handle',cursor:'nwse-resize'});
    g.appendChild(handle);
    handle.addEventListener('mousedown',e=>{e.stopPropagation();startLoopResize(e,loop);});
  });
}

let loopResizeState=null, loopDragState=null;
function startLoopResize(e,loop){
  state.selectedZone=loop.id;
  const sp=svgPt(e.clientX,e.clientY);
  loopResizeState={loop,sp,ow:loop.w||200,oh:loop.h||160};
}

function attachLoopBoxEvents(g,loop){
  g.addEventListener('mousedown',e=>{
    if(state.tool!=='select') return;
    if(e.target.classList.contains('zone-handle')) return;
    e.stopPropagation(); if(e.button!==0) return;
    state.selectedZone=loop.id;
    state.selectedNodes.clear(); state.selectedEdge=null;
    renderLoops(); renderNodes(); renderEdges();
    const sp=svgPt(e.clientX,e.clientY);
    loopDragState={loop,sp,ox:loop.x,oy:loop.y};
  });
  g.addEventListener('click',e=>{
    e.stopPropagation();
    if(loopDragState&&loopDragState._moved) return;
    openLoopModal(loop.id);
  });
  g.addEventListener('dblclick',e=>{e.stopPropagation();openLoopModal(loop.id);});
  g.addEventListener('contextmenu',e=>{
    e.preventDefault();
    showCtxMenu(e.clientX,e.clientY,[
      {label:'Open Loop',action:()=>openLoopModal(loop.id)},
      {label:'Rename Loop',action:()=>renameLoop(loop.id)},
      {sep:true},
      {label:'Delete Loop',danger:true,action:()=>confirmDelete(()=>{
        state.loops=state.loops.filter(l=>l.id!==loop.id);
        if(state.selectedZone===loop.id) state.selectedZone=null;
        renderAndSave();
      })},
    ]);
  });
}

function renameLoop(id){
  const loop=state.loops.find(l=>l.id===id); if(!loop) return;
  const name=prompt('Loop name:',loop.label||'loop');
  if(name!=null){loop.label=name.trim()||'loop';renderAndSave();}
}

/* Hook loop drag/resize into existing mousemove/mouseup */
(function patchMouseHandlers(){
  const origMove=document.onmousemove; // not used — we use addEventListener
  // We'll intercept via our own handler added here
  document.addEventListener('mousemove',e=>{
    if(loopDragState){
      const pt=svgPt(e.clientX,e.clientY);
      const dx=pt.x-loopDragState.sp.x,dy=pt.y-loopDragState.sp.y;
      if(Math.sqrt(dx*dx+dy*dy)>3) loopDragState._moved=true;
      if(loopDragState._moved){
        loopDragState.loop.x=loopDragState.ox+dx;
        loopDragState.loop.y=loopDragState.oy+dy;
        renderLoops();
        renderEdges();
      }
    }
    if(loopResizeState){
      const pt=svgPt(e.clientX,e.clientY);
      loopResizeState.loop.w=Math.max(120,loopResizeState.ow+(pt.x-loopResizeState.sp.x));
      loopResizeState.loop.h=Math.max(80, loopResizeState.oh+(pt.y-loopResizeState.sp.y));
      renderLoops();
    }
  });
  document.addEventListener('mouseup',()=>{
    if(loopDragState){if(loopDragState._moved) persistSave(); loopDragState=null;}
    if(loopResizeState){persistSave(); loopResizeState=null;}
  });
})();

/* ── Create loop on canvas ── */
function createLoop(x,y){
  const label=prompt('Loop name:','loop');
  if(label===null) return; // cancelled
  const id=uid();
  const condId=uid();
  const loop={
    id, x, y, w:260, h:220, label:label.trim()||'loop',
    nodes:[{id:condId,type:'cond',x:130,y:100,name:'loop condition',
             params:[],returnType:'',returnExample:'',
             branches:['continue','break'],color:'#3d3519',notes:'Controls loop iteration',sizeOverride:null}],
    edges:[],
    loopCondId:condId,
  };
  state.loops.push(loop);
  renderAndSave();
  openLoopModal(id);
}

/* ── Tool button ── */
document.getElementById('btn-add-loop').addEventListener('click',()=>{
  // Place in center of viewport
  const r=svg.getBoundingClientRect();
  const pt=svgPt(r.left+r.width/2, r.top+r.height/2);
  pushHistory();
  createLoop(pt.x-120,pt.y-100);
});

/* Hook 'L' key */
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  if(e.key.toLowerCase()==='l'&&!e.ctrlKey&&!e.metaKey){
    const r=svg.getBoundingClientRect();
    const pt=svgPt(r.left+r.width/2,r.top+r.height/2);
    pushHistory();
    createLoop(pt.x-120,pt.y-100);
  }
},true);

/* ── Patch render() to also render loops ── */
// render extended below

/* ── Patch renderAndSave to use new render ── */
// Already done since renderAndSave calls render()

/* ── Patch persistSave/persistLoad for loops ── */
function persistSave(){
  try{
    const raw=localStorage.getItem(LS_KEY);
    const existing=raw?JSON.parse(raw):{};
    localStorage.setItem(LS_KEY,JSON.stringify({
      version:4,
      nodes:state.nodes,edges:state.edges,zones:state.zones,
      loops:state.loops,
      nextId:state.nextId,pan:state.pan,zoom:state.zoom,
    }));
  }catch(e){console.warn('localStorage save failed',e);}
}
// Patch persistLoad to restore loops
// persistLoad patched below

/* ── Patch search to cover loop nodes ── */
function runSearch(query){
  state.searchMatches.clear();
  const q=query.trim().toLowerCase();
  if(q){
    state.nodes.forEach(node=>{
      if(nodeMatchesQuery(node,q)) state.searchMatches.add(node.id);
    });
    // Also mark loop nodes — store as "loopId:nodeId" in a parallel set
    if(!state.loopSearchMatches) state.loopSearchMatches=new Map(); // loopId -> Set<nodeId>
    state.loopSearchMatches.clear();
    state.loops.forEach(loop=>{
      const hits=new Set();
      (loop.nodes||[]).forEach(node=>{
        if(nodeMatchesQuery(node,q)) hits.add(node.id);
      });
      if(hits.size) state.loopSearchMatches.set(loop.id,hits);
    });
  } else {
    state.loopSearchMatches&&state.loopSearchMatches.clear();
  }
  // Count total matches
  const mainCnt=state.searchMatches.size;
  const loopCnt=state.loopSearchMatches?[...state.loopSearchMatches.values()].reduce((s,v)=>s+v.size,0):0;
  const cnt=mainCnt+loopCnt;
  searchCount.textContent=q?(cnt?`${cnt} match${cnt>1?'es':''}`:' no matches'):'';
  searchCount.style.color=q&&!cnt?'var(--danger)':'var(--text-dimmer)';
  searchClear.style.opacity=q?'1':'0';
  searchClear.style.pointerEvents=q?'auto':'none';
  // Render (will highlight loop boxes if they have matches)
  render();
  if(mainCnt>0) panToNode([...state.searchMatches][0]);
  else if(loopCnt>0){
    // Pan to the loop box
    const [loopId]=state.loopSearchMatches.keys();
    const loop=state.loops.find(l=>l.id===loopId);
    if(loop){
      const r=svg.getBoundingClientRect();
      state.pan.x=r.width/2-(loop.x+loop.w/2)*state.zoom;
      state.pan.y=r.height/2-(loop.y+loop.h/2)*state.zoom;
      applyTransform();
    }
  }
}
function nodeMatchesQuery(node,q){
  return (node.name||'').toLowerCase().includes(q)||
         (node.notes||'').toLowerCase().includes(q)||
         node.params?.some(p=>(p.name||'').toLowerCase().includes(q)||(p.type||'').toLowerCase().includes(q))||
         (node.returnType||'').toLowerCase().includes(q);
}

/* ── Patch renderLoops to highlight loops with search hits ── */
const _baseRenderLoops=renderLoops;
// Override already captured above — we'll patch inline in renderLoops at the rect stroke

/* Highlight loop boxes that have search hits:
   We patch renderLoops to add a glow when loopSearchMatches has that loop's id */
const _rlOrig=renderLoops;
// Already referencing loopSearchMatches inside renderLoops definition above would require
// a re-declare. Instead, patch by overriding after definition:
// search hit rendering handled inside renderLoops

/* Override render to use patched version */
// renderLoopsWithSearch called inside renderLoops


/* ════════════════════════════════════════════════
   LOOP SUB-GRAPH EDITOR
   ════════════════════════════════════════════════ */

let _activeLoopId=null;
let _loopStack=[]; // stack of {loop, parentLoop} for breadcrumb navigation

const loopModal=document.getElementById('modal-loop');
const loopSvg=document.getElementById('loop-svg');
const loopNodesG=document.getElementById('loop-nodes-g');
const loopEdgesG=document.getElementById('loop-edges-g');
const loopDragEdgeEl=document.getElementById('loop-drag-edge');
const loopCanvasWrap=document.getElementById('loop-canvas-wrap');
const loopZoomLabel=document.getElementById('loop-zoom-label');
const loopInfoPanel=document.getElementById('loop-info-panel');
const loopInfoPanelBody=document.getElementById('loop-info-panel-body');
const loopInfoPanelTitle=document.getElementById('loop-info-panel-title');
const loopBreadcrumb=document.getElementById('loop-breadcrumb');
document.getElementById('loop-info-panel-close').addEventListener('click',()=>{
  loopInfoPanel.classList.add('info-panel--hidden');
});
loopEdgesG.appendChild(loopDragEdgeEl);

const loopView={zoom:1,pan:{x:0,y:0}};
let loopTool='select';
let loopSelectedNodes=new Set(), loopSelectedEdge=null;
let loopDragNodeState=null, loopEdgeDrag=null, loopPanning=false, loopPanStart=null;
let loopZoneDraw=null, loopZoneDragState=null, loopZoneResizeState=null;

const loopZonesG=document.getElementById('loop-zones-g');
function applyLoopTransformFull(){
  const t=`translate(${loopView.pan.x},${loopView.pan.y}) scale(${loopView.zoom})`;
  loopZonesG.setAttribute('transform',t);
  loopNodesG.setAttribute('transform',t);
  loopEdgesG.setAttribute('transform',t);
  loopZoomLabel.textContent=`${Math.round(loopView.zoom*100)}%`;
}

function renderLoopZones(loop){
  loop.zones=loop.zones||[];
  const existing=new Set([...loopZonesG.querySelectorAll('[data-lzid]')].map(e=>e.dataset.lzid));
  const current=new Set(loop.zones.map(z=>z.id));
  existing.forEach(id=>{if(!current.has(id)) loopZonesG.querySelector(`[data-lzid="${id}"]`)?.remove();});
  loop.zones.forEach(zone=>{
    let g=loopZonesG.querySelector(`[data-lzid="${zone.id}"]`);
    if(!g){g=svgEl('g',{'data-lzid':zone.id});loopZonesG.appendChild(g);attachLoopZoneEvents(g,zone,loop);}
    g.innerHTML='';
    const rect=svgEl('rect',{x:zone.x,y:zone.y,width:zone.w,height:zone.h,rx:8,
      fill:zone.fill||'rgba(58,143,255,0.08)',
      stroke:zone.border||'rgba(58,143,255,0.35)',
      'stroke-width':1,'stroke-dasharray':'6 4'});
    g.appendChild(rect);
    if(zone.label){
      g.appendChild(svgTxt(zone.label,{x:zone.x+12,y:zone.y+20,'font-family':"'DM Sans',sans-serif",'font-size':13,'font-weight':'500',fill:zone.border||'rgba(58,143,255,0.8)',opacity:0.85,'pointer-events':'none'}));
    }
    const hx=zone.x+zone.w-6,hy=zone.y+zone.h-6;
    const handle=svgEl('rect',{x:hx,y:hy,width:12,height:12,rx:2,fill:zone.border||'rgba(58,143,255,0.5)',class:'zone-handle',cursor:'nwse-resize'});
    g.appendChild(handle);
    handle.addEventListener('mousedown',e=>{e.stopPropagation();const sp=loopSvgPt(e.clientX,e.clientY);loopZoneResizeState={zone,loop,sp,ow:zone.w,oh:zone.h};});
  });
}

function attachLoopZoneEvents(g,zone,loop){
  g.addEventListener('mousedown',e=>{
    if(loopTool!=='select') return;
    if(e.target.classList.contains('zone-handle')) return;
    e.stopPropagation(); if(e.button!==0) return;
    const sp=loopSvgPt(e.clientX,e.clientY);
    loopZoneDragState={zone,loop,sp,ox:zone.x,oy:zone.y};
  });
  g.addEventListener('dblclick',e=>{
    e.stopPropagation();
    openLoopZoneModal(zone,loop);
  });
  g.addEventListener('contextmenu',e=>{
    e.preventDefault();
    showCtxMenu(e.clientX,e.clientY,[
      {label:'Delete Zone',danger:true,action:()=>{loop.zones=loop.zones.filter(z=>z.id!==zone.id);renderLoopGraph();persistSave();}},
    ]);
  });
}

function openLoopZoneModal(zone,loop){
  // Reuse the main zone modal
  document.getElementById('zone-label-input').value=zone.label||'';
  buildZoneColorPicker('zone-color-row',zone.fill||ZONE_PRESETS[0].fill,zone.border||ZONE_PRESETS[0].border);
  modalZone._loopZone=zone;
  modalZone._loopZoneLoop=loop;
  modalZone.hidden=false;
  setTimeout(()=>document.getElementById('zone-label-input').focus(),50);
}
function startLoopZoneDraw(pt,loop){
  loop.zones=loop.zones||[];
  const z={id:uid(),x:pt.x,y:pt.y,w:0,h:0,label:'',fill:ZONE_PRESETS[Math.floor(Math.random()*ZONE_PRESETS.length)].fill,border:ZONE_PRESETS[Math.floor(Math.random()*ZONE_PRESETS.length)].border};
  // Use consistent preset
  const p=ZONE_PRESETS[loop.zones.length%ZONE_PRESETS.length];
  z.fill=p.fill;z.border=p.border;
  loop.zones.push(z);
  loopZoneDraw={zone:z,sx:pt.x,sy:pt.y,loop};
  renderLoopGraph();
}

function loopSvgPt(cx,cy){
  const r=loopSvg.getBoundingClientRect();
  return{x:(cx-r.left-loopView.pan.x)/loopView.zoom,y:(cy-r.top-loopView.pan.y)/loopView.zoom};
}
function applyLoopTransform(){
  const t=`translate(${loopView.pan.x},${loopView.pan.y}) scale(${loopView.zoom})`;
  loopZonesG.setAttribute('transform',t);
  loopNodesG.setAttribute('transform',t);
  loopEdgesG.setAttribute('transform',t);
  loopZoomLabel.textContent=`${Math.round(loopView.zoom*100)}%`;
}
function setLoopTool(t){
  loopTool=t;
  ['loop-btn-select','loop-btn-fn','loop-btn-cond','loop-btn-zone','loop-btn-loop','loop-btn-connect'].forEach(id=>{
    document.getElementById(id)?.classList.remove('active');
  });
  if(t==='select')  document.getElementById('loop-btn-select')?.classList.add('active');
  if(t==='fn')      document.getElementById('loop-btn-fn')?.classList.add('active');
  if(t==='cond')    document.getElementById('loop-btn-cond')?.classList.add('active');
  if(t==='zone')    document.getElementById('loop-btn-zone')?.classList.add('active');
  if(t==='loop')    document.getElementById('loop-btn-loop')?.classList.add('active');
  if(t==='connect') document.getElementById('loop-btn-connect')?.classList.add('active');
  loopCanvasWrap.style.cursor=(t==='connect'||t==='zone'||t==='loop')?'crosshair':'default';
}

function getActiveLoop(){
  if(_loopStack.length) return _loopStack[_loopStack.length-1];
  return state.loops.find(l=>l.id===_activeLoopId);
}

function renderLoopBreadcrumb(){
  if(!loopBreadcrumb) return;
  loopBreadcrumb.innerHTML='';
  // "Main" entry
  const main=document.createElement('span');
  main.className='loop-breadcrumb-item';
  main.textContent='Main';
  main.addEventListener('click',()=>{_loopStack=[];closeLoopModal();});
  loopBreadcrumb.appendChild(main);
  _loopStack.forEach((loop,i)=>{
    const sep=document.createElement('span');
    sep.className='loop-breadcrumb-sep';
    sep.textContent=' → ';
    loopBreadcrumb.appendChild(sep);
    const item=document.createElement('span');
    const isCurrent=i===_loopStack.length-1;
    item.className='loop-breadcrumb-item'+(isCurrent?' current':'');
    item.textContent=loop.label||'loop';
    if(!isCurrent){
      item.addEventListener('click',()=>{
        // Navigate up to this level
        _loopStack=_loopStack.slice(0,i+1);
        renderLoopCanvas();
      });
    }
    loopBreadcrumb.appendChild(item);
  });
}

function renderLoopCanvas(){
  const loop=getActiveLoop(); if(!loop) return;
  loop.nodes=loop.nodes||[];
  loop.edges=loop.edges||[];
  document.getElementById('loop-modal-name').textContent=loop.label||'loop';
  loopSelectedNodes.clear(); loopSelectedEdge=null;
  loopView.zoom=1; loopView.pan.x=0; loopView.pan.y=0;
  setLoopTool('select');
  loopZonesG.innerHTML='';loopNodesG.innerHTML='';loopEdgesG.innerHTML='';
  loopDragEdgeEl.setAttribute('opacity','0');
  loopEdgesG.appendChild(loopDragEdgeEl);
  if(loopInfoPanel) loopInfoPanel.classList.add('info-panel--hidden');
  renderLoopBreadcrumb();
  // Update close button label
  const closeBtn=document.getElementById('loop-btn-close');
  if(closeBtn) closeBtn.textContent=_loopStack.length>1?'↩ Back':'← Close Loop';
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      applyLoopTransform();
      renderLoopGraph();
      loopFitAll();
    });
  });
}

function openLoopModal(id){
  // Find loop in state.loops (top-level loops)
  const loop=state.loops.find(l=>l.id===id);
  if(!loop) return;
  _activeLoopId=id;
  _loopStack=[loop];
  loopModal.hidden=false;
  renderLoopCanvas();
}

function openSubLoopModal(sub){
  // Push sub-loop onto stack without adding to state.loops
  _loopStack.push(sub);
  renderLoopCanvas();
}

function closeLoopModal(){
  loopModal.hidden=true;
  _activeLoopId=null;
  _loopStack=[];
  loopZonesG.innerHTML='';
  loopNodesG.innerHTML='';
  loopEdgesG.innerHTML='';
  loopDragEdgeEl.setAttribute('opacity','0');
  loopEdgesG.appendChild(loopDragEdgeEl);
  loopSubLoopDragState=null;loopSubLoopResizeState=null;
  loopInfoPanel.classList.add('info-panel--hidden');
  persistSave();
  render();
}
document.getElementById('loop-btn-close').addEventListener('click',()=>{
  if(_loopStack.length>1){
    _loopStack.pop();
    renderLoopCanvas();
  } else {
    closeLoopModal();
  }
});

/* Rename from inside modal */
document.getElementById('loop-btn-rename').addEventListener('click',()=>{
  const loop=getActiveLoop(); if(!loop) return;
  const name=prompt('Loop name:',loop.label||'loop');
  if(name!=null){loop.label=name.trim()||'loop';document.getElementById('loop-modal-name').textContent=loop.label;renderLoopBreadcrumb();persistSave();}
});

/* ── Loop graph render ── */
function createSubLoop(pt,parentLoop){
  const label=prompt('Loop name:','loop');
  if(label===null) return;
  const condId=uid();
  const sub={
    id:uid(),x:pt.x,y:pt.y,w:200,h:160,label:label.trim()||'loop',
    nodes:[{id:condId,type:'cond',x:100,y:80,name:'loop condition',
             params:[],returnType:'',returnExample:'',
             branches:['continue','break'],color:'#3d3519',notes:'',sizeOverride:null}],
    edges:[],zones:[],subLoops:[],
    loopCondId:condId,
  };
  parentLoop.subLoops=parentLoop.subLoops||[];
  parentLoop.subLoops.push(sub);
  renderLoopGraph();persistSave();
}

function renderLoopSubLoops(loop){
  loop.subLoops=loop.subLoops||[];
  // Remove stale sub-loop elements
  [...loopNodesG.querySelectorAll('[data-slid]')].forEach(el=>{
    if(!loop.subLoops.find(s=>s.id===el.dataset.slid)) el.remove();
  });
  loop.subLoops.forEach(sub=>{
    let g=loopNodesG.querySelector(`[data-slid="${sub.id}"]`);
    if(!g){
      g=svgEl('g',{'data-slid':sub.id,'class':'loop-box-group'});
      loopNodesG.appendChild(g);
      attachSubLoopEvents(g,sub,loop);
    }
    g.innerHTML='';
    const W=sub.w||200,H=sub.h||160,HEADER=22,PAD=6;
    // Outer glow
    g.appendChild(svgEl('rect',{x:sub.x-2,y:sub.y-2,width:W+4,height:H+4,rx:9,
      fill:'none',stroke:'rgba(255,200,80,0.1)','stroke-width':4,'pointer-events':'none'}));
    // Body
    g.appendChild(svgEl('rect',{x:sub.x,y:sub.y,width:W,height:H,rx:7,
      fill:'rgba(14,16,22,0.88)',stroke:'rgba(255,200,80,0.45)','stroke-width':1.5,'stroke-dasharray':'6 3'}));
    // Header
    g.appendChild(svgEl('rect',{x:sub.x,y:sub.y,width:W,height:HEADER,rx:7,
      fill:'rgba(255,200,80,0.08)','pointer-events':'none'}));
    g.appendChild(svgEl('rect',{x:sub.x,y:sub.y+HEADER-6,width:W,height:6,
      fill:'rgba(255,200,80,0.08)','pointer-events':'none'}));
    const icon=svgEl('text',{x:sub.x+8,y:sub.y+HEADER-4,'font-size':12,'font-family':'sans-serif',fill:'#ffc850','pointer-events':'none',opacity:0.9});
    icon.textContent='↺';g.appendChild(icon);
    g.appendChild(svgTxt(trunc(sub.label||'loop',Math.floor((W-36)/6)),{
      x:sub.x+22,y:sub.y+HEADER-4,
      'font-family':"'Martian Mono',monospace",'font-size':9,'font-weight':'600',
      fill:'#ffc850','pointer-events':'none',opacity:0.9}));

    // ── Mini-preview of inner nodes ──
    const previewX=sub.x+PAD, previewY=sub.y+HEADER+PAD;
    const previewW=W-PAD*2, previewH=H-HEADER-PAD*2;
    const subNodes=sub.nodes||[], subEdges=sub.edges||[];
    // Clip path for sub-loop preview (use loopSvg defs)
    const clipId=`lsclip-${sub.id}`;
    const loopDefs=loopSvg.querySelector('defs');
    let clipEl=loopDefs.querySelector(`#${clipId}`);
    if(!clipEl){clipEl=svgEl('clipPath',{id:clipId});loopDefs.appendChild(clipEl);}
    clipEl.innerHTML='';
    clipEl.appendChild(svgEl('rect',{x:previewX,y:previewY,width:previewW,height:previewH,rx:4}));
    const previewG=svgEl('g',{'clip-path':`url(#${clipId})`,'pointer-events':'none'});
    g.appendChild(previewG);
    previewG.appendChild(svgEl('rect',{x:previewX,y:previewY,width:previewW,height:previewH,rx:4,fill:'rgba(255,200,80,0.025)'}));
    if(subNodes.length===0){
      previewG.appendChild(svgTxt('empty — dblclick to enter',{
        x:previewX+previewW/2,y:previewY+previewH/2,
        'text-anchor':'middle','dominant-baseline':'middle',
        'font-family':"'DM Sans',sans-serif",'font-size':8,fill:'rgba(255,200,80,0.3)'}));
    } else {
      let mnX=Infinity,mnY=Infinity,mxX=-Infinity,mxY=-Infinity;
      subNodes.forEach(n=>{const r=nodeRadius(n)+4;mnX=Math.min(mnX,n.x-r);mnY=Math.min(mnY,n.y-r);mxX=Math.max(mxX,n.x+r);mxY=Math.max(mxY,n.y+r);});
      const pad=10;
      const scX=(previewW-pad*2)/(mxX-mnX||1),scY=(previewH-pad*2)/(mxY-mnY||1);
      const sc=Math.min(scX,scY,1);
      const ox=previewX+pad+((previewW-pad*2)-(mxX-mnX)*sc)/2;
      const oy=previewY+pad+((previewH-pad*2)-(mxY-mnY)*sc)/2;
      const mp=(x,y)=>({x:ox+(x-mnX)*sc,y:oy+(y-mnY)*sc});
      subEdges.forEach(edge=>{
        const fn=subNodes.find(n=>n.id===edge.from),tn=subNodes.find(n=>n.id===edge.to);
        if(!fn||!tn) return;
        const fp=mp(fn.x,fn.y),tp=mp(tn.x,tn.y);
        const ec=edge.color||{call:'rgba(77,232,178,0.5)',return:'rgba(255,143,77,0.5)',param:'rgba(124,111,247,0.5)',cond:'rgba(247,217,111,0.5)'}[edge.type]||'rgba(77,232,178,0.5)';
        previewG.appendChild(svgEl('path',{d:`M${fp.x},${fp.y} L${tp.x},${tp.y}`,fill:'none',stroke:ec,'stroke-width':1.2,opacity:0.7}));
      });
      subNodes.forEach(n=>{
        const r=Math.max(4,nodeRadius(n)*sc),p=mp(n.x,n.y);
        const col=getNodeColor(n),isLC=n.id===sub.loopCondId;
        if(n.type==='fn'){
          previewG.appendChild(svgEl('circle',{cx:p.x,cy:p.y,r:r+1,fill:'rgba(0,0,0,0.3)'}));
          previewG.appendChild(svgEl('circle',{cx:p.x,cy:p.y,r,fill:col.fill,stroke:isLC?'#ffc850':col.border,'stroke-width':isLC?1.5:1}));
          if(r>10) previewG.appendChild(svgTxt(trunc(n.name||'fn',Math.floor(r/3.5)),{x:p.x,y:p.y,'text-anchor':'middle','dominant-baseline':'middle','font-family':"'DM Sans',sans-serif",'font-size':Math.max(6,Math.min(9,r*0.55)),fill:'rgba(255,255,255,0.75)'}));
        } else {
          const pts=`${p.x},${p.y-r} ${p.x+r},${p.y} ${p.x},${p.y+r} ${p.x-r},${p.y}`;
          previewG.appendChild(svgEl('polygon',{points:`${p.x},${p.y-r-1} ${p.x+r+1},${p.y} ${p.x},${p.y+r+1} ${p.x-r-1},${p.y}`,fill:'rgba(0,0,0,0.3)'}));
          previewG.appendChild(svgEl('polygon',{points:pts,fill:col.fill,stroke:isLC?'#ffc850':col.border,'stroke-width':isLC?1.5:1}));
          if(r>10) previewG.appendChild(svgTxt(trunc(n.name||'cond',Math.floor(r/3.5)),{x:p.x,y:p.y,'text-anchor':'middle','dominant-baseline':'middle','font-family':"'DM Sans',sans-serif",'font-size':Math.max(6,Math.min(9,r*0.5)),fill:'rgba(255,255,255,0.75)'}));
        }
        if(isLC) previewG.appendChild(svgEl('circle',{cx:p.x+r*0.7,cy:p.y-r*0.7,r:Math.max(2,r*0.28),fill:'#ffc850',opacity:0.9}));
      });
    }
    // Preview border
    g.appendChild(svgEl('rect',{x:previewX,y:previewY,width:previewW,height:previewH,rx:4,fill:'none',stroke:'rgba(255,200,80,0.2)','stroke-width':0.8,'pointer-events':'none'}));

    // Resize handle
    const hx=sub.x+W-6,hy=sub.y+H-6;
    const handle=svgEl('rect',{x:hx,y:hy,width:10,height:10,rx:2,
      fill:'rgba(255,200,80,0.5)',class:'zone-handle',cursor:'nwse-resize'});
    g.appendChild(handle);
    handle.addEventListener('mousedown',e=>{
      e.stopPropagation();
      const sp=loopSvgPt(e.clientX,e.clientY);
      loopSubLoopResizeState={sub,loop,sp,ow:sub.w,oh:sub.h};
    });
  });
}

let loopSubLoopDragState=null, loopSubLoopResizeState=null;

function attachSubLoopEvents(g,sub,loop){
  g.addEventListener('mousedown',e=>{
    if(loopTool!=='select') return;
    if(e.target.classList.contains('zone-handle')) return;
    e.stopPropagation(); if(e.button!==0) return;
    const sp=loopSvgPt(e.clientX,e.clientY);
    loopSubLoopDragState={sub,loop,sp,ox:sub.x,oy:sub.y};
  });
  g.addEventListener('dblclick',e=>{
    e.stopPropagation();
    openSubLoopModal(sub);
  });
  g.addEventListener('contextmenu',e=>{
    e.preventDefault();
    showCtxMenu(e.clientX,e.clientY,[
      {label:'Open Loop',action:()=>{
        openSubLoopModal(sub);
      }},
      {label:'Rename',action:()=>{
        const name=prompt('Loop name:',sub.label||'loop');
        if(name!=null){sub.label=name.trim()||'loop';renderLoopGraph();persistSave();}
      }},
      {sep:true},
      {label:'Delete Loop',danger:true,action:()=>{
        loop.subLoops=loop.subLoops.filter(s=>s.id!==sub.id);
        state.loops=state.loops.filter(l=>l.id!==sub.id);
        renderLoopGraph();persistSave();
      }},
    ]);
  });
}

function renderLoopGraph(){
  const loop=getActiveLoop(); if(!loop) return;
  renderLoopZones(loop);
  renderLoopSubLoops(loop);
  renderLoopEdges(loop);
  renderLoopNodes(loop);
  requestAnimationFrame(()=>renderLoops());
}

function renderLoopNodes(loop){
  const nodes=loop.nodes||[];
  const existing=new Set([...loopNodesG.querySelectorAll('[data-lnid]')].map(e=>e.dataset.lnid));
  const current=new Set(nodes.map(n=>n.id));
  existing.forEach(id=>{if(!current.has(id)) loopNodesG.querySelector(`[data-lnid="${id}"]`)?.remove();});
  const searchHits=(_activeLoopId&&state.loopSearchMatches)?state.loopSearchMatches.get(_activeLoopId)||new Set():new Set();
  nodes.forEach(node=>{
    let g=loopNodesG.querySelector(`[data-lnid="${node.id}"]`);
    if(!g){g=svgEl('g',{'data-lnid':node.id,'class':'node'});loopNodesG.appendChild(g);attachLoopNodeEvents(g,node,loop);}
    g.innerHTML='';
    const col=getNodeColor(node),sel=loopSelectedNodes.has(node.id),hit=searchHits.has(node.id);
    if(node.type==='fn') drawFnNode(g,node,col,sel,hit);
    else drawCondNode(g,node,col,sel,hit);
    drawLoopPorts(g,node);
    // Loop-condition badge
    if(node.id===loop.loopCondId){
      const r=nodeRadius(node);
      g.appendChild(svgEl('rect',{x:node.x-28,y:node.y-r-24,width:56,height:14,rx:7,
        fill:'rgba(255,200,80,0.2)',stroke:'rgba(255,200,80,0.5)','stroke-width':0.8}));
      g.appendChild(svgTxt('↺ condition',{x:node.x,y:node.y-r-14,'text-anchor':'middle',
        'font-family':"'DM Sans',sans-serif",'font-size':8,fill:'#ffc850','pointer-events':'none'}));
    }
  });
}

function drawLoopPorts(g,node){
  const r=nodeRadius(node);
  [{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}].forEach(p=>{
    const px=node.x+p.dx*(r+2),py=node.y+p.dy*(r+2);
    const pt=svgEl('circle',{cx:px,cy:py,r:4,'class':'port port-io','data-lnid':node.id});
    g.appendChild(pt);
    pt.addEventListener('mousedown',e=>{e.stopPropagation();startLoopEdgeDrag(node,px,py);});
  });
}

function renderLoopEdges(loop){
  const edges=loop.edges||[];
  const nodes=loop.nodes||[];
  const subLoops=loop.subLoops||[];
  const existing=new Set([...loopEdgesG.querySelectorAll('[data-leid]')].map(e=>e.dataset.leid));
  const current=new Set(edges.map(e=>e.id));
  existing.forEach(id=>{if(!current.has(id)) loopEdgesG.querySelector(`[data-leid="${id}"]`)?.remove();});
  edges.forEach(edge=>{
    const fn=nodes.find(n=>n.id===edge.from);
    let tn=nodes.find(n=>n.id===edge.to);
    let subTarget=null;
    if(!tn){
      // Check if target is a sub-loop box
      subTarget=subLoops.find(s=>s.id===edge.to);
      if(subTarget){
        const W=subTarget.w||200,H=subTarget.h||160;
        tn={id:subTarget.id,type:'fn',x:subTarget.x+W/2,y:subTarget.y+H/2,sizeOverride:0};
      }
    }
    if(!fn||!tn) return;
    let g=loopEdgesG.querySelector(`[data-leid="${edge.id}"]`);
    if(!g){g=svgEl('g',{'data-leid':edge.id});loopEdgesG.appendChild(g);attachLoopEdgeEvents(g,edge,loop);}
    g.innerHTML='';
    let fp,tp;
    if(subTarget){
      fp=nodeBorderPoint(fn,tn.x,tn.y);
      const W=subTarget.w||200,H=subTarget.h||160;
      tp=rectBorderPoint(subTarget.x,subTarget.y,W,H,fn.x,fn.y);
    } else {
      fp=nodeBorderPoint(fn,tn.x,tn.y);
      tp=nodeBorderPoint(tn,fn.x,fn.y);
    }
    const d=edge.type==='return'?straight(fp.x,fp.y,tp.x,tp.y):curved(fp.x,fp.y,tp.x,tp.y);
    const col=edgeStrokeColor(edge),resolvedCol=resolveColor(col);
    const markerId=`loop-arrowhead-${resolvedCol.replace(/[#().,\s]/g,'')}`;
    loopEnsureMarker(markerId,resolvedCol);
    g.appendChild(svgEl('path',{d,fill:'none',stroke:'transparent','stroke-width':16,'class':'edge-hit'}));
    const path=svgEl('path',{d,'class':`edge type-${edge.type}`,'marker-end':`url(#${markerId})`});
    path.style.stroke=col;
    if(edge.type==='return') path.setAttribute('stroke-dasharray','7 3');
    if(loopSelectedEdge===edge.id){path.classList.add('selected');path.setAttribute('filter','url(#loop-glow)');}
    g.appendChild(path);
    if(edge.label){
      const mx=(fp.x+tp.x)/2,my=(fp.y+tp.y)/2-12,lw=edge.label.length*6.5+10;
      g.appendChild(svgEl('rect',{x:mx-lw/2,y:my-9,width:lw,height:16,rx:3,'class':'edge-label-bg'}));
      g.appendChild(svgTxt(edge.label,{x:mx,y:my+1,'class':'edge-label'}));
    }
  });
}

/* ── Loop node events ── */
function attachLoopNodeEvents(g,node,loop){
  g.addEventListener('mousedown',e=>{
    if(loopTool==='connect') return;
    if(loopTool!=='select') return; // only drag in select mode
    e.stopPropagation(); if(e.button!==0) return;
    if(!loopSelectedNodes.has(node.id)){loopSelectedNodes.clear();loopSelectedNodes.add(node.id);loopSelectedEdge=null;}
    const sp=loopSvgPt(e.clientX,e.clientY);
    const starts={};
    loopSelectedNodes.forEach(id=>{const n=(loop.nodes||[]).find(nn=>nn.id===id);if(n) starts[id]={x:n.x,y:n.y};});
    loopDragNodeState={sp,starts,moved:false,nodeId:node.id,loop};
    document.body.style.userSelect='none';
    renderLoopNodes(loop);
  });
  g.addEventListener('mouseup',e=>{
    if(e.button!==0) return;
    if(loopDragNodeState&&loopDragNodeState.nodeId===node.id&&!loopDragNodeState.moved){
      showInfoPanel(node.id,loop);
    }
  });
  g.addEventListener('click',e=>{
    if(loopTool==='select'&&!loopDragNodeState?.moved){
      e.stopPropagation();
      if(!loopSelectedNodes.has(node.id)){loopSelectedNodes.clear();loopSelectedNodes.add(node.id);}
      renderLoopNodes(loop);
    }
  });
  g.addEventListener('dblclick',e=>{e.stopPropagation();openLoopNodeModal(node.id,loop);});
  g.addEventListener('contextmenu',e=>{
    e.preventDefault();
    const items=[
      {label:'Edit',action:()=>openLoopNodeModal(node.id,loop)},
      {sep:true},
    ];
    if(node.id!==loop.loopCondId){
      items.push({label:'Delete',danger:true,action:()=>{
        loop.nodes=loop.nodes.filter(n=>n.id!==node.id);
        loop.edges=(loop.edges||[]).filter(e=>e.from!==node.id&&e.to!==node.id);
        loopSelectedNodes.delete(node.id);renderLoopGraph();persistSave();
      }});
    }
    showCtxMenu(e.clientX,e.clientY,items);
  });
}

function attachLoopEdgeEvents(g,edge,loop){
  g.addEventListener('click',e=>{
    e.stopPropagation();
    loopSelectedEdge=edge.id;loopSelectedNodes.clear();
    renderLoopEdges(loop);renderLoopNodes(loop);
  });
  g.addEventListener('dblclick',e=>{
    e.stopPropagation();
    openLoopEdgeModal(edge.id,loop);
  });
  g.addEventListener('contextmenu',e=>{
    e.preventDefault();
    showCtxMenu(e.clientX,e.clientY,[
      {label:'Edit Edge',action:()=>openLoopEdgeModal(edge.id,loop)},
      {sep:true},
      {label:'Delete Edge',danger:true,action:()=>{
        loop.edges=(loop.edges||[]).filter(ee=>ee.id!==edge.id);
        loopSelectedEdge=null;renderLoopGraph();persistSave();
      }},
    ]);
  });
}

/* ── Loop node modal (reuse main modal) ── */
let _loopEditNodeId=null, _loopEditLoop=null, _loopIsNew=false, _loopSavedSize=null;
function openLoopNodeModal(nodeId,loop,isNew=false){
  _loopEditNodeId=nodeId; _loopEditLoop=loop; _loopIsNew=isNew;
  const node=(loop.nodes||[]).find(n=>n.id===nodeId); if(!node) return;
  _loopSavedSize=node.sizeOverride??null;
  document.getElementById('modal-node-title').textContent=node.type==='fn'?(isNew?'New Function':'Edit Function'):(isNew?'New Conditional':'Edit Conditional');
  document.getElementById('node-name').value=node.name||'';
  document.getElementById('node-notes').value=node.notes||'';
  const fnF=document.getElementById('fn-fields'),condF=document.getElementById('cond-fields');
  if(node.type==='fn'){fnF.hidden=false;condF.hidden=true;document.getElementById('return-type').value=node.returnType||'';document.getElementById('return-example').value=node.returnExample||'';buildParamList(node.params||[]);}
  else{fnF.hidden=true;condF.hidden=false;buildBranchList(node.branches||['if','else']);}
  const slider=document.getElementById('node-size-slider'),sizeVal=document.getElementById('node-size-val');
  // Compute auto radius in loop context (no parent size chain, just base)
  slider.value=node.sizeOverride!=null?node.sizeOverride:FN_R_BASE;
  sizeVal.textContent=node.sizeOverride!=null?String(Math.round(node.sizeOverride)):'—';
  slider.oninput=()=>{const v=parseInt(slider.value);sizeVal.textContent=String(v);node.sizeOverride=v;renderLoopGraph();};
  document.getElementById('node-size-reset').onclick=()=>{node.sizeOverride=null;slider.value=FN_R_BASE;sizeVal.textContent='—';renderLoopGraph();};
  buildColorPicker('node-color-row',NODE_COLORS.map(c=>c.fill),node.color||NODE_COLORS[node.type==='fn'?0:1].fill,true);
  // Signal we're editing a loop node
  _editNodeId=null; // prevent main modal save from firing on main graph
  modalNode._loopMode=true;
  modalNode.hidden=false;
  setTimeout(()=>document.getElementById('node-name').focus(),50);
}

/* Patch modal save to handle loop mode */
// saveNodeModal extended below
function saveNodeModal(){
  if(modalNode._loopMode&&_loopEditLoop){
    const node=(_loopEditLoop.nodes||[]).find(n=>n.id===_loopEditNodeId); if(!node){modalNode._loopMode=false;return;}
    node.name=document.getElementById('node-name').value.trim()||(node.type==='fn'?'function':'condition');
    node.notes=document.getElementById('node-notes').value.trim();
    if(node.type==='fn'){
      node.params=[...document.querySelectorAll('#params-list .param-row')].map(r=>({name:r.querySelector('.pn').value.trim(),type:r.querySelector('.pt').value.trim(),example:r.querySelector('.pe').value.trim()})).filter(p=>p.name||p.type);
      node.returnType=document.getElementById('return-type').value.trim();
      node.returnExample=document.getElementById('return-example').value.trim();
    } else {
      node.branches=[...document.querySelectorAll('#branches-list .branch-name')].map(i=>i.value.trim()).filter(Boolean);
    }
    const sv=document.getElementById('node-size-val');
    node.sizeOverride=sv.textContent==='—'?null:parseInt(document.getElementById('node-size-slider').value);
    node.color=getPickedColor('node-color-row');
    modalNode._loopMode=false;_loopEditNodeId=null;
    modalNode.hidden=true;
    renderLoopGraph();persistSave();showStatus('Saved');
    return;
  }
  modalNode._loopMode=false;
  // fall through to original save logic below
  const nodeLocal=state.nodes.find(n=>n.id===_editNodeId);if(!nodeLocal) return;
  nodeLocal.name=document.getElementById('node-name').value.trim()||(nodeLocal.type==='fn'?'function':'condition');
  nodeLocal.notes=document.getElementById('node-notes').value.trim();
  if(nodeLocal.type==='fn'){nodeLocal.params=[...document.querySelectorAll('#params-list .param-row')].map(r=>({name:r.querySelector('.pn').value.trim(),type:r.querySelector('.pt').value.trim(),example:r.querySelector('.pe').value.trim()})).filter(p=>p.name||p.type);nodeLocal.returnType=document.getElementById('return-type').value.trim();nodeLocal.returnExample=document.getElementById('return-example').value.trim();if(nodeLocal.returnType) autoReturnEdge(nodeLocal);}
  else{nodeLocal.branches=[...document.querySelectorAll('#branches-list .branch-name')].map(i=>i.value.trim()).filter(Boolean);}
  const svLocal=document.getElementById('node-size-val');
  nodeLocal.sizeOverride=svLocal.textContent==='—'?null:parseInt(document.getElementById('node-size-slider').value);
  nodeLocal.color=getPickedColor('node-color-row');
  modalNode.hidden=true;renderAndSave();
  if(_infoPanelNodeId===_editNodeId) showInfoPanel(_editNodeId);
  showStatus('Saved');
}

// cancelNodeModal extended below
function cancelNodeModal(){
  if(modalNode._loopMode){
    if(_loopIsNew&&_loopEditLoop){
      _loopEditLoop.nodes=(_loopEditLoop.nodes||[]).filter(n=>n.id!==_loopEditNodeId);
      _loopEditLoop.edges=(_loopEditLoop.edges||[]).filter(e=>e.from!==_loopEditNodeId&&e.to!==_loopEditNodeId);
    } else if(_loopEditLoop){
      const nd=(_loopEditLoop.nodes||[]).find(n=>n.id===_loopEditNodeId);
      if(nd) nd.sizeOverride=_loopSavedSize;
    }
    modalNode._loopMode=false;_loopEditNodeId=null;
    modalNode.hidden=true;
    renderLoopGraph();
    return;
  }
  modalNode._loopMode=false;
  // original cancel logic
  if(_isNew){deleteNode(_editNodeId);}
  else{const ndCancel=state.nodes.find(n=>n.id===_editNodeId);if(ndCancel){ndCancel.sizeOverride=_savedSize;render();}}
  modalNode.hidden=true;
}

/* ── Loop edge modal ── */
let _loopEditEdgeId=null, _loopEditEdgeLoop=null;
function openLoopEdgeModal(edgeId,loop){
  _loopEditEdgeId=edgeId; _loopEditEdgeLoop=loop;
  const edge=(loop.edges||[]).find(e=>e.id===edgeId); if(!edge) return;
  document.querySelectorAll('#edge-type-group input').forEach(r=>{r.checked=r.value===edge.type;});
  document.getElementById('edge-dtype').value=edge.dtype||'';
  document.getElementById('edge-example').value=edge.example||'';
  document.getElementById('edge-label').value=edge.label||'';
  buildColorPicker('edge-color-row',EDGE_COLORS,edge.color||'',false);
  modalEdge._loopMode=true;
  modalEdge.hidden=false;
}

/* Patch edge modal save */
const _origEdgeSave=document.getElementById('modal-edge-save').onclick;
document.getElementById('modal-edge-save').addEventListener('click',(ev)=>{
  if(modalEdge._loopMode&&_loopEditEdgeLoop){
    ev.stopImmediatePropagation();
    const edge=(_loopEditEdgeLoop.edges||[]).find(e=>e.id===_loopEditEdgeId); if(!edge){modalEdge._loopMode=false;return;}
    edge.type=document.querySelector('#edge-type-group input:checked')?.value||'call';
    edge.dtype=document.getElementById('edge-dtype').value.trim();
    edge.example=document.getElementById('edge-example').value.trim();
    edge.label=document.getElementById('edge-label').value.trim();
    edge.color=getPickedColor('edge-color-row');
    modalEdge._loopMode=false;_loopEditEdgeId=null;
    modalEdge.hidden=true;renderLoopGraph();persistSave();
  }
},true); // capture=true, stopImmediatePropagation prevents main handler

document.getElementById('modal-edge-delete').addEventListener('click',(ev)=>{
  if(modalEdge._loopMode&&_loopEditEdgeLoop){
    ev.stopImmediatePropagation();
    _loopEditEdgeLoop.edges=(_loopEditEdgeLoop.edges||[]).filter(e=>e.id!==_loopEditEdgeId);
    modalEdge._loopMode=false;_loopEditEdgeId=null;
    modalEdge.hidden=true;renderLoopGraph();persistSave();
  }
},true);

document.getElementById('modal-edge-cancel').addEventListener('click',()=>{modalEdge._loopMode=false;},true);
document.getElementById('modal-edge-close').addEventListener('click', ()=>{modalEdge._loopMode=false;},true);

/* ── Loop canvas interactions ── */
loopCanvasWrap.addEventListener('mousedown',e=>{
  if(e.button===1||(e.button===0&&e.altKey)){
    loopPanning=true;
    loopPanStart={x:e.clientX-loopView.pan.x,y:e.clientY-loopView.pan.y};
    return;
  }
  const loop=getActiveLoop(); if(!loop) return;
  if(loopTool==='fn'||loopTool==='cond'){
    const pt=loopSvgPt(e.clientX,e.clientY);
    const node={id:uid(),type:loopTool,x:pt.x,y:pt.y,name:'',params:[],returnType:'',returnExample:'',branches:['if','else'],color:'',notes:'',sizeOverride:null};
    loop.nodes=loop.nodes||[];
    loop.nodes.push(node);
    renderLoopGraph();
    openLoopNodeModal(node.id,loop,true);
    setLoopTool('select');
  }
  if(loopTool==='loop'){
    const pt=loopSvgPt(e.clientX,e.clientY);
    createSubLoop(pt,loop);
    setLoopTool('select');
  }
  if(loopTool==='zone'){
    const pt=loopSvgPt(e.clientX,e.clientY);
    startLoopZoneDraw(pt,loop);
  }
  if(loopTool==='select'){
    // Deselect when clicking canvas background
    const tgt=e.target;
    if(tgt.tagName==='rect'&&tgt.getAttribute('fill')==='url(#loop-grid-pat)'||tgt.tagName==='svg'){
      loopSelectedNodes.clear();loopSelectedEdge=null;
      renderLoopGraph();
    }
  }
});

document.addEventListener('mousemove',e=>{
  if(loopModal.hidden) return; // only handle when loop modal is open
  if(loopPanning&&!loopModal.hidden){
    loopView.pan.x=e.clientX-loopPanStart.x;
    loopView.pan.y=e.clientY-loopPanStart.y;
    applyLoopTransform();
    return;
  }
  if(loopZoneDragState){
    const pt=loopSvgPt(e.clientX,e.clientY);
    loopZoneDragState.zone.x=loopZoneDragState.ox+(pt.x-loopZoneDragState.sp.x);
    loopZoneDragState.zone.y=loopZoneDragState.oy+(pt.y-loopZoneDragState.sp.y);
    renderLoopZones(loopZoneDragState.loop);
    return;
  }
  if(loopZoneResizeState){
    const pt=loopSvgPt(e.clientX,e.clientY);
    loopZoneResizeState.zone.w=Math.max(60,loopZoneResizeState.ow+(pt.x-loopZoneResizeState.sp.x));
    loopZoneResizeState.zone.h=Math.max(40,loopZoneResizeState.oh+(pt.y-loopZoneResizeState.sp.y));
    renderLoopZones(loopZoneResizeState.loop);
    return;
  }
  if(loopSubLoopDragState){
    const pt=loopSvgPt(e.clientX,e.clientY);
    loopSubLoopDragState.sub.x=loopSubLoopDragState.ox+(pt.x-loopSubLoopDragState.sp.x);
    loopSubLoopDragState.sub.y=loopSubLoopDragState.oy+(pt.y-loopSubLoopDragState.sp.y);
    renderLoopSubLoops(loopSubLoopDragState.loop);
    return;
  }
  if(loopSubLoopResizeState){
    const pt=loopSvgPt(e.clientX,e.clientY);
    loopSubLoopResizeState.sub.w=Math.max(100,loopSubLoopResizeState.ow+(pt.x-loopSubLoopResizeState.sp.x));
    loopSubLoopResizeState.sub.h=Math.max(80,loopSubLoopResizeState.oh+(pt.y-loopSubLoopResizeState.sp.y));
    renderLoopSubLoops(loopSubLoopResizeState.loop);
    return;
  }
  if(loopZoneDraw){
    const pt=loopSvgPt(e.clientX,e.clientY);
    loopZoneDraw.zone.x=Math.min(pt.x,loopZoneDraw.sx);
    loopZoneDraw.zone.y=Math.min(pt.y,loopZoneDraw.sy);
    loopZoneDraw.zone.w=Math.abs(pt.x-loopZoneDraw.sx);
    loopZoneDraw.zone.h=Math.abs(pt.y-loopZoneDraw.sy);
    renderLoopZones(loopZoneDraw.loop);
    return;
  }
  if(loopDragNodeState){
    const pt=loopSvgPt(e.clientX,e.clientY);
    const dx=pt.x-loopDragNodeState.sp.x,dy=pt.y-loopDragNodeState.sp.y;
    if(Math.sqrt(dx*dx+dy*dy)>3) loopDragNodeState.moved=true;
    if(loopDragNodeState.moved){
      const loop=loopDragNodeState.loop;
      loopSelectedNodes.forEach(id=>{
        const n=(loop.nodes||[]).find(nn=>nn.id===id);
        if(n&&loopDragNodeState.starts[id]){n.x=loopDragNodeState.starts[id].x+dx;n.y=loopDragNodeState.starts[id].y+dy;}
      });
      renderLoopEdges(loop);
      renderLoopNodes(loop);
    }
    return;
  }
  if(loopEdgeDrag&&!loopModal.hidden){
    const pt=loopSvgPt(e.clientX,e.clientY);
    loopDragEdgeEl.setAttribute('d',curved(loopEdgeDrag.px,loopEdgeDrag.py,pt.x,pt.y));
  }
});

document.addEventListener('mouseup',e=>{
  if(loopPanning){loopPanning=false;}
  if(loopZoneDragState){persistSave();loopZoneDragState=null;}
  if(loopZoneResizeState){persistSave();loopZoneResizeState=null;}
  if(loopSubLoopDragState){persistSave();loopSubLoopDragState=null;}
  if(loopSubLoopResizeState){persistSave();loopSubLoopResizeState=null;}
  if(loopZoneDraw){
    const z=loopZoneDraw.zone,loop=loopZoneDraw.loop;
    if(z.w<20||z.h<20){loop.zones=loop.zones.filter(zz=>zz.id!==z.id);renderLoopGraph();}
    else{renderLoopGraph();persistSave();openLoopZoneModal(z,loop);}
    loopZoneDraw=null;setLoopTool('select');
  }
  if(loopDragNodeState){if(loopDragNodeState.moved) persistSave(); loopDragNodeState=null;document.body.style.userSelect='';}
  if(loopEdgeDrag&&!loopModal.hidden){
    const loop=getActiveLoop();
    if(loop){
      const pt=loopSvgPt(e.clientX,e.clientY);
      // Check regular nodes first
      const target=(loop.nodes||[]).find(n=>{
        if(n.id===loopEdgeDrag.fromNode.id) return false;
        const dx=n.x-pt.x,dy=n.y-pt.y;
        return Math.sqrt(dx*dx+dy*dy)<nodeRadius(n)+10;
      });
      if(target){
        const autoType=inferEdgeType(loopEdgeDrag.fromNode,target);
        const edge={id:uid(),from:loopEdgeDrag.fromNode.id,to:target.id,type:autoType,dtype:'',example:'',label:'',color:''};
        loop.edges=loop.edges||[];
        loop.edges.push(edge);
        renderLoopGraph();persistSave();
        openLoopEdgeModal(edge.id,loop);
      } else {
        // Check sub-loops as targets
        const subTarget=(loop.subLoops||[]).find(s=>{
          const W=s.w||200,H=s.h||160;
          return pt.x>=s.x&&pt.x<=s.x+W&&pt.y>=s.y&&pt.y<=s.y+H;
        });
        if(subTarget){
          const edge={id:uid(),from:loopEdgeDrag.fromNode.id,to:subTarget.id,type:'call',dtype:'',example:'',label:'',color:''};
          loop.edges=loop.edges||[];
          loop.edges.push(edge);
          renderLoopGraph();persistSave();
          openLoopEdgeModal(edge.id,loop);
        }
      }
    }
    loopDragEdgeEl.setAttribute('opacity','0');loopEdgeDrag=null;
  }
});

function startLoopEdgeDrag(fromNode,px,py){
  setLoopTool('connect');
  loopEdgeDrag={fromNode,px,py};
  loopDragEdgeEl.setAttribute('opacity','1');
  loopDragEdgeEl.setAttribute('d',`M${px},${py} L${px},${py}`);
}

/* ── Loop zoom ── */
loopCanvasWrap.addEventListener('click',()=>{removeCtxMenu();});
loopCanvasWrap.addEventListener('wheel',e=>{
  e.preventDefault();
  const r=loopSvg.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
  const f=e.deltaY<0?1.1:0.9,nz=Math.max(0.15,Math.min(3,loopView.zoom*f));
  loopView.pan.x=mx-(mx-loopView.pan.x)*(nz/loopView.zoom);
  loopView.pan.y=my-(my-loopView.pan.y)*(nz/loopView.zoom);
  loopView.zoom=nz;applyLoopTransform();
},{passive:false});
document.getElementById('loop-btn-zoom-in').addEventListener('click',()=>{loopView.zoom=Math.min(3,loopView.zoom*1.2);applyLoopTransform();});
document.getElementById('loop-btn-zoom-out').addEventListener('click',()=>{loopView.zoom=Math.max(0.15,loopView.zoom*0.8);applyLoopTransform();});
document.getElementById('loop-btn-fit').addEventListener('click',loopFitAll);
document.getElementById('loop-btn-select').addEventListener('click',()=>setLoopTool('select'));
document.getElementById('loop-btn-fn').addEventListener('click',()=>setLoopTool('fn'));
document.getElementById('loop-btn-cond').addEventListener('click',()=>setLoopTool('cond'));
document.getElementById('loop-btn-zone').addEventListener('click',()=>setLoopTool('zone'));
document.getElementById('loop-btn-loop').addEventListener('click',()=>setLoopTool('loop'));
document.getElementById('loop-btn-connect').addEventListener('click',()=>setLoopTool('connect'));

function loopFitAll(){
  const loop=getActiveLoop(); if(!loop||!(loop.nodes||[]).length) return;
  const r=loopSvg.getBoundingClientRect(),pad=80;
  let mnX=Infinity,mnY=Infinity,mxX=-Infinity,mxY=-Infinity;
  loop.nodes.forEach(n=>{const rr=nodeRadius(n);mnX=Math.min(mnX,n.x-rr);mnY=Math.min(mnY,n.y-rr);mxX=Math.max(mxX,n.x+rr);mxY=Math.max(mxY,n.y+rr);});
  const w=mxX-mnX+pad*2,h=mxY-mnY+pad*2;
  loopView.zoom=Math.max(0.15,Math.min(2.5,Math.min(r.width/w,r.height/h)));
  loopView.pan.x=(r.width-w*loopView.zoom)/2-(mnX-pad)*loopView.zoom;
  loopView.pan.y=(r.height-h*loopView.zoom)/2-(mnY-pad)*loopView.zoom;
  applyLoopTransform();
}

/* ── Loop keyboard shortcuts (active when modal open) ── */
document.addEventListener('keydown',e=>{
  if(loopModal.hidden) return;
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  const k=e.key.toLowerCase();
  if(k==='f') setLoopTool('fn');
  if(k==='c') setLoopTool('cond');
  if(k==='e') setLoopTool('connect');
  if(k==='v') setLoopTool('select');
  if(k==='z') setLoopTool('zone');
  if(k==='l') setLoopTool('loop');
  if(k==='escape'){closeLoopModal();}
  if(k==='delete'||k==='backspace'){
    const loop=getActiveLoop(); if(!loop) return;
    if(loopSelectedEdge){loop.edges=(loop.edges||[]).filter(ee=>ee.id!==loopSelectedEdge);loopSelectedEdge=null;renderLoopGraph();persistSave();}
    loopSelectedNodes.forEach(id=>{
      if(id===loop.loopCondId) return; // can't delete loop condition
      loop.nodes=(loop.nodes||[]).filter(n=>n.id!==id);
      loop.edges=(loop.edges||[]).filter(e=>e.from!==id&&e.to!==id);
    });
    loopSelectedNodes.clear();renderLoopGraph();persistSave();
  }
});

/* ── Patch persistLoad to restore loops ── */
// After load we ensure loops array exists and loopCondIds are valid
const _origPersistLoadFn=persistLoad;
persistLoad=function(){
  const ok=_origPersistLoadFn();
  if(ok){
    const raw=localStorage.getItem(LS_KEY);
    if(raw){
      try{const d=JSON.parse(raw);state.loops=d.loops||[];}
      catch{}
    }
  }
  return ok;
};

/* ── Patch saveFile / loadFile for loops ── */
const _origSaveFile=saveFile;
saveFile=function(){
  const data=JSON.stringify({version:4,nodes:state.nodes,edges:state.edges,zones:state.zones,loops:state.loops,nextId:state.nextId,pan:state.pan,zoom:state.zoom},null,2);
  const blob=new Blob([data],{type:'application/json'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='diagram.seestack.json';a.click();URL.revokeObjectURL(url);
  showStatus('Saved');
};

// Patch file load listener to restore loops
document.getElementById('file-load-input').addEventListener('change',e=>{
  // Additional restoration after the existing handler runs
  // We hook into the reader onload via event — easier to just patch persistLoad
  // The existing handler already calls persistLoad indirectly; loops are loaded there
},true);

/* ── Make sure loops survive the initial load ── */
// Override the post-init to patch loops
(function ensureLoopsOnLoad(){
  const raw=localStorage.getItem(LS_KEY);
  if(raw){try{const d=JSON.parse(raw);if(d.loops) state.loops=d.loops;}catch{}}
  else{state.loops=[];}
})();

// Patch file-load-input change to include loops
(function patchFileLoad(){
  const inp=document.getElementById('file-load-input');
  const listeners=inp.onchange; // existing registered via addEventListener
  inp.addEventListener('change',e=>{
    // fires after existing handler which sets state
    setTimeout(()=>{
      const raw=localStorage.getItem(LS_KEY);
      if(raw){try{const d=JSON.parse(raw);state.loops=d.loops||[];}catch{}}
      render();
    },50);
  });
})();

