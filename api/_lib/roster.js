/*
 * 「拿到某一天的班表」這件事的共用流程：讀雲端 → 跑排班引擎 → 取出那天的結果。
 * webhook、公平性圖片、LIFF 的資料端點都走這裡，才不會各自實作出不一樣的行為。
 */
const { createApp } = require("./app");
// 整包 require（而不是解構）是為了讓本機的 dev-server 可以換掉 fetchRoster 來測試
const firestore = require("./firestore");

// 同一個 container 反覆被叫到時，不需要每次都去 Firestore 拿一次
const CACHE_TTL_MS = 30_000;
let cache = null;

async function loadApp(env, options) {
  const opts = options || {};
  if (!opts.fresh && cache && cache.expiresAt > Date.now()) {
    return cache.value;
  }

  const { payload, updatedAt } = await firestore.fetchRoster(env);
  const App = createApp(payload);
  const value = { App, updatedAt, payload };
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

/**
 * 取某一天的班表。已經按過「確定紀錄」的就直接用那份；還沒確定的就即時算一份預覽
 * （排班是決定性的，預覽跟之後確定的結果會一模一樣）。
 *
 * @returns {{ok:true, schedule:object, preview:boolean} | {ok:false, error:string}}
 */
function scheduleFor(App, dateStr) {
  const St = App.State;

  if (dateStr < St.DUTY_PERIOD_START || dateStr > St.DUTY_PERIOD_END) {
    return {
      ok: false,
      error: `這次的勤務只排 ${St.DUTY_PERIOD_START} ～ ${St.DUTY_PERIOD_END}，${dateStr} 不在範圍內。`,
    };
  }

  const committed = St.get().schedules[dateStr];
  if (committed) return { ok: true, schedule: committed, preview: false };

  const result = App.ScheduleEngine.previewDay(dateStr);
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    schedule: { meals: result.meals, daily: result.daily, warnings: result.warnings },
    preview: true,
  };
}

module.exports = { loadApp, scheduleFor };
