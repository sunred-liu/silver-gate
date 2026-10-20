# 如何贡献

先说清楚这个项目想要什么样的贡献，免得你白花时间。

---

## ✅ 非常欢迎

| 方向 | 说明 |
|---|---|
| **拆依赖环** | 引入事件总线，解开 `m0-core ↔ m5-net`、`m1-character → m3-ai/m6-map` 的反向边（见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)） |
| **拆分 m5-net** | 它现在 53KB 同时管存储和网络，该拆成两块 |
| **统一输出转义** | 把散落的 `innerHTML` 拼接收敛到一个 `esc()` 或 `textContent` |
| **移动端手势** | 双指缩放、长按框选、拖拽 Token 的手感 |
| **剧本 DSL** | 让玩家用纯文本写自己的团本 |
| **文档与翻译** | 英文文档、把中文注释译成双语 |
| **QR 编码器抽库** | 它已经是零依赖的，值一个独立的 `npm` 包 |

## ⛔ 请不要

- **引入 React/Vue/Svelte 重写**。单文件零依赖是核心约束，不是技术债。
- **改成多文件部署**（拆成需要 HTTP/2 多路复用的 ES module 树）。产物必须保持单文件。
- **直接改 `www/index.html`**。它是构建产物。
- **加依赖来解决小问题**。加一个 npm 包之前先问：这段逻辑能不能 200 行内自己写完？（QR 编码器 9.7KB 就是这么来的）

---

## 开发流程

```bash
git clone https://github.com/<your-name>/silver-gate.git
cd silver-gate

node build.js            # 构建 → 写 www/index.html，并打印依赖图
node build.js --check    # 只校验产物与源码是否同步
node test/check.js       # 语法哨兵 + 漂移检测（提交前必跑）
```

### 改代码的唯一铁律

**改 `src/`，然后 `node build.js`。永远不要手改 `www/index.html`。**

改完之后：

1. `node build.js` —— 若报 `BOUNDARY` 错，说明你引用了未声明依赖的模块符号。**先去想这条依赖该不该存在**，很多时候答案是"不该"，那就把代码放到正确的模块里，而不是往 `modules.json` 里加一条 `depends`。
2. `node test/check.js` —— 三道检查必须全绿。
3. 浏览器打开 `www/index.html` 自测。

### 提交前自检清单

- [ ] `node test/check.js` 全绿
- [ ] `www/index.html` 已随 `src/` 一起提交（CI 会检查漂移）
- [ ] 没有提交 `server/data/`、`.jwt_secret`、任何 API Key
- [ ] 新增的依赖边在 `modules.json` 里有 `depends`，豁免有 `scanIgnore` 且写了理由
- [ ] 中文注释保留（项目注释是中文的，这是刻意的）

---

## Commit 信息

用中文或英文都行，但要说清"改了什么、为什么"。格式不强制，下面这种就够好：

```
修复: 骰子面板在移动端被键盘顶起后不回落
- m2-dice: doRoll 后加 blur + scrollIntoView
- 顺带把 doRoll 里的重复 setState 合并成一次
```

如果你改了产物（`www/index.html`），在 commit 里说明是 `node build.js` 重新生成的，避免 review 时被误认为是手改。

---

## Issue

- Bug：贴**复现步骤 + 浏览器版本 + 截图**。能复现的最容易修。
- 功能建议：先说清"你跑团时遇到的具体麻烦"，再说方案。方案可以从简。
- 安全问题：**不要公开开 issue 描述细节**，见 [docs/SECURITY.md](docs/SECURITY.md)。

---

## 授权

提交 PR 即表示你同意你的贡献按 [MIT](LICENSE) 授权。
