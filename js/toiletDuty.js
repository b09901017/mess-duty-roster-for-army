/*
 * 掃廁所（早上9點）。
 *
 * 跟採買一樣不是程式排的——現場爬梯子決定誰去，所以只是「按日期記下來」
 * （state.toiletByDate），排班時原封不動印出來，次數照樣累計。
 *
 * 兩件事會擋下來並提醒：
 *   1. 指定的人那天早上不在營（退伍日填錯，或根本還沒報到）
 *   2. 指定的人那天要去採買——採買是一早出門、中午才回來，9 點人不在營區
 *
 * 掃廁所本身不影響其他勤務的人數：9 點已經是早餐收完之後的事，
 * 那個人早餐照排、中餐晚餐也照排。
 */
window.App = window.App || {};

(function () {
  "use strict";

  /**
   * 這一天誰掃廁所。
   * @param {string} dateStr
   * @param {object[]} members
   * @param {object} toiletByDate - { "2026-08-06": ["261-3"] }
   * @param {Set<string>} shopperIds - 那天去採買的人（9 點不在營區）
   * @returns {{ids: string[], warnings: string[]}}
   */
  function toiletFor(dateStr, members, toiletByDate, shopperIds) {
    const listed = ((toiletByDate || {})[dateStr] || []).slice();
    const warnings = [];
    const ids = [];

    listed.forEach((id) => {
      const member = members.find((m) => m.id === id);
      if (!member) {
        warnings.push(`掃廁所名單裡有一位已經不在名冊中（${id}），請重新指定。`);
        return;
      }
      // 早上9點的事，用「早餐在不在」判斷；退伍當天早上還在，可以掃
      if (!window.App.State.isActiveOn(member, dateStr, "breakfast")) {
        warnings.push(`${member.name} 這天早上不在打飯班，沒辦法掃廁所，請改指定其他人。`);
        return;
      }
      if (shopperIds && shopperIds.has(id)) {
        warnings.push(`${member.name} 這天要去採買，9 點還在外面，沒辦法掃廁所，請改指定其他人。`);
        return;
      }
      if (ids.indexOf(id) === -1) ids.push(id);
    });

    return { ids, warnings };
  }

  window.App.ToiletDuty = { toiletFor };
})();
