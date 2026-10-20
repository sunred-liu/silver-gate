# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.9.0] — 2026-10-20

首次公开发布。

### 新增
- **源码模块化**：8 模块 / 35 分块 / 395 顶层符号，`src/` → `build.js` → `www/index.html` 单文件产物
- **构建器依赖边校验**：静态扫描符号归属，未声明的跨模块引用直接构建失败；Tarjan 求强连通分量并打印依赖环
- **`scanIgnore` 豁免机制**：豁免必须附带理由，写入 `modules.json`
- **产物漂移哨兵**：`node build.js --check` + `node test/check.js` 三道检查，CI 覆盖 Linux/Windows × Node 20/22
- **零依赖 QR 编码器**（`m7-qr`，9.7KB）：byte 模式 / 纠错 M / v1–9 / 8 掩码按 ISO 18004 罚分择优
- **AI 守秘人三模式**：本地规则大脑（离线可用）/ OpenAI 兼容远程 endpoint / 服务器大脑，失败静默回落本地
- **VBL 视线遮挡与迷雾**：视野多边形 + 通视判定
- **战棋**：多边形墙体编辑（带撤销）、困难地形、房间级 Token 权限、先攻回合、条件标记、战损时间线、框选批量伤害、Dijkstra 寻路 + 移动预算钳制、PNG 导出
- **角色全生命周期**：五标签位 / 命运残片 / 离线成长 / 幕间成长 / T1–T5 阶层
- **联机后端**：REST 鉴权 + WebSocket 房间实时同步 + 云存档 LWW 合并与墓碑删除
- 英中文档、贡献指南、安全问题披露说明

### 安全
- **移除仓库内硬编码的 token 签名密钥**，改为每设备随机生成（`localSecret()`）。
  此前任何从该仓库构建的实例都能伪造其他实例的离线身份。
- `server/data/`、`.jwt_secret`、`*.env` 纳入 `.gitignore`
- 新增 [`docs/SECURITY.md`](docs/SECURITY.md)，如实公开已知缺陷（无盐 djb2 密码哈希、token 存 localStorage、`innerHTML` 拼接、缺 CSP）

### 修复
- **产物行尾统一为 LF**。此前 `build.js` 用 CRLF 拼产物，而 `.gitattributes` 强制 `eol=lf`，
  导致全新克隆后产物体积相差 7,616 字节，字节级漂移哨兵在 CI 上必然误报 `BUILD_DRIFT`
  （本地不报，因为本地文件从未经过一次真实检出）。现已改为 LF，并在比较前对两侧做行尾归一，
  `core.autocrlf` 打开时也不会误报。

### 已知问题
- 7 模块依赖环未消解（`m0-core ↔ m1-character ↔ m2-dice ↔ m3-ai ↔ m4-content ↔ m5-net ↔ m6-map`）
- `m5-net` 同时承担存储与网络，53KB，待拆
- `pick` / `rnd` 物理位置在 `m3-ai.provider`，逻辑上应属 `m0-core`
