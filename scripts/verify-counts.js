#!/usr/bin/env node
/*
 * 驗證公平性總覽的次數是對的。
 *
 * 完全不看系統存的 dutyCounts，直接從每天的班表把每個人每項勤務重數一遍，
 * 再跟系統存的比對。同時測幾種容易出錯的情境：同一天重排、取消再排回來、
 * 亂序排、改設定後重播——這些都不該讓次數疊加或跑掉。
 *
 *   npm run verify:counts
 */
const { createApp } = require('../api/_lib/app');

function recount(App) {
  const S = App.State, st = S.get();
  const tally = {};
  const add = (id, key) => {
    if (!id) return;
    tally[id] = tally[id] || {};
    tally[id][key] = (tally[id][key] || 0) + 1;
  };
  Object.keys(st.schedules).sort().forEach(date => {
    // 公平性次數從 COUNTS_FROM 才開始累計，之前的日子照樣排但不計入
    if (date < S.COUNTS_FROM) return;
    const sc = st.schedules[date];
    S.MEAL_KEYS.forEach(meal => {
      const m = sc.meals[meal];
      (m.serving.serveDish||[]).forEach(id => add(id, 'serveDish'));
      (m.serving.lid||[]).forEach(id => add(id, 'lid'));
      (m.serving.boxing||[]).forEach(id => add(id, 'boxing'));
      (m.dishwash||[]).forEach(id => add(id, 'dishwash'));
      (m.foodwaste||[]).forEach(id => add(id, 'foodwaste'));
      (m.floor||[]).forEach(id => add(id, 'floor'));
      (m.wipe||[]).forEach(id => add(id, 'wipe'));
      (m.cleanup||[]).forEach(id => { add(id, 'cleanup'); add(id, App.CleanupSchedule.PER_MEAL_COUNT_KEY[meal]); });
    });
    (sc.daily.shopping||[]).forEach(id => add(id, 'shopping'));
    (sc.daily.toilet||[]).forEach(id => add(id, 'toilet'));
    (sc.daily.water||[]).forEach(id => add(id, 'water'));
    (sc.daily.laundryUp||[]).forEach(id => add(id, 'laundry'));
    (sc.daily.laundryDown||[]).forEach(id => add(id, 'laundry'));
  });
  return tally;
}

function compare(label, App) {
  const st = App.State.get();
  const expected = recount(App);
  const problems = [];
  st.members.forEach(m => {
    const got = st.dutyCounts[m.id] || {};
    App.State.DUTY_KEYS.forEach(k => {
      const e = (expected[m.id] || {})[k] || 0;
      const g = got[k] || 0;
      if (e !== g) problems.push(`${m.cohort}-${m.seq} ${m.name} ${k}：班表數到 ${e}，系統存 ${g}`);
    });
  });
  console.log(`${label} → ${problems.length ? '❌ ' + problems.length + ' 個不符' : '✅ 完全相符'}`);
  problems.slice(0, 15).forEach(p => console.log('    ' + p));
  return problems.length === 0;
}

let allOk = true;
const days = Array.from({length:14},(_,i)=>'2026-08-'+String(i+1).padStart(2,'0'));

/*
 * 每個情境都要有採買、有掃廁所。這兩項會把人從早餐、中餐整個抽掉，
 * 是最容易讓重播出錯的地方——沒排下去的話，下面幾個斷言等於沒跑到。
 */
const SHOPPING = { '2026-08-07': ['261-3', '261-5'], '2026-08-11': ['263-4'] };
const TOILET = { '2026-08-06': ['261-9'], '2026-08-07': ['263-2'], '2026-08-12': ['旅部-1'] };
function seedPicks(App) {
  const st = App.State.get();
  st.shoppingByDate = JSON.parse(JSON.stringify(SHOPPING));
  st.toiletByDate = JSON.parse(JSON.stringify(TOILET));
  App.ScheduleEngine.rebuildAll();
  return App;
}

// A. 一次排完
const a = seedPicks(createApp(null));
days.forEach(d => a.ScheduleEngine.commitDay(d));
allOk = compare('A 依序排完 14 天         ', a) && allOk;
const snapA = JSON.stringify(a.State.get().dutyCounts);

// B. 同一天重排很多次
const b = seedPicks(createApp(null));
days.forEach(d => b.ScheduleEngine.commitDay(d));
for (let i = 0; i < 5; i++) b.ScheduleEngine.commitDay('2026-08-07');
allOk = compare('B 8/7 重排 5 次           ', b) && allOk;
console.log('   次數跟 A 一樣嗎：', JSON.stringify(b.State.get().dutyCounts) === snapA ? '✅ 一樣（沒有疊加）' : '❌ 不一樣');

// C. 取消再排回來
const c = seedPicks(createApp(null));
days.forEach(d => c.ScheduleEngine.commitDay(d));
c.ScheduleEngine.uncommitDay('2026-08-09');
c.ScheduleEngine.commitDay('2026-08-09');
allOk = compare('C 8/9 取消再排回來        ', c) && allOk;
console.log('   次數跟 A 一樣嗎：', JSON.stringify(c.State.get().dutyCounts) === snapA ? '✅ 一樣' : '❌ 不一樣');

// D. 亂序排
const d2 = seedPicks(createApp(null));
[...days].reverse().forEach(d => d2.ScheduleEngine.commitDay(d));
allOk = compare('D 倒著排 14 天            ', d2) && allOk;
console.log('   次數跟 A 一樣嗎：', JSON.stringify(d2.State.get().dutyCounts) === snapA ? '✅ 一樣（順序不影響）' : '❌ 不一樣');

// E. 改了勤務人數之後重播
const e = seedPicks(createApp(null));
days.forEach(d => e.ScheduleEngine.commitDay(d));
e.State.get().dutySizeTable.find(r => r.minActiveCount === 19).dishwash = 6;
e.ScheduleEngine.rebuildAll();
allOk = compare('E 改設定後重播            ', e) && allOk;

// F. 鎖定的那天有沒有計入
const f = seedPicks(createApp(null));
days.forEach(d => f.ScheduleEngine.commitDay(d));
const st = f.State.get();
console.log('\n鎖定的 8/5：');
console.log('  洗碗人數 早/中/晚 =',
  ['breakfast','lunch','dinner'].map(m => st.schedules['2026-08-05'].meals[m].dishwash.length).join('/'));
const kb = st.schedules['2026-08-05'].meals.breakfast.dishwash;
console.log('  早餐洗碗 =', kb.map(id => f.State.memberById(id).name).join('、'));
console.log('  8/5 洗衣籃下去 =', (st.schedules['2026-08-05'].daily.laundryDown||[]).map(id=>f.State.memberById(id).name).join('、'));
console.log('  8/6 洗衣籃上來 =', (st.schedules['2026-08-06'].daily.laundryUp||[]).map(id=>f.State.memberById(id).name).join('、'));

const same = JSON.stringify(b.State.get().dutyCounts) === snapA
  && JSON.stringify(c.State.get().dutyCounts) === snapA
  && JSON.stringify(d2.State.get().dutyCounts) === snapA;
process.exit(allOk && same ? 0 : 1);
