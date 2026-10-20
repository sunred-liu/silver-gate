/* 银之门 · 剧本库（20 个）
 * COC 7e：平均游玩 20 分钟 ~ 10 小时
 * DND 5e：平均游玩 2 小时 ~ 10 小时
 * 规则：estimated_minutes > 600（10 小时）的剧本 completion_type='open'，
 *      即 10 小时后不再强制完本，由玩家自主选择退出。
 */
'use strict';

const COC = 'coc';
const DND = 'dnd';

const SCENARIOS = [
  /* ===================== COC 7e ===================== */
  {
    id: 'SCN-COC-01', system: COC, title: '雨夜来电', estimated_minutes: 20, hard_cap_hours: null, completion_type: 'required',
    tagline: '一通午夜电话，揭开一桩邻里失踪案。',
    premise: '调查员们在公寓中接到陌生号码的求救，线索指向同楼层的空置套房。30 分钟内必须决定是否破门而入。',
    structure: [
      { title: '第一幕 · 来电', beats: ['午夜电话响起', '邻里排查', '发现空置套房异响'] },
      { title: '第二幕 · 破门', beats: ['检查门锁', '1d100 灵巧/力量', '揭露被困者或虚惊'] }
    ],
    tags: ['新手', '都市', '短篇', '无战斗'],
    content: '适合 1–3 名调查员的新手教学本。重点体验「调查—检定—真相」节奏，无需战斗。SAN 检定上限低，红线建议允许死亡=否。'
  },
  {
    id: 'SCN-COC-02', system: COC, title: '阁楼里的低语', estimated_minutes: 40, hard_cap_hours: null, completion_type: 'required',
    tagline: '老宅阁楼传来不属于任何人的呼吸声。',
    premise: '继承祖宅的调查员在整理遗物时，阁楼持续传出低语。线索指向一封被焚毁一半的信与地窖的奇怪符号。',
    structure: [
      { title: '第一幕 · 异响', beats: ['祖宅夜探', '聆听检定', '发现半焚信'] },
      { title: '第二幕 · 符号', beats: ['辨识符号(神秘学)', '地窖探索', '召唤物雏形'] },
      { title: '第三幕 · 抉择', beats: ['封印或驱散', 'SAN 结算', '结局分支'] }
    ],
    tags: ['新手', '灵异', '家庭', '单人友好'],
    content: '强调氛围营造与知识技能（神秘学/图书馆使用）。可在 40 分钟内完本，建议单场 SAN 上限 1d6。'
  },
  {
    id: 'SCN-COC-03', system: COC, title: '旧港谜案', estimated_minutes: 60, hard_cap_hours: null, completion_type: 'required',
    tagline: '渔港浮起一具没有脸的尸体。',
    premise: '海岸警长委托调查员查明无脸尸体身份。走访码头、档案室与走私者，拼出一段被掩埋的献祭仪式。',
    structure: [
      { title: '第一幕 · 验尸', beats: ['医学检定', '提取 tattoo 线索'] },
      { title: '第二幕 · 走访', beats: ['码头打听(话术)', '档案室检索', '走私者对峙'] },
      { title: '第三幕 · 仪式场', beats: ['潜入船坞', '阻止/目击仪式', 'SAN 结算'] }
    ],
    tags: ['推理', '海港', '中篇'],
    content: '经典调查闭环。可使用「线索链」记录：尸体→tattoo→走私网络→船坞仪式。战斗可选。'
  },
  {
    id: 'SCN-COC-04', system: COC, title: '博物馆失窃之夜', estimated_minutes: 90, hard_cap_hours: null, completion_type: 'required',
    tagline: '闭馆后，一尊古埃及猫神像自行挪动了位置。',
    premise: '博物馆夜班保安失踪，猫神像偏离展台三寸。调查员受馆方委托彻夜排查，揭开镇馆之物背后的活体崇拜。',
    structure: [
      { title: '第一幕 · 闭馆', beats: ['安保系统排查', '监控回溯', '发现爪痕'] },
      { title: '第二幕 · 地下', beats: ['密道探索', '图书馆使用(埃及神话)', '遭遇守夜之物'] },
      { title: '第三幕 · 真相', beats: ['信徒身份', '猫神苏醒', 'SAN/战斗结算'] }
    ],
    tags: ['都市', '博物馆', '中篇', '轻度战斗'],
    content: '适合 3–4 人。引入临时疯狂阈值（单场景 SAN 损失≥5）。可结合「命运残片」掉落。'
  },
  {
    id: 'SCN-COC-05', system: COC, title: '沼泽女巫', estimated_minutes: 120, hard_cap_hours: null, completion_type: 'required',
    tagline: '村庄把病孩送进沼泽，再没回来。',
    premise: '偏远村落世代向沼泽献祭以换平安。调查员受失踪家庭委托深入沼泽，遇见亦正亦邪的「女巫」，并发现沼泽之下的古老存在。',
    structure: [
      { title: '第一幕 · 进村', beats: ['村民戒备', '话术/威吓', '得知献祭习俗'] },
      { title: '第二幕 · 沼泽', beats: ['野外生存检定', '迷雾迷路', '女巫小屋'] },
      { title: '第三幕 · 沼泽之心', beats: ['信仰对峙', '古老存在低语', '救人或灭口'] },
      { title: '第四幕 · 归途', beats: ['SAN 结算', '命运残片', '村庄命运'] }
    ],
    tags: ['民俗', '乡村', '长篇', '道德抉择'],
    content: '探讨「恐惧 vs 理解」。女巫非单纯反派。建议 hard_cap 不适用，2 小时内可完本。'
  },
  {
    id: 'SCN-COC-06', system: COC, title: '列车惊魂', estimated_minutes: 180, hard_cap_hours: null, completion_type: 'required',
    tagline: '开往北方的夜车，每停一站就少一个人。',
    premise: '调查员搭乘豪华夜车调查一桩遗产失踪案，却发现乘客接连在隧道中消失。车厢即封闭舞台，真相藏在餐车老板身上。',
    structure: [
      { title: '第一幕 · 登车', beats: ['乘客画像', '餐车初遇', '首桩消失'] },
      { title: '第二幕 · 车厢', beats: ['逐节搜查', '追踪检定', '密室线索'] },
      { title: '第三幕 · 隧道', beats: ['停车探查', '遭遇', 'SAN/战斗'] },
      { title: '第四幕 · 终点', beats: ['老板真身', '抉择', '结算'] }
    ],
    tags: ['封闭空间', '悬疑', '长篇'],
    content: '密室推理 + 限时压力。可用「先攻/回合」简化战斗。建议 3–5 人。'
  },
  {
    id: 'SCN-COC-07', system: COC, title: '灯塔守夜人', estimated_minutes: 240, hard_cap_hours: null, completion_type: 'required',
    tagline: '灯塔每隔七夜熄灭一次，岸边便多出一座新坟。',
    premise: '临海灯塔连续七次无故熄灭，每次都伴随渔民死亡。调查员接替守夜，揭开灯塔地基下被封印的「深潜者信标」。',
    structure: [
      { title: '第一幕 · 接任', beats: ['前任守夜人日记', '灯塔结构', '首次熄灭'] },
      { title: '第二幕 · 潮汐', beats: ['海岸调查', '神秘学', '潜入礁穴'] },
      { title: '第三幕 · 信标', beats: ['封印松动', '深潜者接触', 'SAN 考验'] },
      { title: '第四幕 · 重燃', beats: ['重启或摧毁灯塔', '战斗', '长期影响'] }
    ],
    tags: ['海洋', '克苏鲁', '长篇', '多会话'],
    content: '可拆为 2 个 2 小时会话。引入长期疯狂（单场景 SAN 损失≥5 追加）。'
  },
  {
    id: 'SCN-COC-08', system: COC, title: '1899 档案', estimated_minutes: 300, hard_cap_hours: null, completion_type: 'required',
    tagline: '一份被三个部门同时封存的旧案卷宗。',
    premise: '调查员受档案馆委托整理 1899 年未结案卷，却牵出跨越三代的邪教网络与一场被抹去的瘟疫。',
    structure: [
      { title: '第一幕 · 归档', beats: ['卷宗梳理', '图书馆使用', '发现涂黑页'] },
      { title: '第二幕 · 三代', beats: ['走访后裔', '话术/追踪', '地下印刷所'] },
      { title: '第三幕 · 瘟疫', beats: ['医学/科学检定', '废弃医院', '样本异变'] },
      { title: '第四幕 · 网络', beats: ['邪教集会', '潜入', 'SAN/战斗'] },
      { title: '第五幕 · 封存', beats: ['抉择', '结算', '命运残片'] }
    ],
    tags: ['档案', '历史', '阴谋', '多会话'],
    content: '适合 4–5 人长线。强调「知识即武器」。可分 2–3 次游玩。'
  },
  {
    id: 'SCN-COC-09', system: COC, title: '深渊来信', estimated_minutes: 360, hard_cap_hours: null, completion_type: 'required',
    tagline: '一封从海沟寄出的信，署名是你已故的同事。',
    premise: '海洋研究所收到来自马里亚纳海沟的实体信件。调查员随科考船下潜，发现一座不应存在的城市与仍在「写信」的存在。',
    structure: [
      { title: '第一幕 · 来信', beats: ['笔迹鉴定', '研究所档案', '启航'] },
      { title: '第二幕 · 科考船', beats: ['船员异状', '侦测隐藏', '风暴夜'] },
      { title: '第三幕 · 下潜', beats: ['潜水检定', '城市轮廓', '低语'] },
      { title: '第四幕 · 城市', beats: ['非人居民', 'SAN 重创', '真相'] },
      { title: '第五幕 · 上浮', beats: ['取舍', '结算', '残片'] }
    ],
    tags: ['深海', '科幻', '克苏鲁', '多会话'],
    content: '宏大设定，建议分 3 次。深渊存在使用「不可名状」描述，避免直述。'
  },
  {
    id: 'SCN-COC-10', system: COC, title: '银钥档案室', estimated_minutes: 480, hard_cap_hours: null, completion_type: 'open',
    tagline: '一座只在午夜现身的图书馆，收藏着你自己的未来。',
    premise: '调查员误入「银钥档案室」——一座记录所有可能性之书的图书馆。每翻开一卷，现实便微妙偏移。八小时内能否找到离开的钥匙？',
    structure: [
      { title: '第一幕 · 入馆', beats: ['书架迷宫', '自我之书', '守阁人'] },
      { title: '第二幕 · 卷宗', beats: ['检索未来', '神秘学', '现实偏移'] },
      { title: '第三幕 · 镜厅', beats: ['平行自我', 'SAN 动摇', '抉择'] },
      { title: '第四幕 · 钥匙', beats: ['银钥线索', '战斗/智取', '出口'] },
      { title: '第五幕 · 离馆', beats: ['代价', '结算', '残片'] }
    ],
    tags: ['meta', '图书馆', '超长篇', '开放'],
    content: 'open 完本：8 小时内未找到银钥也可随时退出，系统按当前进度整理战报。鼓励多分支。'
  },
  {
    id: 'SCN-COC-11', system: COC, title: '星之眷族', estimated_minutes: 600, hard_cap_hours: 10, completion_type: 'open',
    tagline: '当群星归位，沉睡者将认得你。',
    premise: '一个跨越四季的仪式正在小镇上空汇聚。调查员需在十次月相内阻止「星之眷族」降临，否则世界被 rewriting。',
    structure: [
      { title: '序章 · 征兆', beats: ['异常天象', '学者会面', '首个信徒'] },
      { title: '第一章 · 追寻', beats: ['古籍三卷', '三处圣地', 'SAN 累积'] },
      { title: '第二章 · 分裂', beats: ['镇民倒戈', '内战', '战斗'] },
      { title: '第三章 · 归位', beats: ['群星仪式', '最终对峙', '结局分支'] }
    ],
    tags: ['史诗', '仪式', '四季', '开放', '10h+'],
    content: '10 小时上限，open 完本。十小时后玩家可自主退出，系统整理当前进度战报。适合固定团。'
  },
  {
    id: 'SCN-COC-12', system: COC, title: '无限图书馆', estimated_minutes: 600, hard_cap_hours: 10, completion_type: 'open',
    tagline: '每一本书都是一扇门，每一扇门后都是另一个你。',
    premise: '沙盒式调查：调查员在无限图书馆中自由探索，自行设定目标（寻人/寻书/逃出）。无强制主线，由 KP 与玩家共创。',
    structure: [
      { title: '自由探索', beats: ['选书=开门', '生成子场景', 'KP 即兴'] },
      { title: '目标驱动', beats: ['玩家提案', '难度裁定', 'SAN/成长'] },
      { title: '随时退出', beats: ['玩家选择离开', '系统结算战报'] }
    ],
    tags: ['沙盒', '生成式', '开放', '10h+', '无主线'],
    content: '纯沙盒，无既定完本条件。10 小时后或玩家主动退出即结算。适合创意团。'
  },

  /* ===================== DND 5e ===================== */
  {
    id: 'SCN-DND-01', system: DND, title: '哥布林矿坑', estimated_minutes: 120, hard_cap_hours: null, completion_type: 'required',
    tagline: '村庄的铁矿被哥布林占了个干净。',
    premise: '冒险者受镇长委托夺回被哥布林占据的废弃矿坑。清理下层、救出矿工、击败矿坑之主。',
    structure: [
      { title: '第一幕 · 矿口', beats: ['外围哨探', ' stealth/突袭', '清剿守卫'] },
      { title: '第二幕 · 坑道', beats: ['陷阱察觉', '救出矿工', '支线宝箱'] },
      { title: '第三幕 · 坑主', beats: ['BOSS 战(先攻/回合)', '战利品', '回村'] }
    ],
    tags: ['新手', '地城', '战斗', '短篇'],
    content: '经典入门地城。教学 d20 检定 + 先攻回合制。建议 1–2 级，3–4 人。'
  },
  {
    id: 'SCN-DND-02', system: DND, title: '被遗忘的神庙', estimated_minutes: 180, hard_cap_hours: null, completion_type: 'required',
    tagline: '丛林深处，一座会移动的神庙。',
    premise: '学者委托冒险者测绘一座周期性位移的废墟神庙，里面沉睡着被封印的邪物与古代财富。',
    structure: [
      { title: '第一幕 · 丛林', beats: ['生存/自然', '定位神庙', '入口机关'] },
      { title: '第二幕 · 厅堂', beats: ['解谜', '雕像守卫战', '铭文'] },
      { title: '第三幕 · 圣所', beats: ['封印松动', '抉择(取宝/加固)', '遭遇'] }
    ],
    tags: ['探索', '解谜', '丛林', '中篇'],
    content: '探索 + 解谜为主，战斗适中。可用「调查检定」替代纯战斗。'
  },
  {
    id: 'SCN-DND-03', system: DND, title: '迷雾港湾', estimated_minutes: 240, hard_cap_hours: null, completion_type: 'required',
    tagline: '永不散去的雾里，船只进得去出不来。',
    premise: '港口城镇被诡异迷雾笼罩，商船接连失联。冒险者受商会委托查明雾源，揭开海妖与沉船契约。',
    structure: [
      { title: '第一幕 · 港湾', beats: ['市民访谈', '侦查', '雾中征兆'] },
      { title: '第二幕 · 沉船', beats: ['潜水/航行', '幽灵船员战', '契约卷轴'] },
      { title: '第三幕 · 雾眼', beats: ['海妖巢穴', 'BOSS 战', '驱散'] }
    ],
    tags: ['海港', '悬疑', '长篇', '多会话'],
    content: '可分 2 个 2 小时会话。鼓励角色扮演（话术检定）。'
  },
  {
    id: 'SCN-DND-04', system: DND, title: '龙骨荒野', estimated_minutes: 300, hard_cap_hours: null, completion_type: 'required',
    tagline: '巨龙尸骨铺成的荒原，藏着龙裔的遗产。',
    premise: '传说龙骨荒野下埋着上古龙裔的宝库与诅咒。冒险者穿越荒原，对抗盗墓者与不死龙仆。',
    structure: [
      { title: '第一幕 · 荒原', beats: ['求生', '龙骨地标', '盗墓者 confrontation'] },
      { title: '第二幕 · 墓穴', beats: ['机关/解谜', '不死龙仆战', '咒文'] },
      { title: '第三幕 · 宝库', beats: ['遗产抉择', '诅咒触发', '逃脱'] }
    ],
    tags: ['荒野', '龙', '冒险', '多会话'],
    content: '适合 4–6 级。XP 升级节奏：完本约 +1 级。'
  },
  {
    id: 'SCN-DND-05', system: DND, title: '破碎王冠', estimated_minutes: 360, hard_cap_hours: null, completion_type: 'required',
    tagline: '王国分裂成七块，王冠碎片散落四方。',
    premise: '老王崩逝，七位领主各执一碎片。冒险者受合法继承人委托，收集碎片、平定叛乱、加冕新王。',
    structure: [
      { title: '第一幕 · 诏书', beats: ['宫廷会谈', '政治检定', '首块碎片'] },
      { title: '第二幕 · 四方', beats: ['四领主任务线', '外交/战斗', '联盟'] },
      { title: '第三幕 · 叛乱', beats: ['叛军决战', '攻城', 'BOSS'] },
      { title: '第四幕 · 加冕', beats: ['王冠重铸', '结局', '奖励'] }
    ],
    tags: ['政治', '史诗', '多会话', ' branching'],
    content: '非线性主线，四领主线可并行。建议分 3 次。'
  },
  {
    id: 'SCN-DND-06', system: DND, title: '深渊之门', estimated_minutes: 480, hard_cap_hours: null, completion_type: 'open',
    tagline: '封印正在龟裂，门后是第一层炼狱。',
    premise: '一座古神殿的封印被邪教徒破坏，深渊之门缓缓开启。冒险者需在八小时内集齐三把钥石并重封，否则魔潮涌出。',
    structure: [
      { title: '第一幕 · 告急', beats: ['神殿勘察', '邪教踪迹', '首钥石'] },
      { title: '第二幕 · 三钥', beats: ['三支线地城', '战斗/解谜', '魔物渗透'] },
      { title: '第三幕 · 重封', beats: ['门前的决战', '仪式检定', '结局'] }
    ],
    tags: ['恶魔', '史诗', '开放', '超长篇'],
    content: 'open 完本：8 小时未集齐钥匙也可退出，按进度结算战报。高强度战斗。'
  },
  {
    id: 'SCN-DND-07', system: DND, title: '巨龙苏醒', estimated_minutes: 600, hard_cap_hours: 10, completion_type: 'open',
    tagline: '沉睡千年的太古龙，被你的脚步惊醒。',
    premise: '冒险者探寻太古龙遗迹，却意外唤醒巨龙。十小时内需在「屠龙」「结盟」「逃离」间抉择，世界格局随之改变。',
    structure: [
      { title: '序章 · 遗迹', beats: ['机关', '龙语铭文', '误触'] },
      { title: '第一章 · 苏醒', beats: ['龙威(豁免)', '逃亡', '召集同盟'] },
      { title: '第二章 · 抉择', beats: ['三路线', '大规模战', '龙之试炼'] },
      { title: '第三章 · 终局', beats: ['屠龙/结盟/逃离', '结算'] }
    ],
    tags: ['巨龙', '史诗', '开放', '10h+'],
    content: '10 小时上限，open 完本。十小时后玩家可自主退出，系统整理当前进度战报。'
  },
  {
    id: 'SCN-DND-08', system: DND, title: '多元宇宙裂隙', estimated_minutes: 600, hard_cap_hours: 10, completion_type: 'open',
    tagline: '裂隙每开一次，就多一个你们从未见过的世界。',
    premise: '沙盒式冒险：冒险者在不断扩张的位面裂隙中自由探索，自行设定目标（寻宝/封印/征服）。无强制主线。',
    structure: [
      { title: '自由探索', beats: ['跃迁位面', '生成子场景', 'DM 即兴'] },
      { title: '目标驱动', beats: ['玩家提案', '难度裁定', 'XP/战利品'] },
      { title: '随时退出', beats: ['玩家选择离开', '系统结算战报'] }
    ],
    tags: ['沙盒', '位面', '开放', '10h+', '无主线'],
    content: '纯沙盒，无既定完本条件。10 小时后或玩家主动退出即结算。'
  }
];

module.exports = { SCENARIOS };
