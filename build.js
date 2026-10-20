#!/usr/bin/env node
/* 银之门前端构建器（方案 C）
 *
 *   src/index.shell.html  ← 骨架（含 "@@ mod:id @@" 形式的块标记）
 *   src/<module>.js       ← 模块源码（块体之间以 @@ 哨兵分隔）
 *            │
 *            ▼  node build.js
 *   www/index.html        ← 部署产物（单文件，结构与拆分前一致）
 *
 * 用法：
 *   node build.js           构建并写入 www/index.html
 *   node build.js --check   只校验 www/index.html 是否与 src/ 同步（不写入）
 *   node build.js --quiet   安静模式
 *
 * 同时做模块边界校验：模块不得引用未在 modules.json depends 中声明的其他模块的符号。
 * 这既是防止「隐形耦合」复发的自动化抓手，也是逐个模块审查的入口。
 *
 * 结构说明：核心逻辑在 run(options) 里，CLI 只是薄壳。
 * 这样 _check_js.js 可以 **进程内 require** 它做漂移校验，不必 spawn 子进程
 * —— 本沙箱禁止 node 再 spawn node（EBUSY），哨兵一旦依赖子进程就会误报。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const scan = require('./scan');   /* 代码上下文掩码：只统计真代码里的标识符 */

const ROOT = __dirname;

const SENTINEL = /^\/\*@@ ([\w.-]+):([\w.-]+) @@\*\/$/;
/* 模块级声明：必须**顶格**（骨架里的顶层代码没有缩进），否则会把函数体里的
   `for(let i=...)` / `const t=...` 误判成模块级符号，造成假重名与假依赖边。 */
const DECL = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/;

function toLF(s) { return s.replace(/\r\n/g, '\n'); }
function readLF(p) { return toLF(fs.readFileSync(p, 'utf8')); }

/* ---------- 解析模块文件 → { chunkId: [lines] } ---------- */
function parseModuleFile(file, modId) {
  const lines = readLF(path.join(ROOT, file)).split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();   // EOF 产物
  const chunks = Object.create(null);
  let cur = null;
  let sawFirst = false;
  let headerEnd = -1;
  for (let i = 0; i < lines.length; i++) if (SENTINEL.test(lines[i])) { headerEnd = i; break; }
  /* 头注释区域必须只出现一个块注释结束符（就是收尾那一个）。
     多出来一个 → 头注释提前闭合，后面的中文会被当成代码。
     这类错误语法哨兵能抓到，但那时报的是「Unexpected identifier」，
     定位成本高；在这里拦下可以直接说清原因。 */
  if (headerEnd >= 0) {
    const headText = lines.slice(0, headerEnd).join('\n');
    const closes = (headText.match(/\*\//g) || []).length;
    if (closes > 1) throw new Error(`${file}: 头注释区出现 ${closes} 个注释结束符（只允许 1 个）——注释会提前闭合，请删掉多余的那个`);
    if (closes === 1 && !/\*\/\s*$/.test(headText)) throw new Error(`${file}: 头注释的结束符不在最后一行`);
  }
  for (let i = 0; i < lines.length; i++) {
    const m = SENTINEL.exec(lines[i]);
    if (m) {
      if (m[1] !== modId) throw new Error(`${file}:${i + 1} 哨兵模块名 ${m[1]} 与文件 (${modId}) 不一致`);
      if (chunks[m[2]] !== undefined) throw new Error(`${file}:${i + 1} 重复的分块 id ${m[2]}`);
      cur = m[2];
      chunks[cur] = [];
      sawFirst = true;
      continue;
    }
    if (!sawFirst) {
      // 哨兵之前只允许出现注释/空行（模块文件头），不进产物
      const t = lines[i].trim();
      if (t && !/^(\/\*|\*|\/\/)/.test(t)) throw new Error(`${file}:${i + 1} 首个哨兵之前出现非注释内容：${t.slice(0, 60)}`);
      continue;
    }
    if (cur === null) throw new Error(`${file}:${i + 1} 哨兵之后无可归属的行`);
    chunks[cur].push(lines[i]);
  }
  return chunks;
}

/* ---------- 依赖环：Tarjan 强连通分量（只用于报告，不参与拦截） ----------
 * 入参 edges 是 'A->B' 形式的 Set。返回「模块数 > 1」的分量（自环不算，本仓库没有自环）。
 * 递归深度 = 模块数（个位数），不必写成迭代版。 */
function stronglyConnected(nodes, edges) {
  const adj = Object.create(null);
  for (const e of edges) {
    const i = e.indexOf('->');
    const a = e.slice(0, i), b = e.slice(i + 2);
    (adj[a] || (adj[a] = [])).push(b);
  }
  const idx = Object.create(null), low = Object.create(null), on = Object.create(null);
  const stack = [], out = [];
  let counter = 0;
  function strong(v) {
    idx[v] = low[v] = ++counter;
    stack.push(v); on[v] = true;
    for (const w of (adj[v] || [])) {
      if (!idx[w]) { strong(w); low[v] = Math.min(low[v], low[w]); }
      else if (on[w]) low[v] = Math.min(low[v], idx[w]);
    }
    if (low[v] === idx[v]) {
      const comp = [];
      for (;;) { const w = stack.pop(); on[w] = false; comp.push(w); if (w === v) break; }
      if (comp.length > 1) out.push(comp);
    }
  }
  for (const v of nodes) if (!idx[v]) strong(v);
  return out;
}

/* ---------- 构建 / 校验 ----------
 * options: { check?, quiet? }
 * 返回 { hash, bytes, outPath, drift, existed }
 * 失败一律 throw（Error.code 标出类别），让调用方决定怎么报。 */
function run(options) {
  const opts = options || {};
  const CHECK = !!opts.check;
  const QUIET = !!opts.quiet;
  const log = (...a) => { if (!QUIET) console.log(...a); };

  const man = JSON.parse(readLF(path.join(ROOT, 'modules.json')));
  const modIds = Object.keys(man.modules);

  /* 无原型表：否则 ownerOf['toString'] 会命中 Object.prototype.toString，
     把 JS 内置方法当成「别的模块声明的符号」，产生假依赖边与假违规。 */
  const allChunks = Object.create(null);   // "mod:id" -> lines
  const ownerOf = Object.create(null);     // 符号 -> mod
  const symOfModule = Object.create(null); // mod -> Set(符号)

  function collectDecls(mod, lines) {
    for (const ln of lines) {
      const m = DECL.exec(ln);
      if (!m) continue;
      const name = m[1] || m[2];
      if (!name) continue;
      if (ownerOf[name] && ownerOf[name] !== mod)
        throw new Error(`符号重名：${name} 同时声明于 ${ownerOf[name]} 与 ${mod}`);
      ownerOf[name] = mod;
      (symOfModule[mod] || (symOfModule[mod] = new Set())).add(name);
    }
  }

  for (const id of modIds) {
    const spec = man.modules[id];
    const chunks = parseModuleFile(spec.file, id);
    const declared = spec.chunks || [];
    for (const cid of declared) {
      if (chunks[cid] === undefined) throw new Error(`${id}: 清单声明了分块 ${cid}，但 ${spec.file} 中没有`);
    }
    for (const cid of Object.keys(chunks)) {
      if (!declared.includes(cid)) throw new Error(`${id}: ${spec.file} 中的分块 ${cid} 未在 modules.json 声明`);
      if (allChunks[`${id}:${cid}`]) throw new Error(`分块 id 冲突：${id}:${cid}`);
      allChunks[`${id}:${cid}`] = chunks[cid];
      collectDecls(id, chunks[cid]);
    }
  }

  /* ---------- 模块边界校验 ----------
   * 只统计**代码上下文**里的标识符：先过 scan.codeMask 把字符串 / 注释 / 正则字面量清掉。
   * 否则 HTML 属性名（`data-ck`）或注释里提到的函数名都会被当成依赖边 —— 假边一多，
   * `depends` 就只能被迫写宽，这条守线也就没人信了。原理与安全依据见 coc-apk/scan.js。
   * modules.json 的 `scanIgnore` 用来登记「同名但不是依赖」的残留（局部变量遮蔽之类），
   * 必须写清理由，构建时以 [info] 列出；声明的条目一旦失效会 [warn] 提示删除。 */
  const violations = [];
  const usedEdges = new Set();
  const ignored = [];
  for (const id of modIds) {
    const allowed = new Set((man.modules[id].depends || []));
    const ignore = man.modules[id].scanIgnore || {};
    for (const k of Object.keys(ignore)) {
      if (typeof ignore[k] !== 'string' || !ignore[k].trim()) {
        throw new Error(`${id}.scanIgnore["${k}"] 必须写清理由 —— 不能无理由地豁免一条依赖边`);
      }
    }
    const seen = new Set();
    const usedIgnore = new Set();
    for (const [key, lines] of Object.entries(allChunks)) {
      const [owner, cid] = key.split(':');
      if (owner !== id) continue;
      const ids = scan.codeMask(lines.join('\n')).match(/[A-Za-z_$][\w$]*/g) || [];
      for (const t of ids) {
        const o = ownerOf[t];
        if (!o || o === id) continue;
        if (ignore[t] !== undefined) { ignored.push({ id, sym: t, chunk: cid }); usedIgnore.add(t); continue; }
        seen.add(o);
        if (!allowed.has(o)) violations.push({ from: id, to: o, sym: t, chunk: cid });
      }
    }
    for (const o of seen) usedEdges.add(`${id}->${o}`);
    for (const a of allowed) {
      if (!seen.has(a)) log(`  [warn] ${id} 声明依赖 ${a}，但代码里没用到（可精简 modules.json）`);
    }
    for (const k of Object.keys(ignore)) {
      if (!usedIgnore.has(k)) log(`  [warn] ${id}.scanIgnore["${k}"] 已过期 —— 代码里已找不到同名引用，可删`);
    }
  }
  if (violations.length) {
    const lines = ['模块边界校验失败：'];
    for (const v of violations.slice(0, 40))
      lines.push(`  ${v.from} 的 ${v.chunk} 引用了 ${v.to} 的符号 ${v.sym}，但 depends 未声明`);
    if (violations.length > 40) lines.push(`  ...共 ${violations.length} 处`);
    const e = new Error(lines.join('\n'));
    e.code = 'BOUNDARY';
    throw e;
  }

  /* ---------- 组装产物 ---------- */
  const shellPath = path.join(ROOT, man.shell);
  const shell = readLF(shellPath).split('\n');
  if (shell.length && shell[shell.length - 1] === '') shell.pop();  // 文件末尾换行留下的空元素
  const out = [];
  const hit = new Set();
  for (let i = 0; i < shell.length; i++) {
    const ln = shell[i];
    const m = SENTINEL.exec(ln);
    if (!m) { out.push(ln); continue; }
    const key = `${m[1]}:${m[2]}`;
    const body = allChunks[key];
    if (!body) throw new Error(`${man.shell}:${i + 1} 标记 ${key} 在 src 中找不到对应分块`);
    if (hit.has(key)) throw new Error(`${man.shell}:${i + 1} 标记 ${key} 出现多次`);
    hit.add(key);
    out.push(...body);
  }
  const missing = Object.keys(allChunks).filter(k => !hit.has(k));
  if (missing.length) throw new Error(`以下分块在骨架中没有落点：${missing.join(', ')}`);

  const result = out.join('\r\n') + '\r\n';
  const outPath = path.join(ROOT, man.out);
  const hash = crypto.createHash('md5').update(result, 'utf8').digest('hex');
  const bytes = Buffer.byteLength(result, 'utf8');

  /* ---------- 边界图（供报告/审查用） ---------- */
  if (!QUIET) {
    log(`模块 ${modIds.length} 个 / 分块 ${Object.keys(allChunks).length} 个 / 符号 ${Object.keys(ownerOf).length} 个`);
    for (const id of modIds) {
      const s = man.modules[id];
      log(`  ${id.padEnd(8)} L${s.layer} ${s.file.padEnd(20)} 分块 ${(s.chunks || []).join(',')}`);
    }
    log(`依赖边: ${[...usedEdges].sort().join('  ') || '(无)'}`);
    /* 依赖环（强连通分量）。build.js 只拦「未声明的边」、不禁止环 —— 本仓库的调用图确实有
       反向边（骰子面板要通知本地 Keeper、角色抽屉要跳到地图），如实点名比假装单向有用：
       环一旦出现就在这里报出来，免得 modules.json 的 layer/方向描述悄悄失真。 */
    const cycles = stronglyConnected(modIds, usedEdges);
    for (const comp of cycles) {
      const inner = [...usedEdges].filter(e => comp.includes(e.split('->')[0]) && comp.includes(e.split('->')[1]));
      log(`  [info] 依赖环：${[...comp].sort().join(' ↔ ')}` +
          `（强连通分量 ${comp.length} 个模块，${inner.length} 条边）`);
    }
    if (ignored.length) {
      const g = Object.create(null);
      for (const it of ignored) (g[it.id] || (g[it.id] = new Set())).add(it.sym);
      for (const id of Object.keys(g)) {
        log(`  [info] ${id} 按 scanIgnore 忽略同名引用：${[...g[id]].join(', ')}（见 modules.json 的理由）`);
      }
    }
    log(`产物: ${man.out}  ${bytes} B  md5=${hash}`);
  }

  if (CHECK) {
    const exists = fs.existsSync(outPath);
    if (!exists) {
      const e = new Error(`--check: ${man.out} 不存在`);
      e.code = 'NOARTIFACT';
      throw e;
    }
    const cur = fs.readFileSync(outPath);
    const curHash = crypto.createHash('md5').update(cur).digest('hex');
    const same = cur.equals(Buffer.from(result, 'utf8'));
    log(same ? `--check: ${man.out} 与 src/ 一致 (md5=${curHash})`
             : `--check: !! ${man.out} 与 src/ 不同 (磁盘=${curHash} 期望=${hash})`);
    return { hash, diskHash: curHash, bytes, outPath, drift: !same, existed: true };
  }

  fs.writeFileSync(outPath, result, 'utf8');
  log('WROTE ' + man.out);
  return { hash, bytes, outPath, drift: false, existed: true };
}

module.exports = { run, ROOT, parseModuleFile };

if (require.main === module) {
  try {
    const r = run({ check: process.argv.includes('--check'), quiet: process.argv.includes('--quiet') });
    if (r.drift) process.exit(1);
  } catch (e) {
    console.error(e.code === 'BOUNDARY' ? e.message : (e.message || String(e)));
    process.exit(e.code === 'BOUNDARY' ? 2 : 1);
  }
}
