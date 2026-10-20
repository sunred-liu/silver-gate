# 架构：一个构建产物，八个模块

> 本文写给想改代码的人。只想跑起来看的话回 [README](../README.md) 就够了。

---

## 一、数据流

```
   src/index.shell.html   ← 骨架（HTML/CSS + 已迁模块之外的顶层代码，含 @@ 哨兵块标记）
   src/m0-core.js         ← 模块源码（块体之间以 @@ 哨兵分隔）
   src/m1-character.js
   src/m2-dice.js
   src/m3-ai.js
   src/m4-content.js
   src/m5-net.js
   src/m6-map.js
   src/m7-qr.js
        │
        │  modules.json  ← 模块清单：文件、层次、声明分块、允许的依赖边、豁免理由
        ▼
   node build.js
        ├─ 切分：按 `/*@@ mod:chunk @@*/` 哨兵把 shell 与模块文件切成有序块序列
        ├─ 静态扫描：抽出每块的顶层声明 → 建立「符号 → 模块」归属表
        ├─ 依赖校验：谁引用了谁的符号 → 该边在 modules.json 声明过吗？
        ├─ 环检测：Tarjan 求强连通分量，把环打印出来（info，不阻断）
        └─ 拼接：按 modules.json.order 写回单文件
        ▼
   www/index.html   ← 唯一部署产物（nginx / Capacitor APK / 全部测试都读它）
```

**为什么产物是单文件**：`www/index.html` 是 nginx、Capacitor(APK)、以及全部存量测试唯一读取的入口。让它保持单文件，源码拆分就**不需要**动 nginx 缓存头、不需要改 APK 配置、不需要重写任何测试。拆的是开发体验，不是交付物。

---

## 二、三条铁律

1. **不要直接编辑 `www/index.html`**。它是产物，跑一次 `node build.js` 就会被覆盖。漂移哨兵（`node build.js --check`）会在你手改后立刻报 `BUILD_DRIFT`。要改代码 → 改 `src/`。
2. **不要改 `/*@@ mod:chunk @@*/` 哨兵行的格式**。构建器按行精确匹配 `^/\*@@ ([\w.-]+):([\w.-]+) @@\*\/$`。
3. **头注释里不要写出注释结束符**（星号紧跟斜杠）。头注释区只允许出现一个结束符（收尾那个）。多一个 → 注释提前闭合，后面的中文变成代码，构建器会拦下并告诉你原因。

---

## 三、模块与依赖边

### 实际依赖图（构建器输出）

```
m0-core → m5-net
m1-character → m0-core, m2-dice, m3-ai, m5-net, m6-map
m2-dice → m0-core
m3-ai → m0-core, m1-character, m2-dice, m5-net
m4-content → m0-core
m5-net → m0-core, m1-character, m4-content, m6-map
m6-map → m0-core, m1-character, m5-net
m7-qr → （无出边）
```

### 依赖环（已知，未消解）

构建器每次都会打印：

```
[info] 依赖环：m0-core ↔ m1-character ↔ m2-dice ↔ m3-ai ↔ m4-content ↔ m5-net ↔ m6-map
       （强连通分量 7 个模块，19 条边）
```

**这个环是真实的，没有藏。** 成因是两个具体的运行时调用：

| 反向边 | 真实成因 | 彻底解法 |
|---|---|---|
| `m0-core → m5-net` | 渲染器要读当前登录用户名 `myName` | 把 `myName` 下沉为 m0 状态字段，由 m5 登录成功时写入 |
| `m1-character → m3-ai` | 骰子面板 `doRoll` 要通知本地 Keeper | 事件总线，或把回调上移 |
| `m1-character → m6-map` | 卡面/抽屉的「战术地图定位」按钮要调 `focusCharOnMap` | 事件总线，或把 UI 回调移到 M8 app 层 |

`m7-qr` 是全项目唯一出边为 0 的模块（不依赖任何东西，也不被任何东西依赖），因此它是最容易单独摘出去复用的。

### 分块（chunk）

每个模块内部还按 `@@ mod:chunk @@` 分成若干块，块是**逻辑分区**而非加载单元（最终都拼进同一个文件）。分块的意义是让「某功能在哪一段」可检索，并让依赖扫描的粒度更细。

| 模块 | 分块 |
|---|---|
| m0-core | `state` `helpers` `renderers` `date` |
| m1-character | `cheka` `backup` `drawer` `objects` `lifecycle-motto` `tags` `fragments` `backfill` `growth` |
| m2-dice | `coc` `ai` |
| m3-ai | `provider` `archetypes` `shared` `keeper` `mate` `panel` `sgai` |
| m4-content | `scenarios` `library` |
| m5-net | `data` `account` `auth` `share` |
| m6-map | `battlemap` `vision` `tokens` `nav` `overlay` `presets` |
| m7-qr | `encoder` |

---

## 四、构建器的两个关键机制

### 1. 符号归属与依赖边校验

对每个分块做**顶层声明扫描**（必须顶格，因为骨架里的顶层代码没有缩进；否则会把函数体里的 `const t=...` 误判成模块级符号，造成假重名与假依赖边）：

```
DECL = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/
```

扫描前先跑 `scan.js` 做**代码上下文掩码**——把注释和字符串字面量抹掉，只统计真代码里出现的标识符。否则一句中文注释里提到某个函数名就会造出一条幽灵依赖边。

然后：某块引用了符号 `X`，`X` 属于模块 `M`，而当前模块没在 `modules.json` 里声明依赖 `M` → **构建失败**，并打印「哪个文件哪一行引用了谁、应该加哪条 depends」。

### 2. `scanIgnore`：允许例外，但例外要留字据

真实案例：`m6-map` 里 `const ck=cellKey(...)`，而 `m1-character` 有个顶层 `ck`。静态扫描会把前者误判成"引用了 m1 的 ck"。

处理方式不是加个 `// eslint-disable`，而是在 `modules.json` 里**逐条登记豁免与理由**：

```json
"scanIgnore": {
  "ck": "nav 分块内 const ck=cellKey(...) 是函数局部量；battlemap 的 data-ck 是 HTML 属性名、ch.dataset.ck 是属性访问 —— 三者都不是对 m1-character 顶层 ck 的引用。"
}
```

**豁免必须带原因，否则不接受。** 这比"禁止例外"更能在真实项目里活下去：例外总会发生，关键是让它可审计。

---

## 五、运行时状态

```
APP (localStorage: 'coc_app_v1')
 ├─ accounts{ key → {id, profile, characters[], campaigns[], history[]} }
 ├─ session: 当前登录 key
 └─ characters[] / campaigns[]：带 id、updatedAt、deleted(墓碑)

AI.cfg (localStorage: 'coc_ai_cfg_v1')
 └─ { mode: 'local'|'remote', endpoint, key, model, kp, mate }

auth_token (localStorage)
 └─ 离线：前端自签，仅本地门闩（见 SECURITY.md）
    联机：服务端用 JWT_SECRET 签发
```

云端合并策略：**按 `updatedAt` 做 LWW（last-write-wins）**，删除用墓碑记录而不是物理删除——否则对方设备上的旧副本会在下次同步时把删掉的角色"复活"。

---

## 六、联机后端

```
client ──HTTP──→ server/index.js ──→ db.js（JSON 文件落盘）
   │                  │
   └──WebSocket───────┘  rooms.json：房间 / Token / 墙体 / 视野广播
                      └→ ai-engine.js：/ai/* 守秘人状态机 + 用量记录
```

- REST：注册/登录、角色卡与团本存档、分享链接
- WebSocket：房间内 Token/墙体/视野变更实时广播
- 房间级 Token 权限：玩家只能动自己的 Token，KP 能动全部
- AI 大脑：`ai-engine.js` 维护会话状态与计费，未登录时前端回落本地规则大脑

---

## 七、改动流程

```bash
node build.js            # 构建 → 写 www/index.html（并打印依赖图）
node build.js --check    # 只校验产物是否与 src 同步（CI 用）
node build.js --quiet    # 安静模式
node test/check.js       # 语法哨兵 + 漂移检测（本地/CI 通用）
```

改一个功能的典型路径：

1. 定位功能属于哪个模块哪一块（查本文的模块表，或 `grep` 分块名）
2. 改 `src/mX-*.js`
3. `node build.js` → 若报依赖边错误，去 `modules.json` 补 `depends`（**先想清楚这条依赖是否真的该存在**，很多时候答案是"不该"，那说明你要把代码放到别的模块）
4. `node build.js --check` 确认同步
5. 浏览器打开 `www/index.html` 自测
