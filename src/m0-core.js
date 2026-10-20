/*
 * m0-core —— 核心底座（全局状态 / DOM 助手 / 渲染 / 日期）
 * 本文件是 www/index.html 的源码，不是产物。
 * 块与块之间以 "@@ m0-core:块名 @@" 形式的哨兵注释分隔；哨兵行本身不进入产物，
 * 块体按哨兵出现顺序内联回产物的对应位置。
 * 警示：头注释里绝对不要写出注释结束符本身（星号紧跟斜杠），否则注释提前闭合，
 *       后面的中文会变成代码 —— 语法哨兵会立刻报 "Unexpected identifier"。
 */
/*@@ m0-core:state @@*/
/* ---------- state ---------- */
const isGM = ()=> document.getElementById('gmPill').classList.contains('on');
let diceState = {mode:'coc', diff:'reg', bp:'none', vis:'public'};
/*@@ m0-core:helpers @@*/
/* ---------- helpers ---------- */
const $ = s=>document.querySelector(s);
const logEl = ()=>document.getElementById('log');
function now(){const d=new Date();return d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');}
function scrollLog(){const l=logEl();l.scrollTop=l.scrollHeight;}
function toast(t){const e=document.getElementById('toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),1600);}
/*@@ m0-core:renderers @@*/
/* ---------- renderers ---------- */
function avaClass(role){return role==='gm'?'gm':role==='me'?'me':role;}

function renderMessage(m){
  const l=logEl();
  if(m.t==='sys'){const d=document.createElement('div');d.className='sys';d.textContent=m.text;l.appendChild(d);return;}
  if(m.t==='think'){const d=document.createElement('div');d.className='ai-think';d.textContent=m.text;l.appendChild(d);return;}
  const wrap=document.createElement('div');
  wrap.className='msg'+(m.role==='me'?' me':'')+(m.role==='ai'?' ai':'')+(m.kp?' kp-msg':'');
  let whoName = m.role==='me' ? myName() : m.who;
  if(m.role==='gm' && whoName==='守秘人') whoName='';
  let inner='';
  if(m.t==='dice'){inner=renderDice(m);}
  else{
    inner=`<div class="bubble">${escapeHtml(m.text)}</div>`;
  }
  let roleTag='';
  if(m.role==='gm') roleTag='<span class="role">守秘人</span> ';
  else if(m.role==='ai') roleTag='<span class="role ai">AI 队友</span> ';
  const letter = m.role==='gm'?'K':m.role==='me'?myName().slice(0,1):m.role==='ai'?'AI':'L';
  wrap.innerHTML=`<div class="ava ${avaClass(m.role)}">${letter}</div>
    <div><div class="who">${roleTag}${escapeHtml(whoName)}</div>${inner}</div>`;
  l.appendChild(wrap);
}

/* ---------- COC 7e 成功等级（前端唯一权威实现） ----------
   服务端 server/dice.js::cocLevel 与本实现同构，由 _mod_m0_test.js 与 _mr_test.js PART 6
   逐点对拍（10000 组零分歧），保证同一掷骰在「UI 徽章」与「战报记录」里等级一致。
   规则（守秘人规则书 7e）：
     大成功：掷出 01；或技能 ≥ 50 时掷出 01–05
     大失败：掷出 100；或技能 < 50 时掷出 96–00
     极难成功 ≤ ⅕ 目标值 · 困难成功 ≤ ½ 目标值 · 成功 ≤ 目标值
   注：目标值只做下限 1 的兜底、不做上限 100 裁剪 —— 加值可以把成功率抬到 100 以上，
   裁上限会在 100 处造成「档次突然变严」的断崖，也不利于两端保持单调一致。 */
const COC_LEVEL_LABEL={fumble:'大失败',crit:'大成功',extreme:'极难成功',hard:'困难成功',regular:'成功',fail:'失败'};
const COC_RANK={fail:0,regular:1,hard:2,extreme:3,crit:4,fumble:4};
function cocLevel(roll,target){
  const t=Math.max(1,Math.floor(target||0));
  if(roll===100||(t<50&&roll>=96)) return 'fumble';
  if(roll===1||(t>=50&&roll<=5)) return 'crit';
  if(roll<=Math.floor(t/5)) return 'extreme';
  if(roll<=Math.floor(t/2)) return 'hard';
  if(roll<=t) return 'regular';
  return 'fail';
}

function renderDice(m){
  const tr=m.roll;
  const lvl=cocLevel(tr,m.target);
  /* m.diff 是 KP 要求的**难度门槛**（reg 常规 · hard 困难½ · ext 极难⅕），不是给玩家加档。
     成功等级一律按目标值的绝对分数段判定，门槛只决定「通过与否」——
     要求困难却只掷出普通成功，就是失败。
     （原实现把门槛当成档位平移，方向与规则相反：选「困难」反而更容易拿到「困难成功」。） */
  const need = m.diff==='ext' ? COC_RANK.extreme : (m.diff==='hard' ? COC_RANK.hard : COC_RANK.regular);
  /* 门槛只对**成功档**降级：大成功 / 大失败是绝对结局，既不参与门槛比较，也不能被改写成「失败」
     —— 写成 `passed?lvl:'fail'` 会把「大失败」显示成「失败」，丢掉最高危的那个信号。 */
  const gated = (lvl==='crit'||lvl==='fumble') ? lvl : (COC_RANK[lvl]>=need ? lvl : 'fail');
  const badge = COC_LEVEL_LABEL[gated];

  const isFail = (badge==='失败'||badge==='大失败');
  const accent = isFail ? 'via-blood-crimson' : 'via-eldritch-cyan';
  const numCls = isFail ? 'roll-fail' : 'roll-success';
  /* 大成功 / 大失败：原实现预留了六个等级专属类名却从未写进 HTML（全文件 0 引用的死代码），
     这里用设计系统已有的两个色板变量把它们真正做出来（见样式表 .roll-crit / .roll-fumble）。
     注：本注释刻意不写出那六个已删掉的类名 —— 否则「死类名是否清零」的 grep 断言会被注释自己误命中。 */
  const lvlCls = lvl==='crit' ? ' roll-crit' : (lvl==='fumble' ? ' roll-fumble' : '');
  const label = (m.skill==='克苏鲁神话'&&isFail)?'SAN Check':'技能检定';
  const priv = m.vis==='private' ? `<div class="tag-private mt-2 font-label-caps text-label-caps text-aged-parchment border border-aged-parchment/40 rounded-full px-2 py-1 inline-flex items-center gap-1"><span class="material-symbols-outlined text-sm">lock</span>暗骰 · 仅守秘人可见</div>` : '';
  return `<div class="dice-card flex justify-center my-stack-sm">
<div class="bg-surface-container-highest border border-outline-variant px-6 py-3 rounded-xl shadow-2xl relative overflow-hidden flex flex-col items-center min-w-[240px]">
<div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent ${accent} to-transparent"></div>
<div class="font-label-caps text-[10px] text-on-surface-variant mb-1 uppercase tracking-[0.2em]">${label}</div>
<div class="flex items-center gap-stack-sm mb-1">
<span class="font-headline-md text-headline-md text-on-surface">${escapeHtml(m.skill)}</span>
<span class="font-data-mono text-data-mono text-outline">成功率: ${m.target}</span>
</div>
<div class="flex items-baseline gap-2">
<span class="font-data-mono text-3xl font-bold ${numCls}${lvlCls}">${tr}</span>
<span class="font-data-mono text-headline-md text-on-surface-variant">/ ${m.target}</span>
<span class="font-label-caps text-label-caps ${numCls}${lvlCls} ml-2">${badge}</span>
</div>${priv}
</div></div>`;
}

function escapeHtml(s){return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
/*@@ m0-core:date @@*/
/* ---- 日期工具 ---- */
function todayISO(){ const d=new Date(); const p=x=>(''+x).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
function daysSince(iso){ if(!iso) return 999; const a=new Date(iso+'T00:00:00'); const b=new Date(todayISO()+'T00:00:00'); return Math.max(0, Math.round((b-a)/86400000)); }
