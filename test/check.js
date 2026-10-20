#!/usr/bin/env node
/* 语法哨兵 + 产物漂移检测
 *
 *   node test/check.js
 *
 * 三道检查（任何一道失败 → 退出码非 0，CI 直接红）：
 *   1. 每个 src/*.js 能否被 JS 引擎解析（只编译，不执行）
 *   2. www/index.html 里抽出的内联脚本能否被解析
 *   3. www/index.html 是否与 src/ 同步（等价于 node build.js --check）
 *
 * 设计要点：只做 vm.Script 编译，不 runInContext —— 检查过程不执行任何项目代码，
 * 因此可以安全地在 CI 里对任意 PR 运行。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let failed = 0;

function ok(msg) { console.log('  \x1b[32m✓\x1b[0m ' + msg); }
function bad(msg) {
  failed++;
  console.log('  \x1b[31m✗\x1b[0m ' + msg);
}

/* ---------- 1. 模块源码语法 ---------- */
console.log('\n[1/3] src/ 模块语法');
const srcDir = path.join(ROOT, 'src');
const jsFiles = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js')).sort();
for (const f of jsFiles) {
  const code = fs.readFileSync(path.join(srcDir, f), 'utf8');
  try {
    new vm.Script(code, { filename: 'src/' + f });   // 仅编译
    ok(f);
  } catch (e) {
    bad(f + ' — ' + e.message);
  }
}

/* ---------- 2. 产物内联脚本语法 ---------- */
console.log('\n[2/3] www/index.html 内联脚本语法');
const outPath = path.join(ROOT, 'www', 'index.html');
if (!fs.existsSync(outPath)) {
  bad('www/index.html 不存在，先跑 node build.js');
} else {
  const html = fs.readFileSync(outPath, 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, i = 0, n = 0;
  while ((m = re.exec(html)) !== null) {
    i++;
    const attrs = m[1] || '';
    const body = m[2] || '';
    if (/src\s*=/.test(attrs)) continue;        // 外链脚本，不检查
    if (!body.trim()) continue;
    n++;
    try {
      new vm.Script(body, { filename: 'www/index.html#inline-' + i });
    } catch (e) {
      bad('inline-' + i + ' — ' + e.message);
    }
  }
  if (n === 0) bad('产物里没找到内联脚本（构建异常？）');
  else ok(n + ' 段内联脚本全部可解析');
}

/* ---------- 3. 产物与源码同步 ---------- */
console.log('\n[3/3] 产物漂移检测');
try {
  const build = require(path.join(ROOT, 'build.js'));
  const r = build.run({ check: true, quiet: true });
  if (r.drift) bad('BUILD_DRIFT：www/index.html 与 src/ 不一致，请跑 node build.js 后一并提交');
  else ok('www/index.html 与 src/ 一致 (md5=' + r.hash + ', ' + r.bytes + ' B)');
} catch (e) {
  bad((e.code ? e.code + ': ' : '') + (e.message || String(e)));
}

console.log('');
if (failed) {
  console.log('\x1b[31m' + failed + ' 项检查未通过\x1b[0m\n');
  process.exit(1);
}
console.log('\x1b[32m全部检查通过\x1b[0m\n');
