/*
 * 採買登記：抓去採買的人原本的職缺交給當餐擦桌子的人代理，並記錄提醒。
 *
 * 採買調整是「重播」的一部分：logShopping 只負責把登記寫進 shoppingLog，
 * 真正的班表調整由 applyAdjustment 在 ScheduleEngine.rebuildAll 重播時套用，
 * 所以重排同一天不會重複扣加次數。
 */
window.App = window.App || {};

(function () {
  "use strict";

  const DUTY_SEARCH_ORDER = ["dishwash", "foodwaste", "lunchbag", "floor", "wipe", "delivery"];
  const COHORT_ORDER = ["261", "263"];

  function ensureCounts(dutyCounts, id) {
    if (!dutyCounts[id]) dutyCounts[id] = window.App.State.emptyDutyCount();
    return dutyCounts[id];
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

  function pickSubstituteWiper(snapshot, mealData, dateStr, excludeId) {
    const active = snapshot.members.filter((m) => window.App.State.isActiveOn(m, dateStr));
    const busy = new Set(
      []
        .concat(mealData.dishwash, mealData.foodwaste, mealData.lunchbag, mealData.floor, mealData.delivery)
        .filter(Boolean)
    );
    busy.add(excludeId);
    const candidates = active.filter((m) => !busy.has(m.id));
    if (candidates.length === 0) return null;
    const sorted = candidates.slice().sort((a, b) => {
      const ca = (snapshot.dutyCounts[a.id] && snapshot.dutyCounts[a.id].wipe) || 0;
      const cb = (snapshot.dutyCounts[b.id] && snapshot.dutyCounts[b.id].wipe) || 0;
      if (ca !== cb) return ca - cb;
      const coa = COHORT_ORDER.indexOf(a.cohort);
      const cob = COHORT_ORDER.indexOf(b.cohort);
      if (coa !== cob) return coa - cob;
      return a.seq - b.seq;
    });
    return sorted[0].id;
  }

  function nameOf(id) {
    const m = window.App.State.memberById(id);
    return m ? m.name : id;
  }

  /**
   * 把一筆採買登記套用到已算好的某天班表上（會就地修改 daySchedule 與 snapshot.dutyCounts）。
   * @returns {{note: string}}
   */
  function applyAdjustment(daySchedule, snapshot, entry) {
    const mealData = daySchedule.meals[entry.meal];
    if (!mealData) return { note: "" };

    const memberId = entry.memberId;
    const dutyCounts = snapshot.dutyCounts;
    const originalDuty = findOriginalDuty(mealData, memberId);
    let note = "";

    if (originalDuty === "wipe") {
      const substituteId = pickSubstituteWiper(snapshot, mealData, entry.date, memberId);
      removeFrom(mealData.wipe, memberId);
      ensureCounts(dutyCounts, memberId).wipe = Math.max(0, (dutyCounts[memberId].wipe || 0) - 1);
      if (substituteId) {
        mealData.wipe.push(substituteId);
        ensureCounts(dutyCounts, substituteId).wipe = (dutyCounts[substituteId].wipe || 0) + 1;
        note = `${nameOf(memberId)} 原本負責擦桌子，已改由 ${nameOf(substituteId)} 代理擦桌子。`;
      } else {
        note = `${nameOf(memberId)} 原本負責擦桌子，目前找不到可代理的人，請手動安排。`;
      }
    } else if (originalDuty) {
      removeFrom(mealData[originalDuty], memberId);
      ensureCounts(dutyCounts, memberId)[originalDuty] = Math.max(
        0,
        (dutyCounts[memberId][originalDuty] || 0) - 1
      );
      mealData.wipe.forEach((wipeId) => {
        if (!mealData[originalDuty].includes(wipeId)) {
          mealData[originalDuty].push(wipeId);
          ensureCounts(dutyCounts, wipeId)[originalDuty] = (dutyCounts[wipeId][originalDuty] || 0) + 1;
        }
      });
      note = `${nameOf(memberId)} 原本負責「${window.App.State.DUTY_LABELS[originalDuty]}」，已改由擦桌子的 ${mealData.wipe
        .map(nameOf)
        .join("、")} 兼任。`;
    } else {
      note = `${nameOf(memberId)} 這餐原本沒有被排到勤務（可能本來就在撤收組或休息），僅記錄採買次數。`;
    }

    daySchedule.shoppingNotes = (daySchedule.shoppingNotes || []).concat([note]);
    return { note };
  }

  /**
   * 登記某天某餐誰去採買。
   * @returns {{ok: boolean, error?: string, reminder?: object, note?: string}}
   */
  function logShopping(dateStr, meal, memberId) {
    const state = window.App.State.get();
    if (!state.committedDates.includes(dateStr)) {
      return { ok: false, error: "請先在「產生班表」把當天的班表「確定紀錄」，再登記採買。" };
    }
    if (state.shoppingLog.some((e) => e.date === dateStr && e.meal === meal && e.memberId === memberId)) {
      return { ok: false, error: "這一筆採買登記已經存在了。" };
    }

    const priorCount = (state.dutyCounts[memberId] && state.dutyCounts[memberId].shopping) || 0;

    state.shoppingLog.push({ date: dateStr, meal, memberId });
    window.App.ScheduleEngine.rebuildAll();

    const schedule = state.schedules[dateStr];
    const notes = (schedule && schedule.shoppingNotes) || [];
    const note = notes.length ? notes[notes.length - 1] : "";

    const activeIds = window.App.State.activeMembersOn(dateStr).map((m) => m.id);
    const totalShopping = activeIds.reduce(
      (sum, id) => sum + ((state.dutyCounts[id] && state.dutyCounts[id].shopping) || 0),
      0
    );
    const average = activeIds.length ? totalShopping / activeIds.length : 0;

    return {
      ok: true,
      note,
      reminder: priorCount > 0 ? { priorCount, average: Math.round(average * 100) / 100 } : null,
    };
  }

  /** 刪除一筆採買登記（登記錯人時可以撤銷） */
  function removeShopping(dateStr, meal, memberId) {
    const state = window.App.State.get();
    state.shoppingLog = state.shoppingLog.filter(
      (e) => !(e.date === dateStr && e.meal === meal && e.memberId === memberId)
    );
    window.App.ScheduleEngine.rebuildAll();
    return { ok: true };
  }

  window.App.Shopping = { logShopping, removeShopping, applyAdjustment };
})();
