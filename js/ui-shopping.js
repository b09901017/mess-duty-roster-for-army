/*
 * 採買分頁：逐日勾選誰去採買 ＋ 集合時間 ＋ 次數統計。
 *
 * 沒有固定星期、也沒有固定人數——哪天要採買、派幾個人，都是當下才決定的，
 * 所以是一天一列、直接勾人。勾到的人那天早餐、中餐完全不排（打菜、勤務、撤收都不排），
 * 晚上才歸隊，班表會自動跟著少人。
 */
window.App = window.App || {};
window.App.UI = window.App.UI || {};

(function () {
  "use strict";

  const container = () => document.getElementById("tab-shopping");
  // 勾一個人就重畫整頁，展開的那天會縮回去——記住哪幾天是展開的，重畫後還原
  const openDates = new Set();

  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function periodDates() {
    const S = window.App.State;
    const dates = [];
    for (let d = new Date(S.DUTY_PERIOD_START + "T00:00:00"); ; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      dates.push(iso);
      if (iso >= S.DUTY_PERIOD_END) break;
    }
    return dates;
  }

  /** 那一天可以被派去採買的人（早上還在營的） */
  function candidatesOn(dateStr) {
    const S = window.App.State;
    return S.get()
      .members.filter((m) => S.isActiveOn(m, dateStr, "breakfast"))
      .sort(S.rosterOrder);
  }

  function dayRow(dateStr, picked, names) {
    const S = window.App.State;
    const R = window.App.ShoppingRoster;
    const wd = R.weekdayOf(dateStr);
    const time = (S.get().shoppingTimes || {})[wd] || "";
    const candidates = candidatesOn(dateStr);

    const boxes = candidates
      .map((m) => {
        const on = picked.indexOf(m.id) !== -1;
        return `<label class="tick"><input type="checkbox" class="shopper-box" data-date="${dateStr}" data-id="${m.id}"${
          on ? " checked" : ""
        }> ${escapeHtml(names[m.id] || m.name)}</label>`;
      })
      .join("");

    // 名單裡有人已經不在營了，還是要顯示出來讓人發現
    const ghosts = picked.filter((id) => !candidates.some((m) => m.id === id));

    return `
      <details class="card shopping-day" data-date="${dateStr}"${
        picked.length || openDates.has(dateStr) ? " open" : ""
      }>
        <summary style="cursor:pointer">
          <strong>${dateStr.slice(5)}（${R.WEEKDAY_LABELS[wd].slice(1)}）</strong>
          ${
            picked.length
              ? `<span class="chip chip-261">採買 ${picked.length} 人</span> ${escapeHtml(
                  picked.map((id) => names[id] || id).join("、")
                )}`
              : `<span class="hint">不用採買</span>`
          }
        </summary>
        <div class="row" style="margin:10px 0">
          <span class="hint">集合時間</span>
          <input type="text" class="shopping-time" data-weekday="${wd}" style="width:100px"
            value="${escapeHtml(time)}" placeholder="例如 0600">
          <span class="hint">（同一個星期共用）</span>
        </div>
        <div>${boxes || '<span class="hint">這天沒有人在營。</span>'}</div>
        ${
          ghosts.length
            ? `<div class="warning-box" style="margin-top:8px">⚠️ 名單裡的 ${escapeHtml(
                ghosts.map((id) => names[id] || id).join("、")
              )} 這天已經不在營，請取消勾選或改派他人。</div>`
            : ""
        }
      </details>`;
  }

  function render() {
    const S = window.App.State;
    const state = S.get();
    const byDate = state.shoppingByDate || {};
    const names = window.App.TextFormat.displayNameMap();

    const dayCards = periodDates()
      .map((dateStr) => dayRow(dateStr, (byDate[dateStr] || []).slice(), names))
      .join("");

    const active = S.activeMembers();
    const countRows = active
      .map((m) => ({ m, count: (state.dutyCounts[m.id] && state.dutyCounts[m.id].shopping) || 0 }))
      .sort((a, b) => b.count - a.count || S.rosterOrder(a.m, b.m))
      .map(
        (r) => `<tr>
          <td>${escapeHtml(`${r.m.cohort}-${r.m.seq} ${r.m.name}`)}</td>
          <td class="num">${r.count}</td>
        </tr>`
      )
      .join("");

    container().innerHTML = `
      <div class="card">
        <h2>採買</h2>
        <p class="hint">
          沒有固定星期、也沒有固定人數，哪天要採買就展開那一天勾人，一天勾幾個都可以。
          <strong>勾到的人那天早餐、中餐完全不排</strong>（打菜、勤務、撤收、換水都不排），晚上才歸隊，
          班表的人數、洗碗佇列、撤收名額會自動跟著少。集合時間會印在文字班表上。
        </p>
      </div>
      ${dayCards}
      <div class="card">
        <h2>採買次數（從 ${S.COUNTS_FROM} 起算）</h2>
        <div class="table-scroll">
        <table>
          <thead><tr><th>人員</th><th class="num">次數</th></tr></thead>
          <tbody>${countRows}</tbody>
        </table>
        </div>
      </div>
    `;

    bindEvents();
  }

  function bindEvents() {
    const root = container();

    root.querySelectorAll(".shopping-day").forEach((el) => {
      el.addEventListener("toggle", () => {
        if (el.open) openDates.add(el.dataset.date);
        else openDates.delete(el.dataset.date);
      });
    });

    root.querySelectorAll(".shopper-box").forEach((box) => {
      box.addEventListener("change", () => {
        const state = window.App.State.get();
        const { date, id } = box.dataset;
        const next = Object.assign({}, state.shoppingByDate);
        const list = (next[date] || []).slice();
        const idx = list.indexOf(id);
        if (box.checked && idx === -1) list.push(id);
        if (!box.checked && idx !== -1) list.splice(idx, 1);
        if (list.length) next[date] = list;
        else delete next[date];
        state.shoppingByDate = next;
        openDates.add(date); // 重畫之後這一天要維持展開，才好接著勾下一個人
        window.App.ScheduleEngine.rebuildAll();
        render();
        rerenderAll();
      });
    });

    root.querySelectorAll(".shopping-time").forEach((input) => {
      input.addEventListener("change", () => {
        const state = window.App.State.get();
        state.shoppingTimes = Object.assign({}, state.shoppingTimes, {
          [input.dataset.weekday]: input.value.trim(),
        });
        window.App.State.save();
        render();
        rerenderAll();
      });
    });
  }

  function rerenderAll() {
    if (window.App.UI.Schedule) window.App.UI.Schedule.render();
    if (window.App.UI.TextSchedule) window.App.UI.TextSchedule.render();
    if (window.App.UI.Dashboard) window.App.UI.Dashboard.render();
  }

  window.App.UI.Shopping = { render };
})();
