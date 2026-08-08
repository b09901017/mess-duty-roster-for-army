/* 名冊管理頁面 */
window.App = window.App || {};
window.App.UI = window.App.UI || {};

(function () {
  "use strict";

  const container = () => document.getElementById("tab-roster");

  /*
   * 三餐勤務停用之後，名冊上有一半的欄位是沒有作用的：
   *   固定勤務（洗碗／廚餘）、打菜固定角色、設為送便當、免排晚上撤收
   * 這些欄位管的勤務程式都不排了，留在主表上只是讓人以為「改了會有用」。
   *
   * 所以預設收起來，需要的時候再按「顯示進階欄位」打開——欄位本身沒有刪，
   * 三餐勤務恢復的時候把預設改成 true 就好。
   */
  let showAdvanced = false;

  /*
   * 已經離開的人（江偉綸、招員五位…）預設不顯示。
   * 名冊上 28 個人裡只有 20 個還在，全部攤開來要捲很久，而已離開的人
   * 除了「日期填錯要改」之外不會再動到。需要時按一下就展開。
   */
  let showDeparted = false;

  function cohortChip(cohort) {
    const label = (window.App.State.COHORT_LABELS || {})[cohort] || `${cohort}梯`;
    return `<span class="chip chip-${cohort}">${label}</span>`;
  }

  /** 摘要那一行的狀態說明，例如「8/14 退伍」「尚未報到」 */
  function memberMeta(m, today) {
    const St = window.App.State;
    const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
    if (m.joinDate && today < m.joinDate) return `${md(m.joinDate)} 才報到`;
    if (!St.isActiveOn(m, today)) return m.dischargeDate ? `${md(m.dischargeDate)} 已離開` : "已離開";
    if (m.dischargeDate) {
      return `${md(m.dischargeDate)} ${m.leaveMode === St.LEAVE_IMMEDIATE ? "退出" : "退伍"}`;
    }
    return "";
  }

  /*
   * 一個人一列，點開才看得到可以改的欄位。
   *
   * 以前是一個大表格，手機上每個欄位都被攤成一整塊（序號、姓名、加入、離開、狀態、免排…），
   * 20 個人要捲一萬多像素。改成收合之後預設一人一行，要改誰再點開誰。
   */
  function memberRow(m, today) {
    const St = window.App.State;
    const isActive = St.isActiveOn(m, today);
    const meta = memberMeta(m, today);
    const flags = [
      m.dutyExempt ? "只排掃廁所" : "",
      m.skipLaundry ? "免洗衣籃" : "",
      m.skipWater ? "免換水" : "",
    ].filter(Boolean);

    return `
      <details class="member-item${isActive ? "" : " member-left"}" data-id="${m.id}">
        <summary>
          <span class="member-seq">${m.seq}</span>
          <span class="member-name">${escapeAttr(m.name)}</span>
          <span class="member-meta">${[meta].concat(flags).filter(Boolean).join("・")}</span>
        </summary>

        <div class="member-fields">
          <label class="field-row"><span>姓名</span>
            <input type="text" class="member-name-input" value="${escapeAttr(m.name)}" data-id="${m.id}">
          </label>
          <label class="field-row"><span>加入日期</span>
            <input type="date" class="join-date-input" data-id="${m.id}" value="${m.joinDate || ""}">
          </label>
          <label class="field-row"><span>離開日期</span>
            <input type="date" class="discharge-date-input" data-id="${m.id}" value="${m.dischargeDate || ""}">
          </label>
          <label class="field-row"><span>離開方式</span>
            <select class="leave-mode-select" data-id="${m.id}">
              <option value="${St.LEAVE_AFTER_LUNCH}"${
                m.leaveMode !== St.LEAVE_IMMEDIATE ? " selected" : ""
              }>退伍（當天做到中午）</option>
              <option value="${St.LEAVE_IMMEDIATE}"${
                m.leaveMode === St.LEAVE_IMMEDIATE ? " selected" : ""
              }>退出（當天就不排）</option>
            </select>
          </label>
          <div class="field-row"><span>免排</span>
            <div>
              <label class="tick"><input type="checkbox" class="skip-laundry" data-id="${m.id}" ${
                m.skipLaundry ? "checked" : ""
              }> 洗衣籃</label>
              <label class="tick"><input type="checkbox" class="skip-water" data-id="${m.id}" ${
                m.skipWater ? "checked" : ""
              }> 換水</label>
              <label class="tick"><input type="checkbox" class="duty-exempt" data-id="${m.id}" ${
                m.dutyExempt ? "checked" : ""
              }> 🚻 只排掃廁所</label>
            </div>
          </div>
          ${
            showAdvanced
              ? `<div class="field-row"><span>免排（進階）</span>
            <label class="tick"><input type="checkbox" class="skip-dinner-cleanup" data-id="${m.id}" ${
                  m.skipDinnerCleanup ? "checked" : ""
                }> 晚上撤收</label>
          </div>
          <label class="field-row"><span>固定勤務</span>
            <select class="fixed-duty-select" data-id="${m.id}">
              ${St.FIXED_DUTY_PRESETS.map(
                (p) =>
                  `<option value="${p.key}"${St.fixedDutyPresetOf(m) === p.key ? " selected" : ""}>${p.label}</option>`
              ).join("")}
            </select>
          </label>
          <label class="field-row"><span>打菜角色</span>
            <select class="serving-role-select" data-id="${m.id}">
              <option value="">（輪替）</option>
              ${St.SERVING_FIXED_ROLES.map(
                (role) =>
                  `<option value="${role}"${m.servingRole === role ? " selected" : ""}>${
                    St.SERVING_ROLE_LABELS[role]
                  }</option>`
              ).join("")}
            </select>
          </label>
          <div class="field-row"><span>送便當</span>
            <button type="button" class="set-delivery-btn" data-id="${m.id}">${
                  m.fixedRole === "delivery" ? "取消送便當" : "設為送便當"
                }</button>
          </div>`
              : ""
          }
        </div>
      </details>`;
  }

  function escapeAttr(str) {
    return String(str).replace(/"/g, "&quot;");
  }

  function render() {
    if (!container()) return; // 容器被搬走或還沒建立時安靜結束

    const state = window.App.State.get();
    const today = window.App.State.todayStr();
    const deliveryMembers = window.App.Roster.getDeliveryMembers();
    const St = window.App.State;
    // 每個梯次一張表
    // 已離開＝今天不在營、而且不是「還沒報到」的人
    const hasLeft = (m) => !St.isActiveOn(m, today) && !(m.joinDate && today < m.joinDate);
    const departedCount = state.members.filter(hasLeft).length;

    const cohortCards = St.COHORT_ORDER.map((cohort) => {
      const all = state.members.filter((m) => m.cohort === cohort).sort((a, b) => a.seq - b.seq);
      const list = showDeparted ? all : all.filter((m) => !hasLeft(m));
      const activeCount = all.filter((m) => St.isActiveOn(m, today)).length;
      return { cohort, label: St.COHORT_LABELS[cohort] || cohort, list, all, activeCount };
    }).filter((c) => c.list.length);

    container().innerHTML = `
      ${
        // 送便當是三餐勤務，停用時提醒人數沒有意義
        St.MEAL_DUTIES_ENABLED && deliveryMembers.length !== 2
          ? `<div class="warning-box">⚠️ 目前固定送便當人力為 ${deliveryMembers.length} 人（正常應為2人）。請在下方名冊點「設為送便當」指定剛好2位。</div>`
          : ""
      }

      <div class="card">
        <div class="row" style="justify-content:space-between">
          <h2 style="margin:0">名冊</h2>
          <div class="row" style="gap:6px">
            ${
              departedCount
                ? `<button type="button" class="ghost-btn" id="toggle-departed">${
                    showDeparted ? "隱藏已離開" : `已離開 ${departedCount} 位`
                  }</button>`
                : ""
            }
            <button type="button" class="ghost-btn" id="toggle-advanced">${
              showAdvanced ? "隱藏進階" : "進階欄位"
            }</button>
          </div>
        </div>
        <p class="hint">
          加入日期留空＝一開始就在；離開日期留空＝還在班。
          <strong>退伍</strong>＝當天早、中照排、晚上才離營；<strong>退出</strong>＝當天早上就不排了。
          ${
            showAdvanced
              ? `<br>⚠️ <strong>進階欄位（固定勤務、打菜角色、送便當、免排晚上撤收）目前沒有作用</strong>——那些勤務程式已經不排了，改了不會有效果。`
              : ""
          }
        </p>
      </div>

      <details class="card collapse-card">
        <summary><span class="collapse-title">➕ 新增人員</span></summary>
        <div class="row" style="margin-top:10px">
          <input type="text" id="new-member-name" placeholder="姓名或代號">
          <select id="new-member-cohort">
            ${St.COHORT_ORDER.map(
              (c) => `<option value="${c}">${St.COHORT_LABELS[c] || c}</option>`
            ).join("")}
          </select>
          <button type="button" class="primary" id="add-member-btn">新增</button>
        </div>
      </details>

      ${cohortCards
        .map(
          (c) => `
      <div class="card">
        <h2>${c.label} <span class="hint">${c.activeCount} 人在班${showDeparted ? ` / 共 ${c.all.length}` : ""}</span></h2>
        ${c.list.map((m) => memberRow(m, today)).join("") || `<p class="hint">尚無人員</p>`}
      </div>`
        )
        .join("")}

      <details class="card collapse-card">
        <summary><span class="collapse-title">🔄 資料重置</span><span class="hint">把所有次數與班表歸零重來</span></summary>
        <p class="hint">勤務次數、已產生的班表、各項輪替進度、採買紀錄全部歸零（人員名單會保留）。這個動作無法復原。</p>
        <button type="button" class="danger" id="reset-records-btn">重置所有勤務紀錄</button>
      </details>
    `;

    bindEvents();
  }

  function bindEvents() {
    const root = container();

    const depBtn = root.querySelector("#toggle-departed");
    if (depBtn) {
      depBtn.addEventListener("click", () => {
        showDeparted = !showDeparted;
        render();
      });
    }

    const advBtn = root.querySelector("#toggle-advanced");
    if (advBtn) {
      advBtn.addEventListener("click", () => {
        showAdvanced = !showAdvanced;
        render();
      });
    }

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
