/* 產生班表頁面：先預覽，按下確定才會真正紀錄 */
window.App = window.App || {};
window.App.UI = window.App.UI || {};

(function () {
  "use strict";

  const container = () => document.getElementById("tab-schedule");
  let selectedDate = window.App.State.DUTY_PERIOD_START;
  let lastPreview = null;

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
    const committed = !!state.schedules[selectedDate];

    container().innerHTML = `
      <div class="card">
        <h2>選擇日期</h2>
        <p class="hint">這次勤務只安排 ${window.App.State.DUTY_PERIOD_START} ～ ${window.App.State.DUTY_PERIOD_END}。</p>
        <div class="row">
          <input type="date" id="schedule-date" value="${selectedDate}"
            min="${window.App.State.DUTY_PERIOD_START}" max="${window.App.State.DUTY_PERIOD_END}">
          <button type="button" class="primary" id="preview-btn">🔍 預覽（不會紀錄）</button>
          ${
            committed
              ? `<span class="chip chip-inactive">✅ 這天已經確定紀錄過了</span>
                 <button type="button" class="danger" id="regenerate-btn">重新產生並覆蓋（會影響公平次數，請小心使用）</button>`
              : `<button type="button" class="primary" id="confirm-btn" ${lastPreview ? "" : "disabled"}>✅ 確定紀錄</button>`
          }
        </div>
      </div>
      <div id="schedule-result"></div>
    `;

    const resultEl = container().querySelector("#schedule-result");
    if (committed) {
      renderResult(resultEl, state.schedules[selectedDate], true);
      lastPreview = null;
    } else if (lastPreview && lastPreview.date === selectedDate) {
      renderResult(resultEl, lastPreview, false);
    } else {
      resultEl.innerHTML = `<div class="empty-state">按上面「預覽」看看這天的班表（不會被記錄），確認沒問題後再按「確定紀錄」。</div>`;
    }

    bindEvents();
  }

  function renderResult(resultEl, schedule, committed) {
    resultEl.innerHTML = `
      ${!committed ? `<div class="hint">👀 這是預覽結果，尚未紀錄，可以重複按「預覽」測試，不會影響公平次數。</div>` : ""}
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
      lastPreview = null;
      render();
    });

    const previewBtn = root.querySelector("#preview-btn");
    previewBtn.addEventListener("click", () => {
      const result = window.App.ScheduleEngine.previewDay(selectedDate);
      if (!result.ok) {
        alert(result.error);
        return;
      }
      lastPreview = { date: selectedDate, meals: result.meals, warnings: result.warnings };
      render();
      rerenderOthers();
    });

    const confirmBtn = root.querySelector("#confirm-btn");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", () => {
        if (!lastPreview || lastPreview.date !== selectedDate) {
          alert("請先按「預覽」看過這天的班表再確定紀錄。");
          return;
        }
        const result = window.App.ScheduleEngine.commitDay(selectedDate);
        if (!result.ok) {
          alert(result.error);
          return;
        }
        lastPreview = null;
        render();
        rerenderOthers();
      });
    }

    const regenerateBtn = root.querySelector("#regenerate-btn");
    if (regenerateBtn) {
      regenerateBtn.addEventListener("click", () => {
        if (!confirm("重新產生會覆蓋這一天已確定的班表，並可能讓洗碗/撤收輪值往前推進，確定要繼續嗎？")) return;
        const result = window.App.ScheduleEngine.commitDay(selectedDate, { force: true });
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
    if (window.App.UI.TextSchedule) window.App.UI.TextSchedule.render();
    if (window.App.UI.Shopping) window.App.UI.Shopping.render();
    if (window.App.UI.Dashboard) window.App.UI.Dashboard.render();
  }

  function getSelectedDate() {
    return selectedDate;
  }

  function getLastPreview() {
    return lastPreview && lastPreview.date === selectedDate ? lastPreview : null;
  }

  window.App.UI.Schedule = { render, getSelectedDate, getLastPreview, memberLabel };
})();
