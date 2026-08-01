/*
 * 排班引擎。
 *
 * 設計重點：班表是「重播」出來的，不是一天一天累加出來的。
 * state.committedDates（已確定的日期）+ state.shoppingLog（採買登記）是唯一的來源資料，
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
   * @param {{members, dutyCounts, washState, cleanupGroups, laundryState, dutySizeTable}} snapshot
   */
  function computeDay(dateStr, snapshot) {
    const activeMembers = snapshot.members.filter((m) => window.App.State.isActiveOn(m, dateStr));
    const activeCount = activeMembers.length;

    const sizeConfig = window.App.DutySizeConfig.lookupDutySize(snapshot.dutySizeTable, activeCount);
    if (!sizeConfig) {
      return {
        ok: false,
        error: `${dateStr} 現有人數為 ${activeCount} 人，勤務人數設定表中找不到對應設定，請先到「勤務設定」補上這個人數的配置。`,
      };
    }

    const warnings = [];

    const deliveryMembers = activeMembers.filter((m) => m.fixedRole === "delivery");
    const deliveryIds = deliveryMembers.map((m) => m.id);
    if (deliveryIds.length !== 2) {
      warnings.push(
        `固定送便當人力目前只有 ${deliveryIds.length} 人（正常應為2人），請到「名冊管理」手動指定送便當人員。`
      );
    }

    const bySeq = (a, b) => a.seq - b.seq;
    const pools = {
      261: activeMembers.filter((m) => m.cohort === "261").sort(bySeq),
      263: activeMembers.filter((m) => m.cohort === "263").sort(bySeq),
    };

    const washDay = window.App.WashSchedule.computeWashDay(snapshot.washState, pools, sizeConfig.dishwash);

    let cleanupGroups = snapshot.cleanupGroups;
    if (window.App.CleanupGroups.needsRegroup(cleanupGroups, activeMembers)) {
      cleanupGroups = window.App.CleanupGroups.regroup(activeMembers);
      warnings.push("人員名單有變動，撤收分組已自動重新平均分配，請至「名冊管理」確認/微調分組。");
    }
    const cleanupDay = window.App.CleanupGroups.computeCleanupDay(cleanupGroups);

    const newDutyCounts = cloneDutyCounts(snapshot.dutyCounts);
    const meals = {};
    MEAL_KEYS.forEach((meal) => {
      const dishwashIds = washDay.assignments[meal] || [];
      const excludeIds = new Set(dishwashIds.concat(deliveryIds));
      const otherPool = activeMembers.filter((m) => !excludeIds.has(m.id));
      const otherAssign = window.App.OtherDuties.assignOtherDuties(otherPool, newDutyCounts, sizeConfig);

      meals[meal] = {
        dishwash: dishwashIds,
        foodwaste: otherAssign.foodwaste,
        lunchbag: otherAssign.lunchbag,
        // 抬便當上車/上樓的人就是包便當袋子的那幾位，不另外排
        carryVehicle: otherAssign.lunchbag.slice(),
        carryUpstairs: otherAssign.lunchbag.slice(),
        floor: otherAssign.floor,
        wipe: otherAssign.wipe,
        delivery: deliveryIds,
        cleanup: cleanupDay.assignments[meal] || [],
      };

      incrementCounts(newDutyCounts, dishwashIds, "dishwash");
      incrementCounts(newDutyCounts, otherAssign.foodwaste, "foodwaste");
      incrementCounts(newDutyCounts, otherAssign.lunchbag, "lunchbag");
      incrementCounts(newDutyCounts, otherAssign.floor, "floor");
      incrementCounts(newDutyCounts, otherAssign.wipe, "wipe");
      incrementCounts(newDutyCounts, meals[meal].cleanup, "cleanup");
    });

    const laundryDay = window.App.Laundry.computeLaundryDay(snapshot.laundryState, snapshot.members, dateStr);
    laundryDay.warnings.forEach((w) => warnings.push(w));
    const daily = { laundryUp: laundryDay.up, laundryDown: laundryDay.down };
    // 抬上來與抬下去是同一組人一天各做一次，合併成一個 laundry 次數統計就夠了
    incrementCounts(newDutyCounts, laundryDay.up, "laundry");
    incrementCounts(newDutyCounts, laundryDay.down, "laundry");

    return {
      ok: true,
      meals,
      daily,
      warnings,
      sizeConfig,
      newWashState: washDay.newWashState,
      newCleanupGroups: cleanupDay.newCleanupGroups,
      newLaundryState: laundryDay.newLaundryState,
      newDutyCounts,
    };
  }

  /** 重播：依日期順序把所有已確定的日期重算一遍，並套用採買調整 */
  function rebuildAll() {
    const state = window.App.State.get();
    window.App.State.clearDerived();

    const running = {
      members: state.members,
      dutyCounts: state.dutyCounts,
      washState: state.washState,
      cleanupGroups: state.cleanupGroups,
      laundryState: state.laundryState,
      dutySizeTable: state.dutySizeTable,
    };

    const shoppingByDate = {};
    state.shoppingLog.forEach((entry) => {
      (shoppingByDate[entry.date] = shoppingByDate[entry.date] || []).push(entry);
    });

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
      running.cleanupGroups = result.newCleanupGroups;
      running.laundryState = result.newLaundryState;

      // 當天的採買調整要在推進到下一天之前套用，這樣代理人選才是依當下的次數決定
      (shoppingByDate[dateStr] || []).forEach((entry) => {
        window.App.Shopping.applyAdjustment(state.schedules[dateStr], running, entry);
      });
    });

    state.dutyCounts = running.dutyCounts;
    state.washState = running.washState;
    state.cleanupGroups = running.cleanupGroups;
    state.laundryState = running.laundryState;

    // 採買次數不是排班排出來的，直接依 log 統計
    state.shoppingLog.forEach((entry) => {
      ensureDutyCounts(state.dutyCounts, entry.memberId).shopping += 1;
    });

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
      cleanupGroups: state.cleanupGroups,
      laundryState: state.laundryState,
      dutySizeTable: state.dutySizeTable,
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
      dutyCounts: {},
      washState: window.App.State.defaultWashState(),
      cleanupGroups: window.App.State.defaultCleanupGroups(),
      laundryState: window.App.State.defaultLaundryState(),
    };
    state.members.forEach((m) => (snapshot.dutyCounts[m.id] = window.App.State.emptyDutyCount()));

    const shoppingByDate = {};
    state.shoppingLog.forEach((entry) => {
      (shoppingByDate[entry.date] = shoppingByDate[entry.date] || []).push(entry);
    });

    state.committedDates
      .slice()
      .sort()
      .filter((d) => d < dateStr)
      .forEach((d) => {
        const result = computeDay(d, snapshot);
        if (!result.ok) return;
        snapshot.dutyCounts = result.newDutyCounts;
        snapshot.washState = result.newWashState;
        snapshot.cleanupGroups = result.newCleanupGroups;
        snapshot.laundryState = result.newLaundryState;
        const daySchedule = { meals: result.meals, warnings: result.warnings };
        (shoppingByDate[d] || []).forEach((entry) => {
          window.App.Shopping.applyAdjustment(daySchedule, snapshot, entry);
        });
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
    state.shoppingLog = state.shoppingLog.filter((e) => e.date !== dateStr);
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
