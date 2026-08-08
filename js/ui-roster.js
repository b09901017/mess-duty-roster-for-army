/* 名冊管理頁面 */
window.App = window.App || {};
window.App.UI = window.App.UI || {};

(function () {
  "use strict";

  const container = () => document.getElementById("tab-roster");

  function cohortChip(cohort) {
    const label = (window.App.State.COHORT_LABELS || {})[cohort] || `${cohort}梯`;
    return `<span class="chip chip-${cohort}">${label}</span>`;
  }

  function memberRow(m, today) {
    const St = window.App.State;
    const isActive = St.isActiveOn(m, today);
    const notYet = m.joinDate && today < m.joinDate;
    const statusChip = isActive
      ? `<span class="chip chip-${m.cohort}">在班</span>`
      : notYet
      ? `<span class="chip chip-inactive">尚未報到</span>`
      : `<span class="chip chip-inactive">已離開</span>`;
    const deliveryBadge = m.fixedRole === "delivery" ? ' <span class="chip chip-inactive">🛵固定送便當</span>' : "";
    return `
      <tr data-id="${m.id}">
        <td data-label="序號">${cohortChip(m.cohort)} ${m.seq}號</td>
        <td data-label="姓名">
          <input type="text" class="member-name-input" value="${escapeAttr(m.name)}" data-id="${m.id}">
          ${deliveryBadge}
        </td>
        <td data-label="加入日期">
          <input type="date" class="join-date-input" data-id="${m.id}" value="${m.joinDate || ""}">
        </td>
        <td data-label="離開日期">
          <input type="date" class="discharge-date-input" data-id="${m.id}" value="${m.dischargeDate || ""}">
          <select class="leave-mode-select" data-id="${m.id}">
            <option value="${St.LEAVE_AFTER_LUNCH}"${
              m.leaveMode !== St.LEAVE_IMMEDIATE ? " selected" : ""
            }>退伍（當天做到中午）</option>
            <option value="${St.LEAVE_IMMEDIATE}"${
              m.leaveMode === St.LEAVE_IMMEDIATE ? " selected" : ""
            }>退出（當天就不排）</option>
          </select>
        </td>
        <td data-label="狀態">${statusChip}</td>
        <td data-label="免排">
          <label class="tick"><input type="checkbox" class="skip-laundry" data-id="${m.id}" ${
            m.skipLaundry ? "checked" : ""
          }> 洗衣籃</label>
          <label class="tick"><input type="checkbox" class="skip-dinner-cleanup" data-id="${m.id}" ${
            m.skipDinnerCleanup ? "checked" : ""
          }> 晚上撤收</label>
          <label class="tick"><input type="checkbox" class="skip-water" data-id="${m.id}" ${
            m.skipWater ? "checked" : ""
          }> 換水</label>
          <label class="tick"><input type="checkbox" class="duty-exempt" data-id="${m.id}" ${
            m.dutyExempt ? "checked" : ""
          }> 🚻 只排掃廁所</label>
        </td>
        <td data-label="固定勤務">
          <select class="fixed-duty-select" data-id="${m.id}">
            ${St.FIXED_DUTY_PRESETS.map(
              (p) =>
                `<option value="${p.key}"${St.fixedDutyPresetOf(m) === p.key ? " selected" : ""}>${p.label}</option>`
            ).join("")}
          </select>
        </td>
        <td data-label="打菜固定角色">
          <select class="serving-role-select" data-id="${m.id}">
            <option value="">（輪替）</option>
            ${St.SERVING_FIXED_ROLES.map(
              (role) =>
                `<option value="${role}"${m.servingRole === role ? " selected" : ""}>${
                  St.SERVING_ROLE_LABELS[role]
                }</option>`
            ).join("")}
          </select>
        </td>
        <td data-label="操作">
          <button type="button" class="set-delivery-btn" data-id="${m.id}">${
            m.fixedRole === "delivery" ? "取消送便當" : "設為送便當"
          }</button>
        </td>
      </tr>`;
  }

  function escapeAttr(str) {
    return String(str).replace(/"/g, "&quot;");
  }

  function render() {
    const state = window.App.State.get();
    const today = window.App.State.todayStr();
    const deliveryMembers = window.App.Roster.getDeliveryMembers();
    const St = window.App.State;
    // 每個梯次一張表
    const cohortCards = St.COHORT_ORDER.map((cohort) => {
      const list = state.members.filter((m) => m.cohort === cohort).sort((a, b) => a.seq - b.seq);
      const activeCount = list.filter((m) => St.isActiveOn(m, today)).length;
      return { cohort, label: St.COHORT_LABELS[cohort] || cohort, list, activeCount };
    }).filter((c) => c.list.length);

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
            ${St.COHORT_ORDER.map(
              (c) => `<option value="${c}">${St.COHORT_LABELS[c] || c}</option>`
            ).join("")}
          </select>
          <button type="button" class="primary" id="add-member-btn">新增</button>
        </div>
      </div>

      ${cohortCards
        .map(
          (c) => `
      <div class="card">
        <h2>${c.label} (${c.activeCount} 現役 / ${c.list.length} 總數)</h2>
        ${
          c.cohort === "261"
            ? `<p class="hint">
          加入日期留空＝一開始就在；離開日期留空＝還在班。離開方式分兩種：
          <strong>退伍</strong>＝當天早餐、中餐照排、晚上才離營；<strong>退出</strong>（退出打飯班、調離）＝當天早上就不排了。
          「免排」可以個別勾掉抬洗衣籃、晚上的撤收與換水（招員五位預設三個都勾起來）。
          「固定勤務」是指定某幾餐固定做某一項、不進那一項的輪替——招員五位是
          <strong>早晚洗碗 ＋ 中午廚餘</strong>；洗碗的人那一餐不排撤收，廚餘沒有這條，所以他們中午照樣要排撤收。
          日期都可以先預填未來的，方便一次排完整個梯期。
        </p>`
            : ""
        }
        <div class="table-scroll">
        <table class="responsive-table">
          <thead><tr><th>序號</th><th>姓名</th><th>加入日期</th><th>離開日期</th><th>狀態</th><th>免排</th><th>固定勤務</th><th>打菜固定角色</th><th>操作</th></tr></thead>
          <tbody>${c.list.map((m) => memberRow(m, today)).join("") || emptyRow()}</tbody>
        </table>
        </div>
      </div>`
        )
        .join("")}

      <div class="card">
        <h2>資料重置</h2>
        <p class="hint">如果之前只是測試，想把所有勤務次數、已產生的班表、洗碗輪值指標、撤收分組、採買紀錄都歸零重來（人員名單會保留），可以按這個按鈕。</p>
        <button type="button" class="danger" id="reset-records-btn">🔄 重置所有勤務紀錄</button>
      </div>
    `;

    bindEvents();
  }

  function emptyRow() {
    return `<tr><td colspan="9" class="empty-state">尚無人員</td></tr>`;
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
        rerenderOthers();
      });
    });

    root.querySelectorAll(".join-date-input").forEach((input) => {
      input.addEventListener("change", () => {
        window.App.Roster.updateMember(input.dataset.id, { joinDate: input.value || null });
        window.App.ScheduleEngine.rebuildAll();
        render();
        rerenderAll();
      });
    });

    root.querySelectorAll(".skip-laundry").forEach((box) => {
      box.addEventListener("change", () => {
        window.App.Roster.updateMember(box.dataset.id, { skipLaundry: box.checked });
        window.App.ScheduleEngine.rebuildAll();
        render();
        rerenderAll();
      });
    });

    root.querySelectorAll(".skip-dinner-cleanup").forEach((box) => {
      box.addEventListener("change", () => {
        window.App.Roster.updateMember(box.dataset.id, { skipDinnerCleanup: box.checked });
        window.App.ScheduleEngine.rebuildAll();
        render();
        rerenderAll();
      });
    });

    root.querySelectorAll(".skip-water").forEach((box) => {
      box.addEventListener("change", () => {
        window.App.Roster.updateMember(box.dataset.id, { skipWater: box.checked });
        window.App.ScheduleEngine.rebuildAll();
        render();
        rerenderAll();
      });
    });

    /*
     * 「固定勤務」＝這個人哪幾餐固定做哪一項，不進那一項的輪替。
     * 招員五位是「早晚洗碗 ＋ 中午廚餘」。洗碗的人那一餐不排撤收，
     * 但廚餘沒有這條，所以他們中午做完廚餘照樣要排撤收。
     */
    root.querySelectorAll(".fixed-duty-select").forEach((sel) => {
      sel.addEventListener("change", () => {
        window.App.Roster.updateMember(sel.dataset.id, window.App.State.fixedDutyPatchFor(sel.value));
        window.App.ScheduleEngine.rebuildAll();
        render();
        rerenderAll();
      });
    });

    /* 愷宸只掃廁所：不做任何勤務，也不算進當天的出勤人數 */
    root.querySelectorAll(".duty-exempt").forEach((box) => {
      box.addEventListener("change", () => {
        window.App.Roster.updateMember(box.dataset.id, { dutyExempt: box.checked });
        window.App.ScheduleEngine.rebuildAll();
        render();
        rerenderAll();
      });
    });

    root.querySelectorAll(".serving-role-select").forEach((sel) => {
      sel.addEventListener("change", () => {
        window.App.Roster.updateMember(sel.dataset.id, { servingRole: sel.value || null });
        window.App.ScheduleEngine.rebuildAll();
        render();
        rerenderAll();
      });
    });

    root.querySelectorAll(".leave-mode-select").forEach((sel) => {
      sel.addEventListener("change", () => {
        window.App.Roster.updateMember(sel.dataset.id, { leaveMode: sel.value });
        window.App.ScheduleEngine.rebuildAll();
        render();
        rerenderAll();
      });
    });

    root.querySelectorAll(".discharge-date-input").forEach((input) => {
      input.addEventListener("change", () => {
        const result = window.App.Roster.setDischargeDate(input.dataset.id, input.value || null);
        if (result.deliveryVacancy) {
          alert("⚠️ 這位是固定送便當人員，退伍日之後送便當人力會出缺！請盡快在名冊中選2位新的「設為送便當」。");
        }
        window.App.ScheduleEngine.rebuildAll();
        render();
        rerenderAll();
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

    const resetBtn = root.querySelector("#reset-records-btn");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        if (!confirm("確定要重置所有勤務次數、班表、輪值指標與採買紀錄嗎？人員名單不會被刪除，這個動作無法復原。")) return;
        window.App.State.resetRecords();
        render();
        rerenderAll();
      });
    }
  }

  function rerenderOthers() {
    if (window.App.UI.DutyConfig) window.App.UI.DutyConfig.render();
    if (window.App.UI.Dashboard) window.App.UI.Dashboard.render();
  }

  function rerenderAll() {
    rerenderOthers();
    if (window.App.UI.Schedule) window.App.UI.Schedule.render();
    if (window.App.UI.TextSchedule) window.App.UI.TextSchedule.render();
    if (window.App.UI.Shopping) window.App.UI.Shopping.render();
  }

  window.App.UI.Roster = { render };
})();
