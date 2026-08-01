/* 採買紀錄頁面 */
window.App = window.App || {};
window.App.UI = window.App.UI || {};

(function () {
  "use strict";

  const container = () => document.getElementById("tab-shopping");

  function render() {
    const state = window.App.State.get();
    const active = window.App.State.activeMembers();
    const today = window.App.UI.Schedule ? window.App.UI.Schedule.getSelectedDate() : new Date().toISOString().slice(0, 10);

    const historyRows = state.shoppingLog
      .slice()
      .reverse()
      .map((entry) => {
        const m = window.App.State.memberById(entry.memberId);
        return `<tr><td>${entry.date}</td><td>${window.App.State.MEAL_LABELS[entry.meal]}</td><td>${
          m ? `${m.cohort}-${m.seq} ${m.name}` : entry.memberId
        }</td></tr>`;
      })
      .join("");

    const countRows = active
      .slice()
      .sort((a, b) => {
        const ca = (state.dutyCounts[a.id] && state.dutyCounts[a.id].shopping) || 0;
        const cb = (state.dutyCounts[b.id] && state.dutyCounts[b.id].shopping) || 0;
        return cb - ca;
      })
      .map((m) => {
        const count = (state.dutyCounts[m.id] && state.dutyCounts[m.id].shopping) || 0;
        return `<tr><td>${m.cohort}-${m.seq} ${m.name}</td><td>${count} 次</td></tr>`;
      })
      .join("");

    container().innerHTML = `
      <div class="card">
        <h2>登記今天誰去採買</h2>
        <p class="hint">實際人選是用爬梯子等方式決定，這裡只是登記結果，工具會自動把他原本的勤務交給擦桌子的人代理，並記錄次數方便下次提醒。</p>
        <div class="row">
          <input type="date" id="shopping-date" value="${today}">
          <select id="shopping-meal">
            <option value="breakfast">早餐</option>
            <option value="lunch">中餐</option>
            <option value="dinner">晚餐</option>
          </select>
          <select id="shopping-member">
            ${active.map((m) => `<option value="${m.id}">${m.cohort}-${m.seq} ${m.name}</option>`).join("")}
          </select>
          <button type="button" class="primary" id="log-shopping-btn">登記</button>
        </div>
        <div id="shopping-feedback"></div>
      </div>

      <div class="card">
        <h2>採買次數統計</h2>
        <table>
          <thead><tr><th>人員</th><th>次數</th></tr></thead>
          <tbody>${countRows || `<tr><td colspan="2" class="empty-state">尚無紀錄</td></tr>`}</tbody>
        </table>
      </div>

      <div class="card">
        <h2>歷史紀錄</h2>
        <table>
          <thead><tr><th>日期</th><th>餐別</th><th>人員</th></tr></thead>
          <tbody>${historyRows || `<tr><td colspan="3" class="empty-state">尚無紀錄</td></tr>`}</tbody>
        </table>
      </div>
    `;

    bindEvents();
  }

  function bindEvents() {
    const root = container();
    const btn = root.querySelector("#log-shopping-btn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const date = root.querySelector("#shopping-date").value;
      const meal = root.querySelector("#shopping-meal").value;
      const memberId = root.querySelector("#shopping-member").value;
      const result = window.App.Shopping.logShopping(date, meal, memberId);
      if (!result.ok) {
        root.querySelector("#shopping-feedback").innerHTML = `<div class="warning-box">⚠️ ${result.error}</div>`;
        return;
      }
      let html = `<div class="hint">✅ ${result.note}</div>`;
      if (result.reminder) {
        html = `<div class="warning-box">⚠️ 這位這次是第 ${result.reminder.priorCount + 1} 次去採買了（全體平均 ${
          result.reminder.average
        } 次），下次爬梯子可以考慮讓其他人優先。</div>` + html;
      }
      render();
      root.querySelector("#shopping-feedback").innerHTML = html;
      if (window.App.UI.Schedule) window.App.UI.Schedule.render();
      if (window.App.UI.ShareCard) window.App.UI.ShareCard.render();
      if (window.App.UI.Dashboard) window.App.UI.Dashboard.render();
    });
  }

  window.App.UI.Shopping = { render };
})();
