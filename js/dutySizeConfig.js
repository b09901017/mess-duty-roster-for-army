/* 人數縮減對照表：依現有人數查詢各勤務需求人數 */
window.App = window.App || {};

(function () {
  "use strict";

  function lookupDutySize(table, activeCount) {
    const sorted = table.slice().sort((a, b) => b.minActiveCount - a.minActiveCount);
    const match = sorted.find((row) => activeCount >= row.minActiveCount);
    return match ? Object.assign({}, match) : null;
  }

  function sortTable(table) {
    return table.slice().sort((a, b) => b.minActiveCount - a.minActiveCount);
  }

  window.App.DutySizeConfig = { lookupDutySize, sortTable };
})();
