/* 資料模型、localStorage 讀寫、匯出/匯入、初始種子資料 */
window.App = window.App || {};

(function () {
  "use strict";

  const STORAGE_KEY = "mess-duty-roster-v4";

  const DUTY_PERIOD_START = "2026-08-01";
  const DUTY_PERIOD_END = "2026-08-14";

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

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function seedMembers() {
    const r261 = [
      ["李愷宸", null],
      ["江偉綸", "2026-08-04"],
      ["陳柏翰", "2026-08-14"],
      ["鄧旭辰", "2026-08-08"],
      ["廖翊滕", "2026-08-10"],
      ["陳俊穎", "2026-08-13"],
      ["林柏宇", "2026-08-14"],
      ["林崇浩", "2026-08-13"],
    ];
    const r263 = [
      "陳東霖",
      "呂胤玄",
      "林柏翰",
      "曹月輝",
      "黃聖為",
      "李易宸",
      "顏允彣",
      "呂承鴻",
      "盧明煬",
      "田權楨",
    ];

    const members = [];
    r261.forEach(([name, dischargeDate], idx) => {
      const seq = idx + 1;
      members.push({
        id: `261-${seq}`,
        name,
        cohort: "261",
        seq,
        dischargeDate: dischargeDate,
        fixedRole: seq === 7 || seq === 8 ? "delivery" : null,
      });
    });
    r263.forEach((name, idx) => {
      const seq = idx + 1;
      members.push({
        id: `263-${seq}`,
        name,
        cohort: "263",
        seq,
        dischargeDate: null,
        fixedRole: null,
      });
    });
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

  function defaultWashState() {
    return { primaryPointer: { 261: 0, 263: 0 }, nextPrimaryCohort: "261" };
  }

  function defaultCleanupGroups() {
    return { groups: [], rotationOffset: 0, groupedMemberIds: [] };
  }

  function defaultState() {
    const members = seedMembers();
    const dutyCounts = {};
    members.forEach((m) => (dutyCounts[m.id] = emptyDutyCount()));

    return {
      version: 4,
      members,
      dutySizeTable: defaultDutySizeTable(),

      // ── 來源資料（真正被使用者決定的東西）────────────────────────────
      // 已確定紀錄的日期，以及採買登記。整個系統的班表都是由這兩者「重播」推導出來的，
      // 所以同一天不管重排幾次，只要名單與設定沒變，結果一定一樣。
      committedDates: [],
      shoppingLog: [],

      // ── 推導出來的快取（由 ScheduleEngine.rebuildAll 重算，不要手動改）──
      dutyCounts,
      washState: defaultWashState(),
      cleanupGroups: defaultCleanupGroups(),
      schedules: {},
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

  const saveListeners = [];
  let suppressListeners = false;

  /** 註冊「資料存檔後」的回呼，雲端同步用它來自動上傳 */
  function onSave(fn) {
    saveListeners.push(fn);
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (!suppressListeners) {
      saveListeners.forEach((fn) => {
        try {
          fn(state);
        } catch (err) {
          console.warn("save listener 發生錯誤", err);
        }
      });
    }
  }

  /** 套用來自雲端的資料時用這個，避免又觸發一次上傳造成無限迴圈 */
  function saveWithoutNotifying(fn) {
    suppressListeners = true;
    try {
      fn();
    } finally {
      suppressListeners = false;
    }
  }

  function getState() {
    return state;
  }

  function replaceState(newState) {
    state = newState;
    save();
  }

  /** 該員在指定日期是否仍在役（退伍日當天起視為不在役） */
  function isActiveOn(member, dateStr) {
    return !member.dischargeDate || dateStr < member.dischargeDate;
  }

  function activeMembersOn(dateStr) {
    return state.members.filter((m) => isActiveOn(m, dateStr));
  }

  function activeMembersByCohortOn(cohort, dateStr) {
    return activeMembersOn(dateStr)
      .filter((m) => m.cohort === cohort)
      .sort((a, b) => a.seq - b.seq);
  }

  function activeMembers() {
    return activeMembersOn(todayStr());
  }

  function activeMembersByCohort(cohort) {
    return activeMembersByCohortOn(cohort, todayStr());
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

  /** 重置所有勤務紀錄（次數、班表、洗碗指標、撤收分組、採買紀錄），保留人員名單 */
  function resetRecords() {
    state.committedDates = [];
    state.shoppingLog = [];
    clearDerived();
    save();
  }

  /** 清掉所有推導出來的快取，回到「什麼都還沒排」的起點 */
  function clearDerived() {
    const dutyCounts = {};
    state.members.forEach((m) => (dutyCounts[m.id] = emptyDutyCount()));
    state.dutyCounts = dutyCounts;
    state.washState = defaultWashState();
    state.cleanupGroups = defaultCleanupGroups();
    state.schedules = {};
  }

  window.App.State = {
    STORAGE_KEY,
    DUTY_PERIOD_START,
    DUTY_PERIOD_END,
    DUTY_KEYS,
    MEAL_KEYS,
    MEAL_LABELS,
    DUTY_LABELS,
    DUTY_ICONS,
    emptyDutyCount,
    defaultState,
    defaultDutySizeTable,
    todayStr,
    get: getState,
    save,
    replaceState,
    isActiveOn,
    activeMembers,
    activeMembersOn,
    activeMembersByCohort,
    activeMembersByCohortOn,
    memberById,
    exportJson,
    importJson,
    resetRecords,
    clearDerived,
    defaultWashState,
    defaultCleanupGroups,
    onSave,
    saveWithoutNotifying,
    migrate,
  };
})();
