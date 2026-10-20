/*
 * m3-ai —— AI 引擎（Provider / 原型库 / 守秘人 / 队友 / 服务器大脑）
 * 覆盖：provider 统一 Provider 抽象（local 规则 / remote 大模型 + AI_LOCAL_FALLBACK）
 *       → archetypes 场景原型库（真相优先 + 三线索法则）
 *       → shared 共享：历史 / 推送 / 意图识别 / SAN 损失
 *       → keeper AI 守秘人 → mate AI 队友（本地镜像服务端的职业族群表）
 *       → panel 设置面板 / 指示 / 挂载 → sgai 服务器大脑（/ai/* 契约 + 三选一分派）。
 * 边界说明：mate 段止于 hideContinue。紧随其后的 bind() 与骰子托盘 / 底栏适配属于 M8 app，
 *       仍留在骨架 —— 圈进来会让本模块反向依赖 m1-character 的建卡面与 m5-net 的联机 API。
 * 本文件是 www/index.html 的**源码**，不是产物。
 * 分块哨兵以 "@@ m3-ai:<id> @@" 形式的注释行分隔，会被 coc-apk/build.js 识别；
 * 哨兵行本身不进入产物，块体按哨兵出现顺序内联回产物的对应位置。
 * （头注释里刻意不写出哨兵的完整字面量 —— 那个字面量自带注释结束符，会把本段注释提前闭合。）
 */
/*@@ m3-ai:provider @@*/
/* ============================================================
   AI 引擎：本地规则大脑 + 预留真实大模型接口
   守秘人法则（研究所得，刻入引擎）：
   · 真相优先 — 先定「到底发生了什么」，线索才可移植
   · 三线索法则 — 每个结论≥3条线索，调查不会卡死
   · 缓慢酝酿 + 尖锐爆发 — 用 dread 计量节奏
   · SAN 是压力系统 — 遭遇异象/神话真相加检定
   · 世界主动 — 玩家拖延，邪教/怪物推进时间线
   ============================================================ */

/* ---- AI 配置（localStorage 持久化） ---- */
const AI_CFG_KEY='coc_ai_cfg_v1';
function defAICfg(){ return {mode:'local', kp:false, mate:false, endpoint:'', key:'', model:'gpt-4o-mini'}; }
function loadAICfg(){ try{ const r=localStorage.getItem(AI_CFG_KEY); if(r) return Object.assign(defAICfg(),JSON.parse(r)); }catch(e){} return defAICfg(); }
function saveAICfg(c){ try{ localStorage.setItem(AI_CFG_KEY, JSON.stringify(c)); }catch(e){} }
const pick=a=>a[Math.floor(Math.random()*a.length)];
const rnd=(a,b)=>a+Math.floor(Math.random()*(b-a+1));

/* ---- 统一 Provider：local(规则) / remote(真实大模型) ----
   brief = { voice:'kp'|'mate', situation, directive, tone, mustInclude:[], history:[], draft }
   local 直接采用引擎撰写的 draft（确定性、可复核）；remote 把同一 brief 转发给大模型重写。
   两套大脑共用同一游戏逻辑，仅「文笔」不同，可无缝切换。 */
const AI = {
  cfg: loadAICfg(),
  async narrate(brief){
    if(this.cfg.mode==='remote' && this.cfg.key && this.cfg.endpoint){
      try{ const t=await this.remote(brief); if(t) return t; }catch(e){ console.warn('[AI] remote failed, fallback local',e); }
    }
    return (brief.draft!=null? brief.draft : AI_LOCAL_FALLBACK(brief));
  },
  async remote(brief){
    const sys=(brief.voice==='kp'
      ? '你是克苏鲁的呼唤(COC)桌游的守秘人(Keeper/GM)，主持调查恐怖团。氛围诡谲、信息克制、不直接剧透真相。'
      : '你是COC里由AI扮演的调查员队友，与真人玩家并肩。忠诚、有职业特质、会主动行动、不抢戏。')
      + ' 用简体中文，2-4句，给出具体感官与线索，不要替玩家做决定。';
    const hist=(brief.history||[]).slice(-8).map(h=>`${h.who}：${h.text}`).join('\n');
    const user=`情境：${brief.situation}\n指令：${brief.directive}\n语气：${brief.tone||'克制'}\n`
      + (brief.mustInclude&&brief.mustInclude.length?`必须纳入的事实：${brief.mustInclude.join('；')}\n`:'')
      + (hist?`近期对话：\n${hist}\n`:'') + (brief.playerName?`玩家（调查员）的名字是「${brief.playerName}」，需要直接称呼玩家时用此名，避免机械地用「你」。\n`:'') + `请给出这一句旁白/台词：`;
    const body={model:this.cfg.model||'gpt-4o-mini',messages:[{role:'system',content:sys},{role:'user',content:user}],temperature:0.9,max_tokens:220};
    const res=await fetch(this.cfg.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+this.cfg.key},body:JSON.stringify(body)});
    const j=await res.json();
    const t=j&&j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content;
    return (t||'').trim();
  }
};
function AI_LOCAL_FALLBACK(b){ return (b.mustInclude&&b.mustInclude[0])||'守秘人凝视着你们，等待下一步行动。'; }
/*@@ m3-ai:archetypes @@*/
/* ---- 场景原型库（真相优先 + 三线索法则） ---- */
const ARCHETYPES = [
  { keys:['医院','疗养','sanitarium','诊','病','医务','精神科','诊所'],
    ward:'三楼安宁病房',
    truth:'这栋楼地下藏着一段被掩埋的禁忌实验：一种借由「治疗」悄悄寄生于人体的来访之物，而被收治者正一个接一个地……不再离开。',
    hooks:['值夜的护工把你们领到{n}的{ward}。凌晨三点，走廊尽头的灯明明灭灭，像在数着什么。'],
    clues:[
      {skill:'侦查', text:'护士站的登记簿上，入院人数远多于出院与死亡人数之和——有些名字，从未出现在任何离开的记录里。'},
      {skill:'聆听', text:'通风管道里有黏腻的爬行声；当你们屏息时它停住，你们刚一放松，它又顺着墙根继续往前。'},
      {skill:'图书馆', text:'旧报纸档案：十年前同一栋楼发生过「集体癔症」，院方当时矢口否认，卷宗却被人抽走了一页。'},
      {skill:'心理学', text:'唯一愿意交谈的清洁工，说起「会走路的影子」时瞳孔放大、指尖发白——他不是编故事，是信以为真。'}
    ],
    npcs:[{name:'值夜护士', tone:'冷淡而回避', line:'……您不该在这一层走动，病人需要安静。'},{name:'清洁工老周', tone:'惊恐', line:'别去地下室。那里的灯，是自己亮的。'}],
    san:[{loss:'1d4', text:'当无影灯骤然亮起，你看见手术台上那具「尸体」正缓缓转过没有五官的脸——'},{loss:'1d6', text:'墙上的病历卡一张张翻面，背面用同一种笔迹写着你的名字。'}],
    comps:[{delay:2, text:'你们迟疑间，又一名病人被悄然转入地下——登记簿上多了一个你们都熟悉的名字。'},{delay:4, text:'整层楼的呼叫铃同时响起，却没有任何护士应答。'}]
  },
  { keys:['宅','屋','公馆','庄园','mansion','house','洋楼','老宅','别墅'],
    ward:'尘封的二楼书房',
    truth:'这栋祖宅的历任主人都死于同一种「梦」：墙里的东西会借由家徽与血脉，把活人慢慢织进挂毯。',
    hooks:['律师把{n}的钥匙交给你，叮嘱「天黑后别去{ward}」。风穿过空荡的门厅，像有人在学你呼吸。'],
    clues:[
      {skill:'侦查', text:'壁炉后的暗格藏着一叠家信，每封的落款日期都是同一天——可墨迹新旧不一。'},
      {skill:'图书馆', text:'族谱里被反复涂抹的名字，恰好对应近百年每一桩「意外」逝者。'},
      {skill:'神秘学', text:'客厅挂毯的纹路在你余光里流动，细看却是静止的——神话符号与某位外神的印记吻合。'},
      {skill:'聆听', text:'二楼书房传来翻页声，可那里明明空无一人，桌上却摊着一本被读到一半的日记。'}
    ],
    npcs:[{name:'管家', tone:'恭敬而诡异', line:'老爷说过，您迟早会回家的。'},{name:'邻家女孩', tone:'好奇', line:'那房子……吃掉过好多人哦，你不怕吗？'}],
    san:[{loss:'1d3', text:'你发现自己正用陌生的笔迹在日记上续写，内容是你从未经历过的夜晚。'},{loss:'1d6', text:'镜中人比你慢了半秒才抬起手。'}],
    comps:[{delay:2, text:'家徽在你们眼前渗出暗红，门厅的画像集体转向了你们。'},{delay:4, text:'夜色中，宅门无声打开，像在邀请——也像在吞咽。'}]
  },
  { keys:['镇','村','town','village','岛','灯塔','港','社区','街区'],
    ward:'镇公所档案室',
    truth:'这个与世隔绝的小镇靠「献祭陌生人」维持虚假的太平；每隔几年，海雾就会送来一个不该活着离开的人。',
    hooks:['大巴把你们丢在{n}的站牌下就匆匆开走。镇长笑容可掬地迎上来：「来了就好，来了就好——今晚正好有篝火。」'],
    clues:[
      {skill:'侦查', text:'镇口石碑的新刻名字下，露出更早被磨平的几十个名字，日期横跨近百年。'},
      {skill:'话术', text:'酒馆老板娘几杯下肚漏了嘴：「上回来的人，也住过你那间房。」她说完脸色骤变，闭口不谈。'},
      {skill:'图书馆', text:'镇志里「失踪」二字被反复涂改，最新一笔墨迹还没干透。'},
      {skill:'追踪', text:'雪地/泥地上的脚印把你引到祠堂后门，却在门槛处凭空消失。'}
    ],
    npcs:[{name:'镇长', tone:'过分热情', line:'远道而来都是客，住下吧，海风大。'},{name:'渔夫老何', tone:'欲言又止', line:'趁雾没起，走吧。别等天黑。'}],
    san:[{loss:'1d4', text:'篝火噼啪炸开，火星拼出一张你陌生又熟悉的脸。'},{loss:'1d6', text:'全镇人同时停下动作，齐刷刷看向你，仿佛等待某种仪式开场。'}],
    comps:[{delay:2, text:'海雾提前涌进镇子，汽笛在无人处鸣响——他们开始布置篝火圈了。'},{delay:4, text:'你房间门缝下塞进一张纸条：「今夜轮到你。」'}]
  },
  { keys:['邪教','教团','仪式','cult','ritual','膜拜','聚会','秘社'],
    ward:'地下礼拜堂',
    truth:'这个表面温良的团体在等待「归潮之夜」：届时他们将用活祭唤醒沉睡在近岸之物，换取永生。',
    hooks:['一封没有署名的请柬把你们引到{n}的地下礼拜堂。烛火绿得不正，唱诗声里混着不该有的多声部。'],
    clues:[
      {skill:'侦查', text:'祭坛后的帘后，一排空玻璃罐贴着失踪者的照片，罐底沉着指甲与头发。'},
      {skill:'神秘学', text:'经文的批注指向一个归潮的精确时辰，以及「以调查员之血为引」的段落。'},
      {skill:'图书馆', text:'会众名册的最后一栏，悄悄记着你们的姓名与「归潮献品」字样。'},
      {skill:'心理学', text:'信徒们眼神空洞却幸福，像被抽走了恐惧——这正是某种寄生信仰的标志。'}
    ],
    npcs:[{name:'牧师', tone:'慈祥而偏执', line:'孩子，归潮之后，再也没有离别了。'},{name:'叛教者', tone:'绝望', line:'跑！他们已经把你们写进祷词了！'}],
    san:[{loss:'1d4', text:'唱诗声钻进颅骨，你听见自己的名字被反复吟诵，像一首安魂曲。'},{loss:'1d6', text:'祭坛壁画上的眼睛逐一睁开，全部盯着你。'}],
    comps:[{delay:2, text:'钟声自鸣，信徒们开始列队走向祭坛——归潮的时辰提前了。'},{delay:4, text:'地下渗出水来，带着海腥与低语，水位正缓慢上涨。'}]
  },
  { keys:['高校','学园','学校','校园','school','大学','学院','教室'],
    ward:'废弃的旧校舍',
    truth:'这所学校曾用学生做「勇气实验」，失败的少年少女化作徘徊在课桌椅间的低语，等待有人替他们完成未竟之事。',
    hooks:['社团招新把你们骗进{n}的{ward}。黑板上有人用粉笔写着「救我」，字迹还在微微发潮。'],
    clues:[
      {skill:'侦查', text:'课桌抽屉里塞着一本被撕去封面的日记，最后一页写着「他们不让我们回家」。'},
      {skill:'聆听', text:'放学后的走廊传来整齐的朗读声，可整层楼空无一人，声源在墙体内部。'},
      {skill:'图书馆', text:'校史室尘封的处分记录，列出了十几个「转学」学生的真实去向——全都再无音讯。'},
      {skill:'心理学', text:'你们中有人开始无意识地重复某个动作，那是日记主人死前的习惯。'}
    ],
    npcs:[{name:'学生会主席', tone:'刻意正常', line:'旧校舍闹鬼都是谣言啦，别怕。'},{name:'幽灵同学', tone:'飘忽', line:'你们……能看见我吗？帮我告诉外面的人……'}],
    san:[{loss:'1d3', text:'你听见十七岁的自己在走廊尽头喊你的名字，可那声音比你现在年轻十年。'},{loss:'1d6', text:'所有课桌椅同时转向你，椅背上浮现出一张张少年的脸。'}],
    comps:[{delay:2, text:'广播突然响起上课铃，空教室的门一扇扇自行打开。'},{delay:4, text:'黑板的「救我」后面，慢慢浮现出你们各自的名字。'}]
  }
];
const ARCH_FALLBACK = {
  keys:[], ward:'案发现场',
  truth:'一桩看似平常的离奇事件，牵出蛰伏在常识之下的某个「不该存在之物」——它在等人的认知出现裂缝时，便顺着裂缝爬进来。',
  hooks:['委托把你们引向{n}。表面一切如常，只有某个细节，顽固地「不对」。'],
  clues:[
    {skill:'侦查', text:'现场有一处被刻意复原的痕迹，复原得过于干净，反而暴露了有人想隐藏什么。'},
    {skill:'图书馆', text:'卷宗与新闻之间对不上号：同一件事，官方版本少了一块。'},
    {skill:'聆听', text:'安静里夹着一种低频的嗡鸣，像很远的海，又像很近的脉搏。'},
    {skill:'神秘学', text:'你认出某个反复出现的符号，属于一个不该在常识里存在的名字。'}
  ],
  npcs:[{name:'线人', tone:'谨慎', line:'有些事，知道了比不知道更危险。'},{name:'旁观者', tone:'茫然', line:'我什么都没看见，真的。'}],
  san:[{loss:'1d3', text:'你忽然确信某件不可能的事是真的，且一直都是——这种确信比恐惧更冷。'},{loss:'1d6', text:'周遭的轮廓短暂「融化」了一瞬，像世界被水浸过。'}],
  comps:[{delay:2, text:'你们犹豫时，那道裂缝又扩开了一些，远处传来似有似无的回应。'},{delay:4, text:'现场某个本应静止的东西，悄悄换了个位置。'}]
};

function matchArchetype(camp){
  const hay=((camp&&(camp.name+' '+(camp.synopsis||'')+' '+(camp.era||'')))||'').toLowerCase();
  for(const a of ARCHETYPES){ if(a.keys.some(k=>hay.includes(k.toLowerCase()))) return a; }
  return ARCH_FALLBACK;
}
function synthScenario(camp){
  const a=matchArchetype(camp);
  const name=(camp&&camp.name)||'黯影港';
  const truth=a.truth.replace(/\{n\}/g,name);
  const hooks=a.hooks.map(h=>h.replace(/\{n\}/g,name).replace(/\{ward\}/g,a.ward));
  const clues=a.clues.map((c,i)=>Object.assign({id:'cl'+i, found:false}, c));
  // 三结论：真相 / 危险来源 / 逃生/封印之法
  const conclusions=[
    {label:'真相', need:3},
    {label:'威胁', need:2},
    {label:'解法', need:2}
  ];
  return {
    camp, archetype:a, name, ward:a.ward, truth, hooks,
    clues, found:0, total:clues.length,
    npcs:a.npcs, san:a.san, comps:a.comps,
    beat:0, dread:0, clock:0, danger:0, ended:false,
    npcInScene:a.npcs[0]?a.npcs[0].name:null,
    conclusions
  };
}

/* 残片驱动合成：从玩家命运残片长成专属团本（§9.3） */
function synthScenarioFromFragments(camp, frags){
  const base=synthScenario(camp);
  const f=fragSummary(frags||[]);
  if(f.place||f.person||f.event||f.item){
    const seed=[];
    if(f.place) seed.push('故事从「'+f.place+'」开始——这是你曾在某个不经意的瞬间记下的地方。');
    if(f.person) seed.push('一个自称「'+f.person+'」的人，似乎一直在等你们到来。');
    if(f.event) seed.push('而那桩旧事——「'+f.event+'」——终于在此刻应验。');
    if(f.item) seed.push('有人手里握着「'+f.item+'」，它似乎牵动着整件事的脉络。');
    base.truth += '（命运残片注入：'+(f.place||'—')+' / '+(f.person||'—')+' / '+(f.event||'—')+' / '+(f.item||'—')+'）';
    const fragClue={id:'fragClue', found:false, frag:true, skill:'侦查',
      text:'你忽然认出眼前的景象——正是你残片里写过的「'+(f.place||f.person||f.event||f.item)+'」。守秘人将它轻轻嵌进了剧情里。'};
    base.clues=base.clues.concat([fragClue]);
    base.total=base.clues.length;
    base.fragSeed=f;
    base.hooks=[seed.join(' ')].concat(base.hooks);
  }
  return base;
}
/*@@ m3-ai:shared @@*/
/* === AI PART2 KEEPER/TEAMMATE === */

/* ---- 共享：历史、推送、意图识别 ---- */
const aiHist=[];
function aiPush(m){ renderMessage(m); scrollLog(); if(m.t==='msg'||m.t==='sys'){ aiHist.push({who:(m.who||(m.t==='sys'?'*':'?')), text:m.text}); if(aiHist.length>40) aiHist.shift(); } }
function classifyIntent(text){
  const t=text||'';
  if(/(开枪|射击|攻击|砍|刺|打|杀|火力|格斗|揍|反抗)/.test(t)) return 'combat';
  if(/(跑|逃|撤|退|离开|溜|躲避)/.test(t)) return 'flee';
  if(/(问|说|对话|交谈|套话|说服|威胁|盘问|质问|聊聊|交谈)/.test(t)) return 'talk';
  if(/(搜查|检查|查看|调查|寻找|翻|看|听|闻|摸|观察|搜索|探|读|研究|翻找|盯)/.test(t)) return 'investigate';
  return 'other';
}
function rollSanLoss(s){ const m=/1d(\d+)/.exec(s); if(!m) return 1; return 1+Math.floor(Math.random()*parseInt(m[1],10)); }
/*@@ m3-ai:keeper @@*/
/* ---- AI 守秘人（Keeper） ---- */
const Keeper = {
  sc:null, pending:null, busy:false, idleTimer:null,
  start(camp){
    const l=document.getElementById('log'); if(l) l.innerHTML='';
    const ac=activeCharObj();
    this.sc = (ac && ac.fragBank && ac.fragBank.length) ? synthScenarioFromFragments(camp, ac.fragBank) : synthScenario(camp);
    this.pending=null; this.busy=false;
    const fragNote = this.sc.fragSeed ? '（已注入你的命运残片）' : '';
    aiPush({t:'sys', text:'— 守秘人（AI）已就位，主持本场：'+(camp&&camp.name||'黯影港疑云')+' —'+fragNote});
    const ac0=activeCharObj();
    if(ac0&&ac0.name){ aiPush({t:'sys', text:'你将以调查员「'+ac0.name+'」（《'+(ac0.occupation||'调查员')+'》）的身份踏入本场——接下来怎么行动，由你决定，守秘人只负责世界的回应。'}); }
    const hook=pick(this.sc.hooks);
    this.narrate('kp_open', hook, {situation:'开场钩子', tone:'诡谲、留白', mustInclude:[hook]});
    this.armIdle();
  },
  async narrate(directive, draft, brief){
    const b=Object.assign({voice:'kp', directive, draft, situation:'', tone:'克制', mustInclude:[], history:aiHist, playerName:myName()}, brief||{});
    const t=await AI.narrate(b);
    aiPush({t:'msg', who:'守秘人', role:'gm', ava:'gm', kp:true, text:t});
  },
  armIdle(){ clearTimeout(this.idleTimer); this.idleTimer=setTimeout(()=>this.tick(), 26000); },
  async tick(){
    if(!this.sc||this.sc.ended) return;
    this.sc.clock++; this.sc.dread=Math.min(10,this.sc.dread+1);
    const comp=this.sc.comps.find(c=>c.delay===this.sc.clock);
    if(comp){ await this.narrate('kp_escalate', comp.text, {situation:'时间流逝，世界自行推进', tone:'压迫', mustInclude:[comp.text]}); }
    else { const n=this.sc.npcs[Math.floor(Math.random()*this.sc.npcs.length)];
      await this.narrate('kp_nudge', `${n.name}（${n.tone}）：${n.line}`, {situation:'等待玩家行动', tone:'克制', mustInclude:[n.line]}); }
    this.armIdle();
  },
  async respondTo(text){
    if(this.busy) return; this.busy=true; clearTimeout(this.idleTimer);
    const sc=this.sc; if(!sc){ this.busy=false; return; }
    const intent=classifyIntent(text);
    let draft='';
    if(intent==='investigate') draft=this.revealClue();
    else if(intent==='talk') draft=this.npcReact(text);
    else if(intent==='combat') draft=this.combat();
    else if(intent==='flee') draft=this.flee();
    else draft=this.openEnded();
    await this.narrate('kp_respond', draft, {situation:'玩家行动：'+text, tone:'因境而定', mustInclude:[]});
    if(sc.danger>=2 && Math.random()<0.45) this.sanEvent();
    this.busy=false; this.armIdle(); showContinue();
  },
  revealClue(){
    const sc=this.sc; const c=sc.clues.find(x=>!x.found);
    if(!c) return '你翻找良久，再无所获——但已有的线索已足够拼出轮廓。守秘人示意你理清思路。';
    c.found=true; sc.found++; sc.dread=Math.min(10,sc.dread+(c.skill==='神秘学'||c.skill==='克苏鲁神话'?2:1));
    const lead=pick(['你凝神细看，指尖拂过尘封的表面。','你换了个角度，屏住呼吸。','你蹲下身，让手电光贴着地面扫过。']);
    const need=(['侦查','聆听','图书馆','神秘学','心理学','话术','追踪','克苏鲁神话'].includes(c.skill));
    if(need) this.requestCheck(c.skill,'reg',`发现关键线索`,(fail)=>{ if(fail) sc.dread=Math.min(10,sc.dread+1); });
    const spark = c.frag ? ' ✨ 你带来的命运碎片' : '';
    return `${lead}（${c.skill}）${c.text}${spark}`;
  },
  requestCheck(skill,diff,reason,resolve){
    this.pending={skill,diff,reason,resolve};
    aiPush({t:'sys', text:`🎲 守秘人要求${myName()}进行【${skill}】检定（${diff==='hard'?'困难':diff==='ext'?'极难':'普通'}）— 打开骰子面板掷出，结果将影响后续。`});
  },
  npcReact(text){
    const sc=this.sc; const npc=sc.npcs[Math.floor(Math.random()*sc.npcs.length)];
    sc.npcInScene=npc.name;
    if(Math.random()<0.5) this.requestCheck('心理学','reg','试探对方',null);
    return pick([
      `${npc.name}（${npc.tone}）沉默片刻，低声说：「${npc.line}」`,
      `${npc.name}的眼神闪烁了一下：「${npc.line}」`,
      `面对你的追问，${npc.name}（${npc.tone}）：「${npc.line}」`
    ]);
  },
  combat(){
    const sc=this.sc; sc.danger=Math.min(5,sc.danger+2); sc.dread=Math.min(10,sc.dread+1);
    this.requestCheck('手枪','reg','开火',(fail)=>{ if(fail) sc.danger=Math.min(5,sc.danger+1); else sc.danger=Math.max(0,sc.danger-1); });
    return '你举枪的瞬间，空气里弥漫着铁锈与海腥。守秘人盯住你的手：「动手可以——但代价，由检定说了算。」';
  },
  flee(){
    const sc=this.sc; sc.danger=Math.max(0,sc.danger-1);
    return pick([
      '你们退向出口，身后的黑暗却像不舍般蠕动。守秘人记下：你们暂时脱身，但线索留给了它。',
      '门在背后合拢。走廊尽头，那东西停下了——可你们知道，它只是在等。'
    ]);
  },
  openEnded(){
    return pick([
      '守秘人没有替你做决定，只把世界摊开：「你可以搜查、质问、或赌一把。你的直觉告诉你，先从哪里入手？」',
      '气氛凝滞。守秘人引导：「说说你想怎么做——细节越具体，世界回应得越真实。」'
    ]);
  },
  sanEvent(){
    const sc=this.sc; const e=pick(sc.san); const loss=e.loss;
    this.pending={skill:'克苏鲁神话', diff:'reg', reason:'SAN', san:true, sanLoss:loss,
      resolve:(fail)=>{ /* 文案在 onRoll 中生成 */ }};
    aiPush({t:'sys', text:`🧠 守秘人发起 SAN 检定：${e.text}（失败失去 ${loss}）`});
  },
  advance(){
    const sc=this.sc; if(!sc||sc.ended) return;
    if(sc.found>=Math.min(sc.total, sc.conclusions[0].need)){
      sc.danger=Math.min(5,sc.danger+1);
      this.narrate('kp_beat', pick([
        '线索在你脑中拼合，某种轮廓浮现——这不是人为的恶，而是更古老的东西。',
        '守秘人压低声音：「你们已经碰到了不该碰的线头，现在，收不回去了。」'
      ]), {situation:'线索足够，进入转折', tone:'上升', mustInclude:[]});
    } else { this.tick(); }
  },
  async onRoll(d){
    if(!this.pending) return;
    const p=this.pending; this.pending=null;
    const fail=(d.roll>d.target);
    if(p.san){
      const lost=fail? rollSanLoss(p.sanLoss):0;
      let txt, symNote='';
      if(fail){
        const imm=pick(MADNESS_IMMEDIATE);
        symNote='【瞬时疯狂：'+imm+'】';
        if(lost>=5){ symNote+=' 【长期疯癫：'+pick(MADNESS_SUMMARY)+'】'; }
        // 记入角色（借鉴 Koishi 的疯狂症状抽取）
        const ac=activeCharObj();
        if(ac){ ensureLifecycle(ac); if(!ac.madness) ac.madness=[]; ac.madness.unshift({date:todayISO(), san:-lost, symptom:symNote}); if(ac.madness.length>30) ac.madness.length=30; saveApp(); }
        txt=`你没能移开视线。理智像沙漏般流失（-${lost} SAN）。${pick(['某种东西，从此住进了你梦里。','你听见自己的笑声，却不是从你喉咙里发出的。'])} <b class="ink-bleed">${symNote}</b>`;
      } else {
        txt=`你稳住了心神，把那幅画面锁进心底某个不会打开的抽屉。SAN 未损。`;
      }
      if(fail && symNote) toast('🧠 '+symNote);
      await this.narrate('kp_san', txt, {situation:'SAN 检定 '+(fail?'失败':'成功'), tone:'冷', mustInclude:[]});
      return;
    }
    const txt=fail
      ? `检定失败。守秘人冷静推进后果：${pick(['你扑空了，冷风灌进领口。','时机已过，门后空无一人。'])}`
      : `检定成功！守秘人点头，世界为你让出一条缝：${pick(['你抓住了那转瞬即逝的线索。','对方没料到你会这一手。'])}`;
    await this.narrate('kp_check', txt, {situation:'玩家检定：'+p.skill+' '+(fail?'失败':'成功'), tone:'克制', mustInclude:[]});
    if(p.resolve) p.resolve(fail);
  }
};
/*@@ m3-ai:mate @@*/
/* ---- AI 队友（调查员） ---- */
/* 与服务端 MATE_OCC_CLASS / MATE_LINES_CLASS 同构的本地镜像。
   本地模式（AI.cfg.mode !== 'server'）下队友台词不走服务端；如果只按节拍类型挑，
   就会出现护士说「我举枪压住火光」、记者说「我撕开绷带」—— 正是服务端已经修过的
   「队友串味」。这里只镜像需要分流的 6 个格子：
     combat  有 med / civil / occult 三种非持枪口吻（armed 复用通用持枪台词）
     support 有 armed / civil / occult 三种非医疗口吻（med 复用通用包扎台词）
   格子键与服务端一致，_mr_test.js PART 6 会断言两端同构，改一边不改另一边会报错。 */
const MATE_CLASS_MIRROR={
  '护士':'med','医学生':'med',
  '退伍军人':'armed','私人侦探':'armed',
  '记者':'civil','古董商':'civil','学者':'civil',
  '道士':'occult'
};
const MATE_INVESTIGATIVE_MIRROR=['私人侦探','记者','医学生','古董商','道士','学者'];
const MATE_DRAFT={
  combat:{
    med:{ok:'我抡起手边最重的东西砸过去，替你把它的注意力引开：「别硬拼——先打断它！」',fail:'我没拦住，被它撞得踉跄：「小心，它比我快！」'},
    civil:{ok:'我抄起椅子横过去，尽量挡在你和它中间：「快，趁现在！」',fail:'我砸偏了，椅子散了一地：「不行，我拦不住它！」'},
    occult:{ok:'我割破手掌按在地上，把它的脚钉在符线上：「三息之内它动不了！」',fail:'符线被它一脚踩断：「晚了，法子破了！」'}
  },
  support:{
    armed:{ok:'我把肩上的带子扯下来缠住你的胳膊：「先勒住，别管疼。」',fail:'我手太糙，勒得你一抽：「……忍着，我只会这个。」'},
    civil:{ok:'我扶着你在墙根坐下，把外衣垫在你背后：「先靠住。」',fail:'我想帮忙却越帮越乱：「……你告诉我该按哪儿。」'},
    occult:{ok:'我把符纸按在伤口上：「这不是治伤，是让它先别追你。」',fail:'词念错了半句，我改了口：「……先别管我，按住伤口。」'}
  }
};
const Teammate = {
  char:null, name:'', occupation:'', joined:false, busy:false,
  join(){
    this.char=makeTeammateChar(); this.name=this.char.name; this.occupation=this.char.occupation; this.joined=true;
    aiPush({t:'sys', text:`— AI 队友「${this.name}」（${this.occupation}）加入了调查 —`});
  },
  unrevealedClue(){ const sc=Keeper.sc; return sc&&sc.clues.some(c=>!c.found); },
  playerHurt(){ const last=aiHist.slice(-3).map(h=>h.text).join(' '); return /SAN|受伤|枪声|血|倒下/.test(last); },
  decide(){
    const sc=Keeper.sc; const danger=sc?sc.danger:0; const occ=this.occupation;
    if(danger>=3) return Math.random()<0.6?'combat':'flee';
    /* 与服务端 mateDecide 的 investigative 列表对齐（此前两边各写各的：
       客户端多了「护士」、少了「古董商/道士/学者」）。 */
    if(this.unrevealedClue() && MATE_INVESTIGATIVE_MIRROR.includes(occ)) return 'investigate';
    if(this.playerHurt()) return 'support';
    if(sc&&sc.npcInScene) return 'talk';
    return Math.random()<0.5?'perceive':'support';
  },
  async act(){
    if(this.busy||!this.joined) return; this.busy=true;
    const kind=this.decide(); let skill,d=null,draft;
    const _cls=MATE_CLASS_MIRROR[this.occupation]||'civil';
    const _cell=k=>((MATE_DRAFT[k]||{})[_cls])||null;
    if(kind==='combat'){ skill=(_cls==='med')?'闪避':'手枪'; d=aiRoll(skill,this.char,'reg'); const p=_cell('combat');
      draft= p? (d.roll<=d.target?p.ok:p.fail)
             : (d.roll<=d.target? '我举枪压住火光，替你咬住防线：「退到我后面！」' : '我扣下扳机却打偏了，骂了句脏话：「这鬼东西太快了！」'); }
    else if(kind==='flee'){ skill='闪避'; d=aiRoll(skill,this.char,'reg'); draft= d.roll<=d.target? '我拽住你的胳膊往出口冲：「别回头，跑！」' : '我绊了一下，但还是把你拖出了门：「快走！」'; }
    else if(kind==='investigate'){ skill='侦查'; d=aiRoll(skill,this.char,'reg'); const c=this.takeClue(); draft= d.roll<=d.target? ('我凑过去仔细看'+(c?('，「'+c.text.slice(0,18)+'…」'):'。')) : '我翻找了一阵，暂时没发现，但直觉告诉我方向没错。'; }
    else if(kind==='support'){ skill='急救'; d=aiRoll(skill,this.char,'reg'); const p=_cell('support');
      draft= p? (d.roll<=d.target?p.ok:p.fail)
             : (d.roll<=d.target? '我撕开绷带替你压住伤口：「别睡，看着我。」' : '我手忙脚乱地包扎，血还是渗出来：「撑住，我在这儿。」'); }
    else if(kind==='talk'){ skill='话术'; d=aiRoll(skill,this.char,'reg'); const npc=Keeper.sc.npcInScene; draft= d.roll<=d.target? ('我挡在你身前，试着套'+(npc||'对方')+'的话：「兄弟，咱们好商量，对吧？」') : '我话到嘴边又咽了回去，只干笑一声。'; }
    else { skill='聆听'; d=aiRoll(skill,this.char,'reg'); draft= d.roll<=d.target? '我侧耳听了听：「嘘——那边有动静。」' : '我警戒地环顾四周，没敢出声。'; }
    if(d) aiPush(aiDiceMsg(this.name,'ai',d));
    const t=await AI.narrate({voice:'mate', directive:'mate_'+kind, draft, situation:'场景：'+(Keeper.sc?Keeper.sc.name:''), tone:'忠诚、简练', mustInclude:[], history:aiHist});
    aiPush({t:'msg', who:this.name, role:'ai', ava:'ai', text:t});
    this.busy=false;
  },
  takeClue(){ const sc=Keeper.sc; const c=sc.clues.find(x=>!x.found); if(c){ c.found=true; sc.found++; } return c; }
};
function makeTeammateChar(){
  const occs=[
    {o:'私人侦探', skills:{'侦查':65,'聆听':55,'手枪':50,'话术':50,'心理学':45,'图书馆':40}},
    {o:'护士', skills:{'急救':70,'心理学':55,'话术':45,'聆听':50,'侦查':35,'医学':50}},
    {o:'退伍军人', skills:{'手枪':65,'格斗':60,'闪避':45,'侦查':40,'威吓':50,'聆听':40}},
    {o:'记者', skills:{'话术':60,'图书馆':55,'侦查':50,'心理学':45,'摄影':50,'聆听':45}},
    {o:'医学生', skills:{'医学':60,'急救':55,'图书馆':55,'神秘学':30,'侦查':40,'心理学':40}},
    /* 与 server 的 MATE_POOL 保持同构：这份客户端镜像以前少 3 个职业，
       会让「本地队友」与「服务端队友」在同一场战役里说着两套话。 */
    {o:'古董商', skills:{'估价':60,'神秘学':55,'话术':50,'图书馆':45,'侦查':40,'历史':50}},
    {o:'学者', skills:{'图书馆':70,'历史':60,'考古学':55,'神秘学':50,'语言(母语)':55,'侦查':40}},
    {o:'道士', skills:{'神秘学':70,'民俗':55,'话术':50,'聆听':45,'医学':40,'侦查':35}}
  ];
  const c=pick(occs);
  const names=['薇拉','老周','陈默','苏晚','阿杰','林夏'];
  const attrs={str:rnd(45,70),con:rnd(45,70),dex:rnd(50,75),app:rnd(45,70),pow:rnd(55,80),siz:rnd(50,75),int:rnd(60,85),edu:rnd(55,85)};
  const skills=Object.assign({'克苏鲁神话':rnd(1,8),'心理学':20,'侦查':25,'聆听':20,'话术':15,'图书馆':20,'急救':30,'手枪':20,'格斗':25,'闪避':0,'神秘学':10}, c.skills);
  return {name:pick(names), occupation:c.o, attrs, skills, san:attrs.pow};
}
function showContinue(){ const b=document.getElementById('aiContinue'); if(b) b.classList.add('show'); }
function hideContinue(){ const b=document.getElementById('aiContinue'); if(b) b.classList.remove('show'); }
/*@@ m3-ai:panel @@*/
/* ---------- AI 设置 / 指示 / 挂载 ---------- */
function refreshAIChips(){
  const kp=document.getElementById('aiKpChip'), mt=document.getElementById('aiMateChip');
  if(kp){ kp.classList.toggle('on', AI.cfg.kp); kp.textContent='🎲 AI 守秘人：'+(AI.cfg.kp?'开':'关'); }
  if(mt){ mt.classList.toggle('on', AI.cfg.mate); mt.textContent='🤝 AI 队友：'+(AI.cfg.mate?'开':'关'); }
}
function applyAICfg(){ saveAICfg(AI.cfg); refreshAIChips(); }
function mountAI(){
  /* 状态簇挂在 header 本身，而不是里面的 .ml-auto —— 挂在 .ml-auto 里就只能是
     第一行的一部分，三枚 chip 挤进去会把标题顶到折行、「守秘人」压成竖排。
     挂 header 上配合 #aiRosterHeader{flex:1 0 100%} 才能独占第二行。 */
  const headerEl=document.querySelector('#room header');
  if(headerEl && !document.getElementById('aiKpChip')){
    headerEl.insertAdjacentHTML('beforeend',
      '<span class="ai-roster-header" id="aiRosterHeader">'
      +'<span class="ai-chip kp" id="aiKpChip" role="button" tabindex="0">🎲 AI 守秘人：关</span>'
      +'<span class="ai-chip" id="aiMateChip" role="button" tabindex="0">🤝 AI 队友：关</span>'
      +'<span class="ai-chip" id="aiSetChip" role="button" tabindex="0">⚙ AI 设置</span>'
      +'</span>');
  }
  const room=document.getElementById('room');
  if(room && !document.getElementById('aiContinue')){
    room.insertAdjacentHTML('beforeend',
      '<button class="ai-continue" id="aiContinue"><span class="material-symbols-outlined">play_arrow</span> 守秘人继续 ▶</button>');
  }
  // 服务器 AI 的「发言选项」面板：贴在输入区上方，与继续按钮同层
  if(room && !document.getElementById('aiOptions')){
    room.insertAdjacentHTML('beforeend', '<div id="aiOptions" role="region" aria-label="AI 发言选项"></div>');
  }
  if(!document.getElementById('aiSetModal')){
    document.body.insertAdjacentHTML('beforeend',
      '<div class="ai-set" id="aiSetModal"><div class="ai-set-card">'
      +'<h3>AI 主持设置</h3>'
      +'<p class="sub">本地规则引擎默认可用；切换到「真实大模型」需填写接口（密钥仅存本地）。</p>'
      +'<div class="ai-row"><div><div class="t">AI 守秘人（KP）</div><div class="d">由 AI 主持剧情、判定、推进节奏</div></div><div class="toggle" id="tKp"></div></div>'
      +'<div class="ai-row"><div><div class="t">AI 队友（调查员）</div><div class="d">AI 同伴自主行动、掷骰、配合你</div></div><div class="toggle" id="tMate"></div></div>'
      +'<div class="ai-row" style="border:none"><div class="t">大脑</div><div class="d">服务器 AI（推荐·共享剧本与线索账本） / 本地引擎（离线） / 真实大模型（浏览器直连，需接口）</div></div>'
      +'<div class="seg" id="aiModeSeg"><button data-m="local" class="on">本地引擎</button><button data-m="server">服务器 AI</button><button data-m="remote">直连大模型</button></div>'
      +'<div id="aiServerFields" style="display:none">'
      +'<p class="note" id="aiServerState">正在读取服务器 AI 状态…</p>'
      +'<div style="display:flex;gap:8px;margin:6px 0 2px">'
      +'<button class="ghost" id="aiServerPing" style="flex:1">刷新状态</button>'
      +'<button class="primary" id="aiServerStart" style="flex:1">开团 / 重载剧本</button>'
      +'</div>'
      +'<p class="note">服务器 AI 由后端统一主持：世界推进、线索账本、模型调用与限流都在服务端完成，'
      +'发言选项会以卡片形式出现在输入框上方。离线或未登录时自动回落本地引擎。</p>'
      +'</div>'
      +'<div id="aiRemoteFields" style="display:none">'
      +'<div class="ai-row" style="border:none;padding-bottom:0"><div class="t">接口地址（Endpoint）</div></div>'
      +'<input type="text" id="aiEp" placeholder="https://api.xxx/v1/chat/completions"/>'
      +'<div class="ai-row" style="border:none;padding-bottom:0"><div class="t">API Key</div></div>'
      +'<input type="password" id="aiKey" placeholder="sk-..."/>'
      +'<div class="ai-row" style="border:none;padding-bottom:0"><div class="t">模型</div></div>'
      +'<input type="text" id="aiModel" placeholder="gpt-4o-mini"/>'
      +'<p class="note">密钥仅保存在本机 localStorage，不会上传第三方；本沙箱无法直连外部接口，本地引擎始终可用。</p>'
      +'</div>'
      +'<div class="actions"><button class="primary" id="aiSave">保存并应用</button><button class="ghost" id="aiClose">关闭</button></div>'
      +'</div></div>');
  }
  refreshAIChips();
  const kp=document.getElementById('aiKpChip'); if(kp) kp.onclick=()=>toggleAI('kp');
  const mt=document.getElementById('aiMateChip'); if(mt) mt.onclick=()=>toggleAI('mate');
  const sc=document.getElementById('aiSetChip'); if(sc) sc.onclick=openAISettings;
  const cont=document.getElementById('aiContinue'); if(cont) cont.onclick=()=>{ hideContinue(); if(AI.cfg.kp && !isGM()) brainContinue(); };
  const tKp=document.getElementById('tKp'); if(tKp) tKp.onclick=()=>{ AI.cfg.kp=!AI.cfg.kp; applyAICfg(); fillAISettings(); if(AI.cfg.kp && CUR_CAMP && !isGM()) brainStart(CUR_CAMP); };
  const tMate=document.getElementById('tMate'); if(tMate) tMate.onclick=()=>{ AI.cfg.mate=!AI.cfg.mate; applyAICfg(); fillAISettings(); brainMates(); };
  const seg=document.getElementById('aiModeSeg'); if(seg) seg.querySelectorAll('button').forEach(b=>b.onclick=()=>{ AI.cfg.mode=b.dataset.m; applyAICfg(); fillAISettings(); if(AI.cfg.mode!=='server') SGAI.hide(); });
  const save=document.getElementById('aiSave'); if(save) save.onclick=()=>{
    AI.cfg.endpoint=document.getElementById('aiEp').value.trim();
    AI.cfg.key=document.getElementById('aiKey').value.trim();
    AI.cfg.model=document.getElementById('aiModel').value.trim()||'gpt-4o-mini';
    applyAICfg(); fillAISettings(); toast('✅ AI 设置已保存');
  };
  const cls=document.getElementById('aiClose'); if(cls) cls.onclick=closeAISettings;
  const modal=document.getElementById('aiSetModal'); if(modal) modal.onclick=(e)=>{ if(e.target===modal) closeAISettings(); };
  const sp=document.getElementById('aiServerPing'); if(sp) sp.onclick=()=>sgaiStatus();
  const ss=document.getElementById('aiServerStart'); if(ss) ss.onclick=()=>{ closeAISettings(); brainStart(CUR_CAMP||{}); };
  fillAISettings();
}
function toggleAI(which){
  if(which==='kp'){
    AI.cfg.kp=!AI.cfg.kp;
    if(AI.cfg.kp && CUR_CAMP && !isGM()) brainStart(CUR_CAMP);
    else if(!AI.cfg.kp){ SGAI.hide(); aiPush({t:'sys',text:'— AI 守秘人已离场，房间交还给你 —'}); }
  } else {
    AI.cfg.mate=!AI.cfg.mate;
    if(AI.cfg.mate) brainMates(); else aiPush({t:'sys',text:'— AI 队友已离队 —'});
  }
  applyAICfg();
}
function openAISettings(){ const m=document.getElementById('aiSetModal'); if(m){ m.classList.add('show'); fillAISettings(); } }
function closeAISettings(){ const m=document.getElementById('aiSetModal'); if(m) m.classList.remove('show'); }
function fillAISettings(){
  const tKp=document.getElementById('tKp'); if(tKp) tKp.classList.toggle('on', AI.cfg.kp);
  const tMate=document.getElementById('tMate'); if(tMate) tMate.classList.toggle('on', AI.cfg.mate);
  const seg=document.getElementById('aiModeSeg'); if(seg) seg.querySelectorAll('button').forEach(b=>b.classList.toggle('on', b.dataset.m===AI.cfg.mode));
  const rf=document.getElementById('aiRemoteFields'); if(rf) rf.style.display=AI.cfg.mode==='remote'?'block':'none';
  const sf=document.getElementById('aiServerFields'); if(sf) sf.style.display=AI.cfg.mode==='server'?'block':'none';
  if(AI.cfg.mode==='server') sgaiStatus();
  const ep=document.getElementById('aiEp'); if(ep) ep.value=AI.cfg.endpoint||'';
  const ky=document.getElementById('aiKey'); if(ky) ky.value=AI.cfg.key||'';
  const md=document.getElementById('aiModel'); if(md) md.value=AI.cfg.model||'gpt-4o-mini';
}
/*@@ m3-ai:sgai @@*/
/* ============================================================
   AI PART3：服务器 AI 大脑（对接 server/ai-engine.js 的 /ai/* 契约）
   ------------------------------------------------------------
   与本地 Keeper/Teammate 并列的第三种大脑。分工不可混淆：
     · 世界怎么走由**服务端引擎**决定（真相/线索/节拍/检定难度/线索账本/限流）
     · 本层只做「要一轮 → 渲染思维链与发言选项 → 玩家点选 → 落聊天 + 广播」
   真相只存在于服务端导演层，本层拿到的 thinking 也带 visible:'director'，
   仅供折叠查看，绝不自动进聊天室。
   集合石房间（LFG-xxx）没有 DB 团本档案，服务端会为其合成一个只存在于
   AI 会话里的临时团本，所以这里直接把房间 key 当 campId 用即可。
   ============================================================ */
/* 服务器 AI 不可用时：把大脑切回本地，并刷新设置面板，避免 UI 说谎 */
function fallbackToLocalBrain(reason){
  try{ AI.cfg.mode='local'; applyAICfg(); fillAISettings(); }catch(e){}
  if(reason) toast(reason);
}
const SGAI = {
  campId:null, mates:[], busy:false, last:null, quota:null,

  on(){ return AI.cfg.mode==='server'; },
  key(camp){ return String((camp&&(camp.id||camp.code||camp.name))||'lobby').replace(/\s+/g,'-'); },
  panel(){ return document.getElementById('aiOptions'); },
  composer(){ const t=document.getElementById('msgInput'); return t?t.closest('section'):null; },
  /* 面板出现时给 #log 补一段底部空白，让最新几条叙事仍能滚到面板上方（否则浮层直接盖住） */
  padLog(h){
    const lg=document.getElementById('log'); if(!lg) return;
    const v=h>0?(h+'px'):'';
    if(lg.style.paddingBottom===v) return;
    lg.style.paddingBottom=v;
    if(h>0 && typeof scrollLog==='function'){ try{ scrollLog(); }catch(e){} }
  },
  /* 关键：把面板锚到「输入区的真实顶边」而不是硬编码 214px；并把总高夹在可用空间内
     —— 输入框多行自增高、或横屏矮视口时都不会压住输入区 / 顶出屏幕 */
  fit(){
    const p=this.panel(); if(!p || !p.classList.contains('show')) return;
    const room=document.getElementById('room'), comp=this.composer();
    if(!room || !comp) return;
    const GAP=8;
    const compH=comp.offsetHeight||0, roomH=room.clientHeight||0;
    p.style.bottom=(compH+GAP)+'px';
    const avail=Math.max(96, roomH-compH-GAP-8);
    const head=p.querySelector('.ai-opt-head'), foot=p.querySelector('.ai-opt-foot');
    const used=(head?head.offsetHeight:0)+(foot?foot.offsetHeight:0);
    const headerEl=document.querySelector('#room .room-top');
    const headerH=headerEl?(headerEl.offsetHeight||0):0;
    /* 尊重原设计的卡片体量（面板正文上限 38vh），同时：① 不超出可用空间
       ② 屏幕给得起时，给标题栏与约一行叙事留出可读带（硬上限）*/
    const soft=Math.max(200, Math.round(roomH*0.38)+used);
    /* reserve = 标题栏下方要留给「刚发生的叙事」的可读带。矮视口下按比例多留一点，
       否则横屏时面板会顶穿标题栏（原本 hard<=180 直接不夹紧，就是这个后果）。 */
    const reserve = roomH<480 ? 56 : 40;
    const hard=roomH-compH-GAP-headerH-reserve;
    let cap=Math.min(avail, soft);
    /* 只要还有正空间就必须夹紧；110px 是下限，低于它面板就没法用了
       （正文 .ai-opt-body 自己会滚动）。 */
    if(hard>0) cap=Math.min(cap, Math.max(hard, 110));
    p.style.maxHeight=cap+'px';
    const body=p.querySelector('.ai-opt-body');
    if(body){ body.style.maxHeight=Math.max(40, cap-used-2)+'px'; }
    this.padLog((p.offsetHeight||0)+GAP);
    this.watch();
  },
  watch(){
    const comp=this.composer(); if(!comp) return;
    if(this._ro || typeof ResizeObserver==='undefined') { /* 已挂或环境不支持 */ }
    else { try{ this._ro=new ResizeObserver(function(){ try{ SGAI.fit(); }catch(e){} }); this._ro.observe(comp); }catch(e){} }
    if(!this._onResize){
      this._onResize=function(){ try{ SGAI.fit(); }catch(e){} };
      window.addEventListener('resize', this._onResize);
      window.addEventListener('orientationchange', this._onResize);
    }
  },
  hide(){
    const p=this.panel();
    if(p){ p.classList.remove('show'); p.innerHTML=''; p.style.bottom=''; p.style.maxHeight=''; }
    this.padLog(0);
  },
  render(html){ const p=this.panel(); if(!p) return; p.innerHTML=html; p.classList.add('show'); hideContinue(); this.fit(); },

  async call(path, body){
    const opt = (body===undefined) ? undefined : { method:'POST', body:JSON.stringify(body) };
    return await apiFetch('/campaigns/'+encodeURIComponent(this.campId)+path, opt);
  },

  /* 开团：绑定剧本 + AI 队友，随后立刻推一轮开场 */
  async start(camp){
    if(!USE_API){ fallbackToLocalBrain('离线模式：服务器 AI 不可用，已回落本地引擎'); return brainStartLocal(camp); }
    if(!getToken()){ fallbackToLocalBrain('服务器 AI 需要登录后使用（已回落本地引擎）'); return brainStartLocal(camp); }
    this.campId=this.key(camp);
    this.hide();
    aiPush({t:'sys', text:'— 正在装载服务器 AI 守秘人…'});
    try{
      const scenarioId=(CUR_SETUP&&CUR_SETUP.scenarioId)||(camp&&camp.scenarioId)||undefined;
      const r=await this.call('/ai/start', { scenarioId:scenarioId, reset:true, mateCount: (AI.cfg.mate?2:0) });
      this.mates=(r&&r.mates)||[];
      const sc=(r&&r.script)||{};
      aiPush({t:'sys', text:'— 剧本已装载：'+(sc.title||'—')+'（'+(sc.id||'—')+'）｜'+(sc.acts||0)+' 幕 / '+(sc.beats||0)+' 拍 —'
        +(this.mates.length?('AI 队友：'+this.mates.map(function(m){return m.name+'('+m.occupation+')';}).join('、')):'')});
      await this.round('');
    }catch(e){
      toast(authErrText(e));
      aiPush({t:'sys', text:'— 服务器 AI 连接失败：'+authErrText(e)+'，本房间回落本地引擎 —'});
      fallbackToLocalBrain();
      brainStartLocal(camp);
    }
  },

  /* 推一轮。text 为空 = 让引擎自行推进（等价于「守秘人继续」） */
  async round(text){
    if(this.busy) return;
    if(!this.campId){ fallbackToLocalBrain('服务器 AI 尚未开团，已回落本地引擎'); return brainStartLocal(CUR_CAMP||{}); }
    this.busy=true;
    this.render('<div class="ai-opt-card"><div class="ai-opt-head">⏳ 服务器 AI 推演中…<span class="sp">真实模型冷启动可能需数秒</span></div></div>');
    try{
      const out=await this.call('/ai/think', { text:(text||''), voices:['kp','mate'], mateCount:this.mates.length });
      this.last=out; if(out&&out.quota) this.quota=out.quota;
      this.paint(out);
    }catch(e){
      this.hide(); toast(authErrText(e));
      aiPush({t:'sys', text:'— AI 推演失败：'+authErrText(e)+' —'});
    } finally { this.busy=false; }
  },

  /* 渲染：导演思维链（折叠）+ KP 发言选项 + 各队友选项 */
  paint(out){
    out=out||{};
    const kp=out.kp||{}, opts=kp.options||[], sc=out.scene||{}, led=out.ledger||{}, mates=out.mates||[];
    const bits=[ out.provider==='llm' ? '真实模型' : '本地规则大脑' ];
    if(out.degradedFrom) bits.push('本轮回落');
    if(sc.actTitle) bits.push('第'+(Number(sc.act)+1)+'幕·'+sc.actTitle);
    if(sc.beatTotal) bits.push('拍 '+(Number(sc.beat)+1)+'/'+sc.beatTotal);
    if(led.total) bits.push('线索 '+led.found+'/'+led.total);
    if(typeof out.latencyMs==='number') bits.push(out.latencyMs+'ms');
    const think=kp.thinking||[];
    let h='<div class="ai-opt-card">'
      +'<div class="ai-opt-head">🎲 AI 守秘人 · 发言选项<span class="sp">'+escapeHtml(bits.join(' · '))+'</span></div>'
      +'<div class="ai-opt-body">';
    if(think.length){
      h+='<div class="ai-opt-think" id="aiThinkToggle"><span id="aiThinkLabel">▶ 导演思维链（'+think.length+' 步 · 不外泄）</span>'
        +'<ol id="aiThinkList" style="display:none">'
        +think.map(function(t){return '<li>'+escapeHtml(String(t.step||''))+'：'+escapeHtml(String(t.text||'').slice(0,150))+'</li>';}).join('')
        +'</ol></div>';
    }
    if(opts.length){
      h+='<div class="ai-opt-ta">'+opts.map(function(o){
        return '<button class="ai-opt'+(o.recommended?' rec':'')+'" data-voice="kp" data-opt="'+escapeHtml(String(o.id||''))+'">'
          +'<span class="k">'+escapeHtml(String(o.kind||'say'))+'</span>'+escapeHtml(String(o.text||''))
          +(o.why?'<span class="why">'+escapeHtml(String(o.why))+'</span>':'')+'</button>';
      }).join('')+'</div>';
    }
    mates.forEach(function(m,mi){
      const mo=m.options||[]; if(!mo.length) return;
      h+='<div class="ai-opt-mate">🤝 '+escapeHtml(String(m.name||('队友'+(mi+1))))+'（'+escapeHtml(String(m.occupation||''))+'）</div>'
        +'<div class="ai-opt-ta">'+mo.map(function(o){
          return '<button class="ai-opt'+(o.recommended?' rec':'')+'" data-voice="mate'+mi+'" data-opt="'+escapeHtml(String(o.id||''))+'">'
            +escapeHtml(String(o.text||''))+(o.why?'<span class="why">'+escapeHtml(String(o.why))+'</span>':'')+'</button>';
        }).join('')+'</div>';
    });
    if(!opts.length && !mates.some(function(m){return (m.options||[]).length;})) h+='<div class="ai-opt-lede">本轮没有可采纳的选项。</div>';
    h+='</div><div class="ai-opt-foot">'
      +'<button class="primary" id="aiOptPush">继续推演 ▶</button>'
      +'<button id="aiOptClose">收起</button></div></div>';
    this.render(h); this.wire();
  },

  wire(){
    const p=this.panel(); if(!p) return;
    const tt=p.querySelector('#aiThinkToggle'), tl=p.querySelector('#aiThinkList'), lb=p.querySelector('#aiThinkLabel');
    if(tt&&tl&&lb) tt.onclick=function(){
      const open=tl.style.display!=='none';
      tl.style.display=open?'none':'block';
      lb.textContent=(open?'▶ ':'▼ ')+lb.textContent.replace(/^[▶▼]\s*/,'');
      try{ SGAI.fit(); }catch(e){}
    };
    p.querySelectorAll('button[data-opt]').forEach(function(b){
      b.onclick=function(){ SGAI.say(b.getAttribute('data-voice')||'kp', b.getAttribute('data-opt')); };
    });
    const push=p.querySelector('#aiOptPush'); if(push) push.onclick=function(){ SGAI.round(''); };
    const cls=p.querySelector('#aiOptClose'); if(cls) cls.onclick=function(){ SGAI.hide(); };
  },

  /* 采纳一条 → 服务端写聊天室并广播。WS 在线时由回执渲染，避免本机重复插入。 */
  async say(voice, optionId){
    if(this.busy) return;
    this.busy=true;
    try{
      const r=await this.call('/ai/say', { voice:voice, optionId:optionId });
      if(r&&r.message&&!wsReady){
        const isKp=(r.message.role==='kp');
        aiPush({t:'msg', who:(isKp?'守秘人':r.message.who), role:(isKp?'gm':'ai'), ava:(isKp?'gm':'ai'), kp:isKp, text:r.message.text});
      }
      if(r&&r.check&&!wsReady) aiPush({t:'sys', text:'🎲 AI 要求【'+r.check.skill+'】检定 — 掷出结果将影响后续。'});
    }catch(e){ toast(authErrText(e)); }
    finally { this.busy=false; }
    await this.round('');
  }
};

/* 三选一分派：所有原本直接调 Keeper/Teammate 的地方统一走这里 */
function brainStartLocal(camp){ if(AI.cfg.kp && !isGM()) Keeper.start(camp); if(AI.cfg.mate) Teammate.join(); }
function brainStart(camp){ if(AI.cfg.mode==='server') return SGAI.start(camp); return brainStartLocal(camp); }
function brainRespond(text){ if(AI.cfg.mode==='server') return SGAI.round(text); return Keeper.respondTo(text); }
function brainContinue(){ if(AI.cfg.mode==='server') return SGAI.round(''); return Keeper.advance(); }
function brainMates(){ if(AI.cfg.mode==='server') return; return Teammate.join(); }

/* 设置面板里的服务器状态（读 /ai/state，不泄密钥） */
async function sgaiStatus(){
  const el=document.getElementById('aiServerState'); if(!el) return;
  if(!USE_API){ el.textContent='离线模式（未配置 api-base）：服务器 AI 不可用，将使用本地引擎。'; return; }
  if(!getToken()){ el.textContent='未登录：服务器 AI 需要登录后使用。'; return; }
  const campId=SGAI.key(CUR_CAMP||{});
  el.textContent='正在读取服务器 AI 状态…';
  try{
    const st=await apiFetch('/campaigns/'+encodeURIComponent(campId)+'/ai/state');
    const h=st.ai||{}, l=h.llm||{}, c=h.cache||{}, u=st.usage||{}, sc=st.script||{}, se=st.session;
    const q=SGAI.quota;
    el.innerHTML='后端大脑：<b>'+(st.provider==='llm'?'真实大模型':'本地规则大脑')+'</b>'
      +'（'+escapeHtml(String(l.model||'—'))+' @ '+escapeHtml(String(l.endpointHost||'—'))
      +' · 超时 '+escapeHtml(String(l.timeoutMs==null?'—':l.timeoutMs))+'ms · 缓存 '+escapeHtml(String(c.size||0))+'）'
      +'<br>团本 <code>'+escapeHtml(campId)+'</code> ｜ 剧本：'+escapeHtml(String(sc.title||'—'))
      +'（'+escapeHtml(String(sc.acts||0))+' 幕 / '+escapeHtml(String(sc.beats||0))+' 拍'+(sc.estimated?'':'·通用骨架')+'）'
      +'<br>'+(se?('已开团：'+se.turns+' 轮 · 线索 '+se.cluesDrawn+' 条 · dread '+se.dread+' / danger '+se.danger):'尚未开团（点右侧「开团 / 重载剧本」）')
      +' ｜ 日额度上限 '+escapeHtml(String(u.limit==null?'—':u.limit))+' 次'+(q?('（今日已用 '+q.used+'）'):'');
  }catch(e){ el.textContent='读取失败：'+authErrText(e); }
}
