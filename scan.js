'use strict';
/* scan.js —— 模块边界校验用的「代码上下文」扫描器
 *
 * 背景：build.js 原本直接用一个「标识符字符类」的全局正则去数符号，
 * 连字符串与注释里的字也被算进来，于是产生两类**假依赖边**：
 *   ① HTML 属性名：`'<span data-ck="'+c.k+'">'` 里的 `ck` 被当成 m1-character 的顶层变量 ck；
 *   ② 注释里提到别的模块的函数名（本仓库中文注释里大量出现函数名）。
 * 假边会让 `depends` 被迫声明不需要的依赖，久了这条守线就没人信了。
 *
 * 做法：codeMask(text) 把**字符串 / 注释 / 正则字面量**的字符换成空格，
 * 保持长度与换行完全不变（行号对齐），这样 build.js 只需要在掩码上跑正则：
 *   · 单/双引号字符串、模板字面量 —— 内容清空；
 *   · 模板字面量里的 ${...} 表达式 —— **保留为代码**（那是真代码）；
 *   · 行注释、块注释 —— 清空（块注释里的换行保留）；
 *   · 正则字面量 —— 清空（含 [..] 字符组里出现的 / 不误判为结束）；
 *   · `a / b` 与 `x = /re/` 的歧义按「前一个有效代码字符」判定。
 *
 * 安全性依据（本仓库实测）：
 *   · 全仓没有 `window['fn']` / `eval` / `new Function` 这类按名动态派发；
 *   · 全仓没有把 `onclick="fn("` 这类内联处理器写进字符串（事件一律在代码里 `.onclick = fn` 绑定）；
 *   · 对现有 5 个模块跑「掩码前 vs 掩码后」的依赖边对拍，差异只有 0 处。
 * 也就是说：掩码**不会**漏掉任何真实耦合，只去掉字符串/注释带来的噪声。
 * 对拍入口：`node coc-apk/scan.js --audit`（见文件末尾）。
 *
 * 适用范围（重要）：**只喂 JS 片段**。
 *   build.js 的调用方式是「每个分块的正文（纯 JS）单独跑一次掩码」，这正是它的用武之地。
 *   不要把整份 `www/index.html` / `index.shell.html` 喂进来 —— HTML 属性里成对出现的引号
 *   会让状态机把一整块 HTML 当成字符串，后面的 JS 会被连带清空（实测过，噪声 15 处全是假的）。
 *
 * 已知不能消解的一类：**局部变量遮蔽**。
 *   例如 `function dijkstraPath(){ ... const ck=cellKey(...) ... }` 里的 `ck` 是函数内局部量，
 *   与 m1-character 的顶层 `ck` 同名。本扫描器不做作用域分析，故仍会报边；
 *   这类情况由 modules.json 的 `scanIgnore` 显式登记（带理由），并在构建输出里以 [info] 呈现。
 */

const ID_RE = /[A-Za-z_$][\w$]*/g;
/* `/` 前面出现这些字符时，它更可能是正则字面量的开始而不是除号 */
const REGEX_PREV = '(,=:[!&|?{};+-*%~^<>';

/* 把一个字符串字面量后的「上一个有效代码字符」重置为操作数语义，
   否则 `'a'/2` 会被当成 `/2.../ ` 变成正则。 */
const AFTER_OPERAND = ')';

function codeMask(s) {
  const n = s.length;
  const out = new Array(n);
  for (let k = 0; k < n; k++) out[k] = s[k];

  /* 状态栈：['code', braceDepth] | ['s',0] | ['tpl',0] | ['re',0] */
  const stack = [['code', 0]];
  let prev = '';
  let i = 0;

  function blank(a, b) {
    const e = Math.min(b, n);
    for (let k = a < 0 ? 0 : a; k < e; k++) if (s[k] !== '\n') out[k] = ' ';
  }
  function isSpace(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v'; }

  while (i < n) {
    const top = stack[stack.length - 1];
    const st = top[0];
    const dep = top[1];
    const c = s[i];

    if (st === 'code') {
      /* 行注释 */
      if (c === '/' && s[i + 1] === '/') {
        let j = s.indexOf('\n', i);
        if (j < 0) j = n;
        blank(i, j); i = j; continue;
      }
      /* 块注释 */
      if (c === '/' && s[i + 1] === '*') {
        let j = s.indexOf('*/', i + 2);
        j = j < 0 ? n : j + 2;
        blank(i, j); i = j; continue;
      }
      if (c === '"' || c === "'") { stack.push(['s', 0]); i++; continue; }
      if (c === '`') { stack.push(['tpl', 0]); i++; continue; }
      /* 正则字面量（只有在「期待操作数」的位置才可能是正则） */
      if (c === '/' && (prev === '' || REGEX_PREV.indexOf(prev) >= 0)) {
        stack.push(['re', 0]); i++; continue;
      }
      if (c === '{' && dep) stack[stack.length - 1] = ['code', dep + 1];
      else if (c === '}') {
        if (dep === 1) { stack.pop(); i++; continue; }
        if (dep > 1) stack[stack.length - 1] = ['code', dep - 1];
      }
      if (!isSpace(c)) prev = c;
      i++; continue;
    }

    if (st === 's' || st === 'tpl') {
      if (c === '\\') { blank(i, i + 2); i += 2; continue; }
      if (st === 's' && (c === '"' || c === "'")) { stack.pop(); prev = AFTER_OPERAND; i++; continue; }
      if (st === 'tpl') {
        if (c === '`') { stack.pop(); prev = AFTER_OPERAND; i++; continue; }
        if (c === '$' && s[i + 1] === '{') {
          blank(i, i + 2);            /* 连 ${ 一起清掉，免得插值漏出一个假的 $ 标识符 */
          stack.push(['code', 1]); i += 2; continue;
        }
      }
      blank(i, i + 1); i++; continue;
    }

    /* st === 're' */
    if (c === '\\') { blank(i, i + 2); i += 2; continue; }
    if (c === '[') {                       /* 字符组：[ 到 ] 之间不结束正则 */
      let k = i + 1;
      while (k < n && s[k] !== ']') k += (s[k] === '\\') ? 2 : 1;
      blank(i, Math.min(k + 1, n)); i = Math.min(k + 1, n); continue;
    }
    if (c === '/') {                       /* 收尾 + 标志位 */
      let k = i + 1;
      while (k < n && /[a-z]/i.test(s[k])) k++;
      blank(i, k); stack.pop(); prev = AFTER_OPERAND; i = k; continue;
    }
    blank(i, i + 1); i++; continue;
  }

  /* pop 出来的空格只填了 out，s 没动；直接 join */
  let r = '';
  for (let k = 0; k < n; k++) r += out[k];
  return r;
}

/* 在掩码上取标识符。返回去重后的名字数组（顺序为首次出现）。 */
function refsOf(text) {
  const masked = codeMask(text);
  const seen = new Set();
  const order = [];
  let m;
  ID_RE.lastIndex = 0;
  while ((m = ID_RE.exec(masked))) {
    if (!seen.has(m[0])) { seen.add(m[0]); order.push(m[0]); }
  }
  return order;
}

module.exports = { codeMask, refsOf };

/* ---------- 自审入口：node coc-apk/scan.js --audit ----------
 * 对现有每个模块跑「掩码前 vs 掩码后」的跨模块依赖边对拍，列出差异。
 * 这是「掩码不会削弱守线」这句话的可复跑证据，不是装饰。 */
if (require.main === module && process.argv.includes('--audit')) {
  const fs = require('fs'), path = require('path');
  const ROOT = __dirname;
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules.json'), 'utf8'));
  const SENT = /^\/\*@@ ([\w.-]+):([\w.-]+) @@\*\/$/;
  const DECL = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/;
  const owner = Object.create(null);
  const text = Object.create(null);
  for (const id of Object.keys(man.modules)) {
    const t = fs.readFileSync(path.join(ROOT, man.modules[id].file), 'utf8').replace(/\r\n/g, '\n');
    text[id] = t;
    for (const ln of t.split('\n')) {
      if (SENT.test(ln)) continue;
      const m = DECL.exec(ln);
      if (m) owner[m[1] || m[2]] = id;
    }
  }
  const grab = (t) => { const s = new Set(); let m; ID_RE.lastIndex = 0; while ((m = ID_RE.exec(t))) s.add(m[0]); return s; };
  let removed = 0;
  for (const id of Object.keys(man.modules)) {
    const raw = grab(text[id]);
    const msk = grab(codeMask(text[id]));
    const added = [...msk].filter(x => !raw.has(x));
    const lostEdges = [...raw].filter(x => owner[x] && owner[x] !== id && !msk.has(x));
    console.log(`${id.padEnd(14)} 掩码新增标识符 ${added.length}  掩码去掉的跨模块引用 ${lostEdges.length}` +
      (lostEdges.length ? '  → ' + lostEdges.map(x => owner[x] + ':' + x).join(', ') : ''));
    if (added.length) console.log('    !! 掩码不应新增标识符：' + added.join(', '));
    removed += lostEdges.length;
  }
  console.log(`\n合计被掩码去掉的跨模块引用：${removed}（现有 5 模块的期望值 = 0）`);
}
