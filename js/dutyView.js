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
   * 某人某一餐打完菜之後的勤務清單（回傳短標籤陣列，例如 ["洗碗","抬上樓","撤收"]）
   */
  function mealDutyLabels(mealData, memberId) {
    const short = window.App.State.DUTY_SHORT_LABELS;
    if (hasDeparted(mealData, memberId)) return [short.departed];
    if (isAbsent(mealData, memberId)) return [short.shopping];

    const labels = [];
    PRIMARY_DUTIES.forEach((duty) => {
      if (has(mealData, duty, memberId)) labels.push(short[duty]);
    });

    /*
     * 抬便當只列「抬上樓」。
     * 抬下車與抬上車是全員一起、隨時到隨時搬，每個人都寫一次只是洗版；
     * 抬上樓則是集合之後分出來的那一批（倒廚餘以外的所有人），
     * 「今天我是去倒廚餘還是抬上樓」正是個人分工要回答的問題，所以要列。
     */
    if (has(mealData, "carryUpstairs", memberId)) labels.push(short.carryUpstairs);
    if (has(mealData, "cleanup", memberId)) labels.push(short.cleanup);

    return labels;
  }

  /**
   * 某人今天的全日勤務（掃廁所、換水、洗衣籃）。
   * 採買不列在這裡，因為早餐、中餐那兩格已經標了「採買」，重複寫反而囉唆。
   */
  function dailyDutyLabels(daily, memberId, schedule) {
    const St = window.App.State;
    const short = St.DUTY_SHORT_LABELS;
    const labels = [];
    if (((daily && daily.toilet) || []).includes(memberId)) labels.push(short.toilet);
    if (((daily && daily.water) || []).includes(memberId)) labels.push(short.water);
    if (((daily && daily.laundryUp) || []).includes(memberId)) labels.push(short.laundryUp);
    if (((daily && daily.laundryDown) || []).includes(memberId)) labels.push(short.laundryDown);
    /*
     * 撤收現在也列在全日勤務裡。資料在 meals[meal].cleanup，所以要把整份班表傳進來；
     * 沒傳的話就跳過（舊的呼叫端還是能用）。
     */
    if (schedule) {
      Object.keys(St.CLEANUP_ROW_MEAL).forEach((rowKey) => {
        const meal = St.CLEANUP_ROW_MEAL[rowKey];
        const ids = ((schedule.meals || {})[meal] || {}).cleanup || [];
        if (ids.includes(memberId)) labels.push(short[rowKey]);
      });
    }
    return labels;
  }

  /** 依「顯示用的欄位名稱」取出那一餐的人員清單 */
  function mealRowIds(mealData, rowKey) {
    return (mealData && mealData[rowKey]) || [];
  }

  /** 打菜流程某一列的人員 */
  function servingRowIds(mealData, rowKey) {
    return ((mealData && mealData.serving) || {})[rowKey] || [];
  }

  /*
   * 有些欄位與其列出十幾個名字，不如直接寫規則好讀。
   *   抬下車／抬上車  隨時到、隨時搬，當餐在場的人全部一起，永遠不列名字
   *   抬上樓          集合之後分出來的那一批（倒廚餘以外的人），**要列名字**，
   *                   所以回 null 讓上層去印名單
   */
  function mealRowDescription(rowKey, mealData) {
    if (rowKey === "carryDown" || rowKey === "carryVehicle") {
      return "當餐在場的人全部一起（含送便當的兩位）";
    }
    return null;
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
