/* 银之门 · 骰子 / 检定引擎（纯函数，零依赖）
 * 支持：
 *  - 通用骰子表达式：3d6+2、2d20kh1、4d6kh3、1d8-1、d20(=1d20)、1d100
 *  - COC 7e 技能检定：1d100 命中技能值 → 大成功/极难成功/困难成功/成功/失败/大失败
 *  - COC 奖励/惩罚骰（bp=bonus|penalty）：额外 1d100 取最优/最差
 * 复用思路：tyche-rs(FoundryVTT 语法 kh/kl)、coc-dice-bot(d100 成功等级)、coc-dnd-dice(奖惩骰)
 */
'use strict';

function rollDie(sides) {
  if (sides < 2) throw new Error('骰子面数至少为 2');
  return 1 + Math.floor(Math.random() * sides);
}

/* 解析并求值一个骰子表达式，返回 {expr,total,breakdown} */
function evalDice(input) {
  const src = String(input || '').trim().toLowerCase();
  if (!src) throw new Error('骰子表达式为空');
  // 按符号切分为带符号的项
  const parts = src.split(/(?=[+-])/);
  let total = 0;
  const breakdown = [];
  for (let raw of parts) {
    if (!raw) continue;
    let sign = 1;
    let t = raw;
    if (t[0] === '+') t = t.slice(1);
    else if (t[0] === '-') { sign = -1; t = t.slice(1); }
    const dm = t.match(/^(\d*)d(\d+)(kh\d+|kl\d+)?$/);
    if (dm) {
      const count = dm[1] === '' ? 1 : parseInt(dm[1], 10);
      const sides = parseInt(dm[2], 10);
      const keep = dm[3] || null;
      if (count < 1 || count > 200 || sides < 2 || sides > 2000) throw new Error('骰子范围非法: ' + raw);
      const dice = [];
      for (let i = 0; i < count; i++) dice.push(rollDie(sides));
      let used = dice.slice();
      let dropped = [];
      if (keep) {
        const kn = parseInt(keep.slice(2), 10);
        const asc = dice.slice().sort((a, b) => a - b);
        if (keep.startsWith('kh')) { used = asc.slice(asc.length - kn); dropped = asc.slice(0, asc.length - kn); }
        else { used = asc.slice(0, kn); dropped = asc.slice(kn); }
      }
      const subtotal = used.reduce((a, b) => a + b, 0) * sign;
      total += subtotal;
      breakdown.push({ term: t, dice, used, dropped, sign, subtotal });
    } else {
      const c = parseInt(t, 10);
      if (isNaN(c)) throw new Error('无法解析的项: ' + raw);
      total += c * sign;
      breakdown.push({ term: t, constant: c * sign, sign });
    }
  }
  return { expr: src, total, breakdown };
}

/* COC 7e 成功等级 —— 与前端 m0-core 的 cocLevel() **同构**。
 * 这两份实现由 _mr_test.js PART 6（抠出客户端函数源码对拍 10000 组）与
 * _mod_m0_test.js 双重看守：改一边忘另一边会立刻变红。
 *   大成功：掷出 01；或技能 ≥ 50 时掷出 01–05
 *   大失败：掷出 100；或技能 < 50 时掷出 96–00
 *   极难成功 ≤ ⅕ 目标值 · 困难成功 ≤ ½ 目标值 · 成功 ≤ 目标值
 * 修复记录（F2）：原实现只在 01/100 判大成功/大失败，漏了 7e 的技能条件
 * （技能 ≥50 的 01–05、技能 <50 的 96–00）；且有 `s >= 100 → 普通成功` 的特例，
 * 会把 100 技能角色的「极难/困难成功」整档丢掉。以上均已去掉，标签统一为「成功」。 */
const COC_LEVEL_LABEL = { fumble: '大失败', crit: '大成功', extreme: '极难成功', hard: '困难成功', regular: '成功', fail: '失败' };

function cocLevel(roll, target) {
  const t = Math.max(1, Math.floor(target || 0));
  if (roll === 100 || (t < 50 && roll >= 96)) return 'fumble';
  if (roll === 1 || (t >= 50 && roll <= 5)) return 'crit';
  if (roll <= Math.floor(t / 5)) return 'extreme';
  if (roll <= Math.floor(t / 2)) return 'hard';
  if (roll <= t) return 'regular';
  return 'fail';
}

/* 兼容旧入口（返回 {level,label}） */
function cocCheck(roll, skill) {
  const level = cocLevel(roll, skill);
  return { level, label: COC_LEVEL_LABEL[level] };
}

/* COC 奖励/惩罚骰：额外 1d100，bonus 取最小(最优)，penalty 取最大(最差) */
function cocRollWithBP(skill, bp) {
  const all = [rollDie(100)];
  let n = 0;
  if (bp === 'bonus') n = 1;
  else if (bp === 'penalty') n = -1;
  else if (typeof bp === 'number') n = bp > 0 ? 1 : (bp < 0 ? -1 : 0);
  for (let i = 0; i < Math.abs(n); i++) all.push(rollDie(100));
  let roll = all[0];
  if (n > 0) roll = Math.min.apply(null, all);
  else if (n < 0) roll = Math.max.apply(null, all);
  const chk = cocCheck(roll, skill);
  return { roll, all, level: chk.level, label: chk.label };
}

/* 统一入口：{expr, system, skill, bp, vis} → 结果 */
function roll(opts) {
  opts = opts || {};
  const system = opts.system === 'dnd' ? 'dnd' : 'coc';
  const bp = opts.bp || 'none';
  const skill = opts.skill != null ? Number(opts.skill) : null;
  const isD100Check = /^\s*(1d100|d100)\s*$/.test(opts.expr || '1d100');

  // COC 技能检定（带奖励/惩罚骰）
  if (system === 'coc' && skill != null && isD100Check) {
    const r = cocRollWithBP(skill, bp);
    return {
      system: 'coc', expr: '1d100', total: r.roll, dice: r.all,
      label: r.label, level: r.level, target: skill, bp
    };
  }
  // 通用表达式
  const e = evalDice(opts.expr || '1d20');
  let label = null, level = null, target = null;
  // 若仅一个 d100 且提供了技能，套用 COC 成功等级
  const singleD100 = e.breakdown.length === 1 && e.breakdown[0].dice &&
    e.breakdown[0].dice.length === 1 && e.breakdown[0].dice[0] <= 100 && e.total <= 100;
  if (system === 'coc' && skill != null && singleD100) {
    const chk = cocCheck(e.total, skill);
    label = chk.label; level = chk.level; target = skill;
  }
  return {
    system, expr: e.expr, total: e.total,
    dice: e.breakdown.reduce((acc, b) => acc.concat(b.dice || []), []),
    label, level, target, bp
  };
}

module.exports = { roll, evalDice, cocCheck, cocLevel, COC_LEVEL_LABEL, cocRollWithBP };
