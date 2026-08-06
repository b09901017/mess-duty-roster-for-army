/*
 * 打菜流程（打飯打菜的當下要做的事），跟「善後勤務」分開——善後是打完菜、休息完才做的。
 *
 * 每一餐的組成：
 *   打飯      2人（固定：月輝、承鴻）。早餐不打飯，這兩位那一餐改成一起包便當。
 *   打菜      每道菜 2 人（輪替）——這是硬性需求，人再少也要先滿足
 *   蓋便當    2人（輪替）
 *   計數      2人（固定：旭辰／允彣，旭辰 8/8 退伍後由東霖遞補）
 *   抬飲料    2人（固定：林柏翰、陳柏翰），抬完之後也一起包便當
 *   包便當    剩下的人全部（輪替），沒有人也沒關係
 *
 * ── 人不夠時的讓步順序（使用者指定）──────────────────────────
 * 打菜（2×菜數）永遠不動，其餘一階一階讓，讓到人數剛好塞得下為止：
 *
 *   1. 包便當自然歸零   抬完飲料的人本來就會過去幫忙，等於沒真的少人
 *   2. 抬飲料 2 → 1     飲料抬一趟就完了，一個人多跑一趟成本最低（留 rank 1 的林柏翰）
 *   3. 計數併入蓋便當   計數要跟到打飯結束，本來就站在線上，順手蓋便當
 *   4. 取消蓋便當       那兩個名額讓給打菜
 *   5. 最後幾道菜 1 人  真的沒辦法了才用，並跳提醒
 *
 * 以中／晚餐 5 菜驗算，結果就是使用者給的那張表：
 *   19人 打飯2 打菜10 蓋2 計2 飲料2 包1
 *   18人 打飯2 打菜10 蓋2 計2 飲料2 包0
 *   17人 打飯2 打菜10 蓋2 計2 飲料1 包0
 *   15人 打飯2 打菜10 蓋2 計兼 飲料1 包0
 * 而且菜量變動時會自動跟著調（菜量不是打飯班能決定的）。
 */
window.App = window.App || {};

(function () {
  "use strict";

  const LID_COUNT = 2;
  const COUNT_COUNT = 2;
  const DRINKS_COUNT = 2;
  const PER_DISH = 2;

  const rosterOrder = (a, b) => window.App.State.rosterOrder(a, b);

  function countOf(dutyCounts, id, key) {
    return (dutyCounts[id] && dutyCounts[id][key]) || 0;
  }

  /** 該項做最少次的人優先，同次數就照名冊順序 */
  function pickLeast(pool, dutyCounts, countKey, need) {
    if (need <= 0) return [];
    return pool
      .slice()
      .sort((a, b) => {
        const ca = countOf(dutyCounts, a.id, countKey);
        const cb = countOf(dutyCounts, b.id, countKey);
        if (ca !== cb) return ca - cb;
        return rosterOrder(a, b);
      })
      .slice(0, need);
  }

  /**
   * 某個固定角色這一餐由誰擔任：照「正取（rank 1）先、同 rank 照名冊順序」填到名額為止。
   * 沒被選上的（例如抬飲料只留一位時的陳柏翰）會落在 spare，改由打菜的輪替吸收。
   */
  function fillFixedRole(present, role, quota) {
    const holders = present
      .filter((m) => m.servingRole === role)
      .slice()
      .sort((a, b) => (a.servingRank || 1) - (b.servingRank || 1) || rosterOrder(a, b));
    const n = Math.max(0, quota);
    return { chosen: holders.slice(0, n), spare: holders.slice(n) };
  }

  /**
   * @param {object[]} present - 這一餐在場的人
   * @param {object} dutyCounts
   * @param {number} dishes - 這一餐幾道菜
   * @param {boolean} withRice - 這一餐要不要打飯（早餐不打飯）
   * @returns {{assignments: object, warnings: string[], dishes: number, countMergedIntoLid: boolean}}
   */
  function computeServingLine(present, dutyCounts, dishes, withRice) {
    const St = window.App.State;
    const warnings = [];
    const servesRice = withRice !== false;
    const total = present.length;

    const has = (role) => present.some((m) => m.servingRole === role);

    /*
     * 先決定每個角色要幾個人（還沒指定是誰）。
     * needDish 是硬性的，其餘照讓步順序往下降，直到全部塞得進在場人數。
     * 名冊上根本沒有那個角色的人時名額就是 0，不然會憑空多算人頭。
     */
    let needDish = Math.max(0, dishes) * PER_DISH;
    let quotaRice = servesRice ? Math.min(2, present.filter((m) => m.servingRole === "rice").length) : 0;
    let quotaLid = LID_COUNT;
    let quotaCount = Math.min(COUNT_COUNT, present.filter((m) => m.servingRole === "count").length);
    let quotaDrinks = Math.min(DRINKS_COUNT, present.filter((m) => m.servingRole === "drinks").length);
    let countMergedIntoLid = false;

    const used = () => quotaRice + needDish + quotaLid + quotaCount + quotaDrinks;

    // 讓步 2：抬飲料 2 → 1
    if (used() > total && quotaDrinks > 1) quotaDrinks = 1;
    // 讓步 3：計數併進蓋便當（計數的兩位順手蓋便當，不另外佔人頭）
    if (used() > total && quotaCount > 0 && quotaLid > 0) {
      quotaCount = 0;
      countMergedIntoLid = true;
    }
    // 讓步 4：取消蓋便當，那兩個名額讓給打菜
    if (used() > total && quotaLid > 0) {
      quotaLid = 0;
      if (countMergedIntoLid) {
        countMergedIntoLid = false;
        quotaCount = Math.min(COUNT_COUNT, present.filter((m) => m.servingRole === "count").length);
      }
      warnings.push("人力不足，這一餐沒有排蓋便當，那兩個名額讓給打菜。");
    }
    // 讓步 5：最後幾道菜改成 1 個人
    if (used() > total) {
      const shortDishes = used() - total;
      needDish = Math.max(0, needDish - shortDishes);
      warnings.push(
        `這一餐 ${dishes} 道菜需要 ${dishes * PER_DISH} 人打菜，但人湊不齊，有 ${shortDishes} 道菜只會有 1 個人。`
      );
    }

    // ── 決定是誰 ────────────────────────────────────────────────
    const riceFill = fillFixedRole(present, "rice", quotaRice);
    // 併進蓋便當時，計數的人照樣要挑出來（只是位置改列在蓋便當）
    const countFill = fillFixedRole(present, "count", countMergedIntoLid ? COUNT_COUNT : quotaCount);
    const drinksFill = fillFixedRole(present, "drinks", quotaDrinks);

    St.SERVING_FIXED_ROLES.forEach((role) => {
      if (role === "rice" && !servesRice) return; // 早餐不打飯，當然不用提醒缺人
      /*
       * 固定角色的人陸續退伍，只剩一位是預期中的事（使用者確認過不用補人），
       * 所以只有完全沒有人的時候才提醒。
       */
      if (!has(role)) {
        warnings.push(`打菜流程的「${St.SERVING_ROLE_LABELS[role]}」這一餐沒有人，請到「名冊」指定。`);
      }
    });

    /*
     * 輪替池 = 在場的人扣掉這一餐真的擔任固定角色的人。
     * 沒被選上的候補（spare）要放回池子裡——抬飲料只留一位時，另一位就是這樣進打菜的。
     * 「名冊上是打飯、但這一餐不打飯」的兩位不放進池子：他們一天只有早餐會進來，
     * 次數永遠追不上別人，公平圖會把他們誤判成明顯偏少。
     */
    const offPool = new Set(
      riceFill.chosen.concat(countFill.chosen, drinksFill.chosen).map((m) => m.id)
    );
    const riceHolders = present.filter((m) => m.servingRole === "rice");
    riceHolders.forEach((m) => offPool.add(m.id));
    let pool = present.filter((m) => !offPool.has(m.id));

    const serveDish = pickLeast(pool, dutyCounts, "serveDish", needDish);
    const servedIds = new Set(serveDish.map((m) => m.id));
    pool = pool.filter((m) => !servedIds.has(m.id));

    /*
     * 蓋便當：讓步到第 3 階時由計數的兩位兼任。
     * 這時候不另外印一行蓋便當——同一批人出現在兩行看起來像重複排到，
     * 改成把「（兼蓋便當）」寫在計數那一行的標題上（見 textFormat）。
     */
    const lid = countMergedIntoLid ? [] : pickLeast(pool, dutyCounts, "lid", quotaLid);
    const lidIds = new Set(lid.map((m) => m.id));
    pool = pool.filter((m) => !lidIds.has(m.id));

    /*
     * 剩下的人包便當。抬飲料的兩位抬完也會過去幫忙，但不重複列在這一行——
     * 他們那一行的標題已經寫「抬飲料（抬完包便當）」了，列兩次會讓人以為排錯。
     * 不打飯的那一餐，打飯的兩位是真的整段都在包便當，所以要列進來。
     */
    const boxingMembers = pool.concat(servesRice ? [] : riceHolders).sort(rosterOrder);

    return {
      assignments: {
        rice: riceFill.chosen.map((m) => m.id),
        serveDish: serveDish.map((m) => m.id),
        lid: lid.map((m) => m.id),
        count: countFill.chosen.map((m) => m.id),
        drinks: drinksFill.chosen.map((m) => m.id),
        boxing: boxingMembers.map((m) => m.id),
      },
      dishes,
      // 計數的兩位同時也在蓋便當名單裡，班表上要註明，不然看起來像重複排到
      countMergedIntoLid,
      warnings,
    };
  }

  window.App.ServingLine = { computeServingLine, fillFixedRole };
})();
