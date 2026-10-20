/* 银之门 · 统一数据库层（node:sqlite，零依赖）
 * 单文件 SQLite：server/data/silvergate.sqlite
 * 承载：登录账户 / 调查员(角色) / 跑团进度 / 剧本库 / 战报
 * 兼容 Node 22(experimental) 与 Node 24(stable)。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// SG_DB_DIR 可覆盖数据目录：线上仍是 server/data，测试时指到临时目录，互不污染
const DATA_DIR = process.env.SG_DB_DIR ? path.resolve(process.env.SG_DB_DIR) : path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'silvergate.sqlite');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL;');
db.exec('PRAGMA foreign_keys=OFF;');

/* ============ 建表 ============ */
db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE,
  phone       TEXT,
  name        TEXT,
  pwd         TEXT,
  provider    TEXT DEFAULT 'password',
  created_at  INTEGER
);
CREATE TABLE IF NOT EXISTS investigators (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  system      TEXT DEFAULT 'coc',
  name        TEXT,
  occupation  TEXT,
  age         INTEGER,
  attrs       TEXT,
  skills      TEXT,
  san         INTEGER,
  max_san     INTEGER,
  hp          INTEGER,
  mp          INTEGER,
  luck        INTEGER,
  db          TEXT,
  build       INTEGER,
  move        INTEGER,
  growth      TEXT,
  frag_bank   TEXT,
  madness     TEXT,
  created_at  INTEGER
);
CREATE TABLE IF NOT EXISTS campaigns (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  scenario_id TEXT,
  system      TEXT,
  title       TEXT,
  investigator_ids TEXT,
  status      TEXT DEFAULT 'planning',
  progress    TEXT,
  started_at  INTEGER,
  updated_at  INTEGER,
  completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS scenarios (
  id          TEXT PRIMARY KEY,
  system      TEXT,
  title       TEXT,
  tagline     TEXT,
  premise     TEXT,
  structure   TEXT,
  estimated_minutes INTEGER,
  hard_cap_hours   REAL,
  completion_type  TEXT,
  tags        TEXT,
  content     TEXT,
  created_at  INTEGER
);
CREATE TABLE IF NOT EXISTS battle_reports (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT,
  investigator_id TEXT,
  user_id     TEXT,
  generated_at INTEGER,
  summary     TEXT,
  html_path   TEXT
);
CREATE TABLE IF NOT EXISTS bestiary (
  id          TEXT PRIMARY KEY,
  system      TEXT DEFAULT 'coc',
  name        TEXT,
  kind        TEXT,
  category    TEXT,
  rarity      TEXT,
  stats       TEXT,
  desc        TEXT,
  tags        TEXT
);
CREATE TABLE IF NOT EXISTS spells (
  id          TEXT PRIMARY KEY,
  system      TEXT DEFAULT 'coc',
  name        TEXT,
  school      TEXT,
  level       INTEGER,
  cost        TEXT,
  casting_time TEXT,
  range       TEXT,
  duration    TEXT,
  classes     TEXT,
  desc        TEXT,
  tags        TEXT
);
`);

/* ============ 列迁移（旧库补齐新字段） ============ */
function addColumn(table, col, def) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def};`);
}
addColumn('campaigns', 'kp_mode', "TEXT DEFAULT 'human'");   // human=自己做KP / ai=AI做KP
addColumn('campaigns', 'redlines', 'TEXT');                  // Session Zero 红线 JSON
addColumn('campaigns', 'era', 'TEXT');                       // 时代/战役背景
addColumn('campaigns', 'host', 'TEXT');                      // 主持人/KP/DM
addColumn('scenarios', 'author', 'TEXT');                    // 自定义剧本作者(user id)，内置为 NULL
addColumn('scenarios', 'is_custom', 'INTEGER DEFAULT 0');    // 0=内置 1=用户自创
/* 角色卡云端同步（H5 换设备不丢档）——
   payload 承载前端角色的完整 JSON：前端字段会持续增加（items/backstory/tags/mode/
   sessions/tierExp/lastActive/avatar…），只要整包塞进 payload 就永远不用再改表结构。
   下面那些规范化列仍然照写，因为战报 /report.js 等旧功能依赖它们。 */
addColumn('investigators', 'payload', 'TEXT');               // 前端角色对象完整 JSON（权威数据）
addColumn('investigators', 'updated_at', 'INTEGER');          // 客户端最后修改时间，用于 LWW 合并
addColumn('investigators', 'deleted_at', 'INTEGER');          // 软删墓碑：非空即已删除，用于跨设备同步删除动作
addColumn('investigators', 'rev', 'INTEGER DEFAULT 0');       // 服务端写入自增版本号

/* 团本同理（换设备不丢团）：payload 承载前端团本整包（progress/history/战报摘要等），
   规范化列继续照写，因为「完成团本 → 生成战报」等旧接口依赖它们。 */
addColumn('campaigns', 'payload', 'TEXT');                    // 前端团本对象完整 JSON（权威数据）
addColumn('campaigns', 'deleted_at', 'INTEGER');              // 软删墓碑
addColumn('campaigns', 'rev', 'INTEGER DEFAULT 0');           // 服务端写入自增版本号

/* ============ 小工具 ============ */
const j = (v) => (v === undefined ? null : JSON.stringify(v));
const uj = (s) => { try { return s == null ? null : JSON.parse(s); } catch (e) { return null; } };
const now = () => Date.now();

/* ============ 账户 ============ */
function getAccountByEmail(email) {
  if (!email) return null;
  return db.prepare('SELECT * FROM accounts WHERE email = ?').get(String(email).toLowerCase()) || null;
}
function getAccountByPhone(phone) {
  if (!phone) return null;
  return db.prepare('SELECT * FROM accounts WHERE phone = ?').get(phone) || null;
}
function getAccountById(id) {
  if (!id) return null;
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) || null;
}
function createAccount(a) {
  db.prepare(`INSERT INTO accounts (id,email,phone,name,pwd,provider,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(
    a.id, (a.email || null), (a.phone || null), (a.name || '调查员'),
    (a.pwd || null), (a.provider || 'password'), a.created_at || now());
  return getAccountById(a.id);
}
function setAccountName(id, name) {
  db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(name, id);
  return getAccountById(id);
}
/* 改/重置安全密钥。只写 pwd 列，不动 provider —— 手机号/微信账号没有密钥，
   要改密钥得先有 provider='password'（由调用方判断）。 */
function setAccountPassword(id, pwdHash) {
  db.prepare('UPDATE accounts SET pwd = ? WHERE id = ?').run(pwdHash, id);
  return getAccountById(id);
}

/* ============ 调查员 ============ */
/* payload 是权威数据（前端角色对象整包），规范化列是派生的兼容副本。
   updated_at 由客户端提供（客户端本地时钟），服务端只做单调兜底。 */
function upsertInvestigator(rec) {
  const existing = db.prepare('SELECT id, created_at, updated_at, rev FROM investigators WHERE id = ?').get(rec.id);
  const ts = rec.updated_at || rec.updatedAt || now();
  if (existing) {
    // 单调性兜底：客户端时钟回拨时，不要写出比库里更旧的时间戳
    const next = Math.max(ts, existing.updated_at || 0);
    db.prepare(`UPDATE investigators SET
      user_id=?, system=?, name=?, occupation=?, age=?, attrs=?, skills=?,
      san=?, max_san=?, hp=?, mp=?, luck=?, db=?, build=?, move=?,
      growth=?, frag_bank=?, madness=?, payload=?, updated_at=?, deleted_at=?,
      rev=COALESCE(rev,0)+1, created_at=COALESCE(created_at,?)
      WHERE id=?`).run(
      rec.user_id, rec.system, rec.name, rec.occupation, rec.age, j(rec.attrs), j(rec.skills),
      rec.san, rec.max_san, rec.hp, rec.mp, rec.luck, rec.db, rec.build, rec.move,
      j(rec.growth), j(rec.frag_bank), j(rec.madness),
      rec.payload ? j(rec.payload) : null, next, (rec.deleted_at || rec.deletedAt || null),
      rec.created_at || now(), rec.id);
  } else {
    db.prepare(`INSERT INTO investigators
      (id,user_id,system,name,occupation,age,attrs,skills,san,max_san,hp,mp,luck,db,build,move,growth,frag_bank,madness,payload,updated_at,deleted_at,rev,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      rec.id, rec.user_id, rec.system, rec.name, rec.occupation, rec.age, j(rec.attrs), j(rec.skills),
      rec.san, rec.max_san, rec.hp, rec.mp, rec.luck, rec.db, rec.build, rec.move,
      j(rec.growth), j(rec.frag_bank), j(rec.madness),
      rec.payload ? j(rec.payload) : null, ts, (rec.deleted_at || rec.deletedAt || null), 1,
      rec.created_at || ts);
  }
  return getInvestigator(rec.id);
}
function getInvestigator(id) {
  const row = db.prepare('SELECT * FROM investigators WHERE id = ?').get(id);
  if (!row) return null;
  return inflateInvestigator(row);
}
function listInvestigators(userId, opts) {
  const inc = opts && opts.includeDeleted;
  const rows = inc
    ? db.prepare('SELECT * FROM investigators WHERE user_id = ? ORDER BY COALESCE(updated_at,created_at) DESC').all(userId)
    : db.prepare('SELECT * FROM investigators WHERE user_id = ? AND deleted_at IS NULL ORDER BY COALESCE(updated_at,created_at) DESC').all(userId);
  return rows.map(inflateInvestigator);
}
/* 增量拉取：自 since 起有变化的行（含删除墓碑），用于同步省流 */
function listInvestigatorsSince(userId, since) {
  const rows = db.prepare(
    `SELECT * FROM investigators WHERE user_id = ?
     AND COALESCE(updated_at, created_at, 0) > ?
     ORDER BY COALESCE(updated_at, created_at) ASC`).all(userId, since || 0);
  return rows.map(inflateInvestigator);
}
/* 软删：留墓碑，否则其他设备的本地副本会被"服务端没有它就是删了"之外
   的路径复活（离线编辑后回传），跨设备删除会反复横跳。 */
function softDeleteInvestigator(id, userId, ts) {
  const row = db.prepare('SELECT id, user_id FROM investigators WHERE id = ?').get(id);
  if (!row) return null;
  if (row.user_id && userId && row.user_id !== userId) return false; // 越权
  const t = ts || now();
  db.prepare('UPDATE investigators SET deleted_at=?, updated_at=?, rev=COALESCE(rev,0)+1 WHERE id=?').run(t, t, id);
  return getInvestigator(id);
}
function inflateInvestigator(r) {
  const base = {
    id: r.id, userId: r.user_id, system: r.system, name: r.name, occupation: r.occupation,
    age: r.age, attrs: uj(r.attrs), skills: uj(r.skills),
    san: r.san, maxSan: r.max_san, hp: r.hp, mp: r.mp, luck: r.luck,
    db: r.db, build: r.build, move: r.move,
    growth: uj(r.growth), fragBank: uj(r.frag_bank), madness: uj(r.madness),
    createdAt: r.created_at
  };
  const payload = uj(r.payload);
  // payload 优先：它是前端整包，字段最全；服务端元数据后覆盖，避免被 payload 里的旧值污染
  const out = payload && typeof payload === 'object' ? Object.assign({}, base, payload) : base;
  out.id = r.id;
  out.userId = r.user_id;
  out.createdAt = r.created_at;
  out.updatedAt = r.updated_at || r.created_at;
  out.deletedAt = r.deleted_at || null;
  out.rev = r.rev || 0;
  out.hasPayload = !!payload;
  return out;
}
/* 从 payload（或规范化列）抽出一份可写入规范化列的扁平记录 */
function normalizeInvestigatorRecord(card, userId) {
  const c = card || {};
  return {
    id: c.id, user_id: userId, system: c.system || 'coc',
    name: String(c.name || '无名调查员').slice(0, 60), occupation: c.occupation || '',
    age: c.age || 25, attrs: c.attrs, skills: c.skills,
    san: c.san || 0, max_san: c.maxSan || c.san || 0, hp: c.hp || 0, mp: c.mp || 0,
    luck: c.luck || 0, db: c.db || '', build: c.build || 0, move: c.move || 0,
    growth: c.growth, frag_bank: c.fragBank, madness: c.madness,
    payload: c, updated_at: c.updatedAt || c.updated_at || now(),
    deleted_at: c.deletedAt || null, created_at: c.createdAt || now()
  };
}

/* ============ 团本 / 跑团进度 ============ */
function insertCampaign(rec) {
  db.prepare(`INSERT INTO campaigns
    (id,user_id,scenario_id,system,title,investigator_ids,status,progress,started_at,updated_at,completed_at,kp_mode,redlines,era,host)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    rec.id, rec.user_id, rec.scenario_id, rec.system, rec.title, j(rec.investigator_ids),
    rec.status || 'planning', j(rec.progress), rec.started_at || now(), rec.updated_at || now(), rec.completed_at || null,
    rec.kpMode || 'human', j(rec.redlines), rec.era || null, rec.host || null);
  return getCampaign(rec.id);
}
function getCampaign(id) {
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  if (!row) return null;
  return inflateCampaign(row);
}
/* payload 优先（前端整包字段最全），服务端元数据后覆盖，避免被 payload 里的旧值污染 */
function inflateCampaign(row) {
  const base = {
    id: row.id, userId: row.user_id, scenarioId: row.scenario_id, system: row.system,
    title: row.title, investigatorIds: uj(row.investigator_ids) || [], status: row.status,
    progress: uj(row.progress), startedAt: row.started_at, updatedAt: row.updated_at, completedAt: row.completed_at,
    kpMode: row.kp_mode || 'human', redlines: uj(row.redlines), era: row.era || '', host: row.host || ''
  };
  const payload = uj(row.payload);
  const out = payload && typeof payload === 'object' ? Object.assign({}, base, payload) : base;
  out.id = row.id;
  out.userId = row.user_id;
  out.startedAt = row.started_at;
  out.updatedAt = row.updated_at || row.started_at;
  out.completedAt = row.completed_at;
  out.deletedAt = row.deleted_at || null;
  out.rev = row.rev || 0;
  out.hasPayload = !!payload;
  return out;
}
function listCampaigns(userId, opts) {
  const inc = opts && opts.includeDeleted;
  const rows = inc
    ? db.prepare('SELECT * FROM campaigns WHERE user_id = ? ORDER BY updated_at DESC').all(userId)
    : db.prepare('SELECT * FROM campaigns WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC').all(userId);
  return rows.map(inflateCampaign);
}
/* 增量拉取：自 since 起有变化的团本（含删除墓碑） */
function listCampaignsSince(userId, since) {
  const rows = db.prepare(
    `SELECT * FROM campaigns WHERE user_id = ?
     AND COALESCE(updated_at, started_at, 0) > ?
     ORDER BY COALESCE(updated_at, started_at) ASC`).all(userId, since || 0);
  return rows.map(inflateCampaign);
}
/* 团本同步写入（LWW + 单调性兜底），与 upsertInvestigator 同一套规则 */
function upsertCampaign(rec) {
  const existing = db.prepare('SELECT id, updated_at FROM campaigns WHERE id = ?').get(rec.id);
  const ts = rec.updated_at || rec.updatedAt || now();
  const next = existing ? Math.max(ts, existing.updated_at || 0) : ts;
  const payload = rec.payload ? j(rec.payload) : null;
  const del = rec.deleted_at || rec.deletedAt || null;
  if (existing) {
    db.prepare(`UPDATE campaigns SET
      user_id=?, scenario_id=?, system=?, title=?, investigator_ids=?, status=?, progress=?,
      kp_mode=?, redlines=?, era=?, host=?, updated_at=?, completed_at=?, payload=?, deleted_at=?,
      rev=COALESCE(rev,0)+1, started_at=COALESCE(started_at,?)
      WHERE id=?`).run(
      rec.user_id, rec.scenario_id, rec.system, rec.title, j(rec.investigator_ids), rec.status,
      j(rec.progress), rec.kp_mode, j(rec.redlines), rec.era, rec.host,
      next, rec.completed_at || null, payload, del,
      rec.started_at || ts, rec.id);
  } else {
    db.prepare(`INSERT INTO campaigns
      (id,user_id,scenario_id,system,title,investigator_ids,status,progress,started_at,updated_at,completed_at,kp_mode,redlines,era,host,payload,deleted_at,rev)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      rec.id, rec.user_id, rec.scenario_id, rec.system, rec.title, j(rec.investigator_ids), rec.status,
      j(rec.progress), rec.started_at || ts, next, rec.completed_at || null,
      rec.kp_mode, j(rec.redlines), rec.era, rec.host, payload, del, 1);
  }
  return getCampaign(rec.id);
}
function softDeleteCampaign(id, userId, ts) {
  const row = db.prepare('SELECT id, user_id FROM campaigns WHERE id = ?').get(id);
  if (!row) return null;
  if (row.user_id && userId && row.user_id !== userId) return false;
  const t = ts || now();
  db.prepare('UPDATE campaigns SET deleted_at=?, updated_at=?, rev=COALESCE(rev,0)+1 WHERE id=?').run(t, t, id);
  return getCampaign(id);
}
/* 从 payload（或扁平字段）抽出一份可写入规范化列的记录 */
function normalizeCampaignRecord(c, userId) {
  const x = c || {};
  return {
    id: x.id, user_id: userId, scenario_id: x.scenarioId || null, system: x.system || 'coc',
    title: String(x.title || '未命名团本').slice(0, 120),
    investigator_ids: x.investigatorIds || [],
    status: x.status || 'planning', progress: x.progress || {},
    started_at: x.startedAt || now(), updated_at: x.updatedAt || x.updated_at || now(),
    completed_at: x.completedAt || null,
    kp_mode: x.kpMode || 'human', redlines: x.redlines || null,
    era: x.era || '', host: x.host || '',
    payload: x, deleted_at: x.deletedAt || null
  };
}
function updateCampaign(id, patch) {
  const cur = getCampaign(id);
  if (!cur) return null;
  const next = Object.assign({}, cur, patch);
  const t = now();
  // 有 payload 时把它一起更新，否则旧接口（完成团本 / 改状态）改了规范化列，
  // 其他设备通过同步拉回去的还是 payload 里的旧值，两边会打架。
  const payload = cur.hasPayload
    ? j(Object.assign({}, uj(db.prepare('SELECT payload FROM campaigns WHERE id = ?').get(id).payload), patch, { updatedAt: t }))
    : null;
  db.prepare(`UPDATE campaigns SET
    scenario_id=?, system=?, title=?, investigator_ids=?, status=?, progress=?,
    kp_mode=?, redlines=?, era=?, host=?, updated_at=?, completed_at=?,
    payload=COALESCE(?, payload), rev=COALESCE(rev,0)+1
    WHERE id=?`).run(
    next.scenarioId, next.system, next.title, j(next.investigatorIds), next.status,
    j(next.progress), next.kpMode, j(next.redlines), next.era || null, next.host || null,
    t, next.completedAt, payload, id);
  return getCampaign(id);
}

/* ============ 剧本库 ============ */
function listScenarios(system, mine, userId) {
  let rows;
  if (mine) {
    rows = db.prepare('SELECT * FROM scenarios WHERE is_custom = 1 AND author = ? ORDER BY created_at DESC').all(userId);
  } else if (system) {
    rows = db.prepare('SELECT * FROM scenarios WHERE system = ? ORDER BY estimated_minutes ASC').all(system);
  } else {
    rows = db.prepare('SELECT * FROM scenarios ORDER BY system ASC, estimated_minutes ASC').all();
  }
  return rows.map(inflateScenario);
}
function getScenario(id) {
  const row = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(id);
  if (!row) return null;
  return inflateScenario(row);
}
function countScenarios() { return db.prepare('SELECT COUNT(*) c FROM scenarios').get().c; }
function inflateScenario(r) {
  return {
    id: r.id, system: r.system, title: r.title, tagline: r.tagline, premise: r.premise,
    structure: uj(r.structure) || [], estimatedMinutes: r.estimated_minutes,
    hardCapHours: r.hard_cap_hours, completionType: r.completion_type,
    tags: uj(r.tags) || [], content: r.content, createdAt: r.created_at,
    author: r.author || null, isCustom: (r.is_custom || 0) === 1
  };
}
function insertScenario(s) {
  db.prepare(`INSERT OR IGNORE INTO scenarios
    (id,system,title,tagline,premise,structure,estimated_minutes,hard_cap_hours,completion_type,tags,content,created_at,author,is_custom)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    s.id, s.system, s.title, s.tagline, s.premise, j(s.structure), s.estimated_minutes,
    s.hard_cap_hours ?? null, s.completion_type, j(s.tags), s.content, s.created_at || now(),
    s.author || null, s.is_custom || 0);
  return getScenario(s.id);
}

/* ============ 战报 ============ */
function insertReport(rec) {
  db.prepare(`INSERT INTO battle_reports
    (id,campaign_id,investigator_id,user_id,generated_at,summary,html_path)
    VALUES (?,?,?,?,?,?,?)`).run(
    rec.id, rec.campaign_id, rec.investigator_id, rec.user_id, rec.generated_at || now(),
    j(rec.summary), rec.html_path || null);
  return getReport(rec.id);
}
function inflateReport(row) {
  if (!row) return null;
  return { id: row.id, campaignId: row.campaign_id, investigatorId: row.investigator_id, userId: row.user_id,
    generatedAt: row.generated_at, summary: uj(row.summary), htmlPath: row.html_path };
}
function getReport(id) {
  const row = db.prepare('SELECT * FROM battle_reports WHERE id = ?').get(id);
  return inflateReport(row);
}
function listReportsByInvestigator(invId) {
  return db.prepare('SELECT * FROM battle_reports WHERE investigator_id = ? ORDER BY generated_at DESC').all(invId)
    .map(inflateReport).filter(Boolean);
}
function listReportsByCampaign(campaignId) {
  return db.prepare('SELECT * FROM battle_reports WHERE campaign_id = ? ORDER BY generated_at DESC').all(campaignId)
    .map(inflateReport).filter(Boolean);
}
function listReportsByUser(userId) {
  return db.prepare('SELECT * FROM battle_reports WHERE user_id = ? ORDER BY generated_at DESC').all(userId)
    .map(inflateReport).filter(Boolean);
}

/* ============ 图鉴（怪物 / NPC） ============ */
const BESTIARY_SEED = [
  // —— COC 神话生物 / 异界 ——
  { id: 'BIO-DEEPONE', system: 'coc', name: '深潜者', kind: '神话生物', category: '海洋', rarity: '常见',
    stats: { hp: 18, armor: '鳞片 1', sanLoss: '0/1D6', attacks: [{ name: '爪与利齿', dmg: '1D6+1' }, { name: '渔叉', dmg: '1D8' }] },
    desc: '蛙脸鱼身的人形海洋种族，与人类的混血后代会在青春期「觉醒」并返回深海。崇拜父神达贡与母神海德拉，常与修格斯为奴。', tags: ['海洋', '混血', '达贡'] },
  { id: 'BIO-SHOGGOTH', system: 'coc', name: '修格斯', kind: '异界生物', category: '软泥', rarity: '罕见',
    stats: { hp: 120, armor: '免疫非魔法/火焰伤害', sanLoss: '1D10/1D100', attacks: [{ name: '吞噬', dmg: '3D6+DB' }] },
    desc: '远古者创造的活体原生质，可塑形、可模仿声音，后被奴役反噬。由无数眼与口组成，是克苏鲁神话最具压迫感的造物之一。', tags: ['原生质', '远古者', '不可名状'] },
  { id: 'BIO-MIGO', system: 'coc', name: '米·戈', kind: '异界生物', category: '昆虫', rarity: '罕见',
    stats: { hp: 13, armor: '几丁质 1', sanLoss: '0/1D6', attacks: [{ name: '钳与螯', dmg: '1D6+1' }] },
    desc: '来自犹格斯的外星真菌生物，能飞行、进行脑提取手术并以「电子脑囊」保存人类意识。理性而冷酷，视人类为可收集样本。', tags: ['真菌', '犹格斯', '脑提取'] },
  { id: 'BIO-NIGHTGAUNT', system: 'coc', name: '夜魇', kind: '异界生物', category: '信使', rarity: '常见',
    stats: { hp: 14, armor: '0', sanLoss: '0/1D6', attacks: [{ name: '擒抱', dmg: '擒抱并掳走' }] },
    desc: '无毛无面、生有蝙蝠膜翼的侍从，替奈亚拉托提普等外神传递灵魂往返幻梦境。没有眼睛与嘴，以触觉与气流沟通。', tags: ['信使', '幻梦境', '奈亚拉托提普'] },
  { id: 'BIO-GHOUL', system: 'coc', name: '食尸鬼', kind: '异界生物', category: '墓园', rarity: '常见',
    stats: { hp: 14, armor: '0', sanLoss: '0/1D6', attacks: [{ name: '利爪啃咬', dmg: '1D6+1' }] },
    desc: '食腐的人形生物，能掘地潜行。部分人类因长期食尸而退化成食尸鬼；它们拥有自己的语言与氏族社会。', tags: ['食腐', '掘地', '退化'] },
  { id: 'BIO-BYAKHEE', system: 'coc', name: '拜亚基', kind: '神话生物', category: '坐骑', rarity: '常见',
    stats: { hp: 18, armor: '0', sanLoss: '0/1D6', attacks: [{ name: '利爪', dmg: '1D6+1' }] },
    desc: '哈斯塔麾下的有翼仆从，可载着施术者跨越星际。是「召唤与送离拜亚基」咒文的标准坐骑。', tags: ['坐骑', '哈斯塔', '星际旅行'] },
  // —— DND 怪物 ——
  { id: 'BIO-GOBLIN', system: 'dnd', name: '哥布林', kind: '人形', category: '普通', rarity: '常见',
    stats: { hp: 7, ac: 15, cr: '1/4', attacks: [{ name: '弯刀', dmg: '1D6+2' }, { name: '短弓', dmg: '1D6' }] },
    desc: '弱小而狡黠的类人生物，成群结队出没于洞穴与地道的阴暗角落，常受更强恶势力驱使。', tags: ['人形', '成群', '隧道'] },
  { id: 'BIO-ORC', system: 'dnd', name: '兽人', kind: '人形', category: '普通', rarity: '常见',
    stats: { hp: 15, ac: 13, cr: '1/2', attacks: [{ name: '巨斧', dmg: '1D12+3' }] },
    desc: '崇尚力量与战火的绿皮肤战士，部落制社会，以劫掠与征战为荣。', tags: ['人形', '战士', '部落'] },
  { id: 'BIO-SKELETON', system: 'dnd', name: '骷髅', kind: '不死', category: '普通', rarity: '常见',
    stats: { hp: 13, ac: 13, cr: '1/4', attacks: [{ name: '短剑', dmg: '1D6+2' }] },
    desc: '被邪术唤起的无肉白骨，听命于施法者，脆弱却无所畏惧。', tags: ['不死', '唤起', '白骨'] },
  { id: 'BIO-OGRE', system: 'dnd', name: '食人魔', kind: '人形', category: '大型', rarity: '不常见',
    stats: { hp: 59, ac: 11, cr: '2', attacks: [{ name: '巨棍', dmg: '2D8+4' }] },
    desc: '愚笨而强壮的巨躯肉食者，食人成性，常以棍棒横扫战场。', tags: ['人形', '大型', '食人'] },
  { id: 'BIO-BEHOLDER', system: 'dnd', name: '眼魔', kind: '异怪', category: '大型', rarity: '稀有',
    stats: { hp: 180, ac: 18, cr: '13', attacks: [{ name: '主眼/眼魔射线', dmg: '十道射线(豁免 DC 16)' }] },
    desc: '悬浮的球形魔眼，周身十只眼柄射出解离、石化、恐惧等诡异射线；偏执而多疑，自视为 Superior 存在。', tags: ['异怪', '射线', '悬浮'] },
  { id: 'BIO-BLACKPUD', system: 'dnd', name: '黑布丁', kind: '泥形', category: '大型', rarity: '不常见',
    stats: { hp: 85, ac: 14, cr: '4', attacks: [{ name: '腐蚀', dmg: '3D6 酸(无视护甲)' }] },
    desc: '流动的黑色酸液泥形怪，吞噬一切有机物与多数金属，分裂再生，是地城清道夫。', tags: ['泥形', '酸液', '分裂'] }
];

/* ============ 法术书（COC 咒文 + DND 法术） ============ */
const SPELLS_SEED = [
  // —— COC 咒文（消耗魔法值 / SAN） ——
  { id: 'SPL-CTHSEAL', system: 'coc', name: '旧日支配者之印（旧印）', school: '神话/防护', level: null,
    cost: '无消耗，需仪式绘制并镇压', casting_time: '仪式', range: '接触', duration: '永久(至被毁)',
    classes: [], desc: '绘于门楣或器物上的防护符印，可阻挡神话生物与灵体通过，并对触碰者造成 1D6+1 伤害。是调查员对抗外神最直接的护身符。', tags: ['防护', '符印', '仪式'] },
  { id: 'SPL-BYAKHEE', system: 'coc', name: '召唤与送离拜亚基', school: '召唤', level: null,
    cost: '1 魔法值 + 1D6 SAN', casting_time: '1 轮', range: '召唤', duration: '至送离',
    classes: [], desc: '唤来哈斯塔的飞行仆从拜亚基，可骑乘穿越星际与幻梦境。失败或送离不当会招致其反噬。', tags: ['召唤', '坐骑', '哈斯塔'] },
  { id: 'SPL-VOOR', system: 'coc', name: '维克诡镜', school: '幻术/窥视', level: null,
    cost: '2 魔法值 + 1 SAN', casting_time: '1 轮', range: '自身', duration: '数分钟',
    classes: [], desc: '借助一面银镜窥见远方之人或地，镜中映出目标当前景象；可被反制或反窥。', tags: ['窥视', '银镜', '远方'] },
  { id: 'SPL-DREAM', system: 'coc', name: '幻梦境之门', school: '异界/旅行', level: null,
    cost: '3 魔法值 + 1D10 SAN', casting_time: '1 轮', range: '自身', duration: '旅程',
    classes: [], desc: '使灵魂脱出躯壳，穿行于现实与幻梦境之间的界门；肉身脆弱，归途亦凶险。', tags: ['幻梦境', '旅行', '灵魂'] },
  // —— DND 法术（按环位） ——
  { id: 'SPL-MMISSILE', system: 'dnd', name: '魔法飞弹', school: '塑能', level: 1,
    cost: '1 环法术位', casting_time: '1 动作', range: '120 尺', duration: '瞬时',
    classes: ['法师', '术士'], desc: '射出三发自动命中的力场飞弹，各造成 1D4+1 力场伤害（高环位额外增弹）。', tags: ['塑能', '自动命中', '1环'] },
  { id: 'SPL-CURE', system: 'dnd', name: '治疗真言', school: '防护', level: 1,
    cost: '1 环法术位', casting_time: '1 动作', range: '触及', duration: '瞬时',
    classes: ['牧师', '圣骑士', '德鲁伊'], desc: '触碰目标，恢复 1D8 + 施法属性调整值的生命值；对不死生物可改为造成同等光耀伤害。', tags: ['治疗', '防护', '1环'] },
  { id: 'SPL-INVIS', system: 'dnd', name: '隐形术', school: '幻术', level: 2,
    cost: '2 环法术位', casting_time: '1 动作', range: '触及/自身', duration: '1 小时(需专注)',
    classes: ['法师', '术士', '吟游诗人'], desc: '使目标隐形：攻击或施放法术前保持，一旦出手即显形。', tags: ['幻术', '隐形', '2环'] },
  { id: 'SPL-FIREBALL', system: 'dnd', name: '火球术', school: '塑能', level: 3,
    cost: '3 环法术位', casting_time: '1 动作', range: '150 尺', duration: '瞬时',
    classes: ['法师', '术士', '吟游诗人'], desc: '在落点炸开 20 尺半径的烈焰，造成 8D6 火焰伤害（敏捷豁免减半）。', tags: ['塑能', '范围', '3环'] },
  { id: 'SPL-LBOLT', system: 'dnd', name: '闪电束', school: '塑能', level: 3,
    cost: '3 环法术位', casting_time: '1 动作', range: '自身(100 尺线)', duration: '瞬时',
    classes: ['法师', '术士'], desc: '从指尖迸出一道 100 尺长、5 尺宽的闪电，沿线生物受 8D6 闪电伤害（敏捷豁免减半）。', tags: ['塑能', '线状', '3环'] }
];

function inflateBestiary(r) {
  return { id: r.id, system: r.system, name: r.name, kind: r.kind, category: r.category,
    rarity: r.rarity, stats: uj(r.stats), desc: r.desc, tags: uj(r.tags) || [] };
}
function inflateSpell(r) {
  return { id: r.id, system: r.system, name: r.name, school: r.school, level: r.level,
    cost: r.cost, castingTime: r.casting_time, range: r.range, duration: r.duration,
    classes: uj(r.classes) || [], desc: r.desc, tags: uj(r.tags) || [] };
}
function getBestiary(id) { const r = db.prepare('SELECT * FROM bestiary WHERE id = ?').get(id); return r ? inflateBestiary(r) : null; }
function listBestiary(system) {
  const rows = system
    ? db.prepare('SELECT * FROM bestiary WHERE system = ? ORDER BY kind, name').all(system)
    : db.prepare('SELECT * FROM bestiary ORDER BY system, kind, name').all();
  return rows.map(inflateBestiary);
}
function getSpell(id) { const r = db.prepare('SELECT * FROM spells WHERE id = ?').get(id); return r ? inflateSpell(r) : null; }
function listSpells(system) {
  const rows = system
    ? db.prepare('SELECT * FROM spells WHERE system = ? ORDER BY level, name').all(system)
    : db.prepare('SELECT * FROM spells ORDER BY system, level, name').all();
  return rows.map(inflateSpell);
}
function countBestiary() { return db.prepare('SELECT COUNT(*) c FROM bestiary').get().c; }
function countSpells() { return db.prepare('SELECT COUNT(*) c FROM spells').get().c; }
function insertBestiary(b) {
  db.prepare(`INSERT OR IGNORE INTO bestiary (id,system,name,kind,category,rarity,stats,desc,tags)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(b.id, b.system, b.name, b.kind, b.category, b.rarity, j(b.stats), b.desc, j(b.tags));
  return getBestiary(b.id);
}
function insertSpell(s) {
  db.prepare(`INSERT OR IGNORE INTO spells (id,system,name,school,level,cost,casting_time,range,duration,classes,desc,tags)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(s.id, s.system, s.name, s.school, s.level, s.cost,
    s.casting_time, s.range, s.duration, j(s.classes), s.desc, j(s.tags));
  return getSpell(s.id);
}
function seedCompendiumIfEmpty() {
  if (countBestiary() === 0) { for (const b of BESTIARY_SEED) insertBestiary(b); console.log('  [seed] 图鉴(怪物/NPC): ' + BESTIARY_SEED.length); }
  if (countSpells() === 0) { for (const s of SPELLS_SEED) insertSpell(s); console.log('  [seed] 法术书: ' + SPELLS_SEED.length); }
}

module.exports = {
  db,
  getAccountByEmail, getAccountByPhone, getAccountById, createAccount, setAccountName, setAccountPassword,
  upsertInvestigator, getInvestigator, listInvestigators, listInvestigatorsSince,
  softDeleteInvestigator, normalizeInvestigatorRecord,
  insertCampaign, getCampaign, listCampaigns, updateCampaign,
  upsertCampaign, listCampaignsSince, softDeleteCampaign, normalizeCampaignRecord,
  listScenarios, getScenario, countScenarios, insertScenario,
  insertReport, getReport, listReportsByCampaign, listReportsByInvestigator, listReportsByUser,
  listBestiary, getBestiary, listSpells, getSpell, countBestiary, countSpells, seedCompendiumIfEmpty
};
