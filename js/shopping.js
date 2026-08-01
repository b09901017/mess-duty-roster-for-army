/* 採買登記：抓去採買的人原本的職缺交給當餐擦桌子的人代理，並記錄提醒 */
window.App = window.App || {};

(function () {
  "use strict";

  const DUTY_SEARCH_ORDER = ["dishwash", "foodwaste", "lunchbag", "floor", "wipe", "delivery"];

  function ensureCounts(state, id) {
    if (!state.dutyCounts[id]) state.dutyCounts[id] = window.App.State.emptyDutyCount();
    return state.dutyCounts[id];
  }

  function findOriginalDuty(mealData, memberId) {
    for (const key of DUTY_SEARCH_ORDER) {
      if ((mealData[key] || []).includes(memberId)) return key;
    }
    return null;
  }

  function removeFrom(list, id) {
    const idx = list.indexOf(id);
    if (idx >= 0) list.splice(idx, 1);
  }

  function pickSubstituteWiper(state, active, mealData, excludeId) {
    const busy = new Set(
      []
        .concat(mealData.dishwash, mealData.foodwaste, mealData.lunchbag, mealData.floor, mealData.delivery)
        .filter(Boolean)
    );
    busy.add(excludeId);
    const candidates = active.filter((m) => !busy.has(m.id));
    if (candidates.length === 0) return null;
    const sorted = candidates.slice().sort((a, b) => {
      const ca = (state.dutyCounts[a.id] && state.dutyCounts[a.id].wipe) || 0;
      const cb = (state.dutyCounts[b.id] && state.dutyCounts[b.id].wipe) || 0;
      if (ca !== cb) return ca - cb;
      const cohortOrder = ["261", "263"];
      const coa = cohortOrder.indexOf(a.cohort);
      const cob = cohortOrder.indexOf(b.cohort);
      if (coa !== cob) return coa - cob;
      return a.seq - b.seq;
    });
    return sorted[0].id;
  }

  /**
   * @param {string} dateStr
   * @param {string} meal - breakfast|lunch|dinner
   * @param {string} memberId
   * @returns {{ok: boolean, error?: string, reminder?: {priorCount:number, average:number}, note?: string}}
   */
  function logShopping(dateStr, meal, memberId) {
    const state = window.App.State.get();
    const schedule = state.schedules[dateStr];
    if (!schedule) {
      return { ok: false, error: "請先產生當天的班表，再登記採買。" };
    }
    const mealData = schedule.meals[meal];
    if (!mealData) {
      return { ok: false, error: "找不到這一餐的班表資料。" };
    }

    const priorCount = (state.dutyCounts[memberId] && state.dutyCounts[memberId].shopping) || 0;

    const originalDuty = findOriginalDuty(mealData, memberId);
    let note = "";

    if (originalDuty === "wipe") {
      const active = window.App.State.activeMembers();
      const substituteId = pickSubstituteWiper(state, active, mealData, memberId);
      removeFrom(mealData.wipe, memberId);
      ensureCounts(state, memberId).wipe = Math.max(0, (state.dutyCounts[memberId].wipe || 0) - 1);
      if (substituteId) {
        mealData.wipe.push(substituteId);
        ensureCounts(state, substituteId).wipe = (state.dutyCounts[substituteId].wipe || 0) + 1;
        note = `${memberId} 原本負責擦桌子，已改由 ${substituteId} 代理擦桌子。`;
      } else {
        note = `${memberId} 原本負責擦桌子，目前找不到可代理的人，請手動安排。`;
      }
    } else if (originalDuty) {
      removeFrom(mealData[originalDuty], memberId);
      ensureCounts(state, memberId)[originalDuty] = Math.max(
        0,
        (state.dutyCounts[memberId][originalDuty] || 0) - 1
      );
      mealData.wipe.forEach((wipeId) => {
        if (!mealData[originalDuty].includes(wipeId)) {
          mealData[originalDuty].push(wipeId);
          ensureCounts(state, wipeId)[originalDuty] = (state.dutyCounts[wipeId][originalDuty] || 0) + 1;
        }
      });
      note = `${memberId} 原本負責「${window.App.State.DUTY_LABELS[originalDuty]}」，已改由擦桌子的 ${mealData.wipe.join(
        "、"
      )} 兼任。`;
    } else {
      note = `${memberId} 這餐原本沒有被排到勤務（可能本來就在撤收組或休息），僅記錄採買次數。`;
    }

    state.shoppingLog.push({ date: dateStr, meal, memberId });
    ensureCounts(state, memberId).shopping = priorCount + 1;

    const activeIds = window.App.State.activeMembers().map((m) => m.id);
    const totalShopping = activeIds.reduce(
      (sum, id) => sum + ((state.dutyCounts[id] && state.dutyCounts[id].shopping) || 0),
      0
    );
    const average = activeIds.length ? totalShopping / activeIds.length : 0;

    window.App.State.save();

    return {
      ok: true,
      note,
      reminder: priorCount > 0 ? { priorCount, average: Math.round(average * 100) / 100 } : null,
    };
  }

  window.App.Shopping = { logShopping };
})();
