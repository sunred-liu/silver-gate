/* 银之门 · AI 守秘人引擎（预留层 / Mock Provider）
 * ============================================================================
 * 目标：在接入真实大模型之前，先把「AI 的思维」和「AI 的发言选项」这两件事
 *       的**数据结构、剧本驱动逻辑、上下文打包、计量与限流**全部落位，
 *       并且保证真实模型接进来时**共用同一份契约**——换 Provider 不改前端。
 *
 * 剧本逻辑（script logic）来源：scenarios.js 的 structure[] = [{title, beats[]}]
 *   「第一幕 · 验尸 → 节拍 1/2「医学检定」」这样的幕/拍游标就是剧本骨架。
 *   玩家行动按意图（investigate/talk/combat/flee/other）与当前拍比对：
 *     命中 → 推进到下一拍（onScript）
 *     未命中 → 守秘人把玩家拉回当前拍（offScript），并按「世界主动」原则加压
 *
 * 三条硬规则（来自 ai-tabletop-master 的方法论，这里变成可执行代码）：
 *   1) 真相优先   —— 先定「到底发生了什么」，线索才可移植（SCRIPT_BANK.truth）
 *   2) 三线索法则 —— 每个结论 ≥3 条线索。引擎**拒绝**在世界尚未交付 3 条线索时
 *                    进入「揭示真相」，避免调查卡死（clueGap()）
 *   3) 缓慢酝酿 + 尖锐爆发 —— dread/clock 双计量：等待时加压，命中时爆发
 *
 * 预留契约（ai.reply.v1）—— 真实大模型实现同一形状即可无缝替换：
 *   {
 *     contract: 'ai.reply.v1',
 *     provider: 'mock' | 'llm',
 *     engine:   'ai-tabletop-master/rule-brain@1',
 *     degradedFrom: 'llm' | null,        // 真实模型失败回落时标注，便于前端提示
 *     voice: 'kp' | 'mate',
 *     name, occupation,                   // mate 才有
 *     scene:  { scenarioId, title, system, act, actTitle, beat, beatText, beatIndex, beatTotal, progress },
 *     mood:   { clock, dread, danger, tension, offScriptStreak },
 *     thinking: [ { step, text, visible } ],   // visible: 'director' 只给导演面板，永不进聊天室
 *     options:  [ { id, kind, tone, text, why, recommended, skill, diff, san, resolution } ],
 *     request:  { skill, diff, reason } | null,
 *     ledger:   { found, total, conclusions, needMore }
 *   }
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { SCENARIOS } = require('./scenarios');

const CONTRACT = 'ai.reply.v1';
const ENGINE_VERSION = 'ai-tabletop-master/rule-brain@1';

/* ============================ 0. 运行时装配 ============================ */
/* 默认数据目录与 index.js / db.js 保持同一套覆盖开关。
 * 这一点很要紧：如果这里写死 __dirname/data，那么任何以 root 身份跑的
 * 自检脚本都会在服务的数据目录里创建 root:root 的状态文件，
 * 之后以 silvergate 身份运行的服务就再也写不进去（且被 try/catch 吞掉，不报错）。 */
let DATA_DIR = process.env.SG_DATA_DIR ? path.resolve(process.env.SG_DATA_DIR)
  : process.env.SG_DB_DIR ? path.resolve(process.env.SG_DB_DIR)
  : path.join(__dirname, 'data');
let logger = null;                       // 预留：接入站内日志/告警
let lastLlmError = null;                 // 最近一次真实模型失败原因（运维排查用，不外泄给玩家）
const STATE_PATH = () => path.join(DATA_DIR, 'ai-state.json');
const USAGE_PATH = () => path.join(DATA_DIR, 'ai-usage.log');

function init(opts) {
  opts = opts || {};
  if (opts.dataDir) DATA_DIR = opts.dataDir;
  if (typeof opts.logger === 'function') logger = opts.logger;
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}

/* 会话状态：按团本 id 落盘（与 rooms.json 同一套简单持久化思路） */
let sessions = {};
let sessionsLoaded = false;
function loadSessions() {
  if (sessionsLoaded) return;
  try { sessions = JSON.parse(fs.readFileSync(STATE_PATH(), 'utf8')) || {}; } catch (e) { sessions = {}; }
  sessionsLoaded = true;
}
/* 会话剪枝（2026-09-22 多轮压测暴露）：
   sessions 是「按团本 id 全量落盘」的表，以前从不清理。压测跑到 2400 场时
   ai-state.json 涨到 22.8MB，而 saveSessionsNow() 每次都要序列化整张表 ——
   场次越多每轮越慢，是「用久了就卡」的隐性劣化。
   策略（保守，不牺牲玩家可达功能）：
     · 未结束的会话一律保留 —— 随时可能被续跑，删了就是丢进度；
     · 已结束的：24 小时宽限期内一律保留（刚完本的团要能回看结局/续跑结局），
       超出宽限期的按 updatedAt 保留最近 SESSION_KEEP_ENDED 个。
   被丢弃的旧完本团若被再次打开，会当作新团从第一幕重开 —— 这是有意的取舍。
   keepEnded / graceMs 都可用环境变量调，测试里调小即可快速验证剪枝确实生效。 */
const SESSION_KEEP_ENDED = Math.max(20, parseInt(process.env.SG_AI_KEEP_ENDED || '200', 10) || 200);
const SESSION_GRACE_MS = (function () {
  const raw = process.env.SG_AI_KEEP_GRACE_MS;
  if (raw == null || raw === '') return 24 * 3600 * 1000;   // 默认 24 小时
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 24 * 3600 * 1000;
})();
function pruneSessions(opts) {
  opts = opts || {};
  const keep = opts.keepEnded == null ? SESSION_KEEP_ENDED : opts.keepEnded;
  const grace = opts.graceMs == null ? SESSION_GRACE_MS : opts.graceMs;
  const ids = Object.keys(sessions);
  if (ids.length <= keep) return [];
  const now = Date.now();
  const droppable = [];
  ids.forEach(id => {
    const s = sessions[id];
    if (!s || !s.ended) return;                                   // 未结束 → 永不丢
    if (grace > 0 && now - (s.updatedAt || 0) < grace) return;     // 刚完本 → 宽限
    droppable.push({ id, at: s.updatedAt || 0 });
  });
  /* keep 只管**已完本**的数量，不把未结束的算进额度。
     第一版写成「总数封顶」（protectedN + droppable - keep），结果 2 个未完本
     吃掉 2 格额度、只剩 1 个完本幸存：常量名与语义不符，且额度会被
     「同时在跑的团数」挤占，行为不可预测。PART 7 的断言直接抓住了它。 */
  const overflow = droppable.length - keep;
  if (overflow <= 0) return [];
  droppable.sort((a, b) => a.at - b.at);                            // 最旧的先丢
  const kill = droppable.slice(0, overflow).map(x => x.id);
  kill.forEach(id => { delete sessions[id]; });
  return kill;
}
let saveTimer = null;
function saveSessionsNow() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const pruned = pruneSessions();
    if (pruned.length && logger) logger('[ai] 会话表剪枝 ' + pruned.length + ' 个旧完本团（保留未结束 + 最近 ' + SESSION_KEEP_ENDED + ' 个）');
    /* 紧凑 JSON：带缩进序列化 2400 场的表是 22.8MB，紧凑约 1/2.5，stringify 也更快。
       原子写：先写 .tmp 再 rename —— 直接覆盖时若进程在写一半时被杀（OOM / restart），
       会留下半截 JSON，loadSessions 解析失败后 sessions 置空，**所有团本进度一起丢**。
       同文件系统内 rename 是原子的；极端情况（Windows 目标被占用等）退化为直写，
       宁可非原子也不要落盘失败。 */
    const body = JSON.stringify(sessions);
    const tmp = STATE_PATH() + '.tmp';
    fs.writeFileSync(tmp, body);
    try { fs.renameSync(tmp, STATE_PATH()); }
    catch (e2) { fs.writeFileSync(STATE_PATH(), body); }
  } catch (e) { if (logger) logger('ai.saveSessions failed: ' + e.message); }
}
/* 攒一下再写：think 是读多写少，避免高频同步落盘 */
function saveSessions() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveSessionsNow(); }, 1200);
  if (saveTimer.unref) saveTimer.unref();
}

/* ============================ 1. 意图 / 节拍分类 ============================ */
/* 与前端 classifyIntent 保持同一套语义（顺序即优先级） */
const INTENT_RULES = [
  /* 2026-09-22：原表只有「开枪/攻击/砍…」，缺了「阻止/拦住/拖住」这类**剧本自己
     会要求玩家做**的动作 —— 实测玩家在战斗拍喊「我冲上去阻止他们完成仪式」被判成
     other，卡了 3 轮靠「世界主动」兜底。注意 BEAT_RULES.combat 里一直有「阻止」，
     两张表本来就没对齐：加剧本时务必回头核对这一行。 */
  /* 第二轮补齐（2026-09-22）：上一轮只补了「阻止」一类，随后用不变式测试
     把 20 个剧本全扫了一遍，又揪出 8 个 combat 节拍的动作词缺失 ——
     「封印或驱散」「封印松动」「重启或摧毁灯塔」「清剿守卫」「雕像守卫战」
     「抉择(取宝/加固)」「驱散」都会让照做的玩家被判成 other。 */
  ['combat', /(开枪|射击|开火|交火|攻击|还击|迎击|砍|刺|打斗|厮杀|杀|火力|格斗|揍|反抗|炸|爆破|突袭|清剿|制服|扑上去|阻止|拦住|挡下|拖住|夺下|抢夺|截住|打断|架住|推开|顶住|撞开|踢|踹|摔|摁|按倒|撂倒|押住|格挡|封印|驱散|摧毁|重封|加固|掩护|重启|守卫|压制|击退)/],
  ['flee', /(跑|逃|撤|退走|离开|溜|躲避|脱身|退出房间)/],
  /* 对峙 / 救人 / 灭口 在 BEAT_RULES 里被归为 talk 型节拍（「走私者对峙」
     「信仰对峙」「最终对峙」「救人或灭口」），所以它们必须映射到 talk，
     否则这几拍一样推不动。 */
  ['talk', /(问|说|对话|交谈|套话|说服|威胁|盘问|质问|聊|走访|打听|访谈|交涉|外交|搭话|谈判|对峙|救人|灭口|威吓)/],
  ['investigate', /(搜查|检查|查看|调查|寻找|翻|看|听|闻|摸|观察|搜索|探|读|研究|翻找|盯|检验|辨识|解谜|档案|检索|化验|解剖|排查|潜入|潜行|回溯)/]
];
function classifyIntent(text) {
  const t = String(text || '');
  for (const [kind, re] of INTENT_RULES) if (re.test(t)) return kind;
  return 'other';
}

/* 剧本节拍类型：决定「这一拍该发生什么」，以及玩家什么行动能推进它。
 * 顺序即优先级 —— SAN 必须排在 finale 之前，否则「SAN 结算」会被「结算」二字
 * 误判成收尾拍，一进第三幕就被当成结局。 */
const BEAT_RULES = [
  ['san',         /SAN/],
  ['finale',      /结局|结算|完本|战报|离馆|上浮|加冕|回村|终局|出口|重燃|总攻|封存|离场|长期影响/],
  ['sandbox',     /玩家提案|即兴|自由探索|目标驱动|随时退出|生成子场景|选书|难度裁定|系统结算|玩家选择/],
  ['talk',        /打听|话术|走访|访谈|交涉|外交|对峙|会面|会谈|盘问|质问|画像|市民|乘客|镇民|信徒身份|说服|政治检定|威吓|谈判|救人或灭口/],
  ['combat',      /战|清剿|遭遇|对决|交锋|守卫|突袭|驱散|封印|摧毁|重封|阻止|BOSS|先攻|回合|目击仪式|加固/],
  ['escalate',    /雏形|松动|偏移|异变|倒戈|仪式场|苏醒|降临|归位|魔潮|异状|风暴|熄灭|首桩消失|低语|接触|真相|异响|被困|诅咒/],
  ['check',       /检定|1d100|d20|灵巧|力量/],
  ['clue',        /线索|发现|揭示|辨识|检索|档案|资料|日记|铭文|符号|涂黑|笔迹|爪痕/]
];
function beatKind(beat) {
  const t = String(beat || '');
  for (const [kind, re] of BEAT_RULES) if (re.test(t)) return kind;
  return 'investigate';
}
/* 玩家意图能推进哪些节拍类型；驱动型节拍（KP 自走）任何行动都能过 */
const KIND_INTENT = {
  investigate: ['investigate', 'check', 'clue'],
  talk: ['talk'],
  combat: ['combat'],
  flee: ['flee'],
  other: []
};
const DRIVER_KINDS = new Set(['san', 'escalate', 'finale', 'sandbox']);

/* ============================ 2. 剧本库（按 tag 归并） ============================
 * 关键点：内容不绑定具体剧本 id，而是绑定 scenarios.js 里的 tags。
 * 于是「旧港谜案(推理/海港/中篇)」自动拿到海港真相 + 推理副线线索，
 * 而玩家自建剧本只要打了标签，也能立刻获得符合类型的真相与线索池。
 * ========================================================================== */
const SCRIPT_BANK = {
  '深海': {
    truth: '信是真的，寄信的人也是真的——他早已被同化为一台「书写器官」。整座海底城市靠不断寄出信件把触角伸向陆上：只要有人读，它就被记住，也就能靠近。',
    clues: [
      { skill: '侦查', text: '信封材质含几丁质，不是纸；封口处有极细的齿痕。' },
      { skill: '图书馆', text: '研究所的深度数据每年下调三米——设备没坏，是那条沟在变浅。' },
      { skill: '神秘学', text: '潜航器录音里的背景低语能与人名一一对应，包括你们的名字。' },
      { skill: '聆听', text: '船体某处在规律振动，频率是摩尔斯电码的「重复」。' }
    ],
    npcs: [
      { name: '科考船长', tone: '压着火气', line: '我不管你们听见了什么。船是我的，我说下潜才下潜。' },
      { name: '随船医师', tone: '冷静得不正常', line: '船员指标都在正常范围。……除了睡着以后都在说话。' }
    ],
    san: [{ loss: '1d6', text: '舷窗外，有什么东西正以极慢的速度，模仿你的姿势贴近玻璃。' }],
    escalate: ['声呐上多出一个巨大的、持续上升的回波。', '主电源跳了一下，舱内照明只剩应急的红。']
  },
  '海洋': {
    truth: '这具没有脸的身体是「还债」的——码头以活人献祭换取潮水不退，而负责挑选祭品的人，正是签收每一具尸体的那位守夜人。',
    clues: [
      { skill: '医学', text: '伤口不是刀伤：整张脸是被某种吸盘状器官「揭」走的，边缘有规律排列的圆痕。' },
      { skill: '侦查', text: '死者指缝里嵌着一枚渔网结，是本地独有的双环扣，只有船坞的老手会打。' },
      { skill: '图书馆', text: '港口潮汐志记载：每次大退潮前七日，必有「无名者」登记入档。' },
      { skill: '神秘学', text: '死者背上的纹样属于一个早该消失的教团，含义是「归还」。' }
    ],
    npcs: [
      { name: '海岸警长', tone: '公事公办', line: '查清楚了就上报。别往船坞去，夜里那地方不归我管。' },
      { name: '渔夫老何', tone: '躲闪', line: '脸没了才好认不出是谁。你是外来的吧？' }
    ],
    san: [{ loss: '1d4', text: '退潮的滩涂上，一排湿脚印笔直走向海里，却没有走回来的。' }],
    escalate: ['海雾提前漫上码头，所有渔船同时熄了灯。', '灯塔熄灭了一次——按记载，这一晚不该熄。']
  },
  '博物馆': {
    truth: '展品不是被盗，是「醒了」——保安在闭馆后按仪轨喂养它，用自己的血维持它的沉睡；只是这一次，他撑不住了。',
    clues: [
      { skill: '侦查', text: '展台底座有新鲜擦痕，方向是由内向外。' },
      { skill: '图书馆', text: '馆藏名录里这尊像三年前被重新编号，理由是「尺寸不符」——它比入藏时大了两指。' },
      { skill: '神秘学', text: '底座铭文不是赞美，是喂食说明。' },
      { skill: '聆听', text: '闭馆后的展厅深处，有极轻的、类似猫喉音的震动。' }
    ],
    npcs: [
      { name: '夜班守卫', tone: '过度镇定', line: '我每晚都巡三趟。什么都没少，不是吗？' },
      { name: '馆长', tone: '急切', line: '先把媒体挡住。声誉比一尊石像重要得多。' }
    ],
    san: [{ loss: '1d3', text: '你在监控回放里看见自己正伸手去摸那座展台——可你今晚从没进过那间展厅。' }],
    escalate: ['整馆的应急灯同时亮起，又同时熄灭。', '再亮时，展台空了，玻璃罩从里面碎了一地。']
  },
  '阴谋': {
    truth: '封存卷宗的不是政府，是当年那批人的后代——他们如今坐在档案馆、医院与报社交叉的位置上，用「归档」让事情从记忆里合法消失。',
    clues: [
      { skill: '图书馆', text: '被涂黑的那段用侧光照可显影：是一份名单，末尾有档案馆自己的馆员编号。' },
      { skill: '侦查', text: '三个部门用同一支笔做了批注，墨色与压痕完全一致。' },
      { skill: '话术', text: '退休馆员只肯说一句：「1899 那卷，是被自己人重新封的。」' },
      { skill: '神秘学', text: '卷宗里夹的干枯标本不属于任何已知物种。' }
    ],
    npcs: [
      { name: '档案主任', tone: '有礼而坚决', line: '这一卷还在解密期内。您的手续，恐怕不够。' },
      { name: '退休馆员', tone: '疲惫', line: '我签过字。签的时候，我知道自己在签什么。' }
    ],
    san: [{ loss: '1d3', text: '你在旧照片里认出了自己的侧脸，照片摄于 1899 年。' }],
    escalate: ['你们查阅过的卷宗，第二天在系统里全部显示「从未入藏」。', '档案馆连夜换锁，值班名单上有你的名字。']
  },
  'meta': {
    truth: '档案室没有出口，因为「离开」这一卷还没被写下——它等的不是钥匙，而是一个愿意把自己的名字写进目录的人。',
    clues: [
      { skill: '图书馆', text: '目录里每个名字后面都有页码，只有你那一行是空的。' },
      { skill: '神秘学', text: '守阁人没有影子，但书架的影子会跟着他移动。' },
      { skill: '侦查', text: '你昨天读过的那一卷，今天翻开，结局变成了你昨晚做过的事。' },
      { skill: '心理学', text: '你记得自己进来时说了三句话，现在只能想起两句。' }
    ],
    npcs: [
      { name: '守阁人', tone: '温和而不可测', line: '不必急。这里的时间，是按页算的。' },
      { name: '另一个你', tone: '熟稔', line: '你上次也是这么问的。要不要我告诉你，你后来选了哪一卷？' }
    ],
    san: [{ loss: '1d4', text: '你在书脊上看见自己的笔迹，写着「别翻开」——可你还没翻开。' }],
    escalate: ['所有书架同时向后退了一格，通道变窄了。', '灯的数量少了一盏，而刚才并没有人经过。']
  },
  '史诗': {
    truth: '仪式不需要信徒自愿——它只需要名字。世界之所以还没被改写，是因为还有人在记住旧版本；你们每忘记一件事，星辰就近一分。',
    clues: [
      { skill: '神秘学', text: '三处圣地的地理连线与天象图完全重合，图上标注的日期就是明天。' },
      { skill: '图书馆', text: '古籍三卷缺的是同一页——被人为撕下，分藏在三地。' },
      { skill: '侦查', text: '首个信徒的日记里，每一页的日期都在倒退。' },
      { skill: '话术', text: '学者不肯细说：「我说出来，就等于替他们念了一次。」' }
    ],
    npcs: [
      { name: '老学者', tone: '恐惧', line: '别再往下查了。你每问一次，他们就记住你一次。' },
      { name: '信徒领头人', tone: '平静', line: '我们没有强迫任何人。是你们自己愿意记住的。' }
    ],
    san: [{ loss: '1d6', text: '夜空里的星星排成了一个你刚在古籍上见过的图案。' }],
    escalate: ['镇上的钟同时敲响，比昨天早了一小时。', '有人开始在墙上重复涂抹同一个符号，包括孩子。']
  },
  '恶魔': {
    truth: '封印不是被破坏，是「被谈判」——邪教徒用自己的名字换取了开门权。门后之物守约，只拿走他们许诺的那一部分。',
    clues: [
      { skill: '神秘学', text: '三把钥石的材质分别是骨、灰与誓约纸，分别对应三种代价。' },
      { skill: '侦查', text: '祭坛边有七件整齐叠好的衣物，主人不知去向。' },
      { skill: '心理学', text: '被俘的教徒不害怕，只是反复确认「他有没有迟到」。' },
      { skill: '图书馆', text: '神殿旧志里，封印重铸过四次，每次都在同一天。' }
    ],
    npcs: [
      { name: '被俘教徒', tone: '虔诚而愉悦', line: '你们来得正好。钥匙还差一把——你们身上应该带着。' },
      { name: '神殿守卫', tone: '绝望', line: '把门封回去。不管要谁的命。' }
    ],
    san: [{ loss: '1d4', text: '门缝里渗出的热气，把地面的沙烤成了玻璃。' }],
    escalate: ['门后的低语开始使用你们的口音。', '地面的裂缝连成一条笔直的线，指向祭坛。']
  },
  '政治': {
    truth: '收集来的碎片里有一块是假的——伪造者正是那位「合法继承人」。他要的不是王冠，是让所有人认可「王冠可以伪造」这件事。',
    clues: [
      { skill: '话术', text: '一位领主反复强调「法统」，却说不清自己领地的赋税去处。' },
      { skill: '图书馆', text: '王家档案里，老王的遗诏有两版，只有一版带加冕用的火漆。' },
      { skill: '侦查', text: '返程马车比来时沉，可货物清单上少了三箱。' },
      { skill: '心理学', text: '继承人谈到「王座」时眼神是空的，谈到「承认」时才亮起来。' }
    ],
    npcs: [
      { name: '合法继承人', tone: '诚恳得体', line: '我不是为了王座。我是为了不让这个国家继续流血。' },
      { name: '边境领主', tone: '粗鲁', line: '碎片？我有一块。想要就拿东西来换。' }
    ],
    san: null,
    escalate: ['又一封诏书送达，要求你们就地交出已收集的碎片。', '营地外来了不认识的人，说奉命「协助」你们。']
  },
  '巨龙': {
    truth: '龙不是被惊醒的，是「被归还」的——盗墓者把埋在荒野下的龙裔遗骸挖了出来，等于替它解开了束缚。',
    clues: [
      { skill: '侦查', text: '盗墓者的营地被从内部翻乱，装货的木箱全是空的，印着龙语封条。' },
      { skill: '追踪', text: '巨兽足迹找不到起点，最新的几个印子带着未干的湿气。' },
      { skill: '神秘学', text: '龙骨地标排列的形状，是一只睁开的眼睛。' },
      { skill: '图书馆', text: '地方志记载这片荒野「三年不长草」，而今年是第三年。' }
    ],
    npcs: [
      { name: '盗墓者头目', tone: '嘴硬', line: '我们只是取货的。谁知道那玩意儿会自己站起来。' },
      { name: '荒野向导', tone: '坦白', line: '我不进去了。给多少钱都不进。' }
    ],
    san: [{ loss: '1d4', text: '远处山脊上的轮廓动了——那不是山。' }],
    escalate: ['风向变了，所有牲口同时朝同一个方向跪下。', '地平线上多了一道本不该在的正午阴影。']
  },
  '丛林': {
    truth: '神庙不是会移动，是「扎根」——它每次现身都在吸食当地的地脉，而你们走下去的每一步，都在替它丈量。',
    clues: [
      { skill: '侦查', text: '神庙基座的刻痕与地面裂隙完全吻合，像是从地里长出来的。' },
      { skill: '图书馆', text: '铭文语法比已知文明早两千年，却用了同一种度量单位。' },
      { skill: '神秘学', text: '入口那尊雕像的手势是「止步」，而所有前人都忽略了它。' },
      { skill: '追踪', text: '向导的脚印在入口处折返过，可他坚持说自己从没来过。' }
    ],
    npcs: [
      { name: '向导', tone: '热切', line: '我走过三趟了。放心，这条路我熟。' },
      { name: '学者', tone: '兴奋', line: '这一发现会改写教科书——只要我们能活着出去。' }
    ],
    san: [{ loss: '1d3', text: '你回头看了一眼来路，那条路已经不在了。' }],
    escalate: ['入口的石门无声合拢，来路被抹成整面石壁。', '厅堂里的雕像，全部转向了你们。']
  },
  '地城': {
    truth: '矿坑不是被占据，是「被腾空」——哥布林在替更下面的东西清理场地，被抓走的矿工只是顺手带的口粮。',
    clues: [
      { skill: '侦查', text: '矿车轨道被人为改向，通向地图上没有标注的深层。' },
      { skill: '追踪', text: '地上的足迹新旧混杂，最新的那批步子极长，不像矮小类人生物。' },
      { skill: '神秘学', text: '矿壁上的抓痕组成了一个具有指向性的图腾。' },
      { skill: '聆听', text: '通风井里有回声，但回声比你们的声音多一层。' }
    ],
    npcs: [
      { name: '获救矿工', tone: '惊魂未定', line: '底下……底下比哥布林大多了。你们别往下走。' },
      { name: '镇长', tone: '急切', line: '先把矿石抢回来。伤的人，我出安葬费。' }
    ],
    san: null,
    escalate: ['坑道深处传来金属摩擦声，正朝你们的方向来。', '支撑木开始渗水，滴声变得有节奏。']
  },
  '荒野': {
    truth: '这片荒野不是死亡之地，是「苗圃」——每隔数百年的苏醒让地表寸草不生，而所有关于「诅咒」的传说都是前几次的记录。',
    clues: [
      { skill: '侦查', text: '营地四周的土层被人从下往上翻过，像有东西钻出来。' },
      { skill: '追踪', text: '沙地上有一道极宽的拖痕，尽头消失在岩缝里。' },
      { skill: '神秘学', text: '岩石上刻的日历指向今天，落款是三百年前。' },
      { skill: '聆听', text: '风声里夹着低频的、类似呼吸的节律。' }
    ],
    npcs: [
      { name: '商队领队', tone: '麻木', line: '我们不绕路。绕路更贵，死两个人也一样贵。' },
      { name: '拾荒老人', tone: '神秘', line: '今晚别点灯。亮的地方，它先看见。' }
    ],
    san: [{ loss: '1d4', text: '你数了三次营地的人数，三次都不一样。' }],
    escalate: ['营火无风自灭，远处传来整齐的、甲胄碰撞的声音。', '夜里所有的驮兽都朝外站着，不肯回头。']
  },
  '民俗': {
    truth: '村里没有受害者——全村都是参与者。所谓献祭其实是分摊：每家出一份，换全村太平。而你受托寻找的那个孩子，是今年轮到的那一份。',
    clues: [
      { skill: '话术', text: '酒馆老板娘几杯下肚漏了嘴：「上回来的那几个人，也住过你那间房。」随即脸色骤变。' },
      { skill: '侦查', text: '村口石碑新刻的名字下面，露出几十个被磨平的旧名，日期横跨近百年。' },
      { skill: '图书馆', text: '镇志里「失踪」二字被反复涂改，最新一笔墨迹还没干透。' },
      { skill: '追踪', text: '脚印把你引到祠堂后门，却在门槛处凭空消失。' }
    ],
    npcs: [
      { name: '村长', tone: '热情得过分', line: '远道而来都是客。先住下，别急着往回走。' },
      { name: '失踪孩子的母亲', tone: '麻木', line: '……轮到我们了。哭也没用。' }
    ],
    san: [{ loss: '1d4', text: '篝火噼啪炸开，火星拼出一张你陌生又熟悉的脸。' }],
    escalate: ['全村人同时停下手中的活，齐刷刷看向你们。', '有人在你们门外撒了一层细盐，沿着门槛画了半圈。']
  },
  '封闭空间': {
    truth: '凶手利用「到站倒计时」——每停一站消失一人，是他在换车厢抛尸；而列车本身，早就没有驾驶员了。',
    clues: [
      { skill: '追踪', text: '餐车地板上的水渍是盐卤，不是饮用水。' },
      { skill: '侦查', text: '6 号包厢的行李箱，编号与失踪乘客的票号一致。' },
      { skill: '聆听', text: '隧道里没有回声——你们经过的不是山，是空的。' },
      { skill: '话术', text: '乘务员报站时念错了下一站的名字，而他在这条线上跑了二十年。' }
    ],
    npcs: [
      { name: '餐车老板', tone: '过分殷勤', line: '夜里别乱走。隧道多，容易摔着。' },
      { name: '同车厢乘客', tone: '神经质', line: '你们数过吗？上车的时候，是几个人？' }
    ],
    san: [{ loss: '1d4', text: '你数了两遍人头，两遍的结果不一样。' }],
    escalate: ['列车再次驶入隧道，灯光熄灭的时间比上一次长。', '广播开始报一个不存在的站名，重复了三遍。']
  },
  '推理': {
    truth: '凶手不是外人，而是负责记录此案的人——他每一次「修正」笔录，都是在把自己从现场名单里删掉。',
    clues: [
      { skill: '侦查', text: '卷宗页码连续，但装订线有二次穿线痕迹：中间少了三页，又被补了回来。' },
      { skill: '心理学', text: '目击者每复述一次，细节都更贴近官方版本——他在学着迎合记录者。' },
      { skill: '图书馆', text: '同一案件的报纸与笔录，在「到访时间」上差了整整一小时。' },
      { skill: '话术', text: '负责记录的文书说漏了嘴：「那天我一直在里面」——可他的签名在门外。' }
    ],
    npcs: [
      { name: '办案文书', tone: '过分配合', line: '您要哪一部分？我都能帮您补上。' },
      { name: '目击者', tone: '不安', line: '我说的……和上次一样吧？应该是一样的。' }
    ],
    san: [{ loss: '1d3', text: '你低头看自己刚写的笔记，上面已经有一行不是你笔迹的「补充说明」。' }],
    escalate: ['案卷里多出一页：字迹是你的，内容是你还没做的事。', '关键证人的口供在一夜之间改成了另一个版本。']
  },
  '灵异': {
    truth: '祖辈用一次「掉包」把家宅的诅咒转给了外姓人——被转嫁者成了宅子的一部分，而真正的血脉还坐在餐桌前，等着你替他们继续这场交易。',
    clues: [
      { skill: '侦查', text: '阁楼木箱底压着一张互换姓名的契约，落款处的指纹比墨水更新。' },
      { skill: '神秘学', text: '地窖符号不是封印，是「搬运」——它把某种东西从一个人身上搬到另一个人身上。' },
      { skill: '图书馆', text: '族谱里有一支旁系被整页撕去，撕口整齐，是后来人补的。' },
      { skill: '心理学', text: '母亲提起「小时候的你」时，用的词是「那个孩子」。' }
    ],
    npcs: [
      { name: '老宅管家', tone: '恭顺得过分', line: '老爷说过，您回来住下，家里就安稳了。' },
      { name: '表姑', tone: '欲言又止', line: '有些名字别去查。查了，就归你了。' }
    ],
    san: [{ loss: '1d4', text: '你在全家福里找不到自己，却在最前排看见一张酷似你的陌生面孔。' }],
    escalate: ['晚餐的碗筷已经摆好，多了一副，位置正对着阁楼的门。', '你房间的镜子被转了个方向，朝着墙。']
  },
  '都市': {
    truth: '那通电话不是打错了——号码属于三年前就搬空的套房，而拨号者本人，此刻正被封在 410 室的墙体夹层里，用最后一格电反复求救。楼里所有人都知道，只是没人愿意承认自己听见了。',
    clues: [
      { skill: '侦查', text: '门牌 410 的漆比别家新，边缘却有一圈干涸的抓痕，像是从内侧抓出来的。' },
      { skill: '聆听', text: '贴着墙的时候，门后传来极轻的、有节奏的敲击——三短三长三短。' },
      { skill: '图书馆', text: '物业维修记录显示 410 在三年内被「重做墙体」两次，签字人是同一个早已离职的管理员。' },
      { skill: '话术', text: '对门老太太终于松口：「他们说要整修，敲了三天……之后再没见那人出来。」' }
    ],
    npcs: [
      { name: '对门老太太', tone: '警惕而闪烁', line: '你们别问了。听见也当没听见，这楼里都这样。' },
      { name: '值班保安', tone: '疲惫', line: '410？那户早没人住了。……你别让我上去。' }
    ],
    san: [{ loss: '1d3', text: '你忽然意识到，那些敲击声的间隔，和你的心跳一模一样。' }],
    escalate: ['楼道灯一盏接一盏地灭，只剩 410 门口那盏还亮着。', '你的手机开始自己拨号，屏幕上显示的是同一个号码。']
  }
};

/* 兜底：COC / DND 通用真相与线索池（三线索法则仍成立） */
const GENERIC = {
  coc: {
    truth: '表面是一桩孤立的离奇事件，实际上有人一直在系统性地「清理知情者」——作案者与被追查者，是同一批人。',
    clues: [
      { skill: '侦查', text: '现场有一处被刻意复原的痕迹，复原得太过干净，反而暴露了有人想掩饰什么。' },
      { skill: '图书馆', text: '卷宗与新闻对不上号：同一件事，官方版本少了一块。' },
      { skill: '聆听', text: '安静里夹着一种低频嗡鸣，像很远的海，又像很近的脉搏。' },
      { skill: '神秘学', text: '你认出某个反复出现的符号，属于一个不该在常识里存在的名字。' }
    ],
    npcs: [
      { name: '线人', tone: '谨慎', line: '有些事，知道了比不知道更危险。' },
      { name: '旁观者', tone: '茫然', line: '我什么都没看见，真的。' }
    ],
    san: [{ loss: '1d3', text: '你忽然确信某件不可能的事是真的，而且一直都是——这种确信比恐惧更冷。' }],
    escalate: ['你们犹豫的时候，现场某个本应静止的东西换了个位置。', '远处传来一声不属于任何机械的响动。']
  },
  dnd: {
    truth: '委托方隐瞒了真正的目的：他要的不是夺回，而是彻底封死——因为下面镇着的东西，当年正是由他的家族放进去的。',
    clues: [
      { skill: '侦查', text: '前任冒险队的装备整齐堆在营门口，人不见了，食物还是热的。' },
      { skill: '追踪', text: '地面同时存在两种脚印：一种慌乱向外，一种从容向内。' },
      { skill: '神秘学', text: '遗迹铭文是警告，措辞却像一份契约的附件。' },
      { skill: '历史', text: '地方志提到这片区域「每四十年清空一次」，最近三次都记录在案。' }
    ],
    npcs: [
      { name: '委托方代理人', tone: '急切', line: '价钱好谈。只要你们别问地下二层的事。' },
      { name: '幸存者', tone: '失神', line: '我们回来了五个……不，是四个。是四个吗？' }
    ],
    san: null,
    escalate: ['营火无风自灭，远处传来整齐的、甲胄碰撞的声音。', '夜里的哨兵换班时发现，人数又多了一个。']
  }
};

/* 标签归一：把 scenarios.js 里五花八门的 tag 收敛到剧本库的「题材键」。
 * 这一步很关键——不做的话「旧港谜案(推理/海港)」会被当成纯推理本，
 * 套上「凶手是记录者」的真相，与它自己的前提（无脸尸体 / 献祭仪式）冲突。 */
const TAG_ALIAS = {
  '海港': '海洋', '克苏鲁': '海洋', '科幻': '深海', '位面': 'meta',
  '图书馆': 'meta', '沙盒': 'meta', '生成式': 'meta', '无主线': 'meta',
  '乡村': '民俗', '家庭': '灵异', '悬疑': '推理', '诡计': '推理',
  '档案': '阴谋', '历史': '阴谋', '龙': '巨龙', '仪式': '史诗', '四季': '史诗',
  '探索': '丛林', '解谜': '丛林', '冒险': '地城', '战斗': '地城'
};
/* 题材键优先级：越靠前越具体，决定「主真相」用哪一条 */
const TAG_PRIORITY = ['深海', 'meta', '博物馆', '海洋', '阴谋', '恶魔', '史诗', '政治',
  '巨龙', '丛林', '荒野', '地城', '封闭空间', '民俗', '灵异', '推理', '都市'];
/* 语域专属题材键：主真相必须从「本语域」里挑。
 * 否则 DND《破碎王冠》(政治/史诗) 会命中史诗键，套上「星辰归位」的 COC 真相。 */
const COC_PRIMARY = ['深海', 'meta', '博物馆', '海洋', '阴谋', '史诗', '封闭空间', '民俗', '灵异', '推理', '都市'];
const DND_PRIMARY = ['政治', '巨龙', '恶魔', '地城', '丛林', '荒野'];

/* 合并：主真相 + 副线线索池 + NPC + SAN + 升级桥段 */
function buildScriptContent(tags, system) {
  const sys = system === 'dnd' ? 'dnd' : 'coc';
  const canonical = Array.from(new Set((tags || []).map(t => TAG_ALIAS[String(t)] || String(t))));
  const matched = TAG_PRIORITY.filter(t => canonical.includes(t));
  const order = sys === 'dnd' ? DND_PRIMARY : COC_PRIMARY;
  const key = order.find(t => matched.includes(t)) || null;
  const primary = key ? SCRIPT_BANK[key] : null;
  const base = primary || GENERIC[sys], baseKey = key;
  const others = matched.filter(t => t !== baseKey && SCRIPT_BANK[t]);

  const clues = [], npcs = [], san = [], escalate = [];
  const seen = new Set();
  const push = (arr, item, k) => { if (!item || seen.has(k)) return; seen.add(k); arr.push(item); };
  // 主真相的线索先入，保证「三线索法则」的确定性
  (base.clues || []).forEach(c => push(clues, c, c.text));
  others.forEach(t => (SCRIPT_BANK[t].clues || []).forEach(c => push(clues, c, c.text)));
  (base.npcs || []).forEach(n => push(npcs, n, n.name));
  others.forEach(t => (SCRIPT_BANK[t].npcs || []).forEach(n => push(npcs, n, n.name)));
  (base.san || []).forEach(s => push(san, s, s.text));
  others.forEach(t => (SCRIPT_BANK[t].san || []).forEach(s => push(san, s, s.text)));
  (base.escalate || []).forEach(e => push(escalate, e, e));
  others.forEach(t => (SCRIPT_BANK[t].escalate || []).forEach(e => push(escalate, e, e)));
  // 兜底补足：任何剧本都必须给得出 3 条线索
  const g = GENERIC[sys];
  g.clues.forEach(c => push(clues, c, c.text));
  g.npcs.forEach(n => push(npcs, n, n.name));
  if (g.san) g.san.forEach(s => push(san, s, s.text));
  g.escalate.forEach(e => push(escalate, e, e));

  return {
    matched, canonical, truth: base.truth, spineKey: baseKey, spine: primary ? 'matched' : 'generic',
    clues: clues.slice(0, 8), npcs: npcs.slice(0, 4), san: san.slice(0, 3), escalate: escalate.slice(0, 4)
  };
}

/* ============================ 3. 剧本解析（幕/拍） ============================ */
const GENERIC_STRUCTURE_COC = [
  { title: '第一幕 · 接案', beats: ['委托人的说辞里有处不对', '现场初勘', '第一处线索'] },
  { title: '第二幕 · 追查', beats: ['走访知情人', '档案检索', '遭遇阻力'] },
  { title: '第三幕 · 真相', beats: ['对峙', 'SAN 检定', '结局分支'] }
];
const GENERIC_STRUCTURE_DND = [
  { title: '第一幕 · 出发', beats: ['接受委托', '外围侦察', '入口'] },
  { title: '第二幕 · 深入', beats: ['清剿守卫', '解谜/机关', '发现真相'] },
  { title: '第三幕 · 收尾', beats: ['BOSS 战', '战利品与抉择', '回程结算'] }
];

function structureOf(scn, system) {
  const st = scn && Array.isArray(scn.structure) ? scn.structure.filter(a => a && a.title) : [];
  if (st.length && st.some(a => Array.isArray(a.beats) && a.beats.length)) return st;
  return system === 'dnd' ? GENERIC_STRUCTURE_DND : GENERIC_STRUCTURE_COC;
}

/* 解析顺序：显式传入的剧本记录 → scenario_id 命中 → 标题/标签关键词 → 通用骨架 */
function resolveScript(camp, scnRec) {
  const system = (camp && camp.system) || (scnRec && scnRec.system) || 'coc';
  let scn = scnRec || null;
  if (!scn && camp && camp.scenarioId) scn = SCENARIOS.find(s => s.id === camp.scenarioId) || null;
  if (!scn) {
    const hay = String((camp && (camp.title || camp.name)) || '') + ' ' + String((camp && camp.era) || '');
    if (hay.trim()) {
      const hit = SCENARIOS.find(s => (s.tags || []).some(t => hay.includes(t)) ||
        s.title.split('').some(() => false) && hay.includes(s.title));
      if (hit) scn = hit;
    }
  }
  const tags = scn ? (scn.tags || []) : (system === 'dnd' ? ['地城', '冒险'] : ['都市', '悬疑']);
  const content = buildScriptContent(tags, system);
  const structure = structureOf(scn, system);
  const beatTotal = structure.reduce((n, a) => n + (a.beats || []).length, 0);
  return {
    id: scn ? scn.id : 'SCN-GENERIC',
    title: (scn && scn.title) || (camp && (camp.title || camp.name)) || (system === 'dnd' ? '未命名冒险' : '未命名团本'),
    system: system === 'dnd' ? 'dnd' : 'coc',
    tagline: (scn && scn.tagline) || '',
    premise: (scn && scn.premise) || '',
    tags, content, structure, beatTotal,
    estimatedMinutes: (scn && scn.estimated_minutes) || 120,
    completionType: (scn && scn.completion_type) || 'required',
    estimated: !!scn
  };
}

/* ============================ 4. 会话状态（剧本游标） ============================ */
const MATE_POOL = [
  { occupation: '私人侦探', tone: '克制、讲究证据', skills: { '侦查': 65, '聆听': 55, '手枪': 50, '话术': 50, '心理学': 45, '图书馆': 40 } },
  { occupation: '护士', tone: '温和、先看伤再说话', skills: { '急救': 70, '心理学': 55, '聆听': 50, '话术': 45, '侦查': 35, '医学': 50 } },
  { occupation: '退伍军人', tone: '干脆、不绕弯', skills: { '手枪': 65, '格斗': 60, '威吓': 50, '闪避': 45, '侦查': 40, '聆听': 40 } },
  { occupation: '记者', tone: '好奇、爱记细节', skills: { '话术': 60, '图书馆': 55, '摄影': 50, '侦查': 50, '心理学': 45, '聆听': 45 } },
  { occupation: '医学生', tone: '理性、爱下判断', skills: { '医学': 60, '急救': 55, '图书馆': 55, '侦查': 40, '心理学': 40, '神秘学': 30 } },
  { occupation: '古董商', tone: '讲究、话里有话', skills: { '估价': 60, '神秘学': 55, '话术': 50, '图书馆': 45, '侦查': 40, '历史': 50 } },
  /* 「学者」「道士」原先只写在 MATE_OCC_CLASS / mateDecide 里，没进这张池子。
     startSession 找不到就随机换人，于是学者说退伍军人的台词，
     而 MATE_LINES_CLASS 的 occult 池（香灰 / 符线 / 铜铃）永远取不到 —— 死代码。
     补进池子后，五张表（MATE_POOL / MATE_OCC_CLASS / MATE_FLAVOR /
     mateDecide.investigative / 客户端镜像）才真正同构。 */
  { occupation: '学者', tone: '较真、爱引出处', skills: { '图书馆': 70, '历史': 60, '考古学': 55, '神秘学': 50, '语言(母语)': 55, '侦查': 40 } },
  { occupation: '道士', tone: '少言、按规矩来', skills: { '神秘学': 70, '民俗': 55, '话术': 50, '聆听': 45, '医学': 40, '侦查': 35 } }
];
const MATE_NAMES = ['薇拉', '老周', '陈默', '苏晚', '阿杰', '林夏', '沈墨', '何九'];

function pickAny(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function blankState(camp, script) {
  return {
    campId: camp.id, scenarioId: script.id, system: script.system,
    act: 0, beat: 0,
    clock: 0, dread: 0, danger: 0,
    turns: 0, offScriptStreak: 0,
    clueIdsDrawn: [], npcInScene: null,
    mates: [], ledger: [], lastOptions: {},
    ended: false, createdAt: Date.now(), updatedAt: Date.now()
  };
}
function defaultMates(n) {
  const out = [], used = new Set();
  for (let i = 0; i < (n == null ? 2 : n); i++) {
    let p, name, guard = 0;
    do { p = pickAny(MATE_POOL); name = pickAny(MATE_NAMES); guard++; } while (used.has(name) && guard < 20);
    used.add(name);
    out.push({ id: 'M' + (i + 1), name, occupation: p.occupation, tone: p.tone, skills: p.skills, seed: i * 7919 + 13 });
  }
  return out;
}
function getState(campId) {
  loadSessions();
  return sessions[campId] || null;
}
function resetState(campId) {
  loadSessions();
  delete sessions[campId];
  saveSessionsNow();
  return true;
}
function startSession(camp, script, opts) {
  loadSessions();
  opts = opts || {};
  const st = blankState(camp, script);
  st.mates = Array.isArray(opts.mates) && opts.mates.length
    ? opts.mates.slice(0, 4).map((m, i) => {
      /* 这里原来写的是 `MATE_POOL.find(...) || pickAny(MATE_POOL)` —— 找不到就**随机换职业**。
         后果一：调用方传进来的是玩家真实职业（28 个职业里 大学教授 / 学生 / 神职人员
                 全都不在队友池里），队友被悄悄换成一个陌生人，口吻张冠李戴；
         后果二：random 让「学者说错话」这条 bug 随机通过测试，藏了好几轮才被不变式抓到。
         现在的语义：职业名**永远原样保留**，只按职业族群补默认口吻与技能。 */
      const known = MATE_POOL.find(x => x.occupation === m.occupation) || null;
      const occ = String((m.occupation || (known && known.occupation) || '')).trim() || '自由职业';
      const dflt = MATE_CLASS_DEFAULT[mateClass(occ)] || MATE_CLASS_DEFAULT.civil;
      return {
        id: m.id || ('M' + (i + 1)),
        name: String(m.name || pickAny(MATE_NAMES)).slice(0, 16),
        occupation: occ,
        tone: m.tone || (known && known.tone) || dflt.tone,
        skills: m.skills || (known && known.skills) || dflt.skills,
        seed: m.seed || (i * 7919 + 13)
      };
    })
    : defaultMates(opts.mateCount == null ? 2 : opts.mateCount);
  sessions[camp.id] = st;
  saveSessionsNow();
  return st;
}
function ensureState(camp, script, opts) {
  const st = getState(camp.id);
  if (!st) return startSession(camp, script, opts);
  if (st.scenarioId === script.id) return st;
  // 本次解析落到「通用骨架」（说明调用方只传了 camp.id，没传标题/剧本），
  // 不能因此把已装载的剧本游标冲掉——保留原状态。
  if (!script.estimated) return st;
  return startSession(camp, script, opts);
}

/* ============================ 5. 幕/拍游标推进 ============================ */
function cursorOf(script, st) {
  const act = Math.min(st.act, script.structure.length - 1);
  const a = script.structure[act] || { title: '(完)', beats: [] };
  const beats = a.beats || [];
  const bi = Math.min(st.beat, Math.max(0, beats.length - 1));
  let idx = 0;
  for (let i = 0; i < act; i++) idx += (script.structure[i].beats || []).length;
  idx += bi;
  return {
    act, actTitle: a.title, actCount: script.structure.length,
    beat: bi, beatText: beats[bi] || '(自由行动)', beatCount: beats.length,
    beatIndex: idx + 1, beatTotal: script.beatTotal,
    progress: script.beatTotal ? Math.min(1, +((idx + 1) / script.beatTotal).toFixed(3)) : 0
  };
}
function advanceCursor(script, st, intent) {
  const before = cursorOf(script, st);
  const kind = beatKind(before.beatText);
  const streakBefore = st.offScriptStreak || 0;
  let matched = DRIVER_KINDS.has(kind) || (KIND_INTENT[intent] || []).includes(kind);
  let forced = false;
  // 「世界主动」硬约束：连续 3 次都没命中当前拍，就不能再等了。
  // 否则遇到战斗/交涉拍时，一个只想读书的玩家会把剧本永远卡在原地。
  if (!matched && (st.offScriptStreak || 0) >= 2) { matched = true; forced = true; }
  let after = before;
  if (matched) {
    st.offScriptStreak = 0;
    const a = script.structure[before.act];
    if (st.beat + 1 >= (a.beats || []).length) {
      if (st.act + 1 < script.structure.length) { st.act++; st.beat = 0; }
      else { st.beat = (a.beats || []).length - 1; st.ended = true; }
    } else st.beat++;
    after = cursorOf(script, st);
  } else {
    st.offScriptStreak = (st.offScriptStreak || 0) + 1;
    st.dread = Math.min(10, st.dread + 1);
  }
  // 局势计量随「刚走完的这一拍」的类型演进（缓慢酝酿 → 尖锐爆发）
  if (kind === 'combat') st.danger = Math.min(5, st.danger + 2);
  else if (kind === 'san') st.danger = Math.min(5, st.danger + 1);
  else if (kind === 'escalate') st.dread = Math.min(10, st.dread + 1);
  st.clock++;
  st.turns++;
  st.updatedAt = Date.now();
  return { onScript: matched && !forced, advanced: matched, forced, streakBefore, kind, before, after };
}

/* ============================ 6. 线索账本（三线索法则） ============================ */
const CONCLUSION_NEEDS = [
  { key: 'truth', label: '真相', need: 3 },
  { key: 'threat', label: '威胁来源', need: 2 },
  { key: 'solution', label: '解法', need: 2 }
];
function ledgerOf(script, st) {
  const drawn = new Set(st.clueIdsDrawn || []);
  const found = drawn.size;
  const conclusions = CONCLUSION_NEEDS.map(c => ({
    ...c, current: Math.min(found, c.need), done: found >= c.need
  }));
  const needMore = conclusions.find(c => !c.done);
  return {
    found, total: script.content.clues.length,
    conclusions,
    canRevealTruth: found >= 3,
    needMore: needMore ? { label: needMore.label, count: needMore.need - needMore.current } : null
  };
}
function nextClue(script, st) {
  const drawn = new Set(st.clueIdsDrawn || []);
  const pool = script.content.clues;
  for (let i = 0; i < pool.length; i++) if (!drawn.has(i)) return { index: i, clue: pool[i] };
  return null;
}

/* ============================ 7. 上下文打包（真实模型的输入） ============================
 * 这一包就是「接真实大模型时喂进去的东西」。现在是给 mock 用，将来原样给 LLM 用：
 * 模型只负责「把 already-decided 的事实写成话」，不负责决定世界走向——避免跑偏。
 * ============================================================================== */
function buildContextPack(script, st, opts) {
  opts = opts || {};
  const cur = cursorOf(script, st);
  const ledger = ledgerOf(script, st);
  const nc = nextClue(script, st);
  return {
    scenario: {
      id: script.id, title: script.title, system: script.system,
      tagline: script.tagline, premise: script.premise, tags: script.tags,
      estimatedMinutes: script.estimatedMinutes, completionType: script.completionType
    },
    outline: script.structure,
    cursor: {
      act: cur.act + 1, actTitle: cur.actTitle, beat: cur.beat + 1,
      beatText: cur.beatText, beatIndex: cur.beatIndex, beatTotal: cur.beatTotal, progress: cur.progress
    },
    /* 导演层（不外泄）：真相 = 整个团的锚点，所有线索都必须能指回它 */
    director: {
      truth: script.content.truth,
      matchedTags: script.content.matched,
      unrevealedClues: script.content.clues.filter((_, i) => !(st.clueIdsDrawn || []).includes(i)),
      pendingEscalations: script.content.escalate,
      sanPool: script.content.san
    },
    /* 玩家层（可外泄）：已经交付过的事实，供模型避免重复与失忆 */
    public: {
      revealedClues: (st.clueIdsDrawn || []).map(i => script.content.clues[i]).filter(Boolean),
      npcsPresent: script.content.npcs,
      npcInScene: st.npcInScene,
      ledger: { found: ledger.found, total: ledger.total, conclusions: ledger.conclusions },
      recentLog: (opts.recentLog || []).slice(-12),
      mates: (st.mates || []).map(m => ({ name: m.name, occupation: m.occupation, tone: m.tone })),
      mood: { clock: st.clock, dread: st.dread, danger: st.danger }
    },
    nextAction: {
      kind: opts.intent || 'other',
      onScript: !!opts.onScript,
      playerText: String(opts.playerText || '').slice(0, 300),
      suggestedClue: nc ? nc.clue : null
    }
  };
}

/* ============================ 8. 发言选项（选项库） ============================ */
const KP_NUDGE = [
  { tone: '收束', text: '（守秘人把话头收回来）这里还有没弄清的地方。你们先决定：从哪一处开始？' },
  { tone: '施压', text: '（守秘人看了一眼时钟）你们站在原地商量的时候，外面的动静并没有停。' },
  { tone: '提示', text: '（守秘人放慢语速）你们刚才做的那件事，本身就是一个线索——它已经说明了一些事。' },
  { tone: '转向', text: '（守秘人重新描述环境）你们可以搜查、可以问人、也可以干脆赌一把。你们想怎么做？' }
];
const MATE_LINES = {
  combat: {
    ok: ['我举枪压住火光，替你咬住防线：「退到我后面！」', '我把自己横在你身前，短促地说：「三秒。三秒后我们换位。」', '我抄起手边最重的东西砸过去：「别停！它怕的是打断！"'],
    fail: ['我扣下扳机却打偏了，骂了句脏话：「这鬼东西太快了！」', '我被撞得退了两步，喘着气：「不行，它知道我们要打哪儿。」', '我手上的东西脱手飞了：「该死——换法子！」']
  },
  flee: {
    ok: ['我拽住你的胳膊往出口冲：「别回头，跑！」', '我一脚踹开侧门：「这边！我数过了，这条路短。」', '我回身把门顶上：「你先走，我断后。」'],
    fail: ['我绊了一下，还是把你拖出了门：「快走！」', '出口堵住了，我骂了一声：「换路，跟我来！」', '我拉错了方向，两人撞在墙上：「不是这边——重来！」']
  },
  investigate: {
    ok: ['我凑过去看：「这儿不对，你过来看一眼。」', '我蹲下来，用手背贴着地面：「有东西刚动过。」', '我把它翻了个面：「你看这个——不像是自然留下的。」'],
    fail: ['我翻找了一阵没结果，但直觉告诉我方向没错。', '我看了半天，只看出有人比我们来得更早。', '我把东西放回原处：「没把握。别急着下结论。」']
  },
  support: {
    ok: ['我撕开绷带替你压住伤口：「别睡，看着我。」', '我把水塞到你手里：「先喘匀了再说话。」', '我按住你发抖的手：「我在。你继续看，别移开视线。」'],
    fail: ['我手忙脚乱地包扎，血还是渗出来：「撑住，我在这儿。」', '我摸遍口袋才发现带得不够：「……只能先这样。」', '我按错了位置，你疼得吸了口气：「抱歉，忍着点。」']
  },
  talk: {
    ok: ['我挡在你身前，试着搭话：「兄弟，咱们好商量，对吧？」', '我先递了根烟过去：「先别急。我们只是来问点事。」', '我顺着对方的话往下说：「你说的那个地方，我也去过。」'],
    fail: ['我话到嘴边又咽了回去，只干笑了一声。', '我开口就错了称呼，对方的脸立刻沉了下来。', '我试着套话，反被问住了：「……这不重要。」']
  },
  perceive: {
    ok: ['我侧耳听了听：「嘘——那边有动静。」', '我抬手指了指天花板：「上面有脚步，不是一个。」', '我把灯压低了些：「墙角那边，有反光。」'],
    fail: ['我警戒地环顾四周，没敢出声。', '我听了半天，只觉得安静得不正常。', '我什么也没听出来：「……也许是我错觉。」']
  }
};
/* 职业族群：同一句台词不能安在所有队友嘴上。
   实测踩过的坑：记者说出「我扯开绷带替你压住伤口」（护士台词）、
   护士说出「我举枪压住火光，替你咬住防线」（退伍军人台词）—— 根因是
   MATE_LINES 的 support / combat 两个池子「全职业共用」。
   只在「一眼能看出职业不对」的两类动作上分流（医疗动作 / 交火动作），
   其余节拍继续用通用池，避免台词量爆炸。 */
const MATE_OCC_CLASS = {
  /* —— 队友池（MATE_POOL）内 8 个 —— */
  '护士': 'med', '医学生': 'med',
  '退伍军人': 'armed', '私人侦探': 'armed',
  '记者': 'civil', '古董商': 'civil', '学者': 'civil',
  '道士': 'occult',
  /* —— 2026-09-22 多轮压力测试补齐：客户端 OCCUPATIONS 的其余 20 个 ——
     原表只登记了上面 8 个，而玩家可选职业有 28 个。没登记的 20 个全部落到
     mateClass() 的 `|| 'civil'` 兜底，于是「医生 / 法医 / 心理学家」一边带着
     【医学】【急救】技能，一边在 support 节拍说「我不懂治伤，但我知道人不能
     在这儿睡过去」；6 个带武器技能的职业也被压成 civil。
     这是 E2（护士说退伍军人的台词）的下一层：病根同样是「平行表不同构」——
     上一轮补的是 MATE_POOL，这一轮补的是这张族群表。
     判据（与客户端技能表一一对应，_mr_test.js 的 V9 断言会反向校验，
           加职业时照着规则加，别凭感觉）：
        · 有武器技能（手枪/步枪/霰弹枪/斗殴/剑术） → armed
        · 有急救 / 医学                              → med
        · 以仪式为业（道士 / 神职人员）               → occult
        · 其余                                        → civil（安全默认：
          不吹武器、不吹医术，宁可朴素也不要说自己不会的事） */
  '医生': 'med', '法医': 'med', '心理学家': 'med',
  '警察': 'armed', '猎人/向导': 'armed', '拳击手/运动员': 'armed',
  '富家子弟': 'armed', '码头工人': 'armed', '扒手/小偷': 'armed',
  '神职人员': 'occult',
  '大学教授': 'civil', '自由人/无业': 'civil', '律师': 'civil',
  '图书管理员': 'civil', '演员': 'civil', '作家': 'civil',
  '工程师': 'civil', '出租车司机': 'civil', '水手': 'civil',
  '古董商/收藏家': 'civil', '摄影师': 'civil', '学生': 'civil',
  '酒保/服务生': 'civil', '马戏团演员': 'civil'
};
function mateClass(occ) { return MATE_OCC_CLASS[occ] || 'civil'; }
/* 调查型职业：线索没凑齐时，他们会主动替玩家补线索（三线索法则的队友侧）。
   抽成具名常量并导出，是为了让它只有**一份**：以前这段列表内联在 mateDecide 里，
   客户端 decide() 又手抄了一遍，两边一改就漂（历史上真的漂过）。 */
const MATE_INVESTIGATIVE = ['私人侦探', '记者', '医学生', '古董商', '道士', '学者'];
/* 未进 MATE_POOL 的职业（玩家自填，或 28 个玩家职业里没被选作队友的那些）
   走这里取默认口吻与技能：只补数值，**不改职业名** —— 见 startSession 的注释。 */
const MATE_CLASS_DEFAULT = {
  civil: { tone: '谨慎、爱记细节', skills: { '图书馆': 50, '侦查': 45, '聆听': 40, '话术': 40, '心理学': 35, '历史': 40 } },
  armed: { tone: '干脆、不绕弯', skills: { '手枪': 55, '格斗': 50, '闪避': 45, '威吓': 45, '侦查': 40, '聆听': 35 } },
  med: { tone: '沉稳、先看伤', skills: { '急救': 60, '医学': 50, '心理学': 45, '聆听': 45, '侦查': 35, '图书馆': 30 } },
  occult: { tone: '少言、按规矩来', skills: { '神秘学': 60, '民俗': 50, '话术': 45, '聆听': 40, '侦查': 35, '历史': 40 } }
};
/* 每个池子必须 >=3 条 ok / >=3 条 fail —— 少于 3 条时三条立场会出现重复，
   _ai_engine_test.js「三条台词互不重复」会直接抓到。
   注意 support 没有 med 池、combat 没有 armed 池：这两种情况故意回落通用池，
   因为通用池本身就是护士口吻 / 持枪口吻，正好对口。 */
const MATE_LINES_CLASS = {
  support: {
    armed: {
      ok: ['我把肩上的带子扯下来缠住你的胳膊：「先勒住，别管疼。」', '我半跪下来把你扛住：「靠着我。家伙我拿着，你只管走。」', '我拆了枪带当临时止血带：「这条比你的命便宜。」'],
      fail: ['我手太糙，勒得你一抽：「……忍着，我只会这个。」', '我把带子缠歪了，血还是往外冒：「别说话，再来一次。」', '我摸遍身上只有空弹壳：「撑一会儿，我去找能用的。」']
    },
    civil: {
      ok: ['我扶着你在墙根坐下，把外衣垫在你背后：「先靠住。」', '我把水壶塞给你：「我不懂治伤，但我知道人不能在这儿睡过去。」', '我举起灯照着伤口：「让我看清是哪儿在流血，别动。」'],
      fail: ['我想帮忙却越帮越乱：「……你告诉我该按哪儿。」', '我的手一直在抖：「抱歉，我不是干这个的。」', '我翻遍口袋只找到一块手帕：「先用这个，撑到能处理为止。」']
    },
    occult: {
      ok: ['我按着你的肩念了句谁也没听清的旧词：「疼会过去，别松劲。」', '我把符纸按在伤口上：「这不是治伤，是让它先别追你。」', '我把香灰按进你掌心：「咬着牙。数到七就好。」'],
      fail: ['词念错了半句，我改了口：「……先别管我，按住伤口。」', '我按得太重，你闷哼一声：「抱歉。这法子本来就不稳。」', '火折子灭了，我摸黑找到你：「别动，我认得路。」']
    }
  },
  combat: {
    med: {
      ok: ['我不去正面对撞 —— 抄起灯架砸它的侧颈：「打这里！它转身慢！」', '我扑过去把你从它手边扯开，用身体挡在中间：「退！我数三下就换位。」', '我把整瓶酒精砸在地上，火舌腾起来隔开两边：「趁现在，往左！」'],
      fail: ['我砸偏了，灯架脱手：「该死 —— 你接着打，我捡家伙！」', '我拽着你后退却被扫到肩膀：「嘶 —— 别管我，继续！」', '酒精没点着，只溅了一地：「不行，换个法子拖住它！」']
    },
    civil: {
      ok: ['我没有武器，只能把整排货架推倒挡住它：「这样能停它三秒！」', '我抓起相机砸过去，砸中的瞬间喊：「打它的脸！它怕光！」', '我抱住它的腿往地上坠：「你动手 —— 我拖住它！」'],
      fail: ['我推不动那排货架，反被碎玻璃划了手：「不行，它过来了！」', '相机脱手摔碎，只闪了最后一下：「我只能拖这么久了！」', '我被甩开撞在墙上：「……靠你了。」']
    },
    occult: {
      ok: ['我割破手掌按在地上，把它的脚钉在符线上：「三息之内它动不了！」', '我把整把香灰撒向它：「趁它看不见 —— 现在！」', '我举着铜铃不退，把声音压在它前面：「听着我的声，别听它的！」'],
      fail: ['符线被它一脚踩断：「晚了，法子破了！」', '香灰被风卷回来迷了眼：「咳 —— 我帮不上你了！」', '铜铃被拍飞，我咬牙重新站住：「再来一次，看谁先撑不住！」']
    }
  }
};
function matePools(kind, occ) {
  const byClass = MATE_LINES_CLASS[kind];
  if (byClass) { const p = byClass[mateClass(occ)]; if (p && p.ok && p.ok.length >= 3) return p; }
  return MATE_LINES[kind] || MATE_LINES.perceive;
}
const MATE_STANCE = ['果断', '谨慎', '自嘲'];
/* 职业口吻覆盖：让「医学生」说的话像医学生，而不是所有队友共用一套台词。
   命中则作为首选项（推荐位），失败语仍从通用池取，保证检定失败也有话说。 */
const MATE_FLAVOR = {
  '私人侦探': {
    investigate: '「等等——按经验，人会把最想藏的东西放在最显眼的位置。」',
    perceive: '「我这行有个规矩：先看门锁，再看鞋底。」',
    talk: '「让我先起个头。他要是撒谎，我会换姿势。」'
  },
  '护士': {
    support: '「别动，让我看伤口。呼吸，跟着我数。」',
    perceive: '「他的瞳孔反应不对——不是吓的。」',
    investigate: '「这个出血量……不对。人不可能这样走掉。」'
  },
  '退伍军人': {
    combat: '「听我口令：我压住左翼，你往右三十米，别跟丢。」',
    flee: '「撤。活人才能复盘。」',
    support: '「咬住这个。疼就掐我胳膊，别咬舌头。」'
  },
  '记者': {
    investigate: '「我先记下来——回头能跟旧档案对上。」',
    talk: '「老规矩：我自我介绍，你接着问。」',
    perceive: '「这地方气味不对。我拍两张。」'
  },
  '医学生': {
    investigate: '「这个创面不是刀伤。让我量一下边缘的间距。」',
    support: '「先止血。别说话，省点力气。」',
    perceive: '「屋里消毒水味太重了，重得不正常。」'
  },
  '古董商': {
    investigate: '「这纹样我见过——可它不该出现在这儿。」',
    talk: '「先谈价。人一谈钱就放松。」',
    perceive: '「这东西年代不对。新旧是拼起来的。」'
  },
  '学者': {
    investigate: '「等一下——这段记载我读过，和现场对不上。」',
    perceive: '「先别动手。让我把编号抄全，顺序本身就是线索。」',
    talk: '「我来引经据典，你盯他的反应。」'
  },
  '道士': {
    combat: '「退半步，踩着我的线走。它认这个。」',
    investigate: '「这不是装饰，是方位。按规矩得从东边起。」',
    perceive: '「气味不对——有人在这儿动过手，而且是懂行的。」'
  }
};
/* 轻量 LCG：给定 seed → 可复现但各不相同的抽取，避免两个队友说出同一句话 */
function lcg(seed) { let s = (seed >>> 0) || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function shuffleWith(arr, rnd) { const c = arr.slice(); for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = c[i]; c[i] = c[j]; c[j] = t; } return c; }
function rotate(arr, k) { if (!arr.length) return arr; const n = k % arr.length; return arr.slice(n).concat(arr.slice(0, n)); }

/* ============================ 9. KP 思维与选项生成 ============================ */
function kpOption(kind, text, why, extra) {
  return Object.assign({ kind, tone: '克制', text, why, recommended: false, skill: null, diff: 'reg', san: null, resolution: null }, extra || {});
}
function kpThink(ctx) {
  const { script, st, res, pack } = ctx;
  const cur = res.after, kind = res.kind, intent = pack.nextAction.kind;
  const ledger = ledgerOf(script, st);
  const nc = nextClue(script, st);
  const thinking = [];
  const options = [];

  thinking.push({ step: '读本', visible: 'director', text: `《${script.title}》${script.id}｜${script.system.toUpperCase()}｜约 ${script.estimatedMinutes} 分钟｜${script.completionType === 'open' ? '开放式完本' : '需完本'}${script.estimated ? '' : '（未绑定剧本库，使用通用骨架）'}` });
  if (script.tagline) thinking.push({ step: '前提', visible: 'director', text: script.tagline + (script.premise ? ' —— ' + script.premise : '') });
  thinking.push({
    step: '定位', visible: 'director',
    text: `本回合节拍：${res.before.actTitle} · ${res.before.beat + 1}/${res.before.beatCount}「${res.before.beatText}」（类型 ${kind}）`
      + `；${res.onScript ? '命中，推进至 ' : res.forced ? '世界主动推进至 ' : '未命中，仍停在 '}`
      + `${res.after.actTitle} · ${res.after.beat + 1}/${res.after.beatCount}「${res.after.beatText}」`
      + `（全本第 ${res.after.beatIndex}/${res.after.beatTotal} 拍，进度 ${Math.round(res.after.progress * 100)}%）`
  });
  thinking.push({ step: '判意图', visible: 'director', text: `玩家说「${pack.nextAction.playerText || '(沉默/等待)'}」→ 归类为 ${intent}；当前节拍类型 ${kind}；${res.onScript ? '命中，剧本推进到下一拍' : res.forced ? `连续 ${res.streakBefore} 次未命中 → 触发「世界主动」：不再等玩家，镜头推过去，这一拍由世界完成，玩家被动承受后果` : '未命中，守秘人把玩家拉回当前拍'}` });
  thinking.push({ step: '定真相', visible: 'director', text: `真相（永不直接外泄）：${script.content.truth}` });
  thinking.push({
    step: '守线索', visible: 'director',
    text: nc
      ? `三线索法则：已交付 ${ledger.found}/${ledger.total} 条；${ledger.needMore ? `距离结论「${ledger.needMore.label}」还差 ${ledger.needMore.count} 条，本轮必须给线索` : '三条结论均已够用，可进入揭示' }。本轮候选线索（${nc.clue.skill}）：${nc.clue.text}`
      : `三线索法则：线索池已全部交付（${ledger.found}/${ledger.total}），转为「收束与代价」模式，不再新增线索`
  });
  thinking.push({
    step: '压节奏', visible: 'director',
    text: `dread ${st.dread}/10，clock ${st.clock}，danger ${st.danger}，连续未命中 ${st.offScriptStreak} 次。${st.offScriptStreak >= 2 ? '已触发「世界主动」：本轮必须让世界先动。' : st.offScriptStreak >= 1 ? '已偏离一拍；再偏一拍就由世界推进（避免剧本卡死）。' : '节奏正常，可继续酝酿。'}`
  });
  if (st.mates && st.mates.length) thinking.push({ step: '留戏份', visible: 'director', text: `AI 队友 ${st.mates.map(m => `${m.name}(${m.occupation})`).join('、')} 在场。关键推理必须由玩家做出，队友只做辅助动作与提问。` });

  /* ---- 组装发言选项：至少 3 条，最多 5 条，必有一条 recommended ---- */
  const mustClue = ledger.found < 3 || (ledger.needMore && ledger.found < ledger.total && kind !== 'finale');
  const esc = script.content.escalate[st.clock % Math.max(1, script.content.escalate.length)];

  if (kind === 'finale' || st.ended) {
    options.push(kpOption('finale', `（守秘人合上本子）到这里，这个故事可以收尾了。你们要的是「带走真相」，还是「让这里安静下去」？`, '全本节拍走完，进入结算', { recommended: true, tone: '收束' }));
    options.push(kpOption('finale', `（守秘人开始整理战报）把你们记得的事按顺序说一遍——我会记下谁做了什么，以及代价落在谁身上。`, '结算：整理战报', { tone: '平' }));
  } else if (kind === 'san') {
    const e = script.content.san[st.turns % Math.max(1, script.content.san.length)] || { loss: '1d3', text: '你所见之物超出了可以理解的范围。' };
    options.push(kpOption('san', `${e.text}（请做【克苏鲁神话】检定，失败失去 ${e.loss} SAN）`, '剧本节拍：SAN 检定', { recommended: true, tone: '冷', skill: '克苏鲁神话', san: e.loss }));
    options.push(kpOption('narrate', '你们暂时把视线移开了——但你们都清楚，刚才那一眼没有白看。', '不触发检定，仅记录压力', { tone: '克制' }));
  } else if (kind === 'combat') {
    options.push(kpOption('combat', '它先动了。场面在这一刻失去了秩序——请做【闪避】检定，我说结果。', '剧本节拍：战斗', { recommended: true, tone: '紧', skill: '闪避' }));
    options.push(kpOption('combat', `你们抢先一步。${st.mates[0] ? st.mates[0].name + '把你们隔在身后，' : ''}请做【手枪】检定。`, '剧本节拍：由你们先手', { tone: '紧', skill: '手枪' }));
  } else if (kind === 'talk') {
    const npc = script.content.npcs[st.turns % script.content.npcs.length];
    if (npc) st.npcInScene = npc.name;
    options.push(kpOption('npc', `${npc.name}（${npc.tone}）：「${npc.line}」`, '剧本节拍：走访/交涉，NPC 出场', { recommended: true, tone: '静' }));
    options.push(kpOption('npc', `${npc.name}没有立刻回答。${st.mates[0] ? st.mates[0].name + '轻轻碰了你一下，示意你换个问法。' : '他（她）在等你换一个问法。'}`, '同一 NPC 的第二种反应，留给高难度检定', { tone: '静', skill: '心理学' }));
  } else if (kind === 'escalate') {
    options.push(kpOption('escalate', esc, '剧本节拍：世界自行推进（缓慢酝酿 → 尖锐爆发）', { recommended: true, tone: '压迫' }));
  } else {
    if (nc && mustClue) {
      const c = nc.clue;
      options.push(kpOption('clue', `${c.text}（请做【${c.skill}】检定）`, `剧本节拍：${cur.beatText}；按三线索法则交付第 ${nc.index + 1} 条线索`, { recommended: true, tone: '低调', skill: c.skill, clueIndex: nc.index, resolution: { onSuccess: '你抓住了那个细节——它比看上去重要。', onFail: '你说不清哪里不对，但它已经记在你脑子里了。' } }));
      options.push(kpOption('clue', `${c.text}`, `同一条线索，不给检定直接给（用于节奏偏慢时提速）`, { tone: '平' }));
    } else {
      options.push(kpOption('narrate', esc, '线索已够用，转为加压与逼近真相', { recommended: true, tone: '压迫' }));
    }
    options.push(kpOption('narrate', pickAny(KP_NUDGE).text, '守秘人拉回主线（玩家行动偏离当前节拍时的兜底）', { tone: '收束' }));
  }
  /* 收尾补足：确保总有一条「拉回主线」与一条「放权给玩家」 */
  if (options.length < 4) options.push(kpOption('narrate', '守秘人没有替你做决定，只把世界摊开：「你可以搜查、问人，或者赌一把。先从哪里入手？」', '把选择权交还玩家（守秘人法则：不替代玩家决策）', { tone: '平' }));
  if (options.length < 3) options.push(kpOption('narrate', pickAny(KP_NUDGE).text, '兜底：拉回当前节拍', { tone: '收束' }));

  /* 三线索法则（硬约束，不分节拍类型）：
     只要结论还没凑齐，本轮就**必须**存在一条线索出口。否则遇到交涉/战斗/推进拍时，
     玩家会连着好几轮拿不到任何新信息 —— 这正是「调查卡死」的成因。 */
  if (ledger.found < 3 && nc && !options.some(o => o.kind === 'clue')) {
    const gap = ledger.needMore ? `结论「${ledger.needMore.label}」还差 ${ledger.needMore.count} 条` : '结论尚未凑齐';
    options.push(kpOption('clue', `${nc.clue.text}（请做【${nc.clue.skill}】检定）`,
      `三线索法则：${gap}，必须留出线索出口（即便本拍类型是 ${kind}）`,
      { tone: '低调', skill: nc.clue.skill, clueIndex: nc.index, resolution: { onSuccess: '你抓住了那个细节——它比看上去重要。', onFail: '你说不清哪里不对，但它已经记在你脑子里了。' } }));
  }

  /* 组队返回：截断时也不能丢掉「推荐项」和「线索出口」这两条命脉 */
  const final = options.slice(0, 5);
  [options.find(o => o.recommended), options.find(o => o.kind === 'clue')].forEach(must => {
    if (must && final.indexOf(must) < 0) final.push(must);
  });

  const request = (() => {
    const rec = final.find(o => o.recommended && o.skill);
    return rec ? { skill: rec.skill, diff: rec.diff || 'reg', reason: rec.kind + '·' + cur.beatText } : null;
  })();

  return {
    contract: CONTRACT, engine: ENGINE_VERSION,
    voice: 'kp', name: '守秘人',
    scene: sceneOf(script, cur),
    mood: moodOf(st),
    thinking,
    options: final.slice(0, 6).map((o, i) => Object.assign({}, o, { id: `kp-${st.turns}-${i + 1}` })),
    request,
    ledger: ledgerOf(script, st)
  };
}

function sceneOf(script, cur) {
  return {
    scenarioId: script.id, title: script.title, system: script.system,
    act: cur.act + 1, actTitle: cur.actTitle, actCount: cur.actCount,
    beat: cur.beat + 1, beatText: cur.beatText, beatCount: cur.beatCount,
    beatIndex: cur.beatIndex, beatTotal: cur.beatTotal, progress: cur.progress
  };
}
function moodOf(st) {
  const tension = st.danger >= 3 ? '爆发' : st.dread >= 6 ? '高压' : st.dread >= 3 ? '酝酿' : '铺陈';
  return { clock: st.clock, dread: st.dread, danger: st.danger, tension, offScriptStreak: st.offScriptStreak || 0 };
}

/* ============================ 10. 队友思维与选项生成 ============================ */
function mateDecide(script, st, intent, mate) {
  const danger = st.danger;
  if (danger >= 3) return Math.random() < 0.6 ? 'combat' : 'flee';
  const ledger = ledgerOf(script, st);
  const isInvestigator = MATE_INVESTIGATIVE.includes((mate && mate.occupation) || '');
  // 世界尚未交付 3 条线索时，调查型职业主动补线索——这是「三线索法则」的队友侧
  if (!ledger.canRevealTruth && isInvestigator) return 'investigate';
  if (intent === 'combat') return 'combat';
  if (intent === 'flee') return 'flee';
  if (intent === 'talk' && st.npcInScene) return 'talk';
  if (!ledger.canRevealTruth && Math.random() < 0.45) return 'investigate';
  if (st.npcInScene && Math.random() < 0.5) return 'talk';
  return Math.random() < 0.5 ? 'perceive' : 'support';
}
function mateThink(ctx) {
  const { script, st, mate, index, res } = ctx;
  const cur = res.after;
  const kind = mateDecide(script, st, ctx.intent, mate);
  const occ = mate.occupation;
  const skillMap = {
    combat: occ === '护士' || occ === '医学生' ? '闪避' : '手枪',
    flee: '闪避', investigate: occ === '医学生' ? '医学' : '侦查',
    support: occ === '护士' || occ === '医学生' ? '急救' : '急救',
    talk: occ === '古董商' || occ === '记者' ? '话术' : '话术',
    perceive: '聆听'
  };
  const skill = skillMap[kind] || '侦查';
  const target = Math.max(20, Math.round((mate.skills && mate.skills[skill]) || 45));
  const lines = matePools(kind, occ);   // 按职业族群分流：护士不会举枪，记者不会包扎
  // 用队友 seed + 回合 + 座位号做可复现抽取：同一回合里两个队友不会说同一句
  const rnd = lcg((mate.seed || 1) + st.turns * 31 + index * 101);
  const oks = rotate(shuffleWith(lines.ok, rnd), index);
  const fails = rotate(shuffleWith(lines.fail, rnd), index);
  const flav = (MATE_FLAVOR[occ] || {})[kind] || null;

  const thinking = [
    { step: '观察', visible: 'director', text: `${mate.name}（${occ}，${mate.tone}）注意到：${cur.actTitle} · 「${cur.beatText}」` },
    { step: '判断', visible: 'director', text: `场上 dread ${st.dread}/10、danger ${st.danger}；玩家意图 ${ctx.intent}；${mate.name}倾向行动类型 = ${kind}（职业倾向 + 局势）` },
    { step: '顾虑', visible: 'director', text: '不抢戏：关键推理与真相必须留给玩家；队友只做动作、提问与掩护，不替代决定。' },
    { step: '备选', visible: 'director', text: `三条台词分属不同立场（${MATE_STANCE.join(' / ')}）；检定【${skill}】目标 ${target}，成功与失败各有对应说法。${flav ? '首选项使用职业口吻。' : ''}` }
  ];
  const stances = MATE_STANCE.slice(0, 3);
  const options = stances.map((stance, i) => {
    const text = (i === 0 && flav) ? flav : (oks[i] || oks[0]);
    return {
      id: `mate${index}-${st.turns}-${i + 1}`,
      kind, tone: stance, text, why: `剧本节拍「${cur.beatText}」；${occ} 的 ${kind} 反应（${stance}）`,
      recommended: i === 0, skill, diff: 'reg', target,
      resolution: { onSuccess: text, onFail: fails[i] || fails[0] }
    };
  });
  return {
    contract: CONTRACT, engine: ENGINE_VERSION,
    voice: 'mate', name: mate.name, occupation: occ, mateIndex: index,
    scene: sceneOf(script, cur), mood: moodOf(st),
    thinking, options, request: null,
    ledger: ledgerOf(script, st)
  };
}

/* ============================ 11. Provider 接缝 ============================
 * 两条腿走路，各司其职：
 *
 *   mock —— 纯本地规则大脑。零依赖、零延迟、永远可用，负责「世界怎么走」：
 *           真相、线索、节拍推进、检定难度、线索编号、NPC 出场，全部由它决定。
 *   llm  —— 任何 OpenAI 兼容接口（本地 Ollama / 免费云端 / 商业 API 同一套写法）。
 *           它只负责「把已经决定的事实写成人话」：旁白、NPC 台词、选项措辞。
 *
 * 这条职责边界是刻意划死的，也是这套架构最重要的安全阀：
 * 模型**从不**决定世界走向，所以它再小、再抖、再胡说，也不可能凭空造线索、
 * 把真相提前泄露、或让剧本跑偏 —— 最差情况只是文笔退回引擎自带的版本。
 *
 * 失败语义：未配置 / 超时 / HTTP 错 / JSON 解析失败 / 校验不过 → 一律抛错，
 * 由 think() 统一回落 mock 并如实标注 degradedFrom。玩家永远拿得到回复。
 * ========================================================================= */
function llmCfg() {
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    endpoint: String(process.env.AI_LLM_ENDPOINT || '').trim(),
    key: String(process.env.AI_LLM_KEY || '').trim(),        // 允许留空（免鉴权的免费接口）
    model: String(process.env.AI_LLM_MODEL || '').trim() || 'openai',
    timeoutMs: Math.max(1000, num(process.env.AI_LLM_TIMEOUT_MS, 15000)),
    maxTokens: Math.max(32, num(process.env.AI_LLM_MAX_TOKENS, 420)),
    temperature: num(process.env.AI_LLM_TEMPERATURE, 0.85),
    /* 推理型模型（gpt-oss / qwen3 / deepseek-r 等）默认先吐一大段思维链，
       实测能把 4 秒拖成 30 秒。这里只需要改写几个短句，不需要它「思考」，
       所以只要接口认 reasoning_effort 就一律压到 low。填 off 可完全不带该字段。 */
    effort: String(process.env.AI_LLM_REASONING_EFFORT || 'low').trim()
  };
}
function llmReady() { return !!llmCfg().endpoint; }

async function llmChat(messages, cfg) {
  const c = cfg || llmCfg();
  if (!c.endpoint) throw new Error('LLM 未配置：缺少 AI_LLM_ENDPOINT');
  const host = String(c.endpoint).replace(/^https?:\/\//, '').split('/')[0];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), c.timeoutMs);
  const t0 = Date.now();
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (c.key) headers.Authorization = 'Bearer ' + c.key;
    const body = {
      model: c.model, messages, max_tokens: c.maxTokens,
      temperature: c.temperature, stream: false
    };
    if (c.effort && c.effort !== 'off') body.reasoning_effort = c.effort;
    let r;
    try {
      r = await fetch(c.endpoint, {
        method: 'POST', headers, signal: ctrl.signal, body: JSON.stringify(body)
      });
    } catch (e) {
      /* 原始 fetch 错误只有一句 "fetch failed"，排查时毫无信息量。
         这里把「超时」和「连不上」分开说清楚，运维看 lastError 就能定位。 */
      if (e && (e.name === 'AbortError' || /abort/i.test(String(e.message)))) {
        throw new Error('LLM 超时（>' + c.timeoutMs + 'ms @ ' + host + '）');
      }
      const cause = (e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || '未知原因';
      throw new Error('LLM 连不上 ' + host + '：' + cause);
    }
    if (!r.ok) throw new Error('LLM HTTP ' + r.status + ' @ ' + host + '：' + (await r.text()).slice(0, 160));
    const j = await r.json();
    const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
    const text = String(msg.content || '').trim();
    if (!text) throw new Error('LLM 返回空内容（' + host + '）');
    return { text, ms: Date.now() - t0, host };
  } finally { clearTimeout(timer); }
}

/* 模型爱把 JSON 包在 ``` 里或前后加废话，这里做一次稳健抽取 */
function extractJson(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('LLM 输出中找不到 JSON 对象');
  return JSON.parse(s.slice(a, b + 1));
}

/* 输出被 max_tokens 截断时，外层 JSON 必然没闭合、整体解析失败。
   这时退一步：用正则把**已经完整闭合**的 {"i":n,"text":"..."} 捞出来。
   能救几条是几条 —— 部分改写 + 部分保留引擎原句，远好过整轮退回 mock。 */
function salvageLines(s) {
  const out = [];
  const re = /\{\s*"i"\s*:\s*(\d+)\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
  let m;
  while ((m = re.exec(String(s || '')))) {
    let t;
    try { t = JSON.parse('"' + m[2] + '"'); } catch (e) { continue; }
    out.push({ i: Number(m[1]), text: t });
  }
  return out;
}

const REWRITE_SYS = [
  '你是中文克苏鲁跑团（COC）的守秘人文案。别人已经把「要说什么」定好了，你只把措辞改得更自然、更有画面感。',
  '铁律（违反即作废）：',
  '1. 只改措辞。不得新增或删减任何事实：线索、人名、地名、数字、时间、结论一律不动。',
  '2. 保留原文中【】里的专有名词与检定名（例如【侦查】），并保留「（请做…检定）」这类括注的原意。',
  '3. 不得出现「玩家」「角色」「AI」「系统」「KP」这类出戏词；指代调查员时用「你们」。',
  '4. 风格：克制、阴冷、留白。不写爽文，不作解释，不堆砌感叹号。',
  '5. 每条改写后长度控制在原文的 0.6–1.5 倍之间。',
  '6. 只输出 JSON，不要 markdown 代码块，不要任何前言后语。',
  /* 2026-09-22 实测（百炼 qwen3.8-flash）：这一句把输出 tokens 从 ~300 压到 ~180 ——
     模型默认会 pretty-print JSON，那些换行缩进纯属浪费额度，还拖慢 2–4 秒、
     并抬高被 max_tokens 截断的风险。压实后一轮从 7–9.6 秒降到约 5 秒。 */
  '7. 必须输出紧凑的单行 JSON：不得有任何换行、缩进或多余空格。',
  '输出格式：{"lines":[{"i":0,"text":"改写后的第 0 条"},{"i":1,"text":"改写后的第 1 条"}]}'
].join('\n');

/* 把一组「已定稿的台词」交给模型改写。
   校验从严：条数不符 / 空串 / 长度失控（跑偏或复读）/ 弄丢【检定】标记 → 丢弃该条；
   一条都没通过 → 抛错，让整轮回落 mock，而不是把半成品塞给玩家。 */
async function llmRewrite(lines, facts) {
  const src = lines.map(t => String(t == null ? '' : t));
  if (!src.length) return src;
  const { text } = await llmChat([
    { role: 'system', content: REWRITE_SYS },
    { role: 'user', content: JSON.stringify({ 场景: facts, 待改写: src.map((t, i) => ({ i, text: t })) }) }
  ]);
  let arr = [];
  try {
    const j = extractJson(text);
    arr = Array.isArray(j.lines) ? j.lines : (Array.isArray(j) ? j : []);
  } catch (e) {
    /* 截断/半截输出 → 打捞已闭合的条目 */
    arr = salvageLines(text);
    if (!arr.length) throw new Error('LLM 输出既不是合法 JSON，也打捞不到完整条目');
  }
  const out = src.slice();
  let hit = 0;  for (const it of arr) {
    const i = Number(it && it.i);
    if (!Number.isInteger(i) || i < 0 || i >= out.length) continue;
    const t = String((it && it.text) || '').replace(/\s*\n+\s*/g, ' ').trim();
    if (t.length < 2) continue;
    /* 长度闸门：太短像被截断、太长像跑题/复读，都不采纳 */
    const lo = Math.max(4, src[i].length * 0.5), hi = src[i].length * 1.8 + 30;
    if (t.length < lo || t.length > hi) continue;
    /* 原文带【检定】标记的，改写后必须还在——丢了就说明模型擅自改了机制 */
    if (/【[^】]+】/.test(src[i]) && !/【[^】]+】/.test(t)) continue;
    out[i] = t; hit++;
  }
  if (!hit) throw new Error('LLM 改写结果全部未通过校验（共 ' + src.length + ' 条）');
  return out;
}

/* ---------- 改写结果缓存（把「快速」真正做出来的那一步） ----------
 * 引擎的台词是从固定池子里抽的：同一剧本的线索文本、守秘人提示语、队友台词
 * 会在不同回合、不同团本之间反复出现。把这些「原文 → 改写文」缓存下来，
 * 命中时**完全不需要请求模型**（0 延迟），于是：
 *   - 冷启动一轮：一次请求，约 6–8 秒（免费端点常态）
 *   - 之后同一剧本的大部分回合：毫秒级返回
 * 副作用是正向的：同一条线索每次读到的措辞一致，不会「同一件事换个说法讲两遍」。
 * 同时同一批里的重复句子只请求一次。 */
const _rewriteCache = new Map();
const CACHE_MAX = Math.max(50, Number(process.env.AI_LLM_CACHE_MAX || 800));
function cacheGet(t) { return _rewriteCache.get(t); }
function cacheSet(src, out) {
  if (!src || !out || src === out) return;
  if (_rewriteCache.has(src)) _rewriteCache.delete(src);
  _rewriteCache.set(src, out);
  while (_rewriteCache.size > CACHE_MAX) {
    const k = _rewriteCache.keys().next().value;
    _rewriteCache.delete(k);
  }
}

/* ---------- 改写请求合并（性能与可靠性的关键） ----------
 * 为什么必须合并：实测这个免费端点延迟极不稳定 —— 同一批请求里会突然冒出
 * 20–30 秒的排队尖峰（3 次请求串行实测飙到 60 秒）。一轮 think 若拆成
 * 「KP 一次 + 每名队友一次」，命中尖峰的概率随请求数线性上升，一旦超过
 * AI_LLM_TIMEOUT_MS 就整轮回落 mock，文笔全白给。
 * 合并成一次请求后实测：1 次全量 ≈ 7.6 秒（内容未变时缓存命中 0.6 秒），
 * 且队友再多也只发一次。
 * 实现：同一轮里的改写登记到同一个批次，用 setImmediate 收口后一次性发出。 */
let _batch = null;
function queueRewrite(lines, facts) {
  const src = lines.map(t => String(t == null ? '' : t));
  if (!src.length) return Promise.resolve(src);
  if (!_batch) {
    _batch = { items: [], waiters: [], facts: null };
    setImmediate(() => flushRewriteBatch());
  }
  const b = _batch;
  const start = b.items.length;
  src.forEach(t => b.items.push(t));
  if (!b.facts) b.facts = facts;
  return new Promise((resolve, reject) => {
    b.waiters.push({ start, count: src.length, resolve, reject });
  });
}

async function flushRewriteBatch() {
  const b = _batch; _batch = null;
  if (!b) return;

  /* 1) 先看缓存：没命中的才需要发请求；同一批里重复的句子也只请求一次 */
  const miss = [];
  const seen = new Set();
  for (const t of b.items) {
    if (_rewriteCache.has(t) || seen.has(t)) continue;
    seen.add(t);
    miss.push(t);
  }

  let netErr = null;
  if (miss.length) {
    try {
      const got = await llmRewrite(miss, b.facts);
      miss.forEach((srcText, k) => cacheSet(srcText, got[k]));
    } catch (e) {
      netErr = e;
    }
  }

  const anyCached = b.items.some(t => _rewriteCache.has(t));
  /* 请求失败，且这一批里连一条缓存都没有 → 才是真的失败，交给上层回落 mock。
     否则用「缓存 + 引擎原句」兜底即可，没必要把已经拿到的文笔一起丢掉。 */
  if (netErr && !anyCached) {
    b.waiters.forEach(w => w.reject(netErr));
    return;
  }
  const resolved = b.items.map(t => cacheGet(t) || t);
  b.waiters.forEach(w => w.resolve(resolved.slice(w.start, w.start + w.count)));
}

/* KP：先让引擎定骨架，再让模型改措辞。skill / diff / clueIndex / resolution 一律沿用引擎的。 */
async function llmKpThink(ctx) {
  const base = kpThink(ctx);
  const pack = (ctx && ctx.pack) || {};
  const pub = pack.public || {};
  const texts = await queueRewrite(base.options.map(o => o.text), {
    剧本: base.scene.title,
    幕: base.scene.actTitle,
    当前节拍: base.scene.beatText,
    进度: Math.round((base.scene.progress || 0) * 100) + '%',
    氛围: base.mood,
    已交付线索: (pub.revealedClues || []).map(c => c.text),
    在场人物: pub.npcInScene || null,
    恐惧度: (pub.mood && pub.mood.dread) || 0,
    危险度: (pub.mood && pub.mood.danger) || 0
  });
  return Object.assign({}, base, {
    provider: 'llm',
    options: base.options.map((o, i) => Object.assign({}, o, { text: texts[i], draftedText: o.text }))
  });
}

/* 队友：同样只改措辞；三条台词的「果断 / 谨慎 / 自嘲」立场差异必须保住。
   弱模型容易把三条改写成同一句，这里做一次去重兜底。 */
async function llmMateThink(ctx) {
  const base = mateThink(ctx);
  const pub = ((ctx && ctx.pack) || {}).public || {};
  const texts = await queueRewrite(base.options.map(o => o.text), {
    剧本: base.scene.title,
    当前节拍: base.scene.beatText,
    队友: base.name + '（' + (base.occupation || '') + '）',
    氛围: base.mood,
    在场人物: pub.npcInScene || null
  });
  const seen = new Set();
  const options = base.options.map((o, i) => {
    let t = texts[i];
    if (seen.has(t)) t = o.text;          // 与其他立场撞车 → 退回引擎原句
    seen.add(t);
    const res = o.resolution ? Object.assign({}, o.resolution) : null;
    if (res && res.onSuccess === o.text) res.onSuccess = t;   // onSuccess 与正文保持一致
    return Object.assign({}, o, { text: t, draftedText: o.text, resolution: res });
  });
  return Object.assign({}, base, { provider: 'llm', options });
}

const providers = {
  mock: { name: 'mock', available: true, kpThink, mateThink },
  llm: { name: 'llm', available: false, kpThink: llmKpThink, mateThink: llmMateThink }
};
/* 读 AI_PROVIDER 时**必须 trim**：环境变量来源五花八门（systemd EnvironmentFile、
 * Windows 写的 CRLF 文件、带尾部空格的 shell export），一旦值是 "llm\r" 或 "llm "，
 * 匹配就会静默失败、服务悄悄退回 mock —— 而 endpooint/model 有 trim 所以完全看不出异常。
 * 这个坑真实发生过，别删。 */
function providerWant() {
  return String(process.env.AI_PROVIDER || 'mock').trim().toLowerCase();
}
function activeProvider() {
  const want = providerWant();
  /* 只要求 endpoint —— 免费免鉴权接口（如 Pollinations）没有 key 也要能跑，
     所以不再把 AI_LLM_KEY 设为必需项。 */
  const ok = want === 'llm' && llmReady();
  providers.llm.available = ok;
  return ok ? 'llm' : 'mock';
}

/* 生成一轮「思维 + 发言选项」。不写聊天室 —— 由前端/调用方决定采纳哪一条。 */
async function think(input) {
  const opts = input || {};
  const camp = opts.camp || {};
  const script = resolveScript(camp, opts.scenario);
  const st = ensureState(camp, script, { mates: opts.mates, mateCount: opts.mateCount });
  const intent = opts.intent || classifyIntent(opts.playerText);
  const res = advanceCursor(script, st, intent);
  /* NPC 出场必须在并发调用 provider 之前定好：否则 mateDecide 读到 st.npcInScene
     与否取决于微任务顺序，会出现「KP 已让 NPC 出场、队友却像没看见」的不一致。 */
  if (res.kind === 'talk' && script.content.npcs.length) {
    st.npcInScene = script.content.npcs[st.turns % script.content.npcs.length].name;
  }
  const pack = buildContextPack(script, st, { intent, onScript: res.onScript, playerText: opts.playerText, recentLog: opts.recentLog });
  const wantProvider = activeProvider();
  // 配了 llm 却缺配置（或调用失败）→ 回落 mock，并如实标注来源，前端可提示"当前为本地大脑"
  const degradedFrom = (wantProvider === 'mock' && providerWant() === 'llm') ? 'llm' : null;

  let kp = null, mates = [];
  let fellBack = false;
  const roles = opts.voices || ['kp', 'mate'];
  const t0 = Date.now();
  try {
    /* KP 与队友**并发**发起：这样才能让同一轮内的改写请求被合并成一次 HTTP 调用
       （见 queueRewrite 的说明）。顺序改为并发是安全的 —— 两者对 st 只写 npcInScene，
       而它已经在上面提前定好了。
       并发也带来一个竞态：其中一个失败时另一个可能稍后才落定。
       用 fellBack 拦住迟到的赋值，避免「KP 回落 mock、队友却是模型版」的混搭结果。 */
    const jobs = [];
    if (roles.includes('kp')) {
      jobs.push(Promise.resolve()
        .then(() => providers[wantProvider].kpThink({ script, st, res, pack, camp }))
        .then(v => { if (!fellBack) kp = v; }));
    }
    if (roles.includes('mate')) {
      jobs.push(Promise.resolve()
        .then(() => Promise.all((st.mates || []).map((m, i) =>
          providers[wantProvider].mateThink({ script, st, mate: m, index: i, res, pack, intent }))))
        .then(v => { if (!fellBack) mates = v; }));
    }
    await Promise.all(jobs);
  } catch (e) {
    fellBack = true;
    // 真实模型失败 → 回落 mock，并把原因回传，绝不把错误抛给玩家
    const fb = providers.mock;
    kp = roles.includes('kp') ? fb.kpThink({ script, st, res, pack, camp }) : null;
    mates = roles.includes('mate') ? (st.mates || []).map((m, i) => fb.mateThink({ script, st, mate: m, index: i, res, pack, intent })) : [];
    if (kp) kp.degradedFrom = wantProvider;
    mates.forEach(m => { m.degradedFrom = wantProvider; });
    lastLlmError = String(e && e.message || e);
    if (logger) logger('[ai] provider ' + wantProvider + ' failed → mock：' + lastLlmError);
  }
  const ms = Date.now() - t0;
  if (kp) { kp.provider = wantProvider; kp.degradedFrom = kp.degradedFrom || degradedFrom; }
  mates.forEach(m => { m.provider = wantProvider; m.degradedFrom = m.degradedFrom || degradedFrom; });

  /* 缓存本轮选项，供 /ai/say 采纳（避免前端回传整段文本被篡改/丢字段） */
  st.lastOptions = st.lastOptions || {};
  if (kp) st.lastOptions.kp = kp.options;
  mates.forEach((m, i) => { st.lastOptions['mate' + i] = m.options; });
  st.lastOptionsAt = Date.now();
  saveSessions();

  logUsage({ uid: opts.uid || null, campId: camp.id, voice: roles.join('+'), provider: wantProvider, ms, options: (kp ? kp.options.length : 0) + mates.reduce((n, m) => n + m.options.length, 0) });

  return {
    contract: CONTRACT, engine: ENGINE_VERSION,
    provider: wantProvider, degradedFrom,
    campId: camp.id, intent,
    script: { id: script.id, title: script.title, system: script.system, tags: script.tags, estimated: script.estimated, source: opts.scenario ? 'custom' : (script.estimated ? 'library' : 'generic') },
    scene: kp ? kp.scene : (mates[0] ? mates[0].scene : sceneOf(script, cursorOf(script, st))),
    mood: moodOf(st),
    scriptTrace: { onScript: res.onScript, advanced: res.advanced, forced: res.forced, streakBefore: res.streakBefore, beatKind: res.kind, before: res.before, after: res.after },
    kp, mates,
    ledger: ledgerOf(script, st),
    latencyMs: ms
  };
}

/* 采纳某条选项 → 生成可直接进聊天室的消息（不落库，由 index.js 决定广播） */
function adoptOption(voice, optionId, campId, fallbackText) {
  loadSessions();
  const st = sessions[campId];
  const key = String(voice || 'kp').startsWith('mate') ? String(voice) : 'kp';
  const list = (st && st.lastOptions && st.lastOptions[key]) || [];
  const found = optionId ? list.find(o => o.id === optionId) : null;
  const text = String((found && found.text) || fallbackText || '').slice(0, 1200);
  if (!text) return null;
  return {
    optionId: found ? found.id : null,
    kind: found ? found.kind : 'free',
    skill: found ? found.skill : null,
    diff: found ? (found.diff || 'reg') : null,
    clueIndex: found && typeof found.clueIndex === 'number' ? found.clueIndex : null,
    resolution: found ? found.resolution : null,
    text
  };
}
/* 线索记账：三线索法则的计数来源。
 * clueIndex 由 /ai/say 采纳 clue 类选项时带下来，指向剧本线索池里的第几条；
 * 没有 clueIndex（NPC 反应、自由输入）只记流水，不占「已交付线索」额度。 */
function recordDrawnClue(campId, clueText, clueIndex) {
  loadSessions();
  const st = sessions[campId]; if (!st) return;
  st.clueIdsDrawn = st.clueIdsDrawn || [];
  if (typeof clueIndex === 'number' && !st.clueIdsDrawn.includes(clueIndex)) st.clueIdsDrawn.push(clueIndex);
  st.ledger = st.ledger || [];
  st.ledger.push({ turn: st.turns, at: Date.now(), clueIndex: typeof clueIndex === 'number' ? clueIndex : null, text: String(clueText || '').slice(0, 300) });
  if (st.ledger.length > 60) st.ledger.shift();
  saveSessions();
}

/* ============================ 12. 限流与计量（网关必备） ============================ */
const quota = {};
const DAILY_LIMIT = () => Math.max(10, parseInt(process.env.AI_DAILY_CALLS || '300', 10));
function dayKey() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function checkQuota(uid) {
  const key = String(uid || 'anon');
  const day = dayKey();
  const rec = quota[key];
  if (!rec || rec.day !== day) { quota[key] = { day, count: 0 }; return { ok: true, used: 0, limit: DAILY_LIMIT() }; }
  if (rec.count >= DAILY_LIMIT()) return { ok: false, used: rec.count, limit: DAILY_LIMIT() };
  return { ok: true, used: rec.count, limit: DAILY_LIMIT() };
}
function consumeQuota(uid) {
  const q = checkQuota(uid);
  if (!q.ok) return q;
  quota[String(uid || 'anon')].count++;
  return { ok: true, used: quota[String(uid || 'anon')].count, limit: DAILY_LIMIT() };
}
function logUsage(rec) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(USAGE_PATH(), JSON.stringify(Object.assign({ ts: Date.now() }, rec)) + '\n');
  } catch (e) {}
}
function usageSnapshot() { return { day: dayKey(), limit: DAILY_LIMIT(), users: Object.keys(quota).length, provider: activeProvider() }; }
/* 运维视图：当前 provider 形态与最近一次失败原因（不含任何密钥） */
function aiHealth() {
  const c = llmCfg();
  return {
    provider: activeProvider(),
    contract: CONTRACT,
    engine: ENGINE_VERSION,
    llm: {
      configured: !!c.endpoint,
      endpointHost: c.endpoint ? String(c.endpoint).replace(/^https?:\/\//, '').split('/')[0] : null,
      model: c.model,
      hasKey: !!c.key,
      timeoutMs: c.timeoutMs,
      reasoningEffort: c.effort
    },
    cache: { size: _rewriteCache.size, max: CACHE_MAX },
    lastError: lastLlmError
  };
}

module.exports = {
  CONTRACT, ENGINE_VERSION, init,
  classifyIntent, beatKind, KIND_INTENT, DRIVER_KINDS,
  resolveScript, cursorOf, buildContextPack, SCRIPT_BANK, GENERIC, MATE_POOL, MATE_LINES, MATE_FLAVOR, MATE_LINES_CLASS, matePools,
  /* 供「职业表同构」不变式测试使用：这五张表只要有一张漏了职业，队友就会被换人或说错话 */
  MATE_OCC_CLASS, MATE_CLASS_DEFAULT, mateClass, MATE_INVESTIGATIVE,
  getState, resetState, startSession, ensureState,
  think, adoptOption, recordDrawnClue,
  providers, activeProvider, llmCfg, llmReady, aiHealth,
  checkQuota, consumeQuota, logUsage, usageSnapshot,
  _internal: {
    buildScriptContent, ledgerOf, nextClue, advanceCursor, blankState, defaultMates, saveSessionsNow,
    /* 会话剪枝策略：单测用，可显式传 keepEnded / graceMs 覆盖默认值 */
    pruneSessions,
    /* 改写缓存（供自检断言用） */
    rewriteCache: { get: cacheGet, set: cacheSet, size: () => _rewriteCache.size, clear: () => _rewriteCache.clear() }
  }
};
