/*
 * 把班表資料轉成「某個人某一餐要做什麼」的共用邏輯，班表檢視與文字班表都用這個，
 * 避免兩邊各寫一份導致顯示不一致。
 *
 * 重點規則（使用者確認過）：
 *   - 抬便當上車、上樓：除了洗碗的人與固定送便當的兩位以外，當餐在場的人全部一起幫忙。
 *   - 幫忙包便當：同樣扣掉洗碗與送便當的人，再扣掉本來就被排到包便當袋子的那幾位。
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

  /** 這一餐這個人去採買了，不在 */
  function isAbsent(mealData, memberId) {
    return has(mealData, "absent", memberId);
  }

  /** 這一餐這個人已經離營（退伍當天的晚餐） */
  function hasDeparted(mealData, memberId) {
    return has(mealData, "departed", memberId);
  }

  /** 這一餐這個人要不要幫忙包便當（洗碗的、送便當的、以及人不在的不用） */
  function helpsWithLunchbag(mealData, memberId) {
    if (isAbsent(mealData, memberId) || hasDeparted(mealData, memberId)) return false;
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
    if (hasDeparted(mealData, memberId)) return [short.departed];
    if (isAbsent(mealData, memberId)) return [short.shopping];

    const labels = [];
    PRIMARY_DUTIES.forEach((duty) => {
      if (has(mealData, duty, memberId)) labels.push(short[duty]);
    });

    if (helpsWithLunchbag(mealData, memberId)) labels.push(short.lunchbagHelp);
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

  /*
   * 有些欄位與其列出十幾個名字，不如直接寫規則好讀。
   * 抬便當上車、上樓就是「洗碗與送便當以外的人全上」，這兩份名單就在同一張表上面，
   * 讀的人自己對照得出來。
   */
  const ROW_DESCRIPTIONS = { carry: "除了洗碗和送便當的人，其餘全員" };

  function mealRowDescription(rowKey) {
    return ROW_DESCRIPTIONS[rowKey] || null;
  }

  window.App.DutyView = {
    mealDutyLabels,
    dailyDutyLabels,
    helpsWithLunchbag,
    lunchbagHelpers,
    mealRowIds,
    mealRowDescription,
    isAbsent,
    hasDeparted,
  };
})();
