/* 產生班表頁面 */
window.App = window.App || {};
window.App.UI = window.App.UI || {};

(function () {
  "use strict";

  const container = () => document.getElementById("tab-schedule");
  let selectedDate = new Date().toISOString().slice(0, 10);

  function memberLabel(id) {
    const m = window.App.State.memberById(id);
    if (!m) return id;
    return `${m.cohort}-${m.seq} ${m.name}`;
  }

  function namesOrDash(ids) {
    return ids && ids.length ? ids.map(memberLabel).join("、") : "（無）";
  }

  const DUTY_ROWS = ["dishwash", "foodwaste", "lunchbag", "wipe", "floor", "delivery", "cleanup"];

  function mealCard(mealKey, mealData) {
    const label = window.App.State.MEAL_LABELS[mealKey];
    return `
      <div class="meal-card">
        <h3>${label}</h3>
        ${DUTY_ROWS.map(
          (duty) => `
          <div class="duty-line">
            <span class="duty-label">${window.App.State.DUTY_ICONS[duty]} ${window.App.State.DUTY_LABELS[duty]}</span>
            <span class="duty-names">${namesOrDash(mealData[duty])}</span>
          </div>`
        ).join("")}
      </div>`;
  }

  function render() {
    const state = window.App.State.get();
    const schedule = state.schedules[selectedDate];

    container().innerHTML = `
      <div class="card">
        <h2>選擇日期</h2>
        <div class="row">
          <input type="date" id="schedule-date" value="${selectedDate}">
          <button type="button" class="primary" id="generate-btn">${schedule ? "查看班表" : "產生班表"}</button>
          ${schedule ? `<button type="button" class="danger" id="regenerate-btn">重新產生（會影響公平次數，請小心使用）</button>` : ""}
        </div>
      </div>
      <div id="schedule-result"></div>
    `;

    const resultEl = container().querySelector("#schedule-result");
    if (schedule) {
      renderResult(resultEl, schedule);
    }

    bindEvents();
  }

  function renderResult(resultEl, schedule) {
    resultEl.innerHTML = `
      ${schedule.warnings && schedule.warnings.length
        ? `<div class="warning-box">${schedule.warnings.map((w) => "⚠️ " + w).join("<br>")}</div>`
        : ""
      }
      <div class="meal-grid">
        ${window.App.State.MEAL_KEYS.map((meal) => mealCard(meal, schedule.meals[meal])).join("")}
      </div>
    `;
  }

  function bindEvents() {
    const root = container();
    const dateInput = root.querySelector("#schedule-date");
    dateInput.addEventListener("change", () => {
      selectedDate = dateInput.value;
      render();
    });

    const generateBtn = root.querySelector("#generate-btn");
    generateBtn.addEventListener("click", () => {
      const result = window.App.ScheduleEngine.generateDay(selectedDate);
      if (!result.ok) {
        alert(result.error);
        return;
      }
      render();
      rerenderOthers();
    });

    const regenerateBtn = root.querySelector("#regenerate-btn");
    if (regenerateBtn) {
      regenerateBtn.addEventListener("click", () => {
        if (!confirm("重新產生會重新計算輪值次數與洗碗指標，確定要覆蓋這一天的班表嗎？")) return;
        const result = window.App.ScheduleEngine.generateDay(selectedDate, { force: true });
        if (!result.ok) {
          alert(result.error);
          return;
        }
        render();
        rerenderOthers();
      });
    }
  }

  function rerenderOthers() {
    if (window.App.UI.ShareCard) window.App.UI.ShareCard.render();
    if (window.App.UI.Shopping) window.App.UI.Shopping.render();
    if (window.App.UI.Dashboard) window.App.UI.Dashboard.render();
  }

  function getSelectedDate() {
    return selectedDate;
  }

  window.App.UI.Schedule = { render, getSelectedDate, memberLabel };
})();
