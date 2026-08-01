/* 分享卡：可截圖/列印的當日班表視覺化版面 */
window.App = window.App || {};
window.App.UI = window.App.UI || {};

(function () {
  "use strict";

  const container = () => document.getElementById("tab-sharecard");

  function memberShortLabel(id) {
    const m = window.App.State.memberById(id);
    if (!m) return id;
    const cls = m.cohort === "261" ? "chip-261" : "chip-263";
    return `<span class="chip ${cls}" style="font-weight:400">${m.name}</span>`;
  }

  function namesOrDash(ids) {
    return ids && ids.length ? ids.map(memberShortLabel).join(" ") : "－";
  }

  const DUTY_ROWS = ["dishwash", "foodwaste", "lunchbag", "wipe", "floor", "delivery", "cleanup"];

  function mealBlock(mealKey, mealData) {
    return `
      <div class="share-meal">
        <h3>${window.App.State.MEAL_LABELS[mealKey]}</h3>
        ${DUTY_ROWS.map(
          (duty) => `
          <div class="share-duty">
            <span class="icon">${window.App.State.DUTY_ICONS[duty]}</span>
            <span class="label">${window.App.State.DUTY_LABELS[duty]}</span>
            <span>${namesOrDash(mealData[duty])}</span>
          </div>`
        ).join("")}
      </div>`;
  }

  function render() {
    const state = window.App.State.get();
    const date = window.App.UI.Schedule ? window.App.UI.Schedule.getSelectedDate() : new Date().toISOString().slice(0, 10);
    const schedule = state.schedules[date];

    if (!schedule) {
      container().innerHTML = `<div class="empty-state">請先到「產生班表」頁面產生 ${date} 的班表。</div>`;
      return;
    }

    container().innerHTML = `
      <div class="card">
        <div class="row">
          <button type="button" class="primary" id="print-btn">🖨️ 列印 / 存成 PDF</button>
          <span class="hint">列印時只會印出下面的班表卡片，方便截圖分享到群組。</span>
        </div>
      </div>
      <div class="share-card printable card">
        <div class="share-title">🍚 今日勤務表</div>
        <div class="share-date">${date}</div>
        ${window.App.State.MEAL_KEYS.map((meal) => mealBlock(meal, schedule.meals[meal])).join("")}
      </div>
    `;

    const printBtn = container().querySelector("#print-btn");
    if (printBtn) printBtn.addEventListener("click", () => window.print());
  }

  window.App.UI.ShareCard = { render };
})();
