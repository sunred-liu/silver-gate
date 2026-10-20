/*
 * m5-net —— 账号与网络基础设施（落盘 / 后端 API / 云端存档 / 联机房间 / 登录注册 / 访客 / 分享）
 * 覆盖：data 本地落盘 loadApp/saveApp/me + 后端 API 接入 API_BASE/USE_API/apiFetch
 *       → 角色卡 / 团本云端存档（LWW 合并 / 墓碑删除 / 快照比对触发同步）
 *       → 联机房间 WebSocket 实时同步 wsConnect/wsOnMessage/wsSyncMap（广播地图 Token/墙体/视野）
 *       → account 本机账册建档 ensureLocalAccount + 授权按钮态 withAuthLoading/withBtn/refreshAuthBtn
 *       → auth 登录注册/访客/Token/JWT（showAuth/bootApp/openSharedCharFromUrl/createAccount/getToken/JWT_SECRET/applyTheme）
 *       → share 分享链接来源 SHARE_ORIGIN_KEY/defaultShareOrigin/shareOrigin/setShareOrigin/shareUrlFor。
 * 本文件是 www/index.html 的**源码**，不是产物。
 * 分块哨兵以 "@@ m5-net:<id> @@" 形式的注释行分隔，会被 coc-apk/build.js 识别；
 * 哨兵行本身不进入产物，块体按哨兵出现顺序内联回产物的对应位置。
 * （头注释里刻意不写出哨兵的完整字面量 —— 那个字面量自带注释结束符，会把本段注释提前闭合。）
 */
/*@@ m5-net:data @@*/
function loadApp(){ try{return JSON.parse(localStorage.getItem(APP_KEY))||null;}catch(e){return null;} }
let APP=loadApp();
/* 落盘前先给"内容真的变了"的角色盖时间戳，再决定要不要触发云端同步。
   注意不能无条件盖：否则只改个昵称也会把全部角色标成最新，
   一台旧设备只要打开一次，就能用完全相同的旧数据覆盖掉新设备上的真实编辑。 */
function saveApp(){
  const n=stampCharChanges();
  try{localStorage.setItem(APP_KEY,JSON.stringify(APP));}catch(e){}
  if(n>0 && !_applyingRemote) scheduleSync();
}
if(!APP){ APP={accounts:{},session:null}; }
seedScenarios();
function me(){ return APP.session? APP.accounts[APP.session]:null; }
let CUR_CAMP=null, curTab='campaigns', curSub='mine', authMode='login', authMethod='email', lastCamps=[];
let smsPending=null, smsTimer=null, smsCountdown=0;
let authBusy=false;

/* ===== 后端 API 接入：登录注册对接真实服务 =====
   在 <head> 放置 <meta name="api-base" content="https://你的域名/api"> 即开启后端模式；
   留空则使用本地模式（localStorage 模拟），便于先试 UI。 */
const API_BASE = (function(){
  try {
    const m=document.querySelector('meta[name="api-base"]');
    let v = (m&&m.content) ? m.content.replace(/\/+$/,'') : '';
    // 相对路径仅在 http(s) 同源托管（server/index.js）时有效；file://（APK 内嵌资源）退回本地模式
    if(v.startsWith('/')){
      if(!/^https?:$/.test(location.protocol)) return ''; // file:// 等 → 本地模式
      if(location.hostname==='localhost') return 'http://47.82.106.85/api'; // Capacitor APK 内嵌 WebView(https://localhost) → 公网后端
      return v; // 浏览器同源托管
    }
    return v;
  }
  catch(e){ return ''; }
})();
const USE_API = !!API_BASE;
async function apiFetch(path, opts){
  opts = opts||{};
  const headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
  const _tok = getToken();
  if (_tok && !headers['Authorization']) headers['Authorization'] = 'Bearer ' + _tok;
  const res = await fetch(API_BASE + path, Object.assign({}, opts, {headers}));
  let data=null; try { data = await res.json(); } catch(e){}
  if(!res.ok){ const msg=(data&&(data.error||data.message)) || ('请求失败 ('+res.status+')'); const err=new Error(msg); err.status=res.status; throw err; }
  if(data==null || typeof data!=='object'){ const err=new Error('服务器响应异常 ('+res.status+')'); err.status=res.status; throw err; }
  return data;
}

/* ===== 角色卡云端存档：H5 / 小程序 / APK 换设备不丢档 =====
   设计取舍：客户端不做"哪些字段脏了"的记账，而是每次把本地全量角色推给服务端，
   由服务端按 updatedAt 做 LWW 合并后回吐权威全量。理由——离线编辑、进程被杀、
   多标签页、时钟漂移都会让本地记账失真，而"服务端合并"没有这些失效模式。
   删除必须单独走墓碑（sg_sync_v1.del）：否则一台离线设备带着旧副本回来，
   会把已删角色复活，跨设备删除就会反复横跳。 */
const SYNC_KEY='sg_sync_v1';
/* 服务端/同步注入的元字段，算"内容指纹"时要剔掉，否则会被自己的写入反复触发同步 */
var SYNC_META_FIELDS=['updatedAt','syncRev','deletedAt','rev','hasPayload','userId'];
var _charSnap={}, _syncBusy=false, _applyingRemote=false, _syncTimer=null;
var SYNC_UI={at:0, phase:'idle', note:'', err:''};

function newCharId(){ return 'INV-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function ensureCharId(c){ if(c && !c.id) c.id=newCharId(); return c; }
function syncMeta(){
  try{ const m=JSON.parse(localStorage.getItem(SYNC_KEY));
    if(m&&typeof m==='object') return {
      lastSyncAt:m.lastSyncAt||0, del:(m.del&&typeof m.del==='object')?m.del:{},
      campLastSyncAt:m.campLastSyncAt||0, cdel:(m.cdel&&typeof m.cdel==='object')?m.cdel:{}
    };
  }catch(e){}
  return {lastSyncAt:0, del:{}, campLastSyncAt:0, cdel:{}};
}
function saveSyncMeta(m){ try{ localStorage.setItem(SYNC_KEY,JSON.stringify(m)); }catch(e){} }
function charFp(c){ const o={}; Object.keys(c||{}).forEach(k=>{ if(SYNC_META_FIELDS.indexOf(k)<0) o[k]=c[k]; }); return JSON.stringify(o); }
function charSnapOf(){ const u=me(), m={}; if(u) (u.characters||[]).forEach(c=>{ if(c&&c.id) m[c.id]=charFp(c); }); return m; }
/* 以"当前存档"为基线，避免一启动就把全部角色标成刚改过 */
function seedCharSnap(){ const u=me(); if(u) _charSnap[u.id]=charSnapOf(); }
function refreshCharSnap(){ const u=me(); if(u) _charSnap[u.id]=charSnapOf(); }
function pendingDelIds(){ return Object.keys(syncMeta().del||{}); }
function stampCharChanges(){
  const u=me(); if(!u||!Array.isArray(u.characters)) return 0;
  const prev=_charSnap[u.id]||{}, next={}; let n=0; const t=Date.now();
  u.characters.forEach(c=>{
    if(!c||!c.id) return;
    const f=charFp(c); next[c.id]=f;
    if(prev[c.id]!==f){ c.updatedAt=t; c.syncRev=(c.syncRev||0)+1; n++; }
  });
  _charSnap[u.id]=next;
  return n;
}
/* 删除记账：本地先移除，同时留墓碑，下一次同步告诉服务端"这个 id 在 ts 时刻被删了" */
function markCharDeleted(id){ if(!id) return; const m=syncMeta(); m.del[id]=Date.now(); saveSyncMeta(m); scheduleSync(); }

function relTime(t){
  if(!t) return '从未同步';
  const s=Math.max(0,Math.floor((Date.now()-t)/1000));
  if(s<60) return '刚刚';
  if(s<3600) return Math.floor(s/60)+' 分钟前';
  if(s<86400) return Math.floor(s/3600)+' 小时前';
  return Math.floor(s/86400)+' 天前';
}
function scheduleSync(){
  if(!USE_API||!getToken()) return;
  if(_syncTimer) clearTimeout(_syncTimer);
  _syncTimer=setTimeout(()=>{ _syncTimer=null; syncAll({silent:true}); }, 2500);
}
/* 服务端返回的权威数据落回本地。
   关键点：按 id 而不是下标保住 activeChar，否则合并后"当前角色"会串位。 */
function applyRemoteCharacters(res){
  const u=me(); if(!u) return 0;
  const tomb=new Set((res.tombstones||[]).map(t=>t.id));
  const cur=u.characters||[];
  const activeId=(cur[u.activeChar||0]||{}).id;
  const incoming=(res.characters||[]).filter(c=>c&&c.id&&!tomb.has(c.id));
  const clean=incoming.map(c=>{
    const o={};
    Object.keys(c).forEach(k=>{ if(['userId','rev','hasPayload','syncRev'].indexOf(k)<0) o[k]=c[k]; });
    ensureLifecycle(o); ensureCharId(o); return o;
  });
  // 服务端没有、且不在墓碑里（例如刚建好还没推上去）→ 保留，下一轮再推
  const seen=new Set(clean.map(c=>c.id));
  cur.forEach(c=>{ if(c&&c.id&&!seen.has(c.id)&&!tomb.has(c.id)) clean.push(c); });
  u.characters=clean;
  let ai=0; if(activeId){ const k=clean.findIndex(c=>c.id===activeId); if(k>=0) ai=k; }
  u.activeChar=Math.min(ai, Math.max(0,clean.length-1));
  _applyingRemote=true; refreshCharSnap(); saveApp(); _applyingRemote=false;
  const kept=clean.length-incoming.length;
  if(kept>0) scheduleSync();
  return clean.length;
}
async function syncCharacters(opts){
  opts=opts||{};
  if(!USE_API||!getToken()){ SYNC_UI.phase='off'; renderSyncRow(); return {ok:false, reason:'offline'}; }
  if(_syncBusy) return {ok:false, reason:'busy'};
  _syncBusy=true; SYNC_UI.phase='syncing'; SYNC_UI.err=''; renderSyncRow();
  try{
    const u=me(); if(!u) throw new Error('未登录');
    const chars=(u.characters||[]).filter(c=>c&&c.id);
    chars.forEach(c=>{ ensureLifecycle(c); ensureCharId(c); });
    const meta=syncMeta();
    const res=await apiFetch('/investigators/sync',{method:'POST',body:JSON.stringify({
      characters:chars, deletions:meta.del||{}, since:0
    })});
    applyRemoteCharacters(res);
    meta.lastSyncAt=Date.now(); meta.del={}; saveSyncMeta(meta);
    SYNC_UI.phase='ok'; SYNC_UI.at=meta.lastSyncAt;
    SYNC_UI.note='已同步 '+((res.characters||[]).length)+' 张角色卡';
    if(!opts.silent) toast('云端同步完成');
    return {ok:true, stats:res.stats};
  }catch(e){
    SYNC_UI.phase='err'; SYNC_UI.err=authErrText(e);
    if(!opts.silent) toast('同步失败：'+authErrText(e));
    return {ok:false, reason:'error', error:e};
  }finally{
    _syncBusy=false; renderSyncRow();
    if(SYNC_UI.phase==='ok' && opts.after) try{ opts.after(); }catch(_){}
  }
}
function syncStatusText(){
  if(!USE_API) return {cls:'text-on-surface-variant', txt:'离线模式 · 未连接后端，存档仅在本机'};
  if(!getToken()) return {cls:'text-on-surface-variant', txt:'未登录 · 登录后自动云端存档'};
  if(SYNC_UI.phase==='syncing') return {cls:'text-san-blue', txt:'正在同步…'};
  if(SYNC_UI.phase==='err') return {cls:'text-blood-crimson', txt:'同步失败 · '+(SYNC_UI.err||'网络异常')};
  const m=syncMeta();
  if(pendingDelIds().length) return {cls:'text-aged-parchment', txt:'有待同步的删除 · '+pendingDelIds().length+' 张'};
  if(!m.lastSyncAt) return {cls:'text-on-surface-variant', txt:'尚未同步 · 点右侧上传本机存档'};
  return {cls:'text-primary', txt:'已云端存档 · '+relTime(m.lastSyncAt)};
}
/* 同步状态只就地改文字，不整页 re-render——否则输入框会被打断 */
function renderSyncRow(){
  const el=document.getElementById('meSyncState'); if(!el) return;
  const s=syncStatusText();
  el.className='font-body-md '+s.cls;
  el.textContent=s.txt;
  const when=document.getElementById('meSyncNote');
  if(when) when.textContent=SYNC_UI.note||('本机 '+(me()&&(me().characters||[]).length||0)+' 张 · 云端 '+(SYNC_UI.phase==='ok'?'已对齐':'待确认'));
}
if(typeof window!=='undefined'){
  window.addEventListener('online', ()=>{ if(USE_API&&getToken()) syncAll({silent:true}); });
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState!=='hidden' || !USE_API || !getToken()) return;
    const ch=stampCharChanges(), cm=stampCampChanges();
    if(ch||cm||pendingDelIds().length||pendingCampDelIds().length) syncAll({silent:true});
  });
}

/* ===== 团本云端存档：换设备不再丢团 =====
   与角色卡同一套模型：推本地全量 → 服务端按 updatedAt 做 LWW 合并 → 回吐权威全量；
   删除单独走墓碑（sg_sync_v1.cdel），避免离线设备把已删的团复活。
   身份锚点放在 cloudId 上，不动 campaign.id —— id 现在被房间 key（roomKeyOf）与列表渲染复用，
   把 number 改成 string 会连带改掉联机房间号，属于隐性破坏。 */
const CAMP_META_FIELDS=['updatedAt','syncRev','deletedAt','cloudId','rev','hasPayload','userId'];
var _campSnap={}, _campSyncBusy=false;
var CAMP_UI={at:0, note:'', err:''};

function newCampCloudId(){ return 'CMP-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function ensureCampCloudId(c){
  if(!c) return null;
  if(typeof c.cloudId!=='string' || c.cloudId.indexOf('CMP')!==0) c.cloudId=newCampCloudId();
  return c.cloudId;
}
function campFp(c){ const o={}; Object.keys(c||{}).forEach(k=>{ if(CAMP_META_FIELDS.indexOf(k)<0) o[k]=c[k]; }); return JSON.stringify(o); }
/* 只推云端的白名单字段：本机 UI 临时态（如地图 Token、展开状态）不上服务器 */
function campOut(c){
  ensureCampCloudId(c);
  const nm=c.name||c.title||'未命名团本';
  return {
    id:c.cloudId, name:nm, title:nm, system:c.system||'COC',
    act:c.act||'', gm:c.gm||'', code:c.code||'',
    owner:!!c.owner, joined:!!c.joined, members:c.members||1,
    startedAt:Number(c.startedAt)||Date.now(),
    updatedAt:Number(c.updatedAt)||Date.now()
  };
}
function campSnapOf(){ const u=me(), m={}; if(u) (u.campaigns||[]).forEach(c=>{ if(c) m[ensureCampCloudId(c)]=campFp(c); }); return m; }
function seedCampSnap(){ const u=me(); if(u) _campSnap[u.id]=campSnapOf(); }
function refreshCampSnap(){ const u=me(); if(u) _campSnap[u.id]=campSnapOf(); }
function pendingCampDelIds(){ return Object.keys(syncMeta().cdel||{}); }
/* 与 stampCharChanges 同一套「快照比对」：只有内容真的变了才盖时间戳 */
function stampCampChanges(){
  const u=me(); if(!u||!Array.isArray(u.campaigns)) return 0;
  const prev=_campSnap[u.id]||{}, next={}; let n=0; const t=Date.now();
  u.campaigns.forEach(c=>{
    if(!c) return;
    const cid=ensureCampCloudId(c); const f=campFp(c); next[cid]=f;
    if(prev[cid]!==f){ c.updatedAt=t; c.syncRev=(c.syncRev||0)+1; n++; }
  });
  _campSnap[u.id]=next;
  return n;
}
function markCampDeleted(cloudId){
  if(!cloudId) return;
  const m=syncMeta(); m.cdel[cloudId]=Date.now(); saveSyncMeta(m); scheduleSync();
}
/* 服务端权威数据落回本地：按 cloudId 认人；本机有、云端没有且不在墓碑里的团保留，下一轮再推 */
function applyRemoteCampaigns(res){
  const u=me(); if(!u) return 0;
  const strip=['userId','rev','hasPayload','syncRev','deletedAt','id'];
  const list=(u.campaigns||[]).filter(Boolean);
  list.forEach(ensureCampCloudId);
  const tomb=new Set((res.tombstones||[]).map(t=>t.id));
  const incoming=(res.campaigns||[]).filter(c=>c&&c.id&&!tomb.has(c.id));
  const merged=incoming.map(c=>{
    // 以本机旧对象为底：保住建号时写下的 UI 字段（act/gm/code…），云端只覆盖它自己管的部分
    const old=list.filter(x=>x.cloudId===c.id)[0]||{};
    const o=Object.assign({},old);
    Object.keys(c).forEach(k=>{ if(strip.indexOf(k)<0) o[k]=c[k]; });
    o.cloudId=c.id;
    if(!o.name && c.title) o.name=c.title;
    return o;
  });
  const seen=new Set(merged.map(c=>c.cloudId));
  list.forEach(c=>{ if(!seen.has(c.cloudId) && !tomb.has(c.cloudId)) merged.push(c); });
  u.campaigns=merged.filter(c=>!tomb.has(c.cloudId));
  _applyingRemote=true; refreshCampSnap(); saveApp(); _applyingRemote=false;
  renderCampSyncRow();
  if(curTab==='campaigns' && typeof renderCampaigns==='function'){ try{ renderCampaigns(curSub); }catch(_){} }
  return u.campaigns.length;
}
async function syncCampaigns(opts){
  opts=opts||{};
  if(!USE_API||!getToken()) return {ok:false, reason:'offline'};
  if(_campSyncBusy) return {ok:false, reason:'busy'};
  _campSyncBusy=true; CAMP_UI.err=''; renderCampSyncRow();
  try{
    const u=me(); if(!u) throw new Error('未登录');
    const meta=syncMeta();
    const payload=(u.campaigns||[]).filter(Boolean).map(campOut);
    const res=await apiFetch('/campaigns/sync',{method:'POST',body:JSON.stringify({
      campaigns:payload, deletions:meta.cdel||{}, since:0
    })});
    applyRemoteCampaigns(res);
    meta.campLastSyncAt=Date.now(); meta.cdel={}; saveSyncMeta(meta);
    CAMP_UI.at=meta.campLastSyncAt;
    CAMP_UI.note='云端已对齐 '+((res.campaigns||[]).length)+' 个团';
    return {ok:true, stats:res.stats};
  }catch(e){
    CAMP_UI.err=authErrText(e);
    if(!opts.silent) toast('团本同步失败：'+authErrText(e));
    return {ok:false, reason:'error', error:e};
  }finally{
    _campSyncBusy=false; renderCampSyncRow();
  }
}
/* 一次把「角色卡 + 团本」都推上去：两套数据各有自己的 busy 锁与快照，互相不阻塞 */
async function syncAll(opts){
  const a=await syncCharacters(opts||{});
  const b=await syncCampaigns(opts||{});
  return {ok:!!(a&&a.ok)||!!(b&&b.ok), characters:a, campaigns:b};
}
function campSyncStatusText(){
  if(!USE_API) return {cls:'text-on-surface-variant', txt:'离线模式 · 团本只存在本机'};
  if(!getToken()) return {cls:'text-on-surface-variant', txt:'未登录 · 登录后团本自动云端存档'};
  if(_campSyncBusy) return {cls:'text-san-blue', txt:'正在同步团本…'};
  if(CAMP_UI.err) return {cls:'text-blood-crimson', txt:'团本同步失败 · '+CAMP_UI.err};
  if(pendingCampDelIds().length) return {cls:'text-aged-parchment', txt:'有待同步的删除 · '+pendingCampDelIds().length+' 个团'};
  const m=syncMeta();
  if(!m.campLastSyncAt) return {cls:'text-on-surface-variant', txt:'团本尚未同步 · 点右侧「立即同步」'};
  return {cls:'text-primary', txt:'团本已云端存档 · '+relTime(m.campLastSyncAt)};
}
/* 只就地改文字，不整页 re-render，否则下面的输入框会被打断 */
function renderCampSyncRow(){
  const el=document.getElementById('meCampSyncState'); if(!el) return;
  const s=campSyncStatusText();
  el.className='font-body-md '+s.cls; el.textContent=s.txt;
  const n=document.getElementById('meCampSyncNote');
  if(n) n.textContent=CAMP_UI.note||('本机 '+(me()&&(me().campaigns||[]).length||0)+' 个团 · 换设备登录同一账号自动取回');
}

/* ===== 联机房间（WebSocket 实时同步） =====
   仅在 USE_API（已配置 api-base）时启用；离线模式下所有发送仅作用于本地 #log。
   服务端见 server/index.js：/api/ws —— join / chat / dice / map / presence / history。 */
const WS_BASE = (function(){
  try{
    if(!API_BASE) return '';
    let u=API_BASE;
    if(u.startsWith('/')) u=(location.protocol==='https:'?'wss://':'ws://')+location.host+u; // 同源相对路径 → 绝对 WS 地址
    else u=u.replace(/^http/,'ws');
    return u.replace(/\/+$/,'')+'/ws';
  }catch(e){ return ''; }
})();
let ws=null, wsRoom=null, wsReady=false, LFG_PWD='';
function wsConnect(){
  if(!WS_BASE) return null;
  const tok=getToken(); if(!tok) return null;
  try{
    const w=new WebSocket(WS_BASE+'?token='+encodeURIComponent(tok));
    w.onopen=()=>{ wsReady=true; if(wsRoom) w.send(JSON.stringify({type:'join',room:wsRoom,pwd:LFG_PWD})); };
    w.onmessage=(e)=>{ try{ wsOnMessage(JSON.parse(e.data)); }catch(_){} };
    w.onclose=()=>{ wsReady=false; };
    w.onerror=()=>{ wsReady=false; };
    ws=w; return w;
  }catch(e){ return null; }
}
function wsJoin(room, pwd){ if(pwd!==undefined) LFG_PWD=pwd||''; wsRoom=room; if(!ws){ wsConnect(); } else if(wsReady){ ws.send(JSON.stringify({type:'join',room,pwd:LFG_PWD})); } }
function wsLeave(){ if(ws && wsReady && wsRoom) ws.send(JSON.stringify({type:'leave'})); wsRoom=null; }
function wsSend(obj){ if(ws && wsReady){ try{ ws.send(JSON.stringify(obj)); }catch(_){} } }
function wsOnMessage(m){
  if(m.type==='welcome' || m.type==='presence'){ if(m.members) updatePresence(m.members); }
  else if(m.type==='history'){ (m.messages||[]).forEach(renderMessage); scrollLog(); }
  else if(m.type==='chat'){
    if(m.sys){ renderMessage({t:'sys', text:m.text}); }
    // 把服务端的 role='kp'|'ai' 映射成渲染器认的 gm/ai，否则 AI 会被画成「远端玩家」
    else if(m.ai){
      const isKp=(m.role==='kp');
      renderMessage({t:'msg', who:(isKp?'守秘人':m.name), role:(isKp?'gm':'ai'), ava:(isKp?'gm':'ai'), kp:isKp, text:m.text});
    }
    else { renderMessage({t:'msg',who:m.name,role:'remote',ava:'remote',text:m.text}); }
    scrollLog();
  }
  else if(m.type==='dice'){ renderMessage(m.d); scrollLog(); }
  else if(m.type==='map'){ if(typeof MAP_TOKENS!=='undefined'){ window.__wsSyncing=true; const mm=m.map||m; /* 后端广播 {type:'map',map:{tokens}}，兼容旧格式 {tokens} */ MAP_TOKENS.length=0; (mm.tokens||[]).forEach(t=>MAP_TOKENS.push(t)); if(typeof mapPath!=='undefined' && Array.isArray(mm.path)) mapPath=mm.path.slice();
    if(typeof mapBg!=='undefined' && typeof mm.bg==='string'){ mapBg=mm.bg; applyMapBg(); }
    if(typeof mapZoom!=='undefined' && mm.zoom){ mapZoom=+mm.zoom||1; mapPanX=+mm.panX||0; mapPanY=+mm.panY||0; applyMapView(); saveMapView(); }
    if(typeof mapInit!=='undefined' && Array.isArray(mm.init)) mapInit=mm.init.slice();
    if(typeof mapTurn!=='undefined' && typeof mm.turn==='number'){ mapTurn=mm.turn; renderInitTracker(); }
    if(typeof mapDamageLog!=='undefined' && Array.isArray(mm.damageLog)) mapDamageLog=mm.damageLog.slice();
    if(typeof mapWalls!=='undefined' && Array.isArray(mm.walls)){ mapWalls=mm.walls.slice(); saveMapWalls(); } // #238：收到 GM 墙体后本地落盘，离线/刷新仍保留
    renderMap(); if(typeof updatePathLabel==='function') updatePathLabel(); window.__wsSyncing=false; if(!isGM() && $('#mapScreen').classList.contains('hidden')){ const mb=document.querySelector('[data-act="map"]'); if(mb) mb.classList.add('map-live'); } } }
  else if(m.type==='setup'){ applyRoomSetup(m.setup); }
  else if(m.type==='error'){ console.warn('[WS]', m.message); }
}
function updatePresence(members){
  const d=document.querySelector('.online-dot');
  if(d && members){ d.setAttribute('title','在线 '+members.length+' 人'); d.style.background = members.length>1 ? '#3f8f88' : 'rgba(212,196,168,.4)'; }
}
function wsSyncMap(){ // GM 全量同步；玩家也可推送自己拥有控制权的 Token（服务端会做越权兜底过滤）
  if(USE_API && wsReady && wsRoom && !window.__wsSyncing){
    wsSend({type:'map', gm:isGM(), tokens:MAP_TOKENS, path:mapPath, walls:mapWalls, bg:mapBg, zoom:mapZoom, panX:mapPanX, panY:mapPanY, init:mapInit, turn:mapTurn, damageLog: mapDamageLog});
  }
}
function authKeyFromUser(u){ if(!u) return null; if(u.email) return String(u.email).toLowerCase(); if(u.phone) return 'phone:'+u.phone; if(u.id) return 'id:'+u.id; return null; }
function authErrText(e){
  const m=(((e&&(e.message||''))+''))||''; const s=(e&&e.status)||0;
  // 服务端已经给了明确的中文原因就直接用 —— 例如「原安全密钥不正确」比
  // 状态码兜底的「邮箱或安全密钥错误」有用得多，盖掉它等于把信息扔了。
  if(/^[\u4e00-\u9fa5]/.test(m)) return m;
  if(s===401) return '邮箱或安全密钥错误';
  if(s===403) return '没有权限执行该操作';
  if(s===409) return '该邮箱已注册，请直接登录';
  if(s===429) return '操作太频繁了，请稍后再试';
  if(s>=500) return '服务器开小差了，请稍后再试';
  if(/failed to fetch|networkerror|load failed|aborted|timed?\s?out|网络/i.test(m)) return '连不上服务器（'+API_BASE+'），请检查网络后重试';
  if(/cannot read|cannot convert|undefined|null|typeerror|unexpected|json/i.test(m)) return '服务暂时不可用，请稍后再试';
  if(/^[\u4e00-\u9fa5]/.test(m)) return m; // 已是中文提示
  return '操作失败，请稍后再试';
}
/*@@ m5-net:account @@*/
/* 本机账册里没有这个 key 时才真正建档。
   _freshKeys 记住"这次登录是本机首次建档"，登录收尾要靠它决定：
   是先拉云端、还是先补一张初始角色卡。 */
var _freshKeys={};
function ensureLocalAccount(key, profile, extra, noSeed){
  if(APP.accounts[key]){ if(extra) Object.assign(APP.accounts[key], extra); return false; }
  createAccount(key, profile, extra, noSeed);
  _freshKeys[key]=true;
  return true;
}
async function withAuthLoading(fn){
  if(authBusy) return; authBusy=true;
  const btn=$('#authGo'); const prev=btn.textContent;
  btn.disabled=true; btn.classList.add('busy');
  try { await fn(); } finally { authBusy=false; btn.disabled=false; btn.classList.remove('busy'); refreshAuthBtn(); }
}
async function withBtn(btn, fn){ const prev=btn.textContent; btn.disabled=true; try{ await fn(); } finally { btn.disabled=false; btn.textContent=prev; } }
function refreshAuthBtn(){
  const b=$('#authGo'); if(!b) return;
  b.textContent = (authMethod==='phone') ? '验证并进入' : (authMode==='register' ? '创建调查员档案' : '进入银之门');
}

function fmtTime(t){ const d=new Date(t); const p=x=>(''+x).padStart(2,'0'); return (d.getMonth()+1)+'/'+d.getDate()+' '+p(d.getHours())+':'+p(d.getMinutes()); }
function hpOf(c){ const a=c.attrs||{}; return Math.floor(((a.con||0)+(a.siz||0))/10); }
function sanOf(c){ return c.attrs? (c.attrs.pow||0):0; }
/*@@ m5-net:auth @@*/
/* ---------- auth ---------- */
function showAuth(){ $('#auth').classList.remove('hidden'); $('#splash').classList.add('hidden'); $('#appShell').classList.add('hidden'); $('#room').classList.add('hidden'); renderBeian(); probeApiOnce(); }
/* 进登录页时先探一次接口连通性。
   APK 里最常见的哑火原因：WebView 把页面(https://localhost)发往 http:// 接口的请求整段拦掉，
   表现就是「按钮点了没反应」。把真实原因直接晒在界面上，别让人对着哑按钮猜。 */
var _apiProbeState=0;   // 0=未探 1=进行中 2=已探通
async function probeApiOnce(force){
  const el=$('#authNet'); if(!el) return;
  if(!USE_API){ el.style.display='none'; return; }
  if(_apiProbeState===2 && !force) return;
  _apiProbeState=1;
  el.style.display='block'; el.style.color='var(--ink-2,#9a8f7d)'; el.textContent='正在连接服务器…'; el.onclick=null; el.style.cursor='default';
  const t0=Date.now();
  try{
    const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),8000);
    const r=await fetch(API_BASE+'/scenarios',{signal:ctl.signal});
    clearTimeout(timer);
    if(!r.ok) throw new Error('HTTP '+r.status);
    _apiProbeState=2;
    el.style.display='none'; el.textContent='';
    console.info('[银之门] 接口连通 '+API_BASE+'，用时 '+(Date.now()-t0)+'ms');
  }catch(e){
    _apiProbeState=0;
    el.style.color='var(--red,#B23A2E)';
    el.textContent='连不上服务器（接口 '+API_BASE+'）：'+(((e&&e.message)||e)+'')+' · 点这里重试';
    el.style.cursor='pointer';
    el.onclick=function(){ probeApiOnce(true); };
    console.warn('[银之门] 接口不通 '+API_BASE, e);
  }
}
function showAppShell(){ $('#auth').classList.add('hidden'); $('#splash').classList.add('hidden'); $('#room').classList.add('hidden'); $('#appShell').classList.remove('hidden'); switchTab('campaigns'); }

/* ===== 访客只读分享页：/c/<角色id> =====
   以前扫码进来先撞登录页：对方没有账号 → 直接流失 → 分享等于白做。
   现在：链接里的卡不是本机存档中的那张，就走访客页，从公开接口取回并用同一套 canvas 画卡，
   只留「保存图片 / 我也要做一个」两个出口，不暴露任何账号信息。 */
var VISITOR_CHAR=null, VISITOR_CANVAS=null, _visitedShareId=null;
function bootVisitorFirst(){
  const id=shareCharIdFromUrl(); if(!id) return false;
  const u=me();
  if(u && (u.characters||[]).some(c=>c&&c.id===id)) return false;   // 是自己的卡：照旧进 App 打开
  if(!USE_API) return false;
  _visitedShareId=id;
  showVisitorShell(id);
  return true;
}
function closeVisitorCard(){ const m=document.getElementById('visitorMask'); if(m) m.remove(); VISITOR_CHAR=null; VISITOR_CANVAS=null; }
function visitorAuth(mode){
  closeVisitorCard();
  showAuth();
  const tab=document.getElementById(mode==='register'?'authTabReg':'authTabLogin');
  if(tab) tab.click();
}
function showVisitorShell(id){
  if(!document.getElementById('visitorMask')){
    document.body.insertAdjacentHTML('beforeend',
      '<div class="visitor-mask" id="visitorMask"><div class="visitor-wrap">'+
      '<div class="visitor-brand"><span class="visitor-door"></span><div><b>银之门</b><i>INVESTIGATOR DOSSIER</i></div></div>'+
      '<div class="visitor-note" id="visitorNote">正在取回这张调查员档案…</div>'+
      '<div class="visitor-body" id="visitorBody" hidden></div>'+
      '<div class="visitor-acts" id="visitorActs" hidden>'+
        '<button class="primary" id="visitorSave">保存图片</button>'+
        '<button id="visitorJoin">我也要做一个</button>'+
      '</div>'+
      '<p class="beian" id="visitorBeian"></p>'+
      '<button class="visitor-link" id="visitorLogin">已有账号？去登录</button>'+
      '</div></div>');
    renderBeian();
    const sv=document.getElementById('visitorSave'); if(sv) sv.onclick=exportVisitorPng;
    const vj=document.getElementById('visitorJoin'); if(vj) vj.onclick=()=>visitorAuth('register');
    const vl=document.getElementById('visitorLogin'); if(vl) vl.onclick=()=>visitorAuth('login');
  }
  VISITOR_CHAR=null; VISITOR_CANVAS=null;
  const note=document.getElementById('visitorNote'),
        body=document.getElementById('visitorBody'),
        acts=document.getElementById('visitorActs');
  body.hidden=true; acts.hidden=true; note.hidden=false;
  note.textContent='正在取回这张调查员档案…';
  apiFetch('/public/investigator/'+encodeURIComponent(id)).then(r=>{
    const inv=r&&r.investigator;
    if(!inv) throw new Error('这张角色卡不存在或已被主人撤回');
    VISITOR_CHAR=inv;
    const paint=()=>{
      try{
        const cv=buildCharCardCanvas(inv); VISITOR_CANVAS=cv;
        body.innerHTML='<img alt="调查员档案卡" src="'+cv.toDataURL('image/png')+'"/>';
        body.hidden=false; acts.hidden=false; note.hidden=true;
      }catch(e){ note.innerHTML='<b>这张卡画不出来</b><br>'+escapeHtml(String(e&&e.message||e)); }
    };
    if(document.fonts && document.fonts.ready){ document.fonts.ready.then(paint).catch(paint); } else paint();
  }).catch(e=>{
    note.innerHTML='<b>看不到这张卡</b><br>'+escapeHtml(authErrText(e))+
      '<br><span class="visitor-dim">链接可能已过期、卡片已被主人撤回，或当前网络不通。</span>';
  });
}
function exportVisitorPng(){
  const cv=VISITOR_CANVAS; if(!cv){ toast('图片还没准备好'); return; }
  cv.toBlob(b=>{
    if(!b){ toast('导出失败'); return; }
    const nm=(VISITOR_CHAR&&VISITOR_CHAR.name)||'调查员';
    const a=document.createElement('a'); a.href=URL.createObjectURL(b);
    a.download='银之门-调查员档案-'+String(nm).replace(/[\\/:*?"<>|\s]/g,'')+'.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),2000);
    toast('已保存档案卡 PNG');
  },'image/png');
}

function bootApp(){
  applyTheme();
  renderBeian();                     // 备案号：任何入口都要能看到（工信部要求）
  if(bootVisitorFirst()) return;     // 分享链接的访客：不弹登录，直接看卡
  bootAppNormal();
}
function bootAppNormal(){
  if(USE_API){
    const tok=getToken();
    if(tok){ bootRestoreApi(tok); } else { showSplash(); setTimeout(()=>$('#splashStart').focus(),60); }
    return;
  }
  // 凭 token 自动恢复会话（本地模式）
  const tok=getToken();
  if(tok){
    const p=verifyToken(tok);
    if(p && p.email && APP.accounts[p.email]){ APP.session=p.email; seedCharSnap(); saveApp(); loadActiveChar(); showAppShell(); openSharedCharFromUrl(); const tb=document.querySelector('#tabbar button.on'); if(tb) tb.focus(); return; }
    clearToken();
  }
  if(APP.session && APP.accounts[APP.session]){ seedCharSnap(); loadActiveChar(); showAppShell(); openSharedCharFromUrl(); const tb=document.querySelector('#tabbar button.on'); if(tb) tb.focus(); }
  else { showSplash(); setTimeout(()=>$('#splashStart').focus(),60); }
}
async function bootRestoreApi(tok){
  try{
    const r=await apiFetch('/auth/me',{headers:{Authorization:'Bearer '+tok}});
    const key=authKeyFromUser(r.user);
    if(!key){ clearToken(); showAuth(); return; }
    const profile={name:(r.user&&(r.user.name||r.user.email||r.user.phone))||'调查员'};
    const extra={remote:true, id:(r.user&&r.user.id)||undefined};
    ensureLocalAccount(key, profile, extra, true);   // 新设备先不造示例角色，避免拉取前污染云端
    await finishLogin(key, '', tok);
  }catch(e){ clearToken(); showAuth(); }
}
function loadActiveChar(){ const u=me(); if(!u) return; if(u.characters&&u.characters.length){ const i=u.activeChar||0; const c=u.characters[i]; ensureLifecycle(c); const s=settleGrowth(c); applyCharToGlobal(c); saveApp(); if(s.days>0){ setTimeout(()=>showSettlement(s), 500); } } }
/* 扫卡片二维码进来：/c/<角色id> 或 ?c=<角色id>
   匹配得上就切过去；匹配不上（别的账号、或本机还没同步到）就明说，
   不静默失败——用户会以为链接坏了。 */
function shareCharIdFromUrl(){
  try{
    const m=location.pathname.match(/\/c\/([A-Za-z0-9_-]+)/);
    if(m) return m[1];
    return new URLSearchParams(location.search).get('c')||null;
  }catch(e){ return null; }
}
function openSharedCharFromUrl(){
  const id=shareCharIdFromUrl(); if(!id) return false;
  if(id===_visitedShareId) return false;   // 刚从访客页登录进来：那张卡本来就不是自己的，别再弹提示
  const u=me(); if(!u) return false;
  const arr=u.characters||[];
  const i=arr.findIndex(c=>c&&c.id===id);
  if(i<0){
    // 已登录但卡不是自己的（朋友发来的链接）→ 同样给只读页，别只回一句"不在你的存档里"就完事
    if(USE_API){ _visitedShareId=id; showVisitorShell(id); return true; }
    toast('这张角色卡不在你的存档里（可能属于其他账号）'); return false;
  }
  u.activeChar=i; applyCharToGlobal(arr[i]); saveApp(); renderMe();
  toast('已打开分享的调查员「'+(arr[i].name||'调查员')+'」');
  return true;
}
function showSettlement(s){
  let mask=document.getElementById('settleMask');
  if(!mask){
    document.body.insertAdjacentHTML('beforeend',
      '<div class="settle-mask" id="settleMask"><div class="settle-card">'+
      '<h3>离线成长结算</h3><div class="sub">你的角色在你看不见的地方，又活了一阵子</div>'+
      '<div class="settle-stats"><div class="settle-stat"><b id="setDays">0</b><span>离线天数</span></div>'+
      '<div class="settle-stat"><b id="setExp">0</b><span>经验点</span></div>'+
      '<div class="settle-stat"><b id="setFrag">0</b><span>命运残片</span></div></div>'+
      '<div class="settle-log" id="setLog"></div>'+
      '<button class="ok-btn" id="setOk">收下，继续</button></div></div>');
    mask=document.getElementById('settleMask');
    const ok=document.getElementById('setOk'); if(ok) ok.onclick=()=>mask.classList.remove('show');
    mask.onclick=(e)=>{ if(e.target===mask) mask.classList.remove('show'); };
  }
  document.getElementById('setDays').textContent=s.days;
  document.getElementById('setExp').textContent='+'+s.points;
  document.getElementById('setFrag').textContent=s.frag?'1':'0';
  document.getElementById('setLog').textContent=(s.frag?('✨ 获得命运残片：「'+s.frag.title+'」\n') : '')+'📖 '+s.logText;
  mask.classList.add('show');
}

/* ===== Auth token + 密码哈希 =====
 * 【安全边界说明】离线模式下 token 只是"本地门闩"，不是安全机制：
 *   它由前端自己签发、也由前端自己校验，任何人都能伪造——所以离线模式不做权限承诺。
 *   真正的鉴权在联机时由 server/index.js 用 process.env.JWT_SECRET 签发的 token 完成。
 *   这里用「每设备随机密钥」而不是仓库里的固定字符串，避免从此仓库签出的 token
 *   在所有实例间通用（固定密钥曾导致任意实例都能伪造他人离线身份）。 */
function localSecret(){
  const K='coc_local_secret';
  try{
    let s=localStorage.getItem(K);
    if(!s){
      s=(typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID()
        :(Date.now().toString(36)+Math.random().toString(36).slice(2));
      localStorage.setItem(K,s);
    }
    return s;
  }catch(e){ return 'offline-ephemeral'; }
}
function b64u(s){ return btoa(unescape(encodeURIComponent(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function b64d(s){ s=s.replace(/-/g,'+').replace(/_/g,'/'); return decodeURIComponent(escape(atob(s))); }
function signToken(email){ const now=Math.floor(Date.now()/1000); const payload={email,iat:now,exp:now+60*60*24*7}; const data=b64u(JSON.stringify(payload)); const sig=b64u(email+'|'+localSecret()); return data+'.'+sig; }
function verifyToken(t){ try{ const parts=(''+t).split('.'); if(parts.length!==2) return null; const p=JSON.parse(b64d(parts[0])); if(parts[1]!==b64u(p.email+'|'+localSecret())) return null; if(p.exp && p.exp*1000 < Date.now()) return null; return p; }catch(e){ return null; } }
function setToken(t){ try{ localStorage.setItem('auth_token',t); }catch(e){} }
function getToken(){ try{ return localStorage.getItem('auth_token'); }catch(e){ return null; } }
function clearToken(){ try{ localStorage.removeItem('auth_token'); }catch(e){} }
function hashPwd(p){ let h=5381; for(let i=0;i<p.length;i++) h=((h<<5)+h+p.charCodeAt(i))>>>0; return 'h'+h.toString(16); }

/* 创建账号 + 完成登录（写 token / session / 进主框架） */
function createAccount(key, profile, extra, noSeed){
  const h=hashPwd(key); const num=(parseInt(h.slice(1),16)||key.length*7)%9000+1000;
  const id='INV-'+num;
  /* noSeed=true 用于"换设备登录"：此时先不预置示例角色，等云端拉完再决定要不要补一张。
     否则本机的示例卡会在拉取之前被推上云，每换一台设备就多出一张重复角色。 */
  const chars = noSeed ? [] : [ensureCharId(buildSampleChar())];   // 角色必须带 id：云端合并/删除墓碑的身份锚点
  APP.accounts[key]=Object.assign({id, profile:Object.assign({avatar:'🕵️',bio:'一名 COC 调查员'},profile),characters:chars,campaigns:[],history:[]}, extra||{});
}
/* 所有登录路径（注册/邮箱/手机号/微信/自动恢复）都收敛到这里收尾。
   联网时必须先拉云端存档再进主界面 —— 否则"本机新建的空账册"会先被当成
   待上传数据推上去，换设备登录就会凭空多出一张重复的示例角色卡。 */
async function finishLogin(key, welcome, token){
  setToken(token || signToken(key)); APP.session=key; saveApp();
  $('#authHint').textContent=''; if(welcome) toast(welcome);
  const fresh=_freshKeys[key];
  if(USE_API && getToken()){
    seedCharSnap(); seedCampSnap();
    await syncAll({silent:true});
    const u=me();
    if(fresh && u && !(u.characters||[]).length) u.characters=[ensureCharId(buildSampleChar())];
  }
  loadActiveChar(); showAppShell(); openSharedCharFromUrl();
}

function doAuth(){ if(authMethod==='phone') return doAuthPhone(); return doAuthEmail(); }
function authEnter(e){ if(e.key!=='Enter') return; e.preventDefault(); if(authMethod==='phone'){ if(!$('#authCode').value.trim()) sendSmsCode(); else doAuth(); } else doAuth(); }

/* ===== 忘记密钥：真实的重置闭环 =====
   以前这里只回一句"重置链接已发送至你的邮箱"，但本站从未接过邮件服务，
   用户等不到邮件、也没有任何别的出路 —— 忘掉密钥就等于永久失去全部云端角色卡。
   现在改成三段式：申请重置码（服务端只写日志，不下发）→ 向管理员索取 → 填码改密钥。 */
function doForgot(){
  const panel=$('#authResetPanel'); if(!panel) return;
  panel.classList.remove('hidden');
  const em=$('#authEmail');
  if(em && !em.value.trim()) em.focus(); else { const c=$('#authResetCode'); if(c) c.focus(); }
}
function hideResetPanel(){
  const p=$('#authResetPanel'); if(!p) return;
  p.classList.add('hidden');
  ['#authResetCode','#authResetPass','#authResetPass2'].forEach(s=>{ const e=$(s); if(e) e.value=''; });
}
async function requestResetCode(){
  const hint=$('#authResetHint'); if(!hint) return;
  if(!USE_API){ hint.textContent='当前是本地模式（未连接后端），本地存档直接用邮箱 + 原密钥登录，不需要重置。'; return; }
  const email=$('#authEmail').value.trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ hint.textContent='请先在上面填写邮箱地址。'; $('#authEmail').focus(); return; }
  const btn=$('#authResetSend'); const prev=btn.textContent; btn.disabled=true; btn.textContent='申请中…';
  try{
    await apiFetch('/auth/reset',{method:'POST',body:JSON.stringify({email:email})});
    hint.innerHTML='已受理 <b>'+escapeHtml(email)+'</b> 的重置申请。<br>请向站点管理员索取 6 位重置码（30 分钟内有效），填到下面。';
    $('#authResetCode').focus();
  }catch(e){ hint.textContent=authErrText(e); }
  finally{ btn.disabled=false; btn.textContent=prev; }
}
async function confirmReset(){
  const hint=$('#authResetHint'); if(!hint) return;
  if(!USE_API){ hint.textContent='当前是本地模式，无需重置。'; return; }
  const email=$('#authEmail').value.trim().toLowerCase();
  const code=$('#authResetCode').value.trim();
  const p1=$('#authResetPass').value, p2=$('#authResetPass2').value;
  if(!code){ hint.textContent='请填写 6 位重置码。'; $('#authResetCode').focus(); return; }
  if(!p1||p1.length<6){ hint.textContent='新安全密钥至少 6 位。'; $('#authResetPass').focus(); return; }
  if(p1!==p2){ hint.textContent='两次输入的新密钥不一致。'; $('#authResetPass2').focus(); return; }
  const btn=$('#authResetGo'); const prev=btn.textContent; btn.disabled=true; btn.textContent='重置中…';
  try{
    const r=await apiFetch('/auth/reset/confirm',{method:'POST',body:JSON.stringify({email:email,code:code,newPassword:p1})});
    if(!r||!r.user){ hint.textContent='重置失败，请重新申请重置码。'; return; }
    const key=authKeyFromUser(r.user)||email;
    ensureLocalAccount(key,{name:(r.user&&r.user.name)||email.split('@')[0]},{remote:true,pwd:hashPwd(p1),id:(r.user&&r.user.id)||undefined});
    hideResetPanel();
    await finishLogin(key,'安全密钥已重置，欢迎回来',r.token);
  }catch(e){ hint.textContent=authErrText(e); }
  finally{ btn.disabled=false; btn.textContent=prev; }
}

/* ===== 昵称：注册后设置，默认「调查员#XXX」 ===== */
function genNickDefault(){ return '调查员#'+(100+Math.floor(Math.random()*900)); }
function sanitizeNick(v){ var s=String(v==null?'':v).replace(/[\r\n\t]+/g,' ').trim(); if(s.length>16) s=s.slice(0,16); return s; }
function myName(){ try{ var u=me(); var n=u&&u.profile&&u.profile.name; if(n) return String(n); }catch(e){}
  return (APP&&APP.session)?String(APP.session).split('@')[0]:'调查员'; }
function closeNickModal(){ var m=$('#nickModal'); if(m) m.remove(); }
function openNickSetup(key, token, welcome, opts){
  opts=opts||{};
  var u=APP.accounts[key];
  var cur=(u&&u.profile&&u.profile.name)||'';
  var suggested=(cur && cur.indexOf('@')<0) ? cur : genNickDefault();
  if(token) setToken(token);
  var html='<div id="nickModal" class="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/70">'
    +'<div class="bg-surface-container-high rounded-t-2xl sm:rounded-2xl w-full max-w-sm p-stack-lg shadow-2xl">'
    +'<div class="mb-stack-md"><h3 class="font-headline-md text-headline-md text-primary">'+(opts.title||'设置你的昵称')+'</h3>'
    +'<p class="font-data-mono text-[11px] text-on-surface-variant mt-1">团内其他调查员将以此名称看到你</p></div>'
    +'<input id="nickInput" maxlength="16" autocomplete="off" class="w-full bg-surface-container-highest border border-outline-variant rounded-lg px-3 py-2 text-primary outline-none focus:border-primary" placeholder="调查员#000"/>'
    +'<div class="flex items-center justify-between mt-2 mb-stack-md"><span id="nickCount" class="font-data-mono text-[11px] text-on-surface-variant"></span><button id="nickReroll" class="font-label-caps text-[11px] text-primary">换一个随机昵称</button></div>'
    +'<button id="nickSave" class="list-btn w-full">'+(opts.okText||'保存并进入银之门')+'</button>'
    +(opts.allowSkip?'<button id="nickSkip" class="w-full mt-2 py-2 font-label-caps text-label-caps text-on-surface-variant">以后再说</button>':'')
    +'</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
  var inp=$('#nickInput'); inp.value=suggested;
  var cnt=$('#nickCount');
  var upd=function(){ cnt.textContent=(inp.value.trim().length)+'/16'; };
  inp.oninput=upd; upd();
  $('#nickReroll').onclick=function(){ inp.value=genNickDefault(); upd(); inp.focus(); };
  var sk=$('#nickSkip');
  if(sk) sk.onclick=function(){ closeNickModal(); if(opts.onSaved) opts.onSaved(null); else finishLogin(key, welcome, token); };
  var mask=$('#nickModal');
  if(mask && sk) mask.addEventListener('click', function(e){ if(e.target===mask) sk.click(); });
  $('#nickSave').onclick=function(){ nickSaveNow(key, token, inp.value, welcome, opts); };
  inp.onkeydown=function(e){ if(e.key==='Enter'){ e.preventDefault(); nickSaveNow(key, token, inp.value, welcome, opts); } };
  setTimeout(function(){ try{ inp.focus(); inp.select(); }catch(_){} }, 80);
}
async function nickSaveNow(key, token, rawName, welcome, opts){
  opts=opts||{};
  var nm=sanitizeNick(rawName)||genNickDefault();
  var btn=$('#nickSave'); if(btn){ btn.disabled=true; btn.textContent='保存中…'; }
  if(APP.accounts[key]){ APP.accounts[key].profile=Object.assign({}, APP.accounts[key].profile||{}, {name:nm}); saveApp(); }
  try{ if(USE_API) await apiFetch('/auth/profile',{method:'POST',body:JSON.stringify({name:nm})}); }catch(e){}
  closeNickModal();
  if(opts.onSaved){ opts.onSaved(nm); return; }
  finishLogin(key, welcome, token);
}

/* 邮箱 + 密码 */
function doAuthEmail(){
  const email=$('#authEmail').value.trim().toLowerCase();
  const p=$('#authPass').value;
  const hint=$('#authHint');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ hint.textContent='请输入有效的邮箱地址'; $('#authEmail').focus(); return; }
  if(!p||p.length<6){ hint.textContent='安全密钥至少需要 6 位'; $('#authPass').focus(); return; }
  if(USE_API){
    withAuthLoading(async ()=>{
      try{
        if(authMode==='register'){
          const p2=$('#authPass2').value;
          if(p!==p2){ hint.textContent='两次输入的安全密钥不一致'; return; }
          const r=await apiFetch('/auth/register',{method:'POST',body:JSON.stringify({email:email,password:p,name:genNickDefault()})});
          if(!r||!r.user){ hint.textContent='服务暂时不可用，请稍后再试'; return; }
          const key=authKeyFromUser(r.user)||email;
          ensureLocalAccount(key,{name:(r.user&&r.user.name)||genNickDefault()},{remote:true,pwd:hashPwd(p),id:(r.user&&r.user.id)||undefined}, true);
          openNickSetup(key, r.token, '调查员档案已创建，欢迎踏入银之门');
        } else {
          const r=await apiFetch('/auth/login',{method:'POST',body:JSON.stringify({email,password:p})});
          if(!r||!r.user){ hint.textContent='服务暂时不可用，请稍后再试'; return; }
          const key=authKeyFromUser(r.user)||email;
          ensureLocalAccount(key,{name:(r.user&&r.user.name)||email.split('@')[0]},{remote:true,pwd:hashPwd(p),id:(r.user&&r.user.id)||undefined});
          finishLogin(key,'',r.token);
        }
      }catch(e){ hint.textContent=authErrText(e); }
    });
    return;
  }
  if(authMode==='register'){
    const p2=$('#authPass2').value;
    if(p!==p2){ hint.textContent='两次输入的安全密钥不一致'; $('#authPass2').focus(); return; }
    if(APP.accounts[email]){ hint.textContent='该邮箱已注册，请直接登录'; return; }
    createAccount(email,{name:genNickDefault()},{pwd:hashPwd(p)});
    $('#authPass').value=''; $('#authPass2').value='';
    openNickSetup(email, null, '调查员档案已创建，欢迎踏入银之门');
  } else {
    const a=APP.accounts[email];
    if(!a||a.pwd!==hashPwd(p)){ hint.textContent='邮箱或安全密钥错误'; $('#authPass').focus(); return; }
    finishLogin(email);
  }
}

/* 手机号 + 短信验证码 */
function sendSmsCode(){
  const phone=$('#authPhone').value.trim();
  const hint=$('#authHint');
  if(!/^1[3-9]\d{9}$/.test(phone)){ hint.textContent='请输入有效的 11 位手机号'; $('#authPhone').focus(); return; }
  if(USE_API){
    withBtn($('#authSendCode'), async ()=>{
      try{ await apiFetch('/auth/sms/send',{method:'POST',body:JSON.stringify({phone})}); hint.textContent='验证码已发送，请查收短信'; startSmsCountdown(); $('#authCode').focus(); }
      catch(e){ hint.textContent=authErrText(e); }
    });
    return;
  }
  if(smsCountdown>0) return;
  // 无短信后端：生成 6 位验证码并以「开发模式」提示
  smsPending={phone, code:String(Math.floor(100000+Math.random()*900000))};
  hint.textContent='';
  toast('【开发模式】验证码：'+smsPending.code);
  $('#authCode').focus();
  startSmsCountdown();
}
function startSmsCountdown(){
  smsCountdown=60;
  const btn=$('#authSendCode');
  const tick=()=>{ btn.textContent=smsCountdown+' 秒'; };
  btn.disabled=true; tick();
  clearInterval(smsTimer);
  smsTimer=setInterval(()=>{ smsCountdown--; if(smsCountdown<=0){ clearInterval(smsTimer); smsTimer=null; btn.disabled=false; btn.textContent='获取验证码'; } else tick(); },1000);
}
function doAuthPhone(){
  const phone=$('#authPhone').value.trim();
  const code=$('#authCode').value.trim();
  const hint=$('#authHint');
  if(!/^1[3-9]\d{9}$/.test(phone)){ hint.textContent='请输入有效的 11 位手机号'; $('#authPhone').focus(); return; }
  if(!/^\d{6}$/.test(code)){ hint.textContent='请输入 6 位短信验证码'; $('#authCode').focus(); return; }
  if(USE_API){
    withAuthLoading(async ()=>{
      try{
        const r=await apiFetch('/auth/sms/verify',{method:'POST',body:JSON.stringify({phone,code})});
        if(!r){ hint.textContent='服务暂时不可用，请稍后再试'; return; }
        const key=authKeyFromUser(r.user)||('phone:'+phone);
        const isNew=!APP.accounts[key];
        ensureLocalAccount(key,{name:'调查员'+phone.slice(-4)},{remote:true,phone,id:(r.user&&r.user.id)||undefined}, true);
        $('#authCode').value='';
        await finishLogin(key, isNew?'手机号已绑定，欢迎踏入银之门':'', r.token);
      }catch(e){ hint.textContent=authErrText(e); }
    });
    return;
  }
  if(!smsPending||smsPending.phone!==phone){ hint.textContent='请先获取验证码'; return; }
  if(smsPending.code!==code){ hint.textContent='验证码错误'; $('#authCode').focus(); return; }
  const key='phone:'+phone;
  const exists=!!APP.accounts[key];
  if(!exists) createAccount(key,{name:'调查员'+phone.slice(-4)},{phone});
  smsPending=null; clearInterval(smsTimer); smsTimer=null; smsCountdown=0;
  const btn=$('#authSendCode'); btn.disabled=false; btn.textContent='获取验证码';
  $('#authCode').value='';
  finishLogin(key, exists?'':'手机号已绑定，欢迎踏入银之门');
}

/* 微信三方登录（模拟扫码授权） */
function openWechat(){ $('#wechatMask').classList.remove('hidden'); $('#wechatStatus').textContent='请使用微信扫描二维码'; $('#wechatSim').disabled=false; }
function closeWechat(){ $('#wechatMask').classList.add('hidden'); }
function doWechatLogin(){
  const st=$('#wechatStatus'); const sim=$('#wechatSim');
  sim.disabled=true; st.textContent='扫描成功，请在手机上确认…';
  setTimeout(()=>{
    // 模拟一个稳定的 openid（同一浏览器复用，实现二次登录带出同一账号）
    let openid=null; try{ openid=localStorage.getItem('wx_openid'); }catch(e){}
    if(!openid){ openid='wx_'+Math.random().toString(36).slice(2,10); try{ localStorage.setItem('wx_openid',openid); }catch(e){} }
    const key='wx:'+openid;
    const exists=!!APP.accounts[key];
    if(!exists) createAccount(key,{name:'微信调查员',avatar:'💬'},{wechat:openid});
    st.textContent='授权成功';
    closeWechat();
    finishLogin(key, exists?'':'已通过微信创建调查员档案');
  }, 900);
}

/* ---------- router ---------- */
const IS_TEST = (typeof navigator!=='undefined' && /jsdom/i.test(navigator.userAgent));

function applyTheme(){
  // v3 'Aged Case File' is a light (aged-paper) design system.
  document.documentElement.classList.remove('dark');
}

function skeletonRows(tab){ return ''; }
/*@@ m5-net:share @@*/
const SHARE_ORIGIN_KEY='sg_share_origin';
function defaultShareOrigin(){
  try{
    const hn=location.hostname;
    if(/^https?:$/.test(location.protocol) && hn && hn!=='localhost' && !/^127\./.test(hn))
      return location.protocol+'//'+location.host;
  }catch(e){}
  return 'https://yinzhimen.com';   // APK / file:// / localhost 场景下的兜底域名
}
function shareOrigin(){
  try{ const v=localStorage.getItem(SHARE_ORIGIN_KEY); if(v) return v.replace(/\/+$/,''); }catch(e){}
  return defaultShareOrigin();
}
function setShareOrigin(v){
  try{
    v=String(v||'').trim().replace(/\/+$/,'');
    if(!v) localStorage.removeItem(SHARE_ORIGIN_KEY); else localStorage.setItem(SHARE_ORIGIN_KEY,v);
  }catch(e){}
}
function shareUrlFor(c){ const id=(c&&c.id)||''; return id? shareOrigin()+'/c/'+encodeURIComponent(id) : shareOrigin(); }
