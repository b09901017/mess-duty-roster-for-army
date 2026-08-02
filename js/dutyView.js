/*
 * 把班表資料轉成「某個人某一餐要做什麼」的共用邏輯，班表檢視與文字班表都用這個，
 * 避免兩邊各寫一份導致顯示不一致。
 *
 * 重點規則（使用者確認過）：
 *   - 除了洗碗的人以外，其餘人做完自己的事都要去幫忙包便當；送便當的兩位不用（他們負責送）。
 *   - 被排到「包便當袋子」的人另外還要抬便當上車、上樓。
 */
window.App = window.App || {};

(function () {
  "use strict";

  // 個人分工的顯示順序：先講他被排到的主要勤務，再接幫忙包便當，最後才是撤收
  const PRIMARY_DUTIES = ["dishwash", "foodwaste", "lunchbag", "wipe", "floor", "delivery"];

  function has(mealData, dutyKey, memberId) {
    return ((mealData && mealData[dutyKey]) || []).includes(memberId);
  }

  /** 這一餐這個人不在（去採買了） */
  function isAbsent(mealData, memberId) {
    return has(mealData, "absent", memberId);
  }

  /** 這一餐這個人要不要幫忙包便當（洗碗的、送便當的、以及人不在的不用） */
  function helpsWithLunchbag(mealData, memberId) {
    if (isAbsent(mealData, memberId)) return false;
    if (has(mealData, "lunchbag", memberId)) return false; // 他本來就是包便當的
    if (has(mealData, "dishwash", memberId)) return false;
    if (has(mealData, "delivery", memberId)) return false;
    // 沒被排到任何主要勤務的人（例如人力有剩）也一起幫忙
    return true;
  }

  /**
   * 某人某一餐的勤務清單（回傳短標籤陣列，例如 ["廚餘","包便當"]）
   */
  function mealDutyLabels(mealData, memberId) {
    const short = window.App.State.DUTY_SHORT_LABELS;
    if (isAbsent(mealData, memberId)) return [short.shopping];
    const labels = [];

    PRIMARY_DUTIES.forEach((duty) => {
      if (has(mealData, duty, memberId)) labels.push(short[duty]);
    });

    if (has(mealData, "lunchbag", memberId)) {
      labels.push(short.carryVehicle, short.carryUpstairs);
    } else if (helpsWithLunchbag(mealData, memberId)) {
      labels.push(short.lunchbagHelp);
    }

    if (has(mealData, "cleanup", memberId)) labels.push(short.cleanup);

    return labels;
  }

  /**
   * 某人今天的全日勤務（洗衣籃）。
   * 採買不列在這裡，因為早餐、中餐那兩格已經標了「採買」，重複寫反而囉唆。
   */
  function dailyDutyLabels(daily, memberId) {
    const short = window.App.State.DUTY_SHORT_LABELS;
    const labels = [];
    if (((daily && daily.laundryUp) || []).includes(memberId)) labels.push(short.laundryUp);
    if (((daily && daily.laundryDown) || []).includes(memberId)) labels.push(short.laundryDown);
    return labels;
  }

  /**
   * 某一餐「幫忙包便當」的人有哪些（給班表檢視顯示用）
   */
  function lunchbagHelpers(mealData, activeMembers) {
    return activeMembers.filter((m) => helpsWithLunchbag(mealData, m.id)).map((m) => m.id);
  }

  window.App.DutyView = { mealDutyLabels, dailyDutyLabels, helpsWithLunchbag, lunchbagHelpers, isAbsent };
})();
