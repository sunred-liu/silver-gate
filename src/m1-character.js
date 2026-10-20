/*
 * m1-character —— 角色（建卡 / 导入导出 / 卡面 / 生命周期）
 * 覆盖：cheka 建卡与属性掷骰 → 年龄调整 → 角色卡 JSON 备份 → 卡面抽屉 UI
 *       → 角色对象装配 build*Char → 生命周期（五标签位 / 关键词映射 / 命运残片 /
 *       离线成长 / 字段回填 / 幕间成长 / T1–T5 阶层）。
 * 本文件是 www/index.html 的**源码**，不是产物。
 * 分块哨兵以 "@@ m1-character:<id> @@" 形式的注释行分隔，会被 coc-apk/build.js 识别；
 * 哨兵行本身不进入产物，块体按哨兵出现顺序内联回产物的对应位置。
 * （头注释里刻意不写出哨兵的完整字面量 —— 那个字面量自带注释结束符，会把本段注释提前闭合。）
 */
/*@@ m1-character:cheka @@*/
/* ---------- cheka (character creation) ---------- */
let ck=null;
function roll3d6x5(){let s=0;for(let i=0;i<3;i++)s+=1+Math.floor(Math.random()*6);return s*5;}
function rollAttr(k){ if(k==='edu'||k==='siz'||k==='int'){let s=0;for(let i=0;i<2;i++)s+=1+Math.floor(Math.random()*6);return (s+6)*5;} return roll3d6x5(); }
function calcDerived(a, age){
  const hp=Math.floor((a.con+a.siz)/10);
  const mp=Math.floor(a.pow/5);
  const sum=a.str+a.siz;
  let db,build;
  if(sum<65){db="-2";build=-2;}
  else if(sum<85){db="-1";build=-1;}
  else if(sum<125){db="0";build=0;}
  else if(sum<165){db="+1d4";build=1;}
  else if(sum<205){db="+1d6";build=2;}
  else if(sum<285){db="+2d6";build=3;}
  else if(sum<365){db="+3d6";build=4;}
  else if(sum<445){db="+4d6";build=5;}
  else {db="+5d6";build=6;}
  let move=9;
  if(a.dex<a.siz && a.str<a.siz) move=7;
  else if(a.dex<a.siz || a.str<a.siz) move=8;
  let movAdjust=0;
  if(age){ const adj=ageAdjustFor(age); if(adj) movAdjust=adj.movAdjust||0; }
  move=Math.max(1, move-movAdjust);
  return {hp,mp,san:a.pow,luck:ck?ck.luck:CHAR.luck,db,build,move};
}
/* ---------- 年龄调整（COC7 规则，借 SLMT/coc7-character-generator 的年龄表） ---------- */
const AGE_ADJUSTMENTS=[
  {min:15,max:19,rule:"力量与体型合计 −5、教育 −5、幸运两次取高",debufs:[{attrs:["str","siz"],value:5},{attrs:["edu"],value:5}],eduBufCheckTimes:0,lukTimes:2,movAdjust:0},
  {min:20,max:39,rule:"进行 1 次教育增强检定",debufs:[],eduBufCheckTimes:1,lukTimes:1,movAdjust:0},
  {min:40,max:49,rule:"力量/体质/敏捷合计 −5、外貌 −5、2 次教育增强检定",debufs:[{attrs:["str","con","dex"],value:5},{attrs:["app"],value:5}],eduBufCheckTimes:2,lukTimes:1,movAdjust:1},
  {min:50,max:59,rule:"力量/体质/敏捷合计 −10、外貌 −10、3 次教育增强检定",debufs:[{attrs:["str","con","dex"],value:10},{attrs:["app"],value:10}],eduBufCheckTimes:3,lukTimes:1,movAdjust:2},
  {min:60,max:69,rule:"力量/体质/敏捷合计 −20、外貌 −15、4 次教育增强检定",debufs:[{attrs:["str","con","dex"],value:20},{attrs:["app"],value:15}],eduBufCheckTimes:4,lukTimes:1,movAdjust:3},
  {min:70,max:79,rule:"力量/体质/敏捷合计 −40、外貌 −20、4 次教育增强检定",debufs:[{attrs:["str","con","dex"],value:40},{attrs:["app"],value:20}],eduBufCheckTimes:4,lukTimes:1,movAdjust:4},
  {min:80,max:89,rule:"力量/体质/敏捷合计 −80、外貌 −25、4 次教育增强检定",debufs:[{attrs:["str","con","dex"],value:80},{attrs:["app"],value:25}],eduBufCheckTimes:4,lukTimes:1,movAdjust:5}
];
function ageAdjustFor(age){ age=+age||0; if(age<15||age>89) return AGE_ADJUSTMENTS[1]; for(const a of AGE_ADJUSTMENTS){ if(age<=a.max) return a; } return AGE_ADJUSTMENTS[AGE_ADJUSTMENTS.length-1]; }
function rollD100(){ return 1+Math.floor(Math.random()*100); }
/* 按年龄调整车卡：减益随机分摊到属性、教育增强检定、幸运两次取高 */
function applyAgeEffects(ck){
  const adj=ageAdjustFor(ck.age); if(!adj) return;
  (adj.debufs||[]).forEach(d=>{
    const avail={}; let total=0;
    d.attrs.forEach(k=>{ const v=ck.attrs[k]||0; const can=Math.max(0,v-15); avail[k]=can; total+=can; });
    if(total<=d.value){ d.attrs.forEach(k=> ck.attrs[k]=Math.max(15,(ck.attrs[k]||0)-avail[k])); }
    else { let left=d.value; const ks=d.attrs.slice(); let guard=0; while(left>0 && guard++<999){ const k=ks[guard%ks.length]; const take=Math.min(1,avail[k]); if(take>0){ ck.attrs[k]=Math.max(15,(ck.attrs[k]||0)-take); avail[k]-=take; left-=take; } } }
  });
  for(let t=0;t<(adj.eduBufCheckTimes||0);t++){
    if((ck.attrs.edu||0)>=99) break;
    if(rollD100()>(ck.attrs.edu||0)){ const add=1+Math.floor(Math.random()*10); ck.attrs.edu=Math.min(99,(ck.attrs.edu||0)+add); }
  }
  let luck=0; for(let t=0;t<(adj.lukTimes||1);t++){ const v=roll3d6x5(); if(v>luck) luck=v; } ck.luck=luck;
}
/*@@ m1-character:backup @@*/
/* ---------- 角色卡 JSON 备份（借 jumperrong/trpg-character-sheet 的导入导出思路） ---------- */
function exportChars(){
  const u=me(); if(!u) return;
  const data=JSON.stringify({app:'silvergate-coc', version:1, exportedAt:new Date().toISOString(), characters:u.characters||[]}, null, 2);
  const blob=new Blob([data],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='coc-chars-'+(new Date().toISOString().slice(0,10))+'.json';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast('已导出 '+(u.characters?u.characters.length:0)+' 张角色卡');
}
function importChars(){
  const u=me(); if(!u) return;
  const inp=document.createElement('input'); inp.type='file'; inp.accept='.json';
  inp.onchange=()=>{ const f=inp.files[0]; if(!f) return; const r=new FileReader();
    r.onload=()=>{ try{
      const data=JSON.parse(r.result); const arr=Array.isArray(data)?data:(data.characters||[]); if(!Array.isArray(arr)) throw 0;
      const cur=u.characters||[]; let added=0;
      /* 导入的卡必须带唯一 id：id 是云端合并的身份锚点，
         备份文件里可能没有 id，也可能和现有角色撞 id —— 撞了就得换新 id，
         否则会把本机同 id 的角色覆盖掉。 */
      arr.forEach(c=>{ if(c&&c.name&&c.attrs){ ensureLifecycle(c); ensureCharId(c); if(cur.some(x=>x&&x.id===c.id)) c.id=newCharId(); cur.push(c); added++; } });
      u.characters=cur; saveApp(); renderMe(); renderSyncRow(); toast('已导入 '+added+' 张角色卡');
    }catch(e){ showDialog('导入失败','文件不是有效的角色卡备份（JSON）。'); } };
    r.readAsText(f); };
  inp.click();
}
function occSkills(name){const o=OCCUPATIONS.find(x=>x.name===name);return o?o.skills:[];}
function skillBase(n){const f=SKILL_CATALOG.find(([nm])=>nm===n);return f?f[1]:0;}
function adjustSkill(n,delta){
  const occ=occSkills(ck.occupation); const isOcc=occ.includes(n); const base=skillBase(n);
  let val=ck.skills[n];
  if(delta>0){
    if(val+5>95) return;
    let pool = isOcc? ck.attrs.edu*4 : ck.attrs.edu*2;
    SKILL_CATALOG.forEach(([nm,b])=>{ if(occ.includes(nm)===isOcc) pool-=Math.max(0,ck.skills[nm]-b); });
    if(pool<5) return;
    ck.skills[n]+=5;
  } else { if(val<=base) return; ck.skills[n]-=5; }
}
function autoSpend(){
  const occ=occSkills(ck.occupation);
  let occPool=ck.attrs.edu*4, intPool=ck.attrs.edu*2;
  occ.forEach(n=>{ while(occPool>=5 && ck.skills[n]<70){ ck.skills[n]+=5; occPool-=5; } });
  SKILL_CATALOG.map(([n])=>n).filter(n=>!occ.includes(n)).forEach(n=>{ while(intPool>=5 && ck.skills[n]<50){ ck.skills[n]+=5; intPool-=5; } });
}
function randomGen(){
  ck.age=(+ck.age>=15 && +ck.age<=89)? +ck.age : 25;
  ATTRKEYS.forEach(k=> ck.attrs[k]=rollAttr(k));
  applyAgeEffects(ck);
  ck.occupation=OCCUPATIONS[Math.floor(Math.random()*OCCUPATIONS.length)].name;
  SKILL_CATALOG.forEach(([n,b])=> ck.skills[n]=b);
  autoSpend(); renderCheka();
}
function openCheka(target){
  let src, isNew=false, tgt=null;
  if(target==='new'){ isNew=true; src=buildBlankChar(); }
  else if(target && typeof target==='object'){ tgt=target; src=target; }
  else { src=buildActiveCharObj(); }
  ck={ id: isNew? newCharId() : (src.id||undefined), name:src.name||'调查员', attrs:src.attrs?Object.assign({},src.attrs):{}, luck:src.luck!=null?src.luck:CHAR.luck, age:src.age!=null?src.age:25, occupation:src.occupation||'私人侦探', skills:src.skills?Object.assign({},src.skills):{}, bio:src.backstory||'', items:(src.items||[]).slice(), target: isNew?'new':(tgt||'active'), mode: src.mode||'coc', tags: (src.tags&&src.tags.length)? src.tags.map(t=>({slot:t.slot,text:t.text})) : defaultTags(src.occupation||'私人侦探') };
  if(ck.mode==='wanxiang'){ ck.attrs={str:50,con:50,dex:50,app:50,pow:60,siz:50,int:60,edu:60}; ck.skills=tagSkills(ck.tags, ck.occupation); }
  ATTRKEYS.forEach(k=>{ if(ck.attrs[k]===undefined) ck.attrs[k]=50; });
  SKILL_CATALOG.forEach(([n,b])=>{ if(ck.skills[n]===undefined) ck.skills[n]=b; });
  $('#cheka').classList.add('show'); renderCheka(); setTimeout(()=>$('#chekaBack').focus(),60);
}
function closeCheka(){ $('#cheka').classList.remove('show'); }
function chekaAttrIcon(k){return {str:'fitness_center',con:'favorite',dex:'run_circle',app:'face',pow:'psychology',siz:'straighten',int:'lightbulb',edu:'school'}[k]||'circle';}
function renderCheka(){
  const ex=document.querySelector('#ckBio'); if(ex) ck.bio=ex.value;
  const a=ck.attrs, d=calcDerived(a), occ=occSkills(ck.occupation);
  let occPool=a.edu*4, intPool=a.edu*2;
  SKILL_CATALOG.forEach(([n,b])=>{ const spent=Math.max(0,ck.skills[n]-b); if(occ.includes(n)) occPool-=spent; else intPool-=spent; });
  const modeSeg=`<div class="ck-mode">
    <button data-act="mode" data-m="coc" class="${ck.mode==='coc'?'on':''}">标准 COC 车卡<small>8属性·职业·52技能</small></button>
    <button data-act="mode" data-m="wanxiang" class="${ck.mode==='wanxiang'?'on':''}">万象标签建卡<small>5 个标签·极简</small></button>
  </div>`;
  let core;
  if(ck.mode==='wanxiang'){
    const tagsHtml=TAG_SLOTS.map(s=>{
      const t=(ck.tags.find(x=>x.slot===s.slot)||{}).text||'';
      return `<div class="ck-tag ${s.slot==='weak'?'weak':''}">
        <div class="ck-tag-l"><span class="dot"></span>${s.label}</div>
        <input data-tag="${s.slot}" value="${escapeHtml(t)}" placeholder="写下你的${s.label}…" />
        <div class="ck-tag-h">${s.hint}</div>
      </div>`;
    }).join('');
    const sk=tagSkills(ck.tags, ck.occupation);
    const prev=['侦查','手枪','急救','话术','图书馆','聆听','心理学','神秘学'].map(n=>`<span class="chip" style="margin:2px">${n} ${sk[n]}</span>`).join(' ');
    core=`<div class="ck-sec"><div class="ck-sec-h">万象标签 · 角色由五个词定义</div><div class="ck-tags">${tagsHtml}</div>
      <div class="ck-derived-note">标签自动推导技能值（直接相关 60 / 间接 40 / 无关联 20 / 弱点相关 10），并保留 COC 的 SAN/HP/MP 派生。当前 SAN=${d.san} · HP=${d.hp} · MP=${d.mp} · 幸运=${d.luck}。<br>预览：${prev}</div>
    </div>`;
  } else {
    const attrCards=ATTRKEYS.map(k=>{
      const fmt=(k==='siz'||k==='int')?'2d6+6 ×5':'3d6 ×5';
      return `<div class="ck-attr"><button class="ck-reroll" data-act="rattr" data-k="${k}"><span class="material-symbols-outlined" style="font-size:14px;">casino</span></button><div class="ck-attr-k">${ATT_NAME[k]}</div><div class="ck-attr-v">${a[k]}</div><div class="ck-attr-f">${fmt}</div></div>`;
    }).join('');
    const skillRows=SKILL_CATALOG.map(([n])=>{
      const v=ck.skills[n], isOcc=occ.includes(n);
      return `<div class="ck-skill"><span class="ck-sname">${n} <i class="ck-cat ${isOcc?'occ':'intr'}">${isOcc?'职':'兴'}</i></span>
        <span class="ck-ctrl"><button data-act="sdown" data-k="${n}">−</button><b>${v}</b><button data-act="sup" data-k="${n}">+</button></span></div>`;
    }).join('');
    core=`<div class="ck-sec"><div class="ck-sec-h">属性 <button class="ck-mini" data-act="rall">🎲 全部重掷</button></div><div class="ck-attrs">${attrCards}</div></div>
    <div class="ck-sec"><div class="ck-sec-h">派生数值</div><div class="ck-der"><span>HP <b>${d.hp}</b></span><span>SAN <b>${d.san}</b></span><span>MP <b>${d.mp}</b></span><span>幸运 <b>${d.luck}</b></span><span>伤害加值 <b>${d.db}</b></span><span>体格 <b>${d.build}</b></span><span>移动 <b>${d.move}</b></span></div></div>
    <div class="ck-sec"><div class="ck-sec-h">技能分配（每次 ±5）</div>${skillRows}</div>`
      + cocRulesHtml();
  }
  const itemRows=ck.items.map((it,i)=>`<div class="ck-item"><span>${escapeHtml(it[0])}${it[1]?` <i style="color:#9c9482;font-style:normal;font-size:11px;">${escapeHtml(it[1])}</i>`:''}</span><button data-act="delitem" data-i="${i}"><span class="material-symbols-outlined" style="font-size:16px;">close</span></button></div>`).join('');
  document.getElementById('chekaBody').innerHTML=`
    ${modeSeg}
    <div class="ck-sec"><div class="ck-sec-h">调查员姓名</div><input id="ckName" class="ck-textarea" style="min-height:auto;padding:10px 12px;" placeholder="给调查员起个名字" value="${escapeHtml(ck.name||'')}" /></div>
    <div class="ck-sec"><div class="ck-sec-h">年龄（15–89，影响属性与移动）</div><input id="ckAge" type="number" min="15" max="89" class="ck-textarea" style="min-height:auto;padding:10px 12px;" value="${ck.age||25}" /></div>
    ${core}
    <div class="ck-sec"><div class="ck-sec-h">职业</div>
      <div class="ck-occ">
        <button type="button" class="ck-occ-trigger" data-act="occopen">${escapeHtml(ck.occupation)} <span style="color:#b8a98c;">▾</span></button>
        <div class="ck-occ-pop" id="ckOccPop" style="display:none;">
          <input id="ckOccSearch" class="ck-occ-search" placeholder="搜索职业…" />
          <div class="ck-occ-list" id="ckOccList">${occGroupHtml('')}</div>
        </div>
      </div>
      <div class="ck-pools font-data-mono">职业技能点剩余 <b class="${occPool<0?'neg':''}" style="color:${occPool<0?'#e0533b':'#D4C4A8'};">${occPool}</b> · 兴趣点剩余 <b class="${intPool<0?'neg':''}" style="color:${intPool<0?'#e0533b':'#D4C4A8'};">${intPool}</b></div></div>
    <div class="ck-sec"><div class="ck-sec-h">背景故事</div><textarea id="ckBio" class="ck-textarea">${escapeHtml(ck.bio||'')}</textarea></div>
    <div class="ck-sec"><div class="ck-sec-h">随身物品</div>${itemRows}<div class="ck-add"><input id="ckItemInput" placeholder="添加物品…"/><button data-act="additem"><span class="material-symbols-outlined">add</span></button></div></div>
  `;
}
function saveCheka(){
  ck.bio=document.querySelector('#ckBio').value;
  const nm=document.querySelector('#ckName'); if(nm) ck.name=nm.value.trim()||ck.name;
  const obj=buildCharObj();
  const u=me();
  if(u){
    if(ck.target==='new'){ u.characters=u.characters||[]; const _i = (obj.id)? u.characters.findIndex(function(x){ return x && x.id===obj.id; }) : -1; if(_i>=0){ u.characters[_i]=obj; u.activeChar=_i; } else { u.characters.push(obj); u.activeChar=u.characters.length-1; } }
    else if(ck.target && ck.target!=='active'){ const i=u.characters.indexOf(ck.target); if(i>=0){ u.characters[i]=obj; if(u.activeChar===i) applyCharToGlobal(obj); } }
    else { if(u.characters&&u.characters[u.activeChar||0]){ u.characters[u.activeChar||0]=obj; } else { u.characters=u.characters||[]; u.characters.push(obj); u.activeChar=u.characters.length-1; } }
    saveApp();
  }
  applyCharToGlobal(obj);
  buildChar(); closeCheka(); toast('✓ 车卡已保存');
  if(APP.session&&curTab==='me'){ switchTab('me'); }}
function occGroupHtml(filter){
  const f=(filter||'').trim();
  return OCC_GROUPS.map(grp=>{
    const items=grp.list.filter(n=> !f || n.indexOf(f)>=0);
    if(items.length===0) return '';
    return `<div class="ck-occ-grp">${escapeHtml(grp.g)}</div>`+items.map(n=>`<div class="ck-occ-opt${n===ck.occupation?' on':''}" data-act="occsel" data-v="${escapeHtml(n)}">${escapeHtml(n)}</div>`).join('');
  }).join('');
}
function chekaClick(e){
  const btn=e.target.closest('[data-act]'); if(!btn) return;
  const act=btn.dataset.act;
  if(act==='rattr'){ ck.attrs[btn.dataset.k]=rollAttr(btn.dataset.k); renderCheka(); }
  else if(act==='rall'){ ATTRKEYS.forEach(k=> ck.attrs[k]=rollAttr(k)); ck.luck=roll3d6x5(); renderCheka(); }
  else if(act==='sup'){ adjustSkill(btn.dataset.k,5); renderCheka(); }
  else if(act==='sdown'){ adjustSkill(btn.dataset.k,-5); renderCheka(); }
  else if(act==='delitem'){ ck.items.splice(+btn.dataset.i,1); renderCheka(); }
  else if(act==='additem'){ const inp=document.querySelector('#ckItemInput'); const v=inp.value.trim(); if(v){ ck.items.push([v,'']); renderCheka(); } }
  else if(act==='occopen'){ const p=document.getElementById('ckOccPop'); if(p) p.style.display = p.style.display==='none'?'block':'none'; }
  else if(act==='occsel'){ ck.occupation=btn.dataset.v; if(ck.mode==='wanxiang'){ ck.skills=tagSkills(ck.tags, ck.occupation); } renderCheka(); }
  else if(act==='mode'){ switchChekaMode(btn.dataset.m); }
}
function switchChekaMode(m){
  if(m===ck.mode) return;
  ck.mode=m;
  if(m==='wanxiang'){ ck.attrs={str:50,con:50,dex:50,app:50,pow:60,siz:50,int:60,edu:60}; ck.tags=defaultTags(ck.occupation); ck.skills=tagSkills(ck.tags, ck.occupation); }
  else { ATTRKEYS.forEach(k=> ck.attrs[k]=rollAttr(k)); ck.luck=roll3d6x5(); SKILL_CATALOG.forEach(([n,b])=> ck.skills[n]=b); autoSpend(); renderCheka(); return; } // 升级为标准模式：掷骰补全属性/技能（保留职业）
  renderCheka();
}
function chekaInput(e){ if(e.target.id==='ckOccSearch'){ const list=document.getElementById('ckOccList'); if(list) list.innerHTML=occGroupHtml(e.target.value); }
  else if(e.target.id==='ckAge'){ ck.age=Math.max(15,Math.min(89,+e.target.value||25)); renderCheka(); }
  else if(e.target.dataset && e.target.dataset.tag){ const slot=e.target.dataset.tag; const t=ck.tags.find(x=>x.slot===slot); if(t) t.text=e.target.value; if(ck.mode==='wanxiang'){ ck.skills=tagSkills(ck.tags, ck.occupation); } } }

function sendDiceCard(d){
  renderMessage({t:'dice',who:isGM()?'守秘人':myName(),role:isGM()?'gm':'me',ava:isGM()?'gm':'me',...d});
  scrollLog();
  wsSend({type:'dice',skill:d.skill,diff:d.diff,roll:d.roll,target:d.target,tens:d.tens,ones:d.ones,bp:d.bp,vis:d.vis}); // 联机广播掷骰
}
function doRoll(){
  const st=diceState;
  if(st.mode==='coc'){
    const skill=$('#skillSel').value;
    const d=rollCOC(skill,st.diff,st.bp,parseInt($('#modInput').value||'0',10));
    sendDiceCard(d);
    if(AI.cfg.kp && Keeper.pending) Keeper.onRoll(d);
    const dc=document.querySelector('#log .dice-card:last-child');
    if(dc){ const dr=dc.querySelector('.dice-roll'), dn=dc.querySelector('.dice-num'); if(dr) dr.classList.add('dice-shake'); if(dn) dn.classList.add('pop'); }
    toast(st.vis==='private'?'🔒 已发送暗骰（仅守秘人可见）':'🎲 已公开掷骰');
  } else {
    const d=rollFree(parseInt($('#freeDie').value,10),parseInt($('#freeCount').value||'1',10),parseInt($('#freeMod').value||'0',10));
    const ftxt=`自由掷骰 ${d.count}d${d.face}${d.mod?((d.mod>0?'+':'')+d.mod):''} = [${d.res.join(', ')}] 合计 ${d.total}`;
    renderMessage({t:'msg',who:isGM()?'守秘人':myName(),role:isGM()?'gm':'me',text:ftxt,ava:isGM()?'gm':'me'});
    wsSend({type:'chat',text:ftxt});
    scrollLog();
    toast('🎲 已掷骰');
  }
  closeSheet();
}

/*@@ m1-character:drawer @@*/
/* ---------- sheet / drawer controls ---------- */
function openSheet(){$('#diceSheet').classList.add('show');$('#sheetMask').classList.add('show');}
function closeSheet(){$('#diceSheet').classList.remove('show');$('#sheetMask').classList.remove('show');}
function openDrawer(){ $('#drawer').classList.add('show'); $('#drawerMask').classList.add('show'); setTimeout(()=>$('#drawerClose').focus(),60);
  renderGrowthPane(); renderFragPane();
  const tabs=document.getElementById('drawerTabs');
  if(tabs && !tabs.dataset.bound){ tabs.dataset.bound='1';
    tabs.querySelectorAll('button').forEach(b=>b.onclick=()=>{
      tabs.querySelectorAll('button').forEach(x=>x.classList.remove('on'));
      b.classList.add('on');
      document.getElementById('paneOverview').classList.toggle('on', b.dataset.pane==='overview');
      document.getElementById('paneGrowth').classList.toggle('on', b.dataset.pane==='growth');
      document.getElementById('paneFrag').classList.toggle('on', b.dataset.pane==='frag');
    });
  }
}
function activeCharObj(){ const u=me(); if(u&&u.characters&&u.characters.length) return ensureLifecycle(u.characters[u.activeChar||0]); return null; }
function renderGrowthPane(){
  const pane=document.getElementById('paneGrowth'); if(!pane) return;
  const c=activeCharObj(); if(!c) return;
  const ti=tierInfo(c); const g=c.growth||{points:0,log:[]};
  const occ=occSkills(c.occupation);
  const intSkills=SKILL_CATALOG.map(([n])=>n).filter(n=>!occ.includes(n)).filter(n=>n!=='克苏鲁神话').filter(n=>n!=='信用');
  const allocBtns = g.points>0
    ? intSkills.slice(0,14).map(n=>`<button data-grow="${escapeHtml(n)}"><span class="gd-ico">🎲</span>${escapeHtml(n)} <small>(${c.skills[n]||0}·1d${growthDie(c.skills[n]||0)})</small></button>`).join('')
    : '<span class="font-data-mono text-[11px] text-on-surface-variant">暂无可分配成长点数。角色离线时会自动积累（每日 1 点，封顶 7 天）。</span>';
  const logHtml=(g.log&&g.log.length)? g.log.map(e=>{
    if(e.type==='grow') return `<li class="${e.ok?'gd-ok':'gd-fail'}">${escapeHtml(e.text)}<span class="gd">${e.date}${e.ok?' · ✦成长':' · 未成长'}</span></li>`;
    return `<li>${escapeHtml(e.text)}<span class="gd">${e.date} · +${e.exp} 经验${e.frag?' · 残片「'+escapeHtml(e.frag)+'」':''}</span></li>`;
  }).join('') : '<li class="frag-empty">还没有日常记录。去跑一场团，或等角色在你看不见的地方慢慢变强。</li>';
  pane.innerHTML=`<div class="growth-top">
      <div class="growth-row"><span class="k">阶层 T${ti.tier}</span><span class="v">${escapeHtml(ti.name)}</span></div>
      <div class="growth-bar"><i style="width:${ti.pct}%"></i></div>
      <div class="growth-row"><span class="k">${ti.maxed?'已达传说尽头':('距 '+escapeHtml(ti.next)+'（T'+(ti.tier+1)+'）')}</span><span class="v">${ti.exp} / ${ti.need||'∞'}</span></div>
      <div class="growth-row"><span class="k">可分配成长点数</span><span class="v">${g.points}</span></div>
      <div class="growth-row"><span class="k">完成团次数</span><span class="v">${c.sessions||0}</span></div>
      <div class="growth-row"><span class="k">疯狂印记</span><span class="v">${(c.madness||[]).length}</span></div>
      <div class="growth-pool">幕间成长（COC7 规则）：消耗 1 点成长点数，对兴趣技能掷 D100——<b>结果需大于当前技能值</b>才成长；技能越高越难，投出 100 双倍成长。克苏鲁神话 / 信用（信用评级）不参与。</div>
      <div class="growth-alloc">${allocBtns}</div>
    </div>
    <h3 class="font-label-caps text-label-caps text-on-surface-variant mb-2">日常日志</h3>
    <ul class="growth-log">${logHtml}</ul>`;
  pane.querySelectorAll('[data-grow]').forEach(b=>b.onclick=()=>{
    const c2=activeCharObj(); if(!c2) return;
    const res=interludeGrowth(c2, b.dataset.grow);
    if(!res){ toast('需要成长点数'); return; }
    if(res.blocked){ toast('「'+res.skill+'」不参与幕间成长'); return; }
    saveApp(); applyCharToGlobal(c2);
    toast(res.ok? ('✓ '+res.skill+' 成长 +'+res.g+'（D100='+res.roll+'）') : ('✗ '+res.skill+' 未成长（D100='+res.roll+'≤'+res.from+'）'));
  });
}
function renderFragPane(){
  const pane=document.getElementById('paneFrag'); if(!pane) return;
  const c=activeCharObj(); if(!c) return;
  const frags=c.fragBank||[];
  const cards = frags.length? frags.map(f=>`<div class="frag ${f.type} ${f.usedIn?'used':''}">
      <div class="ft"><span class="ic">${FRAG_ICON[f.type]}</span>${f.type==='place'?'地点':f.type==='person'?'人物':f.type==='event'?'事件':'物品'}${f.usedIn?' · 已用':''}</div>
      <div class="ftitle">${escapeHtml(f.title)}</div>
      <div class="fdesc">${escapeHtml(f.desc)}</div>
    </div>`).join('') : '<div class="frag-empty">残片袋空空如也。角色的离线成长会每天掉落一枚命运残片——地点、人物、事件或物品。这些碎片可被 AI 守秘人拼合成专属于你的团本。</div>';
  pane.innerHTML=`<p class="font-body-md text-body-md text-on-surface-variant leading-relaxed mb-stack-md">命运残片是角色在日常中捡到的叙事种子。当你带团时，AI 守秘人会抽取这些残片，长成只有你参与过的故事。</p>
    <div class="frag-actions"><button id="fragDraw" class="${frags.length>=40?'is-disabled':''}">✨ 抽取命运残片${frags.length>=40?'（袋已满）':''}</button></div>
    <div class="frag-bag">${cards}</div>
    <div class="growth-pool">共 ${frags.length} 枚残片${frags.length?' · 其中 '+(frags.filter(f=>!f.usedIn).length)+' 枚待拼合':''}。</div>`;
  const drawBtn=document.getElementById('fragDraw');
  if(drawBtn && frags.length<40){ drawBtn.onclick=()=>{ const c2=activeCharObj(); if(!c2) return; const f=drawFragment(c2); if(!f){ toast('残片袋已满'); return; } saveApp(); renderFragPane(); toast('✨ 获得命运残片：「'+f.title+'」'); }; }
}
function closeDrawer(){$('#drawer').classList.remove('show');$('#drawerMask').classList.remove('show');}

/* Sanity Friction: 调查员 SAN 低于 50 时，整个界面浮现血色晕影与微闪烁 */
function updateSanFriction(){
  const el=document.querySelector('.phone'); if(!el) return;
  const c=activeCharObj();
  const san = c ? sanOf(c) : 99;
  el.classList.toggle('san-friction', san < 50);
}

/* ---------- build character drawer ---------- */
function buildChar(){
  if($('#pcName')) $('#pcName').textContent=CHAR.name;
  const activeChar=activeCharObj();
  const ti=tierInfo(activeChar);
  const tierEl=$('#pcTier'); if(tierEl) tierEl.textContent='T'+ti.tier+' '+ti.name;
  const metaEl=$('#pcMeta');
  if(metaEl){
    if(activeChar){
      const occ=CHAR.occupation||'';
      const mode=CHAR.mode==='wanxiang'?'万象标签':'COC 标准';
      const off=activeChar.lastActive? ('上次活跃 '+activeChar.lastActive) : '';
      const gp=activeChar.growth? activeChar.growth.points : 0;
      metaEl.textContent=mode+' · '+occ+' · '+off+(gp>0?(' · 可分配经验 '+gp):'');
    } else {
      metaEl.textContent='';
    }
  }
  const dv=derived();
  const derGrid=$('#derGrid');
  if(derGrid){
    const der=[['hp','HP',dv.hp],['san','SAN',dv.san],['mp','MP',dv.mp],['luck','幸运',dv.luck],['db','伤害加值',dv.db],['build','体格',dv.build],['move','移动',dv.move]];
    derGrid.innerHTML=der.map(([k,name,v])=>{
      const bar = k==='san'
        ? `<div class="w-full h-1 bg-surface-variant mt-2 rounded-full overflow-hidden"><div class="bg-san-blue h-full" style="width:${Math.min(100,(v/99)*100)}%"></div></div>`
        : k==='luck'
        ? `<div class="w-full h-1 bg-surface-variant mt-2 rounded-full overflow-hidden"><div class="bg-primary h-full" style="width:${Math.min(100,v)}%"></div></div>`
        : '';
      const valCls = k==='san'?'text-san-blue':(k==='luck'?'text-primary':'text-primary');
      return `<div class="bg-abyssal-void/50 p-stack-sm rounded border border-outline-variant/20 flex flex-col items-center">${k==='san'||k==='luck'?`<span class="font-label-caps text-[10px] text-on-surface-variant mb-1">${name}</span><div class="${valCls} font-data-mono text-2xl font-bold">${v}${k==='san'?' / 99':''}</div>${bar}`:`<span class="font-label-caps text-[10px] text-on-surface-variant mb-1">${name}</span><div class="${valCls} font-data-mono text-2xl font-bold">${v}</div>`}</div>`;
    }).join('');
  }
  $('#bioBox').textContent=CHAR.backstory;
  $('#itemList').innerHTML=''; $('#statGrid').innerHTML=''; $('#skillList').innerHTML='';
  const il=$('#itemList');
  (CHAR.items||[]).forEach(([n,d])=>{const e=document.createElement('div');e.className='flex items-start gap-3 bg-surface-container-low border border-outline-variant/30 rounded-lg p-stack-sm';e.innerHTML=`<span class="material-symbols-outlined text-primary text-2xl shrink-0">inventory_2</span><span class="font-body-md text-on-surface"><span class="font-semibold text-primary">${escapeHtml(n)}</span> <span class="text-on-surface-variant text-xs">${escapeHtml(d)}</span></span>`;il.appendChild(e);});
  const sg=$('#statGrid');
  ATTS.forEach(([k,name])=>{const d=document.createElement('div');d.className='flex flex-col items-center';d.innerHTML=`<span class="text-[10px] text-on-surface-variant opacity-70">${k}</span><span class="font-data-mono text-primary font-bold">${CHAR[k.toLowerCase()]}</span>`;sg.appendChild(d);});
  const sl=$('#skillList');
  Object.entries(CHAR.skills).forEach(([n,v])=>{
    const d=document.createElement('div');d.className='flex items-center justify-between group cursor-pointer hover:bg-surface-variant/20 p-1 rounded transition-colors';
    const myth = n==='克苏鲁神话';
    d.innerHTML=`<span class="font-body-md ${myth?'text-blood-crimson ink-bleed':'text-on-surface'}">${n}</span><span class="font-data-mono ${myth?'text-blood-crimson':'text-primary'} font-bold">${v}</span>`;
    sl.appendChild(d);
  });
  // 角色卡 ↔ 战术地图 双向跳转：本角色在地图上有 Token 时，可一键定位
  if($('#mapLocateBtn')) $('#mapLocateBtn').remove();
  const eb=$('#editCharBtn');
  if(eb){
    const lb=document.createElement('button');
    lb.id='mapLocateBtn';
    lb.className='w-full mt-stack-md bg-surface-container hover:bg-surface-variant text-primary font-label-caps text-label-caps py-stack-md rounded-lg shadow active:scale-95 transition-all flex items-center justify-center gap-stack-sm border border-primary/40';
    lb.innerHTML='<span class="material-symbols-outlined">place</span> 战术地图定位 / LOCATE ON MAP';
    lb.onclick=()=>focusCharOnMap();
    eb.insertAdjacentElement('afterend', lb);
  }
  /* 调查员档案卡导出入口 —— 本 App 传播力最强的产物，放在定位按钮之下（更显眼） */
  if($('#cardExportBtn')) $('#cardExportBtn').remove();
  const cardAnchor=$('#mapLocateBtn')||$('#editCharBtn');
  if(cardAnchor){
    const cb=document.createElement('button');
    cb.id='cardExportBtn';
    cb.setAttribute('aria-label','生成可分享的调查员档案卡图片');
    cb.style.cssText='width:100%;margin-top:12px;padding:14px 0;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;font-family:"Space Mono",monospace;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#E0B35C;background:linear-gradient(180deg,rgba(224,179,92,.16),rgba(154,123,51,.07));border:1px solid rgba(224,179,92,.5);transition:transform .15s';
    cb.innerHTML='<span class="material-symbols-outlined" style="font-size:18px">badge</span> 生成档案卡 / DOSSIER CARD';
    cb.onclick=()=>openCharCardPreview();
    cb.onpointerdown=()=>{ cb.style.transform='scale(.97)'; };
    cb.onpointerup=()=>{ cb.style.transform=''; };
    cardAnchor.insertAdjacentElement('afterend', cb);
  }
  renderGrowthPane();
  renderFragPane();
  updateSanFriction();
}
function buildSkillSelect(){
  const sel=$('#skillSel');
  Object.keys(CHAR.skills).forEach(n=>{const o=document.createElement('option');o.value=n;o.textContent=`${n} (${CHAR.skills[n]})`;sel.appendChild(o);});
  const o=document.createElement('option');o.value='__custom';o.textContent='➕ 自定义…';sel.appendChild(o);
  sel.addEventListener('change',()=>{
    if(sel.value==='__custom'){const c=prompt('输入技能名称（默认按 50 判定）：');if(c){const o2=document.createElement('option');o2.value=c;o2.textContent=c+' (自定义)';sel.insertBefore(o2,sel.lastChild);sel.value=c;}else sel.value=Object.keys(CHAR.skills)[0];}
  });
}

/*@@ m1-character:objects @@*/
/* ---------- build char objects ---------- */
function buildActiveCharObj(){ const o={name:CHAR.name,attrs:{},luck:CHAR.luck,age:CHAR.age,occupation:CHAR.occupation,skills:{},backstory:CHAR.backstory,items:CHAR.items.slice()}; ATTRKEYS.forEach(k=>o.attrs[k]=CHAR[k]); SKILL_CATALOG.forEach(([n])=>o.skills[n]=(CHAR.skills[n]!==undefined?CHAR.skills[n]:skillBase(n))); o.mode=CHAR.mode||'coc'; o.tags=CHAR.tags?CHAR.tags.slice():defaultTags(CHAR.occupation); ensureLifecycle(o); return o; }
function buildBlankChar(){ const a={}; ATTRKEYS.forEach(k=>a[k]=50); const s={}; SKILL_CATALOG.forEach(([n,b])=>s[n]=b); return {name:'新调查员',attrs:a,luck:50,age:25,occupation:'自由人/无业',skills:s,backstory:'',items:[],mode:'coc',tags:defaultTags('自由人/无业')}; }
function buildSampleChar(){ return buildActiveCharObj(); }
function buildCharObj(){ const o={id: (ck.id && String(ck.id).length>=2)? ck.id : ('c'+Date.now().toString(36)+Math.random().toString(36).slice(2,6)),name:ck.name||'调查员',attrs:{},luck:ck.luck,age:ck.age,occupation:ck.occupation,skills:{},backstory:ck.bio,items:ck.items.slice()}; ATTRKEYS.forEach(k=>o.attrs[k]=ck.attrs[k]); SKILL_CATALOG.forEach(([n])=>o.skills[n]=ck.skills[n]); o.mode=ck.mode||'coc'; o.tags=ck.tags?ck.tags.slice():defaultTags(ck.occupation); ensureLifecycle(o); return o; }
function applyCharToGlobal(c){
  CHAR.name=c.name||'调查员'; CHAR.occupation=c.occupation||'私人侦探';
  ATTRKEYS.forEach(k=> CHAR[k]=c.attrs? c.attrs[k]:50);
  CHAR.luck=c.luck!=null?c.luck:50;
  CHAR.age=c.age!=null?c.age:25;
  CHAR.skills={}; SKILL_CATALOG.forEach(([n])=> CHAR.skills[n]=(c.skills&&c.skills[n]!==undefined?c.skills[n]:skillBase(n)));
  CHAR.backstory=c.backstory||''; CHAR.items=c.items?c.items.slice():[];
  CHAR.mode=c.mode||'coc';
  buildChar();
  updateSanFriction();
}

/*@@ m1-character:lifecycle-motto @@*/
/* ============================================================
   角色生命周期引擎（整合自《万象匣》分析：双轨角色 + 离线成长 + 命运残片）
   设计原则：做加法不替换——COC 专精深度保留，万象式生命周期作为增量层。
   ============================================================ */

/*@@ m1-character:tags @@*/
/* ---- 万象五标签位 ---- */
const TAG_SLOTS=[
  {slot:'who',   label:'我是谁',   hint:'身份 / 种族 / 外貌 / 性格核心'},
  {slot:'can',   label:'我会什么', hint:'专长 / 技能 / 能力'},
  {slot:'believe',label:'我信什么', hint:'信仰 / 价值观 / 执念'},
  {slot:'have',  label:'我拥有什么',hint:'随身物品 / 资源 / 人脉'},
  {slot:'weak',  label:'我的弱点',  hint:'缺陷 / 恐惧 / 债务（COC 适配：SAN 触发器）'}
];
function defaultTags(occ){
  const presets={
    '私人侦探':['前警探，左眼有旧疤，习惯观察每个人','调查、追踪、手枪射击、话术','真相值得一切代价','配枪、侦探执照、旧案卷宗','恐高、靠威士忌压惊'],
    '医生':['急诊科主治，离异，疲惫却冷静','急救、诊断、镇静剂、缝合','生命至上，没有什么是救不回来的','听诊器、医院门禁卡、处方药','长期失眠、对血已麻木'],
    '护士':['夜班护士，记得每个病人的脸','急救、护理、安抚、观察','善待每一个人，包括将死之人','护士站钥匙、病历本、咖啡','怕黑、总梦见走廊尽头'],
    '记者':['自由记者，专挖不能写的真相','话术、摄影、调查、写作','公众有知情权','记者证、录音笔、人脉电话','欠赌债、被威胁过'],
    '警察':['片区老警察，见惯了人间','手枪、格斗、侦查、驾驶','秩序总要有人维持','警徽、配枪、对讲机','酗酒、和女儿疏远'],
    '大学教授':['考古系教授，书比朋友多','图书馆、历史、神秘学、写作','知识不该被埋葬','研究室钥匙、古籍、学生助理','社恐、体力很差'],
    '法医':['法医，与死者对话的人','医学、法律、科学、心理学','死者不会说谎','解剖刀、验尸报告、手套','幽闭恐惧'],
    '律师':['刑辩律师，相信程序正义','法律、话术、写作、心理学','程序之内，必有正义','西装、案卷、名表','洁癖、控制欲'],
    '自由人/无业':['无业游民，却什么都懂一点','察言观色、随机应变、求生','活着就好','一部旧手机、一点现金','朝不保夕、欠房租']
  };
  const arr=presets[occ]||['一名普通的调查员','观察、记录、随机应变','真相总在水下','随身的小物件','一段不愿提起的过去'];
  return TAG_SLOTS.map((s,i)=>({slot:s.slot, text:arr[i]||''}));
}

/* ---- 标签 → 技能值 关键词映射（§7.3）---- */
const TAG_KW={
  '侦查':['侦查','调查','侦探','追踪','观察','搜'],'聆听':['聆听','听','耳','潜行'],'手枪':['手枪','枪','射击','火器','开枪'],
  '步枪':['步枪','枪','射击'],'霰弹枪':['霰弹','枪','射击'],'克苏鲁神话':['神话','克苏鲁','神秘','邪'],'话术':['话术','说服','嘴','口才','谈判','忽悠'],
  '图书馆':['书','图书馆','阅读','档案','研究','卷宗'],'潜行':['潜行','隐','偷','悄'],'斗殴':['斗殴','格斗','拳','近战','打架'],'心理学':['心理','读心','察言','情绪'],
  '急救':['急救','医','护','护理','绷带'],'神秘学':['神秘','术','咒'],'历史':['历史','年代','考古'],'摄影':['摄影','相机','拍照','相片'],'医学':['医','药','手术','临床'],
  '驾驶':['驾驶','开车','车','摩托'],'攀爬':['攀爬','爬','翻墙'],'游泳':['游泳','水'],'说服':['说服','谈判','劝'],'追踪':['追踪','跟踪','尾随'],
  '锁匠':['锁','撬','开锁'],'取悦':['取悦','魅力','迷人','讨好'],'威吓':['威吓','恐吓','威胁','吓'],'法律':['法律','律师','法条'],'写作':['写作','记','笔'],
  '表演':['表演','演','戏'],'电脑使用':['电脑','网络','黑客','代码'],'科学(生物)':['生物','实验','科学'],'语言(母语)':['语言','母语'],'外语(英语)':['英语','外语'],
  '人类学':['人类','民俗'],'考古学':['考古','文物'],'生存':['生存','野外','求生'],'电子学':['电子','电路'],'机械维修':['机械','维修','修'],
  '电气维修':['电气','电路','修'],'化学':['化学','药剂'],'物理学':['物理','实验'],'数学':['数学','计算'],'博物学':['博物','自然','植物'],
  '导航':['导航','地图','方位'],'驯兽':['驯兽','动物','宠物'],'信用':['信用','面子','人脉','地位'],'会计':['会计','账','钱'],'估价':['估价','鉴宝','眼力'],
  '骑术':['骑','马'],'投掷':['投掷','扔'],'重型机械操作':['重型','机械','操作'],'手艺/绘画':['手艺','绘画','画','手工'],'闪避':['闪避','躲','灵敏']
};
/* 标签模式技能推导：直接相关 60 / 间接 40 / 无关联 20 / 弱点相关 10（§7.3） */
function tagSkills(tags, occupation){
  const t=tags||[]; const get=s=>(t.find(x=>x.slot===s)||{}).text||'';
  const who=get('who'), can=get('can'), believe=get('believe'), have=get('have'), weak=get('weak');
  const occSet=new Set(occSkills(occupation||''));
  const out={};
  SKILL_CATALOG.forEach(([n,base])=>{
    const kws=(TAG_KW[n]||[]).map(s=>s.toLowerCase());
    const inCan=kws.some(k=>can.toLowerCase().includes(k));
    const inWhoHave=kws.some(k=>(who+' '+have).toLowerCase().includes(k));
    const inWeak=kws.some(k=>weak.toLowerCase().includes(k));
    let v=20;
    if(inWeak) v=10; else if(inCan) v=60; else if(inWhoHave) v=40;
    if(occSet.has(n)) v=Math.min(95, v+10);
    out[n]=Math.max(v, base);
  });
  return out;
}

/*@@ m1-character:fragments @@*/
/* ---- 命运残片 ---- */
const FRAG_POOL={
  place:['阿卡姆老图书馆的地下室','灯塔下锈蚀的铁门','一家永远在午夜打烊的茶馆','废墟教堂的忏悔室','地铁末班车厢的尽头','被藤蔓吞没的邮轮'],
  person:['戴单片眼镜的古董商','总在微笑的护士','抱着黑猫的盲眼老妪','穿西装的年轻收尸人','在雨里写字的男人','记不住脸的茶房伙计'],
  event:['午夜钟响时所有的狗都静了','墙上的血迹拼成了一颗星','电话里传来自己童年的哭声','镜中人比他慢了半秒','日历停在某个不存在的日子','海雾里传来无人应和的汽笛'],
  item:['一枚冰冷的银币，正面是陌生的脸','缺了最后一页的日记','写着别人名字的莱卡胶卷','生锈的钥匙，没有对应的锁','半张被烧过的船票','一枚刻着外神印记的胸针']
};
const FRAG_ICON={place:'📍',person:'👤',event:'📜',item:'🔮'};
/* 疯狂症状表（借鉴 Koishi-Plugin/coc-dnd-dice 的 coc7_immediate_madness / coc7_summary_madness 模板数据）*/
const MADNESS_IMMEDIATE=[
  '昏厥或者崩溃 1d10 轮','歇斯底里地大笑或者哭泣 1d10 轮','逃跑，尖叫着远离恐怖源 1d10 轮',
  '身体僵硬，无法行动 1d10 轮','喃喃自语，无法理解的话语 1d10 轮','重复某个动作 1d10 轮',
  '攻击最近的人或物体 1d10 轮','暂时失忆，遗忘最近的事件','进入恍惚状态 1d10 轮','产生幻觉 1d10 轮'
];
const MADNESS_SUMMARY=[
  '健忘症：遗忘与创伤事件相关的记忆','强迫症：必须执行某些重复性行为','偏执狂：认为有人在监视或追踪自己',
  '恐惧症：对特定事物产生极度恐惧','躁郁症：情绪在极度兴奋和沮丧间摆动','分离性身份障碍：发展出多重人格',
  '妄想症：坚信某些不真实的事情','焦虑症：持续的紧张和不安感','抑郁症：持续的悲伤和绝望感','失语症：失去说话或理解语言的能力'
];
const FRAG_DESC={place:'一个场景的种子，等待被写进故事。',person:'一个 NPC 的雏形，带着自己的秘密。',event:'一个情节片段，不知何时就会应验。',item:'一件关键道具，握着它的人尚未可知。'};
let FRAG_SEQ=Date.now();
function genFragment(name){
  const types=['place','person','event','item']; const type=pick(types);
  const title=pick(FRAG_POOL[type]);
  return {id:'F'+(++FRAG_SEQ).toString(36), type, title, desc:FRAG_DESC[type],
    source:'daily', createdAt:todayISO(), usedIn:null, by:name||''};
}
function fragSummary(frags){
  // 将残片聚合成场景种子：地点 / 人物 / 事件 / 道具
  const pick1=t=>{ const a=(frags||[]).filter(f=>f.type===t); return a.length? a[Math.floor(Math.random()*a.length)].title : null; };
  return {place:pick1('place'), person:pick1('person'), event:pick1('event'), item:pick1('item')};
}

/* ---- 离线成长 ---- */
const DLOG_PLACE=['旅店吧台','庭院','图书馆','市集','屋顶','旧码头','阁楼'];
const DLOG_ACT=['喝酒听人讲古','独自练剑','读书到天亮','与人攀谈','发呆看雨','擦拭旧物'];
const DLOG_RES=['拾得一个模糊的线索','技艺微有长进','遇到一个有趣的人','做了一个奇怪的梦','想起一句被遗忘的台词'];
function genDailyLogText(name){ return (name||'调查员')+'在'+pick(DLOG_PLACE)+pick(DLOG_ACT)+'，'+pick(DLOG_RES)+'。'; }

/*@@ m1-character:backfill @@*/
/* ---- 字段回填（兼容旧角色） ---- */
function ensureLifecycle(c){
  if(!c) return c;
  if(c.mode!=='wanxiang' && c.mode!=='coc') c.mode='coc';
  if(!Array.isArray(c.tags) || c.tags.length!==5) c.tags=defaultTags(c.occupation);
  if(typeof c.tier!=='number') c.tier=1;
  if(typeof c.tierExp!=='number') c.tierExp=0;
  if(typeof c.sessions!=='number') c.sessions=0;
  if(typeof c.lastActive!=='string') c.lastActive=todayISO();
  if(!c.growth) c.growth={points:0, log:[]};
  if(typeof c.growth.points!=='number') c.growth.points=0;
  if(!Array.isArray(c.growth.log)) c.growth.log=[];
  if(!Array.isArray(c.fragBank)) c.fragBank=[];
  if(!Array.isArray(c.madness)) c.madness=[];
  /* skills：旧档 / 云端角色快照 / 导入的 JSON 常缺该字段（属性在 attrs、技能独存一份），
     而成长面板、幕间成长、技能成长会直接读 c.skills[...] —— 缺字段就是未捕获异常。
     补什么值有讲究：COC 的技能基准值是**规则的一部分**（人人都有 侦查25 / 聆听20 / 急救30…），
     补 0 等于把所有未提供的技能变成「检定必失败」，比抛异常还难查；补空表则 UI 显示一片 0。
     故缺失项一律回填 SKILL_CATALOG 的基准值 —— 与 app 自己的建卡口径 buildBlankChar() 完全一致。
     注意：只补基准值，不生成职业点/兴趣点（那是玩家分配出来的，属建卡流程职责）。 */
  if(!c.skills || typeof c.skills!=='object') c.skills={};
  SKILL_CATALOG.forEach(function(pair){ if(typeof c.skills[pair[0]]!=='number') c.skills[pair[0]]=pair[1]; });
  return c;
}
/* 结算离线成长；返回 {days,points,frag,logText}（days=0 表示无需结算） */
function settleGrowth(c){
  ensureLifecycle(c);
  const days=daysSince(c.lastActive);
  if(days<=0) return {days:0, points:0, frag:null, logText:''};
  const eff=Math.min(days,7);          // 封顶 7 天，防数值爆炸（§8.1）
  const points=eff;                     // 兴趣技能点池，1 点/天
  c.growth.points += points;
  let frag=null;
  if(c.fragBank.length < 40){ frag=genFragment(c.name); c.fragBank.push(frag); }
  const logText=genDailyLogText(c.name);
  c.growth.log.unshift({date:todayISO(), days, exp:points, frag: frag?frag.title:null, text:logText});
  if(c.growth.log.length>60) c.growth.log.length=60;
  c.lastActive=todayISO();
  return {days, points, frag, logText};
}
/* 分配离线经验点到兴趣技能（非职业技能，§8.3） */
function allocGrowth(c, skill){
  ensureLifecycle(c);
  if(c.growth.points<=0) return false;
  if(occSkills(c.occupation).includes(skill)) return false; // 仅兴趣技能
  c.skills[skill]=(c.skills[skill]||0)+1; c.growth.points--;
  return true;
}

/*@@ m1-character:growth @@*/
/* ============================================================
   幕间技能成长（借鉴 jumperrong/trpg-character-sheet 的正宗 COC7 规则）
   - D100 掷骰结果需大于当前技能值才成长
   - 成长骰子随技能值分档：1-29→1d10, 30-49→1d8, 50-69→1d6, 70-89→1d4, 90+→1d3
   - 投出 100 双倍成长；技能值>95 时 96-100 总能成长
   - 克苏鲁神话 / 信用（信用评级）不参与成长
   ============================================================ */
const GROWTH_EXCLUDE=['克苏鲁神话','信用'];
function dRoll(s){ return Math.floor(Math.random()*s)+1; }
function growthDie(v){ if(v<=29) return 10; if(v<=49) return 8; if(v<=69) return 6; if(v<=89) return 4; return 3; }
function growthCheck(v, roll){ if(v>95 && roll>=96 && roll<=100) return true; return roll>v; }
/* 消耗 1 点成长点数，对某兴趣技能做一次幕间成长检定。返回结果对象或 null/blocked */
function interludeGrowth(c, skill){
  ensureLifecycle(c);
  if(!c.growth || c.growth.points<=0) return null;
  if(GROWTH_EXCLUDE.includes(skill)) return {blocked:true, skill};
  if(occSkills(c.occupation).includes(skill)) return {blocked:true, skill}; // 仅兴趣技能
  c.growth.points--;
  const from=c.skills[skill]||0;
  const roll=dRoll(100);
  const ok=growthCheck(from, roll);
  let g=0;
  if(ok){ g=dRoll(growthDie(from)); if(roll===100) g*=2; if(from+g>99) g=99-from; c.skills[skill]=from+g; }
  const entry={date:todayISO(), type:'grow', skill, roll, ok, g, from, to:from+g,
    text:`幕间成长：${skill} D100=${roll} ${ok?('成功 +'+g+'（'+from+'→'+(from+g)+'）'+(roll===100?' · 双倍!':'')):'失败（需 >'+from+'）'}`};
  c.growth.log.unshift(entry);
  if(c.growth.log.length>60) c.growth.log.length=60;
  return entry;
}

/* 手动抽取一枚命运残片（借鉴 Koishi 的 ti/li 抽取交互；受袋容 40 限制） */
function drawFragment(c){
  ensureLifecycle(c);
  if(c.fragBank.length>=40) return null;
  const f=genFragment(c.name); c.fragBank.push(f); return f;
}

/* ---- T1–T5 阶层（COC 适配版，§11）---- */
const TIERS=[
  {t:1,name:'凡俗调查员',need:0},
  {t:2,name:'老练探秘者',need:3},
  {t:3,name:'神话见证者',need:7},
  {t:4,name:'边界行走者',need:15},
  {t:5,name:'传说存在',need:30}
];
function tierInfo(c){
  if(!c) return {tier:1, name:'凡俗调查员', exp:0, need:3, pct:0, maxed:false, next:'老练探秘者'};
  ensureLifecycle(c);
  const exp=c.tierExp||0; let tier=1;
  for(const T of TIERS){ if(exp>=T.need) tier=T.t; }
  const cur=TIERS[tier-1]; const nxt=TIERS[tier];
  const pct=nxt? Math.min(100, Math.round((exp-cur.need)/(nxt.need-cur.need)*100)) : 100;
  return {tier, name:cur.name, exp, need:nxt?nxt.need:null, pct, maxed:!nxt, next:nxt?nxt.name:null};
}
/* 完成一场团 → 推进阶层经验（§11，可在 leaveRoom/recordHistory 调用） */
function creditSession(c){
  ensureLifecycle(c); c.sessions=(c.sessions||0)+1; c.tierExp=(c.tierExp||0)+1; return tierInfo(c);
}

