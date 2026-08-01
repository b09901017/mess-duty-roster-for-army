/* 名冊管理頁面 */
window.App = window.App || {};
window.App.UI = window.App.UI || {};

(function () {
  "use strict";

  const container = () => document.getElementById("tab-roster");

  function cohortChip(cohort, active) {
    const cls = active ? `chip chip-${cohort}` : "chip chip-inactive";
    return `<span class="${cls}">${cohort}梯</span>`;
  }

  function memberRow(m) {
    const statusText = m.active ? "現役" : `已退伍${m.dischargeDate ? " (" + m.dischargeDate + ")" : ""}`;
    const deliveryBadge = m.fixedRole === "delivery" ? ' <span class="chip chip-inactive">🛵固定送便當</span>' : "";
    return `
      <tr data-id="${m.id}">
        <td>${cohortChip(m.cohort, m.active)} ${m.seq}號</td>
        <td>
          <input type="text" class="member-name-input" value="${escapeAttr(m.name)}" data-id="${m.id}">
          ${deliveryBadge}
        </td>
        <td>${statusText}</td>
        <td class="row">
          ${
            m.active
              ? `<button type="button" class="discharge-btn" data-id="${m.id}">退伍</button>
                 <button type="button" class="set-delivery-btn" data-id="${m.id}">${
                  m.fixedRole === "delivery" ? "取消送便當" : "設為送便當"
                }</button>`
              : `<button type="button" class="reactivate-btn" data-id="${m.id}">恢復現役</button>`
          }
        </td>
      </tr>`;
  }

  function escapeAttr(str) {
    return String(str).replace(/"/g, "&quot;");
  }

  function render() {
    const state = window.App.State.get();
    const members261 = state.members.filter((m) => m.cohort === "261").sort((a, b) => a.seq - b.seq);
    const members263 = state.members.filter((m) => m.cohort === "263").sort((a, b) => a.seq - b.seq);
    const deliveryMembers = window.App.Roster.getDeliveryMembers();

    container().innerHTML = `
      ${
        deliveryMembers.length !== 2
          ? `<div class="warning-box">⚠️ 目前固定送便當人力為 ${deliveryMembers.length} 人（正常應為2人）。請在下方名冊點「設為送便當」指定剛好2位。</div>`
          : `<div class="hint">目前固定送便當：${deliveryMembers.map((m) => `${m.cohort}-${m.seq} ${m.name}`).join("、")}</div>`
      }

      <div class="card">
        <h2>新增人員</h2>
        <div class="row">
          <input type="text" id="new-member-name" placeholder="姓名或代號">
          <select id="new-member-cohort">
            <option value="261">261梯</option>
            <option value="263">263梯</option>
          </select>
          <button type="button" class="primary" id="add-member-btn">新增</button>
        </div>
      </div>

      <div class="card">
        <h2>261 梯 (${members261.filter((m) => m.active).length} 現役 / ${members261.length} 總數)</h2>
        <table>
          <thead><tr><th>序號</th><th>姓名</th><th>狀態</th><th>操作</th></tr></thead>
          <tbody>${members261.map(memberRow).join("") || emptyRow()}</tbody>
        </table>
      </div>

      <div class="card">
        <h2>263 梯 (${members263.filter((m) => m.active).length} 現役 / ${members263.length} 總數)</h2>
        <table>
          <thead><tr><th>序號</th><th>姓名</th><th>狀態</th><th>操作</th></tr></thead>
          <tbody>${members263.map(memberRow).join("") || emptyRow()}</tbody>
        </table>
      </div>
    `;

    bindEvents();
  }

  function emptyRow() {
    return `<tr><td colspan="4" class="empty-state">尚無人員</td></tr>`;
  }

  function bindEvents() {
    const root = container();

    const addBtn = root.querySelector("#add-member-btn");
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        const nameInput = root.querySelector("#new-member-name");
        const cohortSelect = root.querySelector("#new-member-cohort");
        window.App.Roster.addMember({ name: nameInput.value.trim(), cohort: cohortSelect.value });
        render();
        rerenderOthers();
      });
    }

    root.querySelectorAll(".member-name-input").forEach((input) => {
      input.addEventListener("change", () => {
        window.App.Roster.updateMember(input.dataset.id, { name: input.value.trim() });
      });
    });

    root.querySelectorAll(".discharge-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const dateStr = prompt("退伍日期 (YYYY-MM-DD)，留空則用今天：", "");
        const result = window.App.Roster.dischargeMember(id, dateStr || undefined);
        if (result.deliveryVacancy) {
          alert("⚠️ 這位是固定送便當人員，人力已出缺！請在名冊中選2位新的「設為送便當」。");
        }
        render();
        rerenderOthers();
      });
    });

    root.querySelectorAll(".reactivate-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        window.App.Roster.reactivateMember(btn.dataset.id);
        render();
        rerenderOthers();
      });
    });

    root.querySelectorAll(".set-delivery-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const current = window.App.Roster.getDeliveryMembers().map((m) => m.id);
        let next;
        if (current.includes(id)) {
          next = current.filter((x) => x !== id);
        } else {
          next = current.concat([id]);
          if (next.length > 2) {
            alert("固定送便當最多只能2人，請先取消一位再指定新的。");
            return;
          }
        }
        window.App.Roster.setDeliveryMembers(next);
        render();
        rerenderOthers();
      });
    });
  }

  function rerenderOthers() {
    if (window.App.UI.DutyConfig) window.App.UI.DutyConfig.render();
    if (window.App.UI.Dashboard) window.App.UI.Dashboard.render();
  }

  window.App.UI.Roster = { render };
})();
