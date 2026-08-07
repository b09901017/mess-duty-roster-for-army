/*
 * 把「文字班表」那頁複製出去的內容，原封不動讀回來變成當天的班表。
 *
 * 用途：勤務已經公布給大家了，之後又改了規則或名冊——這時候不能讓那天的班表跟著變，
 * 不然群組裡的人會發現公布過的東西又不一樣了。把已公布的那份貼回來鎖定，
 * 之後不管怎麼改規則，那天永遠照公布的版本，而且照樣計入公平性次數。
 *
 * 吃的就是 js/textFormat.js 的 buildMealText() 產生的格式，
 * 標號 emoji、分隔線、全形空白都可以留著，直接整段貼上就好。
 */
window.App = window.App || {};

(function () {
  "use strict";

  /*
   * 顯示用標籤 → 班表欄位。抬便當是規則不是名單，所以不收。
   *
   * ⚠️ 這幾張表**不要手寫**，一律從 state.js 的 DUTY_LABELS／DUTY_SHORT_LABELS 反推。
   * 以前是手寫的，標籤改過之後對照表沒跟上——「包餐盒」改叫「包便當」、掃廁所加上
   * 「（0900、2100）」——貼回來的班表就會**靜默漏掉**那幾行（parseMealText 查不到 key
   * 是直接 return，不會報錯），鎖定的那天於是少了一批人。改成反推之後，
   * 以後標籤怎麼改都跟得上。
   *
   * 括號裡的補充說明（「抬飲料（抬完包便當）」「計數（兼蓋便當）」「換水（早上撤收完）」）
   * 一律先去掉再比對，所以同一個欄位不管標題怎麼加註都認得。
   */
  function normalizeLabel(label) {
    return String(label || "")
      .replace(/[（(].*?[)）]/g, "")
      .trim();
  }

  /**
   * @param {string[]} keys - 要收的欄位
   * @param {object} labelTable - DUTY_LABELS 或 DUTY_SHORT_LABELS
   * @param {object} [aliases] - 舊班表上用過的說法（標籤改名前貼出去的那些）
   */
  function buildLabelIndex(keys, labelTable, aliases) {
    const index = {};
    Object.keys(aliases || {}).forEach((label) => (index[normalizeLabel(label)] = aliases[label]));
    keys.forEach((key) => {
      const label = labelTable[key];
      if (label) index[normalizeLabel(label)] = key;
    });
    return index;
  }

  // 標籤改名前已經公布出去的說法，還是要讀得回來
  const LEGACY_ALIASES = { 包餐盒: "boxing", "抬飲料＋包餐盒": "drinks", 清地板: "floor" };

  const MEAL_DUTY_KEYS = ["dishwash", "foodwaste", "wipe", "floor", "delivery", "cleanup"];

  const St0 = window.App.State;
  const SERVING_LABEL_TO_KEY = buildLabelIndex(St0.SERVING_ROWS, St0.DUTY_LABELS, LEGACY_ALIASES);
  const DUTY_LABEL_TO_KEY = buildLabelIndex(MEAL_DUTY_KEYS, St0.DUTY_LABELS, LEGACY_ALIASES);
  const DAILY_LABEL_TO_KEY = buildLabelIndex(St0.DAILY_DUTY_ROWS, St0.DUTY_LABELS, LEGACY_ALIASES);

  const MEAL_BY_LABEL = { 早餐: "breakfast", 中餐: "lunch", 晚餐: "dinner" };

  /** 名字 → 人員 id。同時收全名與後兩字，後兩字撞名的就只認全名。 */
  function buildNameIndex(members) {
    const index = {};
    const shortCount = {};
    members.forEach((m) => {
      const short = m.name.length >= 2 ? m.name.slice(-2) : m.name;
      shortCount[short] = (shortCount[short] || 0) + 1;
    });
    members.forEach((m) => {
      index[m.name] = m.id;
      const short = m.name.length >= 2 ? m.name.slice(-2) : m.name;
      if (shortCount[short] === 1) index[short] = m.id;
    });
    return index;
  }

  /** 把「楚祐、子宸、軍諺」拆成 id 陣列 */
  function resolveNames(raw, nameIndex, errors, context) {
    const text = String(raw || "").trim();
    if (!text || text === "無") return [];
    return text
      .split(/[、,，]/)
      .map((s) => s.replace(/[（(].*?[)）]/g, "").trim())
      .filter(Boolean)
      .map((name) => {
        const id = nameIndex[name];
        if (!id) errors.push(`${context}：名冊裡找不到「${name}」`);
        return id;
      })
      .filter(Boolean);
  }

  /** 去掉行首的標號（1️⃣ / 1. / ①）與空白 */
  function stripBullet(line) {
    return line
      .replace(/^[\s　]*(?:[0-9]+[.、)]|[1-9]️?⃣|🔟|[①-⑳])[\s　]*/u, "")
      .trim();
  }

  function splitLabel(line) {
    const idx = line.indexOf("：");
    if (idx === -1) return null;
    return { label: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
  }

  /**
   * @param {string} text - 從「文字班表 → 依餐別」複製出來的整段
   * @param {object[]} members - 名冊（含已離開的人，才認得出舊班表上的名字）
   * @returns {{ok: boolean, override: object|null, errors: string[], warnings: string[]}}
   */
  function parseMealText(text, members) {
    const errors = [];
    const warnings = [];
    const nameIndex = buildNameIndex(members);

    const override = { meals: {}, daily: { shopping: [], water: [], laundryUp: [], laundryDown: [] } };
    window.App.State.MEAL_KEYS.forEach((meal) => {
      override.meals[meal] = { serving: {}, dishes: null };
    });

    let section = null; // "serving" | "duty" | null
    let meal = null; // breakfast/lunch/dinner，null 代表【全日】
    let sawAnything = false;
    const seenMealHeaders = new Set();

    String(text || "")
      .split(/\r?\n/)
      .forEach((rawLine) => {
        const line = rawLine.trim();
        if (!line || /^[─—-]{3,}$/.test(line)) return;

        const mealHeader = line.match(/^【(.+?)】(.*)$/);
        if (mealHeader) {
          const label = mealHeader[1].trim();
          if (label === "全日") {
            meal = null;
          } else if (MEAL_BY_LABEL[label]) {
            meal = MEAL_BY_LABEL[label];
            seenMealHeaders.add(meal);
            const dishes = mealHeader[2].match(/(\d+)\s*菜/);
            if (dishes) override.meals[meal].dishes = Number(dishes[1]);
          } else {
            errors.push(`看不懂的標題「${line}」`);
          }
          section = null;
          return;
        }

        const sectionHeader = line.match(/^〔(.+?)〕$/);
        if (sectionHeader) {
          section = sectionHeader[1].trim() === "打菜" ? "serving" : "duty";
          return;
        }

        const parsed = splitLabel(stripBullet(line));
        if (!parsed) return; // 標題列（「8/5（三） 勤務班表」）之類的，跳過

        const { label, value } = parsed;
        // 括號裡是補充說明（「抬飲料（抬完包便當）」），比對前先拿掉
        const plain = normalizeLabel(label);
        const context = `${meal ? window.App.State.MEAL_LABELS[meal] : "全日"} ${label}`;

        if (meal === null) {
          const key = DAILY_LABEL_TO_KEY[plain];
          if (!key) return;
          override.daily[key] = resolveNames(value, nameIndex, errors, context);
          sawAnything = true;
          return;
        }

        if (section === "serving") {
          const key = SERVING_LABEL_TO_KEY[plain];
          if (!key) return;
          override.meals[meal].serving[key] = resolveNames(value, nameIndex, errors, context);
          sawAnything = true;
          return;
        }

        const key = DUTY_LABEL_TO_KEY[plain];
        // 抬便當上車、上樓寫的是規則不是名單，本來就不用讀
        if (!key) return;
        override.meals[meal][key] = resolveNames(value, nameIndex, errors, context);
        sawAnything = true;
      });

    if (!sawAnything) {
      errors.push("這段文字裡找不到任何勤務，請確認是從「文字班表 → 依餐別」複製的完整內容。");
    }

    // 每個人在同一餐只能有一個打菜角色、一個主要勤務
    window.App.State.MEAL_KEYS.forEach((mealKey) => {
      const data = override.meals[mealKey];
      const mealLabel = window.App.State.MEAL_LABELS[mealKey];
      const seenServing = {};
      Object.keys(data.serving).forEach((role) => {
        (data.serving[role] || []).forEach((id) => {
          if (seenServing[id]) errors.push(`${mealLabel}：${nameOf(members, id)} 同時出現在打菜的兩個位置`);
          seenServing[id] = role;
        });
      });
      const seenDuty = {};
      ["dishwash", "foodwaste", "wipe", "floor", "delivery"].forEach((k) => {
        (data[k] || []).forEach((id) => {
          if (seenDuty[id]) errors.push(`${mealLabel}：${nameOf(members, id)} 同時被排到兩項勤務`);
          seenDuty[id] = k;
        });
      });
      /*
       * 標題出現了卻一行都沒讀到，才值得提醒——那通常是只貼了一半。
       * 那天本來就沒有的餐（8/14 只吃早餐）標題不會出現，不該跳警告。
       */
      if (seenMealHeaders.has(mealKey) && !mealHasContent(data)) {
        warnings.push(`${mealLabel} 這一餐沒有讀到任何內容。`);
      }
    });

    pruneEmptyMeals(override);
    return { ok: errors.length === 0, override: errors.length ? null : override, errors, warnings };
  }

  const MEAL_CONTENT_KEYS = MEAL_DUTY_KEYS.concat(["carryVehicle", "carryUpstairs"]);
  function mealHasContent(data) {
    if (!data) return false;
    const serving = data.serving || {};
    if (Object.keys(serving).some((role) => (serving[role] || []).length)) return true;
    return MEAL_CONTENT_KEYS.some((k) => (data[k] || []).length);
  }

  /**
   * 一行都沒讀到的餐別要整個拿掉，不能留一個空殼。
   *
   * 排班引擎只看「這一餐有沒有 override」就決定要不要照鎖定的內容走，空殼是 truthy，
   * 會被當成「這一餐鎖定的結果就是沒有人」，整餐洗成空白。
   * 只貼了早餐那一段、或是 8/14 這種只有一餐的日子，都會踩到。
   */
  function pruneEmptyMeals(override) {
    Object.keys(override.meals).forEach((meal) => {
      if (!mealHasContent(override.meals[meal])) delete override.meals[meal];
    });
  }

  function nameOf(members, id) {
    const m = members.find((x) => x.id === id);
    return m ? m.name : id;
  }


  // ── 依個人格式 ──────────────────────────────────────────────────────
  /*
   * 「依個人」那份也要能貼回來鎖定，因為值星常常是複製那一份貼到群組的。
   * 格式長這樣：
   *     陳柏翰
   *       早　打菜：抬飲料
   *       　　勤務：洗碗、抬上車/上樓
   *       另：抬洗衣籃上來
   * 讀進來之後再「翻面」成依勤務的名單。
   */
  // 一樣從 DUTY_SHORT_LABELS 反推，不要手寫（理由見上面 buildLabelIndex 的說明）
  const SHORT_SERVING_TO_KEY = buildLabelIndex(St0.SERVING_ROWS, St0.DUTY_SHORT_LABELS, LEGACY_ALIASES);
  const SHORT_DUTY_TO_KEY = buildLabelIndex(MEAL_DUTY_KEYS, St0.DUTY_SHORT_LABELS, {
    清地板收垃圾: "floor",
  });
  const SHORT_DAILY_TO_KEY = buildLabelIndex(St0.DAILY_DUTY_ROWS, St0.DUTY_SHORT_LABELS, LEGACY_ALIASES);

  const MEAL_BY_HEAD = { 早: "breakfast", 中: "lunch", 晚: "dinner" };

  function emptyOverride() {
    const override = { meals: {}, daily: { shopping: [], water: [], laundryUp: [], laundryDown: [] } };
    window.App.State.MEAL_KEYS.forEach((meal) => {
      override.meals[meal] = { serving: {}, dishes: null };
      Object.keys(SHORT_DUTY_TO_KEY).forEach((label) => {
        override.meals[meal][SHORT_DUTY_TO_KEY[label]] = [];
      });
    });
    return override;
  }

  function push(target, key, id) {
    target[key] = target[key] || [];
    if (target[key].indexOf(id) === -1) target[key].push(id);
  }

  /**
   * @param {string} text - 從「文字班表 → 依個人」複製出來的整段
   * @param {object[]} members
   * @returns {{ok: boolean, override: object|null, errors: string[], warnings: string[]}}
   */
  function parsePersonText(text, members) {
    const St = window.App.State;
    const errors = [];
    const warnings = [];
    const nameIndex = buildNameIndex(members);
    const override = emptyOverride();

    let currentId = null;
    let currentName = "";
    let currentMeal = null;
    let sawAnything = false;

    String(text || "")
      .split(/\r?\n/)
      .forEach((rawLine) => {
        const line = rawLine.replace(/[　\s]+$/, "");
        const trimmed = line.trim();
        if (!trimmed || /^[─—-]{3,}$/.test(trimmed)) return;
        if (/^〔.*〕$/.test(trimmed)) return; // 〔261 梯〕
        if (/勤務班表$|個人勤務$/.test(trimmed)) return; // 標題列

        // 「早　打菜：…」「　　勤務：…」「另：…」「早：已離營」
        const mealServing = trimmed.match(/^([早中晚])[　\s]*打菜：(.*)$/);
        const mealDuty = trimmed.match(/^勤務：(.*)$/);
        const mealNote = trimmed.match(/^([早中晚])：(.*)$/);
        const extra = trimmed.match(/^另：(.*)$/);

        if (mealServing) {
          if (!currentId) return;
          currentMeal = MEAL_BY_HEAD[mealServing[1]];
          resolveShort(mealServing[2], SHORT_SERVING_TO_KEY, (key) => {
            push(override.meals[currentMeal].serving, key, currentId);
          }, `${currentName} ${mealServing[1]} 打菜`);
          sawAnything = true;
          return;
        }
        if (mealDuty) {
          if (!currentId || !currentMeal) return;
          resolveShort(mealDuty[1], SHORT_DUTY_TO_KEY, (key) => {
            push(override.meals[currentMeal], key, currentId);
          }, `${currentName} 勤務`);
          sawAnything = true;
          return;
        }
        if (extra) {
          if (!currentId) return;
          resolveShort(extra[1], SHORT_DAILY_TO_KEY, (key) => {
            push(override.daily, key, currentId);
          }, `${currentName} 另`);
          return;
        }
        if (mealNote) {
          // 「早：已離營」「早：採買」——那一餐沒有勤務
          currentMeal = MEAL_BY_HEAD[mealNote[1]];
          /*
           * 「依個人」的版面不會另外列一行採買名單（早、中那兩格已經寫「採買」了），
           * 所以採買的人只能從這裡撿回來。少了這一段，用依個人的文字鎖定那天
           * 會把採買名單洗成空的——而採買的人早、中整個不排，名單一沒了整天就變了。
           */
          if (currentId && /採買/.test(mealNote[2])) push(override.daily, "shopping", currentId);
          return;
        }

        // 剩下沒有冒號的單獨一行就是人名
        if (trimmed.indexOf("：") === -1) {
          const id = nameIndex[trimmed];
          if (!id) {
            errors.push(`名冊裡找不到「${trimmed}」`);
            currentId = null;
            return;
          }
          currentId = id;
          currentName = trimmed;
          currentMeal = null;
        }
      });

    function resolveShort(raw, table, onHit, context) {
      String(raw || "")
        .split(/[、,，]/)
        .map((x) => x.replace(/[（(].*?[)）]/g, "").trim())
        .filter((x) => x && x !== "無")
        .forEach((label) => {
          // 抬上車/上樓是規則不是名單；已離營之類的狀態字也略過
          if (/^抬上車|^抬上樓|^抬便當|已離營/.test(label)) return;
          const key = table[label];
          if (!key) {
            warnings.push(`${context}：看不懂「${label}」，已略過`);
            return;
          }
          onHit(key);
        });
    }

    if (!sawAnything) {
      errors.push("這段文字裡找不到任何分工，請確認是從「文字班表 → 依個人」複製的完整內容。");
    }

    /*
     * 依個人那份沒有寫幾道菜，從「打菜」的人數回推（每道菜 2 人）。
     */
    St.MEAL_KEYS.forEach((meal) => {
      const serveDish = (override.meals[meal].serving.serveDish || []).length;
      override.meals[meal].dishes = Math.ceil(serveDish / 2);
    });

    // 那天沒有的餐（8/14 只吃早餐）不能留空殼，不然那一餐會被鎖成空白
    pruneEmptyMeals(override);
    return { ok: errors.length === 0, override: errors.length ? null : override, errors, warnings };
  }

  /** 自動判斷貼進來的是哪一種格式 */
  function parseScheduleText(text, members) {
    return /〔打菜〕|〔勤務〕/.test(String(text || ""))
      ? parseMealText(text, members)
      : parsePersonText(text, members);
  }

  window.App.ScheduleImport = { parseMealText, parsePersonText, parseScheduleText, buildNameIndex };
})();
