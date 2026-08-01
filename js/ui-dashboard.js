/* 公平性總覽：各人各勤務累計次數長條圖 */
window.App = window.App || {};
window.App.UI = window.App.UI || {};

(function () {
  "use strict";

  const container = () => document.getElementById("tab-dashboard");
  const DUTY_KEYS = ["dishwash", "foodwaste", "lunchbag", "wipe", "floor", "cleanup", "shopping"];

  function dutySection(dutyKey, members, dutyCounts) {
    const rows = members
      .map((m) => ({ m, count: (dutyCounts[m.id] && dutyCounts[m.id][dutyKey]) || 0 }))
      .sort((a, b) => b.count - a.count);
    const max = Math.max(1, ...rows.map((r) => r.count));

    return `
      <h3>${window.App.State.DUTY_ICONS[dutyKey]} ${window.App.State.DUTY_LABELS[dutyKey]}</h3>
      ${rows
        .map(
          (r) => `
        <div class="bar-row">
          <span class="bar-name">${r.m.cohort}-${r.m.seq} ${r.m.name}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${(r.count / max) * 100}%"></span></span>
          <span class="bar-value">${r.count}</span>
        </div>`
        )
        .join("")}
    `;
  }

  function render() {
    const state = window.App.State.get();
    const active = window.App.State.activeMembers().sort((a, b) => {
      if (a.cohort !== b.cohort) return a.cohort.localeCompare(b.cohort);
      return a.seq - b.seq;
    });

    container().innerHTML = `
      <div class="card">
        <h2>各項勤務累計次數（越平均越公平）</h2>
        ${DUTY_KEYS.map((duty) => dutySection(duty, active, state.dutyCounts)).join("")}
      </div>
    `;
  }

  window.App.UI.Dashboard = { render };
})();
