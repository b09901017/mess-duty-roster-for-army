#!/usr/bin/env node
/*
 * LINE 卡片配色檢查。
 * 兩件事：白字要看得清楚（WCAG 4.5），以及「滑到下一張時看得出換了一張」。
 * 卡片是一張一張滑的，所以真正重要的是相鄰兩張的差距，不是全部兩兩比。
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
const rgb = a => [0,2,4].map(k=>parseInt(a.replace('#','').slice(k,k+2),16));
const dist = (a,b) => { const [r1,g1,b1]=rgb(a),[r2,g2,b2]=rgb(b); return Math.sqrt((r1-r2)**2+(g1-g2)**2+(b1-b2)**2); };

/*
 * 卡片實際的滑動順序。改 api/_lib/cards.js 的顏色時，這裡也要跟著改，
 * 然後跑 npm run check:colors 確認還是通過。
 */
const CARDS = [
  ['早餐',   '#96701A'],
  ['中餐',   '#C0442A'],
  ['晚餐',   '#7E3A63'],
  ['261梯',  '#0F7B6C'],
  ['263梯a', '#2A5FB0'],
  ['263梯b', '#2A5FB0'],
  ['招員',   '#3F7D3A'],
  ['旅部連', '#6B4FA8'],
  ['全日',   '#7A5F45'],
  ['公平性', '#2F3A47'],
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

console.log('\n相鄰兩張的色差（滑動時看不看得出換了一張，>60 好認）：');
for (let i=0;i<CARDS.length-1;i++) {
  const d = dist(CARDS[i][1], CARDS[i+1][1]);
  const same = CARDS[i][1] === CARDS[i+1][1];
  if (!same && d < 60) bad++;
  console.log(`  ${CARDS[i][0].padEnd(7)}→ ${CARDS[i+1][0].padEnd(7)} ${d.toFixed(0).padStart(4)} ${same ? '（同一梯，刻意相同）' : d>=60?'✅':'❌'}`);
}
console.log(bad ? `\n❌ 有 ${bad} 項不合格` : '\n✅ 全部通過');
