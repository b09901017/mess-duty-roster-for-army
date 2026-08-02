/*
 * 把班表資料轉成「某個人某一餐要做什麼」的共用邏輯，班表檢視與文字班表都用這個，
 * 避免兩邊各寫一份導致顯示不一致。
 *
 * 重點規則（使用者確認過）：
 *   - 抬便當上車、上樓：除了洗碗的人以外，當餐在場的人全部一起幫忙（含送便當的兩位）。
 *   - 幫忙包便當：除了洗碗的人以外都要幫忙，但送便當的兩位不用（他們負責送）。
 *   - 採買的人早餐、中餐不在，兩者都不算。
 */
window.App = window.App || {};

(function () {
  "use strict";

  // 個人分工的顯示順序：先講他被排到的主要勤務，再接幫忙的事，最後才是撤收
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
    return true;
  }

  /**
   * 某人某一餐的勤務清單（回傳短標籤陣列，例如 ["廚餘","包便當","抬上車","抬上樓"]）
   */
  function mealDutyLabels(mealData, memberId) {
    const short = window.App.State.DUTY_SHORT_LABELS;
    if (isAbsent(mealData, memberId)) return [short.shopping];

    const labels = [];
    PRIMARY_DUTIES.forEach((duty) => {
      if (has(mealData, duty, memberId)) labels.push(short[duty]);
    });

    if (helpsWithLunchbag(mealData, memberId)) labels.push(short.lunchbagHelp);
    if (has(mealData, "carryVehicle", memberId)) labels.push(short.carryVehicle, short.carryUpstairs);
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

  /** 某一餐「幫忙包便當」的人有哪些 */
  function lunchbagHelpers(mealData, activeMembers) {
    return activeMembers.filter((m) => helpsWithLunchbag(mealData, m.id)).map((m) => m.id);
  }

  /**
   * 依「顯示用的欄位名稱」取出那一餐的人員清單。
   * carry 與 lunchbagHelp 是顯示用的合併欄位，不是班表資料裡真正的欄位。
   */
  function mealRowIds(mealData, rowKey, activeMembers) {
    if (rowKey === "carry") return (mealData && mealData.carryVehicle) || [];
    if (rowKey === "lunchbagHelp") return lunchbagHelpers(mealData, activeMembers);
    return (mealData && mealData[rowKey]) || [];
  }

  window.App.DutyView = {
    mealDutyLabels,
    dailyDutyLabels,
    helpsWithLunchbag,
    lunchbagHelpers,
    mealRowIds,
    isAbsent,
  };
})();
