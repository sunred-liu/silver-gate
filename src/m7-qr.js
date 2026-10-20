/*
 * m7-qr —— 极简 QR 编码器（零依赖 · 离线可用）
 * 完全自包含：出边 0、无人引用它（只有卡片页脚与分享模块调用 QR.matrix）。
 * 分块哨兵会被 coc-apk/build.js 识别，哨兵行不进入产物。
 */
/*@@ m7-qr:encoder @@*/
/* ============================================================
   极简 QR 编码器（零依赖 · 离线可用）
   卡片页脚要印「扫一扫直达 App」的二维码。项目策略是 vendor 全部本地化、
   APK 内嵌资源离线可跑，所以不引外部库，自己实现。
   实现范围：byte 模式 + 纠错 M + 版本 1-9 + 8 种掩码按 ISO 18004 罚分择优。
   分享链接是短 URL，v9-M 可容纳 182 字节，绰绰有余。
   已用独立解码器（jsQR）逐条验证解出原文，且与参考实现在 v1-v4 上逐模块一致。
   ============================================================ */
const QR=(function(){
  'use strict';
  /* 版本表（纠错 M）：总码字 / 每块纠错码字 / 各块数据码字数 */
  const V=[null,
    {tot:26, ec:10, blocks:[16]},
    {tot:44, ec:16, blocks:[28]},
    {tot:70, ec:26, blocks:[44]},
    {tot:100,ec:18, blocks:[32,32]},
    {tot:134,ec:24, blocks:[43,43]},
    {tot:172,ec:16, blocks:[27,27,27,27]},
    {tot:196,ec:18, blocks:[31,31,31,31]},
    {tot:242,ec:22, blocks:[38,38,39,39]},
    {tot:292,ec:22, blocks:[36,36,36,37,37]}];
  const ALIGN=[null,[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46]];
  const EXP=new Array(512), LOG=new Array(256);
  (function(){ let x=1; for(let i=0;i<255;i++){ EXP[i]=x; LOG[x]=i; x<<=1; if(x&0x100) x^=0x11D; } for(let j=255;j<512;j++) EXP[j]=EXP[j-255]; })();
  const gmul=(a,b)=> (!a||!b)?0:EXP[LOG[a]+LOG[b]];
  function rsGen(n){
    let g=[1];
    for(let i=0;i<n;i++){
      const ng=new Array(g.length+1).fill(0);
      // g ← g × (x + α^i)，系数高位在前：ng[k] = g[k] ⊕ α^i·g[k-1]
      for(let j=0;j<g.length;j++){ ng[j]^=g[j]; ng[j+1]^=gmul(g[j],EXP[i]); }
      g=ng;
    }
    return g;
  }
  function rsEncode(data,ecLen){
    const g=rsGen(ecLen), res=data.concat(new Array(ecLen).fill(0));
    for(let i=0;i<data.length;i++){
      const coef=res[i];
      if(coef!==0) for(let j=0;j<g.length;j++) res[i+j]^=gmul(g[j],coef);
    }
    return res.slice(data.length);
  }
  function utf8(s){
    const out=[];
    for(let i=0;i<s.length;i++){
      let c=s.charCodeAt(i);
      if(c<0x80) out.push(c);
      else if(c<0x800) out.push(0xC0|(c>>6), 0x80|(c&63));
      else if(c>=0xD800&&c<=0xDBFF){
        const c2=s.charCodeAt(++i);
        c=0x10000+((c-0xD800)<<10)+(c2-0xDC00);
        out.push(0xF0|(c>>18), 0x80|((c>>12)&63), 0x80|((c>>6)&63), 0x80|(c&63));
      } else out.push(0xE0|(c>>12), 0x80|((c>>6)&63), 0x80|(c&63));
    }
    return out;
  }
  const cap=v=>V[v].blocks.reduce((a,b)=>a+b,0);
  function pickVersion(n){ for(let v=1;v<=9;v++) if(12+n*8<=cap(v)*8) return v; return 0; }  // 4位模式+8位长度
  function buildData(bytes,ver){
    const bits=[];
    const put=(val,n)=>{ for(let i=n-1;i>=0;i--) bits.push((val>>i)&1); };
    put(4,4);                       // 0100 = byte 模式
    put(bytes.length,8);            // 版本 1-9 的 byte 模式长度为 8 位
    for(let i=0;i<bytes.length;i++) put(bytes[i],8);
    const total=cap(ver)*8;
    put(0,Math.min(4,total-bits.length));      // 终止符
    while(bits.length%8) bits.push(0);         // 对齐到字节
    const data=[];
    for(let k=0;k<bits.length;k+=8){ let b=0; for(let j=0;j<8;j++) b=(b<<1)|bits[k+j]; data.push(b); }
    const pad=[0xEC,0x11]; let pi=0;
    while(data.length<cap(ver)) data.push(pad[pi++%2]);
    return data;
  }
  function makeCodewords(data,ver){
    const spec=V[ver], blocks=[]; let off=0;
    for(const n of spec.blocks){ const d=data.slice(off,off+n); off+=n; blocks.push({d, e:rsEncode(d,spec.ec)}); }
    const maxD=Math.max.apply(null,spec.blocks), out=[];
    for(let k=0;k<maxD;k++) for(const b of blocks) if(k<b.d.length) out.push(b.d[k]);
    for(let m=0;m<spec.ec;m++) for(const b of blocks) out.push(b.e[m]);
    return out;
  }
  function bchDigit(d){ let n=0; while(d!==0){ n++; d>>>=1; } return n; }
  function bchInfo(data){
    const G15=0x537, MASK=0x5412; let d=data<<10;
    while(bchDigit(d)-bchDigit(G15)>=0) d^=(G15<<(bchDigit(d)-bchDigit(G15)));
    return ((data<<10)|d)^MASK;
  }
  function bchVersion(v){
    const G18=0x1F25; let d=v<<12;
    while(bchDigit(d)-bchDigit(G18)>=0) d^=(G18<<(bchDigit(d)-bchDigit(G18)));
    return (v<<12)|d;
  }
  function maskAt(p,i,j){
    switch(p){
      case 0: return (i+j)%2===0;
      case 1: return i%2===0;
      case 2: return j%3===0;
      case 3: return (i+j)%3===0;
      case 4: return (Math.floor(i/2)+Math.floor(j/3))%2===0;
      case 5: return ((i*j)%2)+((i*j)%3)===0;
      case 6: return (((i*j)%2)+((i*j)%3))%2===0;
      case 7: return (((i*j)%3)+((i+j)%2))%2===0;
    }
    return false;
  }
  function build(ver,cw,mask){
    const size=ver*4+17, mods=[];
    for(let i=0;i<size;i++) mods.push(new Array(size).fill(null));
    const probe=(r,c)=>{
      for(let y=-1;y<=7;y++) for(let x=-1;x<=7;x++){
        const rr=r+y, cc=c+x;
        if(rr<0||rr>=size||cc<0||cc>=size) continue;
        mods[rr][cc]=(y>=0&&y<=6&&(x===0||x===6))||(x>=0&&x<=6&&(y===0||y===6))||(y>=2&&y<=4&&x>=2&&x<=4);
      }
    };
    probe(0,0); probe(size-7,0); probe(0,size-7);
    const pos=ALIGN[ver];
    for(const row of pos) for(const col of pos){
      if(mods[row][col]!==null) continue;
      for(let r=-2;r<=2;r++) for(let c=-2;c<=2;c++)
        mods[row+r][col+c]=(r===-2||r===2||c===-2||c===2||(r===0&&c===0));
    }
    for(let t=8;t<size-8;t++){
      if(mods[t][6]===null) mods[t][6]=(t%2===0);
      if(mods[6][t]===null) mods[6][t]=(t%2===0);
    }
    const fmt=bchInfo(mask);                  // 纠错 M → 高位为 00
    for(let k=0;k<15;k++){
      const bit=((fmt>>k)&1)===1;
      if(k<6) mods[k][8]=bit; else if(k<8) mods[k+1][8]=bit; else mods[size-15+k][8]=bit;
      if(k<8) mods[8][size-k-1]=bit; else if(k===8) mods[8][7]=bit; else mods[8][14-k]=bit;
    }
    mods[size-8][8]=true;                     // 固定暗模块
    if(ver>=7){
      const vin=bchVersion(ver);
      for(let q=0;q<18;q++){
        const vb=((vin>>q)&1)===1;
        mods[Math.floor(q/3)][q%3+size-11]=vb;
        mods[q%3+size-11][Math.floor(q/3)]=vb;
      }
    }
    let inc=-1, row=size-1, bitIdx=7, byteIdx=0;
    for(let col=size-1;col>0;col-=2){
      if(col===6) col--;
      for(;;){
        for(let c2=0;c2<2;c2++){
          const cc=col-c2;
          if(mods[row][cc]===null){
            let dark=false;
            if(byteIdx<cw.length) dark=(((cw[byteIdx]>>>bitIdx)&1)===1);
            if(maskAt(mask,row,cc)) dark=!dark;
            mods[row][cc]=dark;
            bitIdx--;
            if(bitIdx===-1){ byteIdx++; bitIdx=7; }
          }
        }
        row+=inc;
        if(row<0||row>=size){ row-=inc; inc=-inc; break; }
      }
    }
    return mods;
  }
  function penalty(m){
    const size=m.length; let p=0,i,j;
    for(i=0;i<size;i++){
      let run=1;
      for(j=1;j<size;j++){ if(m[i][j]===m[i][j-1]) run++; else { if(run>=5) p+=3+(run-5); run=1; } }
      if(run>=5) p+=3+(run-5);
      run=1;
      for(j=1;j<size;j++){ if(m[j][i]===m[j-1][i]) run++; else { if(run>=5) p+=3+(run-5); run=1; } }
      if(run>=5) p+=3+(run-5);
    }
    for(i=0;i<size-1;i++) for(j=0;j<size-1;j++){
      const v=m[i][j];
      if(v===m[i][j+1]&&v===m[i+1][j]&&v===m[i+1][j+1]) p+=3;
    }
    const p1=[true,false,true,true,true,false,true,false,false,false,false];
    const p2=[false,false,false,false,true,false,true,true,true,false,true];
    const hit=(arr,off,pat)=>{ for(let t=0;t<11;t++) if(!!arr[off+t]!==pat[t]) return false; return true; };
    for(i=0;i<size;i++){
      const rw=m[i], cl=[]; for(let k=0;k<size;k++) cl.push(m[k][i]);
      for(j=0;j+11<=size;j++){
        if(hit(rw,j,p1)||hit(rw,j,p2)) p+=40;
        if(hit(cl,j,p1)||hit(cl,j,p2)) p+=40;
      }
    }
    let dark=0;
    for(i=0;i<size;i++) for(j=0;j<size;j++) if(m[i][j]) dark++;
    p+=Math.floor(Math.abs(dark*100/(size*size)-50)/5)*10;
    return p;
  }
  return {
    /* 返回 {size, modules, version, mask}；放不下时返回 null */
    matrix(text, forceMask){
      const bytes=utf8(String(text));
      const ver=pickVersion(bytes.length);
      if(!ver) return null;
      const cw=makeCodewords(buildData(bytes,ver),ver);
      if(typeof forceMask==='number'&&forceMask>=0&&forceMask<=7)
        return {size:ver*4+17, modules:build(ver,cw,forceMask), version:ver, mask:forceMask};
      let best=null,bestP=Infinity,bestMask=0;
      for(let m2=0;m2<8;m2++){
        const mods=build(ver,cw,m2), p=penalty(mods);
        if(p<bestP){ bestP=p; best=mods; bestMask=m2; }
      }
      return {size:best.length, modules:best, version:ver, mask:bestMask};
    },
    /* 最大可编码**载荷**字节数：数据码字总数扣除字节模式的 4bit 模式指示符
       + 8bit 字符计数（共 12bit）后向下取整 —— v9-M 为 floor((182*8-12)/8) = 180。
       注意不是 cap(9)=182：调用方若写 s.length<=capacity() 再把入参喂给 matrix()，
       182 会放行 181/182 字节，而 matrix() 对它们返回 null。 */
    capacity(){ return Math.floor((cap(9)*8-12)/8); },
    /* 原始数据码字字节数（需要底层容量时用这个） */
    rawCapacity(){ return cap(9); }
  };
})();
