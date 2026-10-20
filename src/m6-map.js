/*
 * m6-map —— 战棋地图（地图 / 地形 / 视野 / 寻路 / Token / 预设）
 * 覆盖：battlemap 战棋主体（状态常量 / 墙体与困难地形编辑含撤销 / 视图缩放平移 / 舞台内缩 /
 *       房间级 Token 权限 / 先攻与回合 / 条件标记 / 战损时间线 / 移动力 / 框选批量 / PNG 导出）
 *       → vision 迷雾 + VBL 视线遮挡 + renderMap → tokens Token 拖拽 / 测距路径 / 网格吸附
 *       → nav 寻路（几何原语 → 网格图 → Dijkstra → 预算钳制 → octile 距离）
 *       → overlay 可达区 / 墙体渲染 / 墙体选中删除 / 距离读数
 *       → presets Token ↔ 角色卡双向跳转 / 模板预设库快速布署。
 * 本文件是 www/index.html 的**源码**，不是产物。
 * 分块哨兵以 "@@ m6-map:<id> @@" 形式的注释行分隔，会被 coc-apk/build.js 识别；
 * 哨兵行本身不进入产物，块体按哨兵出现顺序内联回产物的对应位置。
 * （头注释里刻意不写出哨兵的完整字面量 —— 那个字面量自带注释结束符，会把本段注释提前闭合。）
 */
/*@@ m6-map:battlemap @@*/
/* ---------- battle map / 战棋地图 ---------- */
const CELL=26;
const MAP_TOKENS=[
  {id:'p1',name:'亚瑟',emoji:'🕵️',kind:'pc',x:120,y:330,hidden:false},
  {id:'p2',name:'莉娜',emoji:'🔫',kind:'pc',x:175,y:330,hidden:false},
  {id:'n1',name:'码头工',emoji:'🧑',kind:'npc',x:300,y:170,hidden:false},
  {id:'m1',name:'深潜者',emoji:'🦑',kind:'monster',x:330,y:430,hidden:true},
  {id:'m2',name:'教徒',emoji:'😈',kind:'monster',x:385,y:385,hidden:true}
];
let mapGm=false, mapFogOn=true, mapRuler=false, mapRulerFrom=null, mapSelectMode=false, mapGridOn=true, mapSnap=true; const mapSel=new Set();
let mapDamageLog=[]; // 战损时间线（GM 专有，随 map 同步）
let mapPath=[]; // 持久化测距路径：存 Token id 序列，Token 移动时标尺自动跟随
let mapWalls=[]; // 墙体/障碍/地形（Movement Layer，对标 MapTool MBL / Foundry 地形）：[{x1,y1,x2,y2}] 线段墙 | {type:'poly',pts} 不可通行区域 | {type:'terrain',cost,pts} 困难地形（可通行但消耗翻倍）；默认空 → 向后兼容
let mapWallMode=false; // GM 画墙模式开关
let mapObstacleMode=false; // GM 画障碍区域模式开关
let mapTerrainMode=false; // GM 画困难地形模式开关
let mapSelectedWall=-1; // GM 选中的墙/障碍/地形索引（-1 表示无）；用于可视化编辑（删除/拖动）
let mapWallUndo=[]; // 墙体编辑撤销栈（快照 JSON 字符串，上限 30 步，对标常见地图编辑器的 Undo）
const MAP_WALLS_LS='sg_map_walls'; // 墙体图层本地持久化（#238）：刷新/离线不丢墙
function saveMapWalls(){ try{ localStorage.setItem(MAP_WALLS_LS, JSON.stringify(mapWalls)); }catch(_){} }
function loadMapWalls(){ try{ const v=JSON.parse(localStorage.getItem(MAP_WALLS_LS)||'null'); if(Array.isArray(v)) mapWalls=v; }catch(_){} }
function pushWallUndo(){ if(!isGM()) return; mapWallUndo.push(JSON.stringify(mapWalls)); if(mapWallUndo.length>30) mapWallUndo.shift(); }
function commitWalls(){ saveMapWalls(); renderMap(); wsSyncMap(); } // 墙体变更统一收口：落盘 + 重绘 + 广播
function undoWalls(){ if(!isGM()) return false; if(!mapWallUndo.length){ toast('没有可撤销的墙体编辑'); return false; } mapWalls=JSON.parse(mapWallUndo.pop()); mapSelectedWall=-1; saveMapWalls(); renderMap(); wsSyncMap(); toast('已撤销上一步（还可撤销 '+mapWallUndo.length+' 步）'); return true; }
function clearWalls(){ if(!isGM()) return false; if(!mapWalls.length){ toast('地图上没有墙体/障碍/地形'); return false; } pushWallUndo(); mapWalls=[]; mapSelectedWall=-1; saveMapWalls(); renderMap(); wsSyncMap(); toast('已清空全部墙体/障碍/地形（可撤销）'); return true; }
function moveWallBy(idx,dx,dy){ // 平移已绘制元素（线段 / 多边形 / 地形）
  const w=mapWalls[idx]; if(!w) return;
  if(w.pts){ w.pts=w.pts.map(p=>({x:p.x+dx, y:p.y+dy})); }
  else { w.x1+=dx; w.y1+=dy; w.x2+=dx; w.y2+=dy; }
}
function dragSelectedWall(e){ // #240：命中已有元素后按住即可拖动平移；松手提交并记入撤销栈（点击但不拖动 = 仅选中）
  if(!isGM()) return false;
  const idx=mapSelectedWall; if(idx<0||idx>=mapWalls.length) return false;
  const snap=JSON.stringify(mapWalls);
  let last={x:e.clientX,y:e.clientY}, moved=false;
  const mv=ev=>{
    const b=toWorld(ev.clientX,ev.clientY), p=toWorld(last.x,last.y);
    const dx=b.x-p.x, dy=b.y-p.y;
    if(Math.abs(dx)<0.01 && Math.abs(dy)<0.01) return;
    moveWallBy(idx,dx,dy); moved=true; last={x:ev.clientX,y:ev.clientY}; renderWalls(); renderFog();
  };
  const up=()=>{
    document.removeEventListener('pointermove',mv); document.removeEventListener('pointerup',up);
    if(!moved) return;
    mapWallUndo.push(snap); if(mapWallUndo.length>30) mapWallUndo.shift();
    saveMapWalls(); renderMap(); wsSyncMap(); toast('已移动元素位置（可撤销）');
  };
  document.addEventListener('pointermove',mv); document.addEventListener('pointerup',up);
  return true;
}
/* ---------- 地形图层 + 缩放平移（#197） ---------- */
let mapZoom=1, mapPanX=0, mapPanY=0, mapPanMode=false, mapBg='';
const MAP_VIEW_LS='sg_map_view', MAP_BG_LS='sg_map_bg';
/* ---------- 先攻顺序 + 回合管理（#200） ---------- */
let mapInit=[];        // [{id,name,emoji,ini}] 按先攻值降序
let mapTurn=-1;        // 当前回合索引（mapInit 下标）；-1 = 未开始战斗
const COND_LIST=[ // Token 条件/状态标记（#201）
  {k:'中毒',e:'🤢'},{k:'束缚',e:'⛓️'},{k:'恐惧',e:'😱'},{k:'灼伤',e:'🔥'},
  {k:'减速',e:'🐌'},{k:'眩晕',e:'💫'},{k:'倒地',e:'🩸'},{k:'隐蔽',e:'🌫️'},
  {k:'鼓舞',e:'💚'},{k:'标记',e:'🎯'}
];
function loadMapView(){
  try{ const v=JSON.parse(localStorage.getItem(MAP_VIEW_LS)||'{}'); if(v&&typeof v==='object'){ mapZoom=+v.zoom||1; mapPanX=+v.panX||0; mapPanY=+v.panY||0; } }catch(_){}
  loadMapWalls(); // #238：恢复 GM 绘制的墙体/障碍/地形
  try{ mapBg=localStorage.getItem(MAP_BG_LS)||''; }catch(_){ mapBg=''; }
}
function saveMapView(){ try{ localStorage.setItem(MAP_VIEW_LS,JSON.stringify({zoom:mapZoom,panX:mapPanX,panY:mapPanY})); }catch(_){} }
function applyMapView(){
  const w=$('#mapWorld'); if(w) w.style.transform='translate('+mapPanX+'px,'+mapPanY+'px) scale('+mapZoom+')';
  const st=$('#mapStage'); if(st) st.classList.toggle('panning',mapPanMode);
  syncMapInsets();
}
/* 舞台内缩同步：顶栏/工具栏高度不是常数（工具栏按钮换行后 64→150+），
   实测后写入 --map-top-h / --map-toolbar-h，保证 .map-stage 与先攻条/批量条永不被工具栏压住。 */
function syncMapInsets(){
  const sc=$('#mapScreen'); if(!sc) return;
  try{
    const top=sc.querySelector('.map-top'), tb=sc.querySelector('.map-toolbar');
    const th=top?Math.ceil(top.getBoundingClientRect().height):56;
    const bh=tb?Math.ceil(tb.getBoundingClientRect().height):64;
    if(th>0) sc.style.setProperty('--map-top-h',th+'px');
    sc.style.setProperty('--map-toolbar-h',Math.max(56,bh)+'px');
  }catch(_){}
}
function applyMapBg(){ const im=$('#mapBgImg'); if(!im) return; if(mapBg){ im.src=mapBg; im.style.display='block'; } else { im.removeAttribute('src'); im.style.display='none'; } }
function toWorld(clientX,clientY){ // 屏幕坐标 → 地图世界坐标（抵消缩放与平移）
  const st=($('#mapStage')||{getBoundingClientRect:()=>({left:0,top:0})}).getBoundingClientRect();
  return { x:(clientX-st.left-mapPanX)/mapZoom, y:(clientY-st.top-mapPanY)/mapZoom };
}
function setMapZoom(nz,cx,cy){ // 以指定屏幕点为锚点缩放，保证该点下的地图位置不漂移
  nz=Math.max(0.4,Math.min(3,nz)); if(Math.abs(nz-mapZoom)<1e-6) return;
  const p=toWorld(cx,cy);
  mapPanX += p.x*(mapZoom-nz); mapPanY += p.y*(mapZoom-nz); mapZoom=nz;
  applyMapView(); saveMapView(); renderMapPath(); wsSyncMap();
}
function resetMapView(){ mapZoom=1; mapPanX=0; mapPanY=0; mapPanMode=false; applyMapView(); saveMapView(); renderMapPath(); wsSyncMap(); toast('视图已复位'); }
function openMapViewMenu(){ // 「视图」浮层：地形图上传/清除 + 缩放/复位/平移模式
  closePreset();
  const html='<div class="cp-mask" id="cpMask"><div class="cp-card">'
    +'<div class="cp-head">视图 · 地形图层</div>'
    +'<div class="map-view">缩放 <b>'+Math.round(mapZoom*100)+'%</b> · 滚轮缩放 / 右键或中键拖拽平移</div>'
    +'<div class="cp-list">'
    +'<div class="cp-item preset" data-act="bg"><span>🖼️</span><div><div class="cp-name">上传地形图</div><div class="cp-sub">本地图片 · 自动压缩至长边 1600</div></div></div>'
    +'<div class="cp-item preset" data-act="clr"><span>🧽</span><div><div class="cp-name">清除地形图</div><div class="cp-sub">'+(mapBg?'已载入一张背景图':'当前无背景图')+'</div></div></div>'
    +'<div class="cp-item preset" data-act="zin"><span>🔍</span><div><div class="cp-name">放大</div><div class="cp-sub">+20%（以地图中心为锚点）</div></div></div>'
    +'<div class="cp-item preset" data-act="zout"><span>🔎</span><div><div class="cp-name">缩小</div><div class="cp-sub">−20%</div></div></div>'
    +'<div class="cp-item preset" data-act="reset"><span>🎯</span><div><div class="cp-name">复位视图</div><div class="cp-sub">缩放 100% · 归位</div></div></div>'
    +'<div class="cp-item preset" data-act="pan"><span>✋</span><div><div class="cp-name">平移模式</div><div class="cp-sub">'+(mapPanMode?'已开启：拖拽空白处移动视图':'开启后拖拽空白处平移视图')+'</div></div></div>'
    +'</div><div class="cp-cancel" id="cpCancel">取消</div></div></div>';
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('cpCancel').onclick=closePreset;
  document.getElementById('cpMask').addEventListener('click',e=>{ if(e.target.id==='cpMask') closePreset(); });
  document.querySelectorAll('#cpMask .cp-item.preset').forEach(it=> it.onclick=()=>{
    const a=it.dataset.act;
    const st=($('#mapStage')||{getBoundingClientRect:()=>({left:0,top:0,width:0,height:0})}).getBoundingClientRect();
    const cx=st.left+st.width/2, cy=st.top+st.height/2;
    if(a==='bg'){ closePreset(); pickBgFile(); return; }
    if(a==='clr'){ mapBg=''; try{ localStorage.removeItem(MAP_BG_LS); }catch(_){} applyMapBg(); wsSyncMap(); toast('已清除地形图'); closePreset(); return; }
    if(a==='zin') setMapZoom(mapZoom*1.2,cx,cy);
    else if(a==='zout') setMapZoom(mapZoom/1.2,cx,cy);
    else if(a==='reset') resetMapView();
    else if(a==='pan'){ mapPanMode=!mapPanMode; applyMapView(); toast('平移模式：'+(mapPanMode?'开':'关')); }
    closePreset();
  });
}
function pickBgFile(){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*';
  inp.onchange=()=>{ const f=inp.files&&inp.files[0]; if(f) handleBgFile(f); };
  inp.click();
}
function handleBgFile(file){ // 读取本地图片 → 等比压缩（长边 1600）→ JPEG 0.82 → 持久化 + 同步
  const fr=new FileReader();
  fr.onload=()=>{ const img=new Image();
    img.onload=()=>{
      const MAX=1600, iw=img.width||1, ih=img.height||1, sc=Math.min(1,MAX/Math.max(iw,ih));
      const cv=document.createElement('canvas'); cv.width=Math.max(1,Math.round(iw*sc)); cv.height=Math.max(1,Math.round(ih*sc));
      cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
      let url=''; try{ url=cv.toDataURL('image/jpeg',0.82); }catch(_){ url=String(fr.result||''); }
      mapBg=url; applyMapBg();
      try{ localStorage.setItem(MAP_BG_LS,url); }catch(_){ toast('地形图较大，本地缓存失败，本次仅当前会话生效'); }
      wsSyncMap(); toast('地形图已载入（'+cv.width+'×'+cv.height+'）');
    };
    img.onerror=()=>toast('图片解析失败');
    img.src=String(fr.result||'');
  };
  fr.onerror=()=>toast('读取文件失败');
  fr.readAsDataURL(file);
}
/* ---------- 房间级权限：玩家可控自己 Token（#198） ----------
   Token.owner 存玩家登录账号（小写），ownerName 存展示名；空 = GM 控制。
   非 GM 只能移动 owner 为空或属于自己的 Token；服务端对越权改动做二次兜底过滤。 */
function myMapId(){ return APP.session ? String(APP.session).toLowerCase() : ''; }
function canMoveToken(t){ if(isGM()) return true; const o=String(t.owner||''); return !o || o===myMapId(); }
function openOwnerDialog(){ // GM：列出全部 Token，逐个授予/回收控制权
  if(!isGM()){ toast('🔒 只有 GM 可以授权 Token 控制权'); return; }
  closePreset();
  const rows=MAP_TOKENS.length? MAP_TOKENS.map(t=>'<div class="cp-item preset" data-tid="'+escapeHtml(String(t.id))+'"><span>'+(t.emoji||'❓')+'</span><div><div class="cp-name">'+escapeHtml(t.name||'未命名')+'</div><div class="cp-sub">当前：'+(t.owner?escapeHtml(t.ownerName||t.owner):'GM 控制')+'</div></div><span class="cp-badge">'+(t.owner?'已授权':'GM')+'</span></div>').join('') : '<div class="cp-sub" style="padding:10px">地图上还没有 Token</div>';
  document.body.insertAdjacentHTML('beforeend','<div class="cp-mask" id="cpMask"><div class="cp-card"><div class="cp-head">Token 控制权授权</div><div class="map-view">点选 Token → 授予某位玩家移动权；也可随时收归 GM</div><div class="cp-list">'+rows+'</div><div class="cp-cancel" id="cpCancel">取消</div></div></div>');
  document.getElementById('cpCancel').onclick=closePreset;
  document.getElementById('cpMask').addEventListener('click',e=>{ if(e.target.id==='cpMask') closePreset(); });
  document.querySelectorAll('#cpMask .cp-item.preset').forEach(it=> it.onclick=()=>askTokenOwner(it.dataset.tid));
}
async function askTokenOwner(tid){
  const t=MAP_TOKENS.find(x=>x.id===tid); if(!t) return;
  let mem=[];
  if(USE_API && wsRoom){ try{ const j=await apiFetch('/rooms/'+encodeURIComponent(wsRoom)+'/members'); mem=(j&&j.members)||[]; }catch(_){ mem=[]; } }
  closePreset();
  const opts=mem.length? mem.map((m,i)=>'<div class="cp-item preset" data-mi="'+i+'"><span>🎭</span><div><div class="cp-name">'+escapeHtml(m.name||m.key)+'</div><div class="cp-sub">'+escapeHtml(String(m.key||''))+'</div></div></div>').join('') : '';
  document.body.insertAdjacentHTML('beforeend','<div class="cp-mask" id="cpMask"><div class="cp-card"><div class="cp-head">授予：'+escapeHtml(t.name||'')+'</div>'
    + (opts? '<div class="cp-group">房间成员</div><div class="cp-list">'+opts+'</div>' : '<div class="map-view">未取到房间成员（需后端连接），可手动输入账号</div>')
    + '<div class="cp-group">其他</div><div class="cp-list">'
    + '<div class="cp-item preset" data-mi="-1"><span>🔓</span><div><div class="cp-name">收归 GM</div><div class="cp-sub">清除授权，仅 GM 可移动</div></div></div>'
    + '<div class="cp-item preset" data-mi="-2"><span>⌨️</span><div><div class="cp-name">手动输入账号</div><div class="cp-sub">输入玩家的登录邮箱 / 手机号</div></div></div></div>'
    + '<div class="cp-cancel" id="cpCancel">取消</div></div></div>');
  const set=(key,name)=>{ t.owner=key||''; t.ownerName=name||''; saveApp(); renderMap(); wsSyncMap();
    toast(key? ('已授予「'+(name||key)+'」移动 '+(t.name||'')+' 的权限') : ('已收归 GM：'+(t.name||''))); closePreset(); };
  document.getElementById('cpCancel').onclick=closePreset;
  document.getElementById('cpMask').addEventListener('click',e=>{ if(e.target.id==='cpMask') closePreset(); });
  document.querySelectorAll('#cpMask .cp-item.preset').forEach(it=> it.onclick=()=>{
    const mi=+it.dataset.mi;
    if(mi===-1) return set('','');
    if(mi===-2){ closePreset(); askOwnerManual(tid); return; }
    const m=mem[mi]; set(String(m.key||'').toLowerCase(), String(m.name||''));
  });
}
function askOwnerManual(tid){
  const t=MAP_TOKENS.find(x=>x.id===tid); if(!t) return;
  closePreset();
  document.body.insertAdjacentHTML('beforeend','<div class="cp-mask" id="cpMask"><div class="cp-card"><div class="cp-head">手动授权：'+escapeHtml(t.name||'')+'</div>'
    +'<input class="own-in" id="ownInput" placeholder="玩家登录邮箱 / 手机号（留空 = 收归 GM）" value="'+escapeHtml(String(t.owner||''))+'">'
    +'<div class="cp-act"><div id="ownOk">确定</div><div id="ownGm">收归 GM</div></div>'
    +'<div class="cp-cancel" id="cpCancel">取消</div></div></div>');
  document.getElementById('cpCancel').onclick=closePreset;
  document.getElementById('cpMask').addEventListener('click',e=>{ if(e.target.id==='cpMask') closePreset(); });
  document.getElementById('ownGm').onclick=()=>{ t.owner=''; t.ownerName=''; saveApp(); renderMap(); wsSyncMap(); toast('已收归 GM'); closePreset(); };
  document.getElementById('ownOk').onclick=()=>{ const el=document.getElementById('ownInput');
    const v=String((el&&el.value)||'').trim().toLowerCase();
    t.owner=v; t.ownerName=v; saveApp(); renderMap(); wsSyncMap(); toast(v?('已授予「'+v+'」'):'已收归 GM'); closePreset(); };
}
/* ---------- 先攻顺序 + 回合管理（#200） ---------- */
function openInitPanel(){
  closePreset();
  if(!isGM()){ toast('🔒 只有 GM 可以设置先攻与回合'); return; }
  const rows = MAP_TOKENS.length ? MAP_TOKENS.map(t=>{
    const cur=(mapInit.find(x=>x.id===t.id)||{}).ini;
    const ini=(cur!=null && cur!=='')?cur:Math.floor(Math.random()*20+1);
    return '<div class="cp-item preset" data-tid="'+escapeHtml(String(t.id))+'"><span>'+(t.emoji||'❓')+'</span><div class="cp-name" style="flex:1">'+escapeHtml(t.name||'未命名')+'</div>'
      +'<input class="ini-in" data-ini="'+escapeHtml(String(t.id))+'" type="number" min="0" max="99" value="'+ini+'" style="width:54px"></div>';
  }).join('') : '<div class="cp-sub" style="padding:10px">地图上还没有 Token</div>';
  const html='<div class="cp-mask" id="cpMask"><div class="cp-card"><div class="cp-head">先攻顺序 · 回合管理</div>'
    +'<div class="map-view">为参战 Token 录入先攻值（默认随机 1–20），点「排序并开始」按先攻降序生成回合队列。</div>'
    +'<div class="cp-list">'+rows+'</div>'
    +'<div class="cp-act"><div id="initStart" class="cp-ok">排序并开始战斗</div><div id="initEnd">结束战斗</div></div>'
    +'<div class="cp-cancel" id="cpCancel">取消</div></div></div>';
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('cpCancel').onclick=closePreset;
  document.getElementById('cpMask').addEventListener('click',e=>{ if(e.target.id==='cpMask') closePreset(); });
  document.getElementById('initStart').onclick=()=>{
    const arr=[]; MAP_TOKENS.forEach(t=>{ const inp=document.querySelector('[data-ini="'+escapeHtml(String(t.id))+'"]'); const v=inp?+inp.value:Math.floor(Math.random()*20+1); arr.push({id:t.id,name:t.name,emoji:t.emoji,ini:v}); });
    arr.sort((a,b)=>b.ini-a.ini); mapInit=arr; mapTurn=arr.length?0:-1; closePreset(); renderInitTracker(); renderMap(); MAP_TOKENS.forEach(tk=> tk.moveLeft=(tk.move||0)); wsSyncMap(); toast('战斗开始 · 先攻轮到：'+(mapInit[0]?mapInit[0].name:'—'));
  };
  document.getElementById('initEnd').onclick=()=>{ endCombat(); closePreset(); };
}
function nextTurn(){ if(!mapInit.length){ toast('尚未开始战斗'); return; } mapTurn=(mapTurn+1)%mapInit.length; renderInitTracker(); renderMap(); MAP_TOKENS.forEach(tk=> tk.moveLeft=(tk.move||0)); wsSyncMap(); const cur=mapInit[mapTurn]; toast('▶ 回合：'+(cur?cur.name:'—')); }
function endCombat(){ mapInit=[]; mapTurn=-1; renderInitTracker(); renderMap(); wsSyncMap(); toast('战斗已结束'); }
function renderInitTracker(){
  const bar=$('#mapInitBar'); if(!bar) return;
  if(!mapInit.length || mapTurn<0){ bar.classList.add('hidden'); bar.innerHTML=''; return; }
  bar.classList.remove('hidden');
  const rows=mapInit.map((t,i)=>'<div class="init-row'+(i===mapTurn?' active':'')+'" data-i="'+i+'"><span class="ini-n">'+escapeHtml(String(i+1))+'</span><span class="ini-e">'+(t.emoji||'❓')+'</span><span class="ini-name">'+escapeHtml(t.name||'未命名')+'</span><span class="ini-v">'+escapeHtml(String(t.ini))+'</span></div>').join('');
  bar.innerHTML='<div class="ini-head">回合 <b>'+(mapTurn+1)+'</b> / '+mapInit.length+'</div><div class="ini-list">'+rows+'</div><button class="ini-next" id="initNext">下一回合 ▶</button>';
  const nb=document.getElementById('initNext'); if(nb) nb.onclick=nextTurn;
  bar.querySelectorAll('.init-row').forEach(r=> r.onclick=()=>{ mapTurn=+r.dataset.i; renderInitTracker(); renderMap(); wsSyncMap(); });
}
/* ---------- Token 条件/状态标记（#201） ---------- */
function openCondPanel(){
  closePreset();
  if(!isGM()){ toast('🔒 只有 GM 可以设置 Token 状态'); return; }
  const rows = MAP_TOKENS.length ? MAP_TOKENS.map(t=>{
    const cs=Array.isArray(t.conds)?t.conds:[];
    const chips=COND_LIST.map(c=>'<span class="cond-chip'+(cs.includes(c.k)?' on':'')+'" data-tid="'+escapeHtml(String(t.id))+'" data-ck="'+c.k+'">'+c.e+' '+c.k+'</span>').join('');
    return '<div class="cp-item cond" data-tid="'+escapeHtml(String(t.id))+'"><span>'+(t.emoji||'❓')+'</span><div class="cp-name" style="flex:1">'+escapeHtml(t.name||'未命名')+'</div></div><div class="cond-row">'+chips+'</div>';
  }).join('') : '<div class="cp-sub" style="padding:10px">地图上还没有 Token</div>';
  const html='<div class="cp-mask" id="cpMask"><div class="cp-card"><div class="cp-head">Token 状态 / 条件标记</div>'
    +'<div class="map-view">点选条件即给该 Token 贴上状态徽标（可叠加多个），再次点选取消。玩家端实时可见。</div>'
    +'<div class="cp-list" style="display:block">'+rows+'</div>'
    +'<div class="cp-cancel" id="cpCancel">完成</div></div></div>';
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('cpCancel').onclick=closePreset;
  document.getElementById('cpMask').addEventListener('click',e=>{ if(e.target.id==='cpMask') closePreset(); });
  document.querySelectorAll('#cpMask .cond-chip').forEach(ch=> ch.onclick=()=>{
    const t=MAP_TOKENS.find(x=>x.id===ch.dataset.tid); if(!t) return;
    t.conds=Array.isArray(t.conds)?t.conds:[]; const k=ch.dataset.ck;
    const i=t.conds.indexOf(k); if(i>=0) t.conds.splice(i,1); else t.conds.push(k);
    ch.classList.toggle('on', i<0); renderMap(); wsSyncMap();
  });
}
/* 战损时间线：GM 对任意 Token 扣血/治疗，记录 damageLog 并广播（#战损） */
function openDamagePanel(ids){
  if(!isGM()){ toast('🔒 只有 GM 可以记录战损'); return; }
  const list = (ids && ids.length) ? MAP_TOKENS.filter(t=>ids.includes(t.id)) : MAP_TOKENS;
  if(!list.length){ toast('地图上还没有 Token'); return; }
  const rows = list.map(t=>{
    const hp=+t.hp||0, hpMax=+t.hpMax||20;
    return '<div class="cp-item dmg" data-tid="'+escapeHtml(String(t.id))+'"><span>'+(t.emoji||'❓')+'</span><div class="cp-name" style="flex:1">'+escapeHtml(t.name||'未命名')+'</div>'
      +'<button class="dmg-minus" data-tid="'+escapeHtml(String(t.id))+'">−</button>'
      +'<input class="dmg-in" data-tid="'+escapeHtml(String(t.id))+'" type="number" value="0" style="width:46px">'
      +'<button class="dmg-plus" data-tid="'+escapeHtml(String(t.id))+'">＋</button>'
      +'<span class="dmg-cur" data-cur="'+escapeHtml(String(t.id))+'">'+hp+'/'+hpMax+'</span></div>';
  }).join('');
  const html='<div class="cp-mask" id="cpMask"><div class="cp-card"><div class="cp-head">战损 · 扣血 / 治疗</div>'
    +'<div class="map-view">正数为伤害、负数为治疗，点「应用」生效；归零自动标记「倒地」。</div>'
    +'<div class="cp-list">'+rows+'</div>'
    +'<div class="cp-act"><div id="dmgApply" class="cp-ok">应用</div><div id="cpCancel" class="cp-cancel">取消</div></div></div></div>';
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('cpCancel').onclick=closePreset;
  document.getElementById('cpMask').addEventListener('click',e=>{ if(e.target.id==='cpMask') closePreset(); });
  document.querySelectorAll('#cpMask .dmg-minus').forEach(b=> b.onclick=()=>{ const i=document.querySelector('#cpMask .dmg-in[data-tid="'+b.dataset.tid+'"]'); if(i) i.value=String((+i.value||0)-1); });
  document.querySelectorAll('#cpMask .dmg-plus').forEach(b=> b.onclick=()=>{ const i=document.querySelector('#cpMask .dmg-in[data-tid="'+b.dataset.tid+'"]'); if(i) i.value=String((+i.value||0)+1); });
  document.getElementById('dmgApply').onclick=()=>{
    let changed=0;
    document.querySelectorAll('#cpMask .dmg-in').forEach(i=>{
      const delta=+i.value||0; if(!delta) return;
      const t=MAP_TOKENS.find(x=>x.id===i.dataset.tid); if(!t) return;
      const hpMax=+t.hpMax||20; const before=+t.hp||0; let hp=Math.max(0,Math.min(hpMax,before+delta)); const real=hp-before;
      t.hp=hp; if(hp<=0){ if(!Array.isArray(t.conds)) t.conds=[]; if(t.conds.indexOf('倒地')<0) t.conds.push('倒地'); } else if(Array.isArray(t.conds)){ const k=t.conds.indexOf('倒地'); if(k>=0) t.conds.splice(k,1); }
      mapDamageLog.push({t:Date.now(), actor:'GM', target:t.name, delta:real, hpAfter:hp, note:real<0?'受到伤害':'恢复'});
      if(typeof wsSend==='function'){ wsSend({type:'chat', text:(real<0?('💥 '+t.name+' 受到伤害 '+Math.abs(real)+' · 剩余 '+hp+'/'+hpMax):('✚ '+t.name+' 恢复 '+real+' · 剩余 '+hp+'/'+hpMax)), sys:true}); }
      changed++;
    });
    closePreset(); renderMap(); wsSyncMap(); if(changed) toast('战损已记录');
  };
}
/* 半可控战棋：GM 设定 Token 每回合移动力（#战棋） */
function openMovePanel(){
  if(!isGM()){ toast('🔒 只有 GM 可以设定移动力'); return; }
  if(!MAP_TOKENS.length){ toast('地图上还没有 Token'); return; }
  const rows = MAP_TOKENS.map(t=>{
    const mv=+t.move||0;
    return '<div class="cp-item mv" data-tid="'+escapeHtml(String(t.id))+'"><span>'+(t.emoji||'❓')+'</span><div class="cp-name" style="flex:1">'+escapeHtml(t.name||'未命名')+'</div>'
      +'<button class="mv-minus" data-tid="'+escapeHtml(String(t.id))+'">−</button>'
      +'<input class="mv-in" data-tid="'+escapeHtml(String(t.id))+'" type="number" min="0" max="99" value="'+mv+'" style="width:46px">'
      +'<button class="mv-plus" data-tid="'+escapeHtml(String(t.id))+'">＋</button>'
      +'<span class="mv-cur" data-cur="'+escapeHtml(String(t.id))+'">剩余 '+(+t.moveLeft||0)+'</span></div>';
  }).join('');
  const html='<div class="cp-mask" id="cpMask"><div class="cp-card"><div class="cp-head">Token 移动力 · 战棋</div>'
    +'<div class="map-view">设定每回合可移动格数（0=不限制）。战斗开始后玩家仅能在自己回合内、剩余移动力内拖动。</div>'
    +'<div class="cp-list">'+rows+'</div>'
    +'<div class="cp-act"><div id="mvApply" class="cp-ok">应用</div><div id="cpCancel" class="cp-cancel">取消</div></div></div></div>';
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('cpCancel').onclick=closePreset;
  document.getElementById('cpMask').addEventListener('click',e=>{ if(e.target.id==='cpMask') closePreset(); });
  document.querySelectorAll('#cpMask .mv-minus').forEach(b=> b.onclick=()=>{ const i=document.querySelector('#cpMask .mv-in[data-tid="'+b.dataset.tid+'"]'); if(i) i.value=String(Math.max(0,(+i.value||0)-1)); });
  document.querySelectorAll('#cpMask .mv-plus').forEach(b=> b.onclick=()=>{ const i=document.querySelector('#cpMask .mv-in[data-tid="'+b.dataset.tid+'"]'); if(i) i.value=String((+i.value||0)+1); });
  document.getElementById('mvApply').onclick=()=>{
    MAP_TOKENS.forEach(t=>{ const i=document.querySelector('#cpMask .mv-in[data-tid="'+escapeHtml(String(t.id))+'"]'); if(i){ t.move=Math.max(0,+i.value||0); t.moveLeft=t.move; } });
    closePreset(); renderMap(); wsSyncMap(); toast('移动力已设定');
  };
}
function showMap(){ $('#mapScreen').classList.remove('hidden'); mapRulerFrom=null; loadMapView(); applyMapBg(); applyMapView(); renderMap(); renderInitTracker(); syncMapInsets(); const mb=document.querySelector('[data-act="map"]'); if(mb) mb.classList.remove('map-live'); setTimeout(()=>$('#mapBack').focus(),60); }
function hideMap(){ $('#mapScreen').classList.add('hidden'); }
/* 框选批量操作浮层：仅 GM、框选且有选区时显（#框选增强） */
function updateBatchBar(){
  const bar=$('#mapBatchBar'); if(!bar) return;
  if(!mapSelectMode || !mapSel.size || !isGM()){ bar.classList.add('hidden'); bar.setAttribute('hidden',''); bar.innerHTML=''; return; }
  const ids=Array.from(mapSel);
  bar.innerHTML='<span class="batch-n">已选 '+ids.length+'</span>'
    +'<button class="tbtn" id="batchCond">条件</button>'
    +'<button class="tbtn" id="batchDmg">战损</button>'
    +'<button class="tbtn" id="batchHide">隐藏</button>'
    +'<button class="tbtn" id="batchShow">显示</button>'
    +'<button class="tbtn" id="batchAlign">对齐</button>';
  $('#batchCond').onclick=()=>batchCond(ids);
  $('#batchDmg').onclick=()=>openDamagePanel(ids);
  $('#batchHide').onclick=()=>{ ids.forEach(id=>{ const tk=MAP_TOKENS.find(x=>x.id===id); if(tk) tk.hidden=true; }); renderMap(); wsSyncMap(); toast('已批量隐藏'); };
  $('#batchShow').onclick=()=>{ ids.forEach(id=>{ const tk=MAP_TOKENS.find(x=>x.id===id); if(tk) tk.hidden=false; }); renderMap(); wsSyncMap(); toast('已批量显示'); };
  $('#batchAlign').onclick=()=>batchAlign(ids);
  bar.classList.remove('hidden');
}
function batchCond(ids){
  const rows = ids.map(id=>{ const t=MAP_TOKENS.find(x=>x.id===id); if(!t) return ''; const cs=Array.isArray(t.conds)?t.conds:[]; const chips=COND_LIST.map(c=>'<span class="cond-chip'+(cs.includes(c.k)?' on':'')+'" data-tid="'+escapeHtml(String(t.id))+'" data-ck="'+c.k+'">'+c.e+' '+c.k+'</span>').join(''); return '<div class="cp-item cond" data-tid="'+escapeHtml(String(t.id))+'"><span>'+(t.emoji||'❓')+'</span><div class="cp-name" style="flex:1">'+escapeHtml(t.name||'未命名')+'</div></div><div class="cond-row">'+chips+'</div>'; }).join('');
  const html='<div class="cp-mask" id="cpMask"><div class="cp-card"><div class="cp-head">批量条件 · 选中 '+ids.length+' 个</div>'
    +'<div class="map-view">点选条件即给选中 Token 统一贴/去状态。</div>'
    +'<div class="cp-list" style="display:block">'+rows+'</div>'
    +'<div class="cp-cancel" id="cpCancel">完成</div></div></div>';
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('cpCancel').onclick=closePreset;
  document.getElementById('cpMask').addEventListener('click',e=>{ if(e.target.id==='cpMask') closePreset(); });
  document.querySelectorAll('#cpMask .cond-chip').forEach(ch=> ch.onclick=()=>{
    const t=MAP_TOKENS.find(x=>x.id===ch.dataset.tid); if(!t) return;
    t.conds=Array.isArray(t.conds)?t.conds:[]; const k=ch.dataset.ck; const i=t.conds.indexOf(k);
    if(i>=0) t.conds.splice(i,1); else t.conds.push(k);
    ch.classList.toggle('on', i<0); renderMap(); wsSyncMap();
  });
}
function batchAlign(ids){
  if(ids.length<2){ toast('请框选至少 2 个 Token'); return; }
  const st=($('#mapStage')||{getBoundingClientRect:()=>({width:600})}).getBoundingClientRect();
  const xs=ids.map(id=>{ const t=MAP_TOKENS.find(x=>x.id===id); return t?t.x:0; });
  const snapped=Math.round(xs.reduce((a,b)=>a+b,0)/xs.length/CELL)*CELL;
  ids.forEach(id=>{ const t=MAP_TOKENS.find(x=>x.id===id); if(t) t.x=Math.max(18,Math.min(st.width-18,snapped)); });
  renderMap(); wsSyncMap(); toast('已按列对齐选中 Token');
}
function rotateSel(deg){ // 旋转选中 Token（无选区则旋转全部）；与框选批量移动天然衔接
  const targets = mapSel.size ? Array.from(mapSel) : MAP_TOKENS.map(t=>t.id);
  targets.forEach(id=>{ const tk=MAP_TOKENS.find(t=>t.id===id); if(tk) tk.rot=(((tk.rot||0)+deg)%360+360)%360; });
  renderMap(); wsSyncMap();
}
/* 地图 PNG 导出：将当前战棋（地形图/网格/迷雾/Token/朝向/选区/标尺）绘制到 canvas 并下载
   说明：导出为完整世界视图（不受当前缩放平移影响），地形图按 object-fit:contain 等比居中铺放 */
function exportMapPng(){
  if(!mapBg){ exportMapPngWith(null); return; }
  const im=new Image(); im.onload=()=>exportMapPngWith(im); im.onerror=()=>exportMapPngWith(null); im.src=mapBg;
}
function exportMapPngWith(bgImg){
  const st=$('#mapStage'); const r=st.getBoundingClientRect(); const W=Math.max(320,Math.round(r.width)), H=Math.max(240,Math.round(r.height));
  const cv=document.createElement('canvas'); cv.width=W; cv.height=H; const c=cv.getContext('2d');
  c.fillStyle='#171c26'; c.fillRect(0,0,W,H);
  if(bgImg && bgImg.width && bgImg.height){ // 地形图层：与 DOM 的 object-fit:contain 保持一致
    const s=Math.min(W/bgImg.width, H/bgImg.height), dw=bgImg.width*s, dh=bgImg.height*s;
    c.drawImage(bgImg,(W-dw)/2,(H-dh)/2,dw,dh);
  }
  if(mapGridOn){ c.strokeStyle='rgba(255,255,255,.07)'; c.lineWidth=1; for(let x=0;x<=W;x+=CELL){ c.beginPath(); c.moveTo(x+.5,0); c.lineTo(x+.5,H); c.stroke(); } for(let y=0;y<=H;y+=CELL){ c.beginPath(); c.moveTo(0,y+.5); c.lineTo(W,y+.5); c.stroke(); } }
  if(mapFogOn){ c.save(); c.fillStyle='rgba(5,7,12,.97)'; c.fillRect(0,0,W,H); c.globalCompositeOperation='destination-out'; MAP_TOKENS.filter(t=>t.kind==='pc').forEach(t=>{ const g=c.createRadialGradient(t.x,t.y,CELL*1.2,t.x,t.y,CELL*2.8); g.addColorStop(0,'rgba(0,0,0,1)'); g.addColorStop(.62,'rgba(0,0,0,1)'); g.addColorStop(1,'rgba(0,0,0,0)'); c.fillStyle=g; c.beginPath(); c.arc(t.x,t.y,CELL*2.8,0,Math.PI*2); c.fill(); }); c.restore(); }
  const pp=pathPoints(); // 持久化测距路径：导出同样保留标尺
  if(pp.length>1){
    c.save();
    c.strokeStyle='#f0b429'; c.lineWidth=2.5; c.setLineDash([7,5]);
    c.beginPath(); pp.forEach((t,i)=>{ const x=t.x+24, y=t.y+24; if(i===0) c.moveTo(x,y); else c.lineTo(x,y); }); c.stroke();
    c.setLineDash([]); c.fillStyle='#f5f0e6'; c.font='600 11px "Space Mono",monospace'; c.textAlign='center'; c.textBaseline='middle';
    for(let i=1;i<pp.length;i++){ const a=pp[i-1], b=pp[i]; const d=Math.max(1,Math.round(Math.hypot(b.x-a.x,b.y-a.y)/CELL)); c.fillText(d+'格',(a.x+b.x)/2+24,(a.y+b.y)/2+24-12); }
    pp.forEach(t=>{ c.fillStyle='#f0b429'; c.beginPath(); c.arc(t.x+24,t.y+24,5,0,Math.PI*2); c.fill(); });
    c.restore();
  }
  MAP_TOKENS.forEach(t=>{ if(t.hidden && !mapGm) return; drawTokenPng(c,t); });
  c.fillStyle='rgba(245,240,230,.85)'; c.font='600 14px "Space Mono",monospace'; c.textAlign='left'; c.textBaseline='alphabetic'; c.fillText('银之门 · 战术地图', 12, 22);
  cv.toBlob(b=>{ if(!b){ toast('导出失败'); return; } const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='银之门-战术地图-'+Date.now()+'.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),2000); toast('已导出地图 PNG'); },'image/png');
}
function drawTokenPng(c,t){
  const cx=t.x+24, cy=t.y+24; // 与 DOM 渲染一致：Token 圆直径 48，中心偏移 +24
  const col={pc:'#3a6f93',monster:'#c0392b',npc:'#9aa0a6'}[t.kind]||'#9aa0a6';
  if(mapSel.has(t.id)){ c.strokeStyle='#37d67a'; c.lineWidth=3; c.beginPath(); c.arc(cx,cy,26,0,Math.PI*2); c.stroke(); }
  c.fillStyle='#20262f'; c.beginPath(); c.arc(cx,cy,24,0,Math.PI*2); c.fill();
  c.strokeStyle=col; c.lineWidth=2.5; c.beginPath(); c.arc(cx,cy,24,0,Math.PI*2); c.stroke();
  c.textAlign='center'; c.textBaseline='middle'; c.font='26px serif'; c.fillText(t.emoji||'❓', cx, cy);
  if(t.rot!=null){ const a=t.rot*Math.PI/180; c.save(); c.translate(cx,cy); c.rotate(a); c.fillStyle='#f5f0e6'; c.beginPath(); c.moveTo(0,-30); c.lineTo(-5,-38); c.lineTo(5,-38); c.closePath(); c.fill(); c.restore(); }
  c.fillStyle='rgba(245,240,230,.9)'; c.font='11px "Space Mono",monospace'; c.fillText(t.name||'', cx, cy+38);
}
/*@@ m6-map:vision @@*/
function mapFogHoles(){
  let holes='';
  MAP_TOKENS.filter(t=>t.kind==='pc').forEach(t=>{ holes+=`radial-gradient(circle 72px at ${t.x}px ${t.y}px, transparent 62%, rgba(5,7,12,.97) 82%),`; });
  return holes? holes.replace(/,$/,'') : '#05070c';
}
/* ---------- VBL：视线遮挡层（Vision Blocking Layer，对标 MapTool VBL / Foundry VTT 视野多边形） ----------
   设计：墙线段与障碍多边形挡视线（困难地形不挡，它只影响移动代价）；
   迷雾由 canvas 以 destination-out 逐个「挖洞」→ 天然是并集（修复旧版多层 CSS 渐变叠加导致的「交集」缺陷）；
   Token 可见性只做「是否被墙阻断」判定，不做半径裁剪 → 无墙时行为与旧版完全一致（纯增量）。 */
const FOG_R=CELL*2.8; // 视野半径，与既有迷雾渐变（72px）一致
function sightSegments(){ // 收集所有挡视线的线段：墙线段 + 障碍多边形的每条边（困难地形除外）
  const segs=[];
  for(let i=0;i<mapWalls.length;i++){ const w=mapWalls[i]; if(!w || w.type==='terrain') continue;
    if(w.pts){ for(let k=0,j=w.pts.length-1;k<w.pts.length;j=k++) segs.push({x1:w.pts[j].x,y1:w.pts[j].y,x2:w.pts[k].x,y2:w.pts[k].y}); }
    else if(typeof w.x1==='number') segs.push({x1:w.x1,y1:w.y1,x2:w.x2,y2:w.y2});
  }
  return segs;
}
function raySegDist(ox,oy,dx,dy,s){ // 射线(ox,oy)+t*(dx,dy) 与线段 s 的交点距离 t；无交返回 null
  const ex=s.x2-s.x1, ey=s.y2-s.y1, den=dx*ey-dy*ex;
  if(Math.abs(den)<1e-9) return null;
  const px=s.x1-ox, py=s.y1-oy;
  const t=(px*ey-ex*py)/den, u=(px*dy-dx*py)/den;
  if(t<0||u<0||u>1) return null;
  return t;
}
function visibilityPolygon(ox,oy,R,segs){ // 从 (ox,oy) 出发、半径 R 内的可见多边形（向每个墙端点及其 ±eps 发射射线）
  const EPS=1e-4, angs=[];
  for(let i=0;i<segs.length;i++){ const s=segs[i]; const a1=Math.atan2(s.y1-oy,s.x1-ox), a2=Math.atan2(s.y2-oy,s.x2-ox);
    angs.push(a1-EPS,a1,a1+EPS,a2-EPS,a2,a2+EPS); }
  const N=64; for(let i=0;i<N;i++) angs.push(-Math.PI+i*2*Math.PI/N); // 均匀采样：无墙时退化为整圆
  angs.sort((p,q)=>p-q);
  const pts=[];
  for(let i=0;i<angs.length;i++){ const a=angs[i], dx=Math.cos(a), dy=Math.sin(a); let best=R;
    for(let k=0;k<segs.length;k++){ const t=raySegDist(ox,oy,dx,dy,segs[k]); if(t!==null&&t<best) best=t; }
    pts.push({x:ox+dx*best, y:oy+dy*best}); }
  return pts;
}
function sightBlocked(ax,ay,bx,by){ // 两点之间是否被挡视线的墙/障碍阻断
  const dx=bx-ax, dy=by-ay, L=Math.hypot(dx,dy);
  if(L<1e-6) return false;
  const ux=dx/L, uy=dy/L, segs=sightSegments();
  for(let i=0;i<segs.length;i++){ const t=raySegDist(ax,ay,ux,uy,segs[i]); if(t!==null&&t<L-1e-6) return true; }
  return false;
}
function tokenSightVisible(t){ // 玩家端可见性：GM 全见；迷雾关闭全见；PC 恒可见；否则需至少一个 PC 有通视
  if(isGM()||!mapFogOn) return true;
  if(t.kind==='pc') return true;
  const srcs=MAP_TOKENS.filter(x=>x.kind==='pc');
  if(!srcs.length) return true;
  const cx=t.x+24, cy=t.y+24;
  for(let i=0;i<srcs.length;i++){ if(!sightBlocked(srcs[i].x+24, srcs[i].y+24, cx, cy)) return true; }
  return false;
}
function renderFog(){ // 迷雾 canvas：整屏暗 → 逐个 PC 的可见多边形内挖洞（destination-out 累加 = 并集）
  const cv=$('#mapFogCv'); if(!cv) return;
  const w=cv.clientWidth||0, h=cv.clientHeight||0;
  if(cv.width!==w||cv.height!==h){ cv.width=w; cv.height=h; }
  const c=cv.getContext('2d'); if(!c) return;
  c.clearRect(0,0,w,h);
  if(!mapFogOn || mapGm || !w || !h) return; // GM 图层开 / 迷雾关 → 不留暗幕
  c.save();
  c.fillStyle='rgba(5,7,12,.97)'; c.fillRect(0,0,w,h);
  c.globalCompositeOperation='destination-out';
  const segs=sightSegments();
  MAP_TOKENS.filter(t=>t.kind==='pc').forEach(t=>{
    const ox=t.x+24, oy=t.y+24;
    c.save(); c.beginPath();
    if(!segs.length){ c.arc(ox,oy,FOG_R,0,Math.PI*2); }
    else { const pts=visibilityPolygon(ox,oy,FOG_R,segs); for(let i=0;i<pts.length;i++){ const p=pts[i]; if(i===0) c.moveTo(p.x,p.y); else c.lineTo(p.x,p.y); } c.closePath(); }
    c.clip();
    const g=c.createRadialGradient(ox,oy,FOG_R*0.28,ox,oy,FOG_R);
    g.addColorStop(0,'rgba(0,0,0,1)'); g.addColorStop(.62,'rgba(0,0,0,1)'); g.addColorStop(1,'rgba(0,0,0,0)');
    c.fillStyle=g; c.fillRect(ox-FOG_R,oy-FOG_R,FOG_R*2,FOG_R*2);
    c.restore();
  });
  c.restore();
}
function renderMap(){
  const st=$('#mapStage');
  const wd=$('#mapWorld')||st; // Token 挂到世界层，随缩放平移一起变换
  wd.querySelectorAll('.map-token').forEach(t=>t.remove());
  const fg=$('#mapFog'); if(fg && $('#mapFogCv')) fg.style.background='none'; // #241：迷雾改由 canvas 渲染（并集合成 + VBL 阴影），关掉旧的 CSS 渐变层
  renderFog();
  MAP_TOKENS.forEach(t=>{
    if(t.hidden && !mapGm) return;
    if(!tokenSightVisible(t)) return; // #241 VBL：被墙/障碍挡住视线的 Token 对玩家不可见（GM 全见；无墙时不影响）
    const el=document.createElement('div');
    el.className='map-token '+t.kind;
    if(t.charId){ el.classList.add('linked'); el.dataset.char=t.charId; }
    if(mapSel.has(t.id)) el.classList.add('sel');
    if((+t.hp||0)<=0) el.classList.add('down');
    if(mapTurn>=0 && mapInit[mapTurn] && mapInit[mapTurn].id===t.id) el.classList.add('active'); // 当前回合 Token 高亮（#200）
    if(mapTurn>=0 && !isGM() && !(mapInit[mapTurn] && mapInit[mapTurn].id===t.id)) el.classList.add('dim'); // 玩家端战斗聚焦：非行动者压暗
    if(!isGM() && t.owner){ el.classList.add(t.owner===myMapId()?'mine':'locked'); } // 玩家端：区分「我的」与「别人的」
    el.style.left=t.x+'px'; el.style.top=t.y+'px';
    const glow = t.kind==='pc'?'border-san-blue token-glow-investigator':(t.kind==='monster'?'border-blood-crimson token-glow-monster':'border-outline-variant');
    const condHtml=(Array.isArray(t.conds)&&t.conds.length)?'<span class="token-cond">'+(t.conds.map(k=>{const cc=COND_LIST.find(x=>x.k===k);return cc?cc.e:'•';}).join(''))+'</span>':'';
    el.innerHTML=`<div class="w-12 h-12 rounded-full ${glow} bg-surface-container-highest overflow-hidden relative z-10 transition-transform hover:scale-110 flex items-center justify-center text-2xl">${t.emoji}</div><span class="absolute top-14 left-1/2 -translate-x-1/2 font-label-caps text-[10px] bg-abyssal-void px-1 border border-outline-variant whitespace-nowrap ${t.kind==='pc'?'text-san-blue':(t.kind==='monster'?'text-blood-crimson':'text-on-surface-variant')}">${escapeHtml(t.name)}</span>${t.charId?'<span class="token-link"></span>':''}${t.rot!=null?'<span class="token-rot" style="transform:rotate('+t.rot+'deg)"></span>':''}${(t.hpMax?('<div class="token-hp"><i style="width:'+Math.max(0,Math.min(100,Math.round(((+t.hp||0)/(+t.hpMax||20))*100)))+'%"></i><b>'+((+t.hp||0))+'/'+((+t.hpMax||20))+'</b></div>'):'')}${condHtml}`;
    el.dataset.id=t.id;
    wd.appendChild(el);
    el.addEventListener('pointerdown',e=>startTokenDrag(e,t));
    el.addEventListener('dblclick',()=>{ if(mapSelectMode) return; t.rot=(((t.rot||0)+45)%360+360)%360; renderMap(); wsSyncMap(); });
  });
  $('#mapGm').classList.toggle('on',mapGm);
  $('#mapGm').textContent='GM 图层：'+(mapGm?'开':'关');
  $('#mapGm').classList.toggle('text-primary',mapGm);
  $('#mapGm').classList.toggle('border-primary',mapGm);
  $('#mapFog').classList.toggle('off',!mapFogOn);
  updateBatchBar();
  $('#mapFogBtn').textContent='迷雾：'+(mapFogOn?'开':'关');
  $('#mapFogBtn').classList.toggle('on',mapFogOn);
  $('#mapFogBtn').classList.toggle('text-primary',mapFogOn);
  $('#mapFogBtn').classList.toggle('border-primary',mapFogOn);
  const gridEl=$('#mapStage').querySelector('.map-grid'); if(gridEl) gridEl.style.opacity=mapGridOn?'':'0';
  const gb=$('#mapGridBtn'); if(gb){ gb.classList.toggle('on',mapGridOn); gb.classList.toggle('text-primary',mapGridOn); gb.classList.toggle('border-primary',mapGridOn); }
  const sb=$('#mapSelBtn'); if(sb){ sb.classList.toggle('on',mapSelectMode); sb.classList.toggle('text-primary',mapSelectMode); sb.classList.toggle('border-primary',mapSelectMode); sb.textContent='框选'+(mapSelectMode?(mapSel.size?'：'+mapSel.size:'：开'):''); }
  const rb=$('#mapRulerBtn'); if(rb){ rb.classList.toggle('on',mapRuler); rb.classList.toggle('text-primary',mapRuler); rb.classList.toggle('border-primary',mapRuler); rb.textContent='测距'+(mapRuler?(mapPath.length?'：'+mapPath.length+'点':''):(mapPath.length?' · '+mapPath.length+'点':'')); }
  renderMapPath(); // 持久化标尺随每次重绘刷新（Token 移动后自动跟随）
  renderMoveRange(); // 当前行动者可移动范围（flood-fill 可达区）
  renderWalls(); // 墙体/障碍层
  const wb=$('#mapWallBtn'); if(wb){ wb.classList.toggle('hidden', !isGM()); wb.classList.toggle('on', mapWallMode); wb.setAttribute('aria-pressed', mapWallMode?'true':'false'); }
  const ob=$('#mapObstacleBtn'); if(ob){ ob.classList.toggle('hidden', !isGM()); ob.classList.toggle('on', mapObstacleMode); ob.setAttribute('aria-pressed', mapObstacleMode?'true':'false'); }
  const tb=$('#mapTerrainBtn'); if(tb){ tb.classList.toggle('hidden', !isGM()); tb.classList.toggle('on', mapTerrainMode); tb.setAttribute('aria-pressed', mapTerrainMode?'true':'false'); }
  const uwb=$('#mapWallUndoBtn'); if(uwb){ uwb.classList.toggle('hidden', !isGM()); uwb.disabled=!mapWallUndo.length; uwb.style.opacity=mapWallUndo.length?'':'0.45'; } // #239 撤销：无可撤销步骤时置灰
  const cwb=$('#mapWallClearBtn'); if(cwb){ cwb.classList.toggle('hidden', !isGM()); cwb.style.opacity=mapWalls.length?'':'0.45'; } // #239 清空
  renderFog(); // #241：墙体/Token/迷雾开关任一变化后刷新视野阴影
  const et=$('#mapEndTurn'); // 结束回合按钮：战斗中（GM 或轮到自己）
  if(et){ const cur=mapInit[mapTurn]; const curTk=cur?MAP_TOKENS.find(x=>x.id===cur.id):null; const mine=curTk && String(curTk.owner||'').toLowerCase()===myMapId(); et.classList.toggle('hidden', !(mapTurn>=0 && (isGM()||mine))); }
  syncMapInsets(); // GM 切换会多出 5 个按钮导致工具栏换行数变化 → 重算舞台内缩
}
/*@@ m6-map:tokens @@*/
function startTokenDrag(e,t){
  e.preventDefault();
  if(mapRuler){ rulerPick(t); return; }
  if(!canMoveToken(t)){ toast('🔒 「'+(t.name||'该 Token')+'」控制权属于 '+(t.ownerName||t.owner||'GM')+' · 只有 GM 或本人可移动'); return; }
  const st=$('#mapStage').getBoundingClientRect();
  const p0=toWorld(e.clientX,e.clientY); // 缩放/平移下换算为世界坐标
  const sx=e.clientX, sy=e.clientY; let dragMoved=0, lastSync=0;
  // 批量移动：框选模式下拖动已选中的多个 Token 时整组同位移（无权限者被剔除）
  let groupIds = (mapSelectMode && mapSel.has(t.id) && mapSel.size>1) ? Array.from(mapSel) : [t.id];
  if(!isGM()) groupIds = groupIds.filter(id=>{ const tk=MAP_TOKENS.find(x=>x.id===id); return tk && canMoveToken(tk); });
  if(!groupIds.length) return;
  const grp = groupIds.map(id=>MAP_TOKENS.find(x=>x.id===id)).filter(Boolean).map(tk=>({tk,x:tk.x,y:tk.y}));
  let turnWarned=false, blocked=false, didMove=false;
  const move=ev=>{
    dragMoved=Math.max(dragMoved, Math.hypot(ev.clientX-sx, ev.clientY-sy));
    const p=toWorld(ev.clientX,ev.clientY);
    let dx=p.x-p0.x, dy=p.y-p0.y;
    const distCells = Math.max(0, Math.round(Math.hypot(dx,dy)/CELL));
    // 半可控战棋：战斗进行中、非 GM，受「当前行动者 + 剩余移动力」约束；按网格路径代价钳制（对标 Foundry/MapTool）
    if(mapTurn>=0 && !isGM()){
      const cur = mapInit[mapTurn]; const curTk = cur ? MAP_TOKENS.find(x=>x.id===cur.id) : null;
      const myKey = myMapId();
      if(!(curTk && String(curTk.owner||'').toLowerCase()===myKey)){ if(!turnWarned){ toast('还没轮到你行动'); turnWarned=true; setTimeout(()=>turnWarned=false,1200); } blocked=true; return; }
      grp.forEach(o=>{ const mt=+o.tk.move||0; const b=+o.tk.moveLeft||0; if(mt>0){ const r=resolveMove(o,dx,dy,b); o._cdx=r.ndx; o._cdy=r.ndy; o._cost=r.cost; } else { o._cdx=0; o._cdy=0; } });
    }
    grp.forEach(o=>{
      const cdx = (typeof o._cdx==='number') ? o._cdx : dx;
      const cdy = (typeof o._cdy==='number') ? o._cdy : dy;
      const x=o.x+cdx, y=o.y+cdy;
      // 舞台未就绪（高度 0）时不强行钳制，避免 Token 被压到角落；正常尺寸下行为不变
      const boundW = st.width ? Math.max(36, st.width-18) : 1e9;
      const boundH = st.height ? Math.max(36, st.height-18) : 1e9;
      o.tk.x=Math.max(18,Math.min(boundW,x)); o.tk.y=Math.max(18,Math.min(boundH,y));
      const el=document.querySelector('.map-token[data-id="'+o.tk.id+'"]');
      if(el){ el.style.left=o.tk.x+'px'; el.style.top=o.tk.y+'px'; }
    });
    didMove = grp.some(o=> Math.abs(o.tk.x-o.x)>0.5 || Math.abs(o.tk.y-o.y)>0.5);
    // 战棋实时读数（网格路径代价）+ 范围环跟随
    if(mapTurn>=0 && !isGM()){
      const cur=mapInit[mapTurn]; const curTk=cur?MAP_TOKENS.find(x=>x.id===cur.id):null; const myKey=myMapId();
      if(curTk && String(curTk.owner||'').toLowerCase()===myKey){
        if(dragMoved>=6){ const mi=$('#mapMoveInfo'); if(mi){ const o0=grp.find(o=>o.tk.id===t.id)||grp[0]; const walked=Math.max(0,Math.round(o0._cost||0)); mi.style.display='block'; mi.textContent='🏃 已走 '+walked+' 格 · 本回合剩余 '+Math.max(0,Math.round((+curTk.moveLeft||0)-walked))+' 格'; } }
        renderMoveRange();
      }
    }
    renderFog(); // #241：调查员移动 → 视野源移动，迷雾与 VBL 阴影实时跟随
    if(mapRulerFrom) showDist(mapRulerFrom,t);
    const now=Date.now(); if(now-lastSync>=80){ lastSync=now; wsSyncMap(); } // 实时跟随：拖拽中节流广播
  };
  const up=()=>{ document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up);
    if(dragMoved>=6 && mapTurn>=0 && !isGM() && !blocked){
      if(mapSnap && didMove){ grp.forEach(o=>{ const s=snapToGrid(o.tk.x,o.tk.y); o.tk.x=s.x; o.tk.y=s.y; }); } // 释放后贴格（仅当确有位移且未被拦截）
      // 按网格路径代价扣减（贴格后路径 = 实际移动；贴格位移不计入直线距离，且绕开墙体）
      grp.forEach(o=>{ const mt=+o.tk.move||0; if(mt>0){ const orig=tokenCell({x:o.x,y:o.y}); const dest=tokenCell(o.tk); const path=dijkstraPath(orig,dest); const cost=path?path.cost:0; o.tk.moveLeft=Math.max(0,Math.round((+o.tk.moveLeft||0)-cost)); } });
    }
    if(dragMoved<6){ // 视为轻点
      if(mapSelectMode){ // 框选模式：切换该 Token 选中态
        if(mapSel.has(t.id)) mapSel.delete(t.id); else mapSel.add(t.id);
        renderMap();
      } else if(t.charId) openCharById(t.charId); // 普通模式：关联角色卡则打开
      else toast('该 Token 未关联角色卡 · 用「＋调查员」可从角色库布署并关联');
    }
    const mi=$('#mapMoveInfo'); if(mi) mi.style.display='none'; // 隐藏实时读数
    wsSyncMap(); renderMap();
  };
  document.addEventListener('pointermove',move); document.addEventListener('pointerup',up);
}
function rulerPick(t){ // 多点路径测距：依次点击 Token 延长路径，再次点击已选点则移除
  const i=mapPath.indexOf(t.id);
  if(i>=0){ mapPath.splice(i,1); toast('已移除路径点：'+t.name); }
  else { mapPath.push(t.id); toast('路径点 '+mapPath.length+'：'+t.name+' · 合计 '+pathTotalCells()+' 格'); }
  const last=MAP_TOKENS.find(x=>x.id===mapPath[mapPath.length-1]);
  mapRulerFrom = last || null;
  renderMap(); updatePathLabel(); wsSyncMap();
}
function pathPoints(){ // 解析路径为 Token 列表，顺带清理已被删除的 Token
  const pts=mapPath.map(id=>MAP_TOKENS.find(t=>t.id===id)).filter(Boolean);
  if(pts.length!==mapPath.length) mapPath=pts.map(t=>t.id);
  return pts;
}
function pathTotalCells(){ const p=pathPoints(); let s=0; for(let i=1;i<p.length;i++) s+=gridDistCells(p[i-1].x,p[i-1].y,p[i].x,p[i].y); return Math.round(s*10)/10; }
function renderMapPath(){ // 绘制持久化标尺（折线 + 节点序号 + 分段距离），Token 移动后自动跟随
  const svg=$('#mapPath'); if(!svg) return;
  const pts=pathPoints();
  const st=$('#mapStage'); const W=st.clientWidth||0, H=st.clientHeight||0;
  svg.setAttribute('viewBox','0 0 '+W+' '+H); svg.setAttribute('width',W); svg.setAttribute('height',H);
  if(!pts.length){ svg.innerHTML=''; return; }
  let s='';
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1], b=pts[i], ax=a.x+24, ay=a.y+24, bx=b.x+24, by=b.y+24;
    const d=+(gridDistCells(a.x,a.y,b.x,b.y).toFixed(1));
    s+='<line class="seg" x1="'+ax+'" y1="'+ay+'" x2="'+bx+'" y2="'+by+'"/>';
    s+='<text class="lbl" x="'+((ax+bx)/2)+'" y="'+((ay+by)/2-6)+'">'+d+'格 / '+(Math.round(d*5))+'尺</text>';
  }
  pts.forEach((p,i)=>{ s+='<circle class="node" cx="'+(p.x+24)+'" cy="'+(p.y+24)+'" r="5"/><text class="lbl" x="'+(p.x+24)+'" y="'+(p.y+24-11)+'">'+(i+1)+'</text>'; });
  svg.innerHTML=s;
}
function snapToGrid(x,y){ // Token 中心对齐到 CELL 网格格心（中心 = x+24）
  return { x:Math.round((x+24)/CELL)*CELL-24, y:Math.round((y+24)/CELL)*CELL-24 };
}
/*@@ m6-map:nav @@*/
/* ---------- 战棋寻路（学习 MapTool MBL / Foundry 可达区 / PlanarAlly 网格标尺） ----------
   网格中心位于 CELL 整数倍：cellCenter(cx)=cx*CELL；Token 左上 = 中心 - 24。
   移动度量 octile：正交 1 格，对角 √2 格（≈7尺，对应 5尺/格）；墙线段阻挡相邻格之间的边。 */
const GRID_DIAG=Math.SQRT2;
/* F11：dijkstraPath 的扩展上限。地图没有边界，若目标不可达（被墙隔开的区域），
   朴素 Dijkstra 会一路扩到内存耗尽、页面卡死 —— 必须有「扩这么多还没到就放弃」的上限。
   20000 次扩展 ≈ 覆盖 70 格以内的拖拽（(2×70+1)² ≈ 2 万），远超 COC 的移动力上限。 */
const PATH_MAX_NODES=20000;
function cellCenterPx(cx,cy){ return { x:cx*CELL, y:cy*CELL }; }
function tokenCell(tk){ return { cx:Math.round((tk.x+24)/CELL), cy:Math.round((tk.y+24)/CELL) }; }
function cellTopLeft(cx,cy){ return { x:cx*CELL-24, y:cy*CELL-24 }; }
function cellKey(cx,cy){ return cx+','+cy; }
function cellSub(p,q){ return {x:p.x-q.x,y:p.y-q.y}; }
function cellCross(p,q){ return p.x*q.y-p.y*q.x; }
function segIntersect(a,b,c,d){ // 线段 a-b 与 c-d 是否相交
  const d1=cellCross(cellSub(d,c),cellSub(a,c)), d2=cellCross(cellSub(d,c),cellSub(b,c)), d3=cellCross(cellSub(b,a),cellSub(c,a)), d4=cellCross(cellSub(b,a),cellSub(d,a));
  return ((d1>0&&d2<0)||(d1<0&&d2>0)) && ((d3>0&&d4<0)||(d3<0&&d4>0));
}
function pointSegDist(p,s){ const vx=s.x2-s.x1, vy=s.y2-s.y1; const wx=p.x-s.x1, wy=p.y-s.y1; const L=vx*vx+vy*vy; let t=L? (wx*vx+wy*vy)/L : 0; if(t<0)t=0; else if(t>1)t=1; const cx=s.x1+t*vx, cy=s.y1+t*vy; return Math.hypot(p.x-cx,p.y-cy); }
function pointInPoly(p, pts){ // 射线法：点是否在多边形内（pts: [{x,y}...] 闭合）
  let inside=false;
  for(let i=0,j=pts.length-1;i<pts.length;j=i++){
    const xi=pts[i].x, yi=pts[i].y, xj=pts[j].x, yj=pts[j].y;
    if(((yi>p.y)!==(yj>p.y)) && (p.x < (xj-xi)*(p.y-yi)/(yj-yi)+xi)) inside=!inside;
  }
  return inside;
}
function terrainMult(cx,cy){ // 困难地形倍率：格中心落在 terrain 多边形内 → 返回其 cost（默认 2），否则 1（对标 Foundry VTT 困难地形 / MapTool 移动代价）
  const c=cellCenterPx(cx,cy);
  for(let i=0;i<mapWalls.length;i++){ const w=mapWalls[i]; if(w.type==='terrain' && pointInPoly(c, w.pts)) return (+w.cost||2); }
  return 1;
}
function polyEdgeDist(p, pts){ // 点到多边形任意边的最短距离（用于近边命中）
  let best=1e9;
  for(let i=0,j=pts.length-1;i<pts.length;j=i++){ best=Math.min(best, pointSegDist(p, {x1:pts[j].x,y1:pts[j].y,x2:pts[i].x,y2:pts[i].y})); }
  return best;
}
function wallHitTest(wx,wy){ // 命中检测：返回距离 (wx,wy) 最近的墙/障碍/地形索引（线段近距 < 8px，多边形内含或近边 < 8px），无则 -1。供 GM 可视化编辑选中
  const p={x:wx,y:wy}; let best=-1, bestD=8;
  for(let i=0;i<mapWalls.length;i++){ const w=mapWalls[i]; let d;
    if(w.type==='poly'||w.type==='terrain'){ d = pointInPoly(p,w.pts) ? 0 : polyEdgeDist(p,w.pts); }
    else { d = pointSegDist(p, w); }
    if(d<bestD){ bestD=d; best=i; }
  }
  return best;
}
function wallBlocksCell(cx,cy){ // 墙线段：穿过单元格中心邻域即阻挡（中心距 < 0.42 格；移动穿越由 edgeBlocked 处理）；多边形：中心在内即阻挡
  const c=cellCenterPx(cx,cy);
  for(let i=0;i<mapWalls.length;i++){ const w=mapWalls[i];
    if(w.type==='poly'){ if(pointInPoly(c, w.pts)) return true; }
    else { if(pointSegDist(c, w) < CELL*0.42) return true; }
  }
  return false;
}
function edgeBlocked(a,b){ // 相邻格边被墙/多边形阻断（线段相交 或 端点/中点落入多边形）
  const A=cellCenterPx(a.cx,a.cy), B=cellCenterPx(b.cx,b.cy), M={x:(A.x+B.x)/2,y:(A.y+B.y)/2};
  for(let i=0;i<mapWalls.length;i++){ const w=mapWalls[i];
    if(w.type==='poly'){ if(pointInPoly(A,w.pts)||pointInPoly(B,w.pts)||pointInPoly(M,w.pts)) return true; }
    else { if(segIntersect(A,B,{x:w.x1,y:w.y1},{x:w.x2,y:w.y2})) return true; }
  }
  return false;
}
function gridNeighbors(cx,cy){ const out=[]; for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++){ if(!dx&&!dy) continue; out.push({cx:cx+dx,cy:cy+dy,cost:(dx&&dy)?GRID_DIAG:1}); } return out; }
function dijkstraReach(start, budget){ // 返回 Map(key -> 累计代价) 的所有可达格（代价 ≤ budget），尊重 mapWalls
  const dist={}, out={}; const sk=cellKey(start.cx,start.cy); dist[sk]=0; out[sk]=0;
  const pq=[{cx:start.cx,cy:start.cy,d:0}];
  while(pq.length){
    let bi=0; for(let i=1;i<pq.length;i++) if(pq[i].d<pq[bi].d) bi=i;
    const cur=pq.splice(bi,1)[0]; const ck=cellKey(cur.cx,cur.cy);
    if(cur.d > (dist[ck]===undefined?1e9:dist[ck])) continue;
    const ns=gridNeighbors(cur.cx,cur.cy);
    for(let i=0;i<ns.length;i++){ const n=ns[i]; if(wallBlocksCell(n.cx,n.cy)) continue; if(edgeBlocked({cx:cur.cx,cy:cur.cy},{cx:n.cx,cy:n.cy})) continue; const nd=cur.d+n.cost*terrainMult(n.cx,n.cy); if(nd>budget+1e-6) continue; const k=cellKey(n.cx,n.cy); const g=dist[k]===undefined?1e9:dist[k]; if(nd<g){ dist[k]=nd; out[k]=nd; pq.push({cx:n.cx,cy:n.cy,d:nd}); } }
  }
  return out;
}
function dijkstraPath(start, goal){ // 返回 {cells:[...],cost} 或 null（不可达）
  if(start.cx===goal.cx && start.cy===goal.cy) return {cells:[{cx:start.cx,cy:start.cy}],cost:0};
  /* F11：目标格本身被墙/障碍占据 → 直接判不可达。
     缺这一句时，下面的搜索会在【无限大】的网格上一直扩、永远碰不到目标 ——
     resolveMove 里那句「不可达 → 原地不动 + cost=Infinity」本来是永远走不到的死代码，
     玩家把 Token 拖到墙上就等于卡死整个标签页。 */
  if(wallBlocksCell(goal.cx,goal.cy)) return null;
  let expanded=0;
  const dist={}, prev={}; const sk=cellKey(start.cx,start.cy); dist[sk]=0;
  const pq=[{cx:start.cx,cy:start.cy,d:0}];
  while(pq.length){
    if(++expanded>PATH_MAX_NODES) return null; // F11：兜底 —— 被墙围死也不拖成死循环
    let bi=0; for(let i=1;i<pq.length;i++) if(pq[i].d<pq[bi].d) bi=i;
    const cur=pq.splice(bi,1)[0];
    if(cur.cx===goal.cx && cur.cy===goal.cy){
      const cells=[]; let c={cx:cur.cx,cy:cur.cy};
      while(c){ cells.unshift({cx:c.cx,cy:c.cy}); const pk=prev[cellKey(c.cx,c.cy)]; if(!pk) break; c=pk; }
      return {cells,cost:cur.d};
    }
    const ck=cellKey(cur.cx,cur.cy); if(cur.d > (dist[ck]===undefined?1e9:dist[ck])) continue;
    const ns=gridNeighbors(cur.cx,cur.cy);
    for(let i=0;i<ns.length;i++){ const n=ns[i]; if(wallBlocksCell(n.cx,n.cy)) continue; if(edgeBlocked({cx:cur.cx,cy:cur.cy},{cx:n.cx,cy:n.cy})) continue; const nd=cur.d+n.cost*terrainMult(n.cx,n.cy); const k=cellKey(n.cx,n.cy); const g=dist[k]===undefined?1e9:dist[k]; if(nd<g){ dist[k]=nd; prev[k]={cx:cur.cx,cy:cur.cy}; pq.push({cx:n.cx,cy:n.cy,d:nd}); } }
  }
  return null;
}
function resolveMove(o, dx, dy, budget){ // 依据网格路径代价把自由位移 (dx,dy) 钳制到预算内末格；返回 {ndx,ndy,cost}
  if(budget===Infinity) return {ndx:dx,ndy:dy,cost:0}; // GM：无钳制
  if(budget<=0) return {ndx:0,ndy:0,cost:0}; // 无剩余移动力 → 不可移动
  const orig=tokenCell({x:o.x,y:o.y}); const dest=tokenCell({x:o.x+dx,y:o.y+dy});
  const path=dijkstraPath(orig,dest); if(!path) return {ndx:0,ndy:0,cost:Infinity};
  if(path.cost <= budget+1e-6) return {ndx:dx,ndy:dy,cost:path.cost};
  let acc=0, finalCell=orig;
  /* F12：先算候选代价，确认不超预算再提交到 acc。
     原来写成「先 acc+= 再判断」，超预算的那一步也被算进去，最后用 Math.min(acc,budget) 封顶，
     于是 cost 报的是预算而不是真实走过的代价 —— HUD「已走 N 格」会多报（实测 2√2+1 被报成 5）。 */
  for(let i=1;i<path.cells.length;i++){ const a=path.cells[i-1], b=path.cells[i]; const step=(a.cx!==b.cx && a.cy!==b.cy)?GRID_DIAG:1; const nt=acc+step*terrainMult(b.cx,b.cy); if(nt>budget+1e-6) break; acc=nt; finalCell=b; }
  const ft=cellTopLeft(finalCell.cx,finalCell.cy); return {ndx:ft.x-o.x, ndy:ft.y-o.y, cost:acc};
}
function gridDistCells(ax,ay,bx,by){ // 两世界坐标点的网格 octile 距离（格），对标 PlanarAlly 网格标尺
  const dcx=Math.abs(Math.round((bx+24)/CELL)-Math.round((ax+24)/CELL));
  const dcy=Math.abs(Math.round((by+24)/CELL)-Math.round((ay+24)/CELL));
  return (dcx+dcy) + (GRID_DIAG-2)*Math.min(dcx,dcy);
}
/*@@ m6-map:overlay @@*/
function renderMoveRange(){ // 当前行动者可移动范围：flood-fill 真实可达格（对标 Foundry 可达区），非圆
  const svg=$('#mapRange'); if(!svg) return;
  const st=$('#mapStage'); const W=st.clientWidth||0,H=st.clientHeight||0;
  svg.setAttribute('viewBox','0 0 '+W+' '+H); svg.setAttribute('width',W); svg.setAttribute('height',H);
  if(mapTurn<0 || !mapInit.length){ svg.innerHTML=''; return; }
  const cur=mapInit[mapTurn]; const tk=cur?MAP_TOKENS.find(x=>x.id===cur.id):null; if(!tk){ svg.innerHTML=''; return; }
  const budget=(+tk.moveLeft||0); if(budget<=0){ svg.innerHTML=''; return; }
  const reach=dijkstraReach(tokenCell(tk), budget); // 真实可达格集合（octile 代价 + 墙约束）
  let s=''; let n=0;
  for(const k in reach){ const kv=k.split(','); const tl=cellTopLeft(+kv[0],+kv[1]); s+='<rect class="rngcell" x="'+(tl.x+3)+'" y="'+(tl.y+3)+'" width="'+(CELL-6)+'" height="'+(CELL-6)+'" rx="4"/>'; if(++n>1200) break; } // 超大范围降级防止 DOM 膨胀
  svg.innerHTML=s;
}
function renderWalls(){ // 绘制 Movement Layer（墙体/障碍/地形），GM 可见可绘；选中元素加 wl-sel 高亮（可视化编辑）
  const svg=$('#mapWalls'); if(!svg) return;
  const st=$('#mapStage'); const W=st.clientWidth||0,H=st.clientHeight||0;
  svg.setAttribute('viewBox','0 0 '+W+' '+H); svg.setAttribute('width',W); svg.setAttribute('height',H);
  svg.innerHTML=mapWalls.map((w,idx)=>{ const sel=(idx===mapSelectedWall)?' wl-sel':''; if(w.type==='poly'){ const pts=w.pts.map(p=>p.x+','+p.y).join(' '); return '<polygon class="wl-poly'+sel+'" points="'+pts+'"/>'; } if(w.type==='terrain'){ const pts=w.pts.map(p=>p.x+','+p.y).join(' '); return '<polygon class="wl-terrain'+sel+'" points="'+pts+'"/>'; } return '<line class="wl'+sel+'" x1="'+w.x1+'" y1="'+w.y1+'" x2="'+w.x2+'" y2="'+w.y2+'"/>'; }).join('');
}
function selectWallAt(wx,wy){ // GM 可视化编辑：选中命中墙/障碍/地形（命中则 mapSelectedWall=索引并高亮，返回 true；否则 false）
  if(!isGM()) return false;
  const idx=wallHitTest(wx,wy);
  if(idx>=0){ mapSelectedWall=idx; renderWalls(); const w=mapWalls[idx]; const label=w.type==='terrain'?'困难地形':(w.type==='poly'?'障碍区域':'墙体'); toast('已选中'+label+'（'+(idx+1)+'/'+(mapWalls.length)+'）：按 Delete 删除'); return true; }
  return false;
}
function deleteSelectedWall(){ // GM 可视化编辑：删除当前选中元素（只加不删原则下，这是唯一允许的「删」——删除用户自己绘制的墙/障碍/地形，非删功能）
  if(!isGM() || mapSelectedWall<0 || mapSelectedWall>=mapWalls.length) return false;
  const w=mapWalls[mapSelectedWall]; pushWallUndo(); mapWalls.splice(mapSelectedWall,1); mapSelectedWall=-1; saveMapWalls(); renderMap(); wsSyncMap(); const label=w.type==='terrain'?'困难地形':(w.type==='poly'?'障碍区域':'墙体'); toast('已删除'+label+'（可撤销）'); return true;
}
function deleteWallAt(wx,wy){ const idx=wallHitTest(wx,wy); if(idx<0) return false; mapSelectedWall=idx; return deleteSelectedWall(); }
function updatePathLabel(){ // 持久化读数：不自动隐藏，直至手动清空
  const el=$('#mapDist'); if(!el) return;
  const pts=pathPoints();
  clearTimeout(el._t); // 标尺持久化：取消 showDist 的自动隐藏
  if(!pts.length){ el.style.display='none'; return; }
  el.style.display='block';
  if(pts.length===1){ el.textContent='📏 起点：'+pts[0].name+' · 继续点击 Token 延长路径'; return; }
  const tot=pathTotalCells();
  el.textContent='📏 '+pts.length+' 点路径 · 合计 '+tot+' 格（'+(tot*5)+' 尺）· 再点末点可回退';
}
function showDist(a,b){
  const d=+(gridDistCells(a.x,a.y,b.x,b.y).toFixed(1));
  const el=$('#mapDist'); el.style.display='block';
  el.textContent='📏 '+a.name+' → '+b.name+'：'+d+' 格（'+Math.round(d*5)+' 尺）';
  clearTimeout(el._t); el._t=setTimeout(()=>el.style.display='none',2600);
}
/*@@ m6-map:presets @@*/
/* ---------- 地图 Token ↔ 角色卡 双向跳转 ---------- */
function openCharById(cid){
  const u=me(); if(!u||!u.characters||!u.characters.length) return;
  const idx=u.characters.findIndex(c=>c.id===cid);
  if(idx<0){ toast('关联的角色卡已不存在（可能已删除）'); return; }
  u.activeChar=idx; const c=u.characters[idx]; ensureLifecycle(c); applyCharToGlobal(c); saveApp();
  buildChar(); openDrawer();
  toast('📂 已打开角色卡：'+(c.name||'调查员'));
}
function deployFromChars(){
  const u=me(); const chars=(u&&u.characters)||[];
  if(!chars.length){ toast('你还没有角色卡，先去「我的」车一张'); return; }
  const list=chars.map((c,i)=>`<div class="cp-item" data-ci="${i}"><span>🕵️</span><div><div class="cp-name">${escapeHtml(c.name||'调查员')}</div><div class="cp-sub">${escapeHtml(c.occupation||'')} · T${tierInfo(c).tier}${MAP_TOKENS.some(t=>t.charId===c.id)?' · 已在地图':''}</div></div></div>`).join('');
  document.body.insertAdjacentHTML('beforeend',`<div class="cp-mask" id="cpMask"><div class="cp-card"><div class="cp-head">从角色库布署调查员</div><div class="cp-list">${list}</div><div class="cp-cancel" id="cpCancel">取消</div></div></div>`);
  const close=()=>{ const m=document.getElementById('cpMask'); if(m) m.remove(); };
  document.getElementById('cpCancel').onclick=close;
  document.getElementById('cpMask').addEventListener('click',e=>{ if(e.target.id==='cpMask') close(); });
  document.querySelectorAll('.cp-item').forEach(it=> it.onclick=()=>{
    const i=+it.dataset.ci; const c=chars[i];
    if(!c.id) c.id='c'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
    if(MAP_TOKENS.some(t=>t.charId===c.id)){ toast('「'+(c.name||'调查员')+'」已在地图上'); close(); return; }
    const st=$('#mapStage').getBoundingClientRect();
    MAP_TOKENS.push({id:'x'+Date.now(), name:c.name||'调查员', emoji:'🕵️', kind:'pc', x:Math.round(st.width/2), y:Math.round(st.height/2), hidden:false, charId:c.id, hp:20, hpMax:20, move:0, moveLeft:0});
    saveApp(); renderMap(); wsSyncMap(); close(); toast('已布署到地图中心：'+(c.name||'调查员'));
  });
}
/* ---------- Token 模板预设库 · 快速布署（#196） ---------- */
const TOKEN_PRESETS_BUILTIN=[
  {g:'COC · 调查员',n:'侦探',e:'🕵️',k:'pc'},{g:'COC · 调查员',n:'记者',e:'📷',k:'pc'},
  {g:'COC · 调查员',n:'医生',e:'💊',k:'pc'},{g:'COC · 调查员',n:'教授',e:'🎓',k:'pc'},
  {g:'COC · 调查员',n:'神秘学家',e:'🔮',k:'pc'},{g:'COC · 调查员',n:'工程师',e:'🔧',k:'pc'},
  {g:'COC · 威胁',n:'深潜者',e:'🐟',k:'monster'},{g:'COC · 威胁',n:'邪教徒',e:'🕯️',k:'monster'},
  {g:'COC · 威胁',n:'星之彩',e:'🟣',k:'monster'},{g:'COC · 威胁',n:'食尸鬼',e:'🧟',k:'monster'},
  {g:'COC · 威胁',n:'猎犬',e:'🐕',k:'monster'},{g:'COC · 威胁',n:'米-戈',e:'🦑',k:'monster'},
  {g:'COC · NPC',n:'警察',e:'👮',k:'npc'},{g:'COC · NPC',n:'图书管理员',e:'📚',k:'npc'},
  {g:'COC · NPC',n:'出租车司机',e:'🚕',k:'npc'},{g:'COC · NPC',n:'仆人',e:'🧹',k:'npc'},
  {g:'DND · 英雄',n:'战士',e:'⚔️',k:'pc'},{g:'DND · 英雄',n:'法师',e:'🧙',k:'pc'},
  {g:'DND · 英雄',n:'游荡者',e:'🥷',k:'pc'},{g:'DND · 英雄',n:'牧师',e:'⛪',k:'pc'},
  {g:'DND · 怪物',n:'哥布林',e:'👺',k:'monster'},{g:'DND · 怪物',n:'兽人',e:'👹',k:'monster'},
  {g:'DND · 怪物',n:'骷髅',e:'💀',k:'monster'},{g:'DND · 怪物',n:'巨龙',e:'🐉',k:'monster'},
  {g:'DND · 怪物',n:'巨蜘蛛',e:'🕷️',k:'monster'},{g:'DND · 怪物',n:'史莱姆',e:'🟩',k:'monster'},
  {g:'DND · NPC',n:'守卫',e:'🛡️',k:'npc'},{g:'DND · NPC',n:'商人',e:'💰',k:'npc'},
  {g:'DND · NPC',n:'酒保',e:'🍺',k:'npc'},{g:'DND · NPC',n:'贵族',e:'👑',k:'npc'}
];
const PRESET_LS='sg_map_presets';
function loadPresets(){ try{ const a=JSON.parse(localStorage.getItem(PRESET_LS)||'[]'); return Array.isArray(a)?a:[]; }catch(_){ return []; } }
function savePresets(a){ try{ localStorage.setItem(PRESET_LS,JSON.stringify(a)); }catch(_){} }
let presetKeepOpen=false; // 连续布署：布署后不关闭弹层，便于快速摆一排怪物
function closePreset(){ const m=document.getElementById('cpMask'); if(m) m.remove(); }
function openPresetPicker(){
  closePreset();
  const custom=loadPresets();
  let html='<div class="cp-mask" id="cpMask"><div class="cp-card"><div class="cp-head">Token 模板库 · 快速布署</div><div class="cp-list">';
  let lastG='';
  const row=(p,ci)=>{
    if(p.g!==lastG){ html+='<div class="cp-group">'+escapeHtml(p.g)+'</div>'; lastG=p.g; }
    const badge=p.k==='pc'?'调查员':(p.k==='monster'?'威胁':'NPC');
    html+='<div class="cp-item preset" data-pn="'+escapeHtml(p.n)+'" data-pe="'+escapeHtml(p.e)+'" data-pk="'+p.k+'"'+(ci>=0?' data-ci="'+ci+'"':'')+'>'
      + '<span>'+p.e+'</span><div><div class="cp-name">'+escapeHtml(p.n)+'</div><div class="cp-sub">'+badge+'</div></div>'
      + '<span class="cp-badge">'+badge+'</span>' + (ci>=0?'<span class="cp-del" data-del="'+ci+'">✕</span>':'') + '</div>';
  };
  TOKEN_PRESETS_BUILTIN.forEach(p=>row(p,-1));
  custom.forEach((p,i)=>row({g:'我的模板',n:p.n,e:p.e,k:p.k},i));
  html+='</div><div class="cp-act"><div id="presetKeep"'+(presetKeepOpen?' class="on"':'')+'>连续布署：'+(presetKeepOpen?'开':'关')+'</div><div id="presetSaveSel">选中存模板'+(mapSel.size?'（'+mapSel.size+'）':'')+'</div></div>';
  html+='<div class="cp-cancel" id="cpCancel">取消</div></div></div>';
  document.body.insertAdjacentHTML('beforeend',html);
  document.getElementById('cpCancel').onclick=closePreset;
  document.getElementById('cpMask').addEventListener('click',e=>{ if(e.target.id==='cpMask') closePreset(); });
  document.getElementById('presetKeep').onclick=function(){ presetKeepOpen=!presetKeepOpen; this.classList.toggle('on',presetKeepOpen); this.textContent='连续布署：'+(presetKeepOpen?'开':'关'); };
  document.getElementById('presetSaveSel').onclick=saveSelAsPreset;
  document.querySelectorAll('#cpMask .cp-item.preset').forEach(it=> it.onclick=e=>{
    const del=e.target.closest('.cp-del');
    if(del){ const i=+del.dataset.del; const arr=loadPresets(); const rm=arr.splice(i,1)[0]; savePresets(arr); toast('已删除模板：'+(rm?rm.n:'')); openPresetPicker(); return; }
    deployPreset({n:it.dataset.pn, e:it.dataset.pe, k:it.dataset.pk});
    if(!presetKeepOpen) closePreset();
  });
}
function deployPreset(p){ // 在地图中心附近快速布署一个模板 Token（带随机抖动避免完全重叠）
  const st=($('#mapStage')||{getBoundingClientRect:()=>({width:600,height:400})}).getBoundingClientRect();
  const jx=Math.round(Math.random()*80-40), jy=Math.round(Math.random()*80-40);
  const hid = p.k==='monster'; // 沿用既有约定：怪物默认隐藏，开 GM 图层才可见
  MAP_TOKENS.push({id:'x'+Date.now()+Math.random().toString(36).slice(2,5), name:p.n, emoji:p.e, kind:p.k,
    x:Math.max(18,Math.min(st.width-18,Math.round(st.width/2+jx))), y:Math.max(18,Math.min(st.height-18,Math.round(st.height/2+jy))),
    hidden:hid, rot:0, hp:20, hpMax:20, move:0, moveLeft:0});
  saveApp(); renderMap(); wsSyncMap();
  toast('已布署：'+p.n+(hid?'（默认隐藏 · 开 GM 图层可见）':''));
}
function saveSelAsPreset(){ // 把当前框选的 Token 存为自定义模板（localStorage 持久化）
  const ids=Array.from(mapSel);
  if(!ids.length){ toast('请先在「框选」模式下选中要存为模板的 Token'); return; }
  const arr=loadPresets(); let n=0;
  ids.forEach(id=>{ const t=MAP_TOKENS.find(x=>x.id===id); if(!t) return;
    if(arr.some(p=>p.n===t.name&&p.e===(t.emoji||'❓'))) return;
    arr.push({n:t.name,e:t.emoji||'❓',k:t.kind||'npc'}); n++; });
  savePresets(arr);
  toast(n?('已存为模板 '+n+' 个'):'这些模板已存在');
  openPresetPicker();
}
function focusCharOnMap(){
  const c=activeCharObj(); if(!c){ toast('请先选择一张角色卡'); return; }
  if(!c.id) c.id='c'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  const tk=MAP_TOKENS.find(t=>t.charId===c.id);
  if(!tk){ toast('该角色尚未在地图上布署 · 去「战术地图」点「＋调查员」'); return; }
  showMap();
  setTimeout(()=>{ const el=document.querySelector('.map-token[data-char="'+c.id+'"]'); if(el){ el.classList.add('token-focus'); setTimeout(()=>el.classList.remove('token-focus'),2300); } },140);
  toast('📍 已在战术地图定位：'+(c.name||'调查员'));
}
