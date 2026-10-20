/*
 * m2-dice —— 骰子与检定
 * 依赖 m0-core（diceState）。rollCOC/freeFallback 另读全局 CHAR（M1，暂未模块化）。
 * 分块哨兵会被 coc-apk/build.js 识别，哨兵行不进入产物。
 */
/*@@ m2-dice:coc @@*/
/* ---------- dice logic ---------- */
function rollCOC(skillName, diff, bp, mod){
  const base = CHAR.skills[skillName];
  if(base===undefined){ return freeFallback(skillName,diff,bp,mod); }
  let target = base + (mod||0);
  let tens=[Math.floor(Math.random()*10)];
  if(bp==='bonus'){tens.push(Math.floor(Math.random()*10));}
  if(bp==='penalty'){tens.push(Math.floor(Math.random()*10));}
  const ones=Math.floor(Math.random()*10);
  let chosen = bp==='bonus'? Math.min(...tens) : bp==='penalty'? Math.max(...tens) : tens[0];
  let roll = chosen*10+ones; if(roll===0) roll=100;
  return {skill:skillName,diff,target,roll,tens,ones,bp,vis:diceState.vis};
}
function freeFallback(skillName,diff,bp,mod){
  let tens=[Math.floor(Math.random()*10)];
  if(bp==='bonus')tens.push(Math.floor(Math.random()*10));
  if(bp==='penalty')tens.push(Math.floor(Math.random()*10));
  const ones=Math.floor(Math.random()*10);
  let chosen=bp==='bonus'?Math.min(...tens):bp==='penalty'?Math.max(...tens):tens[0];
  let roll=chosen*10+ones;if(roll===0)roll=100;
  return {skill:skillName,diff,target:50+mod,roll,tens,ones,bp,vis:diceState.vis,custom:true};
}
function rollFree(face,count,mod){
  const res=[];
  let total=0;
  for(let i=0;i<count;i++){const r=1+Math.floor(Math.random()*face);res.push(r);total+=r;}
  total+=mod;
  return {face,count,mod,res,total,vis:diceState.vis};
}
/*@@ m2-dice:ai @@*/
/* ---- 通用：AI 掷骰（指定角色） ---- */
function aiRoll(skillName, char, diff, bp, mod){
  /* 注意：不能写成 `(char&&char.skills&&char.skills[skillName])` —— 当 char 或 char.skills
     为空值时该表达式返回 null，而 `null !== undefined` 成立，会走 base 分支得到
     target = null + mod = 0（AI 队友出手必失败），而不是回落到 50。 */
  const base=(char&&char.skills)?char.skills[skillName]:undefined;
  let target = (base==null? 50 : base) + (mod||0);
  let tens=[Math.floor(Math.random()*10)];
  if(bp==='bonus') tens.push(Math.floor(Math.random()*10));
  if(bp==='penalty') tens.push(Math.floor(Math.random()*10));
  const ones=Math.floor(Math.random()*10);
  let chosen = bp==='bonus'? Math.min(...tens) : bp==='penalty'? Math.max(...tens) : tens[0];
  let roll = chosen*10+ones; if(roll===0) roll=100;
  return {skill:skillName, diff:diff||'reg', target, roll, tens, ones, bp:bp||'none', vis:'public'};
}
function aiDiceMsg(who, role, d){ return {t:'dice', who, role, ava:role, skill:d.skill, diff:d.diff, roll:d.roll, target:d.target, tens:d.tens, ones:d.ones, bp:d.bp, vis:'public'}; }
