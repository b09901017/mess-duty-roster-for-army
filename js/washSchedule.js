/*
 * 洗碗輪值。
 *
 * 舊版是「兩梯輪流當起始梯、各自維護指標」，那是人少的時候為了讓「一天洗兩次」的人
 * 也能公平輪替才需要的。現在人夠多了，使用者改成最單純的做法：
 *
 *   全部人排成一條隊伍，照號碼一路輪下去，接到底就繞回開頭。
 *   順序是 263 → 261 → 招員 → 旅部連（招員就是 261-9~13，照 cohort+seq 排會自然接上）。
 *
 * 隊伍裡不含固定送便當的兩位——他們那一餐在外面跑便當。
 * 進度記「下一個從誰開始」而不是「第幾個位置」，這樣有人退伍導致隊伍變短時，
 * 指標才不會跳過還沒輪到的人。
 */
window.App = window.App || {};

(function () {
  "use strict";

  const MEAL_KEYS = window.App.State.MEAL_KEYS;

  /** 這一天的洗碗隊伍：照洗碗順序排好，扣掉固定送便當的兩位 */
  function washQueue(dayMembers) {
    return dayMembers.filter((m) => m.fixedRole !== "delivery").slice().sort(window.App.State.washOrder);
  }

  /**
   * @param {object} washState - { nextStartId: string|null }
   * @param {object[]} dayMembers - 當天有出現過的人
   * @param {{breakfast:number,lunch:number,dinner:number}} perMealCounts - 每一餐要幾個人洗
   * @param {(memberId: string, meal: string) => boolean} [isAvailable]
   * @returns {{assignments: object, newWashState: object, queueLength: number}}
   */
  function computeWashDay(washState, dayMembers, perMealCounts, isAvailable) {
    const available = isAvailable || (() => true);
    const queue = washQueue(dayMembers);
    const assignments = { breakfast: [], lunch: [], dinner: [] };

    if (!queue.length) {
      return { assignments, newWashState: washState || { nextStartId: null }, queueLength: 0 };
    }

    // 從上次停下來的人接著排；那個人已經退伍的話就從隊伍開頭重來
    let cursor = 0;
    if (washState && washState.nextStartId) {
      const idx = queue.findIndex((m) => m.id === washState.nextStartId);
      if (idx >= 0) cursor = idx;
    }

    MEAL_KEYS.forEach((meal) => {
      const need = Math.max(0, (perMealCounts && perMealCounts[meal]) || 0);
      const picked = [];
      /*
       * 從游標往後拿人。這一餐不在的人（已離營）跳過，但游標照樣往前，
       * 免得他一直卡在隊伍前面害後面的人輪不到。
       * 最多走兩圈，避免全員都不在時無限迴圈。
       */
      let steps = 0;
      const maxSteps = queue.length * 2;
      while (picked.length < need && steps < maxSteps) {
        const member = queue[cursor];
        cursor = (cursor + 1) % queue.length;
        steps++;
        if (!available(member.id, meal)) continue;
        if (picked.indexOf(member.id) !== -1) continue; // 同一餐不重複排同一個人
        picked.push(member.id);
      }
      assignments[meal] = picked;
    });

    return {
      assignments,
      newWashState: { nextStartId: queue[cursor].id },
      queueLength: queue.length,
    };
  }

  window.App.WashSchedule = { computeWashDay, washQueue };
})();
