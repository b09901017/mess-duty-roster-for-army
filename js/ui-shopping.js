/* 採買分頁：固定的星期輪值表（可編輯）+ 次數統計 */
window.App = window.App || {};
window.App.UI = window.App.UI || {};

(function () {
  "use strict";

  const container = () => document.getElementById("tab-shopping");
  // 顯示順序從週一開始，比較符合「週一到週四採買」的講法
  const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function memberOptions(selectedId) {
    const active = window.App.State.activeMembers();
    const opts = [`<option value="">（不用採買）</option>`];
    active.forEach((m) => {
      const sel = m.id === selectedId ? " selected" : "";
      opts.push(`<option value="${m.id}"${sel}>${escapeHtml(`${m.cohort}-${m.seq} ${m.name}`)}</option>`);
    });
    // 已離開但仍被指派的人也要出現在選單裡，否則畫面看起來像沒設定
    if (selectedId && !active.some((m) => m.id === selectedId)) {
      const m = window.App.State.memberById(selectedId);
      if (m) {
        opts.push(`<option value="${m.id}" selected>${escapeHtml(`${m.cohort}-${m.seq} ${m.name}`)}（已離開）</option>`);
      }
    }
    return opts.join("");
  }

  function render() {
    const state = window.App.State.get();
    const R = window.App.ShoppingRoster;
    const roster = state.shoppingRoster || {};

    const times = state.shoppingTimes || {};
    const rows = DISPLAY_ORDER.map((wd) => {
      const memberId = roster[wd] || "";
      const member = memberId ? window.App.State.memberById(memberId) : null;
      const retired = member && !window.App.State.isActiveOn(member, window.App.State.todayStr());
      return `
        <tr>
          <td data-label="星期">${R.WEEKDAY_LABELS[wd]}</td>
          <td data-label="採買人員">
            <select class="shopping-select" data-weekday="${wd}">${memberOptions(memberId)}</select>
            ${retired ? ` <span class="chip chip-inactive">已離開</span>` : ""}
          </td>
          <td data-label="集合時間">
            <input type="text" class="shopping-time" data-weekday="${wd}" style="width:90px"
              value="${escapeHtml(times[wd] || "")}" placeholder="例如 0600">
          </td>
        </tr>`;
    }).join("");

    const active = window.App.State.activeMembers();
    const countRows = active
      .map((m) => ({ m, count: (state.dutyCounts[m.id] && state.dutyCounts[m.id].shopping) || 0 }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count)
      .map((r) => `<tr><td>${escapeHtml(`${r.m.cohort}-${r.m.seq} ${r.m.name}`)}</td><td class="num">${r.count} 次</td></tr>`)
      .join("");

    container().innerHTML = `
      <div class="card">
        <h2>採買星期表</h2>
        <p class="hint">
          採買是固定的，不用臨時抽。這裡設定每個星期幾由誰去、幾點在安官桌前集合，留空代表那天不用採買。
          <strong>採買的人當天早餐、中餐完全不排勤務（含撤收），晚餐才歸隊</strong>，
          所以那兩餐的包便當袋子會自動少一個人。
        </p>
        <label class="field">
          <span>採買到哪一天為止（含當天）——之後就不用採買了，留空代表一直都要</span>
          <input type="date" id="shopping-until" value="${escapeHtml(state.shoppingUntil || "")}">
        </label>
        ${
          state.shoppingUntil
            ? `<div class="hint">目前設定：${state.shoppingUntil} 之後都不排採買。</div>`
            : ""
        }
        <div class="table-scroll">
        <table class="responsive-table">
          <thead><tr><th>星期</th><th>採買人員</th><th>集合時間</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        </div>
        <p class="hint" style="margin-top:12px">
          改完之後所有已確定的班表會自動重算，不用手動重排。
          如果指定的人在某天已經不在打飯班，產生那天班表時會跳提醒。
        </p>
      </div>

      <div class="card">
        <h2>累計採買次數</h2>
        <table>
          <thead><tr><th>人員</th><th class="num">次數</th></tr></thead>
          <tbody>${countRows || `<tr><td colspan="2" class="empty-state">還沒有已確定的班表</td></tr>`}</tbody>
        </table>
      </div>
    `;

    bindEvents();
  }

  function refreshAll() {
    window.App.ScheduleEngine.rebuildAll();
    render();
    if (window.App.UI.Schedule) window.App.UI.Schedule.render();
    if (window.App.UI.TextSchedule) window.App.UI.TextSchedule.render();
    if (window.App.UI.Dashboard) window.App.UI.Dashboard.render();
  }

  function bindEvents() {
    const root = container();

    root.querySelectorAll(".shopping-select").forEach((sel) => {
      sel.addEventListener("change", () => {
        const state = window.App.State.get();
        state.shoppingRoster = Object.assign({}, state.shoppingRoster, {
          [sel.dataset.weekday]: sel.value || null,
        });
        refreshAll();
      });
    });

    const untilInput = root.querySelector("#shopping-until");
    if (untilInput) {
      untilInput.addEventListener("change", () => {
        window.App.State.get().shoppingUntil = untilInput.value || null;
        refreshAll();
      });
    }

    // 集合時間只影響文字輸出，不影響排班，所以不用重播整份班表
    root.querySelectorAll(".shopping-time").forEach((input) => {
      input.addEventListener("change", () => {
        const state = window.App.State.get();
        state.shoppingTimes = Object.assign({}, state.shoppingTimes, {
          [input.dataset.weekday]: input.value.trim(),
        });
        window.App.State.save();
        if (window.App.UI.TextSchedule) window.App.UI.TextSchedule.render();
      });
    });
  }

  window.App.UI.Shopping = { render };
})();
