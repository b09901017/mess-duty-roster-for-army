/*
 * 撤收排班。
 *
 * 規則（使用者指定）：
 *   - 每餐人數照人數階梯：18 人以上 早4／中7／晚7，之後 4/7/6 → 4/6/6 → 4/5/6 …
 *     **不是**每個人每天都要輪到一次。
 *   - 誰先排：這項勤務累計做最少的人優先，同次數照名冊號碼。
 *   - 固定送便當的兩位早、中在外面跑便當，撤收只排得到晚上。
 *   - 那一餐洗碗的人，那一餐不排撤收（洗碗本身就夠久了）。
 *     招員早、晚固定洗碗，所以那兩餐自動不排；中午他們做廚餘，**廚餘沒有這條**，
 *     所以中午照樣要排撤收。
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
   * 旅部連調走之後只剩 19 人，撐不起原本的 早5／中7／晚7（19 個名額、19 個人，
   * 一點餘裕都沒有）。所以改成按「今天有幾個人排得動」一階一階往下降，
   * 名額才坐得滿——排不滿的班表看起來像出錯，其實只是人不夠。
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
   * 見 canDo）。
   *
   * 招員早、晚固定洗碗，那兩餐自然被 canDo 的「洗碗的人不排撤收」擋掉，
   * 但中午他們做的是廚餘——廚餘沒有免撤收這條，所以中午照樣要排，
   * 因此**不能**把他們整個抽出池子。只有「三餐都固定洗碗」的人整天排不到撤收，
   * 留在池子裡會讓人數階梯高估，才要扣掉。
   */
  function cleanupEligible(members) {
    return members.filter((m) => !window.App.State.isFixedDishwashAllDay(m));
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
  function computeCleanupDay(dayMembers, dutyCounts, isAvailable, dishwashByMeal, mealsToday) {
    const available = isAvailable || (() => true);
    // 8/14 只吃早餐，那天就只有早餐要撤收
    const MEALS = (mealsToday && mealsToday.length ? mealsToday : MEAL_KEYS).slice();
    const washing = {};
    MEALS.forEach((meal) => {
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
    const sink = 1 + pool.length + MEALS.length;

    /*
     * 每個人最多被排一次（同一天不會又早又晚），成本＝撤收總次數為主、
     * 該餐別次數為輔，所以「做最少的先輪」，而且不會有人老是被分到同一餐。
     */
    function buildNet(caps) {
      const net = createNetwork(sink + 1);
      pool.forEach((member, i) => {
        net.addEdge(source, 1 + i, 1, 0);
        MEALS.forEach((meal, j) => {
          if (!canDo(member, meal)) return;
          const cost =
            countOf(dutyCounts, member.id, "cleanup") * TOTAL_WEIGHT +
            countOf(dutyCounts, member.id, PER_MEAL_COUNT_KEY[meal]) * MEAL_WEIGHT +
            i * ROSTER_WEIGHT;
          net.addEdge(1 + i, mealNode(j), 1, cost);
        });
      });
      MEALS.forEach((meal, j) => {
        for (let k = 0; k < (caps[meal] || 0); k++) net.addEdge(mealNode(j), sink, 1, 0);
      });
      return net;
    }

    /*
     * 名額先查階梯（按今天有幾個人排得動），再被「實際排得動幾個」壓下來。
     *
     * 光數人頭會高估：退伍當天的人只剩早、中排得動，送便當的只有晚上排得動，
     * 那一餐洗碗的又不能排。少了這一步，班表每天都會跳一個其實不是錯的「沒坐滿」。
     *
     * 階梯本身是「三餐一起」的分法，所以只有一餐的日子（8/14 只吃早餐）要取
     * 那一餐該有的數字，不能拿一餐的容量回去查三餐的階梯——那樣早餐會從 4 掉到 2。
     */
    const full = cleanupSizes(pool.length);
    const desiredSizes = { breakfast: 0, lunch: 0, dinner: 0 };
    MEALS.forEach((meal) => {
      const capThisMeal = pool.filter((m) => canDo(m, meal)).length;
      desiredSizes[meal] = Math.min(full[meal], capThisMeal);
    });

    const openCaps = {};
    MEALS.forEach((meal) => (openCaps[meal] = pool.length));
    const capacity = minCostMaxFlow(buildNet(openCaps), source, sink);
    let totalNeed = MEALS.reduce((sum, meal) => sum + desiredSizes[meal], 0);

    /*
     * 每一餐的名額固定，不多不少。名額總數超過「整天排得出幾個人次」時，
     * 或是總量夠、但這個分法湊不出完美配對時（限制一交錯就會這樣），
     * 就從名額最多的那一餐扣一個重試，直到坐得滿——早餐永遠是最輕鬆的那一餐，
     * 所以扣的順序自然會避開它。
     */
    const shrink = () => {
      let worst = null;
      MEALS.forEach((meal) => {
        if (desiredSizes[meal] > 0 && (!worst || desiredSizes[meal] > desiredSizes[worst])) worst = meal;
      });
      if (!worst) return false;
      desiredSizes[worst] -= 1;
      totalNeed -= 1;
      return true;
    };
    while (totalNeed > capacity && shrink()) {
      /* 先壓到總容量以內 */
    }
    let net = buildNet(desiredSizes);
    let assigned = minCostMaxFlow(net, source, sink);
    let retries = 0;
    while (assigned < totalNeed && retries < MEALS.length * 3 && shrink()) {
      retries += 1;
      net = buildNet(desiredSizes);
      assigned = minCostMaxFlow(net, source, sink);
    }

    pool.forEach((member, i) => {
      net.graph[1 + i].forEach((ei) => {
        const edge = net.edges[ei];
        if (edge.capacity > 0 && edge.flow > 0) {
          const j = edge.to - (1 + pool.length);
          if (MEALS[j]) assignments[MEALS[j]].push(member.id);
        }
      });
    });

    // 每一餐內部照名冊順序排，看起來才整齊
    const orderOf = {};
    pool.forEach((m, i) => (orderOf[m.id] = i));
    MEALS.forEach((meal) => assignments[meal].sort((a, b) => orderOf[a] - orderOf[b]));

    const sizes = {
      breakfast: assignments.breakfast.length,
      lunch: assignments.lunch.length,
      dinner: assignments.dinner.length,
    };

    if (assigned < totalNeed) {
      // 名額沒坐滿，講清楚是哪一條限制卡住的
      const shortMeals = MEALS.filter((meal) => sizes[meal] < desiredSizes[meal]).map(
        (meal) => `${window.App.State.MEAL_LABELS[meal]} ${sizes[meal]}/${desiredSizes[meal]}`
      );
      const skipDinner = pool.filter((m) => m.skipDinnerCleanup && available(m.id, "dinner")).length;
      const reasons = [`那一餐洗碗的人不排撤收`];
      if (skipDinner) reasons.push(`有 ${skipDinner} 位名冊勾了「免排晚上撤收」`);
      warnings.push(`撤收名額沒坐滿（${shortMeals.join("、")}）：${reasons.join("，")}。`);
    }

    return { assignments, sizes, desiredSizes, warnings };
  }

  /*
   * ⭐ 2026/08/08 起用的版本：單純照號碼輪，不管別的。
   *
   * 使用者的原話：「不用考慮洗碗不能徹收或是誰不能徹收，反正就是一樣照號碼輪，
   * 先從 263 開始然後新的那五個人然後 261」。
   *
   * 三餐勤務已經不由程式排了（見 State.MEAL_DUTIES_ENABLED），所以上面那套
   * 最小成本最大流的四條限制（洗碗的人不排、送便當只有晚上、免排晚上撤收、採買）
   * 全部不適用——留著沒刪，是因為哪天要改回來就直接用得上。
   *
   * 這一版剩下的規則只有兩條：
   *   1. 每餐幾個人：照原本那張人數階梯（CLEANUP_LADDER）
   *   2. 誰去：一條隊伍 263 → 新進五位 → 261，早餐接午餐接晚餐接隔天，繞完回頭
   *
   * 那一餐不在營的人（退伍當天的晚上、去採買的）跳過，但**游標照樣往前**，
   * 免得他一直卡在隊伍前面害後面的人輪不到——跟洗碗、換水的處理方式一致。
   *
   * @param {object} cleanupState - { nextStartId: string|null }
   * @param {object[]} dayMembers - 當天有出現過的人（已排除只掃廁所的）
   * @param {(memberId: string, meal: string) => boolean} isAvailable
   * @param {string[]} mealsToday
   */
  function computeCleanupRotation(cleanupState, dayMembers, isAvailable, mealsToday) {
    const St = window.App.State;
    const available = isAvailable || (() => true);
    const MEALS = (mealsToday && mealsToday.length ? mealsToday : MEAL_KEYS).slice();
    const warnings = [];
    const assignments = { breakfast: [], lunch: [], dinner: [] };
    const desiredSizes = { breakfast: 0, lunch: 0, dinner: 0 };

    const queue = dayMembers.slice().sort(St.cleanupOrder);
    if (!queue.length) {
      return { assignments, sizes: desiredSizes, desiredSizes, warnings, newCleanupState: cleanupState || { nextStartId: null } };
    }

    // 每餐幾個人：照原本那張階梯，用「今天有幾個人」查
    const full = cleanupSizes(queue.length);
    MEALS.forEach((meal) => (desiredSizes[meal] = full[meal]));

    let cursor = 0;
    if (cleanupState && cleanupState.nextStartId) {
      const idx = queue.findIndex((m) => m.id === cleanupState.nextStartId);
      if (idx >= 0) cursor = idx;
    }

    /*
     * 一個人一天最多排一次撤收。
     *
     * 19 個人、一天 18 個名額，隊伍會在一天之內剛好繞完一圈——沒有這道防線的話，
     * 繞回開頭的那個人會被同一天排到兩次（早餐又晚餐），而隊伍後面的人一次都沒有。
     * 擋掉之後游標照樣往前，他就變成隔天第一個排到的人，順序完全沒亂。
     */
    const usedToday = new Set();

    MEALS.forEach((meal) => {
      const need = desiredSizes[meal];
      const picked = [];
      let steps = 0;
      const maxSteps = queue.length * 2;
      while (picked.length < need && steps < maxSteps) {
        const member = queue[cursor];
        cursor = (cursor + 1) % queue.length;
        steps++;
        if (!available(member.id, meal)) continue;
        if (usedToday.has(member.id)) continue;
        picked.push(member.id);
        usedToday.add(member.id);
      }
      assignments[meal] = picked;
      if (picked.length < need) {
        warnings.push(
          `${St.MEAL_LABELS[meal]}撤收需要 ${need} 人，但那一餐在營的只湊到 ${picked.length} 人。`
        );
      }
    });

    const sizes = {
      breakfast: assignments.breakfast.length,
      lunch: assignments.lunch.length,
      dinner: assignments.dinner.length,
    };

    return {
      assignments,
      sizes,
      desiredSizes,
      warnings,
      newCleanupState: { nextStartId: queue[cursor].id },
    };
  }

  window.App.CleanupSchedule = {
    computeCleanupDay,
    computeCleanupRotation,
    cleanupSizes,
    cleanupEligible,
    deliveryOnlyDinner,
    PER_MEAL_COUNT_KEY,
  };
})();
