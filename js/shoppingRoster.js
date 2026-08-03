/*
 * 採買：固定的星期輪值表（週一～週四各一位），不是臨時抽籤。
 *
 * 採買的人當天早餐、中餐完全不排伙房勤務（含撤收），晚餐才歸隊，
 * 所以那兩餐的包便當袋子會少一個人，人數才對得起來。
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

  function weekdayOf(dateStr) {
    return new Date(dateStr + "T00:00:00").getDay();
  }

  /**
   * 這一天負責採買的人。
   * 超過「採買到期日」之後就不用採買了；若那天輪到的人已經不在，回傳 null 並附上提醒。
   * @returns {{memberId: string|null, warning: string|null}}
   */
  function shopperFor(dateStr, members, roster, shoppingUntil) {
    if (shoppingUntil && dateStr > shoppingUntil) return { memberId: null, warning: null };
    const weekday = weekdayOf(dateStr);
    const memberId = (roster || {})[weekday] || null;
    if (!memberId) return { memberId: null, warning: null };

    const member = members.find((m) => m.id === memberId);
    if (!member) {
      return { memberId: null, warning: `${WEEKDAY_LABELS[weekday]}的採買人員已不在名冊中，請到「採買」分頁重新指定。` };
    }
    if (!window.App.State.isActiveOn(member, dateStr)) {
      return {
        memberId: null,
        warning: `${WEEKDAY_LABELS[weekday]}的採買人員 ${member.name} 已經不在打飯班，這天沒有人採買，請到「採買」分頁改指定其他人。`,
      };
    }
    return { memberId, warning: null };
  }

  window.App.ShoppingRoster = { WEEKDAY_KEYS, WEEKDAY_LABELS, weekdayOf, shopperFor };
})();
