/* 文字班表：適合直接複製貼到群組的純文字版面（依餐別／依個人），不含任何 emoji */
window.App = window.App || {};
window.App.UI = window.App.UI || {};

(function () {
  "use strict";

  const container = () => document.getElementById("tab-textschedule");

  function buildDisplayNameMap() {
    const state = window.App.State.get();
    const givenNameOwners = {};
    state.members.forEach((m) => {
      const given = m.name.length >= 2 ? m.name.slice(-2) : m.name;
      (givenNameOwners[given] = givenNameOwners[given] || []).push(m.id);
    });

    const map = {};
    state.members.forEach((m) => {
      const given = m.name.length >= 2 ? m.name.slice(-2) : m.name;
      map[m.id] = givenNameOwners[given].length > 1 ? m.name : given;
    });
    return map;
  }

  function formatDateHeader(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    const weekday = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
    const [, m, day] = dateStr.split("-");
    return `${Number(m)}/${Number(day)}（${weekday}）`;
  }

  function activeSorted(dateStr) {
    return window.App.State.activeMembersOn(dateStr).sort((a, b) => {
      if (a.cohort !== b.cohort) return a.cohort.localeCompare(b.cohort);
      return a.seq - b.seq;
    });
  }

  /** 採買集合時間，例如「0600 安官桌前集合」 */
  function shoppingNote(dateStr) {
    const state = window.App.State.get();
    const weekday = window.App.ShoppingRoster.weekdayOf(dateStr);
    const time = (state.shoppingTimes || {})[weekday];
    return time ? `${time} 安官桌前集合` : "";
  }

  function buildMealText(dateStr, schedule, displayNames) {
    const S = window.App.State;
    const active = activeSorted(dateStr);
    const nameList = (ids) => (ids && ids.length ? ids.map((id) => displayNames[id] || id).join("、") : "無");

    const lines = [];
    lines.push(`${formatDateHeader(dateStr)} 勤務班表`);

    S.MEAL_KEYS.forEach((mealKey) => {
      const mealData = schedule.meals[mealKey];
      lines.push("");
      lines.push(`【${S.MEAL_LABELS[mealKey]}】`);
      S.MEAL_DUTY_ROWS.forEach((rowKey) => {
        const ids = window.App.DutyView.mealRowIds(mealData, rowKey, active);
        lines.push(`${S.DUTY_LABELS[rowKey]}：${nameList(ids)}`);
      });
    });

    const daily = schedule.daily || {};
    const hasDaily = S.DAILY_DUTY_ROWS.some((k) => (daily[k] || []).length);
    if (hasDaily) {
      lines.push("");
      lines.push("【全日】");
      S.DAILY_DUTY_ROWS.forEach((rowKey) => {
        const ids = daily[rowKey] || [];
        if (!ids.length) return;
        const suffix = rowKey === "shopping" && shoppingNote(dateStr) ? `（${shoppingNote(dateStr)}）` : "";
        lines.push(`${S.DUTY_LABELS[rowKey]}：${nameList(ids)}${suffix}`);
      });
    }

    return lines.join("\n");
  }

  function buildPersonText(dateStr, schedule, displayNames) {
    const S = window.App.State;
    const lines = [];
    lines.push(`${formatDateHeader(dateStr)} 個人勤務`);

    const byCohort = {};
    activeSorted(dateStr).forEach((m) => {
      (byCohort[m.cohort] = byCohort[m.cohort] || []).push(m);
    });

    Object.keys(byCohort)
      .sort()
      .forEach((cohort) => {
        lines.push("");
        lines.push(`〔${cohort} 梯〕`);
        byCohort[cohort].forEach((m) => {
          lines.push("");
          lines.push(displayNames[m.id]);
          S.MEAL_KEYS.forEach((mealKey) => {
            const labels = window.App.DutyView.mealDutyLabels(schedule.meals[mealKey], m.id);
            lines.push(`  ${S.MEAL_LABELS[mealKey].slice(0, 1)}：${labels.length ? labels.join("、") : "休息"}`);
          });
          const dailyLabels = window.App.DutyView.dailyDutyLabels(schedule.daily, m.id);
          if (dailyLabels.length) lines.push(`  另：${dailyLabels.join("、")}`);
          const note = ((schedule.daily || {}).shopping || []).includes(m.id) ? shoppingNote(dateStr) : "";
          if (note) lines.push(`  採買：${note}`);
        });
      });

    return lines.join("\n");
  }

  function copyBlock(id, label, hint) {
    return `
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <h2 style="margin:0">${label}</h2>
          <button type="button" class="primary copy-btn" data-target="${id}">複製</button>
        </div>
        <p class="hint">${hint}</p>
        <textarea id="${id}" class="text-schedule-area" readonly rows="18"></textarea>
      </div>`;
  }

  function render() {
    const date = window.App.UI.Schedule ? window.App.UI.Schedule.getSelectedDate() : window.App.State.DUTY_PERIOD_START;
    const state = window.App.State.get();
    const committed = state.schedules[date];
    const preview = window.App.UI.Schedule ? window.App.UI.Schedule.getLastPreview() : null;
    const schedule = committed || preview;

    if (!schedule) {
      container().innerHTML = `<div class="empty-state">請先到「產生班表」頁面預覽或確定 ${date} 的班表，這裡就會出現可以複製的文字版本。</div>`;
      return;
    }

    const displayNames = buildDisplayNameMap();

    container().innerHTML = `
      ${!committed ? `<div class="hint">目前顯示的是尚未確定紀錄的預覽內容。</div>` : ""}
      ${copyBlock("meal-text-area", "依餐別", "每一餐誰做什麼，適合值星自己對照確認。")}
      ${copyBlock("person-text-area", "依個人", "每個人一整天的分工，適合貼到群組讓大家找自己的名字。")}
    `;

    container().querySelector("#meal-text-area").value = buildMealText(date, schedule, displayNames);
    container().querySelector("#person-text-area").value = buildPersonText(date, schedule, displayNames);

    bindEvents();
  }

  function bindEvents() {
    container()
      .querySelectorAll(".copy-btn")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          const textarea = container().querySelector(`#${btn.dataset.target}`);
          textarea.focus();
          textarea.select();
          let copied = false;
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(textarea.value);
              copied = true;
            }
          } catch (err) {
            copied = false;
          }
          if (!copied) {
            try {
              copied = document.execCommand("copy");
            } catch (err) {
              copied = false;
            }
          }
          const original = btn.textContent;
          btn.textContent = copied ? "已複製" : "請手動選取複製";
          setTimeout(() => (btn.textContent = original), 1500);
        });
      });
  }

  window.App.UI.TextSchedule = { render, buildDisplayNameMap };
})();
