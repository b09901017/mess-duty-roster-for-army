/* 整合洗碗/其他勤務/送便當/撤收，產生某一天完整班表 */
window.App = window.App || {};

(function () {
  "use strict";

  const MEAL_KEYS = window.App.State.MEAL_KEYS;

  function ensureDutyCounts(state, memberId) {
    if (!state.dutyCounts[memberId]) {
      state.dutyCounts[memberId] = window.App.State.emptyDutyCount();
    }
    return state.dutyCounts[memberId];
  }

  function incrementCounts(state, ids, dutyKey) {
    ids.forEach((id) => {
      const counts = ensureDutyCounts(state, id);
      counts[dutyKey] = (counts[dutyKey] || 0) + 1;
    });
  }

  /**
   * @param {string} dateStr - YYYY-MM-DD
   * @param {{force?: boolean}} opts
   * @returns {{ok: boolean, error?: string, meals?: object, warnings?: string[], cached?: boolean}}
   */
  function generateDay(dateStr, opts) {
    opts = opts || {};
    const state = window.App.State.get();

    if (state.schedules[dateStr] && !opts.force) {
      return {
        ok: true,
        cached: true,
        meals: state.schedules[dateStr].meals,
        warnings: state.schedules[dateStr].warnings || [],
      };
    }

    const active = window.App.State.activeMembers();
    const activeCount = active.length;

    const sizeConfig = window.App.DutySizeConfig.lookupDutySize(state.dutySizeTable, activeCount);
    if (!sizeConfig) {
      return {
        ok: false,
        error: `目前現有人數為 ${activeCount} 人，勤務人數設定表中找不到對應設定，請先到「勤務設定」補上這個人數的配置。`,
      };
    }

    const warnings = [];

    const deliveryMembers = active.filter((m) => m.fixedRole === "delivery");
    const deliveryIds = deliveryMembers.map((m) => m.id);
    if (deliveryIds.length !== 2) {
      warnings.push(
        `固定送便當人力目前只有 ${deliveryIds.length} 人（正常應為2人），請到「名冊管理」手動指定送便當人員。`
      );
    }

    const pools = {
      261: window.App.State.activeMembersByCohort("261"),
      263: window.App.State.activeMembersByCohort("263"),
    };

    const washDay = window.App.WashSchedule.computeWashDay(state.washState, pools, sizeConfig.dishwash);

    let cleanupGroups = state.cleanupGroups;
    if (window.App.CleanupGroups.needsRegroup(cleanupGroups, active)) {
      cleanupGroups = window.App.CleanupGroups.regroup(active);
      warnings.push("人員名單有變動，撤收分組已自動重新平均分配，請至「名冊管理」確認/微調分組。");
    }
    const cleanupDay = window.App.CleanupGroups.computeCleanupDay(cleanupGroups);

    const meals = {};
    MEAL_KEYS.forEach((meal) => {
      const dishwashIds = washDay.assignments[meal] || [];
      const excludeIds = new Set(dishwashIds.concat(deliveryIds));
      const otherPool = active.filter((m) => !excludeIds.has(m.id));
      const otherAssign = window.App.OtherDuties.assignOtherDuties(otherPool, state.dutyCounts, sizeConfig);

      meals[meal] = {
        dishwash: dishwashIds,
        foodwaste: otherAssign.foodwaste,
        lunchbag: otherAssign.lunchbag,
        floor: otherAssign.floor,
        wipe: otherAssign.wipe,
        delivery: deliveryIds,
        cleanup: cleanupDay.assignments[meal] || [],
      };

      incrementCounts(state, dishwashIds, "dishwash");
      incrementCounts(state, otherAssign.foodwaste, "foodwaste");
      incrementCounts(state, otherAssign.lunchbag, "lunchbag");
      incrementCounts(state, otherAssign.floor, "floor");
      incrementCounts(state, otherAssign.wipe, "wipe");
      incrementCounts(state, meals[meal].cleanup, "cleanup");
    });

    state.washState = washDay.newWashState;
    state.cleanupGroups = cleanupDay.newCleanupGroups;
    state.schedules[dateStr] = {
      meals,
      warnings,
      sizeConfig,
      generatedAt: new Date().toISOString(),
    };

    window.App.State.save();

    return { ok: true, cached: false, meals, warnings };
  }

  window.App.ScheduleEngine = { generateDay };
})();
