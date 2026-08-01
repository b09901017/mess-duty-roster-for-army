/* 文字班表：適合直接複製貼到群組的純文字版面（依餐別／依個人） */
window.App = window.App || {};
window.App.UI = window.App.UI || {};

(function () {
  "use strict";

  const container = () => document.getElementById("tab-textschedule");
  const DUTY_ROWS = ["dishwash", "foodwaste", "lunchbag", "wipe", "floor", "delivery", "cleanup"];

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

  function buildMealText(dateStr, meals, displayNames) {
    const lines = [];
    lines.push(`${formatDateHeader(dateStr)} 勤務班表`);
    window.App.State.MEAL_KEYS.forEach((mealKey) => {
      const mealData = meals[mealKey];
      lines.push("");
      lines.push(`【${window.App.State.MEAL_LABELS[mealKey]}】`);
      DUTY_ROWS.forEach((duty) => {
        const ids = mealData[duty] || [];
        const names = ids.length ? ids.map((id) => displayNames[id] || id).join("、") : "－";
        lines.push(`${window.App.State.DUTY_LABELS[duty]}：${names}`);
      });
    });
    return lines.join("\n");
  }

  function buildPersonText(dateStr, meals, displayNames) {
    const state = window.App.State.get();
    const activeMembers = window.App.State.activeMembersOn(dateStr).sort((a, b) => {
      if (a.cohort !== b.cohort) return a.cohort.localeCompare(b.cohort);
      return a.seq - b.seq;
    });

    const lines = [];
    lines.push(`${formatDateHeader(dateStr)} 個人勤務總覽`);

    activeMembers.forEach((m) => {
      const parts = window.App.State.MEAL_KEYS.map((mealKey) => {
        const mealData = meals[mealKey];
        const duties = DUTY_ROWS.filter((duty) => (mealData[duty] || []).includes(m.id)).map(
          (duty) => window.App.State.DUTY_LABELS[duty]
        );
        const dutyText = duties.length ? duties.join("／") : "休息";
        return `${window.App.State.MEAL_LABELS[mealKey]} ${dutyText}`;
      });
      lines.push(`[${m.cohort}] ${displayNames[m.id]}：${parts.join("　")}`);
    });

    return lines.join("\n");
  }

  function copyBlock(id, label) {
    return `
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <h2 style="margin:0">${label}</h2>
          <button type="button" class="primary copy-btn" data-target="${id}">📋 複製</button>
        </div>
        <textarea id="${id}" class="text-schedule-area" readonly rows="16"></textarea>
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
    const mealText = buildMealText(date, schedule.meals, displayNames);
    const personText = buildPersonText(date, schedule.meals, displayNames);

    container().innerHTML = `
      ${!committed ? `<div class="hint">👀 目前顯示的是尚未確定紀錄的預覽內容。</div>` : ""}
      ${copyBlock("meal-text-area", "🍚 依餐別")}
      ${copyBlock("person-text-area", "🙋 依個人")}
    `;

    container().querySelector("#meal-text-area").value = mealText;
    container().querySelector("#person-text-area").value = personText;

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
          btn.textContent = copied ? "✅ 已複製" : "請手動選取複製";
          setTimeout(() => (btn.textContent = original), 1500);
        });
      });
  }

  window.App.UI.TextSchedule = { render, buildDisplayNameMap };
})();
