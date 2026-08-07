/* 資料模型、localStorage 讀寫、匯出/匯入、初始種子資料 */
window.App = window.App || {};

(function () {
  "use strict";

  const STORAGE_KEY = "mess-duty-roster-v4";

  // 名冊種子每次異動就 +1。舊資料（含從雲端還原的）rosterVersion 對不上時，
  // 會自動換上新名冊，這樣改名冊不用叫使用者清快取，也不會被雲端的舊名冊蓋回去。
  const ROSTER_VERSION = 9;

  /*
   * 勤務人數對照表與預設菜量的版本。
   *
   * 這兩份東西存在瀏覽器裡，而讀檔時是「存的蓋過預設值」，所以程式改了預設值也不會生效——
   * 之前把「包便當袋子」拿掉、把那四個名額分給洗碗/廚餘/擦桌子/清地板時就踩到這個坑：
   * 瀏覽器裡留著舊表（洗7廚5擦1地1＋包便當4），包便當欄位已經不存在，
   * 19 人只排掉 16 個，剩 3 個人沒有勤務。
   * 所以只要預設值有變就把這個號碼 +1，舊資料會自動換上新的預設值。
   * 涵蓋：勤務人數對照表、預設菜量、採買結束日。
   * 使用者自己逐日調過的菜量（menuSizes）不會被動到。
   */
  const CONFIG_VERSION = 9;

  const DUTY_PERIOD_START = "2026-08-01";
  const DUTY_PERIOD_END = "2026-08-14";
  // 洗衣籃輪替從這天開始；這天只有睡前抬下去，沒有昨天的籃子要抬上來
  const LAUNDRY_START = "2026-08-02";
  /*
   * 公平性次數從這天開始累計。
   *
   * 8/6 起規則整個換新（洗碗改單一佇列、撤收改固定名額、多了換水、旅部連報到），
   * 使用者決定之前的次數一律歸零重來，大家站在同一條起跑線。
   * 這天之前的班表照樣看得到（尤其是鎖定的 8/5），只是不計入公平性總覽。
   * 洗衣籃與洗碗的「輪到誰」不受影響，會從 8/5 接下去。
   */
  const COUNTS_FROM = "2026-08-06";

  // 會累計次數、出現在公平性總覽的勤務。
  // 抬便當上車/上樓不列入，因為人選跟包便當袋子完全相同，另外統計只會得到一模一樣的圖。
  const DUTY_KEYS = [
    "dishwash",
    "foodwaste",
    "wipe",
    "floor",
    "cleanup",
    // 打菜流程裡需要輪替的三項
    "serveDish",
    "lid",
    "boxing",
    // 撤收再按餐別分開記，用來平衡「誰老是被排到早餐撤收」
    "cleanupBreakfast",
    "cleanupLunch",
    "cleanupDinner",
    "water",
    "laundry",
    "shopping",
    "toilet",
  ];

  /*
   * 名冊的固定順序。招員是 261-9~13，所以照 cohort+seq 排就會自然接在 261-8 後面。
   * 旅部連是 8/6 中午報到的第三個群體。
   */
  const COHORT_ORDER = ["261", "263", "旅部"];
  const COHORT_LABELS = { 261: "261 梯", 263: "263 梯", 旅部: "旅部連" };
  function rosterOrder(a, b) {
    const ca = COHORT_ORDER.indexOf(a.cohort);
    const cb = COHORT_ORDER.indexOf(b.cohort);
    if (ca !== cb) return ca - cb;
    return a.seq - b.seq;
  }

  // 洗碗的輪替順序（使用者指定）：263 → 261 → 招員 → 旅部連。招員就是 261-9~13。
  const WASH_COHORT_ORDER = ["263", "261", "旅部"];
  function washOrder(a, b) {
    const ca = WASH_COHORT_ORDER.indexOf(a.cohort);
    const cb = WASH_COHORT_ORDER.indexOf(b.cohort);
    if (ca !== cb) return ca - cb;
    return a.seq - b.seq;
  }

  const MEAL_KEYS = ["breakfast", "lunch", "dinner"];
  const MEAL_LABELS = { breakfast: "早餐", lunch: "中餐", dinner: "晚餐" };

  /*
   * 一餐的實際流程（使用者 8/7 訂正）：
   *
   *   前置 ➡️ 打菜 ➡️ 打自己的便當（不能吃）➡️ 統一集合
   *   ➡️ 倒廚餘／抬上樓 ➡️ 休息 10 分鐘 ➡️ 善後勤務 ➡️ 撤收
   *
   * ⚠️ 重點訂正：**倒廚餘不屬於善後勤務**。
   * 打完自己的便當之後全體先集合、念一下班表，然後當場分成兩批同時進行——
   * 一批去倒廚餘（就是班表上排到廚餘的那些人），其餘所有人把便當抬上樓。
   * 所以善後勤務只剩洗碗、擦桌子、清地板，而抬上樓是**推導**出來的（廚餘以外的人），
   * 不是名冊上的固定分組。
   *
   * 班表照這個順序分段印，看起來就跟現場的動線一樣。
   * 三個畫面（網頁班表、文字班表、LINE 卡片）都吃這一份定義，不會三邊長歪。
   */
  const MEAL_SECTIONS = [
    {
      key: "prep",
      title: "前置",
      hint: "有空的都幫忙",
      notes: ["搬各連的箱子出來", "把地上有便當盒的箱子搬到桌上", "搬菜桶上桌"],
      rows: [],
    },
    { key: "serve", title: "打菜", rows: ["rice", "serveDish", "lid", "count", "drinks", "boxing"] },
    {
      key: "carry",
      title: "抬便當下車、上車",
      hint: "隨時到、隨時搬",
      rows: ["carryDown", "carryVehicle", "delivery"],
    },
    {
      key: "gather",
      title: "打完菜：統一集合",
      hint: "打自己的便當，先不要吃",
      notes: ["集合念一下班表，然後分兩批同時進行"],
      rows: ["foodwaste", "carryUpstairs"],
    },
    { key: "after", title: "善後勤務", hint: "下來統一休息 10 分鐘之後", rows: ["dishwash", "wipe", "floor"] },
    { key: "cleanup", title: "撤收", rows: ["cleanup"] },
  ];

  // 打完菜之後才做的那些（倒廚餘＋善後＋撤收），公平性與稽核會用到
  const MEAL_DUTY_ROWS = ["dishwash", "foodwaste", "wipe", "floor", "delivery", "carryUpstairs", "cleanup"];

  /*
   * 有些日子不是三餐都要排。8/14 是最後一天，任務下午前就結束了，只吃早餐。
   * 這裡列出「那天沒有的餐」，班表、文字班表、LINE 卡片都會直接跳過。
   */
  const MEALS_OFF = { "2026-08-14": ["lunch", "dinner"] };
  function mealsOn(dateStr) {
    const off = MEALS_OFF[dateStr] || [];
    return MEAL_KEYS.filter((m) => off.indexOf(m) === -1);
  }
  function mealIsOn(dateStr, meal) {
    return (MEALS_OFF[dateStr] || []).indexOf(meal) === -1;
  }

  // 換水只在這一餐排，而且從這天才開始（之前的日子沒有這項勤務）
  const WATER_MEAL = "breakfast"; // 撤收排完才排換水，而且不跟那一餐的撤收重複
  const WATER_COUNT = 5;
  const WATER_START = "2026-08-06";
  /*
   * 「不能有人連兩天換水」與「鎖定的日子也要推進換水進度」從這天起才生效。
   *
   * 8/7 早上已經換過水了（柏宇那批），那是實際發生過的事，不能被新規則改掉——
   * 所以 8/7 照舊：8/6 是鎖定的、進度不往前推，8/7 從隊伍頭重新排起。
   * 8/8 起才開始接續輪替並擋掉前一天那批。
   */
  const WATER_RULES_FROM = "2026-08-08";

  /*
   * 一餐從頭到尾的流程。
   *
   * MEAL_SECTIONS 是「班表要印哪幾段、每段有哪幾行」，這一份則是「流程本身」——
   * 內容固定、跟哪一天無關，給 LINE 的第一張「打飯流程」卡片用。
   * 兩份都改的時候記得對齊，不然卡片講的順序會跟班表印的順序不一樣。
   */
  const MEAL_FLOW = [
    {
      title: "前置",
      who: "有空的都幫忙",
      notes: ["搬各連的箱子出來", "把地上有便當盒的箱子搬到桌上", "搬菜桶上桌"],
    },
    {
      title: "打菜",
      who: "照班表分工",
      notes: ["打飯・打菜・蓋便當", "計數・抬飲料・包便當", "抬便當下車、上車：隨時到隨時搬，全員一起"],
    },
    { title: "打自己的便當", who: "全員", notes: ["先打起來，不能吃"] },
    { title: "統一集合", who: "全員", notes: ["集合念一下班表，然後分兩批"] },
    {
      title: "倒廚餘／抬上樓",
      who: "分兩批，同時進行",
      notes: ["倒廚餘：班表上排到廚餘的人", "抬上樓：倒廚餘以外的所有人"],
    },
    { title: "休息", who: "全員", notes: ["下來統一休息 10 分鐘"] },
    { title: "善後勤務", who: "照班表分工", notes: ["洗碗・擦桌子・清地板收垃圾"] },
    { title: "撤收", who: "照班表分工", notes: [] },
  ];

  // 打菜流程的欄位（依實際進行順序）
  const SERVING_ROWS = ["rice", "serveDish", "lid", "count", "drinks", "boxing"];

  // 打菜流程裡人選固定、不參與輪替的角色
  const SERVING_FIXED_ROLES = ["rice", "count", "drinks"];
  const SERVING_ROLE_LABELS = { rice: "打飯", count: "計數", drinks: "抬飲料" };

  // 早餐不打飯，所以那一餐沒有「打飯」這一行，固定打飯的兩位改成一起包餐盒
  const NO_RICE_MEALS = ["breakfast"];
  function servesRiceAt(meal) {
    return NO_RICE_MEALS.indexOf(meal) === -1;
  }

  /** 菜色的說法，例如「一飯6菜」；不打飯的那餐就只寫「2菜」 */
  function menuLabel(meal, dishes) {
    return servesRiceAt(meal) ? `一飯${dishes}菜` : `${dishes}菜`;
  }

  /*
   * 一天只做一次、不分餐別的勤務。
   * 換水雖然是早餐撤收完才做，但一天只有一次，跟採買、洗衣籃一樣列在「全日」比較好找。
   */
  const DAILY_DUTY_ROWS = ["shopping", "toilet", "water", "laundryUp", "laundryDown"];

  const DUTY_LABELS = {
    dishwash: "洗碗",
    // 倒廚餘是「集合完馬上做」的事，不屬於善後勤務，標籤直接寫清楚
    foodwaste: "倒廚餘",
    carryDown: "抬便當下車",
    carryVehicle: "抬便當上車",
    carryUpstairs: "抬便當上樓",
    wipe: "擦桌子",
    rice: "打飯",
    serveDish: "打菜",
    lid: "蓋便當",
    count: "計數",
    drinks: "抬飲料（抬完包便當）",
    boxing: "包便當",
    floor: "清地板收垃圾",
    delivery: "送便當",
    cleanup: "撤收",
    water: "換水（早上撤收完）",
    laundry: "抬洗衣籃",
    laundryUp: "抬洗衣籃上來（下午）",
    laundryDown: "抬洗衣籃下去（睡前）",
    shopping: "採買",
    toilet: "掃廁所（0900、2100）",
  };

  // 個人分工那邊用短一點的說法，一行才塞得下
  const DUTY_SHORT_LABELS = {
    dishwash: "洗碗",
    foodwaste: "倒廚餘",
    carryDown: "抬下車",
    rice: "打飯",
    serveDish: "打菜",
    lid: "蓋便當",
    count: "計數",
    drinks: "抬飲料",
    boxing: "包便當",
    carryVehicle: "抬上車",
    carryUpstairs: "抬上樓",
    wipe: "擦桌子",
    floor: "清地板",
    delivery: "送便當",
    cleanup: "撤收",
    water: "換水",
    laundryUp: "抬洗衣籃上來",
    laundryDown: "抬洗衣籃下去",
    shopping: "採買",
    toilet: "掃廁所",
    departed: "已離營",
  };

  const DUTY_ICONS = {
    dishwash: "🍽️",
    foodwaste: "🗑️",
    carry: "🚚",
    carryDown: "📥",
    carryVehicle: "🚚",
    carryUpstairs: "🏢",
    rice: "🍚",
    serveDish: "🥢",
    lid: "🍱",
    count: "🔢",
    drinks: "🥤",
    boxing: "📦",
    wipe: "🧽",
    floor: "🧹",
    delivery: "🛵",
    cleanup: "📦",
    water: "🚰",
    laundry: "🧺",
    laundryUp: "🧺",
    laundryDown: "🧺",
    shopping: "🛒",
    toilet: "🚻",
  };

  function emptyDutyCount() {
    const c = {};
    DUTY_KEYS.forEach((k) => (c[k] = 0));
    return c;
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  // 2026/08/04 這天有一波人員異動：三位退出打飯班、261 加入五位新人。
  const CHANGE_DATE = "2026-08-04";
  // 旅部連 4 位是 8/6「中午」報到，那天早餐還沒有他們
  const BRIGADE_JOIN_DATE = "2026-08-06";
  const BRIGADE_JOIN_MEAL = "lunch";
  // 旅部連 8/7 早上被調走，只做了 8/6 一天
  const BRIGADE_LEAVE_DATE = "2026-08-07";
  // 李愷宸 8/7 早上歸建，但只掃廁所（dutyExempt），不算進出勤人數
  const KAICHEN_RETURN_DATE = "2026-08-07";

  /*
   * 廖翊滕 8/10 晚上退伍，當晚上面補一個人下來頂他的缺。
   *
   * 「原本翊滕之後怎麼排，這個新人就怎麼排」——不用寫特別的規則，
   * 因為廚餘／擦桌子／清地板／撤收／打菜全部是「這項做最少次的人優先」，
   * 新人一進來次數是 0，本來就會被優先排到，等於自動接上翊滕的工作量。
   * 公平範圍又是按在營天數等比例算的，所以他只待四天也不會被標成偏少。
   */
  const REPLACEMENT_JOIN_DATE = "2026-08-10";
  const REPLACEMENT_JOIN_MEAL = "dinner"; // 晚上才到，那天早餐、中餐還沒有他

  /*
   * 招員五位（261-9~13）的固定勤務。
   *
   * 使用者 8/15 改的：早、晚洗碗，中午做廚餘。
   * 「洗碗的人那一餐不排撤收」是既有規則，但廚餘沒有這條，
   * 所以他們早、晚不排撤收（在洗碗），中午廚餘做完照樣要排撤收。
   *
   * 上一版試過「三餐都洗碗」，被退回了——把 5 個人整組抽出輪替，
   * 剩下的 12 個人要吃下全部的廚餘、擦桌子、清地板。這一版中午他們還在池子裡
   * 而且直接吃掉大部分廚餘名額，剛好避開那個問題。
   */
  const RECRUIT_SEQS = [9, 10, 11, 12, 13];
  const RECRUIT_DISHWASH_MEALS = ["breakfast", "dinner"];
  const RECRUIT_FOODWASTE_MEALS = ["lunch"];

  /*
   * 離開的方式有兩種，對「最後一天」的處理不一樣：
   *   afterLunch（退伍）：當天早餐、中餐照排，晚上才離營。
   *   immediate（退出打飯班／調離）：當天早上就不在了，整天都不排。
   */
  const LEAVE_AFTER_LUNCH = "afterLunch";
  const LEAVE_IMMEDIATE = "immediate";

  /*
   * 打菜流程的固定角色（使用者指定）。
   *
   * rank 是「正取（1）／候補（2）」：每個角色照名額由 rank 小的先填，同 rank 照名冊順序。
   * 兩件事都靠它處理：
   *   1. 旭辰 8/8 晚上退伍，計數換東霖接 —— 東霖掛 rank 2，旭辰在的時候輪不到他，
   *      旭辰一走名額空出來就自動由他遞補，不用另外寫日期。
   *   2. 人少的時候抬飲料只留 1 位 —— 名額縮到 1，rank 1 的林柏翰留下，
   *      陳柏翰（rank 2）自動併進打菜的輪替池。
   */
  const SEED_SERVING_ROLES = {
    "263-4": { role: "rice", rank: 1 }, // 曹月輝 打飯
    "263-8": { role: "rice", rank: 1 }, // 呂承鴻 打飯
    "261-4": { role: "count", rank: 1 }, // 鄧旭辰 計數（8/8 晚上退伍）
    "263-7": { role: "count", rank: 1 }, // 顏允彣 計數
    "263-1": { role: "count", rank: 2 }, // 陳東霖 計數候補，旭辰退伍後接上
    "263-3": { role: "drinks", rank: 1 }, // 林柏翰 抬飲料（只留一位時留他）
    "261-3": { role: "drinks", rank: 2 }, // 陳柏翰 抬飲料
  };
  function seedServingRole(id) {
    return (SEED_SERVING_ROLES[id] || {}).role || null;
  }
  function seedServingRank(id) {
    return (SEED_SERVING_ROLES[id] || {}).rank || 1;
  }

  function seedMembers() {
    // [姓名, 離開日, 離開方式, 加入日, 報到那天從哪一餐開始]
    const r261 = [
      // 8/4 退出打飯班，8/7 早上回來，但只掃廁所、不做任何勤務（見 dutyExempt）
      ["李愷宸", null, LEAVE_AFTER_LUNCH, KAICHEN_RETURN_DATE],
      ["江偉綸", "2026-08-04", LEAVE_AFTER_LUNCH, null],
      ["陳柏翰", "2026-08-14", LEAVE_AFTER_LUNCH, null],
      ["鄧旭辰", "2026-08-08", LEAVE_AFTER_LUNCH, null],
      ["廖翊滕", "2026-08-10", LEAVE_AFTER_LUNCH, null],
      ["陳俊穎", "2026-08-13", LEAVE_AFTER_LUNCH, null],
      ["林柏宇", "2026-08-14", LEAVE_AFTER_LUNCH, null],
      ["林崇浩", "2026-08-13", LEAVE_AFTER_LUNCH, null],
      // 8/4 早上報到的五位新人：不排抬洗衣籃，也不排晚上的撤收
      ["丁楚祐", null, LEAVE_AFTER_LUNCH, CHANGE_DATE],
      ["蔣許子宸", null, LEAVE_AFTER_LUNCH, CHANGE_DATE],
      ["文軍諺", null, LEAVE_AFTER_LUNCH, CHANGE_DATE],
      ["王傑立", null, LEAVE_AFTER_LUNCH, CHANGE_DATE],
      ["簡宏穎", null, LEAVE_AFTER_LUNCH, CHANGE_DATE],
      // 8/10 晚上補下來頂廖翊滕缺的那位。名字確定之後到「名冊」分頁改掉就好。
      ["新人", null, LEAVE_AFTER_LUNCH, REPLACEMENT_JOIN_DATE, REPLACEMENT_JOIN_MEAL],
    ];
    const r263 = [
      ["陳東霖", null, LEAVE_AFTER_LUNCH],
      ["呂胤玄", null, LEAVE_AFTER_LUNCH],
      ["林柏翰", null, LEAVE_AFTER_LUNCH],
      ["曹月輝", null, LEAVE_AFTER_LUNCH],
      ["黃聖為", null, LEAVE_AFTER_LUNCH],
      ["李易宸", CHANGE_DATE, LEAVE_IMMEDIATE], // 退出打飯班
      ["顏允彣", null, LEAVE_AFTER_LUNCH],
      ["呂承鴻", null, LEAVE_AFTER_LUNCH],
      ["盧明煬", CHANGE_DATE, LEAVE_IMMEDIATE], // 退出打飯班
      ["田權楨", null, LEAVE_AFTER_LUNCH],
    ];

    // 旅部連 4 位 8/6 中午報到，8/7 早上就被調走了，只做到 8/6
    const brigade = ["朱醒醒", "林玟圻", "陳景琪", "弘"];

    const members = [];
    r261.forEach(([name, dischargeDate, leaveMode, joinDate, joinMeal], idx) => {
      const seq = idx + 1;
      /*
       * 招員是 261-9~13 這五位，用序號認人。
       * （以前是用「有沒有填加入日期」認的，8/10 補進來的新人一樣有加入日期，
       *   再用那個判斷會把他也當成招員，免排洗衣籃／晚上撤收／換水全部跟著跑掉。）
       */
      const isRecruit = RECRUIT_SEQS.indexOf(seq) !== -1;
      members.push({
        id: `261-${seq}`,
        name,
        cohort: "261",
        seq,
        joinDate: joinDate || null,
        joinMeal: joinMeal || null,
        dischargeDate: dischargeDate || null,
        leaveMode: leaveMode,
        fixedRole: seq === 7 || seq === 8 ? "delivery" : null,
        servingRole: seedServingRole(`261-${seq}`),
        servingRank: seedServingRank(`261-${seq}`),
        skipLaundry: isRecruit,
        // 招員早、晚在洗碗（洗碗的人本來就不排撤收），這條擋的是「中午以外」的晚餐
        skipDinnerCleanup: isRecruit,
        skipWater: isRecruit,
        // 招員：早、晚固定洗碗，中午固定廚餘。其餘的人兩個都是空的、照輪替
        fixedDishwashMeals: isRecruit ? RECRUIT_DISHWASH_MEALS.slice() : [],
        fixedFoodwasteMeals: isRecruit ? RECRUIT_FOODWASTE_MEALS.slice() : [],
        // 愷宸只掃廁所，不做任何勤務，也不算進當天的出勤人數
        dutyExempt: seq === 1,
        carryGroup: null,
      });
    });
    r263.forEach(([name, dischargeDate, leaveMode], idx) => {
      const seq = idx + 1;
      members.push({
        id: `263-${seq}`,
        name,
        cohort: "263",
        seq,
        joinDate: null,
        joinMeal: null,
        dischargeDate: dischargeDate || null,
        leaveMode: leaveMode,
        fixedRole: null,
        servingRole: seedServingRole(`263-${seq}`),
        servingRank: seedServingRank(`263-${seq}`),
        skipLaundry: false,
        skipDinnerCleanup: false,
        skipWater: false,
        fixedDishwashMeals: [],
        fixedFoodwasteMeals: [],
        dutyExempt: false,
        carryGroup: null,
      });
    });
    brigade.forEach((name, idx) => {
      const seq = idx + 1;
      members.push({
        id: `旅部-${seq}`,
        name,
        cohort: "旅部",
        seq,
        joinDate: BRIGADE_JOIN_DATE,
        joinMeal: BRIGADE_JOIN_MEAL,
        dischargeDate: BRIGADE_LEAVE_DATE,
        leaveMode: LEAVE_IMMEDIATE, // 8/7 早上起就被調走了
        fixedRole: null,
        servingRole: null,
        servingRank: 1,
        skipLaundry: false,
        skipDinnerCleanup: false,
        skipWater: false,
        fixedDishwashMeals: [],
        fixedFoodwasteMeals: [],
        dutyExempt: false,
        carryGroup: null,
      });
    });
    return members;
  }

  /*
   * 「這個人這一餐固定做某項勤務」的共用查詢。
   *
   * 存的是餐別陣列而不是布林值，因為招員的安排是「早、晚洗碗，中午廚餘」——
   * 布林的「固定洗碗」表達不出「只有這兩餐」。空陣列＝這個人照輪替，
   * 名冊沒有這兩個欄位的舊資料在 migrate 裡會補成空陣列。
   */
  function fixedMealsOf(member, key) {
    const list = member && member[key];
    return Array.isArray(list) ? list : [];
  }
  function fixedDishwashMealsOf(member) {
    return fixedMealsOf(member, "fixedDishwashMeals");
  }
  function fixedFoodwasteMealsOf(member) {
    return fixedMealsOf(member, "fixedFoodwasteMeals");
  }
  function isFixedDishwashAt(member, meal) {
    return fixedDishwashMealsOf(member).indexOf(meal) !== -1;
  }
  function isFixedFoodwasteAt(member, meal) {
    return fixedFoodwasteMealsOf(member).indexOf(meal) !== -1;
  }
  function hasFixedDishwash(member) {
    return fixedDishwashMealsOf(member).length > 0;
  }
  function hasFixedFoodwaste(member) {
    return fixedFoodwasteMealsOf(member).length > 0;
  }
  /** 三餐都固定洗碗＝整天都排不到撤收，撤收的人數階梯要把這種人整個扣掉 */
  function isFixedDishwashAllDay(member) {
    const meals = fixedDishwashMealsOf(member);
    return MEAL_KEYS.every((m) => meals.indexOf(m) !== -1);
  }

  /*
   * 名冊那一欄要呈現的組合。逐餐勾六個格子在手機上按不到，
   * 而實際會用到的就是這幾種，所以做成下拉選單，值再展開成上面那兩個陣列。
   */
  const FIXED_DUTY_PRESETS = [
    { key: "", label: "（照輪替）", dishwash: [], foodwaste: [] },
    {
      key: "wash-bd-waste-l",
      label: "早晚洗碗 ＋ 中午廚餘",
      dishwash: RECRUIT_DISHWASH_MEALS,
      foodwaste: RECRUIT_FOODWASTE_MEALS,
    },
    { key: "wash-all", label: "三餐都洗碗", dishwash: MEAL_KEYS, foodwaste: [] },
  ];
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.indexOf(x) !== -1);
  /** 反查這個人目前是哪一種組合（對不上任何一種就回空字串） */
  function fixedDutyPresetOf(member) {
    const wash = fixedDishwashMealsOf(member);
    const waste = fixedFoodwasteMealsOf(member);
    const hit = FIXED_DUTY_PRESETS.find((p) => sameSet(p.dishwash, wash) && sameSet(p.foodwaste, waste));
    return hit ? hit.key : "";
  }
  function fixedDutyPatchFor(presetKey) {
    const preset = FIXED_DUTY_PRESETS.find((p) => p.key === presetKey) || FIXED_DUTY_PRESETS[0];
    return { fixedDishwashMeals: preset.dishwash.slice(), fixedFoodwasteMeals: preset.foodwaste.slice() };
  }

  function defaultDutySizeTable() {
    /*
     * 這張表是按「扣掉送便當之後還有幾個人」查的，不是按出勤人數。
     *
     * 因為送便當是固定角色（柏宇、崇浩），人數由他們還在不在決定，不是可以自由分配的欄位。
     * 用出勤人數當索引會出事：8/6 早餐 19 人（送便當 2 位都在，其餘 17 人要分）
     * 跟 8/13 晚餐 19 人（只剩柏宇，其餘 18 人要分）需求不同，同一列蓋不住。
     *
     * 每一列的四個數字加起來，剛好等於那一餐扣掉送便當之後的人數。
     */
    return [
      { minActiveCount: 21, dishwash: 7, foodwaste: 7, wipe: 3, floor: 4 },
      { minActiveCount: 20, dishwash: 7, foodwaste: 7, wipe: 2, floor: 4 },
      { minActiveCount: 19, dishwash: 7, foodwaste: 6, wipe: 2, floor: 4 },
      { minActiveCount: 18, dishwash: 7, foodwaste: 6, wipe: 2, floor: 3 },
      { minActiveCount: 17, dishwash: 7, foodwaste: 6, wipe: 2, floor: 2 },
      { minActiveCount: 16, dishwash: 6, foodwaste: 6, wipe: 2, floor: 2 },
      { minActiveCount: 15, dishwash: 6, foodwaste: 5, wipe: 2, floor: 2 },
      { minActiveCount: 14, dishwash: 6, foodwaste: 5, wipe: 1, floor: 2 },
      { minActiveCount: 13, dishwash: 5, foodwaste: 5, wipe: 1, floor: 2 },
      { minActiveCount: 12, dishwash: 5, foodwaste: 4, wipe: 1, floor: 2 },
      { minActiveCount: 11, dishwash: 5, foodwaste: 4, wipe: 1, floor: 1 },
      { minActiveCount: 10, dishwash: 4, foodwaste: 4, wipe: 1, floor: 1 },
    ];
  }

  // 早餐 3 菜且不打飯（6＋2＋2＋2＝12人），中晚餐 5 菜（2＋10＋2＋2＋2＝18人）
  function defaultMenuDefaults() {
    return { breakfast: 3, lunch: 5, dinner: 5 };
  }

  /*
   * 洗碗改成單一佇列照號碼輪（263 → 261 → 招員 → 旅部連），
   * 不再分兩梯輪流當起始梯，所以只要記「下一個從誰開始」。
   */
  function defaultWashState() {
    return { nextStartId: null };
  }

  function defaultLaundryState() {
    return { lastAssignedId: null, lastDown: [] };
  }

  /*
   * 換水的輪替進度。
   *   lastAssignedId  上一組最後一位是誰（下一天從他的下一位接著排）
   *   lastIds         上一個排班日換水的那五位——「不能連兩天」要靠它擋
   */
  function defaultWaterState() {
    return { lastAssignedId: null, lastIds: [] };
  }

  // 採買只做到這一天為止（含）。8/3 是最後一次，8/4 起就不用採買了。
  const DEFAULT_SHOPPING_UNTIL = "2026-08-03";

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

  /*
   * 已公布出去、鎖定不再變動的班表。
   *
   * 「邊改程式邊公布勤務」會遇到一個問題：改了規則之後回頭看，那天的班表跟公布的
   * 不一樣，群組裡的人就會覺得又改了。所以已經貼出去的那幾天要鎖起來——
   * 排班時照鎖定的內容走，不再重算，但次數照樣計入公平性總覽。
   *
   * 之後要鎖新的一天，不用改這裡：到「產生班表」頁面把公布過的文字班表貼回去就好。
   */
  /**
   * 剛裝上程式裡預鎖的某一天時，順便把它算成「已確定紀錄」。
   * 鎖定的日子是已經公布、已經發生過的，沒有計入的話後面的輪替（洗衣籃、洗碗指標）
   * 會從頭開始，跟現場對不上。使用者自己按「取消這天的紀錄」的日子不受影響——
   * 那時 overrides 已經在了，不會再走到這裡。
   */
  function commitSeededDate(target, date) {
    if (!Array.isArray(target.committedDates)) target.committedDates = [];
    if (target.committedDates.indexOf(date) === -1) target.committedDates.push(date);
    target.committedDates.sort();
  }

  function defaultToiletByDate() {
    const byDate = {};
    for (let d = new Date(KAICHEN_RETURN_DATE + "T00:00:00"); ; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      byDate[iso] = ["261-1"];
      if (iso >= DUTY_PERIOD_END) break;
    }
    return byDate;
  }

  function defaultOverrides() {
    return {
      "2026-08-06": {
        note: "8/6 已公布給大家；8/7 起旅部連調走、規則整個換新，鎖定這天不再變動",
        meals: {
          breakfast: {
            dishes: 3,
            serving: {
              serveDish: ["261-5","261-9","261-10","261-11","261-12","261-13"],
              lid: ["261-6","261-7"],
              count: ["261-4","263-7"],
              drinks: ["261-3","263-3"],
              boxing: ["261-8","263-1","263-2","263-4","263-5","263-8","263-10"],
            },
            dishwash: ["261-9","261-10","261-11","261-12","261-13","263-1","263-2"],
            foodwaste: ["261-3","261-4","261-5","261-6","263-3","263-4"],
            wipe: ["263-8","263-10"],
            floor: ["263-5","263-7"],
            delivery: ["261-7","261-8"],
            cleanup: ["261-3","261-4","261-5","261-6"],
          },
          lunch: {
            dishes: 5,
            serving: {
              rice: ["263-1","263-8"],
              serveDish: ["261-6","261-7","261-8","261-9","261-10","261-11","261-12","261-13","263-2","263-4"],
              lid: ["261-5","263-5"],
              count: ["261-4","263-7"],
              drinks: ["261-3","263-3"],
              boxing: ["263-10","旅部-1","旅部-2","旅部-3","旅部-4"],
            },
            dishwash: ["261-9","261-10","261-11","261-12","261-13","263-3","263-4"],
            foodwaste: ["263-1","263-2","263-5","263-7","263-8","263-10","旅部-1"],
            wipe: ["旅部-2","旅部-3","旅部-4"],
            floor: ["261-3","261-4","261-5","261-6"],
            delivery: ["261-7","261-8"],
            cleanup: ["263-1","263-2","263-5","263-7","263-8","263-10","旅部-1"],
          },
          dinner: {
            dishes: 5,
            serving: {
              rice: ["263-1","263-8"],
              serveDish: ["261-9","261-10","261-11","261-12","261-13","263-5","263-10","旅部-1","旅部-2","旅部-3"],
              lid: ["261-8","263-2"],
              count: ["261-4","263-7"],
              drinks: ["261-3","263-3"],
              boxing: ["261-5","261-6","261-7","263-4","旅部-4"],
            },
            dishwash: ["261-9","261-10","261-11","261-12","261-13","263-5","263-7"],
            foodwaste: ["261-6","263-8","263-10","旅部-1","旅部-2","旅部-3","旅部-4"],
            wipe: ["261-3","261-4","261-5"],
            floor: ["263-1","263-2","263-3","263-4"],
            delivery: ["261-7","261-8"],
            cleanup: ["261-7","261-8","263-3","263-4","旅部-2","旅部-3","旅部-4"],
          },
        },
        daily: {
          water: ["261-7","261-8","263-1","263-2","263-3"],
          laundryUp: ["261-7","261-8"],
          laundryDown: ["263-1","263-2"],
          washNextStartId: "263-8",
        },
      },
      "2026-08-05": {
        note: "8/5 已公布給大家，鎖定不再變動；晚上抬洗衣籃下去改成 261-7、261-8，洗衣籃輪替從這裡重新起算",
        meals: {
          breakfast: {
            dishes: 2,
            serving: {
              serveDish: ["261-9", "261-10", "261-11", "261-12"],
              lid: ["261-13", "263-5"],
              count: ["261-4", "263-7"],
              drinks: ["261-3", "263-1"],
              boxing: ["261-5", "261-6", "261-7", "261-8", "263-2", "263-3", "263-4", "263-8", "263-10"],
            },
            dishwash: ["261-3", "261-5", "261-6", "261-9", "261-10", "261-11", "261-12", "261-13"],
            foodwaste: ["261-4", "263-1", "263-2", "263-3", "263-4"],
            wipe: ["263-5", "263-8"],
            floor: ["263-7", "263-10"],
            delivery: ["261-7", "261-8"],
            cleanup: ["261-4", "263-1", "263-2", "263-8", "263-10"],
          },
          lunch: {
            dishes: 5,
            serving: {
              rice: ["263-2", "263-10"],
              serveDish: ["261-5", "261-6", "261-7", "261-8", "261-9", "261-10", "261-11", "261-12", "261-13", "263-3"],
              lid: ["263-4", "263-8"],
              count: ["261-4", "263-7"],
              drinks: ["261-3", "263-1"],
              boxing: ["263-5"],
            },
            dishwash: ["261-4", "263-1", "263-2", "263-3", "263-4", "263-5", "263-7", "263-8"],
            foodwaste: ["261-9", "261-10", "261-11", "261-12", "261-13"],
            wipe: ["261-6", "263-10"],
            floor: ["261-3", "261-5"],
            delivery: ["261-7", "261-8"],
            cleanup: ["261-5", "261-6", "261-9", "261-10", "261-11", "261-12", "261-13"],
          },
          dinner: {
            dishes: 5,
            serving: {
              rice: ["263-2", "263-10"],
              serveDish: ["261-5", "261-6", "261-9", "261-10", "261-11", "261-12", "261-13", "263-4", "263-5", "263-8"],
              lid: ["261-7", "263-3"],
              count: ["261-4", "263-7"],
              drinks: ["261-3", "263-1"],
              boxing: ["261-8"],
            },
            dishwash: ["261-5", "261-6", "261-9", "261-10", "261-11", "261-12", "261-13", "263-10"],
            foodwaste: ["261-3", "263-1", "263-2", "263-5", "263-7"],
            wipe: ["263-4", "263-8"],
            floor: ["261-4", "263-3"],
            delivery: ["261-7", "261-8"],
            cleanup: ["261-3", "261-7", "261-8", "263-3", "263-4", "263-5", "263-7"],
          },
        },
        daily: {
          shopping: [],
          water: [],
          laundryUp: ["261-3", "261-4"],
          laundryDown: ["261-7", "261-8"],
          // 8/6 早餐起洗碗改成單一佇列，從 263-01 重新開始
          washNextStartId: "263-1",
        },
      },
    };
  }

  function defaultState() {
    const members = seedMembers();
    const dutyCounts = {};
    members.forEach((m) => (dutyCounts[m.id] = emptyDutyCount()));

    return {
      version: 5,
      rosterVersion: ROSTER_VERSION,
      configVersion: CONFIG_VERSION,
      members,
      dutySizeTable: defaultDutySizeTable(),
      shoppingTimes: defaultShoppingTimes(),
      /*
       * 採買沒有固定星期也沒有固定人數，逐日指定：{ "2026-08-07": ["261-3", "263-5"] }。
       * 名單裡的人那天早餐、中餐完全不排，晚上才歸隊。
       */
      shoppingByDate: {},
      /*
       * 掃廁所是早上9點，現場爬梯子決定誰去，不是程式排的，所以也是逐日指定：
       * { "2026-08-06": ["261-3"] }。通常一天一個人，存成陣列是為了跟其他全日勤務
       * 一樣好處理（真的要派兩個人也不會壞掉）。
       */
      /*
       * 掃廁所 0900 與 2100 兩個時段由同一位包辦。8/7 起愷宸歸建，
       * 他不做任何勤務、只掃廁所，所以先把 8/7～8/14 都填上他；
       * 要換人就到「採買・掃廁所」分頁那一天改。
       */
      toiletByDate: defaultToiletByDate(),
      menuDefaults: defaultMenuDefaults(),
      // 只存跟預設不一樣的那幾格：{ "2026-08-05": { lunch: 4 } }
      menuSizes: {},

      /*
       * 已經公布出去、之後不准再變動的班表。
       * key 是日期，值是完整的當天名單；排班時會照這份走，不再重算，
       * 但次數照樣累計。用「文字班表」貼回來就能鎖定（見 js/scheduleImport.js）。
       */
      overrides: defaultOverrides(),

      // ── 來源資料（真正被使用者決定的東西）────────────────────────────
      /*
       * 已確定紀錄的日期。整個系統的班表都是由名冊、設定與這份清單「重播」推導出來的，
       * 所以同一天不管重排幾次，只要名單與設定沒變，結果一定一樣。
       *
       * 程式裡預先鎖好的日子一開始就算是「已確定」——鎖定代表那天已經公布出去、
       * 真的發生過了。少了這一步，換一支手機打開就會從頭排，洗衣籃也不會接著 261-7、08 走。
       */
      committedDates: Object.keys(defaultOverrides()).sort(),

      // ── 推導出來的快取（由 ScheduleEngine.rebuildAll 重算，不要手動改）──
      dutyCounts,
      washState: defaultWashState(),
      laundryState: defaultLaundryState(),
      waterState: defaultWaterState(),
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
      waterState: Object.assign({}, base.waterState, parsed.waterState),
      shoppingTimes: Object.assign({}, base.shoppingTimes, parsed.shoppingTimes),
      menuDefaults: Object.assign({}, base.menuDefaults, parsed.menuDefaults),
    });
    // 舊版的「臨時登記採買」已改成固定星期表；撤收也不再用固定分組
    delete merged.shoppingLog;
    delete merged.cleanupGroups;
    // 採買從「固定星期表 ＋ 結束日」改成「逐日指定名單」
    delete merged.shoppingRoster;
    delete merged.shoppingUntil;
    if (!merged.shoppingByDate || typeof merged.shoppingByDate !== "object") merged.shoppingByDate = {};
    if (!merged.toiletByDate || typeof merged.toiletByDate !== "object") merged.toiletByDate = {};
    // 愷宸 8/7 歸建後固定掃廁所，名冊換版時把還沒指定的日子補上
    if (parsed.rosterVersion !== ROSTER_VERSION) {
      const seedToilet = defaultToiletByDate();
      Object.keys(seedToilet).forEach((date) => {
        if (!merged.toiletByDate[date]) merged.toiletByDate[date] = seedToilet[date];
      });
    }
    if (!merged.overrides || typeof merged.overrides !== "object") merged.overrides = {};

    // 名冊有改版就換上新名冊與採買設定（已排好的日期會依新設定重播，不會遺失）
    if (parsed.rosterVersion !== ROSTER_VERSION) {
      merged.members = base.members;
      merged.rosterVersion = ROSTER_VERSION;
    }

    /*
     * 「固定洗碗」從布林值改成餐別陣列（招員現在是早晚洗碗＋中午廚餘）。
     * 名冊沒換版時舊物件會原封不動留著，所以在這裡補齊欄位：
     * 舊的 fixedDishwash:true 等於三餐都洗，其餘一律空陣列（照輪替）。
     */
    (merged.members || []).forEach((m) => {
      if (!Array.isArray(m.fixedDishwashMeals)) {
        m.fixedDishwashMeals = m.fixedDishwash ? MEAL_KEYS.slice() : [];
      }
      if (!Array.isArray(m.fixedFoodwasteMeals)) m.fixedFoodwasteMeals = [];
      delete m.fixedDishwash;
    });

    /*
     * 勤務人數對照表與預設菜量有改版就換上新的。
     * 不這樣做的話，瀏覽器裡的舊表會永遠蓋過程式裡的新預設值（詳見 CONFIG_VERSION 的說明）。
     */
    if (parsed.configVersion !== CONFIG_VERSION) {
      merged.dutySizeTable = base.dutySizeTable;
      merged.menuDefaults = base.menuDefaults;
      merged.menuSizes = {}; // 逐日菜量也一起回到預設，避免舊值蓋掉新的預設
      merged.configVersion = CONFIG_VERSION;
      // 程式裡預先鎖好的日子換成新版（內容改了就要換，不然舊的會一直留著）
      Object.keys(base.overrides).forEach((date) => {
        merged.overrides[date] = base.overrides[date];
        commitSeededDate(merged, date);
      });
    } else {
      // 版本沒變就只補沒鎖過的日子，不動使用者自己鎖的
      Object.keys(base.overrides).forEach((date) => {
        if (merged.overrides[date]) return;
        merged.overrides[date] = base.overrides[date];
        commitSeededDate(merged, date);
      });
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
    /*
     * 報到當天可以指定是哪一餐才到（旅部連是 8/6「中午」報到，那天早餐還沒有他們）。
     * 沒指定 joinMeal 就是一早就到。
     */
    if (member.joinDate && dateStr === member.joinDate && member.joinMeal && meal) {
      if (MEAL_KEYS.indexOf(meal) < MEAL_KEYS.indexOf(member.joinMeal)) return false;
    }
    if (!member.dischargeDate) return true;
    if (dateStr < member.dischargeDate) return true;
    if (dateStr > member.dischargeDate) return false;
    // 離開當天：退出打飯班的人早上就不在了；退伍的人做到中午
    if (member.leaveMode === LEAVE_IMMEDIATE) return false;
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

  /** 某天某餐幾道菜：有覆蓋值就用覆蓋值，否則用預設 */
  function menuSizeFor(dateStr, meal) {
    const override = (state.menuSizes || {})[dateStr];
    if (override && override[meal] != null) return override[meal];
    return (state.menuDefaults || {})[meal] || 0;
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
    state.waterState = defaultWaterState();
    state.schedules = {};
  }

  window.App.State = {
    STORAGE_KEY,
    DUTY_PERIOD_START,
    DUTY_PERIOD_END,
    LAUNDRY_START,
    COUNTS_FROM,
    LEAVE_AFTER_LUNCH,
    LEAVE_IMMEDIATE,
    SERVING_ROWS,
    SERVING_FIXED_ROLES,
    SERVING_ROLE_LABELS,
    NO_RICE_MEALS,
    servesRiceAt,
    menuLabel,
    DUTY_KEYS,
    MEAL_KEYS,
    MEAL_LABELS,
    MEALS_OFF,
    mealsOn,
    mealIsOn,
    MEAL_SECTIONS,
    MEAL_FLOW,
    MEAL_DUTY_ROWS,
    RECRUIT_DISHWASH_MEALS,
    RECRUIT_FOODWASTE_MEALS,
    FIXED_DUTY_PRESETS,
    fixedDishwashMealsOf,
    fixedFoodwasteMealsOf,
    isFixedDishwashAt,
    isFixedFoodwasteAt,
    hasFixedDishwash,
    hasFixedFoodwaste,
    isFixedDishwashAllDay,
    fixedDutyPresetOf,
    fixedDutyPatchFor,
    COHORT_ORDER,
    COHORT_LABELS,
    rosterOrder,
    washOrder,
    WASH_COHORT_ORDER,
    WATER_MEAL,
    WATER_COUNT,
    WATER_START,
    WATER_RULES_FROM,
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
    defaultWaterState,
    defaultShoppingRoster,
    defaultMenuDefaults,
    defaultOverrides,
    menuSizeFor,
    onSave,
    saveWithoutNotifying,
    migrate,
  };
})();
