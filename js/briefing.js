/*
 * 解析伙房班長貼在群組裡的每日通知。
 *
 * 班長會在群組貼三種東西（通常一則訊息裡就全部有，也可能分開貼）：
 *
 *   1. 熱追      哪一台車（車尾號）送哪幾個點
 *   2. 便當數量  早／午／晚各連隊要幾個便當、幾個素食
 *   3. 行動準據  早／午／晚的時間流程
 *
 * 機器人收到就存起來（照日期），之後有人 @ 它就把這些內容做成卡片回出去。
 * 同一天再貼一次就整份覆蓋掉——班長常常前一天先貼、當天再修正。
 *
 * ── 日期怎麼決定 ────────────────────────────────────────────────
 * 每一段的標題自己會帶日期線索，優先序：
 *   1. 標題裡有寫日期（「8/8便當數量」「@All 8/8行動準據」）→ 就用那天
 *   2. 標題裡寫「明日／明天」→ 收到訊息那天的隔天（「明日三餐熱追」）
 *   3. 標題裡寫「今日／今天」→ 收到訊息那天
 *   4. 都沒寫 → 收到訊息那天
 * 所以「昨天貼今天的」跟「今天貼今天的」都認得出來。
 *
 * 這個檔不碰 DOM，因為 LINE bot 會把它丟進 vm sandbox 一起跑。
 */
window.App = window.App || {};

(function () {
  "use strict";

  const SECTION_KEYS = ["plan", "heat", "counts"];
  const SECTION_LABELS = { plan: "行動準據", heat: "熱追", counts: "便當數量" };

  // 標題怎麼認。順序有關係：「便當數量」要排在「熱追」前面比對嗎？不用，三個詞不會互相包含。
  const SECTION_PATTERNS = [
    { key: "heat", re: /熱追/ },
    { key: "counts", re: /便當數量/ },
    { key: "plan", re: /行動準據/ },
  ];

  const MEAL_BY_LABEL = {
    早餐: "breakfast",
    早: "breakfast",
    午餐: "lunch",
    中餐: "lunch",
    午: "lunch",
    晚餐: "dinner",
    晚: "dinner",
  };

  /** 這段文字看起來像不像班長貼的通知（webhook 用它決定要不要收） */
  function looksLikeBriefing(text) {
    const t = String(text || "");
    return SECTION_PATTERNS.filter((p) => p.re.test(t)).length > 0;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function shiftDate(dateStr, days) {
    const d = new Date(dateStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  /** 台灣時間的日期（UTC+8，沒有日光節約，直接加 8 小時就準） */
  function taipeiDate(receivedAt) {
    const t = receivedAt ? new Date(receivedAt).getTime() : Date.now();
    return new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10);
  }

  /**
   * 從段落標題推出這一段是講哪一天的。
   * @param {string} headerLine
   * @param {string} receivedDate - 收到訊息那天（yyyy-mm-dd）
   */
  function resolveDate(headerLine, receivedDate) {
    const line = String(headerLine || "");
    const md = line.match(/(\d{1,2})\s*[/\-月]\s*(\d{1,2})/);
    if (md) {
      const month = Number(md[1]);
      const day = Number(md[2]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${receivedDate.slice(0, 4)}-${pad2(month)}-${pad2(day)}`;
      }
    }
    if (/明日|明天|隔天/.test(line)) return shiftDate(receivedDate, 1);
    if (/今日|今天|本日/.test(line)) return receivedDate;
    return receivedDate;
  }

  /** 把整段文字切成 [{ key, header, lines }] */
  function splitSections(text) {
    const sections = [];
    let current = null;
    String(text || "")
      .split(/\r?\n/)
      .forEach((raw) => {
        const line = raw.trim();
        if (!line) return;
        const hit = SECTION_PATTERNS.find((p) => p.re.test(line));
        if (hit) {
          current = { key: hit.key, header: line, lines: [] };
          sections.push(current);
          return;
        }
        if (current) current.lines.push(line);
      });
    return sections;
  }

  /*
   * 熱追：一行一台車，「251八里/大埤頂/污水」。
   * 車尾號後面接的是那台車要跑的點，用 / 、 ， 之類分隔。
   *
   * 班長解釋過：尾號 251 送八里／大埤頂／污水，就是送步一二三連那三個點的車；
   * 戰支連沒有車（他們自己來拿），所以不會出現在這裡。
   */
  function parseHeat(lines) {
    const cars = [];
    lines.forEach((line) => {
      const m = line.match(/^(\d{2,4})\s*(.*)$/);
      if (!m) return;
      const spots = String(m[2] || "")
        .split(/[/／、,，\s]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      cars.push({ car: m[1], spots });
    });
    return cars;
  }

  /*
   * 便當數量：每一餐底下是「連隊名」與「地點＋數量」兩種行交錯出現。
   *
   *   早餐
   *   戰支連            ← 沒有數字：連隊名，下一行才是它的數量
   *   八仙120+3素        ← 有數字：地點 八仙、120 個、素食 3 個
   *   ...
   *   二營47+1素         ← 有數字但前面沒有掛連隊名：這一行自己就是連隊＋數量
   *
   * 所以規則是：沒有數字的行＝連隊名（記起來），有數字的行＝數量；
   * 有掛連隊名的話前綴是地點，沒掛的話前綴就是連隊名。
   */
  function parseCounts(lines) {
    const byMeal = { breakfast: [], lunch: [], dinner: [] };
    let meal = null;
    let pendingUnit = null;

    lines.forEach((line) => {
      const mealKey = MEAL_BY_LABEL[line];
      if (mealKey) {
        meal = mealKey;
        pendingUnit = null;
        return;
      }
      if (!meal) return;

      if (!/\d/.test(line)) {
        pendingUnit = line;
        return;
      }

      // 「污水廠 90+1素」「大埤頂123+2素」「公民會館114」「二營47+1素」
      const m = line.match(/^(\D*?)\s*(\d+)\s*(?:\+\s*(\d+)\s*素)?\s*$/);
      if (!m) return;
      const prefix = (m[1] || "").trim();
      const entry = {
        unit: pendingUnit || prefix,
        place: pendingUnit ? prefix : "",
        count: Number(m[2]),
        veg: m[3] ? Number(m[3]) : 0,
      };
      byMeal[meal].push(entry);
      pendingUnit = null;
    });

    return byMeal;
  }

  /*
   * 行動準據：每一餐底下是「時間＋要做什麼」。
   *   0420打飯班起床
   *   0430～0530打飯班作業
   */
  function parsePlan(lines) {
    const byMeal = { breakfast: [], lunch: [], dinner: [] };
    let meal = null;

    lines.forEach((line) => {
      const mealKey = MEAL_BY_LABEL[line];
      if (mealKey) {
        meal = mealKey;
        return;
      }
      if (!meal) return;
      const m = line.match(/^([\d:：]{3,5}(?:\s*[～~\-–—]\s*[\d:：]{3,5})?)\s*(.*)$/);
      if (!m) return;
      byMeal[meal].push({ time: m[1].trim(), what: (m[2] || "").trim() });
    });

    return byMeal;
  }

  /**
   * 解析班長貼的整段內容。
   *
   * @param {string} text
   * @param {string|number|Date} [receivedAt] - 收到訊息的時間（LINE 的 event.timestamp）
   * @returns {{ok:boolean, entries:object, dates:string[], warnings:string[]}}
   *   entries 是 { "2026-08-08": { plan, heat, counts, updatedAt } }
   */
  function parseBriefing(text, receivedAt) {
    const receivedDate = taipeiDate(receivedAt);
    const warnings = [];
    const entries = {};
    const sections = splitSections(text);

    sections.forEach((section) => {
      const date = resolveDate(section.header, receivedDate);
      entries[date] = entries[date] || {};
      if (section.key === "heat") entries[date].heat = parseHeat(section.lines);
      if (section.key === "counts") entries[date].counts = parseCounts(section.lines);
      if (section.key === "plan") entries[date].plan = parsePlan(section.lines);
    });

    const dates = Object.keys(entries).sort();
    dates.forEach((date) => {
      const e = entries[date];
      e.updatedAt = new Date(receivedAt || Date.now()).toISOString();
      const empty = SECTION_KEYS.filter((k) => {
        if (!e[k]) return false;
        if (k === "heat") return !e[k].length;
        return !Object.keys(e[k]).some((meal) => (e[k][meal] || []).length);
      });
      empty.forEach((k) => warnings.push(`${date} 的${SECTION_LABELS[k]}讀不到任何內容。`));
    });

    return { ok: dates.length > 0, entries, dates, warnings };
  }

  /**
   * 把新解析出來的內容併進舊的。同一天同一段整份覆蓋（班長修正後會重貼），
   * 沒有重貼的那幾段保留原本的。
   */
  function mergeBriefings(store, entries) {
    const next = Object.assign({}, store || {});
    Object.keys(entries || {}).forEach((date) => {
      const incoming = entries[date];
      const existing = next[date] || {};
      const merged = Object.assign({}, existing);
      SECTION_KEYS.forEach((k) => {
        if (incoming[k] !== undefined) merged[k] = incoming[k];
      });
      merged.updatedAt = incoming.updatedAt || new Date().toISOString();
      next[date] = merged;
    });
    return next;
  }

  /** 那一天有沒有東西可以顯示 */
  function hasContent(entry) {
    if (!entry) return false;
    if ((entry.heat || []).length) return true;
    return ["counts", "plan"].some((k) =>
      Object.keys(entry[k] || {}).some((meal) => (entry[k][meal] || []).length)
    );
  }

  /** 一餐的便當總數（含素食），卡片標題用 */
  function mealTotal(rows) {
    return (rows || []).reduce(
      (acc, r) => ({ count: acc.count + (r.count || 0), veg: acc.veg + (r.veg || 0) }),
      { count: 0, veg: 0 }
    );
  }

  window.App.Briefing = {
    SECTION_KEYS,
    SECTION_LABELS,
    looksLikeBriefing,
    parseBriefing,
    mergeBriefings,
    hasContent,
    mealTotal,
    resolveDate,
    taipeiDate,
    shiftDate,
  };
})();
