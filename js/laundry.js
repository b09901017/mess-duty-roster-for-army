/*
 * 洗衣籃輪替：上樓、下樓各2人，從 261-1,2 開始依名冊順序兩人一組往下輪。
 *
 * 規則（依使用者說明）：
 *   - 今天睡前抬下去的那一組，隔天下午負責把同一個籃子抬上來。
 *   - 所以「抬上來」＝上一個有排班的日子「抬下去」的那組人，不需要另外輪。
 *   - 輪替第一天只有抬下去，沒有籃子要抬上來。
 *   - 送便當的兩位也要一起輪（使用者確認過，每個人都要抬上抬下各一次）。
 *
 * 進度用「上一組最後一位是誰」記住，而不是用「名冊第幾個位置」。
 * 因為有人退伍時在役名單會變短，用位置會讓指標跳過還沒輪到的人
 * （例如 261-2 在 8/4 退伍，用位置就會直接跳過 261-5）。
 */
window.App = window.App || {};

(function () {
  "use strict";

  const COHORT_ORDER = ["261", "263"];
  const PAIR_SIZE = 2;

  /** 固定的名冊順序，含已退伍的人，這樣輪替進度才有一個不會變動的座標系 */
  function canonicalOrder(allMembers) {
    return allMembers.slice().sort((a, b) => {
      const ca = COHORT_ORDER.indexOf(a.cohort);
      const cb = COHORT_ORDER.indexOf(b.cohort);
      if (ca !== cb) return ca - cb;
      return a.seq - b.seq;
    });
  }

  /**
   * @param {object} laundryState - { lastAssignedId: string|null, lastDown: string[] }
   * @param {object[]} allMembers - 全部人員（含已退伍）
   * @param {string} dateStr
   */
  function computeLaundryDay(laundryState, allMembers, dateStr) {
    const warnings = [];

    if (dateStr < window.App.State.LAUNDRY_START) {
      return { up: [], down: [], newLaundryState: laundryState, warnings };
    }

    const order = canonicalOrder(allMembers);
    const isActive = (m) => window.App.State.isActiveOn(m, dateStr);
    const activeIds = new Set(order.filter(isActive).map((m) => m.id));

    if (activeIds.size === 0) {
      return { up: [], down: [], newLaundryState: laundryState, warnings };
    }

    // 抬上來 = 上一個排班日抬下去的那組，只保留今天還在役的人
    const up = (laundryState.lastDown || []).filter((id) => activeIds.has(id));
    if ((laundryState.lastDown || []).length > up.length) {
      warnings.push("昨天抬洗衣籃下去的人有人已經退伍，今天抬上來的人數不足，請手動找人補上。");
    }

    // 抬下去 = 從「上一組最後一位」的下一位開始，往下找還在役的人
    const lastIndex = laundryState.lastAssignedId
      ? order.findIndex((m) => m.id === laundryState.lastAssignedId)
      : -1;

    const down = [];
    const wanted = Math.min(PAIR_SIZE, activeIds.size);
    let cursor = lastIndex;
    let guard = 0;
    while (down.length < wanted && guard < order.length * 2) {
      cursor = (cursor + 1) % order.length;
      guard++;
      const candidate = order[cursor];
      if (activeIds.has(candidate.id) && !down.includes(candidate.id)) {
        down.push(candidate.id);
      }
    }

    const newLaundryState = {
      lastAssignedId: down.length ? down[down.length - 1] : laundryState.lastAssignedId,
      lastDown: down.slice(),
    };

    return { up, down, newLaundryState, warnings };
  }

  window.App.Laundry = { computeLaundryDay, canonicalOrder };
})();
