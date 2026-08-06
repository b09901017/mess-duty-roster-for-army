/*
 * 把班表資料整理成「可以直接唸出來」的結構化文字列。
 *
 * 這裡刻意不碰 DOM，因為同一份邏輯有三個地方在用：
 *   1. 網頁的「文字班表」分頁
 *   2. LINE bot 的卡片
 *   3. 未來若要做別的輸出
 * 只要這個檔是唯一的來源，三邊就不會慢慢長歪。
 */
window.App = window.App || {};

(function () {
  "use strict";

  /** 名字預設只顯示後兩個字；後兩字撞名（陳柏翰／林柏翰）就顯示全名 */
  function displayNameMap(members) {
    const list = members || window.App.State.get().members;
    const owners = {};
    list.forEach((m) => {
      const given = m.name.length >= 2 ? m.name.slice(-2) : m.name;
      (owners[given] = owners[given] || []).push(m.id);
    });

    const map = {};
    list.forEach((m) => {
      const given = m.name.length >= 2 ? m.name.slice(-2) : m.name;
      map[m.id] = owners[given].length > 1 ? m.name : given;
    });
    return map;
  }

  function formatDateHeader(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    const weekday = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
    const [, m, day] = dateStr.split("-");
    return `${Number(m)}/${Number(day)}（${weekday}）`;
  }

  /** 採買集合時間，例如「0600 安官桌前集合」 */
  function shoppingNote(dateStr) {
    const state = window.App.State.get();
    const weekday = window.App.ShoppingRoster.weekdayOf(dateStr);
    const time = (state.shoppingTimes || {})[weekday];
    return time ? `${time} 安官桌前集合` : "";
  }

  function joinNames(ids, names) {
    if (!ids || !ids.length) return "無";
    return ids.map((id) => names[id] || id).join("、");
  }

  /**
   * 那一天實際有哪幾餐。8/14 任務下午前結束、只吃早餐，所以不能寫死三餐。
   * 以班表裡真的有的那幾餐為準，鎖定的舊班表（三餐都有）也還是讀得出來。
   */
  function mealKeysOf(dateStr, schedule) {
    const S = window.App.State;
    return S.MEAL_KEYS.filter((m) => (schedule.meals || {})[m] && S.mealIsOn(dateStr, m));
  }

  /** 名冊順序：261 → 263 → 旅部連，同梯依序號 */
  function sortedMembers(members) {
    return members.slice().sort(window.App.State.rosterOrder);
  }

  /**
   * 某一餐的內容，照實際流程分成幾段（前置／打菜／抬便當／善後／撤收）。
   * @returns {{heading:string, menu:string, sections:{title,hint,notes,rows:{label,value}[]}[]}}
   */
  function mealRows(dateStr, schedule, mealKey, names) {
    const S = window.App.State;
    const DV = window.App.DutyView;
    const mealData = schedule.meals[mealKey];
    const dishes = mealData.dishes != null ? mealData.dishes : S.menuSizeFor(dateStr, mealKey);
    const serving = (mealData && mealData.serving) || {};

    const sections = S.MEAL_SECTIONS.map((section) => {
      const rows = [];
      (section.rows || []).forEach((rowKey) => {
        if (S.SERVING_ROWS.indexOf(rowKey) !== -1) {
          const ids = serving[rowKey] || [];
          // 沒人的行就不用佔位（早餐沒有打飯；人不夠時沒有蓋便當、沒有包便當）
          if (!ids.length) return;
          let label = S.DUTY_LABELS[rowKey];
          // 人少的時候計數的兩位順手蓋便當，沒有獨立的蓋便當那一行，要在標題講清楚
          if (rowKey === "count" && mealData.countMergedIntoLid) label += "（兼蓋便當）";
          rows.push({ label, value: joinNames(ids, names) });
          return;
        }
        const description = DV.mealRowDescription(rowKey, mealData);
        const ids = DV.mealRowIds(mealData, rowKey);
        if (!description && !ids.length) return; // 例如送便當的兩位都退伍了
        rows.push({ label: S.DUTY_LABELS[rowKey], value: description || joinNames(ids, names) });
      });
      return { title: section.title, hint: section.hint || "", notes: (section.notes || []).slice(), rows };
    }).filter((section) => section.rows.length || section.notes.length);

    return { heading: S.MEAL_LABELS[mealKey], menu: S.menuLabel(mealKey, dishes), sections };
  }

  /** 全日勤務（採買、洗衣籃）；沒有的話回空陣列 */
  function dailyRows(dateStr, schedule, names) {
    const S = window.App.State;
    const daily = schedule.daily || {};
    const rows = [];
    S.DAILY_DUTY_ROWS.forEach((rowKey) => {
      const ids = daily[rowKey] || [];
      if (!ids.length) return;
      const note = rowKey === "shopping" ? shoppingNote(dateStr) : "";
      rows.push({
        label: S.DUTY_LABELS[rowKey],
        value: joinNames(ids, names) + (note ? `（${note}）` : ""),
      });
    });
    return rows;
  }

  /**
   * 某個人一整天的分工。
   * @returns {{id,seqLabel,name,meals:{head,serving,duties,note}[],extra:string[]}}
   */
  function personRows(dateStr, schedule, member, names) {
    const S = window.App.State;
    const DV = window.App.DutyView;

    /*
     * 只排掃廁所的人（愷宸）不做任何勤務，三餐都印「無」只是洗版，
     * 直接一句話帶過，底下的 extra 會列出掃廁所。
     */
    if (member.dutyExempt) {
      return {
        id: member.id,
        seqLabel: `${member.cohort}-${member.seq}`,
        name: names[member.id] || member.name,
        meals: [{ head: "全日", note: "只排掃廁所，不排三餐勤務" }],
        extra: DV.dailyDutyLabels(schedule.daily, member.id).slice(),
      };
    }

    const meals = mealKeysOf(dateStr, schedule).map((mealKey) => {
      const mealData = schedule.meals[mealKey];
      const head = S.MEAL_LABELS[mealKey].slice(0, 1);
      // 已離營或去採買的人，那一餐一句話帶過
      if (DV.hasDeparted(mealData, member.id) || DV.isAbsent(mealData, member.id)) {
        return { head, note: DV.mealDutyLabels(mealData, member.id)[0] };
      }
      const serving = DV.mealServingLabels(mealData, member.id);
      const duties = DV.mealDutyLabels(mealData, member.id);
      return {
        head,
        serving: serving.length ? serving.join("、") : "無",
        duties: duties.length ? duties.join("、") : "無",
      };
    });

    const extra = DV.dailyDutyLabels(schedule.daily, member.id).slice();
    /*
     * 採買的人早、中那兩格已經寫「採買」了，這裡不用再重複一行。
     * 只有設了集合時間才值得多寫一行，因為那是那兩格看不到的資訊。
     */
    if (((schedule.daily || {}).shopping || []).includes(member.id)) {
      const note = shoppingNote(dateStr);
      if (note) extra.push(`採買（${note}）`);
    }

    return {
      id: member.id,
      seqLabel: `${member.cohort}-${member.seq}`,
      name: names[member.id] || member.name,
      meals,
      extra,
    };
  }

  // 依餐別的文字班表會用 1234 標號，貼到群組時比較好一項一項對
  const STEP_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
  function step(n) {
    return STEP_EMOJI[n - 1] || `${n}.`;
  }

  const DIVIDER = "────────────────";

  /** 依餐別的完整純文字版 */
  function buildMealText(dateStr, schedule, names) {
    const S = window.App.State;
    const lines = [`${formatDateHeader(dateStr)} 勤務班表`];

    mealKeysOf(dateStr, schedule).forEach((mealKey) => {
      const block = mealRows(dateStr, schedule, mealKey, names);
      lines.push("", DIVIDER, `【${block.heading}】${block.menu}`);
      block.sections.forEach((section) => {
        lines.push("", `〔${section.title}〕${section.hint ? `（${section.hint}）` : ""}`);
        section.notes.forEach((note) => lines.push(`・${note}`));
        section.rows.forEach((row, i) => lines.push(`${step(i + 1)} ${row.label}：${row.value}`));
      });
    });

    const daily = dailyRows(dateStr, schedule, names);
    if (daily.length) {
      lines.push("", DIVIDER, "【全日】", "");
      daily.forEach((row, i) => lines.push(`${step(i + 1)} ${row.label}：${row.value}`));
    }

    return lines.join("\n");
  }

  /** 依個人的完整純文字版（照梯次分組） */
  function buildPersonText(dateStr, schedule, names) {
    const S = window.App.State;
    const lines = [`${formatDateHeader(dateStr)} 個人勤務`];

    const byCohort = {};
    sortedMembers(S.activeMembersOn(dateStr)).forEach((m) => {
      (byCohort[m.cohort] = byCohort[m.cohort] || []).push(m);
    });

    S.COHORT_ORDER.filter((cohort) => byCohort[cohort])
      .forEach((cohort) => {
        lines.push("", `〔${S.COHORT_LABELS[cohort] || cohort}〕`);
        byCohort[cohort].forEach((m) => {
          const person = personRows(dateStr, schedule, m, names);
          lines.push("", person.name);
          person.meals.forEach((meal) => {
            if (meal.note) {
              lines.push(`  ${meal.head}：${meal.note}`);
              return;
            }
            lines.push(`  ${meal.head}　打菜：${meal.serving}`);
            lines.push(`  　　勤務：${meal.duties}`);
          });
          person.extra.forEach((label) => lines.push(`  另：${label}`));
        });
      });

    return lines.join("\n");
  }

  window.App.TextFormat = {
    displayNameMap,
    formatDateHeader,
    shoppingNote,
    mealKeysOf,
    joinNames,
    sortedMembers,
    mealRows,
    dailyRows,
    personRows,
    buildMealText,
    buildPersonText,
    step,
    DIVIDER,
  };
})();
