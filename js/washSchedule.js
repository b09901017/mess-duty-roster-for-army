/*
 * 洗碗輪值。
 *
 * 舊版是「兩梯輪流當起始梯、各自維護指標」，那是人少的時候為了讓「一天洗兩次」的人
 * 也能公平輪替才需要的。現在人夠多了，使用者改成最單純的做法：
 *
 *   全部人排成一條隊伍，照號碼一路輪下去，接到底就繞回開頭。
 *   順序是 263 → 261 → 五營。
 *
 * 隊伍裡不含固定送便當的兩位——他們那一餐在外面跑便當。
 * 進度記「下一個從誰開始」而不是「第幾個位置」，這樣有人退伍導致隊伍變短時，
 * 指標才不會跳過還沒輪到的人。
 *
 * ── 固定洗碗的人 ──────────────────────────────────
 * 名冊指定「固定洗碗」的人可以只固定某幾餐——招員五位是**早、晚洗碗**，
 * 中午改做廚餘（見 otherDuties.js）。
 *
 * 所以早、晚是「固定的那五位 ＋ 輪替補到滿」（洗碗 7 位 ＝ 固定 5 ＋ 輪替 2），
 * 中午則整整 7 個名額都由輪替池出。對照表的洗碗人數不用改。
 *
 * 有指定固定餐別的人**整天都不進輪替隊伍**：沒指定到的那幾餐他就是不洗碗
 * （招員中午在做廚餘）。這樣隊伍在一天之內是固定的，游標才算得準。
 */
window.App = window.App || {};

(function () {
  "use strict";

  const MEAL_KEYS = window.App.State.MEAL_KEYS;

  /** 這一餐固定洗碗的人（照洗碗順序） */
  function fixedWashers(dayMembers, meal) {
    const St = window.App.State;
    return dayMembers.filter((m) => St.isFixedDishwashAt(m, meal)).slice().sort(St.washOrder);
  }

  /** 這一天的洗碗輪替隊伍：照洗碗順序排好，扣掉固定送便當與有固定洗碗餐別的人 */
  function washQueue(dayMembers) {
    const St = window.App.State;
    return dayMembers
      .filter((m) => m.fixedRole !== "delivery" && !St.hasFixedDishwash(m))
      .slice()
      .sort(St.washOrder);
  }

  /**
   * @param {object} washState - { nextStartId: string|null }
   * @param {object[]} dayMembers - 當天有出現過的人
   * @param {{breakfast:number,lunch:number,dinner:number}} perMealCounts - 每一餐要幾個人洗
   * @param {(memberId: string, meal: string) => boolean} [isAvailable]
   * @returns {{assignments: object, newWashState: object, queueLength: number, warnings: string[]}}
   */
  function computeWashDay(washState, dayMembers, perMealCounts, isAvailable, mealsToday) {
    const St = window.App.State;
    const available = isAvailable || (() => true);
    const queue = washQueue(dayMembers);
    const assignments = { breakfast: [], lunch: [], dinner: [] };
    const warnings = [];
    const anyFixed = dayMembers.some((m) => St.hasFixedDishwash(m));

    if (!queue.length && !anyFixed) {
      return { assignments, newWashState: washState || { nextStartId: null }, queueLength: 0, warnings };
    }

    // 從上次停下來的人接著排；那個人已經退伍的話就從隊伍開頭重來
    let cursor = 0;
    if (queue.length && washState && washState.nextStartId) {
      const idx = queue.findIndex((m) => m.id === washState.nextStartId);
      if (idx >= 0) cursor = idx;
    }

    const MEALS = (mealsToday && mealsToday.length ? mealsToday : MEAL_KEYS).slice();
    MEALS.forEach((meal) => {
      const need = Math.max(0, (perMealCounts && perMealCounts[meal]) || 0);

      // 這一餐固定洗碗的人先進去（在場的才算），剩下的名額才由大家輪
      const fixedHere = fixedWashers(dayMembers, meal)
        .filter((m) => available(m.id, meal))
        .map((m) => m.id);
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
