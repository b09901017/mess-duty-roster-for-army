/*
 * 換水：早餐撤收完才做的事，一次 5 個人。
 *
 * 規則（使用者指定）：
 *   - 只有早餐有。
 *   - 261 / 263 / 旅部連照號碼輪，**招員不排**（名冊上勾「免排換水」）。
 *   - 不能跟當天早上撤收的人重複——撤收完才換水，同一個人做兩件事太累。
 *   - **不能有人連兩天**（使用者指定）。
 *
 * 跟洗碗一樣是一條隊伍照號碼往下輪，進度記「上一組最後一位是誰」，
 * 這樣有人退伍時不會跳過還沒輪到的人。
 *
 * ── 為什麼還要另外記「上一個排班日是誰換的」──────────────────
 * 光靠游標往下走，正常情況本來就不會連兩天（15 個人輪、一天 5 個，三天才繞一圈）。
 * 但「早上撤收的人不排」會把人跳掉，跳得夠多時游標會繞回去踩到昨天那批。
 * 所以昨天換過水的人直接擋掉，湊不滿才放寬並跳警告——寧可有人連兩天，
 * 也不要那天沒人換水。
 */
window.App = window.App || {};

(function () {
  "use strict";

  /** 誰要輪換水：扣掉勾了「免排換水」的招員 */
  function waterPool(dayMembers) {
    return dayMembers.filter((m) => !m.skipWater).slice().sort(window.App.State.rosterOrder);
  }

  /**
   * 換完水之後的新進度。抽成函式是因為「鎖定的日子」也要用同一套推進方式
   * （見 scheduleEngine），不然隔天會從隊伍頭重來、跟公布版接不起來。
   */
  function advanceWaterState(prevState, ids) {
    const prev = prevState || {};
    return {
      lastAssignedId: ids.length ? ids[ids.length - 1] : prev.lastAssignedId || null,
      lastIds: ids.slice(),
    };
  }

  /**
   * @param {object} waterState - { lastAssignedId: string|null, lastIds: string[] }
   * @param {object[]} dayMembers - 當天有出現過的人
   * @param {string[]} excludeIds - 當天早上撤收的人（不重複排）
   * @param {(memberId: string, meal: string) => boolean} [isAvailable]
   * @param {string} [dateStr] - 用來判斷「不能連兩天」這條生效了沒（見 WATER_RULES_FROM）
   * @returns {{ids: string[], newWaterState: object, warnings: string[]}}
   */
  function computeWaterDay(waterState, dayMembers, excludeIds, isAvailable, dateStr) {
    const St = window.App.State;
    const available = isAvailable || (() => true);
    const warnings = [];
    const meal = St.WATER_MEAL;
    const need = St.WATER_COUNT;
    const state = waterState || { lastAssignedId: null, lastIds: [] };
    // 8/7 早上已經換過水了，那天照舊；8/8 起才開始擋連兩天
    const noRepeat = !dateStr || dateStr >= St.WATER_RULES_FROM;

    const queue = waterPool(dayMembers);
    if (!queue.length) return { ids: [], newWaterState: advanceWaterState(state, []), warnings };

    const excluded = new Set(excludeIds || []);
    // 上一個排班日換水的那五位，今天不排
    const yesterday = new Set(state.lastIds || []);
    const nameOf = (id) => {
      const m = dayMembers.find((x) => x.id === id);
      return m ? m.name : id;
    };

    // 從「上一組最後一位」的下一個開始
    let startCursor = 0;
    if (state.lastAssignedId) {
      const idx = queue.findIndex((m) => m.id === state.lastAssignedId);
      if (idx >= 0) startCursor = (idx + 1) % queue.length;
    }

    /** 從游標往下挑人。allowYesterday=false 時昨天換過水的人跳過。 */
    function pick(allowYesterday) {
      const picked = [];
      let cursor = startCursor;
      let steps = 0;
      const maxSteps = queue.length * 2;
      while (picked.length < need && steps < maxSteps) {
        const member = queue[cursor];
        cursor = (cursor + 1) % queue.length;
        steps++;
        if (!available(member.id, meal)) continue;
        if (excluded.has(member.id)) continue;
        if (!allowYesterday && yesterday.has(member.id)) continue;
        if (picked.indexOf(member.id) !== -1) continue;
        picked.push(member.id);
      }
      return picked;
    }

    let picked = pick(!noRepeat);
    /*
     * 擋掉昨天那批之後湊不滿，才放寬這條——那天沒人換水比有人連兩天嚴重。
     * 放寬了一定要講出來，不然使用者會以為規則沒生效。
     */
    if (noRepeat && picked.length < need) {
      const relaxed = pick(true);
      if (relaxed.length > picked.length) {
        const repeats = relaxed.filter((id) => yesterday.has(id));
        if (repeats.length) {
          warnings.push(
            `換水湊不滿 ${need} 人，${repeats.map(nameOf).join("、")} 昨天也換過水，只好連兩天。` +
              `（扣掉早上撤收的人與免排換水的招員之後真的沒人了，可以手動換一位。）`
          );
        }
        picked = relaxed;
      }
    }

    if (picked.length < need) {
      warnings.push(
        `換水需要 ${need} 人，但扣掉早上撤收的人與免排換水的招員之後只湊到 ${picked.length} 人。`
      );
    }

    return { ids: picked, newWaterState: advanceWaterState(state, picked), warnings };
  }

  window.App.WaterSchedule = { computeWaterDay, waterPool, advanceWaterState };
})();
