<div align="center">

# 银之门 · Silver Gate

**一个跑在单个 HTML 文件里的 AI 版克苏鲁跑团（CoC）App**

零框架 · 零构建依赖 · 双击即玩 · 自带 AI 守秘人 · 8 模块依赖图校验构建器

### [▶ 在线试玩（无需安装、无需注册）](https://sunred-liu.github.io/silver-gate/)

[![License: MIT](https://img.shields.io/badge/License-MIT-2ea44f.svg)](LICENSE)
[![CI](https://github.com/sunred-liu/silver-gate/actions/workflows/ci.yml/badge.svg)](https://github.com/sunred-liu/silver-gate/actions/workflows/ci.yml)
[![Single File](https://img.shields.io/badge/%E4%BA%A7%E7%89%A9-%E5%8D%95%20HTML%20620KB-6f42c1.svg)](#-交付形态)
[![Zero Deps](https://img.shields.io/badge/%E8%BF%90%E8%A1%8C%E6%97%B6%E4%BE%9D%E8%B5%96-0-blue.svg)](#-交付形态)
[![Modules](https://img.shields.io/badge/%E6%A8%A1%E5%9D%97-8%20%2F%2035%20%E5%88%86%E5%9D%97-orange.svg)](docs/ARCHITECTURE.md)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[English](README.en.md) · [架构深挖](docs/ARCHITECTURE.md) · [快速开始](#-快速开始) · [路线图](#-路线图)

<img src="docs/screenshots/flow_1_splash.png" width="18%" alt="启动页" /> <img src="docs/screenshots/flow_2_auth.png" width="18%" alt="登录" /> <img src="docs/screenshots/flow_4_me_after_char1.png" width="18%" alt="角色" /> <img src="docs/screenshots/01_map_overview.png" width="18%" alt="战棋地图" /> <img src="docs/screenshots/03_damage_panel.png" width="18%" alt="战斗" />

</div>

---

## 这是什么

一个给**跑团玩家自己用**的 CoC 工具：建卡、掷骰检定、开团房间、战斗地图、AI 守秘人（KP）、角色成长，全部塞进**一个 HTML 文件**里。没有服务器也能玩，有服务器就能联机。

它最初只是一个「把线下跑团搬到手机上」的原型，后来长成了一个有点不太正常的东西：**前端没有用任何框架，但源码被拆成了 8 个模块、35 个分块、395 个符号，并且有一个构建器在每次构建时校验模块之间的依赖边是否合法**。

这听起来像是过度设计。确实是。但这个"过度设计"换来了两件真实的好处：

- **交付物永远是单文件**（`www/index.html`，620KB）。不装 node、不跑 bundler、不配 CI，扔到任何静态服务器/网盘/手机里都能开。你甚至可以把文件发给朋友，他双击就能看你的角色卡。
- **源码永远不会退化成意大利面**。想加功能？先改 `src/`，构建器会告诉你「你要用的这个符号属于 m6-map，但 m3-ai 没声明依赖它」。它不靠自觉，它靠报错。

---

## ✨ 三个真正值得一看的地方

### 1️⃣ 一个会画依赖图的构建器（不是打包器）

`build.js` 不是 webpack 的薄壳——它做的是**架构校验**：把 `@@ mod:chunk @@` 哨兵切开的源码拼回单文件，同时静态扫描每个分块的顶层声明，算出符号归属，再检查「谁引用了谁的符号，这个依赖边在 `modules.json` 里声明过吗」。

跑一次构建，它会把整张图打出来：

```
模块 8 个 / 分块 35 个 / 符号 395 个
  m0-core  L0 src/m0-core.js       分块 state,helpers,renderers,date
  m2-dice  L1 src/m2-dice.js       分块 coc,ai
  m7-qr    L1 src/m7-qr.js         分块 encoder
  m1-character L2 src/m1-character.js  分块 cheka,backup,drawer,objects,lifecycle-motto,tags,fragments,backfill,growth
  m4-content L1 src/m4-content.js    分块 scenarios,library
  m6-map   L3 src/m6-map.js        分块 battlemap,vision,tokens,nav,overlay,presets
  m3-ai    L3 src/m3-ai.js         分块 provider,archetypes,shared,keeper,mate,panel,sgai
  m5-net   L2 src/m5-net.js        分块 data,account,auth,share
依赖边: m0-core->m5-net  m1-character->m0-core  m1-character->m2-dice  ...
  [info] 依赖环：m0-core ↔ m1-character ↔ m2-dice ↔ m3-ai ↔ m4-content ↔ m5-net ↔ m6-map
         （强连通分量 7 个模块，19 条边）
产物: www/index.html  633979 B  md5=ab9b5b3b...
```

我最满意的是它**不假装自己是干净的**。上面那个 7 模块的依赖环是真实存在的：`m0-core` 的渲染器要读当前登录用户名（属于 `m5-net`），而 `m5-net` 又要调渲染器。真正的解耦需要事件总线或把 UI 回调上移一层，那是更大的重构。**与其把环藏起来，不如让构建器每次都把环打印出来**，并在 `modules.json` 里逐条登记反向边的成因（打开 `modules.json` 看 `m1-character.depends` 那段中文注释，写明了哪一行、为什么、留待哪个批次解决）。

还有一个 `scanIgnore` 机制值得提：`m6-map` 里有一句 `const ck=cellKey(...)`，静态扫描会误判成「引用了 m1-character 的顶层 `ck`」。于是 `modules.json` 里显式登记了豁免理由——**豁免必须带原因，否则不接受**。这种"允许例外，但例外要留字据"的做法，比"禁止例外"更能在真实项目里活下去。

### 2️⃣ 零依赖 QR 编码器（9.7KB）

`src/m7-qr.js`，9,728 字节，出边 0（不依赖任何模块）。按 ISO/IEC 18004 自己实现的 byte 模式编码：纠错等级 M、版本 1–9、8 种掩码逐个按标准罚分规则打分取最优。

为什么自己写？因为「扫一扫入团」（把房间码塞进二维码让朋友扫）这个功能，**不值得为它引一个 CDN 依赖**——那会破坏"单文件离线可用"的前提。这是全项目最自包含的一块，也是最容易被单独摘出来复用的：直接 copy 走就能用。

### 3️⃣ AI 守秘人：离线规则大脑 + 在线大模型，自动回落

`m3-ai.js` 里是一套统一 Provider 抽象，三种模式：

| 模式 | 工作方式 | 需要联网 |
|---|---|---|
| `local` | **规则大脑**：按场景关键词分类（医院/老宅/小镇/邪教/校园…），走「真相优先 + 三线索法则」生成 NPC、线索与旁白 | ❌ 不需要 |
| `remote` | 任意 **OpenAI 兼容** endpoint（填 URL + Key + 模型名即可） | ✅ |
| 服务器大脑 | 对接 `server/ai-engine.js` 的 `/ai/*`，带用量计费与状态机 | ✅ |

关键在于**断网自动回落**：远程调用失败或未登录时，静默退回本地规则大脑，不弹错误、不中断跑团。一个跑团 App 在朋友家 WiFi 挂掉时还能继续跑，比多接一个模型重要得多。

---

## 🚀 快速开始

### 最省事：双击

```bash
git clone https://github.com/<your-name>/silver-gate.git
cd silver-gate
open www/index.html        # macOS
# start www\index.html     # Windows
```

就这样。没有 `npm install`，没有 dev server。`www/index.html` 是**已构建好的产物**，开箱可玩。

> ⚠️ 本地 `file://` 下部分浏览器会限制 `localStorage` 与 `fetch`。想要完整体验（含联机），用下面的静态服务方式。

### 静态服务（完整体验离线功能）

```bash
npx serve www            # 或 python -m http.server -d www 8080
```

### 联机后端（多个玩家进同一个房间）

```bash
cd server
npm install              # 只有 ws + puppeteer-core（后者仅截图测试用）
JWT_SECRET="换成你自己的32位以上随机串" node index.js
# 默认 http://127.0.0.1:3000
```

> 后端不设 `JWT_SECRET` 时会在 `server/data/.jwt_secret` 生成一个随机密钥并复用。
> 该文件已被 `.gitignore` 排除，**请不要提交进仓库**。

---

## 🧱 交付形态

```
src/index.shell.html ──┐
src/m0…m7.js ──────────┼─→ node build.js ─→ www/index.html ─→ 静态站 / APK / 所有测试
modules.json ──────────┘        ↑
                          （同时校验依赖边）
```

| 指标 | 数值 |
|---|---|
| 产物体积 | **633,979 B（约 620KB）单文件** |
| 运行时依赖 | **0**（无 npm 包、无 CDN 必需项） |
| 源码模块 | 8 个 / 35 个分块 / 395 个顶层符号 |
| 构建依赖 | Node ≥ 18（只用内置 `fs`/`path`/`crypto`） |
| 后端（可选） | `ws` + Node http，约 240KB JS |

产物为什么保持单文件：`www/index.html` 是 nginx、Capacitor(APK)、以及全部存量测试唯一读取的入口。让它保持单文件形态，拆分源码就**不需要**动缓存策略、不需要改 APK 配置、不需要重写任何测试。**改的是开发体验，不是交付物。**

---

## 📦 模块一览

| 模块 | 层 | 职责 | 依赖 |
|---|---|---|---|
| **m0-core** | L0 | 全局状态 / DOM 助手 / 消息与骰子渲染 / 日期 | m5-net |
| **m2-dice** | L1 | CoC 检定（含奖励/惩罚骰）、通用掷骰与消息构造 | m0 |
| **m7-qr** | L1 | 零依赖 QR 编码器（byte / M / v1–9 / 8 掩码罚分择优） | — |
| **m4-content** | L1 | 内置剧本常量、本地剧本库、浏览与筛选 | m0 |
| **m1-character** | L2 | 建卡、属性掷骰、年龄调整、导入导出、卡面 UI、**角色全生命周期**（五标签位 / 命运残片 / 离线成长 / 幕间成长 / T1–T5 阶层） | m0 m2 m3 m5 m6 |
| **m5-net** | L2 | 本地落盘、REST 接入、云端存档（LWW 合并 + 墓碑删除）、WebSocket 房间同步、登录/访客/JWT、分享链接 | m0 m1 m4 m6 |
| **m3-ai** | L3 | Provider 抽象、场景原型库、AI 守秘人 Keeper、AI 队友、设置面板、服务器大脑 SGAI | m0 m1 m2 m5 |
| **m6-map** | L3 | 战棋：墙体/困难地形编辑（带撤销）、Token 权限、先攻回合、战损时间线、框选批量、PNG 导出；**迷雾 + VBL 视线遮挡**；测距寻路（Dijkstra + 移动预算钳制） | m0 m1 m5 |

完整依赖图、分块清单与豁免登记见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

---

## 🗺️ 功能面

**角色**：建卡 · 属性掷骰与年龄调整 · 卡面/抽屉 · JSON 导入导出 · 五标签位 · 命运残片 · 离线成长 · 幕间成长 · T1–T5 阶层
**跑团**：开团房间 · 实时同步 · 房间码/二维码邀请 · AI 守秘人 · AI 队友 · 战报导出
**战斗**：战棋地图 · 多边形墙体 · 困难地形 · VBL 视野遮挡 · 迷雾 · 先攻与回合 · 条件标记 · 测距寻路 · 框选批量伤害 · 战损时间线 · PNG 导出
**工程**：源码模块化 + 依赖图校验 · 产物漂移检测 · 单文件离线运行 · 可选联机后端 · Capacitor 打包 Android

---

## 🧭 路线图

- [x] 源码 8 模块拆分 + 依赖边校验 + 产物漂移哨兵
- [x] 零依赖 QR 编码器（扫一扫入团）
- [x] AI 守秘人本地规则大脑 + OpenAI 兼容远程 + 断网回落
- [x] VBL 视线遮挡与迷雾
- [x] 角色全生命周期（成长 / 幕间 / 阶层）
- [ ] **拆掉 7 模块依赖环**：引入事件总线，把 `m0-core ↔ m5-net` 的反向边解开
- [ ] `m5-net` 再拆：把「存储」与「网络」分离成两块（现在它有 53KB）
- [ ] 把 `pick` / `rnd` 从 `m3-ai.provider` 挪回 `m0-core`（历史遗留，挪动会改产物字节，需配合回归）
- [ ] 剧本 DSL：让玩家用纯文本写自己的团本
- [ ] 移动端手势（双指缩放/长按框选）打磨

---

## ⚠️ 已知限制（先说清楚，省得你踩坑）

1. **这是原型，不是成品**。数据默认存在浏览器 `localStorage`，清缓存 = 丢档。云端存档要自己起后端。
2. **离线 token 不是安全机制**。离线模式下 token 由前端签发也由前端校验，任何人可伪造——所以离线模式不做任何权限承诺。真正的鉴权在联机模式下由服务端用 `JWT_SECRET` 完成。
3. **账号体系是自建的、极简的**。密码用 djb2 哈希，**不适合任何真实生产场景**，仅用于本机多账号区分。要上线请换 bcrypt/argon2 + 服务端会话。
4. **内置剧本只有元数据**（名称/人数/时长/原作者链接），不含正文，需要去原站获取。
5. 部分视觉资源引用外部字体与占位图，纯离线环境下会回落到系统字体。

安全模型与已知缺陷详见 [`docs/SECURITY.md`](docs/SECURITY.md)。

---

## 🤝 参与

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。最短路径：

```bash
node build.js          # 改完 src/ 一定要跑
node build.js --check  # 校验产物与源码是否同步（CI 用这个）
```

**唯一铁律：不要直接编辑 `www/index.html`**，它是产物，跑一次构建就被覆盖。

欢迎的 PR：拆依赖环、性能、移动端手势、剧本 DSL、把 QR 编码器单独抽成通用库、补英文文档。
不需要的 PR：引入前端框架重写、把单文件改成多文件部署。

---

## 📄 声明

个人非商业同人作品，与 Chaosium Inc. 无隶属关系。*Call of Cthulhu* 及相关规则权利归 Chaosium Inc.。项目不包含任何商业模组正文，内置库仅存元数据与原站链接。代码以 [MIT](LICENSE) 授权。

<div align="center">

如果这个项目对你有用，点个 ⭐ 就是最好的支持。

</div>
