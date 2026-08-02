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
   * @param {object[]} activeMembers - 當天在役人員
   * @param {object} dutyCounts
   * @param {(memberId: string, meal: string) => boolean} isAvailable - 採買的人早/中回傳 false
   * @returns {{assignments: {breakfast:string[],lunch:string[],dinner:string[]}}}
   */
  function computeCleanupDay(activeMembers, dutyCounts, isAvailable) {
    const available = isAvailable || (() => true);
    const pool = cleanupEligible(activeMembers).slice().sort(rosterOrder);
    const sizes = cleanupSizes(pool.length);

    const assignments = { breakfast: [], lunch: [], dinner: [] };
    let remaining = pool.slice();

    // 早餐、中餐依「那一餐做最少次的人優先」挑，晚餐就是剩下的人
    ["breakfast", "lunch"].forEach((meal) => {
      const need = sizes[meal];
      const mealCountKey = PER_MEAL_COUNT_KEY[meal];
      const candidates = remaining
        .filter((m) => available(m.id, meal))
        .sort((a, b) => {
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

    assignments.dinner = remaining.filter((m) => available(m.id, "dinner")).map((m) => m.id);

    return { assignments, sizes };
  }

  window.App.CleanupSchedule = { computeCleanupDay, cleanupSizes, cleanupEligible, PER_MEAL_COUNT_KEY };
})();
