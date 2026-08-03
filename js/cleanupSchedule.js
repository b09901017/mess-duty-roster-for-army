/*
 * 撤收排班。
 *
 * 舊版是「固定3組、組別輪三餐」，但那個做法沒辦法配合早中晚人數不一樣，
 * 而且採買的人被抽掉時整組就少一人（這就是之前會看到 4/5/6 人的原因）。
 *
 * 現在改成：每天把可排撤收的人「剛好分完」到早、中、晚三餐，
 * 每人每天固定做一次撤收。人數預設早上最輕鬆（16人時是 4/6/6）。
 *
 * 公平性靠「每個人在各餐別的撤收次數」來平衡，次數少的優先被排到那一餐，
 * 所以不會有人固定只做早餐或只做晚餐。
 * 採買的人早、中不在，會被直接安排到晚上撤收。
 */
window.App = window.App || {};

(function () {
  "use strict";

  const MEAL_KEYS = window.App.State.MEAL_KEYS;
  const COHORT_ORDER = ["261", "263"];
  const PER_MEAL_COUNT_KEY = {
    breakfast: "cleanupBreakfast",
    lunch: "cleanupLunch",
    dinner: "cleanupDinner",
  };

  /** 固定送便當的兩位不排撤收 */
  function cleanupEligible(members) {
    return members.filter((m) => m.fixedRole !== "delivery");
  }

  /**
   * 把 n 個人分到三餐，早餐最少（早上比較輕鬆）。
   * n=16 → 4/6/6，符合使用者指定的人數。
   */
  function cleanupSizes(n) {
    if (n <= 0) return { breakfast: 0, lunch: 0, dinner: 0 };
    const breakfast = Math.round(n * 0.25);
    const rest = n - breakfast;
    const lunch = Math.ceil(rest / 2);
    return { breakfast, lunch, dinner: rest - lunch };
  }

  function rosterOrder(a, b) {
    const ca = COHORT_ORDER.indexOf(a.cohort);
    const cb = COHORT_ORDER.indexOf(b.cohort);
    if (ca !== cb) return ca - cb;
    return a.seq - b.seq;
  }

  function countOf(dutyCounts, id, key) {
    return (dutyCounts[id] && dutyCounts[id][key]) || 0;
  }

  /**
   * @param {object[]} dayMembers - 當天有出現過的人（退伍當天的人也算，他早/中還在）
   * @param {object} dutyCounts
   * @param {(memberId: string, meal: string) => boolean} isAvailable - 那個人那一餐在不在（採買、已離營都會是 false）
   * @returns {{assignments: {breakfast:string[],lunch:string[],dinner:string[]}, sizes: object, warnings: string[]}}
   */
  function computeCleanupDay(dayMembers, dutyCounts, isAvailable) {
    const available = isAvailable || (() => true);
    const warnings = [];
    const pool = cleanupEligible(dayMembers).slice().sort(rosterOrder);
    const sizes = cleanupSizes(pool.length);

    /*
     * 有些人晚上不能排撤收：名冊勾了「不排晚上撤收」的新人，以及退伍當天晚上已經離營的人。
     * 因為每個人每天剛好排一次撤收，這些人一定得落在早餐或中餐，
     * 所以挑早／中的時候要讓他們優先，否則最後會被擠到晚餐去。
     */
    const cannotDoDinner = (m) => m.skipDinnerCleanup || !available(m.id, "dinner");
    const mustBeMorning = pool.filter(cannotDoDinner);
    const morningCapacity = sizes.breakfast + sizes.lunch;
    if (mustBeMorning.length > morningCapacity) {
      warnings.push(
        `不能排晚上撤收的人有 ${mustBeMorning.length} 位，超過早餐＋中餐的 ${morningCapacity} 個名額，請調整名冊設定。`
      );
    }

    const assignments = { breakfast: [], lunch: [], dinner: [] };
    let remaining = pool.slice();

    // 早餐、中餐依「非晚上不可者優先 → 那一餐做最少次的人優先」挑，晚餐就是剩下的人
    ["breakfast", "lunch"].forEach((meal) => {
      const need = sizes[meal];
      const mealCountKey = PER_MEAL_COUNT_KEY[meal];
      const candidates = remaining
        .filter((m) => available(m.id, meal))
        .sort((a, b) => {
          const pa = cannotDoDinner(a) ? 0 : 1;
          const pb = cannotDoDinner(b) ? 0 : 1;
          if (pa !== pb) return pa - pb;
          const ma = countOf(dutyCounts, a.id, mealCountKey);
          const mb = countOf(dutyCounts, b.id, mealCountKey);
          if (ma !== mb) return ma - mb;
          const ta = countOf(dutyCounts, a.id, "cleanup");
          const tb = countOf(dutyCounts, b.id, "cleanup");
          if (ta !== tb) return ta - tb;
          return rosterOrder(a, b);
        });

      const chosen = candidates.slice(0, need);
      assignments[meal] = chosen.map((m) => m.id);
      const chosenIds = new Set(assignments[meal]);
      remaining = remaining.filter((m) => !chosenIds.has(m.id));
    });

    assignments.dinner = remaining.filter((m) => available(m.id, "dinner") && !m.skipDinnerCleanup).map((m) => m.id);

    return { assignments, sizes, warnings };
  }

  window.App.CleanupSchedule = { computeCleanupDay, cleanupSizes, cleanupEligible, PER_MEAL_COUNT_KEY };
})();
