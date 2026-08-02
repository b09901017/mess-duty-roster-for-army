/* 產生班表頁面：先預覽，按下確定才會真正紀錄 */
window.App = window.App || {};
window.App.UI = window.App.UI || {};

(function () {
  "use strict";

  const container = () => document.getElementById("tab-schedule");
  let selectedDate = window.App.State.DUTY_PERIOD_START;
  let lastPreview = null;

  function memberLabel(id) {
    const m = window.App.State.memberById(id);
    if (!m) return id;
    return `${m.cohort}-${m.seq} ${m.name}`;
  }

  function namesOrDash(ids) {
    return ids && ids.length ? ids.map(memberLabel).join("、") : "（無）";
  }

  function dutyLineText(duty, text) {
    return `
      <div class="duty-line">
        <span class="duty-label">${window.App.State.DUTY_ICONS[duty] || ""} ${window.App.State.DUTY_LABELS[duty]}</span>
        <span class="duty-names">${text}</span>
      </div>`;
  }

  function dutyLine(duty, ids) {
    return dutyLineText(duty, namesOrDash(ids));
  }

  function mealCard(mealKey, mealData, activeMembers) {
    return `
      <div class="meal-card">
        <h3>${window.App.State.MEAL_LABELS[mealKey]}</h3>
        ${window.App.State.MEAL_DUTY_ROWS.map((rowKey) => {
          const description = window.App.DutyView.mealRowDescription(rowKey);
          if (description) return dutyLineText(rowKey, description);
          return dutyLine(rowKey, window.App.DutyView.mealRowIds(mealData, rowKey, activeMembers));
        }).join("")}
      </div>`;
  }

  function dailyCard(daily) {
    if (!daily || (!(daily.laundryUp || []).length && !(daily.laundryDown || []).length)) return "";
    return `
      <div class="meal-card">
        <h3>全日</h3>
        ${window.App.State.DAILY_DUTY_ROWS.map((duty) => dutyLine(duty, daily[duty])).join("")}
      </div>`;
  }

  function render() {
    const state = window.App.State.get();
    const committed = state.committedDates.includes(selectedDate);

    container().innerHTML = `
      <div class="card">
        <h2>選擇日期</h2>
        <p class="hint">這次勤務只安排 ${window.App.State.DUTY_PERIOD_START} ～ ${window.App.State.DUTY_PERIOD_END}。</p>
        <div class="row">
          <input type="date" id="schedule-date" value="${selectedDate}"
            min="${window.App.State.DUTY_PERIOD_START}" max="${window.App.State.DUTY_PERIOD_END}">
          <button type="button" class="primary" id="preview-btn">🔍 預覽（不會紀錄）</button>
          ${
            committed
              ? `<span class="chip chip-inactive">✅ 這天已經確定紀錄過了</span>
                 <button type="button" id="recommit-btn">重排這天</button>
                 <button type="button" class="danger" id="uncommit-btn">取消這天的紀錄</button>`
              : `<button type="button" class="primary" id="confirm-btn" ${lastPreview ? "" : "disabled"}>✅ 確定紀錄</button>`
          }
        </div>
      </div>
      <div id="schedule-result"></div>
    `;

    const resultEl = container().querySelector("#schedule-result");
    if (committed && state.schedules[selectedDate]) {
      renderResult(resultEl, state.schedules[selectedDate], true);
      lastPreview = null;
    } else if (lastPreview && lastPreview.date === selectedDate) {
      renderResult(resultEl, lastPreview, false);
    } else {
      resultEl.innerHTML = `<div class="empty-state">按上面「預覽」看看這天的班表（不會被記錄），確認沒問題後再按「確定紀錄」。</div>`;
    }

    bindEvents();
  }

  function renderResult(resultEl, schedule, committed) {
    resultEl.innerHTML = `
      ${!committed ? `<div class="hint">👀 這是預覽結果，尚未紀錄，可以重複按「預覽」測試，不會影響公平次數。按下「確定紀錄」後看到的會跟這裡一模一樣。</div>` : ""}
      ${schedule.warnings && schedule.warnings.length
        ? `<div class="warning-box">${schedule.warnings.map((w) => "⚠️ " + w).join("<br>")}</div>`
        : ""
      }
      ${schedule.shoppingNotes && schedule.shoppingNotes.length
        ? `<div class="hint">🛒 ${schedule.shoppingNotes.join("<br>🛒 ")}</div>`
        : ""
      }
      <div class="meal-grid">
        ${window.App.State.MEAL_KEYS.map((meal) =>
          mealCard(meal, schedule.meals[meal], window.App.State.activeMembersOn(selectedDate))
        ).join("")}
        ${dailyCard(schedule.daily)}
      </div>
    `;
  }

  function bindEvents() {
    const root = container();
    const dateInput = root.querySelector("#schedule-date");
    dateInput.addEventListener("change", () => {
      selectedDate = dateInput.value;
      lastPreview = null;
      render();
      // 文字班表跟著換日期，否則切過去看到的還是上一天的內容
      rerenderOthers();
    });

    const previewBtn = root.querySelector("#preview-btn");
    previewBtn.addEventListener("click", () => {
      const result = window.App.ScheduleEngine.previewDay(selectedDate);
      if (!result.ok) {
        alert(result.error);
        return;
      }
      lastPreview = { date: selectedDate, meals: result.meals, daily: result.daily, warnings: result.warnings };
      render();
      rerenderOthers();
    });

    const confirmBtn = root.querySelector("#confirm-btn");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", () => {
        if (!lastPreview || lastPreview.date !== selectedDate) {
          alert("請先按「預覽」看過這天的班表再確定紀錄。");
          return;
        }
        const result = window.App.ScheduleEngine.commitDay(selectedDate);
        if (!result.ok) {
          alert(result.error);
          return;
        }
        lastPreview = null;
        render();
        rerenderOthers();
      });
    }

    const recommitBtn = root.querySelector("#recommit-btn");
    if (recommitBtn) {
      recommitBtn.addEventListener("click", () => {
        const result = window.App.ScheduleEngine.commitDay(selectedDate);
        if (!result.ok) {
          alert(result.error);
          return;
        }
        render();
        rerenderOthers();
      });
    }

    const uncommitBtn = root.querySelector("#uncommit-btn");
    if (uncommitBtn) {
      uncommitBtn.addEventListener("click", () => {
        if (!confirm(`確定要取消 ${selectedDate} 的紀錄嗎？這天的採買登記也會一併移除。`)) return;
        window.App.ScheduleEngine.uncommitDay(selectedDate);
        lastPreview = null;
        render();
        rerenderOthers();
      });
    }
  }

  function rerenderOthers() {
    if (window.App.UI.TextSchedule) window.App.UI.TextSchedule.render();
    if (window.App.UI.Shopping) window.App.UI.Shopping.render();
    if (window.App.UI.Dashboard) window.App.UI.Dashboard.render();
  }

  function getSelectedDate() {
    return selectedDate;
  }

  function getLastPreview() {
    return lastPreview && lastPreview.date === selectedDate ? lastPreview : null;
  }

  window.App.UI.Schedule = { render, getSelectedDate, getLastPreview, memberLabel };
})();
