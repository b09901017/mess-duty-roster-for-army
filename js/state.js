/* 資料模型、localStorage 讀寫、匯出/匯入、初始種子資料 */
window.App = window.App || {};

(function () {
  "use strict";

  const STORAGE_KEY = "mess-duty-roster-v2";

  const DUTY_KEYS = ["dishwash", "foodwaste", "lunchbag", "wipe", "floor", "cleanup", "shopping"];

  const MEAL_KEYS = ["breakfast", "lunch", "dinner"];
  const MEAL_LABELS = { breakfast: "早餐", lunch: "中餐", dinner: "晚餐" };

  const DUTY_LABELS = {
    dishwash: "洗碗",
    foodwaste: "廚餘",
    lunchbag: "包便當袋子",
    wipe: "擦桌子",
    floor: "清地板收垃圾",
    delivery: "送便當",
    cleanup: "撤收",
    shopping: "採買",
  };

  const DUTY_ICONS = {
    dishwash: "🍽️",
    foodwaste: "🗑️",
    lunchbag: "🍱",
    wipe: "🧽",
    floor: "🧹",
    delivery: "🛵",
    cleanup: "🧺",
    shopping: "🛒",
  };

  function emptyDutyCount() {
    const c = {};
    DUTY_KEYS.forEach((k) => (c[k] = 0));
    return c;
  }

  function seedMembers() {
    const members = [];
    for (let i = 1; i <= 8; i++) {
      members.push({
        id: `261-${i}`,
        name: `261-${i}號`,
        cohort: "261",
        seq: i,
        dischargeDate: null,
        active: true,
        fixedRole: i === 7 || i === 8 ? "delivery" : null,
      });
    }
    for (let i = 1; i <= 10; i++) {
      members.push({
        id: `263-${i}`,
        name: `263-${i}號`,
        cohort: "263",
        seq: i,
        dischargeDate: null,
        active: true,
        fixedRole: null,
      });
    }
    return members;
  }

  function defaultDutySizeTable() {
    // 依使用者給的預設縮減順序：包便當-1,-1 → 廚餘-1 → 洗碗-1 → 包便當-1 → 廚餘-1
    return [
      { minActiveCount: 18, dishwash: 6, foodwaste: 4, lunchbag: 4, wipe: 1, floor: 1 },
      { minActiveCount: 17, dishwash: 6, foodwaste: 4, lunchbag: 3, wipe: 1, floor: 1 },
      { minActiveCount: 16, dishwash: 6, foodwaste: 4, lunchbag: 2, wipe: 1, floor: 1 },
      { minActiveCount: 15, dishwash: 6, foodwaste: 3, lunchbag: 2, wipe: 1, floor: 1 },
      { minActiveCount: 14, dishwash: 5, foodwaste: 3, lunchbag: 2, wipe: 1, floor: 1 },
      { minActiveCount: 13, dishwash: 5, foodwaste: 3, lunchbag: 1, wipe: 1, floor: 1 },
      { minActiveCount: 12, dishwash: 5, foodwaste: 2, lunchbag: 1, wipe: 1, floor: 1 },
    ];
  }

  function defaultState() {
    const members = seedMembers();
    const dutyCounts = {};
    members.forEach((m) => (dutyCounts[m.id] = emptyDutyCount()));

    return {
      version: 2,
      members,
      dutyCounts,
      washState: {
        primaryPointer: { 261: 0, 263: 0 },
        nextPrimaryCohort: "261",
      },
      cleanupGroups: {
        groups: [],
        rotationOffset: 0,
        groupedMemberIds: [],
      },
      dutySizeTable: defaultDutySizeTable(),
      schedules: {},
      shoppingLog: [],
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return migrate(parsed);
      }
    } catch (err) {
      console.warn("無法讀取儲存的資料，將使用預設值。", err);
    }
    return defaultState();
  }

  function migrate(parsed) {
    const base = defaultState();
    return Object.assign({}, base, parsed, {
      washState: Object.assign({}, base.washState, parsed.washState),
      cleanupGroups: Object.assign({}, base.cleanupGroups, parsed.cleanupGroups),
    });
  }

  let state = load();

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function getState() {
    return state;
  }

  function replaceState(newState) {
    state = newState;
    save();
  }

  function activeMembers() {
    return state.members.filter((m) => m.active);
  }

  function activeMembersByCohort(cohort) {
    return activeMembers()
      .filter((m) => m.cohort === cohort)
      .sort((a, b) => a.seq - b.seq);
  }

  function memberById(id) {
    return state.members.find((m) => m.id === id);
  }

  function exportJson() {
    return JSON.stringify(state, null, 2);
  }

  function importJson(jsonText) {
    const parsed = JSON.parse(jsonText);
    replaceState(migrate(parsed));
  }

  window.App.State = {
    STORAGE_KEY,
    DUTY_KEYS,
    MEAL_KEYS,
    MEAL_LABELS,
    DUTY_LABELS,
    DUTY_ICONS,
    emptyDutyCount,
    defaultState,
    defaultDutySizeTable,
    get: getState,
    save,
    replaceState,
    activeMembers,
    activeMembersByCohort,
    memberById,
    exportJson,
    importJson,
  };
})();
