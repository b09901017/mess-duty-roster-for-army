/*
 * 撤收排班。
 *
 * 規則（使用者指定）：
 *   - 名冊勾「固定洗碗」的招員完全不排撤收（他們三餐都在洗碗）。
 *   - 每餐人數照人數階梯：18 人以上 早4／中7／晚7，之後 4/7/6 → 4/6/6 → 4/5/6 …
 *     **不是**每個人每天都要輪到一次。
 *   - 誰先排：這項勤務累計做最少的人優先，同次數照名冊號碼。
 *   - 固定送便當的兩位早、中在外面跑便當，撤收只排得到晚上。
 *   - 那一餐洗碗的人，那一餐不排撤收（洗碗本身就夠久了）。
 *   - 招員（名冊勾「免排晚上撤收」）不能排晚餐；旅部連可以。
 *   - 退伍當天晚上已離營。
 *
 * 為什麼用流量演算法而不是「排序後依序挑」：
 * 上面幾條限制會互相牽制，而且要同時決定三餐——貪心法會卡死，
 * 先被早餐挑走的人可能剛好是晚餐唯一排得動的人。
 * 最小成本最大流則是：只要湊得出來就一定湊得出來，而且在所有可行分法裡
 * 挑成本最低的那個（成本＝該人撤收累計次數，做越少次越優先）。
 * 圖只有二十幾個節點，速度完全不是問題。
 */
window.App = window.App || {};

(function () {
  "use strict";

  const MEAL_KEYS = window.App.State.MEAL_KEYS;
  const PER_MEAL_COUNT_KEY = {
    breakfast: "cleanupBreakfast",
    lunch: "cleanupLunch",
    dinner: "cleanupDinner",
  };

  /*
   * 成本權重。名額用完之後的「溢位成本」要壓倒性地大於公平成本，
   * 這樣演算法只有在真的排不下時才會超過預定人數。
   */
  const TOTAL_WEIGHT = 1000000; // 撤收總次數：做越少次越優先被排到
  const MEAL_WEIGHT = 1000; // 該餐別做過幾次：用來避免有人老是被排早餐
  const ROSTER_WEIGHT = 1; // 名冊號碼，同次數時的排序，也讓結果穩定

  /*
   * 撤收人數階梯（使用者指定）：[能排撤收的人數, 早, 中, 晚]。
   *
   * 招員三餐固定洗碗、完全不排撤收之後，能排撤收的只剩十幾個人，
   * 撐不起原本的 早5／中7／晚7（19 個名額）。所以改成按「今天有幾個人排得動」
   * 一階一階往下降，名額才坐得滿——排不滿的班表看起來像出錯，其實只是人不夠。
   *
   * 使用者給的是前四階（477 → 476 → 466 → 456）；再往下照同樣的做法繼續，
   * 先減晚餐再減中餐，早餐維持最輕鬆。
   */
  const CLEANUP_LADDER = [
    [18, 4, 7, 7],
    [17, 4, 7, 6],
    [16, 4, 6, 6],
    [15, 4, 5, 6],
    [14, 4, 5, 5],
    [13, 4, 4, 5],
    [12, 4, 4, 4],
    [11, 3, 4, 4],
    [10, 3, 4, 3],
    [9, 3, 3, 3],
    [8, 2, 3, 3],
    [7, 2, 3, 2],
    [6, 2, 2, 2],
  ];

  /*
   * 誰要排撤收：全員，包含固定送便當的兩位（他們早、中要跑便當，只有晚上排得了，
   * 見 canDoCleanup）。**但不含固定洗碗的招員**——他們三餐都在洗碗，不排撤收。
   */
  function cleanupEligible(members) {
    return members.filter((m) => !m.fixedDishwash);
  }

  /** 送便當的兩位早、中在外面跑便當，撤收只能排晚上 */
  function deliveryOnlyDinner(member, meal) {
    return member.fixedRole === "delivery" && meal !== "dinner";
  }

  /**
   * 每餐要幾個人。n ＝ 今天排得動撤收的人數（已扣掉固定洗碗的招員）。
   * 查階梯表取「不超過 n 的最大那一階」；比最小一階還少人就按比例縮。
   */
  function cleanupSizes(n) {
    if (n <= 0) return { breakfast: 0, lunch: 0, dinner: 0 };
    for (let i = 0; i < CLEANUP_LADDER.length; i++) {
      const [need, breakfast, lunch, dinner] = CLEANUP_LADDER[i];
      if (n >= need) return { breakfast, lunch, dinner };
    }
    // 比階梯最小那一階還少人：平均分，早餐一樣最輕鬆
    const breakfast = Math.max(1, Math.floor(n / 3));
    const rest = n - breakfast;
    const dinner = Math.ceil(rest / 2);
    return { breakfast, lunch: rest - dinner, dinner };
  }

  const rosterOrder = (a, b) => window.App.State.rosterOrder(a, b);

  function countOf(dutyCounts, id, key) {
    return (dutyCounts[id] && dutyCounts[id][key]) || 0;
  }

  // ── 最小成本最大流（成對存邊，用 index ^ 1 取得反向邊）────────────────
  const { createNetwork, minCostMaxFlow } = window.App.MinCostFlow;

  /**
   * @param {object[]} dayMembers - 當天有出現過的人（退伍當天的人也算，他早/中還在）
   * @param {object} dutyCounts
   * @param {(memberId: string, meal: string) => boolean} isAvailable - 那個人那一餐在不在
   * @param {{breakfast:string[],lunch:string[],dinner:string[]}} dishwashByMeal - 各餐洗碗名單
   * @returns {{assignments: object, sizes: object, desiredSizes: object, warnings: string[]}}
   */
  function computeCleanupDay(dayMembers, dutyCounts, isAvailable, dishwashByMeal) {
    const available = isAvailable || (() => true);
    const washing = {};
    MEAL_KEYS.forEach((meal) => {
      washing[meal] = new Set(((dishwashByMeal || {})[meal] || []).slice());
    });

    const warnings = [];
    const pool = cleanupEligible(dayMembers).slice().sort(rosterOrder);
    const assignments = { breakfast: [], lunch: [], dinner: [] };

    if (!pool.length) {
      const empty = { breakfast: 0, lunch: 0, dinner: 0 };
      return { assignments, sizes: empty, desiredSizes: empty, warnings };
    }

    const canDo = (member, meal) => {
      if (!available(member.id, meal)) return false;
      if (washing[meal].has(member.id)) return false;
      if (deliveryOnlyDinner(member, meal)) return false;
      if (meal === "dinner" && member.skipDinnerCleanup) return false;
      return true;
    };

    const source = 0;
    const mealNode = (j) => 1 + pool.length + j;
    const sink = 1 + pool.length + MEAL_KEYS.length;

    /*
     * 每個人最多被排一次（同一天不會又早又晚），成本＝撤收總次數為主、
     * 該餐別次數為輔，所以「做最少的先輪」，而且不會有人老是被分到同一餐。
     */
    function buildNet(caps) {
      const net = createNetwork(sink + 1);
      pool.forEach((member, i) => {
        net.addEdge(source, 1 + i, 1, 0);
        MEAL_KEYS.forEach((meal, j) => {
          if (!canDo(member, meal)) return;
          const cost =
            countOf(dutyCounts, member.id, "cleanup") * TOTAL_WEIGHT +
            countOf(dutyCounts, member.id, PER_MEAL_COUNT_KEY[meal]) * MEAL_WEIGHT +
            i * ROSTER_WEIGHT;
          net.addEdge(1 + i, mealNode(j), 1, cost);
        });
      });
      MEAL_KEYS.forEach((meal, j) => {
        for (let k = 0; k < caps[meal]; k++) net.addEdge(mealNode(j), sink, 1, 0);
      });
      return net;
    }

    /*
     * 名額階梯是按「今天有幾個人排得動」查的，但光數人頭會高估：
     * 退伍當天的人只剩早、中排得動，送便當的只有晚上排得動，那一餐洗碗的又不能排。
     * 所以先放開名額跑一次流量，問出「今天最多真的排得出幾個人次」，再拿那個數字查階梯。
     * 少了這一步，8/13、8/14 會被要求 16、15 個名額卻只湊得出 15、14 個，
     * 每天都跳一個其實不是錯的「沒坐滿」警告。
     */
    const openCaps = { breakfast: pool.length, lunch: pool.length, dinner: pool.length };
    const capacity = minCostMaxFlow(buildNet(openCaps), source, sink);
    const desiredSizes = cleanupSizes(Math.min(pool.length, capacity));
    const totalNeed = desiredSizes.breakfast + desiredSizes.lunch + desiredSizes.dinner;

    // 每一餐的名額是固定的，不多不少
    const net = buildNet(desiredSizes);
    const assigned = minCostMaxFlow(net, source, sink);

    pool.forEach((member, i) => {
      net.graph[1 + i].forEach((ei) => {
        const edge = net.edges[ei];
        if (edge.capacity > 0 && edge.flow > 0) {
          const j = edge.to - (1 + pool.length);
          assignments[MEAL_KEYS[j]].push(member.id);
        }
      });
    });

    // 每一餐內部照名冊順序排，看起來才整齊
    const orderOf = {};
    pool.forEach((m, i) => (orderOf[m.id] = i));
    MEAL_KEYS.forEach((meal) => assignments[meal].sort((a, b) => orderOf[a] - orderOf[b]));

    const sizes = {
      breakfast: assignments.breakfast.length,
      lunch: assignments.lunch.length,
      dinner: assignments.dinner.length,
    };

    if (assigned < totalNeed) {
      // 名額沒坐滿，講清楚是哪一條限制卡住的
      const shortMeals = MEAL_KEYS.filter((meal) => sizes[meal] < desiredSizes[meal]).map(
        (meal) => `${window.App.State.MEAL_LABELS[meal]} ${sizes[meal]}/${desiredSizes[meal]}`
      );
      const skipDinner = pool.filter((m) => m.skipDinnerCleanup && available(m.id, "dinner")).length;
      const reasons = [`那一餐洗碗的人不排撤收`];
      if (skipDinner) reasons.push(`有 ${skipDinner} 位名冊勾了「免排晚上撤收」`);
      warnings.push(`撤收名額沒坐滿（${shortMeals.join("、")}）：${reasons.join("，")}。`);
    }

    return { assignments, sizes, desiredSizes, warnings };
  }

  window.App.CleanupSchedule = { computeCleanupDay, cleanupSizes, cleanupEligible, deliveryOnlyDinner, PER_MEAL_COUNT_KEY };
})();
