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

  /** 顯示用標籤 → 班表欄位。抬便當是規則不是名單，所以不收。 */
  const SERVING_LABEL_TO_KEY = {
    打飯: "rice",
    打菜: "serveDish",
    蓋便當: "lid",
    計數: "count",
    "抬飲料＋包餐盒": "drinks",
    抬飲料: "drinks",
    包餐盒: "boxing",
  };

  const DUTY_LABEL_TO_KEY = {
    洗碗: "dishwash",
    廚餘: "foodwaste",
    擦桌子: "wipe",
    清地板收垃圾: "floor",
    清地板: "floor",
    送便當: "delivery",
    撤收: "cleanup",
  };

  const DAILY_LABEL_TO_KEY = {
    採買: "shopping",
    "抬洗衣籃上來（下午）": "laundryUp",
    抬洗衣籃上來: "laundryUp",
    "抬洗衣籃下去（睡前）": "laundryDown",
    抬洗衣籃下去: "laundryDown",
  };

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

    const override = { meals: {}, daily: { shopping: [], laundryUp: [], laundryDown: [] } };
    window.App.State.MEAL_KEYS.forEach((meal) => {
      override.meals[meal] = { serving: {}, dishes: null };
    });

    let section = null; // "serving" | "duty" | null
    let meal = null; // breakfast/lunch/dinner，null 代表【全日】
    let sawAnything = false;

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
        const context = `${meal ? window.App.State.MEAL_LABELS[meal] : "全日"} ${label}`;

        if (meal === null) {
          const key = DAILY_LABEL_TO_KEY[label];
          if (!key) return;
          override.daily[key] = resolveNames(value, nameIndex, errors, context);
          sawAnything = true;
          return;
        }

        if (section === "serving") {
          const key = SERVING_LABEL_TO_KEY[label];
          if (!key) return;
          override.meals[meal].serving[key] = resolveNames(value, nameIndex, errors, context);
          sawAnything = true;
          return;
        }

        const key = DUTY_LABEL_TO_KEY[label];
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
      if (!Object.keys(data.serving).length && !Object.keys(seenDuty).length) {
        warnings.push(`${mealLabel} 這一餐沒有讀到任何內容。`);
      }
    });

    return { ok: errors.length === 0, override: errors.length ? null : override, errors, warnings };
  }

  function nameOf(members, id) {
    const m = members.find((x) => x.id === id);
    return m ? m.name : id;
  }

  window.App.ScheduleImport = { parseMealText, buildNameIndex };
})();
