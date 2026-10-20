# 安全模型与已知问题

> 这个项目是**跑团工具原型**，不是安全产品。本文如实列出它的安全边界与已知缺陷，
> 避免有人把它当成"能上线的多用户应用"。

---

## 一、安全边界：先说结论

| 场景 | 是否有安全承诺 |
|---|---|
| 单机离线（双击 HTML） | ❌ **无**。所有人身验证都只是本地门闩，可绕过 |
| 自建后端 + 局域网 | ⚠️ **弱**。仅适合信任圈内使用 |
| 公网部署多租户 | ❌ **不要这么做**。当前实现不具备生产级鉴权 |

---

## 二、鉴权是怎么工作的

### 离线模式（前端自签 token）

`src/m5-net.js` 在离线模式下自己签发并校验 token：

- payload 是 `{email, iat, exp}` 的 base64url
- 签名是 `base64url(email + '|' + localSecret())`
- `localSecret()` 在首次运行时生成一个**每设备随机密钥**，存在 `localStorage['coc_local_secret']`

**这不是 JWT，也不构成安全边界。** 它只做两件事：记住"谁登录了"、让换设备时能走不同路径。任何人打开 DevTools 都能改 `localStorage` 绕过它。

> 历史说明：早期版本曾把签名密钥硬编码为仓库内的固定字符串。这导致**任何从该仓库构建的实例都能伪造其他实例的离线身份**。现已改为每设备随机生成，并且**不再随仓库分发密钥**。

### 联机模式（服务端签发）

`server/index.js` 用 `process.env.JWT_SECRET`（或首次运行时生成到 `server/data/.jwt_secret` 的随机值）签发 token，签名覆盖完整 payload（含 `exp`）。

- `JWT_SECRET` 至少 16 字符才会被采用，否则回落随机生成
- `server/data/` 已在 `.gitignore` 中排除，**不要把 `.jwt_secret` 提交进仓库**
- 服务端 token 的签名算法同样很朴素（HMAC-less，`base64url(payload + '|' + secret)`），**依赖 secret 保密而非密码学强度**

---

## 三、已知缺陷（按严重度）

### 🔴 高：密码哈希是无盐 djb2

`hashPwd()` 用 djb2 变体做哈希，**无盐、无迭代、可彩虹表**。同一密码在任何实例上哈希相同。

- **影响**：一旦存档泄漏，密码可被快速破解；且用户跨站复用密码会连带失守
- **现状**：仅用于本机多账号区分，不承载真实身份
- **修法**：服务端换 `argon2` / `bcrypt`，前端不再参与哈希；离线模式直接放弃密码，用本机 profile 切换

### 🟠 中：token 存 `localStorage`

`localStorage` 可被任意同源脚本读取，一旦出现 XSS 即可直接窃取会话。

- **修法**：联机模式改 `httpOnly` + `SameSite=Lax` Cookie；同时消除 XSS 面（见下条）

### 🟠 中：多处 `innerHTML` 拼接渲染

消息、角色名、房间名等用户可控内容经字符串拼进 `innerHTML`。虽然部分路径做了转义，但**没有统一策略**，遗漏点即存储型 XSS。

- **现状**：所有内容都是自己或朋友输入的，风险有限
- **修法**：统一走 `textContent` 或一个 `esc()` 包装；或在 CSP 上加 `script-src 'self'`
- **建议**：部署时务必加 CSP 响应头（见下）

### 🟡 低：无 CSP / 无安全响应头

仓库不含部署配置样板，nginx 需要自己加：

```nginx
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; connect-src 'self' ws: wss: https:;" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "same-origin" always;
```

> 注意 `style-src 'unsafe-inline'` 是当前架构的妥协（大量内联样式），要彻底去掉需重构样式层。

### 🟡 低：`.gitignore` 之外的数据落盘位置

`server/data/*.json` 是明文 JSON（账号、角色卡、房间状态）。自建部署时请确认该目录权限，且**不要放在 Web 根目录下**。

---

## 四、如果你要真上线，最小改动清单

1. 密码哈希换 `argon2`，加盐 + 迭代
2. token 改 `httpOnly` Cookie，加 CSRF token
3. 统一输出转义，消除 `innerHTML` 拼接
4. 加 CSP 与安全响应头
5. 数据落盘从 JSON 文件换 SQLite/Postgres，加事务
6. 房间加入权限服务端强校验（当前部分逻辑依赖前端自律）
7. 加速率限制（登录、房间创建、AI 调用）

---

## 五、报告安全问题

发现漏洞请**不要公开开 issue**。开一个标题为 `[security] 简要描述` 的 issue 只留联系方式，或直接邮件联系维护者，我们会私下跟进并在修复后致谢。

本项目无赏金计划。
