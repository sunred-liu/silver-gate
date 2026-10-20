/* 银之门 · 战报生成器
 * 玩家选择「完本 / 退出」时由后端调用，整理战报并保存。
 * 输出：summary(JSON，存入 battle_reports.summary) + 自包含 HTML(存入 data/reports/<id>.html)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPORT_DIR = path.join(__dirname, 'data', 'reports');
if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

/* 转义，防止角色名/症状文本破坏战报 HTML */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
/* 由角色实时档案派生状态效果列表（疯狂印记 + 阈值派生） */
function deriveStatus(c) {
  const s = [];
  const md = Array.isArray(c.madness) ? c.madness : [];
  md.forEach(m => s.push('疯狂印记 · ' + (m.symptom || ('SAN ' + (m.san > 0 ? '+' : '') + m.san))));
  if (c.san != null && c.maxSan && c.san < c.maxSan * 0.5) s.push('临时疯狂风险');
  if (c.hp != null && c.hp <= 0) s.push('倒下 / 失控');
  else if (c.hp != null && c.maxHp && c.hp < c.maxHp * 0.5) s.push('负伤');
  return s;
}

function fmtDur(ms) {
  if (!ms || ms < 0) return '—';
  const m = Math.round(ms / 60000);
  if (m < 60) return m + ' 分钟';
  const h = Math.floor(m / 60), mm = m % 60;
  return (h > 0 ? h + ' 小时 ' : '') + (mm > 0 ? mm + ' 分' : '');
}
function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* 由聊天室消息 / 骰子记录派生「行动时间线 · 战损回顾」（#199）。
 * 节点类型：roll=检定/行动、story=剧情推演(GM/AI)、chat=交流。
 * 失败/失误的掷骰标记为战损/受挫，用于复盘战术得失。 */
function buildTimeline(messages) {
  const msgs = Array.isArray(messages) ? messages : [];
  const evs = [];
  msgs.forEach(m => {
    const ts = m.ts || 0;
    if (m.t === 'dice' || m.type === 'dice') {
      const who = m.who || '调查员';
      const total = (m.total != null) ? m.total : (m.roll != null ? m.roll : null);
      const target = (m.target != null) ? m.target : null;
      const label = m.label || '';
      /* 优先用 dice.cocLevel() 产出的结构化 level；老消息 / 客户端消息没有 level，
         退回标签正则（含义保持一致：isCrit 实为「good = 任意成功档」，沿用原配色）。 */
      const level = m.level || '';
      const isFail = level ? (level === 'fail' || level === 'fumble') : /失败|失误/.test(label);
      const isCrit = level ? (level !== 'fail' && level !== 'fumble') : /大成功|成功/.test(label);
      evs.push({ ts, kind: 'roll', fail: isFail, crit: isCrit, who, total, target, label });
    } else if (m.t === 'msg' || m.type === 'chat') {
      const who = m.who || m.name || '成员';
      const text = m.text || '';
      if (!text) return;
      const role = m.role || '';
      const isKp = /守秘人|KP|GM/i.test(who) || role === 'kp' || role === 'ai' || m.ai;
      evs.push({ ts, kind: isKp ? 'story' : 'chat', who, text: text.slice(0, 70) });
    }
  });
  evs.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return evs;
}

function buildSummary(ctx) {
  const { campaign, investigator, scenario, user, completedAt, messages } = ctx;
  const inv = investigator || {};
  const scn = scenario || {};
  const prog = campaign.progress || {};
  const fragCount = Array.isArray(inv.fragBank) ? inv.fragBank.length : 0;
  const madnessCount = Array.isArray(inv.madness) ? inv.madness.length : 0;
  const sysLabel = (campaign.system === 'dnd') ? 'DND 5e' : 'COC 7e';
  const outcome = campaign.status === 'done'
    ? (scn.completionType === 'open' ? '玩家主动完本 / 退出（开放剧本）' : '剧本完本')
    : '进行中';

  // —— 队伍实时状态（多调查员 / 单角色，向后兼容）——
  const charSrc = (Array.isArray(ctx.characters) && ctx.characters.length) ? ctx.characters
    : (Array.isArray(ctx.investigators) ? ctx.investigators : (ctx.investigator ? [ctx.investigator] : []));
  const chars = charSrc.map(c => {
    const attrs = c.attrs || {};
    const maxHpEst = (attrs.con != null && attrs.siz != null) ? Math.floor((attrs.con + attrs.siz) / 10) : null;
    const maxMpEst = (c.system === 'dnd')
      ? (attrs.int != null ? Math.floor(attrs.int / 2) : null)
      : (attrs.pow != null ? Math.floor(attrs.pow / 5) : null);
    return {
      name: c.name || '调查员',
      kind: c.kind || (c.system === 'dnd' ? 'dnd' : 'coc'),
      san: c.san != null ? c.san : null,
      maxSan: c.maxSan != null ? c.maxSan : null,
      hp: c.hp != null ? c.hp : null,
      maxHp: c.maxHp != null ? c.maxHp : maxHpEst,
      mp: c.mp != null ? c.mp : null,
      maxMp: c.maxMp != null ? c.maxMp : maxMpEst,
      status: deriveStatus(c)
    };
  }).filter(c => c.san != null || c.hp != null || c.mp != null);

  // —— 行动时间线（#199）——
  const timeline = buildTimeline(messages);
  const timelineStats = {
    total: timeline.length,
    roll: timeline.filter(e => e.kind === 'roll').length,
    story: timeline.filter(e => e.kind === 'story').length,
    chat: timeline.filter(e => e.kind === 'chat').length,
    fail: timeline.filter(e => e.kind === 'roll' && e.fail).length
  };

  return {
    investigatorId: campaign.investigatorIds && campaign.investigatorIds[0],
    investigatorName: inv.name || '未知调查员',
    system: campaign.system,
    systemLabel: sysLabel,
    scenarioId: campaign.scenarioId,
    scenarioTitle: scn.title || campaign.title || '自定义团本',
    campaignTitle: campaign.title || '团本',
    startedAt: campaign.startedAt,
    completedAt: completedAt || campaign.completedAt,
    durationText: fmtDur((completedAt || campaign.completedAt || 0) - (campaign.startedAt || 0)),
    sessions: prog.sessions || 1,
    san: inv.san != null ? inv.san : null,
    maxSan: inv.maxSan != null ? inv.maxSan : null,
    hp: inv.hp != null ? inv.hp : null,
    mp: inv.mp != null ? inv.mp : null,
    luck: inv.luck != null ? inv.luck : null,
    fragments: fragCount,
    madness: madnessCount,
    exp: prog.exp || 0,
    hasMap: !!(ctx.map && Array.isArray(ctx.map.tokens) && ctx.map.tokens.length),
    mapName: (ctx.map && ctx.map.name) || null,
    partySize: chars.length,
    chars,
    timeline,
    timelineStats,
    outcome
  };
}

function renderReportHtml(ctx, summary) {
  const { campaign, investigator, scenario, user } = ctx;
  const inv = investigator || {};
  const scn = scenario || {};
  const sysBadge = (campaign.system === 'dnd')
    ? '<span class="badge dnd">DND 5e</span>'
    : '<span class="badge coc">COC 7e</span>';

  // —— 战场快照（若完本时房间存在共享战场）——
  let mapSection = '';
  const map = ctx.map;
  if (map && Array.isArray(map.tokens) && map.tokens.length) {
    const cols = map.cols || 12, rows = map.rows || 9;
    const tokenAt = {};
    map.tokens.forEach(t => { tokenAt[`${t.col},${t.row}`] = t; });
    let cells = '';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const t = tokenAt[`${c},${r}`];
        if (t) {
          const kind = ['investigator', 'monster', 'npc'].includes(t.kind) ? t.kind : 'investigator';
          cells += `<div class="bcell"><div class="btok ${kind}">${(t.label || '?').slice(0, 4)}</div></div>`;
        } else {
          cells += `<div class="bcell"></div>`;
        }
      }
    }
    const legend = map.tokens.map(t => `<span class="legend-item">● ${t.label || '?'}</span>`).join(' ');
    mapSection = `<div class="card"><h2>战场快照</h2>`
      + `<div class="mapmeta">${map.name || '未命名战场'} · ${cols}×${rows} · ${map.tokens.length} 棋子</div>`
      + `<div class="bmap" style="grid-template-columns:repeat(${cols},1fr)">${cells}</div>`
      + `<div class="legend">${legend}</div></div>`;
  }
  let damageSection = renderDamageSection(ctx);
  let recapSection = renderCombatRecap(ctx);

  // —— 队伍实时状态（HP/MP/SAN 进度条 + 状态效果）——
  const pct = (v, m) => (m ? Math.max(0, Math.min(100, Math.round((v / m) * 100))) : (v != null && v > 0 ? 100 : 0));
  const bar = (label, v, m, cls) => `<div class="statrow"><span class="lbl">${label}</span><span class="num">${v != null ? v : '—'}${m ? '/' + m : ''}</span><div class="bar ${cls}"><i style="width:${pct(v, m)}%"></i></div></div>`;
  const chipCls = (t) => (/倒下|失控/.test(t) ? 'chip bad' : (/疯狂|风险|负伤/.test(t) ? 'chip warn' : 'chip'));
  let statusSection = '';
  if (summary.chars && summary.chars.length) {
    const pcards = summary.chars.map(ch => {
      const bars = [bar('SAN', ch.san, ch.maxSan, 'san'), bar('HP', ch.hp, ch.maxHp, 'hp'), bar('MP', ch.mp, ch.maxMp, 'mp')].join('');
      const chips = (ch.status && ch.status.length ? ch.status : ['状态平稳']).map(t => `<span class="${chipCls(t)}">${esc(t)}</span>`).join(' ');
      return `<div class="pcard"><div class="pname">${esc(ch.name)}</div>${bars}<div class="chips">${chips}</div></div>`;
    }).join('');
    statusSection = `<div class="card"><h2>队伍实时状态</h2><div class="prow">${pcards}</div><div class="mapmeta">完本瞬间各调查员的生命 / 理智 / 法力与状态效果，数据取自角色实时档案。</div></div>`;
  }

  const madnessRows = (Array.isArray(inv.madness) ? inv.madness : []).map(m =>
    `<li>${m.date || ''} · SAN ${m.san > 0 ? '+' + m.san : m.san} · ${m.symptom || '（未记录症状）'}</li>`).join('') || '<li>本次团本暂无疯狂记录</li>';

  const fragRows = (Array.isArray(inv.fragBank) ? inv.fragBank : []).map(f =>
    `<li><b>${f.title || ''}</b>（${f.type || ''}）：${f.desc || ''}</li>`).join('') || '<li>本次团本未获得命运残片</li>';

  const growthRows = (inv.growth && Array.isArray(inv.growth.log) ? inv.growth.log : []).map(g =>
    `<li>${g.date || ''} · ${g.text || ''}</li>`).join('') || '<li>本次团本无成长记录</li>';

  const timelineSection = renderTimelineSection(summary);

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>战报 · ${summary.scenarioTitle}</title>
<style>
  :root{--bg:#0b0e14;--card:#121722;--ink:#e8e6df;--ink2:#aab0bd;--ink3:#7c8392;--gold:#E0B35C;--red:#c0392b;--line:#263042;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;line-height:1.6;}
  .wrap{max-width:820px;margin:0 auto;padding:28px 20px 60px;}
  h1{font-size:24px;color:var(--gold);margin:0 0 4px;letter-spacing:1px}
  .sub{color:var(--ink3);font-size:13px;margin-bottom:18px}
  .badge{display:inline-block;font-size:12px;padding:2px 10px;border-radius:999px;border:1px solid var(--line);margin-right:8px}
  .badge.coc{color:#c98b6b;border-color:#5a3a2c}
  .badge.dnd{color:#7fb3e0;border-color:#2c445a}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:14px 0}
  .card h2{font-size:15px;color:var(--gold);margin:0 0 10px;letter-spacing:1px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
  .stat{background:#0e131d;border:1px solid var(--line);border-radius:8px;padding:10px}
  .stat .k{color:var(--ink3);font-size:11px}
  .stat .v{color:var(--ink);font-size:18px;font-weight:700}
  ul{margin:6px 0 0;padding-left:18px}
  li{margin:3px 0;color:var(--ink2);font-size:13px}
  .stamp{display:inline-block;margin-top:8px;color:var(--red);border:1px solid var(--red);border-radius:6px;padding:3px 10px;font-size:12px;letter-spacing:2px}
  .mapmeta{color:var(--ink3);font-size:12px;margin-bottom:6px}
  .bmap{display:grid;gap:2px;margin-top:10px;background:#1a120b;padding:6px;border-radius:8px;border:1px solid var(--line)}
  .bcell{aspect-ratio:1/1;background:#241a10;border-radius:4px;display:flex;align-items:center;justify-content:center;position:relative}
  .btok{width:82%;height:82%;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#0b0e14}
  .btok.investigator{background:var(--gold)}
  .btok.monster{background:var(--red);color:#fff}
  .btok.npc{background:#7fd0c0;color:#0b0e14}
  .legend{margin-top:8px;color:var(--ink2);font-size:12px}
  .legend-item{margin-right:12px}
  .foot{color:var(--ink3);font-size:11px;margin-top:24px;text-align:center}
  .dltab{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px}
  .dltab th{color:var(--ink3);text-align:left;padding:4px 6px;border-bottom:1px solid var(--line);font-weight:600}
  .dltab td{padding:4px 6px;border-bottom:1px solid var(--line);color:var(--ink2);font-variant-numeric:tabular-nums}
  .dl-bad{color:#ff8a7a}
  .dl-good{color:#7fd0a0}
  .dl-warn{color:#e0b35c}
  .prow{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .pcard{background:#0e131d;border:1px solid var(--line);border-radius:10px;padding:12px 14px}
  .pname{font-size:14px;font-weight:700;color:var(--ink);margin-bottom:8px}
  .statrow{display:flex;align-items:center;gap:8px;margin:6px 0}
  .statrow .lbl{width:30px;color:var(--ink3);font-size:12px}
  .statrow .num{width:62px;text-align:right;font-size:12px;color:var(--ink2);font-variant-numeric:tabular-nums}
  .bar{flex:1;height:8px;border-radius:4px;background:#1a2030;overflow:hidden}
  .bar > i{display:block;height:100%;border-radius:4px}
  .bar.san > i{background:linear-gradient(90deg,#c0392b,#e0b35c)}
  .bar.hp > i{background:linear-gradient(90deg,#c0392b,#5cb85c)}
  .bar.mp > i{background:linear-gradient(90deg,#2c445a,#7fb3e0)}
  .chips{margin-top:8px}
  .chip{display:inline-block;font-size:11px;padding:2px 9px;border-radius:999px;border:1px solid var(--line);margin:0 6px 4px 0;color:var(--ink2)}
  .chip.warn{color:#e0b35c;border-color:#5a3a2c}
  .chip.bad{color:#ff8a7a;border-color:#5a2c2c}
  .tl-meta{color:var(--ink3);font-size:12px;margin-bottom:10px}
  .timeline{position:relative;margin:6px 0 4px;padding-left:18px}
  .timeline::before{content:"";position:absolute;left:6px;top:4px;bottom:4px;width:2px;background:linear-gradient(180deg,var(--gold),var(--line))}
  .tl-node{position:relative;padding:8px 0 8px 14px;opacity:0;transform:translateX(-10px);animation:tlIn .5s ease forwards}
  @keyframes tlIn{to{opacity:1;transform:translateX(0)}}
  .tl-dot{position:absolute;left:-16px;top:12px;width:10px;height:10px;border-radius:50%;background:var(--gold);box-shadow:0 0 0 3px rgba(224,179,92,.15)}
  .tl-node.story .tl-dot{background:#7fb3e0}
  .tl-node.chat .tl-dot{background:#7fd0c0}
  .tl-node.bad .tl-dot{background:var(--red);box-shadow:0 0 0 3px rgba(192,57,43,.18)}
  .tl-node.good .tl-dot{background:#5cb85c;box-shadow:0 0 0 3px rgba(92,184,92,.18)}
  .tl-body{background:#0e131d;border:1px solid var(--line);border-radius:10px;padding:8px 12px}
  .tl-node.bad .tl-body{border-color:#5a2c2c}
  .tl-head{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink3);margin-bottom:3px}
  .tl-ic{font-size:13px}
  .tl-kind{color:var(--gold);font-weight:700}
  .tl-who{color:var(--ink2)}
  .tl-time{margin-left:auto;font-variant-numeric:tabular-nums}
  .tl-text{font-size:13px;color:var(--ink)}
  .tl-bad{color:#ff8a7a}
  .tl-good{color:#7fd0a0}
  .tl-tag{display:inline-block;font-size:11px;padding:1px 8px;border-radius:999px;margin-left:4px}
  .tl-tag.bad{color:#ff8a7a;border:1px solid #5a2c2c}
  @media (prefers-reduced-motion: reduce){ .tl-node{animation:none;opacity:1;transform:none} }
</style></head><body><div class="wrap">
  <h1>◈ 战报 · ${summary.scenarioTitle}</h1>
  <div class="sub">${sysBadge} ${summary.systemLabel} · 生成于 ${fmtTime(summary.completedAt)} · 由「银之门」自动整理</div>

  <div class="card">
    <h2>调查员档案</h2>
    <div class="grid">
      <div class="stat"><div class="k">姓名</div><div class="v">${summary.investigatorName}</div></div>
      <div class="stat"><div class="k">SAN</div><div class="v" style="color:${summary.san != null && summary.san < 50 ? 'var(--red)' : 'var(--gold)'}">${summary.san != null ? summary.san : '—'}${summary.maxSan != null ? '/' + summary.maxSan : ''}</div></div>
      <div class="stat"><div class="k">HP</div><div class="v">${summary.hp != null ? summary.hp : '—'}</div></div>
      <div class="stat"><div class="k">MP</div><div class="v">${summary.mp != null ? summary.mp : '—'}</div></div>
      <div class="stat"><div class="k">幸运</div><div class="v">${summary.luck != null ? summary.luck : '—'}</div></div>
      <div class="stat"><div class="k">命运残片</div><div class="v">${summary.fragments}</div></div>
      <div class="stat"><div class="k">疯狂印记</div><div class="v">${summary.madness}</div></div>
      <div class="stat"><div class="k">游玩时长</div><div class="v">${summary.durationText}</div></div>
    </div>
  </div>

  <div class="card">
    <h2>团本概况</h2>
    <div class="grid">
      <div class="stat"><div class="k">剧本</div><div class="v" style="font-size:14px">${summary.scenarioTitle}</div></div>
      <div class="stat"><div class="k">会话次数</div><div class="v">${summary.sessions}</div></div>
      <div class="stat"><div class="k">开始</div><div class="v" style="font-size:13px">${fmtTime(summary.startedAt)}</div></div>
      <div class="stat"><div class="k">完本</div><div class="v" style="font-size:13px">${fmtTime(summary.completedAt)}</div></div>
    </div>
    <div style="margin-top:10px">${scn.premise ? scn.premise : ''}</div>
    <div class="stamp">${summary.outcome}</div>
  </div>

  <div class="card">
    <h2>疯狂印记 / 理智轨迹</h2>
    <ul>${madnessRows}</ul>
  </div>

  <div class="card">
    <h2>命运残片</h2>
    <ul>${fragRows}</ul>
  </div>

  <div class="card">
    <h2>成长与结算</h2>
    <ul>${growthRows}</ul>
  </div>

  ${statusSection}

  ${timelineSection}

  ${mapSection}

  ${damageSection}

  ${recapSection}

  <div class="foot">银之门 · COC/DND 跑团助手 · 本战报已保存至该调查员的个人信息下，可随时回看</div>
</div></body></html>`;
}

/** 行动时间线 · 战损回顾 卡片（#199）：按时间轴回放关键行动与剧情节点，带动画 */
/** 战损时间线节（#战损）：按时间回放战斗中每个 Token 的扣血 / 治疗记录 */
function renderDamageSection(ctx) {
  const log = ctx.map && Array.isArray(ctx.map.damageLog) ? ctx.map.damageLog : [];
  if (!log.length) return '';
  const rows = log.slice().sort((a, b) => (a.t || 0) - (b.t || 0)).map(e => {
    const t = e.t ? fmtTime(e.t) : '—';
    const dmg = e.delta != null ? (e.delta < 0 ? `<b class="dl-bad">−${Math.abs(e.delta)}</b>` : `<b class="dl-good">+${e.delta}</b>`) : '—';
    const who = e.target || '—';
    const after = e.hpAfter != null ? `${e.hpAfter}${e.hpMax ? '/' + e.hpMax : ''}` : '—';
    return `<tr><td>${t}</td><td>${esc(who)}</td><td>${dmg}</td><td>${after}</td><td>${esc(e.note || '')}</td></tr>`;
  }).join('');
  return `<div class="card"><h2>战损时间线</h2>
    <div class="mapmeta">共 ${log.length} 条伤害 / 治疗记录，按时间排序（数据来自战斗中的 GM 战损面板）。</div>
    <table class="dltab"><thead><tr><th>时间</th><th>承受者</th><th>变化</th><th>剩余</th><th>备注</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}
/** 战斗复盘节（#战损复盘）：按角色聚合战损日志，给出总受伤/总治疗/最终HP/状态，
 *  与「战损时间线」互补（前者按时间逐条，后者按角色汇总）。数据来自 map.damageLog + map.tokens。 */
function renderCombatRecap(ctx) {
  const map = ctx.map || {};
  const log = Array.isArray(map.damageLog) ? map.damageLog : [];
  if (!log.length) return '';
  const tokens = Array.isArray(map.tokens) ? map.tokens : [];
  const agg = {};
  log.forEach(e => {
    const n = e.target || '?';
    if (!agg[n]) agg[n] = { dmg: 0, heal: 0, hp: null, hpMax: null, down: false };
    const a = agg[n];
    if (e.delta < 0) a.dmg += (-e.delta);
    else if (e.delta > 0) a.heal += e.delta;
    if (typeof e.hpAfter === 'number') a.hp = e.hpAfter;
    if (typeof e.hpMax === 'number') a.hpMax = e.hpMax;
  });
  tokens.forEach(t => {
    const n = t.name;
    if (!agg[n]) agg[n] = { dmg: 0, heal: 0, hp: null, hpMax: null, down: false };
    const a = agg[n];
    if (t.hp != null) a.hp = +t.hp || 0;
    if (t.hpMax != null) a.hpMax = +t.hpMax || 0;
    const conds = Array.isArray(t.conds) ? t.conds : [];
    if ((+t.hp || 0) <= 0 || conds.indexOf('倒地') >= 0) a.down = true;
  });
  const list = Object.keys(agg).map(n => Object.assign({ n }, agg[n])).sort((x, y) => y.dmg - x.dmg);
  const rows = list.map(a => {
    const hp = a.hp != null ? a.hp : '—';
    const hpMax = a.hpMax != null ? a.hpMax : '';
    const st = a.down ? '<b class="dl-bad">倒地</b>'
      : (a.hp != null && a.hpMax && a.hp / a.hpMax < 0.5 ? '<span class="dl-warn">负伤</span>'
        : '<span class="dl-good">正常</span>');
    return `<tr><td>${esc(a.n)}</td><td class="dl-bad">${a.dmg}</td><td class="dl-good">${a.heal}</td><td>${hp}${hpMax !== '' ? '/' + hpMax : ''}</td><td>${st}</td></tr>`;
  }).join('');
  const totalDmg = list.reduce((s, a) => s + a.dmg, 0);
  const totalHeal = list.reduce((s, a) => s + a.heal, 0);
  const downed = list.filter(a => a.down).length;
  return `<div class="card"><h2>战斗复盘</h2>
    <div class="mapmeta">共 ${log.length} 条战损记录 · 总伤害 ${totalDmg} · 总治疗 ${totalHeal} · ${downed} 人倒地</div>
    <table class="dltab"><thead><tr><th>角色</th><th>总受伤</th><th>总治疗</th><th>最终HP</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}
function renderTimelineSection(summary) {
  const evs = summary.timeline || [];
  const st = summary.timelineStats || {};
  if (!evs.length) return '';
  const icon = { roll: '🎲', story: '📜', chat: '💬' };
  const kindLabel = { roll: '检定 / 行动', story: '剧情推演', chat: '交流' };
  const nodes = evs.map((e, i) => {
    let text = '';
    if (e.kind === 'roll') {
      text = `${esc(e.who)} 掷骰 <b>${e.total != null ? e.total : '?'}</b> / 目标 ${e.target != null ? e.target : '—'}`
        + (e.label ? ` · <b class="${e.fail ? 'tl-bad' : (e.crit ? 'tl-good' : '')}">${esc(e.label)}</b>` : '')
        + (e.fail ? ' <span class="tl-tag bad">战损 / 受挫</span>' : '');
    } else {
      text = esc(e.text || '');
    }
    const cls = ['tl-node', e.kind];
    if (e.kind === 'roll' && e.fail) cls.push('bad');
    if (e.kind === 'roll' && e.crit) cls.push('good');
    return `<div class="${cls.join(' ')}" style="animation-delay:${(i * 0.05).toFixed(2)}s">
      <div class="tl-dot"></div>
      <div class="tl-body">
        <div class="tl-head"><span class="tl-ic">${icon[e.kind] || '•'}</span><span class="tl-kind">${kindLabel[e.kind] || ''}</span><span class="tl-who">${esc(e.who)}</span><span class="tl-time">${fmtTime(e.ts)}</span></div>
        <div class="tl-text">${text}</div>
      </div>
    </div>`;
  }).join('');
  return `<div class="card"><h2>行动时间线 · 战损回顾</h2>
    <div class="tl-meta">共 ${st.total} 个节点 · 检定/行动 ${st.roll} · 剧情 ${st.story} · 交流 ${st.chat}${st.fail ? ' · <span class="tl-tag bad">受挫 ' + st.fail + '</span>' : ''}</div>
    <div class="timeline">${nodes}</div>
    <div class="mapmeta">按时间轴回放本次团本的关键行动与剧情节点；红色为受挫 / 战损时刻，可据此复盘战术得失。</div>
  </div>`;
}

/** 生成战报：写入 HTML 文件并返回 {summary, htmlPath} */
function generateReport(ctx) {
  const summary = buildSummary(ctx);
  const html = renderReportHtml(ctx, summary);
  const id = ctx.campaign.id;
  const htmlPath = path.join(REPORT_DIR, `report-${id}.html`);
  fs.writeFileSync(htmlPath, html, 'utf8');
  return { summary, htmlPath };
}

module.exports = { generateReport, buildSummary, renderReportHtml, buildTimeline, renderTimelineSection, REPORT_DIR };
