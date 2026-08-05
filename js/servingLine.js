/*
 * 打菜流程（打飯打菜的當下要做的事），跟「勤務」分開——勤務是打完菜之後才做的。
 *
 * 每一餐的組成：
 *   打飯      2人（固定：呂胤玄、田權楨）。早餐不打飯，這兩位那一餐改成一起包餐盒。
 *   打菜      每道菜 2 人，所以看當餐幾道菜（輪替）
 *   蓋便當    2人（輪替）
 *   計數      2人（固定：顏允彣、鄧旭辰）
 *   抬飲料    2人（固定：陳東霖、陳柏翰），抬完之後也一起包餐盒
 *   包餐盒    剩下的人全部（輪替），沒有人也沒關係
 *
 * 名冊勾「固定洗碗」的招員在打菜流程裡**只做打菜**，不排蓋便當、不排包餐盒
 * （使用者指定）。所以他們每一餐都先佔掉打菜的名額，剩下的才由大家輪。
 *
 * 人不夠時的讓步順序（使用者指定）：
 *   1. 先取消蓋便當，那 2 個名額讓給打菜
 *   2. 還不夠就從最後幾道菜開始改成 1 個人，並跳提醒
 */
window.App = window.App || {};

(function () {
  "use strict";

  const LID_COUNT = 2;
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
   * @param {object[]} present - 這一餐在場的人
   * @param {object} dutyCounts
   * @param {number} dishes - 這一餐幾道菜
   * @param {boolean} withRice - 這一餐要不要打飯（早餐不打飯）
   * @returns {{assignments: object, warnings: string[], dishes: number}}
   */
  function computeServingLine(present, dutyCounts, dishes, withRice) {
    const warnings = [];
    const servesRice = withRice !== false;
    const byRole = (role) => present.filter((m) => m.servingRole === role).map((m) => m.id);

    const riceRoleIds = byRole("rice");
    /*
     * 早餐不打飯，固定打飯的兩位改成一起包餐盒。
     * 不把他們丟進打菜／蓋便當的輪替，是因為他們一天只有早餐才會進池子，
     * 次數永遠追不上別人，公平圖會把他們誤判成「明顯偏少」。
     */
    const rice = servesRice ? riceRoleIds : [];
    const counting = byRole("count");
    const drinks = byRole("drinks");

    window.App.State.SERVING_FIXED_ROLES.forEach((role) => {
      // 早餐不打飯，那一餐當然不用提醒打飯缺人
      if (role === "rice" && !servesRice) return;
      /*
       * 固定角色的人陸續退伍，只剩一位是預期中的事（使用者確認過不用補人），
       * 所以只有完全沒有人的時候才提醒。
       */
      if (byRole(role).length === 0) {
        warnings.push(
          `打菜流程的「${window.App.State.SERVING_ROLE_LABELS[role]}」這一餐沒有人，請到「名冊」指定。`
        );
      }
    });

    const fixedIds = new Set(riceRoleIds.concat(counting, drinks));
    let pool = present.filter((m) => !fixedIds.has(m.id));

    /*
     * 固定洗碗的招員只做打菜。先把他們從池子裡拿出來直接放進打菜，
     * 剩下的打菜名額才由其他人依次數輪；蓋便當與包餐盒的池子也就不會有他們。
     */
    const dishOnly = pool.filter((m) => m.fixedDishwash).sort(rosterOrder);
    pool = pool.filter((m) => !m.fixedDishwash);

    let needDish = Math.max(0, dishes) * PER_DISH;
    let needLid = LID_COUNT;

    /*
     * 打菜名額先給只做打菜的招員。名額比他們還少的話（例如菜色很少），
     * 多出來的人這一餐沒有打菜位置——那時只好讓他們去包餐盒，並講清楚原因。
     */
    const dishFixed = dishOnly.slice(0, needDish);
    const dishOverflow = dishOnly.slice(needDish);
    if (dishOverflow.length) {
      warnings.push(
        `這一餐只有 ${dishes} 道菜、${needDish} 個打菜名額，固定只做打菜的有 ${dishOnly.length} 位，` +
          `${dishOverflow.map((m) => m.name).join("、")} 這一餐只好改成包餐盒。`
      );
    }
    let needDishRest = needDish - dishFixed.length;

    // 讓步規則 1：人不夠就先不排蓋便當
    if (pool.length < needDishRest + needLid) {
      needLid = 0;
    }
    // 讓步規則 2：還是不夠就從最後幾道菜開始改成 1 人
    let shortDishes = 0;
    if (pool.length < needDishRest) {
      shortDishes = needDishRest - pool.length;
      needDishRest = pool.length;
      warnings.push(
        `這一餐 ${dishes} 道菜需要 ${dishes * PER_DISH} 人打菜，但只剩 ${dishFixed.length + pool.length} 人可排，有 ${shortDishes} 道菜只會有 1 個人。`
      );
    }

    const serveRest = pickLeast(pool, dutyCounts, "serveDish", needDishRest);
    const serveDish = dishFixed.concat(serveRest).sort(rosterOrder);
    const servedIds = new Set(serveDish.map((m) => m.id));
    pool = pool.filter((m) => !servedIds.has(m.id));

    const lid = pickLeast(pool, dutyCounts, "lid", needLid);
    const lidIds = new Set(lid.map((m) => m.id));
    pool = pool.filter((m) => !lidIds.has(m.id));

    if (needLid === 0 && dishes > 0) {
      warnings.push("人力不足，這一餐沒有排蓋便當，那兩個名額讓給打菜。");
    }

    // 剩下的人包餐盒；抬飲料的兩位抬完之後也一起包，不打飯的那餐打飯的兩位也一起包
    const boxingMembers = servesRice
      ? pool
      : pool.concat(present.filter((m) => riceRoleIds.indexOf(m.id) !== -1)).sort(rosterOrder);
    // 打菜名額不夠而被擠出來的招員，也只能先去包餐盒（上面已經提醒過）
    const boxing = boxingMembers.concat(dishOverflow).sort(rosterOrder).map((m) => m.id);

    return {
      assignments: {
        rice,
        serveDish: serveDish.map((m) => m.id),
        lid: lid.map((m) => m.id),
        count: counting,
        drinks,
        boxing,
      },
      dishes,
      warnings,
    };
  }

  window.App.ServingLine = { computeServingLine };
})();
