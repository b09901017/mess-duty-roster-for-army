/*
 * 換水：早餐撤收完才做的事，一次 5 個人。
 *
 * 規則（使用者指定）：
 *   - 只有早餐有。
 *   - 261 / 263 / 旅部連照號碼輪，**招員不排**（名冊上勾「免排換水」）。
 *   - 不能跟當天早上撤收的人重複——撤收完才換水，同一個人做兩件事太累。
 *
 * 跟洗碗一樣是一條隊伍照號碼往下輪，進度記「上一組最後一位是誰」，
 * 這樣有人退伍時不會跳過還沒輪到的人。
 */
window.App = window.App || {};

(function () {
  "use strict";

  /** 誰要輪換水：扣掉勾了「免排換水」的招員 */
  function waterPool(dayMembers) {
    return dayMembers.filter((m) => !m.skipWater).slice().sort(window.App.State.rosterOrder);
  }

  /**
   * @param {object} waterState - { lastAssignedId: string|null }
   * @param {object[]} dayMembers - 當天有出現過的人
   * @param {string[]} excludeIds - 當天早上撤收的人（不重複排）
   * @param {(memberId: string, meal: string) => boolean} [isAvailable]
   * @returns {{ids: string[], newWaterState: object, warnings: string[]}}
   */
  function computeWaterDay(waterState, dayMembers, excludeIds, isAvailable) {
    const St = window.App.State;
    const available = isAvailable || (() => true);
    const warnings = [];
    const meal = St.WATER_MEAL;
    const need = St.WATER_COUNT;

    const queue = waterPool(dayMembers);
    if (!queue.length) return { ids: [], newWaterState: waterState || { lastAssignedId: null }, warnings };

    const excluded = new Set(excludeIds || []);
    const canDo = (m) => available(m.id, meal) && !excluded.has(m.id);

    // 從「上一組最後一位」的下一個開始
    let cursor = 0;
    if (waterState && waterState.lastAssignedId) {
      const idx = queue.findIndex((m) => m.id === waterState.lastAssignedId);
      if (idx >= 0) cursor = (idx + 1) % queue.length;
    }

    const picked = [];
    let steps = 0;
    const maxSteps = queue.length * 2;
    while (picked.length < need && steps < maxSteps) {
      const member = queue[cursor];
      cursor = (cursor + 1) % queue.length;
      steps++;
      if (!canDo(member)) continue;
      if (picked.indexOf(member.id) !== -1) continue;
      picked.push(member.id);
    }

    if (picked.length < need) {
      warnings.push(
        `換水需要 ${need} 人，但扣掉早上撤收的人與免排換水的招員之後只湊到 ${picked.length} 人。`
      );
    }

    return {
      ids: picked,
      newWaterState: { lastAssignedId: picked.length ? picked[picked.length - 1] : (waterState || {}).lastAssignedId || null },
      warnings,
    };
  }

  window.App.WaterSchedule = { computeWaterDay, waterPool };
})();
