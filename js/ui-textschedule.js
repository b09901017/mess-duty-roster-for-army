/*
 * 文字班表分頁。
 * 實際的文字組法在 js/textFormat.js（LINE bot 也用同一份），這裡只負責畫面與複製按鈕。
 */
window.App = window.App || {};
window.App.UI = window.App.UI || {};

(function () {
  "use strict";

  const container = () => document.getElementById("tab-textschedule");

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

    const TF = window.App.TextFormat;
    const names = TF.displayNameMap();

    container().innerHTML = `
      ${!committed ? `<div class="hint">目前顯示的是尚未確定紀錄的預覽內容。</div>` : ""}
      ${copyBlock("meal-text-area", "依餐別", "每一餐誰做什麼，適合值星自己對照確認。")}
      ${copyBlock("person-text-area", "依個人", "每個人一整天的分工，適合貼到群組讓大家找自己的名字。")}
    `;

    container().querySelector("#meal-text-area").value = TF.buildMealText(date, schedule, names);
    container().querySelector("#person-text-area").value = TF.buildPersonText(date, schedule, names);

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

  window.App.UI.TextSchedule = { render, buildDisplayNameMap: () => window.App.TextFormat.displayNameMap() };
})();
