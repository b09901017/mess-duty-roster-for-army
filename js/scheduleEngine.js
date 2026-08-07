/*
 * 排班引擎。
 *
 * 設計重點：班表是「重播」出來的，不是一天一天累加出來的。
 * state.committedDates（已確定的日期）是唯一的來源資料，配上名冊與各項設定，
 * 每次有變動就從頭依日期順序重算一遍，因此：
 *   - 同一天不管重排幾次，只要名單/設定沒變，結果永遠一模一樣；
 *   - 重排某一天會自動清掉那天之前的結果再排，不會殘留舊資料或重複累計次數。
 */
window.App = window.App || {};

(function () {
  "use strict";

  const MEAL_KEYS = window.App.State.MEAL_KEYS;

  function cloneDutyCounts(dutyCounts) {
    return JSON.parse(JSON.stringify(dutyCounts));
  }

  function ensureDutyCounts(dutyCounts, memberId) {
    if (!dutyCounts[memberId]) {
      dutyCounts[memberId] = window.App.State.emptyDutyCount();
    }
    return dutyCounts[memberId];
  }

  function incrementCounts(dutyCounts, ids, dutyKey) {
    ids.forEach((id) => {
      const counts = ensureDutyCounts(dutyCounts, id);
      counts[dutyKey] = (counts[dutyKey] || 0) + 1;
    });
  }

  /**
   * 用鎖定的內容覆蓋某一餐。
   *
   * 「在場的人」直接由鎖定內容裡的打菜名單決定（每個人一定剛好出現在一個打菜位置），
   * 這樣就算之後名冊改了（例如某人的退伍日填錯又改掉），已公布的那天也不會跑掉。
   * 抬便當上車/上樓是規則不是名單，所以照樣由「在場 − 送便當」重算。
   */
  function applyMealOverride(mealData, mealOverride, dayMembers, St, dateStr, warnings, meal) {
    const SERVING_KEYS = ["rice", "serveDish", "lid", "count", "drinks", "boxing"];
    const DUTY_KEYS_IN_MEAL = ["dishwash", "foodwaste", "wipe", "floor", "delivery", "cleanup"];

    const presentIds = [];
    const serving = {};
    SERVING_KEYS.forEach((role) => {
      const ids = mealOverride.serving && mealOverride.serving[role];
      serving[role] = Array.isArray(ids) ? ids.slice() : [];
      serving[role].forEach((id) => {
        if (presentIds.indexOf(id) === -1) presentIds.push(id);
      });
    });
    mealData.serving = serving;
    if (mealOverride.dishes != null) mealData.dishes = mealOverride.dishes;

    DUTY_KEYS_IN_MEAL.forEach((key) => {
      const ids = mealOverride[key];
      if (!Array.isArray(ids)) return;
      mealData[key] = ids.slice();
      ids.forEach((id) => {
        if (presentIds.indexOf(id) === -1) presentIds.push(id);
      });
    });

    // 抬便當＝在場的人扣掉送便當的兩位
    const deliverySet = new Set(mealData.delivery || []);
    const carry = presentIds.filter((id) => !deliverySet.has(id));
    mealData.carryVehicle = carry.slice();
    mealData.carryUpstairs = carry.slice();

    // 鎖定內容裡的人，名冊上要真的存在；不在場卻有勤務的要講出來
    const known = new Set(dayMembers.map((m) => m.id));
    const nameOf = (id) => {
      const m = St.memberById(id);
      return m ? `${m.cohort}-${m.seq} ${m.name}` : id;
    };
    const ghosts = presentIds.filter((id) => !known.has(id));
    if (ghosts.length) {
      warnings.push(
        `${St.MEAL_LABELS[meal]}：鎖定的班表裡有 ${ghosts.map(nameOf).join("、")}，但名冊上他們這天不在營。` +
          `班表照鎖定的版本顯示，但建議去「名冊」把加入／離開日期改對。`
      );
    }
    mealData.absent = [];
    mealData.departed = dayMembers.filter((m) => presentIds.indexOf(m.id) === -1).map((m) => m.id);
  }

  /**
   * 純計算：不會修改任何全域狀態，只根據傳入的 snapshot 算出這一天的班表。
   * @param {string} dateStr
   * @param {{members, dutyCounts, washState, laundryState, dutySizeTable, shoppingByDate}} snapshot
   */
  function computeDay(dateStr, snapshot) {
    const St = window.App.State;
    /*
     * 當天「有出現過」的人。退伍當天的人也算在內，因為他早餐、中餐還在。
     * 勾了「只排掃廁所」的人（愷宸）整個排除——他不做任何勤務，
     * 也不能算進出勤人數，不然勤務人數對照表、洗碗佇列、撤收名額全部會多算一個人。
     */
    const dayMembers = snapshot.members.filter((m) => St.isActiveOn(m, dateStr) && !m.dutyExempt);
    const warnings = [];
    // 這天有哪幾餐（8/14 任務下午前結束，只吃早餐）
    const mealsToday = St.mealsOn(dateStr);

    /*
     * 採買沒有固定星期、也沒有固定人數，是逐日指定的名單，一天可以派好幾個人。
     * 他們早餐、中餐整個不在，所以下面所有「那一餐在不在」的判斷都會把他們排除，
     * 人數、洗碗佇列、撤收名額、換水就會自動跟著少。
     */
    const shoppers = window.App.ShoppingRoster.shoppersFor(dateStr, snapshot.members, snapshot.shoppingByDate);
    shoppers.warnings.forEach((w) => warnings.push(w));
    const shopperIds = new Set(shoppers.ids);
    const SHOPPER_OFF_MEALS = window.App.ShoppingRoster.OFF_MEALS;
    const isOffForShopping = (memberId, meal) =>
      shopperIds.has(memberId) && SHOPPER_OFF_MEALS.indexOf(meal) !== -1;

    const memberById = {};
    snapshot.members.forEach((m) => (memberById[m.id] = m));

    /** 那個人那一餐在不在（已離營、去採買都算不在） */
    const availableForMeal = (memberId, meal) => {
      const member = memberById[memberId];
      if (!member || !St.isActiveOn(member, dateStr, meal)) return false;
      return !isOffForShopping(memberId, meal);
    };

    /*
     * 勤務人數是按「那一餐實際在場的人數」查表的，不是按整天人數。
     * 這樣採買的人被抽掉時，包便當袋子會自動少一位（17人那列剛好就是 lunchbag 3），
     * 退伍當天晚上少人也會自動套用比較小的配置，不需要另外做加減。
     */
    const presentByMeal = {};
    const sizeByMeal = {};
    let sizeError = null;
    mealsToday.forEach((meal) => {
      const present = dayMembers.filter((m) => availableForMeal(m.id, meal));
      presentByMeal[meal] = present;
      /*
       * 對照表是按「扣掉送便當之後還有幾個人」查的，不是按出勤人數。
       * 送便當是固定角色，人數由那兩位還在不在決定，不是可以自由分配的欄位；
       * 用出勤人數查會出事（19人可能是送便當2位都在、也可能只剩1位，需求差1）。
       */
      const deliveryCount = present.filter((m) => m.fixedRole === "delivery").length;
      const splitCount = present.length - deliveryCount;
      const cfg = window.App.DutySizeConfig.lookupDutySize(snapshot.dutySizeTable, splitCount);
      if (!cfg && !sizeError) {
        sizeError = `${dateStr} ${St.MEAL_LABELS[meal]}出勤 ${present.length} 人、扣掉送便當 ${deliveryCount} 位還有 ${splitCount} 人要分，勤務人數設定表中找不到對應設定，請先到「勤務設定」補上這個人數的配置。`;
      }
      sizeByMeal[meal] = cfg;
    });
    if (sizeError) return { ok: false, error: sizeError };

    /*
     * 固定送便當的兩位會陸續退伍（崇浩 8/13、柏宇 8/14），使用者確認過不補人，
     * 少一位就少一位、最後 0 位也沒關係，所以退伍不提醒。
     * 勤務人數對照表是按「扣掉送便當之後的人數」查的，人數會自動對得起來。
     *
     * 但「還在營、只是那天被派去採買」是另一回事——那是可以改的安排，
     * 而便當還是得有人送，所以這種情況要講出來。
     */
    const deliveryShoppers = dayMembers.filter((m) => m.fixedRole === "delivery" && shopperIds.has(m.id));
    if (deliveryShoppers.length) {
      const stillHere = dayMembers.filter(
        (m) => m.fixedRole === "delivery" && !shopperIds.has(m.id) && St.isActiveOn(m, dateStr, "lunch")
      );
      warnings.push(
        `固定送便當的 ${deliveryShoppers.map((m) => m.name).join("、")} 這天被派去採買，` +
          (stillHere.length
            ? `早餐、中餐只剩 ${stillHere.map((m) => m.name).join("、")} 一個人送便當。`
            : `早餐、中餐沒有人送便當，請改派其他人去採買，或另外指定送便當的人。`)
      );
    }

    const dishwashCounts = {};
    mealsToday.forEach((meal) => (dishwashCounts[meal] = sizeByMeal[meal].dishwash));

    const washDay = window.App.WashSchedule.computeWashDay(
      snapshot.washState,
      dayMembers,
      dishwashCounts,
      availableForMeal,
      mealsToday
    );
    (washDay.warnings || []).forEach((w) => warnings.push(w));

    // 撤收要知道每一餐誰在洗碗（洗碗的人那一餐不排撤收），所以一定要排在洗碗之後
    const cleanupDay = window.App.CleanupSchedule.computeCleanupDay(
      dayMembers,
      snapshot.dutyCounts,
      availableForMeal,
      washDay.assignments,
      mealsToday
    );
    (cleanupDay.warnings || []).forEach((w) => warnings.push(w));

    /*
     * 這天有沒有被「鎖定」成已公布的版本。有的話，勤務與打菜名單一律照鎖定的內容，
     * 不再重算——這樣之後改規則、改名冊都不會動到已經公布出去的班表。
     * 次數照樣從鎖定的內容累計，公平性總覽才會跟實際做的一致。
     */
    const override = (snapshot.overrides || {})[dateStr] || null;
    if (override) warnings.push(`這天已鎖定成公布過的版本，不會跟著規則變動。要改回自動排班請按「解除鎖定」。`);

    const newDutyCounts = cloneDutyCounts(snapshot.dutyCounts);
    /*
     * 公平性次數從 COUNTS_FROM 才開始累計。之前的日子照樣排、照樣看得到，
     * 但不計入次數——規則已經整個換新，舊次數拿來比不公平。
     * 輪值進度（洗碗到誰、洗衣籃到誰）不受影響，那是另一回事。
     */
    const countsThisDay = dateStr >= St.COUNTS_FROM;
    const bump = (ids, key) => {
      if (countsThisDay) incrementCounts(newDutyCounts, ids, key);
    };
    const meals = {};
    mealsToday.forEach((meal) => {
      const dishwashIds = washDay.assignments[meal] || [];
      const present = presentByMeal[meal];
      // 送便當也要看那一餐在不在（退伍當天晚上就不算他了）
      const deliveryIds = present.filter((m) => m.fixedRole === "delivery").map((m) => m.id);
      const excludeIds = new Set(dishwashIds.concat(deliveryIds));
      const otherPool = present.filter((m) => !excludeIds.has(m.id));
      /*
       * 有人這一餐是固定做某一項的（招員中午固定廚餘），先讓他們佔位，
       * 剩下的名額才丟進流量給其他人輪。
       */
      const fixedByDuty = {
        foodwaste: otherPool.filter((m) => St.isFixedFoodwasteAt(m, meal)).map((m) => m.id),
      };
      const otherAssign = window.App.OtherDuties.assignOtherDuties(
        otherPool,
        newDutyCounts,
        sizeByMeal[meal],
        fixedByDuty
      );
      /*
       * 固定要做那一項的人比名額還多，代表對照表的名額跟不上人數了。
       * 多出來的人會被別的勤務吸收，不會沒事做，但值得講一聲。
       */
      Object.keys(otherAssign.overflow || {}).forEach((key) => {
        const extra = otherAssign.overflow[key];
        if (!extra) return;
        warnings.push(
          `${St.MEAL_LABELS[meal]}：固定做${St.DUTY_SHORT_LABELS[key]}的人比名額多 ${extra} 位，` +
            `多出來的這一餐改做其他勤務。可到「勤務設定」把這一列的${St.DUTY_SHORT_LABELS[key]}人數調高。`
        );
      });

      /*
       * 抬便當分三段（使用者更新的流程）：
       *   抬下車  隨時到、隨時搬，當餐在場的人全部一起（含送便當的兩位）
       *   抬上車  固定一組人（名冊上勾「抬上車」）
       *   抬上樓  固定另一組人（名冊上勾「抬上樓」）
       * 分組還沒指定的話，上車／上樓就先照舊「除了送便當的兩位，其餘全員」，
       * 這樣名單填好之前班表照樣印得出來。
       */
      const carryDownIds = present.map((m) => m.id);
      const grouped = present.some((m) => m.carryGroup);
      const carryVehicleIds = grouped
        ? present.filter((m) => m.carryGroup === "vehicle").map((m) => m.id)
        : present.filter((m) => !deliveryIds.includes(m.id)).map((m) => m.id);
      const carryUpstairsIds = grouped
        ? present.filter((m) => m.carryGroup === "upstairs").map((m) => m.id)
        : present.filter((m) => !deliveryIds.includes(m.id)).map((m) => m.id);
      if (grouped) {
        const unassigned = present.filter((m) => !m.carryGroup);
        if (unassigned.length) {
          warnings.push(
            `${St.MEAL_LABELS[meal]}：${unassigned.map((m) => m.name).join("、")} 還沒指定抬上車／抬上樓，` +
              `請到「名冊」補上。`
          );
        }
      }

      /*
       * 對照表的每一列加上送便當兩位應該剛好等於出勤人數。對不起來的時候不會有人
       * 完全沒事（大家都要抬便當），但代表有人那一餐只抬便當、沒有分到其他勤務，
       * 通常是對照表沒跟上人數變動，所以提醒一下。
       */
      const cfg = sizeByMeal[meal];
      const spare = present.length - deliveryIds.length - (cfg.dishwash + cfg.foodwaste + cfg.wipe + cfg.floor);
      if (spare > 0) {
        warnings.push(
          `${St.MEAL_LABELS[meal]}出勤 ${present.length} 人，但勤務設定只排掉 ${present.length - spare} 人，` +
            `有 ${spare} 人只抬便當、沒有其他勤務。可到「勤務設定」把這一列的人數補齊。`
        );
      }

      // 打菜流程：打完菜之後才做勤務，兩者是同一批人、不同時段
      const serving = window.App.ServingLine.computeServingLine(
        present,
        newDutyCounts,
        St.menuSizeFor(dateStr, meal),
        St.servesRiceAt(meal)
      );
      serving.warnings.forEach((w) => warnings.push(`${St.MEAL_LABELS[meal]}：${w}`));

      meals[meal] = {
        serving: serving.assignments,
        dishes: serving.dishes,
        countMergedIntoLid: serving.countMergedIntoLid,
        dishwash: dishwashIds,
        foodwaste: otherAssign.foodwaste,
        carryDown: carryDownIds,
        carryGrouped: grouped,
        carryVehicle: carryVehicleIds,
        carryUpstairs: carryUpstairsIds,
        floor: otherAssign.floor,
        wipe: otherAssign.wipe,
        delivery: deliveryIds,
        cleanup: (cleanupDay.assignments[meal] || []).filter((id) => availableForMeal(id, meal)),
        // 這一餐去採買所以人不在，顯示時要跟「有空幫忙包便當」區分開
        absent: dayMembers.filter((m) => isOffForShopping(m.id, meal)).map((m) => m.id),
        // 這一餐已經離營（退伍當天的晚餐），文字班表要寫「已離營」而不是「休息」
        departed: dayMembers.filter((m) => !St.isActiveOn(m, dateStr, meal)).map((m) => m.id),
      };

      const mealOverride = override && override.meals && override.meals[meal];
      if (mealOverride) applyMealOverride(meals[meal], mealOverride, dayMembers, St, dateStr, warnings, meal);

      bump(meals[meal].serving.serveDish || [], "serveDish");
      bump(meals[meal].serving.lid || [], "lid");
      bump(meals[meal].serving.boxing || [], "boxing");
      bump(meals[meal].dishwash, "dishwash");
      bump(meals[meal].foodwaste, "foodwaste");
      bump(meals[meal].floor, "floor");
      bump(meals[meal].wipe, "wipe");
      bump(meals[meal].cleanup, "cleanup");
      bump(meals[meal].cleanup, window.App.CleanupSchedule.PER_MEAL_COUNT_KEY[meal]);
    });

    /*
     * 換水是早餐撤收「之後」才做的，所以要等撤收排完，而且不能排到同一批人。
     *
     * 兩種情況不自己排：
     *   1. 還沒開始的日子（WATER_START 之前）——這項勤務那時候根本不存在。
     *   2. 被鎖定的日子——一律照公布版，公布版沒寫換水就是沒有。
     */
    const waterOverride = override && override.daily && Array.isArray(override.daily.water);
    let waterDay = { ids: [], newWaterState: snapshot.waterState, warnings: [] };
    if (waterOverride) {
      waterDay.ids = override.daily.water.slice();
      /*
       * 鎖定的日子也要把輪替進度往前推，跟洗衣籃、洗碗一樣。
       * 少了這一步，隔天會從隊伍頭重新開始——8/6 鎖定版換水是 261-7、08、263-1、2、3，
       * 而 8/7 又從 261-3 排起，柏宇就會連兩天換水。
       */
      waterDay.newWaterState = window.App.WaterSchedule.advanceWaterState(snapshot.waterState, waterDay.ids);
    } else if (dateStr >= St.WATER_START) {
      waterDay = window.App.WaterSchedule.computeWaterDay(
        snapshot.waterState,
        dayMembers,
        meals[St.WATER_MEAL].cleanup,
        availableForMeal
      );
    }
    waterDay.warnings.forEach((w) => warnings.push(w));

    // 掃廁所是爬梯子決定的，程式只負責印出來與提醒指定到不在的人
    const toilet = window.App.ToiletDuty.toiletFor(dateStr, snapshot.members, snapshot.toiletByDate, shopperIds);
    toilet.warnings.forEach((w) => warnings.push(w));

    const laundryDay = window.App.Laundry.computeLaundryDay(snapshot.laundryState, snapshot.members, dateStr);
    laundryDay.warnings.forEach((w) => warnings.push(w));
    const daily = {
      laundryUp: laundryDay.up,
      laundryDown: laundryDay.down,
      shopping: shoppers.ids.slice(),
      toilet: toilet.ids.slice(),
      water: waterDay.ids.slice(),
    };
    bump(daily.water, "water");
    let newLaundryState = laundryDay.newLaundryState;
    let newWashState = washDay.newWashState;

    if (override && override.daily) {
      /*
       * 洗碗改成單一佇列之後，使用者指定「明早從 263-01 重新開始」，
       * 所以鎖定的日子可以順便指定隔天的起點，不然指標會延續舊演算法的位置。
       */
      if (override.daily.washNextStartId) {
        newWashState = { nextStartId: override.daily.washNextStartId };
      }
      ["laundryUp", "laundryDown", "shopping", "toilet", "water"].forEach((key) => {
        if (Array.isArray(override.daily[key])) daily[key] = override.daily[key].slice();
      });
      /*
       * 洗衣籃的進度要跟著鎖定的內容走，不然隔天「抬上來」會跟今天實際「抬下去」的人對不上
       * （進度是記「上一組最後一位是誰」，所以連 lastAssignedId 一起改）。
       */
      if (Array.isArray(override.daily.laundryDown)) {
        newLaundryState = {
          lastAssignedId: daily.laundryDown.length ? daily.laundryDown[daily.laundryDown.length - 1] : newLaundryState.lastAssignedId,
          lastDown: daily.laundryDown.slice(),
        };
      }
    }

    (daily.shopping || []).forEach((id) => bump([id], "shopping"));
    bump(daily.toilet, "toilet");
    // 抬上來與抬下去是同一組人一天各做一次，合併成一個 laundry 次數統計就夠了
    bump(daily.laundryUp, "laundry");
    bump(daily.laundryDown, "laundry");

    return {
      ok: true,
      meals,
      daily,
      warnings,
      sizeConfig: sizeByMeal.dinner,
      // 撤收那天「本來要排幾個人」，稽核腳本拿來比對名額有沒有坐滿
      cleanupDesired: cleanupDay.desiredSizes,
      newWashState,
      newWaterState: waterDay.newWaterState,
      newLaundryState,
      newDutyCounts,
    };
  }

  /** 重播：依日期順序把所有已確定的日期重算一遍 */
  function rebuildAll() {
    const state = window.App.State.get();
    window.App.State.clearDerived();

    const running = {
      members: state.members,
      dutyCounts: state.dutyCounts,
      washState: state.washState,
      laundryState: state.laundryState,
      waterState: state.waterState,
      dutySizeTable: state.dutySizeTable,
      shoppingByDate: state.shoppingByDate,
      toiletByDate: state.toiletByDate,
      overrides: state.overrides,
    };

    const dates = state.committedDates.slice().sort();
    const failed = [];

    dates.forEach((dateStr) => {
      const result = computeDay(dateStr, running);
      if (!result.ok) {
        failed.push({ date: dateStr, error: result.error });
        return;
      }

      state.schedules[dateStr] = {
        meals: result.meals,
        daily: result.daily,
        warnings: result.warnings.slice(),
        sizeConfig: result.sizeConfig,
        cleanupDesired: result.cleanupDesired,
      };

      running.dutyCounts = result.newDutyCounts;
      running.washState = result.newWashState;
      running.waterState = result.newWaterState;
      running.laundryState = result.newLaundryState;
    });

    state.dutyCounts = running.dutyCounts;
    state.washState = running.washState;
    state.waterState = running.waterState;
    state.laundryState = running.laundryState;

    state.committedDates = dates.filter((d) => !failed.some((f) => f.date === d));
    window.App.State.save();

    return { failed };
  }

  function currentSnapshot() {
    const state = window.App.State.get();
    return {
      members: state.members,
      dutyCounts: state.dutyCounts,
      washState: state.washState,
      laundryState: state.laundryState,
      waterState: state.waterState,
      dutySizeTable: state.dutySizeTable,
      shoppingByDate: state.shoppingByDate,
      toiletByDate: state.toiletByDate,
      overrides: state.overrides,
    };
  }

  /**
   * 算出「如果要排 dateStr 這天」時，該天開始前的狀態。
   * 也就是把所有早於 dateStr 的已確定日期重播一遍（不含 dateStr 自己）。
   */
  function snapshotBefore(dateStr) {
    const state = window.App.State.get();
    const snapshot = {
      members: state.members,
      dutySizeTable: state.dutySizeTable,
      shoppingByDate: state.shoppingByDate,
      toiletByDate: state.toiletByDate,
      overrides: state.overrides,
      dutyCounts: {},
      washState: window.App.State.defaultWashState(),
      laundryState: window.App.State.defaultLaundryState(),
      waterState: window.App.State.defaultWaterState(),
    };
    state.members.forEach((m) => (snapshot.dutyCounts[m.id] = window.App.State.emptyDutyCount()));

    state.committedDates
      .slice()
      .sort()
      .filter((d) => d < dateStr)
      .forEach((d) => {
        const result = computeDay(d, snapshot);
        if (!result.ok) return;
        snapshot.dutyCounts = result.newDutyCounts;
        snapshot.washState = result.newWashState;
        snapshot.waterState = result.newWaterState;
        snapshot.laundryState = result.newLaundryState;
      });

    return snapshot;
  }

  /**
   * 預覽某一天的班表，完全不會寫入 localStorage、不會累計次數、不會推進洗碗指標。
   * 預覽結果跟「確定紀錄」之後看到的結果保證一致。
   */
  function previewDay(dateStr) {
    const result = computeDay(dateStr, snapshotBefore(dateStr));
    if (!result.ok) return result;

    const state = window.App.State.get();
    const alreadyCommitted = state.committedDates.includes(dateStr);
    return {
      ok: true,
      committed: alreadyCommitted,
      meals: result.meals,
      daily: result.daily,
      warnings: result.warnings,
    };
  }

  /**
   * 確定紀錄某一天。若這天已經紀錄過，會先清掉舊結果再重算，
   * 因為結果是重播出來的，重排同一天必定得到跟原本一樣的班表。
   */
  function commitDay(dateStr) {
    const state = window.App.State.get();
    if (!state.committedDates.includes(dateStr)) {
      state.committedDates.push(dateStr);
    }
    const { failed } = rebuildAll();

    const failure = failed.find((f) => f.date === dateStr);
    if (failure) {
      return { ok: false, error: failure.error };
    }

    const schedule = state.schedules[dateStr];
    return { ok: true, meals: schedule.meals, daily: schedule.daily, warnings: schedule.warnings };
  }

  /** 取消某一天的紀錄 */
  function uncommitDay(dateStr) {
    const state = window.App.State.get();
    state.committedDates = state.committedDates.filter((d) => d !== dateStr);
    rebuildAll();
    return { ok: true };
  }

  window.App.ScheduleEngine = {
    computeDay,
    previewDay,
    commitDay,
    uncommitDay,
    rebuildAll,
    snapshotBefore,
    currentSnapshot,
  };
})();
