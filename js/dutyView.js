/*
 * 把班表資料轉成「某個人某一餐要做什麼」的共用邏輯，班表檢視與文字班表都用這個，
 * 避免兩邊各寫一份導致顯示不一致。
 *
 * 一餐分兩段：先是「打菜流程」（打飯打菜的當下），打完之後才是「勤務」。
 *
 * 重點規則（使用者確認過）：
 *   - 抬便當上車、上樓：除了固定送便當的兩位以外，當餐在場的人全部一起（洗碗的人也要）。
 *   - 那一餐洗碗的人，那一餐不排撤收。
 *   - 採買的人早餐、中餐不在，兩段都不算。
 */
window.App = window.App || {};

(function () {
  "use strict";

  // 個人分工的顯示順序：先講他被排到的主要勤務，再接幫忙的事，最後才是撤收
  const PRIMARY_DUTIES = ["dishwash", "foodwaste", "wipe", "floor", "delivery"];

  function has(mealData, dutyKey, memberId) {
    return ((mealData && mealData[dutyKey]) || []).includes(memberId);
  }

  /** 這一餐這個人去採買了，不在 */
  function isAbsent(mealData, memberId) {
    return has(mealData, "absent", memberId);
  }

  /** 這一餐這個人已經離營（退伍當天的晚餐） */
  function hasDeparted(mealData, memberId) {
    return has(mealData, "departed", memberId);
  }

  /** 某人某一餐在打菜流程裡做什麼（回傳短標籤陣列） */
  function mealServingLabels(mealData, memberId) {
    const St = window.App.State;
    if (hasDeparted(mealData, memberId)) return [St.DUTY_SHORT_LABELS.departed];
    if (isAbsent(mealData, memberId)) return [St.DUTY_SHORT_LABELS.shopping];
    const serving = (mealData && mealData.serving) || {};
    const labels = [];
    St.SERVING_ROWS.forEach((role) => {
      if ((serving[role] || []).includes(memberId)) labels.push(St.DUTY_SHORT_LABELS[role]);
    });
    return labels;
  }

  /**
   * 某人某一餐打完菜之後的勤務清單（回傳短標籤陣列，例如 ["廚餘","抬上車/上樓","撤收"]）
   */
  function mealDutyLabels(mealData, memberId) {
    const short = window.App.State.DUTY_SHORT_LABELS;
    if (hasDeparted(mealData, memberId)) return [short.departed];
    if (isAbsent(mealData, memberId)) return [short.shopping];

    const labels = [];
    PRIMARY_DUTIES.forEach((duty) => {
      if (has(mealData, duty, memberId)) labels.push(short[duty]);
    });

    if (has(mealData, "carryVehicle", memberId)) labels.push(short.carry);
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
   * 依「顯示用的欄位名稱」取出那一餐的人員清單。
   * carry 與 lunchbagHelp 是顯示用的合併欄位，不是班表資料裡真正的欄位。
   */
  function mealRowIds(mealData, rowKey) {
    if (rowKey === "carry") return (mealData && mealData.carryVehicle) || [];
    return (mealData && mealData[rowKey]) || [];
  }

  /** 打菜流程某一列的人員 */
  function servingRowIds(mealData, rowKey) {
    return ((mealData && mealData.serving) || {})[rowKey] || [];
  }

  /*
   * 有些欄位與其列出十幾個名字，不如直接寫規則好讀。
   * 抬便當上車、上樓就是「送便當的兩位以外全上」，送便當名單就在同一張表上面。
   */
  const ROW_DESCRIPTIONS = { carry: "除了送便當的兩位，其餘全員" };

  function mealRowDescription(rowKey) {
    return ROW_DESCRIPTIONS[rowKey] || null;
  }

  window.App.DutyView = {
    mealDutyLabels,
    mealServingLabels,
    dailyDutyLabels,
    mealRowIds,
    servingRowIds,
    mealRowDescription,
    isAbsent,
    hasDeparted,
  };
})();
