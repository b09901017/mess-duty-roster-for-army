/* 勤務設定頁面：人數縮減對照表 */
window.App = window.App || {};
window.App.UI = window.App.UI || {};

(function () {
  "use strict";

  const container = () => document.getElementById("tab-dutyconfig");
  const FIELDS = ["minActiveCount", "dishwash", "foodwaste", "lunchbag", "wipe", "floor"];
  const FIELD_LABELS = {
    minActiveCount: "現有人數≥",
    dishwash: "洗碗",
    foodwaste: "廚餘",
    lunchbag: "包便當袋子",
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
        <p class="hint">依「現有人數」對應各勤務需求人數。人數不足6→8→10...時可以自己往下加列調整。送便當固定2人、撤收人數會自動用「現有人數 ÷ 3」平均分配，不需要在這裡設定。</p>
        ${
          matched
            ? `<div class="hint">目前現有人數 ${activeCount} 人 → 套用「現有人數≥${matched.minActiveCount}」這一列的設定。</div>`
            : `<div class="warning-box">⚠️ 目前現有人數 ${activeCount} 人，沒有對應設定！請新增一列涵蓋這個人數，否則無法產生班表。</div>`
        }
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
        <div class="row" style="margin-top:12px">
          <button type="button" class="primary" id="add-row-btn">新增一列</button>
        </div>
      </div>
    `;

    bindEvents();
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
          lunchbag: 1,
          wipe: 1,
          floor: 1,
        });
        window.App.State.save();
        render();
      });
    }
  }

  window.App.UI.DutyConfig = { render };
})();
