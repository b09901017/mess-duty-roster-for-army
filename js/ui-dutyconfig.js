/* 勤務設定頁面：人數縮減對照表 */
window.App = window.App || {};
window.App.UI = window.App.UI || {};

(function () {
  "use strict";

  const container = () => document.getElementById("tab-dutyconfig");
  const FIELDS = ["minActiveCount", "dishwash", "foodwaste", "wipe", "floor"];
  const FIELD_LABELS = {
    minActiveCount: "出勤人數≥",
    dishwash: "洗碗",
    foodwaste: "廚餘",
    wipe: "擦桌子",
    floor: "清地板",
  };

  function render() {
    const state = window.App.State.get();
    const table = window.App.DutySizeConfig.sortTable(state.dutySizeTable);
    const activeCount = window.App.State.activeMembers().length;
    const matched = window.App.DutySizeConfig.lookupDutySize(state.dutySizeTable, activeCount);

    container().innerHTML = `
      <div class="card">
        <h2>人數縮減對照表</h2>
        <p class="hint">
          依「那一餐實際出勤人數」對應各勤務需求人數。每一列的數字加上固定 2 位送便當，
          應該剛好等於出勤人數，這樣才不會有人沒事做。
          撤收會自動把在場的人分完到三餐（早餐最少），打菜流程另外看菜量，都不用在這裡設定。
        </p>
        ${
          matched
            ? `<div class="hint">目前現有人數 ${activeCount} 人 → 套用「現有人數≥${matched.minActiveCount}」這一列的設定。</div>`
            : `<div class="warning-box">⚠️ 目前現有人數 ${activeCount} 人，沒有對應設定！請新增一列涵蓋這個人數，否則無法產生班表。</div>`
        }
        <div class="table-scroll">
        <table>
          <thead><tr>${FIELDS.map((f) => `<th>${FIELD_LABELS[f]}</th>`).join("")}<th>操作</th></tr></thead>
          <tbody>
            ${table
              .map(
                (row, idx) => `
              <tr data-idx="${idx}">
                ${FIELDS.map(
                  (f) =>
                    `<td><input type="number" min="0" class="duty-size-input" data-field="${f}" data-min="${row.minActiveCount}" value="${row[f]}" style="width:70px"></td>`
                ).join("")}
                <td><button type="button" class="danger remove-row-btn" data-min="${row.minActiveCount}">刪除</button></td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
        </div>
        <div class="row" style="margin-top:12px">
          <button type="button" class="primary" id="add-row-btn">新增一列</button>
        </div>
      </div>
    `;

    container().insertAdjacentHTML("beforeend", menuCard());
    bindEvents();
  }

  /** 每天每餐幾道菜的設定表 */
  function menuCard() {
    const S = window.App.State;
    const dates = [];
    for (let d = new Date(S.DUTY_PERIOD_START + "T00:00:00"); ; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      dates.push(iso);
      if (iso >= S.DUTY_PERIOD_END) break;
    }
    const wd = ["日", "一", "二", "三", "四", "五", "六"];
    const defaults = S.get().menuDefaults || {};

    const rows = dates
      .map((iso) => {
        const day = wd[new Date(iso + "T00:00:00").getDay()];
        const cells = S.MEAL_KEYS.map(
          (meal) =>
            `<td><input type="number" min="0" max="12" class="menu-input"
              data-date="${iso}" data-meal="${meal}" value="${S.menuSizeFor(iso, meal)}"></td>`
        ).join("");
        return `<tr><th scope="row" class="menu-date">${iso.slice(5)}（${day}）</th>${cells}</tr>`;
      })
      .join("");

    return `
      <div class="card">
        <h2>每餐菜量</h2>
        <p class="hint">
          填「幾道菜」，不含飯。打飯固定 2 人，每道菜 2 人打菜。
          例如一飯五菜＝打飯2＋打菜10。改完會自動重算已確定的班表。
        </p>
        <div class="row" style="margin-bottom:12px">
          <span class="hint">預設值：</span>
          ${S.MEAL_KEYS.map(
            (meal) =>
              `<label class="tick">${S.MEAL_LABELS[meal]}
                <input type="number" min="0" max="12" class="menu-default-input" data-meal="${meal}"
                  value="${defaults[meal] || 0}" style="width:60px"></label>`
          ).join("")}
        </div>
        <div class="table-scroll">
        <table class="menu-table">
          <thead><tr><th>日期</th>${S.MEAL_KEYS.map((m) => `<th>${S.MEAL_LABELS[m]}</th>`).join("")}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
        </div>
      </div>`;
  }

  function bindEvents() {
    const root = container();
    root.querySelectorAll(".duty-size-input").forEach((input) => {
      input.addEventListener("change", () => {
        const state = window.App.State.get();
        const min = Number(input.dataset.min);
        const field = input.dataset.field;
        const row = state.dutySizeTable.find((r) => r.minActiveCount === min);
        if (!row) return;
        const value = Number(input.value) || 0;
        if (field === "minActiveCount") {
          row.minActiveCount = value;
        } else {
          row[field] = value;
        }
        window.App.State.save();
        render();
      });
    });

    root.querySelectorAll(".remove-row-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const state = window.App.State.get();
        const min = Number(btn.dataset.min);
        state.dutySizeTable = state.dutySizeTable.filter((r) => r.minActiveCount !== min);
        window.App.State.save();
        render();
      });
    });

    root.querySelectorAll(".menu-input").forEach((input) => {
      input.addEventListener("change", () => {
        const state = window.App.State.get();
        const { date, meal } = input.dataset;
        state.menuSizes = Object.assign({}, state.menuSizes);
        state.menuSizes[date] = Object.assign({}, state.menuSizes[date], { [meal]: Number(input.value) || 0 });
        window.App.ScheduleEngine.rebuildAll();
        rerenderSchedule();
      });
    });

    root.querySelectorAll(".menu-default-input").forEach((input) => {
      input.addEventListener("change", () => {
        const state = window.App.State.get();
        state.menuDefaults = Object.assign({}, state.menuDefaults, {
          [input.dataset.meal]: Number(input.value) || 0,
        });
        window.App.ScheduleEngine.rebuildAll();
        render();
        rerenderSchedule();
      });
    });

    const addBtn = root.querySelector("#add-row-btn");
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        const state = window.App.State.get();
        const existingMins = state.dutySizeTable.map((r) => r.minActiveCount);
        let newMin = 1;
        while (existingMins.includes(newMin)) newMin++;
        state.dutySizeTable.push({
          minActiveCount: newMin,
          dishwash: 1,
          foodwaste: 1,
          wipe: 1,
          floor: 1,
        });
        window.App.State.save();
        render();
      });
    }
  }

  function rerenderSchedule() {
    if (window.App.UI.Schedule) window.App.UI.Schedule.render();
    if (window.App.UI.TextSchedule) window.App.UI.TextSchedule.render();
    if (window.App.UI.Dashboard) window.App.UI.Dashboard.render();
  }

  window.App.UI.DutyConfig = { render };
})();
