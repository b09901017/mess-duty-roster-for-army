#!/usr/bin/env node
/*
 * LINE 卡片配色檢查。
 * 兩件事：白字要看得清楚（WCAG 4.5），以及「滑到下一張時看得出換了一張」。
 * 卡片是一張一張滑的，所以真正重要的是相鄰兩張的差距，不是全部兩兩比。
 *
 * 色差用 CIE Lab 的 ΔE，不是 RGB 直線距離。RGB 距離會低估「色相不同」——
 * 金色與磚紅在 RGB 上很近，但眼睛一看就知道是兩個顏色。
 * ΔE 大約 2 是勉強分得出來，10 以上是一望即知；這裡要求相鄰兩張 ≥ 20。
 */
function lum(hex) {
  const c = hex.replace('#','');
  const v = [0,2,4].map(i => {
    const x = parseInt(c.slice(i,i+2),16)/255;
    return x <= 0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4);
  });
  return 0.2126*v[0] + 0.7152*v[1] + 0.0722*v[2];
}
const ratio = (a,b) => { const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };

/** sRGB → CIE Lab（D65），只為了算 ΔE */
function lab(hex) {
  const c = hex.replace('#','');
  const f = i => { const x = parseInt(c.slice(i,i+2),16)/255; return x <= 0.04045 ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4); };
  const [R,G,B] = [f(0),f(2),f(4)];
  const g = t => t > 0.008856 ? Math.cbrt(t) : 7.787*t + 16/116;
  const X = g((R*0.4124 + G*0.3576 + B*0.1805)/0.95047);
  const Y = g( R*0.2126 + G*0.7152 + B*0.0722);
  const Z = g((R*0.0193 + G*0.1192 + B*0.9505)/1.08883);
  return [116*Y - 16, 500*(X-Y), 200*(Y-Z)];
}
const dist = (a,b) => { const A=lab(a), B=lab(b); return Math.hypot(A[0]-B[0], A[1]-B[1], A[2]-B[2]); };
const MIN_DELTA_E = 20;

/*
 * 卡片實際的滑動順序（2026/08/08 起的六張）。改 api/_lib/cards.js 的顏色時，
 * 這裡也要跟著改，然後跑 npm run check:colors 確認還是通過。
 *
 * 三餐勤務、個人分工、公平性、打飯流程那幾張已經不發了（見 cards.js 的說明），
 * 所以也從這張表拿掉——留著會擋住不存在的相鄰關係。
 */
const CARDS = [
  ['全日',   '#725D4B'],
  ['準據',   '#2F5E63'],
  ['熱追',   '#8A4A2E'],
  ['早餐便當', '#8A6C2C'],
  ['中餐便當', '#AC523B'],
  ['晚餐便當', '#77455E'],
];

console.log('卡片      底色      白字對比  副標對比  判定');
let bad = 0;
CARDS.forEach(([k,v]) => {
  const white = ratio('#ffffff', v);
  const mix = '#' + [0,2,4].map(i => {
    const bg = parseInt(v.replace('#','').slice(i,i+2),16);
    return Math.round(255*0.8 + bg*0.2).toString(16).padStart(2,'0');
  }).join('');
  const sub = ratio(mix, v);
  const ok = white >= 4.5 && sub >= 3.0;
  if (!ok) bad++;
  console.log(`${k.padEnd(8)} ${v}   ${white.toFixed(2)}      ${sub.toFixed(2)}      ${ok ? '✅' : '❌'}`);
});

console.log(`\n相鄰兩張的色差 ΔE（滑動時看不看得出換了一張，≥${MIN_DELTA_E} 好認）：`);
for (let i=0;i<CARDS.length-1;i++) {
  const d = dist(CARDS[i][1], CARDS[i+1][1]);
  const same = CARDS[i][1] === CARDS[i+1][1];
  if (!same && d < MIN_DELTA_E) bad++;
  console.log(`  ${CARDS[i][0].padEnd(7)}→ ${CARDS[i+1][0].padEnd(7)} ${d.toFixed(0).padStart(4)} ${same ? '（同一梯，刻意相同）' : d>=MIN_DELTA_E?'✅':'❌'}`);
}
console.log(bad ? `\n❌ 有 ${bad} 項不合格` : '\n✅ 全部通過');
