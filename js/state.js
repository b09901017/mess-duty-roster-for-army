/* 資料模型、localStorage 讀寫、匯出/匯入、初始種子資料 */
window.App = window.App || {};

(function () {
  "use strict";

  const STORAGE_KEY = "mess-duty-roster-v4";

  // 名冊種子每次異動就 +1。舊資料（含從雲端還原的）rosterVersion 對不上時，
  // 會自動換上新名冊，這樣改名冊不用叫使用者清快取，也不會被雲端的舊名冊蓋回去。
  const ROSTER_VERSION = 2;

  const DUTY_PERIOD_START = "2026-08-01";
  const DUTY_PERIOD_END = "2026-08-14";
  // 洗衣籃輪替從這天開始；這天只有睡前抬下去，沒有昨天的籃子要抬上來
  const LAUNDRY_START = "2026-08-02";

  // 會累計次數、出現在公平性總覽的勤務。
  // 抬便當上車/上樓不列入，因為人選跟包便當袋子完全相同，另外統計只會得到一模一樣的圖。
  const DUTY_KEYS = [
    "dishwash",
    "foodwaste",
    "lunchbag",
    "wipe",
    "floor",
    "cleanup",
    // 撤收再按餐別分開記，用來平衡「誰老是被排到早餐撤收」
    "cleanupBreakfast",
    "cleanupLunch",
    "cleanupDinner",
    "laundry",
    "shopping",
  ];

  const MEAL_KEYS = ["breakfast", "lunch", "dinner"];
  const MEAL_LABELS = { breakfast: "早餐", lunch: "中餐", dinner: "晚餐" };

  // 每一餐會列出來的勤務欄位（依顯示順序）。
  // 抬上車與抬上樓是同一批人，顯示時合併成一行，所以這裡只放 carry 這個代表欄位。
  const MEAL_DUTY_ROWS = [
    "dishwash",
    "foodwaste",
    "lunchbag",
    "wipe",
    "floor",
    "delivery",
    "carry",
    "lunchbagHelp",
    "cleanup",
  ];

  // 一天只做一次、不分餐別的勤務
  const DAILY_DUTY_ROWS = ["shopping", "laundryUp", "laundryDown"];

  const DUTY_LABELS = {
    dishwash: "洗碗",
    foodwaste: "廚餘",
    lunchbag: "包便當袋子",
    carryVehicle: "抬便當上車",
    carryUpstairs: "抬便當上樓",
    carry: "抬便當上車、上樓",
    lunchbagHelp: "一起幫忙包便當",
    wipe: "擦桌子",
    floor: "清地板收垃圾",
    delivery: "送便當",
    cleanup: "撤收",
    laundry: "抬洗衣籃",
    laundryUp: "抬洗衣籃上來（下午）",
    laundryDown: "抬洗衣籃下去（睡前）",
    shopping: "採買",
  };

  // 個人分工那邊用短一點的說法，一行才塞得下
  const DUTY_SHORT_LABELS = {
    dishwash: "洗碗",
    foodwaste: "廚餘",
    lunchbag: "包便當",
    lunchbagHelp: "幫忙包便當",
    carry: "抬上車/上樓",
    carryVehicle: "抬上車",
    carryUpstairs: "抬上樓",
    wipe: "擦桌子",
    floor: "清地板",
    delivery: "送便當",
    cleanup: "撤收",
    laundryUp: "抬洗衣籃上來",
    laundryDown: "抬洗衣籃下去",
    shopping: "採買",
    departed: "已離營",
  };

  const DUTY_ICONS = {
    dishwash: "🍽️",
    foodwaste: "🗑️",
    lunchbag: "🍱",
    carry: "🚚",
    carryVehicle: "🚚",
    carryUpstairs: "🏢",
    lunchbagHelp: "🤝",
    wipe: "🧽",
    floor: "🧹",
    delivery: "🛵",
    cleanup: "📦",
    laundry: "🧺",
    laundryUp: "🧺",
    laundryDown: "🧺",
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

  // 2026/08/04 這天有一波人員異動：三位離開、261 加入五位新人。
  // 新人 joinDate 設在 8/4，離開的人 dischargeDate 也設 8/4
  //（依「退伍當天做到中午」的規則，他們 8/4 早、中還在，晚上才離營）。
  const CHANGE_DATE = "2026-08-04";

  function seedMembers() {
    // [姓名, 退伍日, 加入日]
    const r261 = [
      ["李愷宸", CHANGE_DATE, null],
      ["江偉綸", "2026-08-04", null],
      ["陳柏翰", "2026-08-14", null],
      ["鄧旭辰", "2026-08-08", null],
      ["廖翊滕", "2026-08-10", null],
      ["陳俊穎", "2026-08-13", null],
      ["林柏宇", "2026-08-14", null],
      ["林崇浩", "2026-08-13", null],
      // 8/4 加入的五位新人：不排抬洗衣籃，也不排晚上的撤收
      ["丁楚祐", null, CHANGE_DATE],
      ["蔣許子宸", null, CHANGE_DATE],
      ["文軍諺", null, CHANGE_DATE],
      ["王傑立", null, CHANGE_DATE],
      ["簡宏穎", null, CHANGE_DATE],
    ];
    const r263 = [
      ["陳東霖", null],
      ["呂胤玄", null],
      ["林柏翰", null],
      ["曹月輝", null],
      ["黃聖為", null],
      ["李易宸", CHANGE_DATE],
      ["顏允彣", null],
      ["呂承鴻", null],
      ["盧明煬", CHANGE_DATE],
      ["田權楨", null],
    ];

    const members = [];
    r261.forEach(([name, dischargeDate, joinDate], idx) => {
      const seq = idx + 1;
      const isNewcomer = !!joinDate;
      members.push({
        id: `261-${seq}`,
        name,
        cohort: "261",
        seq,
        joinDate: joinDate || null,
        dischargeDate: dischargeDate || null,
        fixedRole: seq === 7 || seq === 8 ? "delivery" : null,
        skipLaundry: isNewcomer,
        skipDinnerCleanup: isNewcomer,
      });
    });
    r263.forEach(([name, dischargeDate], idx) => {
      const seq = idx + 1;
      members.push({
        id: `263-${seq}`,
        name,
        cohort: "263",
        seq,
        joinDate: null,
        dischargeDate: dischargeDate || null,
        fixedRole: null,
        skipLaundry: false,
        skipDinnerCleanup: false,
      });
    });
    return members;
  }

  function defaultDutySizeTable() {
    // 依使用者給的預設縮減順序：包便當-1,-1 → 廚餘-1 → 洗碗-1 → 包便當-1 → 廚餘-1
    return [
      { minActiveCount: 20, dishwash: 7, foodwaste: 5, lunchbag: 4, wipe: 1, floor: 1 },
      { minActiveCount: 19, dishwash: 7, foodwaste: 4, lunchbag: 4, wipe: 1, floor: 1 },
      { minActiveCount: 18, dishwash: 6, foodwaste: 4, lunchbag: 4, wipe: 1, floor: 1 },
      { minActiveCount: 17, dishwash: 6, foodwaste: 4, lunchbag: 3, wipe: 1, floor: 1 },
      { minActiveCount: 16, dishwash: 6, foodwaste: 4, lunchbag: 2, wipe: 1, floor: 1 },
      { minActiveCount: 15, dishwash: 6, foodwaste: 3, lunchbag: 2, wipe: 1, floor: 1 },
      { minActiveCount: 14, dishwash: 5, foodwaste: 3, lunchbag: 2, wipe: 1, floor: 1 },
      { minActiveCount: 13, dishwash: 5, foodwaste: 3, lunchbag: 1, wipe: 1, floor: 1 },
      { minActiveCount: 12, dishwash: 5, foodwaste: 2, lunchbag: 1, wipe: 1, floor: 1 },
      { minActiveCount: 11, dishwash: 5, foodwaste: 2, lunchbag: 0, wipe: 1, floor: 1 },
    ];
  }

  function defaultWashState() {
    return { primaryPointer: { 261: 0, 263: 0 }, nextPrimaryCohort: "261" };
  }

  function defaultLaundryState() {
    return { lastAssignedId: null, lastDown: [] };
  }

  /** 採買集合時間（0=週日 … 6=週六），顯示在文字班表上 */
  function defaultShoppingTimes() {
    return { 0: "", 1: "0600", 2: "0450", 3: "0600", 4: "0450", 5: "", 6: "" };
  }

  /** 固定的採買星期表（0=週日 … 6=週六），可在「採買」分頁修改 */
  function defaultShoppingRoster() {
    return {
      0: null,
      1: "263-2", // 週一 呂胤玄
      2: "263-3", // 週二 林柏翰
      3: "261-3", // 週三 陳柏翰
      4: "261-6", // 週四 陳俊穎
      5: null,
      6: null,
    };
  }

  function defaultState() {
    const members = seedMembers();
    const dutyCounts = {};
    members.forEach((m) => (dutyCounts[m.id] = emptyDutyCount()));

    return {
      version: 5,
      rosterVersion: ROSTER_VERSION,
      members,
      dutySizeTable: defaultDutySizeTable(),
      shoppingRoster: defaultShoppingRoster(),
      shoppingTimes: defaultShoppingTimes(),

      // ── 來源資料（真正被使用者決定的東西）────────────────────────────
      // 已確定紀錄的日期。整個系統的班表都是由名冊、設定與這份清單「重播」推導出來的，
      // 所以同一天不管重排幾次，只要名單與設定沒變，結果一定一樣。
      committedDates: [],

      // ── 推導出來的快取（由 ScheduleEngine.rebuildAll 重算，不要手動改）──
      dutyCounts,
      washState: defaultWashState(),
      laundryState: defaultLaundryState(),
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
    const merged = Object.assign({}, base, parsed, {
      washState: Object.assign({}, base.washState, parsed.washState),
      laundryState: Object.assign({}, base.laundryState, parsed.laundryState),
      shoppingRoster: Object.assign({}, base.shoppingRoster, parsed.shoppingRoster),
      shoppingTimes: Object.assign({}, base.shoppingTimes, parsed.shoppingTimes),
    });
    // 舊版的「臨時登記採買」已改成固定星期表；撤收也不再用固定分組
    delete merged.shoppingLog;
    delete merged.cleanupGroups;

    // 名冊有改版就換上新名冊（已排好的日期會依新名冊重播，不會遺失）
    if (parsed.rosterVersion !== ROSTER_VERSION) {
      merged.members = base.members;
      merged.rosterVersion = ROSTER_VERSION;
    }
    return merged;
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

  /**
   * 該員在指定日期（可再指定餐別）是否在營。
   *
   * 退伍當天還是可以做早餐、中餐的勤務，晚上才離營，所以要分餐別判斷：
   *   - 傳入 meal 時：退伍當天早/中回 true、晚回 false。
   *   - 沒傳 meal 時：代表問「這天有沒有出現過」，退伍當天回 true。
   * 下午之後的事（抬洗衣籃）用 meal="dinner" 來問，退伍當天就不會被排到。
   */
  function isActiveOn(member, dateStr, meal) {
    if (member.joinDate && dateStr < member.joinDate) return false;
    if (!member.dischargeDate) return true;
    if (dateStr < member.dischargeDate) return true;
    if (dateStr > member.dischargeDate) return false;
    return meal ? meal === "breakfast" || meal === "lunch" : true;
  }

  function activeMembersOn(dateStr, meal) {
    return state.members.filter((m) => isActiveOn(m, dateStr, meal));
  }

  function activeMembersByCohortOn(cohort, dateStr, meal) {
    return activeMembersOn(dateStr, meal)
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

  /** 重置所有勤務紀錄（次數、班表、洗碗指標、撤收分組），保留人員名單與採買星期表 */
  function resetRecords() {
    state.committedDates = [];
    clearDerived();
    save();
  }

  /** 清掉所有推導出來的快取，回到「什麼都還沒排」的起點 */
  function clearDerived() {
    const dutyCounts = {};
    state.members.forEach((m) => (dutyCounts[m.id] = emptyDutyCount()));
    state.dutyCounts = dutyCounts;
    state.washState = defaultWashState();
    state.laundryState = defaultLaundryState();
    state.schedules = {};
  }

  window.App.State = {
    STORAGE_KEY,
    DUTY_PERIOD_START,
    DUTY_PERIOD_END,
    LAUNDRY_START,
    DUTY_KEYS,
    MEAL_KEYS,
    MEAL_LABELS,
    MEAL_DUTY_ROWS,
    DAILY_DUTY_ROWS,
    DUTY_LABELS,
    DUTY_SHORT_LABELS,
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
    defaultShoppingTimes,
    defaultLaundryState,
    defaultShoppingRoster,
    onSave,
    saveWithoutNotifying,
    migrate,
  };
})();
