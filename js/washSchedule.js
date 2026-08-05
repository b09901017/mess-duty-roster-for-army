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
 *
 * ── 固定洗碗的人 ──────────────────────────────────
 * 名冊勾了「固定洗碗」的人（目前是招員五位）**三餐都洗**，不進輪替。
 * 他們自己談好的：寧願三餐都洗碗，也不要被打散排到廚餘、擦桌子那些。
 *
 * 所以每一餐是「固定的那幾位 ＋ 輪替補到滿」：23 人時洗碗 7 位 ＝ 固定 5 ＋ 輪替 2。
 * 對照表的洗碗人數不用改，少的那幾個名額才是大家在輪的。
 */
window.App = window.App || {};

(function () {
  "use strict";

  const MEAL_KEYS = window.App.State.MEAL_KEYS;

  /** 三餐都固定洗碗的人（照名冊順序） */
  function fixedWashers(dayMembers) {
    return dayMembers.filter((m) => m.fixedDishwash).slice().sort(window.App.State.washOrder);
  }

  /** 這一天的洗碗輪替隊伍：照洗碗順序排好，扣掉固定送便當與固定洗碗的人 */
  function washQueue(dayMembers) {
    return dayMembers
      .filter((m) => m.fixedRole !== "delivery" && !m.fixedDishwash)
      .slice()
      .sort(window.App.State.washOrder);
  }

  /**
   * @param {object} washState - { nextStartId: string|null }
   * @param {object[]} dayMembers - 當天有出現過的人
   * @param {{breakfast:number,lunch:number,dinner:number}} perMealCounts - 每一餐要幾個人洗
   * @param {(memberId: string, meal: string) => boolean} [isAvailable]
   * @returns {{assignments: object, newWashState: object, queueLength: number, warnings: string[]}}
   */
  function computeWashDay(washState, dayMembers, perMealCounts, isAvailable) {
    const St = window.App.State;
    const available = isAvailable || (() => true);
    const fixed = fixedWashers(dayMembers);
    const queue = washQueue(dayMembers);
    const assignments = { breakfast: [], lunch: [], dinner: [] };
    const warnings = [];

    if (!queue.length && !fixed.length) {
      return { assignments, newWashState: washState || { nextStartId: null }, queueLength: 0, warnings };
    }

    // 從上次停下來的人接著排；那個人已經退伍的話就從隊伍開頭重來
    let cursor = 0;
    if (queue.length && washState && washState.nextStartId) {
      const idx = queue.findIndex((m) => m.id === washState.nextStartId);
      if (idx >= 0) cursor = idx;
    }

    MEAL_KEYS.forEach((meal) => {
      const need = Math.max(0, (perMealCounts && perMealCounts[meal]) || 0);

      // 固定洗碗的人先進去（那一餐在場的才算），剩下的名額才由大家輪
      const fixedHere = fixed.filter((m) => available(m.id, meal)).map((m) => m.id);
      if (fixedHere.length > need) {
        warnings.push(
          `${St.MEAL_LABELS[meal]}：固定洗碗有 ${fixedHere.length} 位，但這一餐只需要 ${need} 位洗碗，` +
            `多出來的人這一餐改由其他勤務吸收。請到「勤務設定」確認這個人數的洗碗名額。`
        );
      }
      const picked = fixedHere.slice(0, need);
      if (!queue.length) {
        assignments[meal] = picked;
        return;
      }
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
      newWashState: { nextStartId: queue.length ? queue[cursor].id : (washState || {}).nextStartId || null },
      queueLength: queue.length,
      warnings,
    };
  }

  window.App.WashSchedule = { computeWashDay, washQueue, fixedWashers };
})();
