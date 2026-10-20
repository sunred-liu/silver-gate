/* 银之门 · COC/DND 联机后端
 * HTTP 静态 + REST 鉴权 + WebSocket 房间实时同步 + 统一 SQLite 数据库
 * 数据库承载：登录账户 / 调查员(角色) / 跑团进度 / 剧本库 / 战报
 *
 * 启动： node index.js   （端口见 PORT 或环境变量，默认 8787；node:sqlite 零依赖）
 * 客户端： index.html 中 <meta name="api-base" content="http://<host>/api"> 即开启后端模式
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8787;
const WWW_DIR = path.join(__dirname, '..', 'www');
// 数据目录：线上仍是 server/data；测试用 SG_DATA_DIR / SG_DB_DIR 指到临时目录，互不污染。
// （rooms.json / lfg.json / ai-state.json / ai-usage.log 都落在这里，必须跟 sqlite 用同一个覆盖开关，
//   否则测试跑一次就会把仓库里的 data/ 写脏。）
const DATA_DIR = process.env.SG_DATA_DIR ? path.resolve(process.env.SG_DATA_DIR)
  : process.env.SG_DB_DIR ? path.resolve(process.env.SG_DB_DIR)
  : path.join(__dirname, 'data');
const ROOMS_PATH = path.join(DATA_DIR, 'rooms.json');

const db = require('./db');
const { SCENARIOS } = require('./scenarios');
const report = require('./report');
const dice = require('./dice');
const ai = require('./ai-engine');
ai.init({ dataDir: DATA_DIR, logger: (m) => console.log(m) });

/* ===== 与客户端一致的密钥与哈希方案 ===== */
const JWT_SECRET = (() => {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) return process.env.JWT_SECRET;
  const secPath = path.join(DATA_DIR, '.jwt_secret');
  try { if (fs.existsSync(secPath)) { const sec = fs.readFileSync(secPath, 'utf8').trim(); if (sec) return sec; } } catch (e) {}
  const gen = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(secPath, gen, { mode: 0o600 }); } catch (e) {}
  return gen;
})();
function b64u(s) { return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64d(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); return Buffer.from(s, 'base64').toString('utf8'); }
function signToken(id) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: id, iat: now, exp: now + 60 * 60 * 24 * 7 };
  const data = b64u(JSON.stringify(payload));
  const sig = b64u(data + '|' + JWT_SECRET); // 签名覆盖完整 payload（含 exp），防篡改
  return data + '.' + sig;
}
function verifyToken(t) {
  try {
    const parts = ('' + t).split('.');
    if (parts.length !== 2) return null;
    if (parts[1] !== b64u(parts[0] + '|' + JWT_SECRET)) return null; // 校验完整 payload
    const p = JSON.parse(b64d(parts[0]));
    if (p.exp && p.exp * 1000 < Date.now()) return null;
    return p;
  } catch (e) { return null; }
}
function hashPwd(p) {
  let h = 5381;
  for (let i = 0; i < p.length; i++) h = ((h << 5) + h + p.charCodeAt(i)) >>> 0;
  return 'h' + h.toString(16);
}
function genId(prefix) { return prefix + '-' + crypto.randomBytes(3).toString('hex').toUpperCase(); }
/* 昵称：默认「调查员#XXX」，最多 16 字，去控制字符 */
function genDefaultName() { return '调查员#' + String(100 + Math.floor(Math.random() * 900)); }
function cleanName(v, fallback) {
  let s = String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim();
  if (s.length > 16) s = s.slice(0, 16);
  return s || (fallback || '');
}

/* ===== 持久化：房间（WS 聊天/掷骰，内存+JSON） ===== */
function ensureData() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } }
function writeJSON(file, obj) { ensureData(); fs.writeFileSync(file, JSON.stringify(obj, null, 2)); }
let rooms = readJSON(ROOMS_PATH, {});
function saveRooms() { writeJSON(ROOMS_PATH, rooms); }
ensureData();

/* ===== 集合石（LFG）房间注册表：创建 / 列出 / 密码保护 ===== */
const LFG_PATH = path.join(DATA_DIR, 'lfg.json');
let lfg = readJSON(LFG_PATH, {});
function saveLfg() { writeJSON(LFG_PATH, lfg); }
function lfgPublicView(r) {
  if (!r) return null;
  return {
    id: r.id, title: r.title, scenarioId: r.scenarioId || null, scenarioTitle: r.scenarioTitle || '',
    system: r.system || 'COC', genre: r.genre || '', desc: r.desc || '',
    hostUid: r.hostUid, hostName: r.hostName, status: r.status || 'recruiting',
    hasPassword: !!r.hasPassword, maxPlayers: r.maxPlayers || 5,
    members: (r.members || []).map(m => ({ uid: m.uid, name: m.name })),
    memberCount: (r.members || []).length,
    online: (roomSockets[r.id] && roomSockets[r.id].size) || 0,
    createdAt: r.createdAt || 0
  };
}

function publicUser(a) {
  if (!a) return null;
  return { id: a.id, email: a.email || null, phone: a.phone || null, name: a.name, provider: a.provider || 'password' };
}
function authed(req) {
  const t = verifyToken(getTokenFromReq(req));
  if (!t || !t.sub) return null;
  return db.getAccountById(t.sub) || null;
}

/* SMS 验证码（演示用，内存存储，5 分钟有效） */
const smsCodes = {};
function genCode() { return String(100000 + Math.floor(Math.random() * 900000)); }

/* 忘记密钥的重置码。没有邮件/短信通道，所以码不走网络下发：
   服务端只在日志里打一行（grep 得到），由站点管理员转达给本人；
   接口一律返回"已受理"，不区分邮箱是否存在，避免被用来枚举账号。 */
const resetCodes = {};
function issueResetCode(email) {
  const t0 = Date.now();
  for (const k of Object.keys(resetCodes)) if (resetCodes[k].exp < t0) delete resetCodes[k]; // 顺手清理
  const code = genCode();
  resetCodes[email] = { code, exp: t0 + 30 * 60 * 1000, tries: 0 };
  console.log(`[银之门·重置码] email=${email} code=${code} 有效期30分钟`);
  return code;
}

/* ===== HTTP 请求体解析 ===== */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,PATCH' });
  res.end(body);
}
function getTokenFromReq(req) {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

/* ===== 启动播种：演示账户 + 剧本库 ===== */
function seedIfEmpty() {
  if (db.countScenarios() === 0) {
    for (const s of SCENARIOS) db.insertScenario(s);
    console.log('  [seed] 已写入剧本库：' + SCENARIOS.length + ' 个');
  }
  db.seedCompendiumIfEmpty();
  if (!db.getAccountByEmail('run@sg.local')) {
    db.createAccount({ id: genId('INV'), email: 'run@sg.local', name: '调查员run', pwd: hashPwd('123456'), provider: 'password' });
  }
  if (!db.getAccountByEmail('kp_session@silvergate.local')) {
    db.createAccount({ id: genId('INV'), email: 'kp_session@silvergate.local', name: '守秘人KP', pwd: hashPwd('Cthulhu2026!'), provider: 'password' });
  }
}
seedIfEmpty();

/* ===== REST API ===== */
async function handleApi(req, res, url) {
  const p = url.pathname;
  if (req.method === 'OPTIONS') { sendJSON(res, 204, {}); return; }

  /* ---------- 鉴权 ---------- */
  if (p === '/api/auth/register' && req.method === 'POST') {
    const { email, password, name } = await readBody(req);
    if (!email || !password || password.length < 6) return sendJSON(res, 400, { error: '邮箱与至少 6 位安全密钥必填' });
    const key = String(email).toLowerCase();
    if (db.getAccountByEmail(key)) return sendJSON(res, 409, { error: '该邮箱已注册，请直接登录' });
    const id = genId('INV');
    const acc = db.createAccount({ id, email: key, name: cleanName(name, genDefaultName()), pwd: hashPwd(password), provider: 'password' });
    return sendJSON(res, 200, { token: signToken(id), user: publicUser(acc) });
  }

  if (p === '/api/auth/login' && req.method === 'POST') {
    const { email, password } = await readBody(req);
    const key = String(email || '').toLowerCase();
    const a = db.getAccountByEmail(key);
    if (!a || a.pwd !== hashPwd(password || '')) return sendJSON(res, 401, { error: '邮箱或安全密钥错误' });
    return sendJSON(res, 200, { token: signToken(a.id), user: publicUser(a) });
  }

  if (p === '/api/auth/me' && req.method === 'GET') {
    const a = authed(req);
    if (!a) return sendJSON(res, 401, { error: '未登录' });
    return sendJSON(res, 200, { user: publicUser(a) });
  }

  if (p === '/api/auth/profile' && req.method === 'POST') {
    const a = authed(req);
    if (!a) return sendJSON(res, 401, { error: '未登录' });
    const body = await readBody(req);
    const nm = cleanName(body && body.name, '');
    if (!nm) return sendJSON(res, 400, { error: '昵称不能为空' });
    db.setAccountName(a.id, nm);
    return sendJSON(res, 200, { user: publicUser(db.getAccountById(a.id)) });
  }

  if (p === '/api/auth/reset' && req.method === 'POST') {
    const { email } = await readBody(req);
    const key = String(email || '').toLowerCase();
    // 只对存在的账号发码；但响应不区分存在与否（防账号枚举）
    if (db.getAccountByEmail(key)) issueResetCode(key);
    return sendJSON(res, 200, { ok: true, message: '已受理重置申请' });
  }

  /* 凭重置码设置新密钥；成功后直接发 token，省一次登录 */
  if (p === '/api/auth/reset/confirm' && req.method === 'POST') {
    const { email, code, newPassword } = await readBody(req);
    const key = String(email || '').toLowerCase();
    const np = String(newPassword || '');
    const bad = { error: '重置码无效或已过期，请重新申请' };
    if (!np || np.length < 6) return sendJSON(res, 400, { error: '新安全密钥至少 6 位' });
    const rec = resetCodes[key];
    if (!rec || rec.exp < Date.now()) return sendJSON(res, 400, bad);
    if (rec.tries >= 5) { delete resetCodes[key]; return sendJSON(res, 429, { error: '尝试次数过多，请重新申请重置码' }); }
    if (rec.code !== String(code || '').trim()) { rec.tries++; return sendJSON(res, 400, { error: '重置码不正确' }); }
    const a = db.getAccountByEmail(key);
    if (!a) return sendJSON(res, 400, bad);
    db.setAccountPassword(a.id, hashPwd(np));
    delete resetCodes[key];
    console.log(`[银之门·重置码] email=${key} 已重置成功`);
    return sendJSON(res, 200, { ok: true, token: signToken(a.id), user: publicUser(db.getAccountById(a.id)) });
  }

  /* 改密钥（需登录）：必须验原密钥，避免拿到 token 就能改号 */
  if (p === '/api/auth/password' && req.method === 'POST') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    const b = await readBody(req);
    const oldP = String(b.oldPassword || ''), newP = String(b.newPassword || '');
    if (a.provider !== 'password' || !a.pwd) return sendJSON(res, 400, { error: '该账号使用第三方登录，没有安全密钥可改' });
    if (!newP || newP.length < 6) return sendJSON(res, 400, { error: '新安全密钥至少 6 位' });
    if (a.pwd !== hashPwd(oldP)) return sendJSON(res, 401, { error: '原安全密钥不正确' });
    db.setAccountPassword(a.id, hashPwd(newP));
    console.log(`[银之门·密钥] ${a.id} 已修改安全密钥`);
    return sendJSON(res, 200, { ok: true });
  }

  if (p === '/api/auth/sms/send' && req.method === 'POST') {
    const { phone } = await readBody(req);
    if (!/^1[3-9]\d{9}$/.test(phone || '')) return sendJSON(res, 400, { error: '手机号格式不正确' });
    const code = genCode();
    smsCodes[phone] = { code, exp: Date.now() + 5 * 60 * 1000 };
    return sendJSON(res, 200, { ok: true, devCode: code });
  }

  if (p === '/api/auth/sms/verify' && req.method === 'POST') {
    const { phone, code } = await readBody(req);
    const rec = smsCodes[phone];
    if (!rec || rec.code !== String(code) || rec.exp < Date.now()) return sendJSON(res, 401, { error: '验证码无效或已过期' });
    delete smsCodes[phone];
    const key = 'phone:' + phone;
    let a = db.getAccountByPhone(phone);
    if (!a) a = db.createAccount({ id: genId('INV'), email: null, phone, name: '调查员' + phone.slice(-4), pwd: null, provider: 'phone' });
    return sendJSON(res, 200, { token: signToken(a.id), user: publicUser(a) });
  }

  /* ---------- 剧本库 ---------- */
  if (p === '/api/scenarios' && req.method === 'GET') {
    const sys = url.searchParams.get('system');
    const mine = url.searchParams.get('mine') === '1';
    const a = authed(req);
    if (mine && !a) return sendJSON(res, 401, { error: '未登录' });
    return sendJSON(res, 200, { scenarios: db.listScenarios(sys, mine, a && a.id) });
  }
  if (p === '/api/scenarios' && req.method === 'POST') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    const b = await readBody(req);
    if (!b.title || !b.system) return sendJSON(res, 400, { error: '标题与规则体系必填' });
    const scn = db.insertScenario({
      id: genId('SCN'), system: b.system === 'dnd' ? 'dnd' : 'coc',
      title: String(b.title).slice(0, 80), tagline: (b.tagline || '').slice(0, 200),
      premise: b.premise || '', structure: Array.isArray(b.structure) ? b.structure : (b.acts || []),
      estimated_minutes: Number(b.estimatedMinutes) || 120, hard_cap_hours: b.hardCapHours ?? null,
      completion_type: b.completionType || 'required', tags: Array.isArray(b.tags) ? b.tags : [],
      content: b.content || '', author: a.id, is_custom: 1, created_at: Date.now()
    });
    return sendJSON(res, 200, { scenario: scn });
  }
  let m = p.match(/^\/api\/scenarios\/([\w-]+)$/);
  if (m && req.method === 'GET') {
    const s = db.getScenario(m[1]);
    if (!s) return sendJSON(res, 404, { error: '剧本不存在' });
    return sendJSON(res, 200, { scenario: s });
  }

  /* ---------- 调查员 / 角色卡（需登录） ---------- */
  if (p === '/api/investigators' && req.method === 'POST') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    const raw = await readBody(req);
    /* 宽容解包：老客户端习惯套一层 {investigator:{...}} 或 {card:{...}}。
       但绝不再「静默落成无名调查员」—— 实测套错外层会拿到 200 + 一张空卡，
       调用方以为自己成功了。200 + 空字段比 400 危险得多，所以这里直接拒。 */
    const b = Object.assign({}, (raw && (raw.investigator || raw.card)) || raw || {});
    const nm = String(b.name == null ? '' : b.name).trim();
    if (!nm) {
      return sendJSON(res, 400, {
        error: '缺少角色名（name）',
        hint: '请求体应直接是角色卡对象，至少含 name；occupation / attrs / skills 建议一并提供。',
        got: (raw && typeof raw === 'object') ? Object.keys(raw).slice(0, 12) : typeof raw
      });
    }
    b.name = nm.slice(0, 60);
    const card = Object.assign({}, b);
    if (!card.id) card.id = genId('INV');
    if (!card.updatedAt) card.updatedAt = Date.now();
    const saved = db.upsertInvestigator(db.normalizeInvestigatorRecord(card, a.id));
    return sendJSON(res, 200, { investigator: saved });
  }
  if (p === '/api/investigators' && req.method === 'GET') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    return sendJSON(res, 200, { investigators: db.listInvestigators(a.id) });
  }

  /* ---------- 角色卡云端同步（H5 换设备不丢档） ----------
     客户端把本地改动推上来，服务端按 updatedAt 做 LWW 合并，再把权威全量回吐。
     删除走墓碑（deleted_at），否则离线编辑回传会把已删角色复活。
     一次请求完成 push+pull，避免两次往返之间的窗口期丢数据。 */
  if (p === '/api/investigators/sync' && req.method === 'POST') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    const b = await readBody(req);
    const incoming = Array.isArray(b.characters) ? b.characters : [];
    const deletions = (b.deletions && typeof b.deletions === 'object') ? b.deletions : {};
    const since = Number(b.since) || 0;
    let pushed = 0, skipped = 0;

    for (const card of incoming) {
      if (!card || !card.id) continue;
      const cur = db.getInvestigator(card.id);
      if (!cur) {
        db.upsertInvestigator(db.normalizeInvestigatorRecord(card, a.id));
        pushed++; continue;
      }
      if (cur.userId && cur.userId !== a.id) { skipped++; continue; }  // 别人的卡，不碰
      const incTs = Number(card.updatedAt || 0);
      const srvTs = Number(cur.updatedAt || 0);
      if (cur.deletedAt && Number(cur.deletedAt) >= incTs) { skipped++; continue; } // 服务端删除更新
      if (incTs >= srvTs) {
        const rec = db.normalizeInvestigatorRecord(card, a.id);
        rec.updated_at = incTs || Date.now();
        rec.created_at = cur.createdAt || rec.created_at;
        db.upsertInvestigator(rec);
        pushed++;
      } else skipped++;
    }

    let deleted = 0;
    for (const id of Object.keys(deletions)) {
      if (!id || !id.startsWith('INV')) continue;
      const ts = Number(deletions[id]) || Date.now();
      const cur = db.getInvestigator(id);
      if (!cur) {
        // 本地新建后又被删（从未上传）：只留墓碑，让其他设备也清掉
        db.upsertInvestigator({ id, user_id: a.id, name: '（已删除）', updated_at: ts, deleted_at: ts, created_at: ts });
        deleted++; continue;
      }
      if (cur.userId && cur.userId !== a.id) continue;
      if (Number(cur.deletedAt || 0) >= ts) continue;
      if (Number(cur.updatedAt || 0) > ts) continue;   // 服务端有更新的编辑 → 删除作废
      db.softDeleteInvestigator(id, a.id, ts);
      deleted++;
    }

    const alive = db.listInvestigators(a.id);
    const tombstones = db.listInvestigators(a.id, { includeDeleted: true })
      .filter(r => r.deletedAt).map(r => ({ id: r.id, deletedAt: r.deletedAt }));
    return sendJSON(res, 200, {
      characters: alive, tombstones, serverTime: Date.now(), since,
      stats: { pushed, skipped, deleted, pulled: alive.length }
    });
  }

  /* 删除角色（软删 + 墓碑） */
  m = p.match(/^\/api\/investigators\/([\w-]+)$/);
  if (m && req.method === 'DELETE') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    const r = db.softDeleteInvestigator(m[1], a.id);
    if (r === null) return sendJSON(res, 404, { error: '调查员不存在' });
    if (r === false) return sendJSON(res, 403, { error: '无权删除该角色' });
    return sendJSON(res, 200, { ok: true, id: m[1], deletedAt: r.deletedAt });
  }
  m = p.match(/^\/api\/investigators\/([\w-]+)\/reports$/);
  if (m && req.method === 'GET') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    const list = db.listReportsByInvestigator(m[1]);
    return sendJSON(res, 200, { reports: list.map(r => ({ id: r.id, campaignId: r.campaignId, generatedAt: r.generatedAt, summary: r.summary })) });
  }
  m = p.match(/^\/api\/investigators\/([\w-]+)$/);
  if (m && req.method === 'GET') {
    const inv = db.getInvestigator(m[1]);
    if (!inv) return sendJSON(res, 404, { error: '调查员不存在' });
    return sendJSON(res, 200, { investigator: inv });
  }

  /* ---------- 公开只读：被分享出去的角色卡（无需登录） ----------
     扫卡片二维码的人不该被弹到登录页——看不到东西就谈不上传播。
     只回展示所需字段，剥掉 userId 等账号关联；已撤回（软删）的一律 404。
     注意：凭 id 即可读，所以 id 是不可猜的随机串，且页面只展示角色卡本身。 */
  m = p.match(/^\/api\/public\/investigator\/([\w-]+)$/);
  if (m && req.method === 'GET') {
    const inv = db.getInvestigator(m[1]);
    if (!inv || inv.deletedAt) return sendJSON(res, 404, { error: '这张角色卡不存在或已被主人撤回' });
    const safe = Object.assign({}, inv);
    delete safe.userId;
    delete safe.deletedAt;
    return sendJSON(res, 200, { investigator: safe, shared: true });
  }

  /* ---------- 团本 / 跑团进度（需登录） ---------- */
  if (p === '/api/campaigns' && req.method === 'POST') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    const b = await readBody(req);
    const rec = {
      id: genId('CMP'), user_id: a.id, scenario_id: b.scenarioId || null, system: b.system || 'coc',
      title: b.title || '未命名团本', investigator_ids: b.investigatorIds || [],
      status: b.status || 'lobby', progress: b.progress || {},
      kpMode: b.kpMode || 'human', redlines: b.redlines || null, era: b.era || '', host: b.host || '',
      started_at: Date.now()
    };
    const saved = db.insertCampaign(rec);
    return sendJSON(res, 200, { campaign: saved });
  }
  if (p === '/api/campaigns' && req.method === 'GET') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    return sendJSON(res, 200, { campaigns: db.listCampaigns(a.id) });
  }

  /* ---------- 团本云端同步（换设备不丢团） ----------
     与角色卡同一套模型：客户端推本地改动，服务端按 updatedAt 做 LWW 合并，
     再把权威全量回吐；删除走墓碑，避免离线设备把已删团本复活。
     注意：这条必须排在 /api/campaigns/:id 的正则之前，否则 "sync" 会被当成团本 id。 */
  if (p === '/api/campaigns/sync' && req.method === 'POST') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    const b = await readBody(req);
    const incoming = Array.isArray(b.campaigns) ? b.campaigns : [];
    const deletions = (b.deletions && typeof b.deletions === 'object') ? b.deletions : {};
    const since = Number(b.since) || 0;
    let pushed = 0, skipped = 0;

    for (const camp of incoming) {
      if (!camp || !camp.id) continue;
      const cur = db.getCampaign(camp.id);
      if (!cur) { db.upsertCampaign(db.normalizeCampaignRecord(camp, a.id)); pushed++; continue; }
      if (cur.userId && cur.userId !== a.id) { skipped++; continue; }        // 别人的团，不碰
      const incTs = Number(camp.updatedAt || 0);
      const srvTs = Number(cur.updatedAt || 0);
      if (cur.deletedAt && Number(cur.deletedAt) >= incTs) { skipped++; continue; }
      if (incTs >= srvTs) {
        const rec = db.normalizeCampaignRecord(camp, a.id);
        rec.updated_at = incTs || Date.now();
        rec.started_at = cur.startedAt || rec.started_at;
        db.upsertCampaign(rec);
        pushed++;
      } else skipped++;
    }

    let deleted = 0;
    for (const id of Object.keys(deletions)) {
      if (!id || !id.startsWith('CMP')) continue;
      const ts = Number(deletions[id]) || Date.now();
      const cur = db.getCampaign(id);
      if (!cur) {
        db.upsertCampaign({ id, user_id: a.id, title: '（已删除）', updated_at: ts, deleted_at: ts, started_at: ts });
        deleted++; continue;
      }
      if (cur.userId && cur.userId !== a.id) continue;
      if (Number(cur.deletedAt || 0) >= ts) continue;
      if (Number(cur.updatedAt || 0) > ts) continue;    // 服务端有更新的编辑 → 删除作废
      db.softDeleteCampaign(id, a.id, ts);
      deleted++;
    }

    const alive = db.listCampaigns(a.id);
    const tombstones = db.listCampaigns(a.id, { includeDeleted: true })
      .filter(r => r.deletedAt).map(r => ({ id: r.id, deletedAt: r.deletedAt }));
    return sendJSON(res, 200, {
      campaigns: alive, tombstones, serverTime: Date.now(), since,
      stats: { pushed, skipped, deleted, pulled: alive.length }
    });
  }

  /* 删除团本（软删 + 墓碑）：同样排在 :id 之前 */
  m = p.match(/^\/api\/campaigns\/([\w-]+)\/delete$/);
  if (m && req.method === 'POST') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    const b = await readBody(req).catch(() => ({}));
    const r = db.softDeleteCampaign(m[1], a.id, Number(b && b.ts) || undefined);
    if (r === null) return sendJSON(res, 404, { error: '团本不存在' });
    if (r === false) return sendJSON(res, 403, { error: '无权删除该团本' });
    return sendJSON(res, 200, { ok: true, id: m[1] });
  }
  m = p.match(/^\/api\/campaigns\/([\w-]+)\/reports$/);
  if (m && req.method === 'GET') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    const camp = db.getCampaign(m[1]);
    if (!camp || camp.userId !== a.id) return sendJSON(res, 404, { error: '团本不存在' });
    const list = db.listReportsByCampaign(m[1]);
    return sendJSON(res, 200, { reports: list.map(r => ({ id: r.id, investigatorId: r.investigatorId, generatedAt: r.generatedAt, summary: r.summary })) });
  }
  m = p.match(/^\/api\/campaigns\/([\w-]+)\/complete$/);
  if (m && req.method === 'POST') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    const camp = db.getCampaign(m[1]);
    if (!camp) return sendJSON(res, 404, { error: '团本不存在' });
    if (camp.userId !== a.id) return sendJSON(res, 403, { error: '无权操作该团本' });
    const completed = db.updateCampaign(m[1], { status: 'done', completedAt: Date.now() });
    const invId = (completed.investigatorIds && completed.investigatorIds[0]) || null;
    const inv = invId ? db.getInvestigator(invId) : null;
    const scn = completed.scenarioId ? db.getScenario(completed.scenarioId) : null;
    const { summary, htmlPath } = report.generateReport({ campaign: completed, investigator: inv, investigators: (completed.investigatorIds || []).map(id => db.getInvestigator(id)).filter(Boolean), scenario: scn, user: publicUser(a), completedAt: Date.now(), map: (rooms[m[1]] && rooms[m[1]].map) ? rooms[m[1]].map : null, messages: (rooms[m[1]] && rooms[m[1]].messages) ? rooms[m[1]].messages.slice() : [] });
    const rpt = db.insertReport({
      id: genId('RPT'), campaign_id: completed.id, investigator_id: invId, user_id: a.id,
      generated_at: Date.now(), summary, html_path: htmlPath
    });
    return sendJSON(res, 200, { report: { id: rpt.id, summary, htmlPath }, campaign: completed });
  }

  /* ---------- 聊天室消息（REST 轮询，移动端；与 WS 共用 rooms.json 持久化） ---------- */
  m = p.match(/^\/api\/campaigns\/([\w-]+)\/messages$/);
  if (m && req.method === 'GET') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    const room = rooms[m[1]] || { messages: [] };
    const since = Number(url.searchParams.get('since') || 0);
    const list = room.messages.filter(x => (x.ts || 0) >= since);
    return sendJSON(res, 200, { messages: list, serverTime: Date.now() });
  }
  if (m && req.method === 'POST') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    const b = await readBody(req);
    if (!rooms[m[1]]) rooms[m[1]] = { messages: [] };
    const text = String(b.text || '').slice(0, 1000);
    if (!text) return sendJSON(res, 400, { error: '消息不能为空' });
    const role = b.role === 'kp' ? 'kp' : 'me';
    const kind = b.kind === 'system' ? 'system' : 'msg';
    const msg = { id: genId('MSG'), t: kind, who: a.name, role, ava: role, text, ts: Date.now() };
    rooms[m[1]].messages.push(msg);
    if (rooms[m[1]].messages.length > 300) rooms[m[1]].messages.shift();
    saveRooms();
    broadcast(m[1], { type: 'chat', from: a.id, name: a.name, text, ts: msg.ts, id: msg.id, role }, null);
    return sendJSON(res, 200, { message: msg });
  }

  /* ---------- 战术地图同步（KP 推送战场 → 全房间共享；与 WS map 消息兼容） ---------- */
  m = p.match(/^\/api\/campaigns\/([\w-]+)\/map$/);
  if (m && req.method === 'GET') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    const camp = db.getCampaign(m[1]);
    if (!camp || camp.userId !== a.id) return sendJSON(res, 404, { error: '团本不存在' });
    const room = rooms[m[1]] || {};
    return sendJSON(res, 200, { map: room.map || null });
  }
  if (m && req.method === 'POST') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    const camp = db.getCampaign(m[1]);
    if (!camp || camp.userId !== a.id) return sendJSON(res, 403, { error: '无权操作该团本' });
    const b = await readBody(req);
    const map = b.map || b;
    if (!rooms[m[1]]) rooms[m[1]] = { messages: [] };
    rooms[m[1]].map = map;
    saveRooms();
    broadcast(m[1], { type: 'map', map }, null);
    return sendJSON(res, 200, { ok: true, map });
  }

  /* ---------- 房间成员（供 GM 授权 Token 控制权时选择玩家） ---------- */
  m = p.match(/^\/api\/rooms\/([\w:-]+)\/members$/);
  if (m && req.method === 'GET') {
    // 成员列表为房间内 presence（WS 已向成员广播），REST 仅作镜像，故仅校验登录、
    // 不强制团本归属——与 WS 房间共享模型一致；团本 id 为 UUID，枚举成本低。
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    const set = roomSockets[m[1]];
    const members = []; const seen = new Set();
    if (set) set.forEach(ws => {
      const key = String(ws.ukey || ws.uname || ws.uid || '');
      if (!key || seen.has(key)) return;
      seen.add(key);
      members.push({ key, name: ws.uname || key, uid: String(ws.uid || '') });
    });
    return sendJSON(res, 200, { members, gmUid: (rooms[m[1]] && rooms[m[1]].gmUid) || null, setup: (rooms[m[1]] && rooms[m[1]].setup) || null });
  }

  /* ============================================================
     AI 守秘人 / AI 队友 —— 预留层（模拟 Provider + 真实模型接缝）
     ------------------------------------------------------------
     契约见 ai-engine.js 顶部注释（ai.reply.v1）。四个端点分工：
       GET  .../ai/state  → 看当前剧本游标（幕/拍/线索账本），调试用
       POST .../ai/start  → 绑定剧本、指定队友，开一场
       POST .../ai/think  → 产出一轮「思维 + 发言选项」，**不写聊天室**
       POST .../ai/say    → 采纳其中一条（或自由输入）→ 写聊天室并广播
       POST .../ai-roll   → 旧接口，改为走引擎（保持向后兼容）
     结算走 /ai/say 之后由引擎自行推进，前端不需要懂剧本。
     ============================================================ */
  function aiCamp(m, req, res) {
    const a = authed(req); if (!a) { sendJSON(res, 401, { error: '未登录' }); return null; }
    const camp = db.getCampaign(m[1]);
    if (camp) return { a, camp };
    /* 集合石房间（LFG-xxx）没有团本档案：合成一个**只存在于 AI 会话里**的临时团本，
       不写 DB —— 这样 AI 引擎照样能绑定剧本、维护线索账本、做限流，
       又不会在玩家的「我的团本」列表里留下垃圾条目。
       （注意：仍然先查 DB，所以真实的 CMP- 团本与「团本不存在 → 404」的行为不变。） */
    if (/^LFG-/.test(m[1]) || /^LOCAL-/.test(m[1])) {
      return { a, camp: { id: m[1], title: '集合石房间 ' + m[1], system: 'coc', scenarioId: null, userId: a.id, ephemeral: true } };
    }
    sendJSON(res, 404, { error: '团本不存在' });
    return null;
  }
  function recentLog(campId) {
    const r = rooms[campId];
    return ((r && r.messages) || []).slice(-12)
      .filter(x => x && (x.t === 'msg' || x.t === 'sys'))
      .map(x => ({ who: x.who || (x.t === 'sys' ? '*' : '?'), text: String(x.text || '').slice(0, 200) }));
  }
  function pushRoomMessage(campId, msg) {
    if (!rooms[campId]) rooms[campId] = { messages: [] };
    rooms[campId].messages.push(msg);
    if (rooms[campId].messages.length > 300) rooms[campId].messages.shift();
    saveRooms();
  }

  /* 剧本游标 + 线索账本（调试 / 导演面板用；不含真相） */
  m = p.match(/^\/api\/campaigns\/([\w-]+)\/ai\/state$/);
  if (m && req.method === 'GET') {
    const ctx = aiCamp(m, req, res); if (!ctx) return;
    const scnRec = ctx.camp.scenarioId ? db.getScenario(ctx.camp.scenarioId) : null;
    const script = ai.resolveScript(ctx.camp, scnRec);
    const st = ai.getState(ctx.camp.id);
    return sendJSON(res, 200, {
      contract: ai.CONTRACT, engine: ai.ENGINE_VERSION, provider: ai.activeProvider(),
      script: { id: script.id, title: script.title, system: script.system, tags: script.tags, acts: script.structure.length, beats: script.beatTotal, estimated: script.estimated },
      cursor: ai.cursorOf(script, st || { act: 0, beat: 0 }),
      started: !!st, mates: (st && st.mates) || [],
      session: st ? { turns: st.turns, clock: st.clock, dread: st.dread, danger: st.danger, offScriptStreak: st.offScriptStreak, ended: st.ended, cluesDrawn: (st.clueIdsDrawn || []).length } : null,
      usage: ai.usageSnapshot(),
      ai: ai.aiHealth()
    });
  }

  /* 开一场：绑定剧本（可覆盖），指定/随机 AI 队友 */
  m = p.match(/^\/api\/campaigns\/([\w-]+)\/ai\/start$/);
  if (m && req.method === 'POST') {
    const ctx = aiCamp(m, req, res); if (!ctx) return;
    const b = await readBody(req);
    const scnRec = (b.scenarioId ? db.getScenario(b.scenarioId) : null) || (ctx.camp.scenarioId ? db.getScenario(ctx.camp.scenarioId) : null);
    const script = ai.resolveScript(ctx.camp, scnRec);
    if (b.reset === false) ai.ensureState(ctx.camp, script, { mates: b.mates, mateCount: b.mateCount });
    else ai.startSession(ctx.camp, script, { mates: b.mates, mateCount: b.mateCount });
    const st = ai.getState(ctx.camp.id);
    pushRoomMessage(ctx.camp.id, {
      id: genId('MSG'), t: 'sys', who: '系统', role: 'sys', ava: 'sys', ai: true,
      text: `— 剧本已装载：${script.title}（${script.id}）｜${script.structure.length} 幕 / ${script.beatTotal} 拍 —` +
        (st.mates.length ? `AI 队友：${st.mates.map(x => x.name + '(' + x.occupation + ')').join('、')}` : ''),
      ts: Date.now()
    });
    broadcast(ctx.camp.id, { type: 'chat', sys: true, text: rooms[ctx.camp.id].messages.slice(-1)[0].text, ts: Date.now() }, null);
    return sendJSON(res, 200, {
      ok: true, script: { id: script.id, title: script.title, tags: script.tags, acts: script.structure.length, beats: script.beatTotal },
      mates: st.mates, provider: ai.activeProvider()
    });
  }

  /* 产出一轮「思维 + 发言选项」。不写聊天室：这是预留态，采纳与否由 /ai/say 决定。 */
  m = p.match(/^\/api\/campaigns\/([\w-]+)\/ai\/think$/);
  if (m && req.method === 'POST') {
    const ctx = aiCamp(m, req, res); if (!ctx) return;
    const q = ai.consumeQuota(ctx.a.id);
    if (!q.ok) return sendJSON(res, 429, { error: `今日 AI 调用已达上限（${q.limit} 次），明天再来`, used: q.used, limit: q.limit });
    const b = await readBody(req);
    const scnRec = (b.scenarioId ? db.getScenario(b.scenarioId) : null) || (ctx.camp.scenarioId ? db.getScenario(ctx.camp.scenarioId) : null);
    const out = await ai.think({
      camp: ctx.camp, scenario: scnRec,
      playerText: b.text || b.prompt || '',
      voices: Array.isArray(b.voices) && b.voices.length ? b.voices : ['kp', 'mate'],
      mateCount: b.mateCount, mates: b.mates,
      recentLog: recentLog(ctx.camp.id),
      uid: ctx.a.id
    });
    return sendJSON(res, 200, Object.assign(out, { quota: { used: q.used, limit: q.limit } }));
  }

  /* 采纳一条发言选项 → 进聊天室 + 广播。skill 有值则同时抛出检定要求。 */
  m = p.match(/^\/api\/campaigns\/([\w-]+)\/ai\/say$/);
  if (m && req.method === 'POST') {
    const ctx = aiCamp(m, req, res); if (!ctx) return;
    const b = await readBody(req);
    const st = ai.getState(ctx.camp.id);
    if (!st) return sendJSON(res, 409, { error: '本团还没装载剧本，请先调用 /ai/start' });
    const voice = String(b.voice || 'kp');
    const adopted = ai.adoptOption(voice, b.optionId, ctx.camp.id, b.text);
    if (!adopted) return sendJSON(res, 400, { error: '没有可发言的内容（optionId 未命中且 text 为空）' });

    const isKp = voice === 'kp';
    const mate = isKp ? null : (st.mates || [])[Number(String(voice).replace(/\D/g, '') || 0)] || null;
    const who = isKp ? 'AI 守秘人' : ((mate && mate.name) || 'AI 队友');
    const msg = {
      id: genId('MSG'), t: 'msg', who, role: isKp ? 'kp' : 'ai', ava: 'ai',
      text: adopted.text, ts: Date.now(), ai: true
    };
    pushRoomMessage(ctx.camp.id, msg);
    broadcast(ctx.camp.id, { type: 'chat', from: 'ai', name: who, text: adopted.text, ts: msg.ts, id: msg.id, role: msg.role, ai: true }, null);

    // 采纳了带检定的选项：额外抛一条系统提示，并对线索类目记账（三线索法则计数）
    if (adopted.skill) {
      const line = `🎲 ${who}要求【${adopted.skill}】检定（${adopted.diff === 'hard' ? '困难' : adopted.diff === 'ext' ? '极难' : '普通'}）— 掷出结果将影响后续。`;
      pushRoomMessage(ctx.camp.id, { id: genId('MSG'), t: 'sys', who: '系统', role: 'sys', ava: 'sys', ai: true, text: line, ts: Date.now() });
      broadcast(ctx.camp.id, { type: 'chat', sys: true, text: line, ts: Date.now() }, null);
    }
    if (adopted.kind === 'clue' || adopted.kind === 'npc') ai.recordDrawnClue(ctx.camp.id, adopted.text, adopted.clueIndex);
    return sendJSON(res, 200, {
      ok: true, message: msg,
      check: adopted.skill ? { skill: adopted.skill, diff: adopted.diff, reason: adopted.kind } : null,
      ledger: (() => { const scnRec = ctx.camp.scenarioId ? db.getScenario(ctx.camp.scenarioId) : null; const s = ai.resolveScript(ctx.camp, scnRec); return ai._internal.ledgerOf(s, ai.getState(ctx.camp.id)); })()
    });
  }

  /* ---------- 旧接口：AI 守秘人推演（kp_mode=ai 时使用） ---------- */
  m = p.match(/^\/api\/campaigns\/([\w-]+)\/ai-roll$/);
  if (m && req.method === 'POST') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    const camp = db.getCampaign(m[1]);
    if (!camp) return sendJSON(res, 404, { error: '团本不存在' });
    // 旧接口同样计入限流，否则它会成为绕过配额的后门
    const q = ai.consumeQuota(a.id);
    if (!q.ok) return sendJSON(res, 429, { error: `今日 AI 调用已达上限（${q.limit} 次），明天再来`, used: q.used, limit: q.limit });
    const b = await readBody(req);
    const prompt = String(b.prompt || '').slice(0, 600);
    // 走引擎：先产出「思维 + 候选发言」，再自动采纳推荐项（保持旧行为：一次调用出一条发言）
    const scnRec = camp.scenarioId ? db.getScenario(camp.scenarioId) : null;
    const out = await ai.think({ camp, scenario: scnRec, playerText: prompt, voices: ['kp'], recentLog: recentLog(camp.id), uid: a.id });
    const rec = (out.kp && (out.kp.options.find(o => o.recommended) || out.kp.options[0])) || null;
    const reply = (rec && rec.text) || '守秘人凝视着你们，等待下一步行动。';
    const adopted = ai.adoptOption('kp', rec && rec.id, camp.id, reply) || { text: reply, kind: 'free' };
    if (!rooms[m[1]]) rooms[m[1]] = { messages: [] };
    const msg = { id: genId('MSG'), t: 'msg', who: 'AI 守秘人', role: 'kp', ava: 'ai', text: adopted.text, ts: Date.now(), ai: true };
    rooms[m[1]].messages.push(msg);
    if (rooms[m[1]].messages.length > 300) rooms[m[1]].messages.shift();
    saveRooms();
    broadcast(m[1], { type: 'chat', from: 'ai', name: 'AI 守秘人', text: adopted.text, ts: msg.ts, id: msg.id, role: 'kp', ai: true }, null);
    if (adopted.kind === 'clue' || adopted.kind === 'npc') ai.recordDrawnClue(m[1], adopted.text, adopted.clueIndex);
    return sendJSON(res, 200, {
      message: msg,
      thinking: out.kp ? out.kp.thinking : [],
      options: out.kp ? out.kp.options : [],
      scene: out.scene, mood: out.mood, ledger: out.ledger,
      provider: out.provider, contract: out.contract
    });
  }

  /* ---------- 骰子 / 检定（后端求值，持久化到聊天室；与 WS dice 消息兼容） ---------- */
  m = p.match(/^\/api\/campaigns\/([\w-]+)\/roll$/);
  if (m && req.method === 'POST') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    if (!db.getCampaign(m[1])) return sendJSON(res, 404, { error: '团本不存在' });
    const b = await readBody(req);
    let result;
    try {
      result = dice.roll({ expr: b.expr, system: b.system, skill: b.skill, bp: b.bp, vis: b.vis });
    } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    if (!rooms[m[1]]) rooms[m[1]] = { messages: [] };
    // 同时兼容旧原型 WS dice 渲染（skill/diff/roll/tens/ones/bp/vis）
    const msg = {
      id: genId('MSG'), t: 'dice', who: a.name, role: 'me', ava: 'me',
      expr: result.expr, total: result.total, dice: result.dice,
      label: result.label, level: result.level, system: result.system,
      target: result.target, bp: result.bp, vis: b.vis || 'public',
      /* diff 必须是请求方要求的**难度**（reg/hard/ext），绝不能塞成功等级 ——
         'hard' 既是难度码也是等级码，前端 renderDice 会把等级当难度用，档位被错误平移。 */
      skill: result.target, diff: b.diff || 'reg', roll: result.total,
      tens: result.dice, ones: 0, ts: Date.now(), by: a.id
    };
    rooms[m[1]].messages.push(msg);
    if (rooms[m[1]].messages.length > 300) rooms[m[1]].messages.shift();
    saveRooms();
    broadcast(m[1], { type: 'dice', d: msg }, null);
    return sendJSON(res, 200, { result, message: msg });
  }

  m = p.match(/^\/api\/campaigns\/([\w-]+)$/);
  if (m) {
    if (req.method === 'GET') {
      const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
      const camp = db.getCampaign(m[1]);
      if (!camp || camp.userId !== a.id) return sendJSON(res, 404, { error: '团本不存在' });
      return sendJSON(res, 200, { campaign: camp });
    }
    if (req.method === 'PATCH') {
      const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
      const camp = db.getCampaign(m[1]);
      if (!camp) return sendJSON(res, 404, { error: '团本不存在' });
      if (camp.userId !== a.id) return sendJSON(res, 403, { error: '无权操作该团本' });
      const b = await readBody(req);
      const patch = {};
      if (b.status) patch.status = b.status;
      if (b.progress) patch.progress = b.progress;
      if (b.title) patch.title = b.title;
      if (Array.isArray(b.investigatorIds)) patch.investigatorIds = b.investigatorIds;
      if (b.scenarioId !== undefined) patch.scenarioId = b.scenarioId;
      if (b.kpMode) patch.kpMode = b.kpMode;
      if (b.redlines !== undefined) patch.redlines = b.redlines;
      if (b.era !== undefined) patch.era = b.era;
      if (b.host !== undefined) patch.host = b.host;
      const saved = db.updateCampaign(m[1], patch);
      return sendJSON(res, 200, { campaign: saved });
    }
  }

  /* ---------- 战报查看 ---------- */
  m = p.match(/^\/api\/reports\/([\w-]+)\/html$/);
  if (m && req.method === 'GET') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    const r = db.getReport(m[1]);
    if (!r || r.userId !== a.id || !r.htmlPath) return sendJSON(res, 404, { error: '战报不存在' });
    try {
      const html = fs.readFileSync(r.htmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      return res.end(html);
    } catch (e) { return sendJSON(res, 404, { error: '战报文件缺失' }); }
  }
  m = p.match(/^\/api\/reports\/([\w-]+)$/);
  if (m && req.method === 'GET') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    const r = db.getReport(m[1]);
    if (!r || r.userId !== a.id) return sendJSON(res, 404, { error: '战报不存在' });
    return sendJSON(res, 200, { report: r });
  }

  /* ---------- 图鉴：怪物 / NPC（bestiary） ---------- */
  if (p === '/api/bestiary' && req.method === 'GET') {
    const sys = url.searchParams.get('system');
    return sendJSON(res, 200, { bestiary: db.listBestiary(sys) });
  }
  m = p.match(/^\/api\/bestiary\/([\w-]+)$/);
  if (m && req.method === 'GET') {
    const b = db.getBestiary(m[1]);
    if (!b) return sendJSON(res, 404, { error: '条目不存在' });
    return sendJSON(res, 200, { entry: b });
  }

  /* ---------- 图鉴：法术书（spells） ---------- */
  if (p === '/api/spells' && req.method === 'GET') {
    const sys = url.searchParams.get('system');
    return sendJSON(res, 200, { spells: db.listSpells(sys) });
  }
  m = p.match(/^\/api\/spells\/([\w-]+)$/);
  if (m && req.method === 'GET') {
    const s = db.getSpell(m[1]);
    if (!s) return sendJSON(res, 404, { error: '法术不存在' });
    return sendJSON(res, 200, { spell: s });
  }

  /* ---------- 角色卡 JSON 导出 / 导入（跨设备携带） ---------- */
  m = p.match(/^\/api\/investigators\/([\w-]+)\/export$/);
  if (m && req.method === 'GET') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    const inv = db.getInvestigator(m[1]);
    if (!inv) return sendJSON(res, 404, { error: '调查员不存在' });
    if (inv.userId && inv.userId !== a.id) return sendJSON(res, 403, { error: '无权导出该角色' });
    return sendJSON(res, 200, { character: inv, format: 'silvergate-character/v1' });
  }
  if (p === '/api/investigators/import' && req.method === 'POST') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '未登录' });
    const b = await readBody(req);
    const card = b.character || b;
    if (!card || !card.name) return sendJSON(res, 400, { error: '角色卡数据无效' });
    const saved = db.upsertInvestigator({
      id: (card.id && String(card.id).startsWith('INV')) ? card.id : genId('INV'),
      user_id: a.id, system: card.system || 'coc', name: String(card.name).slice(0, 60),
      occupation: card.occupation || '', age: card.age || 25, attrs: card.attrs, skills: card.skills,
      san: card.san || 0, max_san: card.maxSan || card.san || 0, hp: card.hp || 0, mp: card.mp || 0,
      luck: card.luck || 0, db: card.db || '', build: card.build || 0, move: card.move || 0,
      growth: card.growth, frag_bank: card.fragBank, madness: card.madness, created_at: card.createdAt || Date.now()
    });
    return sendJSON(res, 200, { investigator: saved });
  }

  /* ---------- 集合石（LFG）：房间列表 / 创建 / 加入 / 密码 ---------- */
  if (p === '/api/lfg/rooms' && req.method === 'GET') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '请先登录' });
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const genre = url.searchParams.get('genre') || '';
    const openOnly = url.searchParams.get('open') === '1';
    const list = Object.values(lfg)
      .filter(r => (r.status || 'recruiting') !== 'closed')
      .filter(r => !openOnly || !r.hasPassword)
      .filter(r => !genre || (r.genre || '') === genre)
      .filter(r => !q || (r.title || '').toLowerCase().includes(q) || (r.hostName || '').toLowerCase().includes(q))
      .sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0))
      .map(r => lfgPublicView(r));
    return sendJSON(res, 200, { rooms: list });
  }
  if (p === '/api/lfg/rooms' && req.method === 'POST') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '请先登录' });
    const b = await readBody(req);
    const title = String(b.title || '').trim().slice(0, 60);
    if (!title) return sendJSON(res, 400, { error: '房间名必填' });
    let id; do { id = 'LFG-' + crypto.randomBytes(3).toString('hex').toUpperCase(); } while (lfg[id]);
    let scnTitle = '';
    if (b.scenarioId) { const s = db.getScenario(b.scenarioId); if (s) scnTitle = s.title; }
    const password = b.password ? String(b.password) : '';
    const room = {
      id, title,
      scenarioId: b.scenarioId || null, scenarioTitle: scnTitle,
      system: b.system === 'dnd' ? 'dnd' : 'coc',
      genre: b.genre || '', desc: String(b.desc || '').slice(0, 200),
      hostUid: a.id, hostName: a.name || '守秘人',
      hasPassword: !!password, passHash: password ? hashPwd(password) : null,
      maxPlayers: Math.min(50, Math.max(2, Number(b.maxPlayers) || 5)),
      members: [{ uid: a.id, name: a.name || '守秘人' }],
      status: 'recruiting', createdAt: Date.now()
    };
    lfg[id] = room; saveLfg();
    return sendJSON(res, 200, { room: lfgPublicView(room) });
  }
  let lm = p.match(/^\/api\/lfg\/rooms\/([\w-]+)\/join$/);
  if (lm && req.method === 'POST') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '请先登录' });
    const b = await readBody(req);
    const r = lfg[lm[1]];
    if (!r) return sendJSON(res, 404, { error: '房间不存在' });
    if ((r.status || 'recruiting') === 'closed') return sendJSON(res, 409, { error: '房间已关闭' });
    if (r.hasPassword && hashPwd(String(b.password || '')) !== r.passHash) return sendJSON(res, 401, { error: '房间密码错误' });
    const members = r.members || [];
    if (members.length >= (r.maxPlayers || 5)) return sendJSON(res, 409, { error: '房间已满' });
    if (!members.find(x => x.uid === a.id)) members.push({ uid: a.id, name: a.name || '调查员' });
    r.members = members; saveLfg();
    return sendJSON(res, 200, { ok: true, roomId: r.id, room: lfgPublicView(r) });
  }
  lm = p.match(/^\/api\/lfg\/rooms\/([\w-]+)\/leave$/);
  if (lm && req.method === 'POST') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '请先登录' });
    const r = lfg[lm[1]];
    if (r && r.members) { r.members = r.members.filter(x => x.uid !== a.id); saveLfg(); }
    return sendJSON(res, 200, { ok: true });
  }
  lm = p.match(/^\/api\/lfg\/rooms\/([\w-]+)$/);
  if (lm && req.method === 'GET') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '请先登录' });
    const r = lfg[lm[1]];
    if (!r) return sendJSON(res, 404, { error: '房间不存在' });
    return sendJSON(res, 200, { room: lfgPublicView(r) });
  }
  if (lm && req.method === 'PATCH') {
    const a = authed(req); if (!a) return sendJSON(res, 401, { error: '请先登录' });
    const r = lfg[lm[1]];
    if (!r) return sendJSON(res, 404, { error: '房间不存在' });
    if (r.hostUid !== a.id) return sendJSON(res, 403, { error: '只有房主可修改房间' });
    const b = await readBody(req);
    if (b.status) r.status = b.status;
    if (typeof b.title === 'string' && b.title.trim()) r.title = b.title.trim().slice(0, 60);
    if (typeof b.desc === 'string') r.desc = b.desc.slice(0, 200);
    if (b.maxPlayers) r.maxPlayers = Math.min(50, Math.max(2, Number(b.maxPlayers) || 5));
    if (typeof b.genre === 'string') r.genre = b.genre;
    saveLfg();
    return sendJSON(res, 200, { room: lfgPublicView(r) });
  }

  sendJSON(res, 404, { error: '未知接口: ' + p });
}

/* ===== 静态资源 ===== */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '/index.html') rel = '/index.html';
  const file = path.join(WWW_DIR, rel);
  if (!file.startsWith(WWW_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) {
      const idx = path.join(WWW_DIR, 'index.html');
      fs.readFile(idx, (e2, d2) => {
        if (e2) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(d2);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ===== WebSocket 房间同步 ===== */
const wss = new WebSocketServer({ noServer: true });
const roomSockets = {};

function roomMemberList(room) {
  const set = roomSockets[room] || new Set();
  return [...set].map(w => ({ id: w.uid, name: w.uname || '调查员' }));
}
function leaveRoom(ws) {
  if (!ws.room) return;
  const set = roomSockets[ws.room];
  if (set) { set.delete(ws); if (!set.size) delete roomSockets[ws.room]; }
  broadcast(ws.room, { type: 'presence', members: roomMemberList(ws.room) });
}
/* 房间级地图权限（#198）：GM 全量生效；非 GM 只能改动 owner 属于自己的 Token，
   背景图 / 缩放平移 / 测距路径 仅 GM 可改。旧客户端不传 gm 标记，视为 GM 行为，向后兼容。 */
function sanitizeMapByPermission(room, incoming, ws, view) {
  const prev = (room.map && Array.isArray(room.map.tokens)) ? room.map.tokens : [];
  const isGm = !room.gmUid || room.gmUid === ws.uid;
  const out = Object.assign({}, incoming);
  // 战损时间线（#战损）：GM 上行带 damageLog 则保留；非 GM 上行（不含 damageLog）时继承房间既有记录，避免玩家移动自己 Token 时覆盖清空
  out.damageLog = Array.isArray(incoming.damageLog) ? incoming.damageLog : (room.map && Array.isArray(room.map.damageLog) ? room.map.damageLog : []);
  out.tokens = Array.isArray(incoming.tokens) ? incoming.tokens : [];
  if (isGm) {
    if (typeof view.bg === 'string') out.bg = view.bg;
    else if (room.map && room.map.bg != null) out.bg = room.map.bg;
    ['zoom', 'panX', 'panY'].forEach(k => { if (view[k] != null) out[k] = view[k]; else if (room.map && room.map[k] != null) out[k] = room.map[k]; });
    if (Array.isArray(incoming.path)) out.path = incoming.path;
    else if (room.map && Array.isArray(room.map.path)) out.path = room.map.path;
    // 先攻顺序 / 回合（#200）：GM 全量生效
    out.init = Array.isArray(incoming.init) ? incoming.init : (room.map ? room.map.init : []);
    out.turn = (typeof incoming.turn === 'number') ? incoming.turn : (room.map ? room.map.turn : 0);
    // 墙体图层（#墙同步）：GM 上行带 walls 则生效；未带时沿用房间既有值，避免被空值误清空
    if (Array.isArray(incoming.walls)) out.walls = incoming.walls;
    else if (room.map && Array.isArray(room.map.walls)) out.walls = room.map.walls;
    return out;
  }
  // 防作弊白名单（#220+）：非 GM 玩家仅能改写「玩家可改字段」白名单；
  // move/moveLeft/hp/hpMax/owner/conds 服务端权威兜底，杜绝伪造移动力/血量/状态。
  // 战斗中（turn>=0）服务端权威结算移动力：超距吸附 + 扣减，非己方回合拒绝移动。
  const MAP_CELL = 26; // 必须与前端 CELL 一致（像素/格）
  const who = String(ws.ukey || ws.uname || ws.uid || '').toLowerCase();
  const turn = (room.map && typeof room.map.turn === 'number') ? room.map.turn : -1;
  const init = (room.map && Array.isArray(room.map.init)) ? room.map.init : [];
  const curTk = (turn >= 0 && init[turn]) ? prev.find(t => t && String(t.id) === String(init[turn].id)) : null;
  const myTurn = curTk ? (String(curTk.owner || '').toLowerCase() === who) : false;
  const PLAYER_FIELDS = ['x', 'y', 'rot', 'hidden', 'name', 'charId', 'emoji', 'kind'];
  const prevById = {}; prev.forEach(t => { if (t && t.id != null) prevById[String(t.id)] = t; });
  const merged = []; const used = {};
  out.tokens.forEach(t => {
    if (!t || t.id == null) return;
    const k = String(t.id);
    if (used[k]) return; used[k] = 1;
    const old = prevById[k];
    if (!old) { if (String(t.owner || '').toLowerCase() === who) merged.push(t); return; }
    const owner = String(old.owner || '').toLowerCase();
    if (owner !== who) { merged.push(old); return; } // 非自己控制的 Token：完全沿用服务端值
    // 自己控制的 Token：仅接受白名单字段，move/hp/owner 等服务端权威
    const nt = Object.assign({}, old);
    PLAYER_FIELDS.forEach(f => { if (f in t) nt[f] = t[f]; });
    if (turn >= 0 && (+old.move || 0) > 0) { // 战斗中且本 Token 有移动力设定
      const dx = (+nt.x || 0) - (+old.x || 0), dy = (+nt.y || 0) - (+old.y || 0);
      const dist = Math.hypot(dx, dy);
      const maxPx = (+old.moveLeft || 0) * MAP_CELL;
      if (!myTurn || maxPx <= 0) { nt.x = old.x; nt.y = old.y; } // 非己方回合 / 无移动力：拒绝移动
      else if (dist > maxPx) { const s = maxPx / (dist || 1); nt.x = old.x + dx * s; nt.y = old.y + dy * s; nt.moveLeft = 0; }
      else { nt.moveLeft = Math.max(0, (+old.moveLeft || 0) - Math.max(0, Math.round(dist / MAP_CELL))); }
    }
    merged.push(nt);
  });
  prev.forEach(t => { const k = String(t.id); if (!used[k]) { used[k] = 1; merged.push(t); } });
  out.tokens = merged;
  // 测距路径仅 GM 可改（#198/#214）：非 GM 严禁接受客户端传入的 path，
  // 仅当服务端已有路径时沿用既有值；否则清空，杜绝玩家伪造测距路径广播全房。
  out.path = (room.map && Array.isArray(room.map.path)) ? room.map.path : undefined;
  if (room.map && room.map.bg != null) out.bg = room.map.bg;
  ['zoom', 'panX', 'panY'].forEach(k => { if (room.map && room.map[k] != null) out[k] = room.map[k]; });
  // 先攻顺序 / 回合（#200）：非 GM 不可改，沿用服务端值
  out.init = room.map ? room.map.init : [];
  out.turn = room.map ? room.map.turn : 0;
  // 墙体图层（#墙同步）：非 GM 严禁改写墙体，一律沿用服务端权威值，杜绝玩家伪造或清空障碍
  out.walls = (room.map && Array.isArray(room.map.walls)) ? room.map.walls : [];
  return out;
}

function broadcast(room, obj, except) {
  const set = roomSockets[room]; if (!set) return;
  const msg = JSON.stringify(obj);
  set.forEach(ws => { if (ws.readyState === 1 && ws !== except) ws.send(msg); });
}

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://x').searchParams.get('token');
  const claim = verifyToken(token);
  const a = claim ? db.getAccountById(claim.sub) : null;
  ws.uid = a ? a.id : (claim ? claim.sub : 'anon');
  ws.uname = a ? a.name : '调查员';
  // authed：token 有效且账户存在；未通过校验的客户端(ws.uid==='anon')仅可观察，
  // 其发出的 chat/dice/map 广播将被服务端丢弃（#216 折中加固，防匿名冒名）。
  ws.authed = !!a;
  // ukey = 登录账号（邮箱/phone:xxx，小写），用于地图 Token 控制权（owner）比对
  ws.ukey = a ? String(a.email || (a.phone ? 'phone:' + a.phone : '') || '').toLowerCase() : '';
  ws.room = null;

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.type === 'join') {
      const room = String(m.room || 'lobby');
      const lfgRoom = lfg[room];
      if (lfgRoom && lfgRoom.hasPassword) {
        if (hashPwd(String(m.pwd || '')) !== lfgRoom.passHash) {
          ws.send(JSON.stringify({ type: 'error', message: '房间密码错误，无法进入' }));
          return;
        }
      }
      if (ws.room && ws.room !== room) leaveRoom(ws);
      ws.room = room;
      if (!roomSockets[room]) roomSockets[room] = new Set();
      roomSockets[room].add(ws);
      if (!rooms[room]) rooms[room] = { messages: [] };
      ws.send(JSON.stringify({ type: 'welcome', room, members: roomMemberList(room) }));
      ws.send(JSON.stringify({ type: 'history', messages: rooms[room].messages.slice(-100) }));
      if (rooms[room].setup) ws.send(JSON.stringify({ type: 'setup', setup: rooms[room].setup }));
      broadcast(room, { type: 'presence', members: roomMemberList(room) }, ws);
    } else if (m.type === 'chat') {
      if (!ws.room || !ws.authed) return;
      const text = String(m.text || '').slice(0, 1000);
      const sys = !!m.sys;
      const msg = { t: 'msg', who: ws.uname, role: 'remote', ava: 'remote', text, ts: Date.now() };
      if (sys) msg.sys = true;
      rooms[ws.room].messages.push(msg);
      if (rooms[ws.room].messages.length > 300) rooms[ws.room].messages.shift();
      saveRooms();
      broadcast(ws.room, { type: 'chat', from: ws.uid, name: ws.uname, text, ts: msg.ts, sys }, ws);
    } else if (m.type === 'dice') {
      if (!ws.room || !ws.authed) return;
      const d = {
        t: 'dice', who: ws.uname, role: 'remote', ava: 'remote',
        skill: String(m.skill || '鉴定'), diff: m.diff || 'reg', roll: Number(m.roll),
        target: Number(m.target), tens: m.tens || [], ones: Number(m.ones || 0), bp: m.bp || 'none', vis: m.vis || 'public'
      };
      rooms[ws.room].messages.push(d);
      if (rooms[ws.room].messages.length > 300) rooms[ws.room].messages.shift();
      saveRooms();
      broadcast(ws.room, { type: 'dice', d }, ws);
    } else if (m.type === 'map') {
      if (!ws.room || !ws.authed) return;
      if (!rooms[ws.room]) rooms[ws.room] = { messages: [] };
      // 兼容旧客户端：仅传 tokens 时包成 {tokens}；新客户端传完整 map
      const room = rooms[ws.room];
      // 房主登记（#214 安全加固）：仅允许团本创建者(c.userId===ws.uid)在尚未登记时
      // 通过 gm 标记成为房主；任何非创建者发送 gm:true 均被忽略，杜绝伪造夺权。
      if (m.gm && !room.gmUid) {
        const c = db.getCampaign(ws.room);
        // 真实团本房间：仅创建者可登记房主（#214 安全加固，防玩家伪造 gm:true 夺权）
        // 非团本(ad-hoc/大厅)房间无创建者约束，沿用旧逻辑——首个发 gm:true 者即房主
        if (!c || c.userId === ws.uid) room.gmUid = ws.uid;
      }
      const kpUid = room.setup && room.setup.kpUid;
      const isGm = !room.gmUid || room.gmUid === ws.uid || (!!kpUid && kpUid === ws.uid);
      // 兼容两种客户端协议：嵌套 m.map={...} 或前端 wsSyncMap 的顶层字段
      // （tokens/init/turn/damageLog/path 顶层；bg/zoom/panX/panY 经 view 传入）。
      // 旧 e2e 用嵌套格式，真实前端发顶层格式——二者都须生效，否则 init/turn/战损日志不广播。
      const incoming = (m.map && typeof m.map === 'object') ? m.map
        : { tokens: m.tokens, init: m.init, turn: m.turn, damageLog: m.damageLog, path: m.path, walls: m.walls };
      room.map = sanitizeMapByPermission(room, incoming, ws,
        { bg: m.bg, zoom: m.zoom, panX: m.panX, panY: m.panY });
      // 测距路径仅 GM 可改（#198）：非 GM 推送的 path 在服务端被丢弃，沿用既有值
      if (isGm && Array.isArray(m.path)) room.map.path = m.path;
      saveRooms();
      broadcast(ws.room, { type: 'map', map: rooms[ws.room].map }, ws);
    } else if (m.type === 'setup') {
      if (!ws.room || !ws.authed) return;
      if (!rooms[ws.room]) rooms[ws.room] = { messages: [] };
      const room = rooms[ws.room];
      const lf = lfg[ws.room];
      const cur = room.setup || null;
      const isHost = !!(lf && lf.hostUid === ws.uid);
      const isKp = !!(cur && cur.kpUid && cur.kpUid === ws.uid);
      if (lf && !isHost && !isKp) { ws.send(JSON.stringify({ type: 'error', message: '只有房主或守秘人可修改开局配置' })); return; }
      room.setup = {
        scenarioId: m.scenarioId ? String(m.scenarioId).slice(0, 80) : null,
        scenarioTitle: String(m.scenarioTitle || '').slice(0, 80),
        kpUid: m.kpUid ? String(m.kpUid).slice(0, 80) : null,
        kpName: String(m.kpName || '').slice(0, 40),
        aiKp: !!m.aiKp,
        aiPl: !!m.aiPl,
        seats: Array.isArray(m.seats) ? m.seats.slice(0, 50).map(function (x) { return { uid: String(x.uid || '').slice(0, 80), name: String(x.name || '').slice(0, 40), role: (x.role === 'kp' ? 'kp' : 'pl') }; }) : [],
        updatedAt: Date.now(),
        updatedBy: ws.uid || null
      };
      saveRooms();
      broadcast(ws.room, { type: 'setup', setup: room.setup });
    } else if (m.type === 'sync') {
      if (!ws.room) return;
      if (!rooms[ws.room]) rooms[ws.room] = { messages: [] };
      ws.send(JSON.stringify({ type: 'history', messages: rooms[ws.room].messages.slice(-100) }));
      if (rooms[ws.room].map) ws.send(JSON.stringify({ type: 'map', map: rooms[ws.room].map }));
    }
  });
  ws.on('close', () => leaveRoom(ws));
});

/* ===== 服务器 ===== */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  return serveStatic(req, res, url);
});
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/ws') return wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  socket.destroy();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('银之门后端已启动：');
  console.log('  REST  : http://127.0.0.1:' + PORT + '/api');
  console.log('  WS    : ws://127.0.0.1:' + PORT + '/api/ws');
  console.log('  静态  : http://127.0.0.1:' + PORT + '/');
  console.log('  数据库: ' + path.join(DATA_DIR, 'silvergate.sqlite'));
});
