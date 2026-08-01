/* 整合洗碗/其他勤務/送便當/撤收，計算某一天的班表（純函式）+ 預覽/確定紀錄 */
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
   * @param {{members, dutyCounts, washState, cleanupGroups, dutySizeTable}} snapshot
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

    return {
      ok: true,
      meals,
      warnings,
      sizeConfig,
      newWashState: washDay.newWashState,
      newCleanupGroups: cleanupDay.newCleanupGroups,
      newDutyCounts,
    };
  }

  function decrementCounts(dutyCounts, ids, dutyKey) {
    ids.forEach((id) => {
      const counts = ensureDutyCounts(dutyCounts, id);
      counts[dutyKey] = Math.max(0, (counts[dutyKey] || 0) - 1);
    });
  }

  function rollbackCommittedDay(dutyCounts, oldSchedule) {
    MEAL_KEYS.forEach((meal) => {
      const mealData = oldSchedule.meals[meal];
      if (!mealData) return;
      decrementCounts(dutyCounts, mealData.dishwash, "dishwash");
      decrementCounts(dutyCounts, mealData.foodwaste, "foodwaste");
      decrementCounts(dutyCounts, mealData.lunchbag, "lunchbag");
      decrementCounts(dutyCounts, mealData.floor, "floor");
      decrementCounts(dutyCounts, mealData.wipe, "wipe");
      decrementCounts(dutyCounts, mealData.cleanup, "cleanup");
    });
  }

  function currentSnapshot() {
    const state = window.App.State.get();
    return {
      members: state.members,
      dutyCounts: state.dutyCounts,
      washState: state.washState,
      cleanupGroups: state.cleanupGroups,
      dutySizeTable: state.dutySizeTable,
    };
  }

  /**
   * 預覽某一天的班表，完全不會寫入 localStorage、不會累計次數、不會推進洗碗指標。
   * 若這天已經確定紀錄過，直接回傳已紀錄的內容。
   */
  function previewDay(dateStr) {
    const state = window.App.State.get();
    if (state.schedules[dateStr]) {
      const committed = state.schedules[dateStr];
      return { ok: true, committed: true, meals: committed.meals, warnings: committed.warnings || [] };
    }
    const result = computeDay(dateStr, currentSnapshot());
    if (!result.ok) return result;
    return { ok: true, committed: false, meals: result.meals, warnings: result.warnings };
  }

  /**
   * 確定紀錄某一天：真正寫入班表、累計各項勤務次數、推進洗碗指標與撤收分組。
   * @param {{force?: boolean}} opts - force=true 允許覆蓋已經確定過的這一天（會重新計算，請小心使用）
   */
  function commitDay(dateStr, opts) {
    opts = opts || {};
    const state = window.App.State.get();

    if (state.schedules[dateStr] && !opts.force) {
      return {
        ok: false,
        error: `${dateStr} 已經確定紀錄過了，如果要覆蓋請使用「重新產生」。`,
      };
    }

    const snapshot = currentSnapshot();
    if (opts.force && state.schedules[dateStr]) {
      snapshot.dutyCounts = cloneDutyCounts(state.dutyCounts);
      rollbackCommittedDay(snapshot.dutyCounts, state.schedules[dateStr]);
    }

    const result = computeDay(dateStr, snapshot);
    if (!result.ok) return result;

    state.dutyCounts = result.newDutyCounts;
    state.washState = result.newWashState;
    state.cleanupGroups = result.newCleanupGroups;
    state.schedules[dateStr] = {
      meals: result.meals,
      warnings: result.warnings,
      sizeConfig: result.sizeConfig,
      generatedAt: new Date().toISOString(),
    };
    window.App.State.save();

    return { ok: true, meals: result.meals, warnings: result.warnings };
  }

  window.App.ScheduleEngine = { computeDay, previewDay, commitDay };
})();
