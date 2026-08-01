/* 廚餘/包便當袋子/清地板收垃圾/擦桌子 的公平分配：該項勤務累計次數少者優先，同次數依 261→263、序號排序 */
window.App = window.App || {};

(function () {
  "use strict";

  const COHORT_ORDER = ["261", "263"];
  const DUTY_ORDER = ["foodwaste", "lunchbag", "floor", "wipe"];

  function stableCompare(a, b) {
    const ca = COHORT_ORDER.indexOf(a.cohort);
    const cb = COHORT_ORDER.indexOf(b.cohort);
    if (ca !== cb) return ca - cb;
    return a.seq - b.seq;
  }

  /**
   * @param {object[]} pool - 該餐可用人員（已排除當餐洗碗、固定送便當）
   * @param {object} dutyCounts - { [memberId]: { foodwaste, lunchbag, wipe, floor, ... } }
   * @param {{foodwaste:number, lunchbag:number, wipe:number, floor:number}} sizeConfig
   * @returns {{foodwaste:string[], lunchbag:string[], floor:string[], wipe:string[]}}
   */
  function assignOtherDuties(pool, dutyCounts, sizeConfig) {
    let remaining = pool.slice();
    const result = {};

    DUTY_ORDER.forEach((dutyKey) => {
      const need = sizeConfig[dutyKey] || 0;
      const sorted = remaining.slice().sort((a, b) => {
        const countA = (dutyCounts[a.id] && dutyCounts[a.id][dutyKey]) || 0;
        const countB = (dutyCounts[b.id] && dutyCounts[b.id][dutyKey]) || 0;
        if (countA !== countB) return countA - countB;
        return stableCompare(a, b);
      });
      const chosen = sorted.slice(0, need);
      result[dutyKey] = chosen.map((m) => m.id);
      const chosenIds = new Set(chosen.map((m) => m.id));
      remaining = remaining.filter((m) => !chosenIds.has(m.id));
    });

    return result;
  }

  window.App.OtherDuties = { assignOtherDuties, stableCompare, DUTY_ORDER };
})();
