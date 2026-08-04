/*
 * 撤收排班。
 *
 * 規則：
 *   - 每天把可排撤收的人「剛好分完」到早、中、晚三餐，每人每天固定做一次。
 *   - 人數早上最輕鬆（16人時是 4/6/6）。
 *   - 固定送便當的兩位早、中在外面跑便當，撤收只排得到晚上。
 *   - 那一餐洗碗的人，那一餐不排撤收（洗碗本身就夠久了）。
 *   - 名冊勾「免排晚上撤收」的人不能排晚餐。
 *   - 採買的人早、中不在；退伍當天晚上已離營。
 *
 * 為什麼用流量演算法而不是「排序後依序挑」：
 * 上面同時有四條限制在互相牽制，貪心法會卡死——先被挑走的人可能剛好佔掉了
 * 另一個人「唯一還能排的那一餐」，結果明明有可行解卻排不出來。
 * 最小成本最大流則是：只要存在可行的分法就一定找得到，而且在所有可行分法裡
 * 挑成本最低的那個（成本＝各人在該餐別的撤收次數，所以做越少次越優先）。
 * 圖只有二十幾個節點，速度完全不是問題。
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

  /*
   * 成本權重。名額用完之後的「溢位成本」要壓倒性地大於公平成本，
   * 這樣演算法只有在真的排不下時才會超過預定人數。
   */
  const COUNT_WEIGHT = 10000; // 該餐別已經做過幾次
  const ROSTER_WEIGHT = 10; // 名冊順序，純粹用來讓結果穩定
  const OVERFLOW_WEIGHT = 100000000;

  /*
   * 超過預定人數時，要先塞哪一餐。
   * 早餐最貴代表「寧可中餐多幾個人，也盡量讓早上輕鬆」，這是使用者定的優先序。
   */
  const OVERFLOW_PRIORITY = { breakfast: 3, lunch: 1, dinner: 2 };

  /*
   * 全員都排撤收，包含固定送便當的兩位——但他們早餐、中餐要跑便當，
   * 只有晚上排得了（見 canDoCleanup）。
   */
  function cleanupEligible(members) {
    return members.slice();
  }

  /** 送便當的兩位早、中在外面跑便當，撤收只能排晚上 */
  function deliveryOnlyDinner(member, meal) {
    return member.fixedRole === "delivery" && meal !== "dinner";
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

  // ── 最小成本最大流（成對存邊，用 index ^ 1 取得反向邊）────────────────
  function createNetwork(nodeCount) {
    const graph = [];
    for (let i = 0; i < nodeCount; i++) graph.push([]);
    const edges = [];

    function addEdge(from, to, capacity, cost) {
      graph[from].push(edges.length);
      edges.push({ to: to, capacity: capacity, cost: cost, flow: 0 });
      graph[to].push(edges.length);
      edges.push({ to: from, capacity: 0, cost: -cost, flow: 0 });
    }

    return { graph: graph, edges: edges, addEdge: addEdge, nodeCount: nodeCount };
  }

  /** 連續最短路增廣（成本用 SPFA 算，因為有反向邊會出現負成本） */
  function minCostMaxFlow(net, source, sink) {
    const graph = net.graph;
    const edges = net.edges;
    let totalFlow = 0;

    for (;;) {
      const dist = new Array(net.nodeCount).fill(Infinity);
      const prevEdge = new Array(net.nodeCount).fill(-1);
      const inQueue = new Array(net.nodeCount).fill(false);
      dist[source] = 0;
      const queue = [source];
      inQueue[source] = true;

      while (queue.length) {
        const u = queue.shift();
        inQueue[u] = false;
        for (let i = 0; i < graph[u].length; i++) {
          const ei = graph[u][i];
          const edge = edges[ei];
          if (edge.capacity - edge.flow <= 0) continue;
          const next = dist[u] + edge.cost;
          if (next < dist[edge.to]) {
            dist[edge.to] = next;
            prevEdge[edge.to] = ei;
            if (!inQueue[edge.to]) {
              inQueue[edge.to] = true;
              queue.push(edge.to);
            }
          }
        }
      }

      if (dist[sink] === Infinity) break;

      let push = Infinity;
      for (let v = sink; v !== source; ) {
        const ei = prevEdge[v];
        push = Math.min(push, edges[ei].capacity - edges[ei].flow);
        v = edges[ei ^ 1].to;
      }
      for (let v = sink; v !== source; ) {
        const ei = prevEdge[v];
        edges[ei].flow += push;
        edges[ei ^ 1].flow -= push;
        v = edges[ei ^ 1].to;
      }
      totalFlow += push;
    }

    return totalFlow;
  }

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
    const desiredSizes = cleanupSizes(pool.length);
    const assignments = { breakfast: [], lunch: [], dinner: [] };

    if (!pool.length) return { assignments, sizes: desiredSizes, desiredSizes, warnings };

    const canDo = (member, meal) => {
      if (!available(member.id, meal)) return false;
      if (washing[meal].has(member.id)) return false;
      if (deliveryOnlyDinner(member, meal)) return false;
      if (meal === "dinner" && member.skipDinnerCleanup) return false;
      return true;
    };

    // 三餐都排不了的人（例如整天都在洗碗，或洗完碗剩下的那一餐又剛好不能排）
    const stuck = pool.filter((m) => !MEAL_KEYS.some((meal) => canDo(m, meal)));
    if (stuck.length) {
      warnings.push(
        `${stuck.map((m) => m.name).join("、")} 今天三餐不是在洗碗就是不在，沒有可以排撤收的時段，今天先不排給他們。`
      );
    }

    const source = 0;
    const mealNode = (j) => 1 + pool.length + j;
    const sink = 1 + pool.length + MEAL_KEYS.length;
    const net = createNetwork(sink + 1);

    pool.forEach((member, i) => {
      net.addEdge(source, 1 + i, 1, 0);
      MEAL_KEYS.forEach((meal, j) => {
        if (!canDo(member, meal)) return;
        // 該餐別做越少次成本越低 → 越優先被排到那一餐
        const cost = countOf(dutyCounts, member.id, PER_MEAL_COUNT_KEY[meal]) * COUNT_WEIGHT + i * ROSTER_WEIGHT + j;
        net.addEdge(1 + i, mealNode(j), 1, cost);
      });
    });

    /*
     * 每一餐先開「預定人數」個零成本名額，超過的名額成本逐級暴增，
     * 所以只有在真的塞不下時才會超編，而且會攤開到不同餐而不是全擠在一餐。
     */
    MEAL_KEYS.forEach((meal, j) => {
      for (let k = 0; k < pool.length; k++) {
        const overflow = k - desiredSizes[meal];
        const penalty = OVERFLOW_WEIGHT * OVERFLOW_PRIORITY[meal] * (overflow + 1);
        net.addEdge(mealNode(j), sink, 1, overflow < 0 ? 0 : penalty);
      }
    });

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

    if (assigned !== pool.length - stuck.length) {
      warnings.push(`撤收只排掉 ${assigned} 人，跟應排的 ${pool.length - stuck.length} 人對不起來，請回報這個狀況。`);
    }
    if (sizes.breakfast > sizes.lunch || sizes.breakfast > sizes.dinner) {
      // 講清楚是哪一條限制把人擠走的，不然看到這行也不知道要調什麼
      const dinnerCapacity = pool.filter((m) => canDo(m, "dinner")).length;
      const skipDinner = pool.filter((m) => m.skipDinnerCleanup && available(m.id, "dinner")).length;
      const reasons = [];
      if (skipDinner) reasons.push(`有 ${skipDinner} 位名冊勾了「免排晚上撤收」`);
      reasons.push(`晚餐洗碗 ${washing.dinner.size} 人也不排撤收`);
      warnings.push(
        `今天撤收擠成 早${sizes.breakfast}／中${sizes.lunch}／晚${sizes.dinner}` +
          `（原本想排 早${desiredSizes.breakfast}／中${desiredSizes.lunch}／晚${desiredSizes.dinner}），早餐沒能維持最輕鬆：` +
          `晚餐只剩 ${dinnerCapacity} 人可排——${reasons.join("，")}。`
      );
    }

    return { assignments, sizes, desiredSizes, warnings };
  }

  window.App.CleanupSchedule = { computeCleanupDay, cleanupSizes, cleanupEligible, deliveryOnlyDinner, PER_MEAL_COUNT_KEY };
})();
