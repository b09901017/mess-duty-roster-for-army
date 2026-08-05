/*
 * 採買。
 *
 * 沒有固定星期、也沒有固定幾個人——哪天要採買、派誰去，都是當下才決定的，
 * 所以改成「按日期指定名單」（state.shoppingByDate），一天可以 0 人、1 人或好幾人。
 *
 * 採買的人當天**早餐、中餐完全不排**（打菜、勤務、撤收都不排），晚餐才歸隊。
 * 排班引擎會把他們那兩餐當作不在場，所以人數、洗碗佇列、撤收名額都會自動跟著少，
 * 也不會被排到早上的換水。
 */
window.App = window.App || {};

(function () {
  "use strict";

  // JS Date.getDay()：0=週日, 1=週一 … 6=週六
  const WEEKDAY_KEYS = [0, 1, 2, 3, 4, 5, 6];
  const WEEKDAY_LABELS = {
    0: "週日",
    1: "週一",
    2: "週二",
    3: "週三",
    4: "週四",
    5: "週五",
    6: "週六",
  };

  /** 採買的人這兩餐不在營區 */
  const OFF_MEALS = ["breakfast", "lunch"];

  function weekdayOf(dateStr) {
    return new Date(dateStr + "T00:00:00").getDay();
  }

  /**
   * 這一天有誰要去採買。
   * @param {string} dateStr
   * @param {object[]} members
   * @param {object} shoppingByDate - { "2026-08-07": ["261-3", "263-5"] }
   * @returns {{ids: string[], warnings: string[]}}
   */
  function shoppersFor(dateStr, members, shoppingByDate) {
    const listed = ((shoppingByDate || {})[dateStr] || []).slice();
    const warnings = [];
    const ids = [];

    listed.forEach((id) => {
      const member = members.find((m) => m.id === id);
      if (!member) {
        warnings.push(`採買名單裡有一位已經不在名冊中（${id}），請到「採買」分頁重新指定。`);
        return;
      }
      // 採買是一早出門，用「早餐在不在」判斷；退伍當天早上還在，可以採買
      if (!window.App.State.isActiveOn(member, dateStr, "breakfast")) {
        warnings.push(`${member.name} 這天不在打飯班，沒辦法採買，請到「採買」分頁改指定其他人。`);
        return;
      }
      if (ids.indexOf(id) === -1) ids.push(id);
    });

    return { ids, warnings };
  }

  window.App.ShoppingRoster = { WEEKDAY_KEYS, WEEKDAY_LABELS, weekdayOf, shoppersFor, OFF_MEALS };
})();
