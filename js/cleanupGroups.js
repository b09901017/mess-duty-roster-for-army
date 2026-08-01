/* 撤收：固定3組，組別本身每天輪早/中/晚，3天一循環 */
window.App = window.App || {};

(function () {
  "use strict";

  const MEAL_KEYS = window.App.State.MEAL_KEYS;
  const COHORT_ORDER = ["261", "263"];

  function orderedIds(members) {
    return members
      .slice()
      .sort((a, b) => {
        const ca = COHORT_ORDER.indexOf(a.cohort);
        const cb = COHORT_ORDER.indexOf(b.cohort);
        if (ca !== cb) return ca - cb;
        return a.seq - b.seq;
      })
      .map((m) => m.id);
  }

  function needsRegroup(cleanupGroups, activeMembers) {
    const currentIds = new Set(orderedIds(activeMembers));
    const groupedIds = new Set(cleanupGroups.groupedMemberIds || []);
    if (currentIds.size !== groupedIds.size) return true;
    for (const id of currentIds) {
      if (!groupedIds.has(id)) return true;
    }
    return false;
  }

  function regroup(activeMembers) {
    const ids = orderedIds(activeMembers);
    const n = ids.length;
    const base = Math.floor(n / 3);
    const remainder = n % 3;
    const sizes = [base + (remainder > 0 ? 1 : 0), base + (remainder > 1 ? 1 : 0), base];

    const groups = [[], [], []];
    let cursor = 0;
    for (let g = 0; g < 3; g++) {
      groups[g] = ids.slice(cursor, cursor + sizes[g]);
      cursor += sizes[g];
    }

    return {
      groups,
      rotationOffset: 0,
      groupedMemberIds: ids,
    };
  }

  /**
   * @param {object} cleanupGroups
   * @returns {{assignments: {breakfast:string[],lunch:string[],dinner:string[]}, newCleanupGroups: object}}
   */
  function computeCleanupDay(cleanupGroups) {
    const assignments = {};
    MEAL_KEYS.forEach((meal, i) => {
      const groupIndex = (i + cleanupGroups.rotationOffset) % 3;
      assignments[meal] = (cleanupGroups.groups[groupIndex] || []).slice();
    });

    const newCleanupGroups = Object.assign({}, cleanupGroups, {
      rotationOffset: (cleanupGroups.rotationOffset + 1) % 3,
    });

    return { assignments, newCleanupGroups };
  }

  window.App.CleanupGroups = { needsRegroup, regroup, computeCleanupDay, orderedIds };
})();
