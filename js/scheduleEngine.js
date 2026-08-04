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
   * 純計算：不會修改任何全域狀態，只根據傳入的 snapshot 算出這一天的班表。
   * @param {string} dateStr
   * @param {{members, dutyCounts, washState, laundryState, dutySizeTable, shoppingRoster}} snapshot
   */
  function computeDay(dateStr, snapshot) {
    const St = window.App.State;
    // 當天「有出現過」的人。退伍當天的人也算在內，因為他早餐、中餐還在。
    const dayMembers = snapshot.members.filter((m) => St.isActiveOn(m, dateStr));
    const warnings = [];

    const shopper = window.App.ShoppingRoster.shopperFor(
      dateStr,
      snapshot.members,
      snapshot.shoppingRoster,
      snapshot.shoppingUntil
    );
    if (shopper.warning) warnings.push(shopper.warning);
    const shopperId = shopper.memberId;
    const SHOPPER_OFF_MEALS = ["breakfast", "lunch"];
    const isOffForShopping = (memberId, meal) =>
      shopperId != null && memberId === shopperId && SHOPPER_OFF_MEALS.indexOf(meal) !== -1;

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
    MEAL_KEYS.forEach((meal) => {
      const present = dayMembers.filter((m) => availableForMeal(m.id, meal));
      presentByMeal[meal] = present;
      const cfg = window.App.DutySizeConfig.lookupDutySize(snapshot.dutySizeTable, present.length);
      if (!cfg && !sizeError) {
        sizeError = `${dateStr} ${St.MEAL_LABELS[meal]}實際出勤 ${present.length} 人，勤務人數設定表中找不到對應設定，請先到「勤務設定」補上這個人數的配置。`;
      }
      sizeByMeal[meal] = cfg;
    });
    if (sizeError) return { ok: false, error: sizeError };

    const deliveryAll = dayMembers.filter((m) => m.fixedRole === "delivery").map((m) => m.id);
    if (deliveryAll.length !== 2) {
      warnings.push(
        `固定送便當人力目前只有 ${deliveryAll.length} 人（正常應為2人），請到「名冊管理」手動指定送便當人員。`
      );
    }

    const bySeq = (a, b) => a.seq - b.seq;
    const pools = {
      261: dayMembers.filter((m) => m.cohort === "261").sort(bySeq),
      263: dayMembers.filter((m) => m.cohort === "263").sort(bySeq),
    };

    const dishwashCounts = {};
    MEAL_KEYS.forEach((meal) => (dishwashCounts[meal] = sizeByMeal[meal].dishwash));

    const washDay = window.App.WashSchedule.computeWashDay(
      snapshot.washState,
      pools,
      dishwashCounts,
      availableForMeal
    );

    const cleanupDay = window.App.CleanupSchedule.computeCleanupDay(
      dayMembers,
      snapshot.dutyCounts,
      availableForMeal
    );
    (cleanupDay.warnings || []).forEach((w) => warnings.push(w));

    const newDutyCounts = cloneDutyCounts(snapshot.dutyCounts);
    const meals = {};
    MEAL_KEYS.forEach((meal) => {
      const dishwashIds = washDay.assignments[meal] || [];
      const present = presentByMeal[meal];
      // 送便當也要看那一餐在不在（退伍當天晚上就不算他了）
      const deliveryIds = present.filter((m) => m.fixedRole === "delivery").map((m) => m.id);
      const excludeIds = new Set(dishwashIds.concat(deliveryIds));
      const otherPool = present.filter((m) => !excludeIds.has(m.id));
      const otherAssign = window.App.OtherDuties.assignOtherDuties(otherPool, newDutyCounts, sizeByMeal[meal]);

      // 抬便當上車、上樓：除了洗碗的人與固定送便當的兩位以外，當餐在場的人全部一起幫忙
      const carryIds = present.filter((m) => !excludeIds.has(m.id)).map((m) => m.id);

      // 打菜流程：打完菜之後才做勤務，兩者是同一批人、不同時段
      const serving = window.App.ServingLine.computeServingLine(
        present,
        newDutyCounts,
        window.App.State.menuSizeFor(dateStr, meal)
      );
      serving.warnings.forEach((w) => warnings.push(`${St.MEAL_LABELS[meal]}：${w}`));

      meals[meal] = {
        serving: serving.assignments,
        dishes: serving.dishes,
        dishwash: dishwashIds,
        foodwaste: otherAssign.foodwaste,
        carryVehicle: carryIds.slice(),
        carryUpstairs: carryIds.slice(),
        floor: otherAssign.floor,
        wipe: otherAssign.wipe,
        delivery: deliveryIds,
        cleanup: (cleanupDay.assignments[meal] || []).filter((id) => availableForMeal(id, meal)),
        // 這一餐去採買所以人不在，顯示時要跟「有空幫忙包便當」區分開
        absent: dayMembers.filter((m) => isOffForShopping(m.id, meal)).map((m) => m.id),
        // 這一餐已經離營（退伍當天的晚餐），文字班表要寫「已離營」而不是「休息」
        departed: dayMembers.filter((m) => !St.isActiveOn(m, dateStr, meal)).map((m) => m.id),
      };

      incrementCounts(newDutyCounts, serving.assignments.serveDish, "serveDish");
      incrementCounts(newDutyCounts, serving.assignments.lid, "lid");
      incrementCounts(newDutyCounts, serving.assignments.boxing, "boxing");
      incrementCounts(newDutyCounts, dishwashIds, "dishwash");
      incrementCounts(newDutyCounts, otherAssign.foodwaste, "foodwaste");
      incrementCounts(newDutyCounts, otherAssign.floor, "floor");
      incrementCounts(newDutyCounts, otherAssign.wipe, "wipe");
      incrementCounts(newDutyCounts, meals[meal].cleanup, "cleanup");
      incrementCounts(newDutyCounts, meals[meal].cleanup, window.App.CleanupSchedule.PER_MEAL_COUNT_KEY[meal]);
    });

    const laundryDay = window.App.Laundry.computeLaundryDay(snapshot.laundryState, snapshot.members, dateStr);
    laundryDay.warnings.forEach((w) => warnings.push(w));
    const daily = {
      laundryUp: laundryDay.up,
      laundryDown: laundryDay.down,
      shopping: shopperId ? [shopperId] : [],
    };
    if (shopperId) incrementCounts(newDutyCounts, [shopperId], "shopping");
    // 抬上來與抬下去是同一組人一天各做一次，合併成一個 laundry 次數統計就夠了
    incrementCounts(newDutyCounts, laundryDay.up, "laundry");
    incrementCounts(newDutyCounts, laundryDay.down, "laundry");

    return {
      ok: true,
      meals,
      daily,
      warnings,
      sizeConfig: sizeByMeal.dinner,
      newWashState: washDay.newWashState,
      newLaundryState: laundryDay.newLaundryState,
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
      dutySizeTable: state.dutySizeTable,
      shoppingRoster: state.shoppingRoster,
      shoppingUntil: state.shoppingUntil,
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
      };

      running.dutyCounts = result.newDutyCounts;
      running.washState = result.newWashState;
      running.laundryState = result.newLaundryState;
    });

    state.dutyCounts = running.dutyCounts;
    state.washState = running.washState;
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
      dutySizeTable: state.dutySizeTable,
      shoppingRoster: state.shoppingRoster,
      shoppingUntil: state.shoppingUntil,
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
      shoppingRoster: state.shoppingRoster,
      shoppingUntil: state.shoppingUntil,
      dutyCounts: {},
      washState: window.App.State.defaultWashState(),
      laundryState: window.App.State.defaultLaundryState(),
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
