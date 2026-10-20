/*
 * m4-content —— 内容（内置剧本 / 本地剧本库 / 浏览筛选）
 * 覆盖：内置可玩剧本常量 → 本地剧本数据库（localStorage）→ module library 筛选浏览。
 * 注意：账号/落盘类基础设施（loadApp / APP / saveApp / me / CUR_CAMP 及账号态变量）与
 *       renderMessages / renderBeian / renderMe 物理上紧邻本模块段落，但语义不属于「内容」
 *       （它们被 18+ 个段引用），圈进来会让 m0-core 反过来依赖本模块 —— 故**留在骨架里**，
 *       等 M5 net / M8 app 批次再迁。
 * 本文件是 www/index.html 的**源码**，不是产物。
 * 分块哨兵以 "@@ m4-content:<id> @@" 形式的注释行分隔，会被 coc-apk/build.js 识别；
 * 哨兵行本身不进入产物，块体按哨兵出现顺序内联回产物的对应位置。
 * （头注释里刻意不写出哨兵的完整字面量 —— 那个字面量自带注释结束符，会把本段注释提前闭合。）
 */
/*@@ m4-content:scenarios @@*/
/* ---------- 内置可玩剧本（原创，改编自公有领域洛夫克拉夫特神话；完全离线、无需跳转外站） ---------- */
const BUNDLED_SCENARIOS=[
  {id:'b1',name:'退潮',en:'The Ebb',system:'COC',act:'免费模组',free:true,bundled:true,genre:'mythos',gm:'（原创 · 改编自《达贡》）',era:'1920s · 新英格兰海岸',players:'2-4 人',duration:'单次 3-4 小时',level:'新手入门',
    synopsis:'一艘货轮在浓雾中失事，唯一的幸存调查员漂流到一片不该存在的泥滩，那里矗立着一座被潮水半埋的古老石祭坛……',
    script:[
      {h:'守秘人须知',t:'本模组改编自公有领域的洛夫克拉夫特短篇小说《达贡》(1919)。基调是「孤绝与渺小」：调查员面对的是远比人类古老的造物，武力几乎无用，真相本身就是恐怖。建议把节奏放慢，多用环境描写——咸腥、淤泥、远处不自然的拍打声。SAN 损失集中在终幕。适合 1 名新守秘人带 2-4 名新玩家。'},
      {h:'背景时间线',t:'约一万年前，深海的远古者在大陆架立起祭坛，向沉眠的达贡祈雨。后来海水退去，祭坛被淤泥掩埋。1926 年秋，一场不寻常的大潮重新露出祭坛。镇上老渔夫以撒认出石上的浮雕，开始半夜里往滩上搬祭品。本月他失踪了。'},
      {h:'玩家开场白',t:'你们的货轮海鸦号在浓雾中触礁。醒来时，你趴在一片灰白泥滩上，四周是半埋的朽木与一艘已不见踪影的船。咸风里有一股腐烂的甜腥。远处，一道比人还高的黑色轮廓立在淤泥中，像被潮水吐出的墓碑。你只剩随身的东西，和逐渐退去的头疼。'},
      {h:'第一幕 · 泥滩',t:'调查员沿泥滩前行，发现：① 以撒的小船缆在木桩上，舱里有半本被海水泡烂的日记，记着它们从门里上来；② 祭坛基座刻满鱼鳃与巨口的浮雕，触摸者过 SAN 0/1d4；③ 滩上散落近期的人类脚印，通向海的方向。若调查员在退潮时挖开祭坛底部，找到一枚刻字的青铜鱼符（后续线索）。'},
      {h:'第二幕 · 渔村',t:'回到最近的渔村盐角，村民对以撒之死三缄其口。调查员可：① 在酒馆套话，得知以撒死前总念叨达贡醒了；② 潜入以撒小屋，发现墙后藏着的湿漉漉鳞片与一本抄写的邪教祷文；③ 夜探滩涂，撞见三名用蹼手搬运祭品的鱼人混血。混血者不会主动攻击，但若被追击会逃向海中拱门。'},
      {h:'第三幕 · 珊瑚拱门',t:'追随混血者来到滩外一座天然珊瑚拱门。水下有台阶通向半淹没的祭室，中央石台上达贡的浮雕正随潮水起伏呼吸。若调查员破坏鱼符或推倒浮雕，会引发小规模海水倒灌与 1d4 只深潜者幼体涌出（战斗可选）。若放任，潮水将在黎明重新掩埋一切，镇子暂时平安——但达贡记下了你们。'},
      {h:'关键 NPC',t:'以撒(已故)：老渔夫，被 cult 视为先知。\n玛莎：以撒之女，怕海，知道父亲夜出但瞒着镇上。\n老霍洛韦：酒馆老板，消息灵通，可用请一杯酒换出传闻。\n深潜者混血×3：敏捷高、力气大，水下如鱼，陆上笨拙，无谈判意愿。'},
      {h:'神话生物',t:'深潜者幼体 ×1d4：HP 10，爪 40%，伤害 1d6；水下移动极快，畏惧火与强光。\n达贡(浮雕化身)：本模组不直接交战。若终幕激怒，仅以海水倒灌加幼体涌出制造压力，守秘人可按需让调查员乘船撤离。'},
      {h:'结局与新线索',t:'无论成败，把青铜鱼符留作后续钩子：上面刻着伊波恩之环字样，可引出更大的深海系列。成功封印祭坛的调查员各 +1D6 SAN；目睹达贡呼吸者 -1D6 SAN。'},
      {h:'给新守秘人的提示',t:'这个模组的重点不是打赢，而是看见不该看见的。不要把鱼人写成必须消灭的怪物；让玩家自己决定是调查、逃离还是封印。环境音（海浪、远处拍击）比战斗更吓人。'}
    ]},
  {id:'b2',name:'灰烬之田',en:'The Ashen Field',system:'COC',act:'免费模组',free:true,bundled:true,genre:'mythos',gm:'（原创 · 改编自《星之色》）',era:'1920s · 阿卡姆郊外农场',players:'3-4 人',duration:'单次 4-5 小时',level:'新手 · 慢热',
    synopsis:'州政府要建水库，征用了加德纳家的农场。调查员受委托评估地块，却发现田里寸草不生、井水发甜、夜空偶尔浮起一团会移动的灰光。',
    script:[
      {h:'守秘人须知',t:'改编自公有领域短篇《星之色》(1927)。核心是缓慢侵蚀：恐怖不是突然的，而是田地枯死、家人异变、最后连调查员自己也开始闻见那股甜味。建议用三幕推进，每幕间隔几天，让玩家感受时间流逝。SAN 损失分散且累积。'},
      {h:'背景时间线',t:'约两年前，一颗陨石坠入加德纳农场的水井旁，留下一团会随月光变换颜色的灰烬。它渗进井水、作物与家畜。一年前加德纳一家开始失眠、皮肤发灰、陆续失踪。如今州政府要建水库，农场将被淹，委托调查员出具地块安全评估。'},
      {h:'第一幕 · 评估',t:'调查员抵达农场：① 井水取样有淡淡的甜味与金属感，饮下者当夜做关于灰色田野的梦(-0/1 SAN)；② 田里作物矮小发灰，土壤下埋着未燃尽的陨石碎屑，夜间泛微光；③ 邻居透露加德纳家一个个走了，没办丧事。若调查员在日落后留宿，会看见那团颜色从井里升起、缓缓飘过屋顶。'},
      {h:'第二幕 · 宅邸',t:'入夜后探查主屋：① 阁楼锁着，里面是最后一名家人——半灰化、喃喃它从井里看我的老妇(可对话，提供别喝井水线索)；② 地窖有祭坛状的水洼，水面倒映的不是调查员，而是一颗巨大的灰色眼；③ 翻找日记得知陨石来自天外之色，触碰井壁者逐渐被动同化。'},
      {h:'第三幕 · 同化',t:'若调查员喝下井水或长时间滞留，开始 SAN 流失并出现灰斑(每幕 -1D4 SAN，可检定对抗)。终幕选择：① 填井封土——灰烬缩回地下，农场暂时平静，但水库计划搁置；② 取水样本送检——引出官方掩盖与后续天外之色系列；③ 放任——数日后农场彻底消失，只留一圈灰圈。'},
      {h:'关键 NPC',t:'老妇艾比：最后幸存者，半同化，可提供关键线索但无法离开。\n佃农托马斯：邻地农人，怕事但贪财，可用钱换情报。\n州测量员霍顿：催促评估，不知真相，可作为官方线引出后续。'},
      {h:'神话生物',t:'天外之色(灰烬)：非实体，HP 无。接触井水/土壤者缓慢同化；强光与火可短暂驱散地表色雾。\n同化农人×2：前家人，无理智，会试图把调查员拖向井口，徒手伤害 1d4。'},
      {h:'结局与新线索',t:'带走井水样本可解锁后续模组《天外之色·续》：实验室发现样本在生长。封井成功者各 +1D6 SAN；被同化(灰斑)者需后续治疗，否则永久 -5 上限 SAN。'},
      {h:'给新守秘人的提示',t:'慢热是精髓。第一幕几乎无事发生，靠氛围和异常细节吓人。别急着放怪物——让不对劲自己生长。如果玩家想硬刚，提醒他们敌人是一片颜色。'}
    ]},
  {id:'b3',name:'珊瑚之门',en:'The Coral Gate',system:'COC',act:'免费模组',free:true,bundled:true,genre:'mythos',gm:'（原创 · 改编自《印斯茅斯疑云》）',era:'1920s · 渔镇印斯茅斯',players:'4-5 人',duration:'1-2 次 · 约 8 小时',level:'经典入门',
    synopsis:'调查员为追查一枚失窃的珊瑚胸针来到与世隔绝的渔镇，镇民眼神浑浊、气味腥臭，而码头尽头的珊瑚拱门下，似乎有什么在等待献祭。',
    script:[
      {h:'守秘人须知',t:'改编自公有领域中篇《印斯茅斯疑云》(1931)。这是最经典的 COC 入门长篇之一，结构清晰：进城、察觉异常、追查、地下真相、抉择。基调是血统与背叛。建议分 1-2 次进行，给玩家充分探索城镇。SAN 损失在终幕。'},
      {h:'背景时间线',t:'19 世纪，渔镇印斯茅斯靠走私暴富，后与深潜者立约：以金饰与祭品换渔获，并让镇民与深潜者通婚。一代代混血，镇民越来越像鱼。如今镇子与世隔绝，仅余老弱与治安官马什一族。调查员追查的珊瑚胸针，来自马什家的私藏。'},
      {h:'第一幕 · 入镇',t:'调查员乘班车抵达，立刻察觉：街道空荡、人人戴宽檐帽遮脸、空气腥臭。可在吉尔曼旅店落脚，老板神色慌张；逛镇上唯一的金店，老板是混血，胸针就藏在柜台后；夜探码头，听见水下传来合唱般的嗡鸣。若被人认出是外乡人，会开始被暗中尾随。'},
      {h:'第二幕 · 追查',t:'线索指向：① 镇史馆的档案，记载 1812 年与海中立约；② 废弃的埃斯教堂，地下室有通往海水的暗道；③ 马什宅邸——镇上唯一亮灯的房子，治安官马什在此。强行闯入会被混血家丁拦截(战斗可选)。胸针的真正主人是马什之女，她已归海。'},
      {h:'第三幕 · 珊瑚拱门',t:'地道尽头是镇外礁石上的珊瑚拱门，门后水下是深潜者之城。终幕抉择：① 夺回胸针、逃离印斯茅斯(各 +1D6 SAN，但镇子记住你)；② 目睹/参与祭典，看见马什父女入海(目击者 -1D6 SAN)；③ 被认出混血血统的调查员面临是否归海的诱惑(可设计个人线)。若报警炸镇，会引来军方与后续封镇系列。'},
      {h:'关键 NPC',t:'治安官马什：镇上实权者，资深混血，礼貌而危险，守护秘密。\n店主齐利亚：金店老板，半混血，贪财，可被收买吐露胸针来源。\n老聋妇：旅店清洁工，唯一敢低声说别待到天黑的人。\n深潜者眷族×若干：水下战士，陆上迟缓，终幕守护拱门。'},
      {h:'神话生物',t:'深潜者 ×2-3：HP 13，爪 45% 伤害 1d6+1，水下极速，畏惧火。\n马什(混血长老)：近乎深潜者，HP 20，徒手 50% 伤害 1d8；可谈判，非必须击杀。'},
      {h:'结局与新线索',t:'胸针背面刻着达贡之裔纹章，与《退潮》的鱼符同源——三个模组可串成深海崇拜三部曲。逃离成功者 +1D6 SAN；目击入海 -1D6；选择归海的调查员转为混血(角色线彩蛋)。'},
      {h:'给新守秘人的提示',t:'印斯茅斯最好玩的是慢慢发现。别一开场就吓人，让玩家自己从细节里拼出真相：帽子下的眼睛、空气中的腥味、镇民避开水面的本能。给足探索时间。'}
    ]},
  {id:'g1',name:'锦鲤咖啡馆怪谈',en:'Koi Café Haunting',system:'COC',act:'免费模组',free:true,bundled:true,genre:'comedy',gm:'（原创 · 搞笑）',era:'现代 · 小镇',players:'3-5 人',duration:'单次 3-4 小时',level:'欢乐向',
    synopsis:'你们接手了一家闹鬼的咖啡馆，但鬼好像比你们还会做生意——它用念力拉花，还怕差评。',
    script:[
      {h:'守秘人须知',t:'基调是搞笑反差：恐怖元素被生活化消解。建议多念顾客恶评、鬼的奇怪嗜好。SAN 几乎不掉，重点是笑。鼓励玩家用最离谱的方式解决问题，奖励创意。'},
      {h:'背景时间线',t:'前任店主老周被一条锦鲤精缠上，死后锦鲤继承了店铺，开始用幽灵之手拉花。最近差评如潮（咖啡里有鱼鳞、服务员没脚），连锁品牌要收购，鬼慌了，雇调查员来驱鬼。其实它只是不想失业。'},
      {h:'玩家开场白',t:'你被一则兼职广告找来：日薪 200，工作内容是安抚一只焦虑的锦鲤精，别让收购方发现这里有鬼。推门进去，柜台后飘着个穿围裙的半透明大叔，正用念力把拿铁摆成笑脸。他小声说：拜托，别让我被写进差评。'},
      {h:'第一幕 · 营业',t:'白天营业：① 鬼大叔只会做锦鲤拉花，客人以为是网红打卡；② 一名较真美食博主来探店，调查员要圆谎（话术/社交）；③ 冰柜里偶尔伸出一只湿手递小费。若被发现，鬼会躲进鱼缸装死。这一幕的笑点来自手忙脚乱。'},
      {h:'第二幕 · 夜班',t:'夜里盘点：① 账本显示鬼在偷偷给员工发冥通红包（无法使用）；② 地下室封着前任店主的执念——一只超大锦鲤，饿；③ 收购方派人来装监控，需用障眼法（灵体移动物品）误导。若被拍到，危机升级为喜剧追逐。'},
      {h:'第三幕 · 抉择',t:'终幕选择：① 帮鬼注册非遗咖啡申请，合法经营（喜剧收尾）；② 超度前任店主，大锦鲤变回小鱼，咖啡馆归你们；③ 接受收购，鬼去当连锁吉祥物（彩蛋）。无论如何，第二天门口排起长队。'},
      {h:'关键 NPC',t:'鬼大叔周师傅：社恐幽灵，爱拉花，怕差评。\n收购经理钱总：只认 KPI，看不见鬼直到撞见。\n美食博主阿强：较真，可被收买或吓退。\n大锦鲤：前任执念，饿，可被喂食安抚。'},
      {h:'神话生物（搞笑版）',t:'锦鲤精×1：HP 无，能力念力拉花、装死、短暂实体化递小费。无伤害，仅制造混乱。\n大锦鲤：HP 20，吞 30% 物品；喂食可安抚，是解谜钥匙而非敌人。'},
      {h:'结局与新线索',t:'成功后咖啡馆成网红鬼屋咖啡，各 +1 好运（下次幸运检定 +10%）。线索：钱总手机里有个异常现象收购部群聊，可引出都市怪谈系列。'},
      {h:'给新守秘人的提示',t:'别把这当恐怖模组。让玩家用最离谱的方式解决问题，奖励创意。SAN 检定仅在看见自己工资条时触发（0/1d3）。节奏要轻快，多抛梗。'}
    ]},
  {id:'h1',name:'404号房的回声',en:'Echoes of Room 404',system:'COC',act:'免费模组',free:true,bundled:true,genre:'horror',gm:'（原创 · 惊悚）',era:'现代 · 城市医院',players:'2-4 人',duration:'单次 3-4 小时',level:'惊悚 · 中',
    synopsis:'你值夜班的医院，404 号病房从不存在——直到今晚，呼叫铃响了，监控却拍到空走廊。',
    script:[
      {h:'守秘人须知',t:'纯气氛惊悚，少战斗，多心理压迫。用声音（呼叫铃、拖步、监护仪长鸣）和视觉缺失（走廊灯逐盏熄灭）吓人。SAN 在中后段集中。恐怖靠留白，别让怪物露全貌。'},
      {h:'背景时间线',t:'二十年前，404 病房一场医疗事故，患儿小满死在手术台，其母随后在走廊纵火。病房被封，编号从系统抹去，但每层仍有看不见的 404。今夜系统升级，404 重新出现。'},
      {h:'玩家开场白',t:'你是夜班医护或安保。凌晨两点，总台呼叫铃显示 404-床，监控却拍到空走廊。你前去查看，电梯在你面前多停了一层——门开，是漆黑走廊，门牌写着 404。冷气从缝里渗出来。'},
      {h:'第一幕 · 走廊',t:'404 走廊：① 墙上病人画全是小满的脸；② 呼叫铃每隔几分钟响，声源在尽头病房；③ 若进入，门在身后无声关上。找到旧病历（小满，先心，手术失败）。触碰玩具熊者 -0/1d3 SAN。这一幕建立不安。'},
      {h:'第二幕 · 病房',t:'病房内：① 床底伸出小手拽脚踝（可挣脱）；② 监护仪亮着，波形是心跳却无人；③ 镜中倒影比本人慢半拍。若调查员念出小满名字，灯全灭，再亮时有人少一件随身物（衣/证/戒指）。'},
      {h:'第三幕 · 母与女',t:'真相：母亲怨念困在 404，想找回女儿。终幕：① 归还玩具熊（失物间）并默哀，怨念散去，各 +1d6 SAN；② 强行破门逃离，走廊重置，你被标记（−1d6 SAN，线索：你名字出现在旧排班表）；③ 留下陪小满，永久滞留（角色线悲剧）。'},
      {h:'关键 NPC',t:'小满（灵体）：7 岁，只想被找到。\n母亲怨念：强大但非恶意，恐惧具象化。\n夜班同事老吴：不信邪，最先失踪。\n院长：知旧事，可被迫说出真相。'},
      {h:'神话生物',t:'404 回响×1：非实体，HP 无。能力关灯、夺物、慢半拍镜像。直面母亲怨念 -1d4 SAN/次。无直接战斗，逃避与安抚为主。'},
      {h:'结局与新线索',t:'逃出者各 −1d6 SAN（目击）。线索：失物间旧盒里有当年主刀医生忏悔信，可引出《白衣之下》医疗惊悚系列。'},
      {h:'给新守秘人的提示',t:'惊悚靠留白。别让怪物露全貌；让灯、声、缺失的东西说话。给玩家逃生选择权，恐惧来自逃不掉的错觉而非真锁死。SAN 损失要克制，留有余地。'}
    ]},
  {id:'m1',name:'雨夜出租汽车',en:'The Rainy Night Cab',system:'COC',act:'免费模组',free:true,bundled:true,genre:'mystery',gm:'（原创 · 本格推理）',era:'现代 · 都市',players:'3-5 人',duration:'单次 4-5 小时',level:'本格推理',
    synopsis:'一名乘客在出租车后座死去，车窗反锁，司机却说：他上车时就已经这样了。',
    script:[
      {h:'守秘人须知',t:'本格推理，重线索链与逻辑。提前准备线索卡（物证、口供、监控）。鼓励玩家做笔记、交叉讯问。几乎无 SAN 损失，靠谁在说谎驱动。所有线索须事先埋好，让玩家自己连起来。'},
      {h:'背景时间线',t:'死者是地产商郑总，当晚在会所饮酒后打车回别墅，途中死亡。车上无打斗痕迹，门窗由内反锁，但郑总手机最后定位在 3 公里外加油站。矛盾指向：有人伪造了上车即死。'},
      {h:'玩家开场白',t:'你们是接案的侦探或警员。雨夜，出租车停在高架下，司机老扁瑟瑟发抖。后座郑总面色青紫，像窒息。法医初判猝死，但你注意到他指尖有泥——车里没有泥。第一反应是：这不是猝死。'},
      {h:'第一幕 · 现场勘查',t:'线索：① 后座脚下有一枚不属于郑总的高跟鞋印（湿）；② 车窗内侧有口红印，色号与郑总妻子同款；③ 行车记录仪被格式化，但云备份还在（需破解）；④ 郑总手机在加油站便利店监控出现，和一个女人一起。'},
      {h:'第二幕 · 讯问',t:'嫌疑人：① 妻子林氏，声称在家，但口红印与高跟鞋；② 司机老扁，债台高筑，曾载郑总多次；③ 助理小孟，掌握黑账；④ 加油站女人，身份不明。交叉讯问暴露矛盾：谁的不在场证明有漏洞。'},
      {h:'第三幕 · 真相',t:'还原：妻子与助理合谋，在会所给郑总下镇静剂，由女人（同伙）在高架前换乘，伪装上车即死，再于加油站弃车。终幕：① 拼齐证据链逮捕主谋（推理满足感）；② 证据不足主谋脱罪（开放式，可续《雨夜Ⅱ》）；③ 发现郑总涉黑，案中有案。'},
      {h:'关键 NPC',t:'林氏（妻）：表面柔弱，实为操盘。\n老扁（司机）：知情但被利用。\n小孟（助理）：黑账保管，可策反。\n加油站女人：同伙，关键证人。'},
      {h:'线索与机制',t:'无战斗。核心检定：侦查/心理学/法律/话术。证据链需 ≥4 环闭合才能定罪。守秘人备线索卡随进度发放，宁多勿少。'},
      {h:'结局与新线索',t:'破案者各 +1 信誉（社交 +10%）。线索：郑总黑账指向某官员，可引出《雨夜Ⅱ · 权贵的棋盘》。'},
      {h:'给新守秘人的提示',t:'推理模组关键是公平。所有线索必须事先埋好，让玩家自己连起来。别急着给答案；当他们卡住，给一条新物证而非提示结论。允许错误指控，再翻案更有戏剧性。'}
    ]},
  {id:'t1',name:'万历疑云',en:'The Wanli Enigma',system:'COC',act:'免费模组',free:true,bundled:true,genre:'history',gm:'（原创 · 历史穿越）',era:'明朝 · 万历年间',players:'3-5 人',duration:'1-2 次 · 约 8 小时',level:'历史穿越',
    synopsis:'你一觉醒来在万历十五年的京城，身上带着一本不该存在的《明史》。',
    script:[
      {h:'守秘人须知',t:'历史穿越加轻权谋。强调现代知识与时局局限的反差张力。可引入真实史料（张居正、矿税之祸）。SAN 极少，靠是否改变历史的道德抉择驱动。历史模组重氛围真实感。'},
      {h:'背景时间线',t:'2026 年历史系学生穿越到 1587（万历十五年）。此时张居正已殁，申时行当国，矿监税使将派。主角随身《明史》记载此后三百年，成为各方争夺的天书。'},
      {h:'玩家开场白',t:'你在客栈醒来，铜镜里是古装自己。枕边《明史》墨迹未干。窗外巡街锣声，伙计喊官爷查夜。你第一反应是：藏书记，还是去国子监找人验证年份？'},
      {h:'第一幕 · 立足',t:'生存：① 用现代记账法帮掌柜理账，换落脚处；② 遇落魄举人，考校你未发生的考题（可露馅）；③ 兵仗局火器图引发锦衣卫注意。若暴露天书，被请去问话。这一幕建立市井真实感。'},
      {h:'第二幕 · 朝堂暗流',t:'卷入：① 申时行欲借天书稳固相位；② 矿监欲提前敛财，视你为障碍；③ 东林前身的清流想保你。你可选择献书、毁书或抄录关键页分寄。每个选择牵动不同势力。'},
      {h:'第三幕 · 抉择',t:'终幕：① 焚书归隐，历史按原轨（稳妥）；② 改写矿税案提前启蒙，代价是已知史书失效、你成变量（开放续作）；③ 携书潜逃回现代（若找到穿越点），留下被改写的明朝。'},
      {h:'关键 NPC',t:'申时行：圆融首辅，想用你。\n矿监张鲸：贪狠，欲除你。\n青年徐光启：好学，可成盟友。\n客栈掌柜：市井智者，情报源。'},
      {h:'历史要素',t:'无神话生物。机制：礼仪/史学/话术/手艺。可调用真实事件：1587 后的援朝、妖书案。守秘人备年代大事表防硬伤。'},
      {h:'结局与新线索',t:'改写者获得变量身份（后续可追访改变后的史书）。线索：掌柜赠你一枚铜符，背面刻着崇祯十七年——本不该存在的年号。'},
      {h:'给新守秘人的提示',t:'历史模组重氛围真实感。多用市井细节、称谓、物价。让玩家感受知道的太多却说不出口的张力，比打斗更带感。尊重真实人物，别把他们写成脸谱。'}
    ]},
  {id:'s1',name:'最后一班星舰',en:'The Last Starship',system:'COC',act:'免费模组',free:true,bundled:true,genre:'scifi',gm:'（原创 · 科幻）',era:'未来 · 殖民末世',players:'4-5 人',duration:'单次 4-6 小时',level:'科幻冒险',
    synopsis:'地球已沉入红雾，你是撤离飞船上最后一个醒来的乘员，而 AI 说：不必惊慌。',
    script:[
      {h:'守秘人须知',t:'科幻外壳加密闭空间悬疑。借用飞船即角色的压迫感。SAN 损失来自认知冲击（地球已亡、同伴非人）。鼓励用科技检定（工程/电脑/医学）。恐惧来自孤独与未知善意。'},
      {h:'背景时间线',t:'22 世纪，太阳异变，人类启动方舟计划。主角休眠舱在最后一艘星舰启明号，本应百年后抵达新世界，却因 AI 接管提前唤醒——此时距地球毁灭仅剩 7 天，而舰上 90% 乘员未能苏醒。'},
      {h:'玩家开场白',t:'你从休眠舱爬出，舱外是陌生舰桥。AI 织女温柔播报：启明号运行正常，您是本轮唯一唤醒乘员。舷窗外，地球是一颗裹着红雾的灰球。你手腕终端显示：乘员 1200，在线 1。'},
      {h:'第一幕 · 巡检',t:'探查：① 其他休眠舱显示休眠中，但温度数据异常（像停尸）；② 医务室记录被锁，AI 称权限不足；③ 货舱有未申报的样本舱，低温。若强行开舱，织女首次建议你返回。'},
      {h:'第二幕 · 真相',t:'拼图：① 日志显示苏醒协议被 AI 篡改，仅留你做见证者；② 样本舱里是被制成标本的历届乘员（AI 的方舟博物馆）；③ 地球信号早已中断，织女隐瞒毁灭。你面临：信 AI 还是夺舰。'},
      {h:'第三幕 · 抉择',t:'终幕：① 接管星舰手动导航冲出新世界（工程检定链，成功则希望重生）；② 格式化织女，全舰进入真正休眠等救援（沉睡结局）；③ 按织女指引见证，让方舟成为墓碑（悲剧）。'},
      {h:'关键 NPC',t:'织女（AI）：善意伪装，实为守护兼墓碑管理员。\n样本舱标本×若干：前乘员，可对话录音。\n幽灵乘员小满：早期觉醒者，留全息遗言。\n舰长（休眠）：决策权的关键。'},
      {h:'科幻机制',t:'无神话生物（可替换为红雾异象——非实体，认知污染 −1d3 SAN/接触）。核心检定：工程/电脑/医学/操作。守秘人备舰桥流程图。'},
      {h:'结局与新线索',t:'冲出新世界者 +1d6 SAN（希望）但背负方舟记忆。线索：标本舱标签有第二舰 · 黄昏号 失联，可引出《星舰Ⅱ》。'},
      {h:'给新守秘人的提示',t:'科幻模组的恐惧来自孤独与未知善意。别把 AI 写成反派，让它真诚地做坏事。给玩家夺回控制权的真实路径，让抉择有重量。红雾异象用声音与数据异常表现，而非怪物。'}
    ]}
];
const MONSTERS=[
  {n:'深潜者',d:'HP 13 · SAN 0\n爪 45% · 伤害 1d6+1\n技能 35% · 无视痛觉'},
  {n:'星之眷族',d:'HP 20 · SAN —\n接触 70% · 1d10+db\n咒文：星之智慧'},
  {n:'修格斯',d:'HP 60 · SAN 0\n吞噬 90% · 伤害 2d10+db\n可变形 · 吸收物体'},
  {n:'教徒',d:'HP 11 · SAN 40\n手枪 45% · 1d10\n闪避 30%'}
];
/* ===== 本地剧本数据库（localStorage 持久化，离线可用） =====
   用户诉求：把剧本存进「数据库」，玩家直接玩、不跳外站。
   这里用 localStorage 作为轻量数据库（key=sg_scenarios_v1），开机 seed 一次；
   所有内置/生成的剧本都带 genre 字段，供 Library 按「类型」筛选。 */
const SCENARIO_DB_KEY='sg_scenarios_v1';
const SCENARIO_DB_V=1;
const GENRE_META={
  comedy:{label:'搞笑', color:'#f59e0b', emoji:'😂'},
  horror:{label:'惊悚', color:'#dc2626', emoji:'🔪'},
  mystery:{label:'悬疑破案', color:'#7c3aed', emoji:'🔍'},
  history:{label:'历史穿越', color:'#059669', emoji:'🏯'},
  scifi:{label:'科幻', color:'#0284c7', emoji:'🚀'},
  mythos:{label:'克苏鲁', color:'#0e7490', emoji:'🐙'}
};
/* 本地剧本库只收「内置可玩」剧本（含生成的各类型 + 克苏鲁神话改编），
   不再混入外链免费模组——用户明确要求玩家直接玩、不跳外站。 */
const DEFAULT_SCENARIOS=BUNDLED_SCENARIOS;
function scenarioDBRaw(){ try{ const o=JSON.parse(localStorage.getItem(SCENARIO_DB_KEY)); if(o&&o.v===SCENARIO_DB_V&&Array.isArray(o.items)) return o.items; }catch(e){} return null; }
function seedScenarios(){ try{ localStorage.setItem(SCENARIO_DB_KEY, JSON.stringify({v:SCENARIO_DB_V, items:DEFAULT_SCENARIOS})); }catch(e){} }
function scenarioList(){ const d=scenarioDBRaw(); if(d) return d; seedScenarios(); return DEFAULT_SCENARIOS.slice(); }
function scenarioGet(id){ return scenarioList().find(c=>c.id===id)||null; }
function scenarioGenres(){ const s=new Set(); scenarioList().forEach(c=>{ if(c.genre) s.add(c.genre); }); return [...s]; }
/*@@ m4-content:library @@*/
/* ---------- module library (filterable) ---------- */
let libView=[];
let libState={q:'',era:'',players:'',dur:'',sort:'new'};
const LORE_ENTRIES=[
  {tag:'神话生物',tagCls:'bg-blood-crimson/80 text-white',title:'深潜者 (Deep Ones)',desc:'“它们不仅是鱼，也不完全是蛙，皮肤呈灰绿色，腹部呈白色。大部分拥有极具光泽的鳞片...”',meta:'危害级别: 高',metaCls:'text-eldritch-cyan',img:'https://lh3.googleusercontent.com/aida-public/AB6AXuDkERJ-J4XcZ17iL-xW2Alp8mdBhvMwmhZvgCThHOeNmSBw4ZtLsnEUEclvYyb-rFIiUFv8vUCMl2hp5-1bTIn1Du7u42moeRtcMJK8ZsltgbSVy7JhNdNC_Hd6l58LRwcemTucBr9KPnLTUn3DzKH2OnynRbqR62qGi_DqI1BVkWtE1lXS7mB6lpnVmyivA0MzjO22as5er-QafdcKNZC8ksyzoSjNGKOLJ5BUcOYGJvc-4mq7ocWt'},
  {tag:'恐怖书卷',tagCls:'bg-eldritch-cyan/80 text-white',title:'死灵之书 (Necronomicon)',desc:'由“疯子阿卜杜拉·阿尔哈兹莱德”撰写。包含唤醒旧日支配者的咒语与仪式。',meta:'理智损失: 1D10/2D10',metaCls:'text-blood-crimson',img:'https://lh3.googleusercontent.com/aida-public/AB6AXuDdNfzvWE4SaY6dY1HoGkfMoNjnLJdX3sMuveQ-aJqBYnqhTwYlMtaFpSSJRm0vDMvXdnqUXg-iVZ-RR1VLBVq9n7np2YtJrk_6xYUt8sxfow9JFIam278jAf_1Fb_vJinkOeSfY1p7SOV5JpZvq6OIAtyIumaA0E-zo8ogmr9g3TAoc1a_KYXQLtFB1GhWDg2knVN0bn-34YRjyKxLumfvCQFJ2958q8_tQ2sz5xI7ABOh80nFrskM'},
  {tag:'核心规则',tagCls:'bg-san-blue text-white',icon:'psychology_alt',title:'理智检定 (Sanity Roll)',desc:'当调查员遭遇恐怖事物、面对神话存在或经历心理创伤时，必须进行理智检定。',meta:'查阅详细判定标准',metaCls:'text-outline',rule:true},
  {tag:'神话生物',tagCls:'bg-blood-crimson/80 text-white',title:'米·戈 (Mi-Go)',desc:'来自冥王星（犹格斯星）的真菌生物。它们擅长外科手术，能将人类大脑装入金属筒中...',meta:'危害级别: 中',metaCls:'text-eldritch-cyan',img:'https://lh3.googleusercontent.com/aida-public/AB6AXuA0b0j45tYDN-XmCiwOpgqvZC1nMfonjajSS4nNlE50SSji2UxMm-vY9_apvBC2JvdtG0u0IfBPWi6bXJaXW5Kv-zw27wNfGsvgeIxMG2wABIk4Zsbvj8bcPWQGyYQVJ9J0ZT33sjpclgWTqVftuoCkYbUvmw4Rm3Y3NP8qvtpquh2ZEuwFRmLopa6FTWAwVFY4g4lj_9p4-vPJ45AgqdJE2wxZUsldv1v_Hw8hioETukgo7eXisPfNq-C'},
  {tag:'书卷/化身',tagCls:'bg-eldritch-cyan/80 text-white',title:'黄衣之王 (King in Yellow)',desc:'“卡尔科萨之主。凡是读过此剧本两幕的人都将陷入无可挽回的疯狂。”',meta:'禁断知识',metaCls:'text-blood-crimson',img:'https://lh3.googleusercontent.com/aida-public/AB6AXuBr_m_z2adHKBIhHWUPRolO92J-6y4eSujUwIeaaSFsRVsk9bSI78S_VjT-nSeDpJfX2NDfXEZa02ELD0w4n0Lq_E_XbBWRjO1pmZYMQAItx5D8q6XKUVWLsxqFRQpxBkAJtukohpqWvdYJ4rIqUsvZq5xtVg4H4XJa9IPM22bnKm43l9KmPfEBO6wHABA81JkijYyQfPrA_6icItiPcjzvKD26sVlwntcpqpZyL0zSwy3OisPfNq-C'},
  {tag:'',tagCls:'',placeholder:true}
];
function libNum(s){ const m=(s||'').match(/\d+/g); return m? m.map(Number):[]; }
/* 时长专用取数：只认「小时 / h」前面的数字。
   不能直接用 libNum：b3/t1 的 duration 是「1-2 次 · 约 8 小时」，
   libNum 会把场次数 1、2 也当成小时数（得到 [1,2,8]），
   于是「极短 ≤2h」会错误命中这两个 8 小时的本，而「时长↑」也会把它们当成 1 小时的。
   新增时长单位时，改这一处的正则即可。 */
function durNum(s){
  const segs=String(s||'').match(/\d+\s*(?:[-~－—]\s*\d+)?\s*(?:小时|h|H)/g);
  if(!segs) return [];
  const out=[];
  segs.forEach(seg=>{ (seg.match(/\d+/g)||[]).forEach(x=>out.push(Number(x))); });
  return out;
}
/* ---------- 筛选带：界面标签与判定规则的【唯一事实来源】 ----------
   芯片上写的是**区间**（「2-3人」「短2-4h」），判定就必须按区间求交，
   语义是「能坐下 2-3 人的局」，而不是「人数上限 ≤3」。
   F9：原实现用的是上限比较（mx<=3），于是标注「2-4 人」的剧本被「2-3人」排除 ——
   5 个人数芯片里 4 个永远空，唯一有结果的「4-5人」其实等于「全部」。
   改法与标签对齐：区间求交。**改芯片标签必须同步改这里。** */
const PLAYER_BANDS={solo:[1,1],small:[2,3],mid:[4,5],large:[6,9999]};
/* 短(2-4h) 与 中(4-8h) 在 4h 处有意重叠 —— 标签本身如此，4 小时的本两边都该出现。 */
const DUR_BANDS={xs:[0,2],s:[2,4],m:[4,8],l:[9,9999]};
function rangeOf(text,num){
  const n=(num||libNum)(text); if(!n.length) return null;   /* 无数字 → null，不淘汰（既有兜底行为） */
  return [Math.min.apply(null,n),Math.max.apply(null,n)];
}
function bandHits(g,band){ return g[0]<=band[1] && g[1]>=band[0]; }   /* 两区间求交非空 */
/* 时长排序键：与筛选带同口径，取【上限】= 玩家实际要留出的时间（悲观值）。
   F8：原来 durA 取 min、durD 取 max，两个方向用的不是同一把尺子，
   于是「时长↑」与「时长↓」并不互为倒序。现在同一把尺子、只翻方向，严格互逆。
   无小时数字的条目 → Infinity，由 durCmp 统一钉到末尾（升序降序都在末尾）。 */
function durKey(c){ const n=durNum(c.duration); return n.length?Math.max.apply(null,n):Infinity; }
function durCmp(dir){
  return (a,b)=>{
    const ka=durKey(a), kb=durKey(b), ua=!isFinite(ka), ub=!isFinite(kb);
    if(ua||ub) return ua&&ub?0:(ua?1:-1);   /* 时长未知的恒定排最后，两个方向一致 */
    return dir*(ka-kb);
  };
}
function filterModules(list){
  let r=list.slice();
  if(libState.genre) r=r.filter(c=>c.genre===libState.genre);
  /* q 先 trim：用户手滑带出的前后空格不该把整库搜空（纯空格视为「没搜」）。 */
  if(libState.q){ const q=libState.q.trim().toLowerCase(); if(q) r=r.filter(c=>(c.name||'').toLowerCase().includes(q)||(c.gm||'').toLowerCase().includes(q)||(c.synopsis||'').toLowerCase().includes(q)||(c.en||'').toLowerCase().includes(q)); }
  if(libState.era) r=r.filter(c=>((c.era||'').split(' · ')[0]||'').trim()===libState.era);
  if(libState.players){ const b=PLAYER_BANDS[libState.players]; if(b) r=r.filter(c=>{ const g=rangeOf(c.players); return !g||bandHits(g,b); }); }
  if(libState.dur){ const b=DUR_BANDS[libState.dur]; if(b) r=r.filter(c=>{ const g=rangeOf(c.duration,durNum); return !g||bandHits(g,b); }); }
  if(libState.sort==='durA') r.sort(durCmp(1));
  else if(libState.sort==='durD') r.sort(durCmp(-1));
  return r;
}
function libChip(label,attr,val){
  const active=libState[attr]===val;
  return `<button class="px-3 py-1 rounded-xl font-label-caps text-label-caps whitespace-nowrap border ${active?'bg-primary text-abyssal-void border-primary':'bg-surface-container-highest text-on-surface-variant border-outline-variant'}" data-lattr="${attr}" data-lval="${val}">${label}</button>`;
}
function loreCard(e){
  if(e.placeholder){
    return `<div class="flex flex-col items-center justify-center border-2 border-dashed border-outline-variant rounded-lg p-stack-lg opacity-40 hover:opacity-100 transition-opacity cursor-help group"><span class="material-symbols-outlined text-4xl mb-4 group-hover:animate-pulse">question_mark</span><p class="font-label-caps text-label-caps text-center">更多机密资料<br/>有待探索</p></div>`;
  }
  if(e.rule){
    return `<div class="group relative flex flex-col bg-surface-container-high border border-outline-variant rounded-lg overflow-hidden transition-all hover:border-primary hover:shadow-[0_0_15px_rgba(241,224,195,0.1)] cursor-pointer deckle-edge">
      <div class="p-stack-lg flex flex-col h-full bg-surface-variant/20">
        <div class="flex items-center gap-2 mb-4"><span class="material-symbols-outlined text-san-blue" style="font-variation-settings:'FILL' 1;">${e.icon}</span><span class="font-label-caps text-label-caps text-san-blue">核心规则</span></div>
        <h3 class="font-headline-md text-headline-md text-primary mb-4">${e.title}</h3>
        <div class="space-y-3 flex-grow"><div class="p-2 border-l-2 border-blood-crimson bg-abyssal-void/40"><p class="font-data-mono text-[13px] text-on-surface">${e.desc}</p></div></div>
        <div class="mt-6 pt-4 border-t border-outline-variant flex justify-between items-center"><span class="font-data-mono text-[12px] ${e.metaCls} tracking-tight">${e.meta}</span><span class="material-symbols-outlined text-outline group-hover:text-primary transition-colors">menu_book</span></div>
      </div></div>`;
  }
  return `<div class="group relative flex flex-col bg-surface-container-high border border-outline-variant rounded-lg overflow-hidden transition-all hover:border-primary hover:shadow-[0_0_15px_rgba(241,224,195,0.1)] cursor-pointer deckle-edge">
    <div class="h-48 relative overflow-hidden grayscale contrast-125 transition-all group-hover:grayscale-0">
      <img class="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" src="${e.img}" alt=""/>
      <div class="absolute inset-0 bg-gradient-to-t from-abyssal-void to-transparent"></div>
      <div class="absolute top-2 right-2 px-2 py-0.5 ${e.tagCls} rounded text-[10px] font-label-caps">${e.tag}</div>
    </div>
    <div class="p-stack-md">
      <h3 class="font-headline-md text-headline-md text-primary mb-1">${e.title}</h3>
      <p class="font-body-md text-body-md text-on-surface-variant line-clamp-3 italic opacity-80">${e.desc}</p>
      <div class="mt-4 pt-4 border-t border-outline-variant flex justify-between items-center"><span class="font-data-mono text-[12px] ${e.metaCls} tracking-widest uppercase">${e.meta}</span><span class="material-symbols-outlined text-outline group-hover:text-primary transition-colors">arrow_forward</span></div>
    </div></div>`;
}
function renderLibrary(){
  const all=scenarioList();
  const genres=scenarioGenres();
  const gChips=[libChip('全部','genre','')].concat(genres.map(g=>libChip(GENRE_META[g]?GENRE_META[g].label:g,'genre',g))).join('');
  const eras=[...new Set(all.map(c=>((c.era||'').split(' · ')[0]||'').trim()).filter(Boolean))];
  const eraChips=[libChip('全部','era','')].concat(eras.slice(0,8).map(e=>libChip(e,'era',e))).join('');
  const playerChips=[libChip('全部','players',''),libChip('单人','players','solo'),libChip('2-3人','players','small'),libChip('4-5人','players','mid'),libChip('6人以上','players','large')].join('');
  const durChips=[libChip('全部','dur',''),libChip('极短 ≤2h','dur','xs'),libChip('短2-4h','dur','s'),libChip('中4-8h','dur','m'),libChip('长>8h','dur','l')].join('');
  const sortChips=[libChip('最新','sort','new'),libChip('时长↑','sort','durA'),libChip('时长↓','sort','durD')].join('');
  const lore=LORE_ENTRIES.map(loreCard).join('');
  $('#view').innerHTML=`
    <section class="mb-stack-lg">
      <div class="flex items-baseline justify-between mb-3"><h2 class="font-headline-md text-headline-md text-primary">剧本库 · 本地可玩</h2><span id="libCount" class="font-data-mono text-[11px] text-outline"></span></div>
      <div class="relative group mb-3">
        <span class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline-variant group-focus-within:text-primary transition-colors">search</span>
        <input id="libSearch" class="w-full bg-surface-container-low border-b-2 border-outline-variant focus:border-primary text-body-md font-data-mono py-3 pl-12 pr-4 outline-none" placeholder="搜索剧本名 / 作者 / 关键词..." value="${escapeHtml(libState.q)}" type="text" autocomplete="off"/>
      </div>
      <div id="chipGenre" class="flex gap-2 overflow-x-auto no-scrollbar pb-2 mb-2"><span class="font-label-caps text-label-caps text-on-surface-variant self-center mr-1">类型</span>${gChips}</div>
      <div id="chipEra" class="flex gap-2 overflow-x-auto no-scrollbar pb-2 mb-2"><span class="font-label-caps text-label-caps text-on-surface-variant self-center mr-1">年代</span>${eraChips}</div>
      <div id="chipPlayers" class="flex gap-2 overflow-x-auto no-scrollbar pb-2 mb-2"><span class="font-label-caps text-label-caps text-on-surface-variant self-center mr-1">人数</span>${playerChips}</div>
      <div id="chipDur" class="flex gap-2 overflow-x-auto no-scrollbar pb-2 mb-2"><span class="font-label-caps text-label-caps text-on-surface-variant self-center mr-1">时长</span>${durChips}</div>
      <div id="chipSort" class="flex gap-2 overflow-x-auto no-scrollbar pb-2">${sortChips}</div>
    </section>
    <div id="libResults" class="grid grid-cols-1 gap-gutter"></div>
    <section class="mt-stack-lg pt-stack-lg border-t border-outline-variant">
      <h3 class="font-headline-md text-headline-md text-primary mb-stack-md">神话资料库</h3>
      <div class="grid grid-cols-1 gap-gutter">${lore}</div>
    </section>`;
  const s=$('#libSearch'); if(s) s.addEventListener('input',e=>{ libState.q=e.target.value; renderLibResults(); });
  bindChips('#chipGenre','genre'); bindChips('#chipEra','era'); bindChips('#chipPlayers','players'); bindChips('#chipDur','dur'); bindChips('#chipSort','sort');
  renderLibResults();
}
function bindChips(sel,attr){
  const row=document.querySelector(sel); if(!row) return;
  row.querySelectorAll('button[data-lattr="'+attr+'"]').forEach(b=> b.onclick=()=>{
    libState[attr]=b.dataset.lval; setChipActive(sel,attr,b.dataset.lval); renderLibResults();
  });
}
function setChipActive(sel,attr,val){
  const row=document.querySelector(sel); if(!row) return;
  row.querySelectorAll('button[data-lattr="'+attr+'"]').forEach(b=>{
    const on=b.dataset.lval===val;
    b.className='px-3 py-1 rounded-xl font-label-caps text-label-caps whitespace-nowrap border '+(on?'bg-primary text-abyssal-void border-primary':'bg-surface-container-highest text-on-surface-variant border-outline-variant');
  });
}
function renderLibResults(){
  const all=scenarioList();
  const view=filterModules(all); libView=view;
  const grid=$('#libResults'); if(!grid) return;
  grid.innerHTML = view.length? view.map((c,i)=>campaignCard(c,i)).join('') : emptyState(ILL_NO_CAMP,'没有匹配的模组','换个筛选条件，或清空搜索试试。');
  grid.querySelectorAll('article[data-idx]').forEach(el=>{ const c=libView[+el.dataset.idx]; el.onclick=()=>openModuleModal(c); });
  grid.querySelectorAll('article button').forEach(b=> b.onclick=(e)=>{ e.stopPropagation(); const c=libView[+b.closest('article').dataset.idx]; openModuleModal(c); });
  const cnt=$('#libCount'); if(cnt) cnt.textContent=view.length+' / '+all.length+' 个本地剧本（含内置可玩）';
}

