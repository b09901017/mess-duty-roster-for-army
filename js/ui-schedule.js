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
    if (!ids || !ids.length) return "（無）";
    // 每個「261-13 簡宏穎」自己不換行，只在頓號處折，手機上才不會把編號跟名字拆兩行
    return ids.map((id) => `<span class="name-token">${memberLabel(id)}</span>`).join("、");
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

  /*
   * 一餐照實際流程分段印：前置 → 打菜 → 抬便當 → 善後 → 撤收。
   * 分段的定義跟文字班表、LINE 卡片共用（js/textFormat.js 的 mealRows），三邊不會長歪。
   * 名字用「261-13 簡宏穎」的完整寫法，並包成 name-token 避免手機把編號跟名字拆兩行。
   */
  function labelNameMap() {
    const map = {};
    window.App.State.get().members.forEach((m) => (map[m.id] = `${m.cohort}-${m.seq} ${m.name}`));
    return map;
  }

  function wrapNames(value) {
    if (value.indexOf("、") === -1 && !/^\d|梯/.test(value)) return value; // 是規則說明不是名單
    return value
      .split("、")
      .map((token) => `<span class="name-token">${token}</span>`)
      .join("、");
  }

  function mealCard(dateStr, mealKey, mealData) {
    const S = window.App.State;
    const block = window.App.TextFormat.mealRows(
      dateStr,
      { meals: { [mealKey]: mealData } },
      mealKey,
      labelNameMap()
    );
    const dishes = mealData.dishes != null ? mealData.dishes : 0;
    const sections = block.sections
      .map(
        (section) => `
        <p class="section-tag">${section.title}${section.hint ? ` <span class="hint">（${section.hint}）</span>` : ""}</p>
        ${section.notes.map((n) => `<div class="duty-line"><span class="duty-names hint">・${n}</span></div>`).join("")}
        ${section.rows
          .map(
            (row) => `
          <div class="duty-line">
            <span class="duty-label">${row.label}</span>
            <span class="duty-names">${wrapNames(row.value)}</span>
          </div>`
          )
          .join("")}`
      )
      .join("");
    return `
      <div class="meal-card">
        <h3>${S.MEAL_LABELS[mealKey]} <span class="hint">${S.menuLabel(mealKey, dishes)}</span></h3>
        ${sections}
      </div>`;
  }

  function dailyCard(daily) {
    const rows = window.App.State.DAILY_DUTY_ROWS.filter((duty) => ((daily || {})[duty] || []).length);
    if (!rows.length) return "";
    return `
      <div class="meal-card">
        <h3>全日</h3>
        ${rows.map((duty) => dutyLine(duty, daily[duty])).join("")}
      </div>`;
  }

  /*
   * 已經公布給大家的班表要能鎖住，之後改規則、改名冊都不會動到它。
   * 直接把「文字班表 → 依餐別」複製出去的那段貼回來就好。
   */
  function lockCard(date) {
    const locked = (window.App.State.get().overrides || {})[date];
    if (locked) {
      return `
        <div class="card">
          <h2>🔒 這天已鎖定</h2>
          <p class="hint">
            ${date} 照公布過的版本顯示，之後改勤務人數、菜量、名冊都不會動到它，
            次數一樣會計入公平性總覽。${locked.note ? `（${locked.note}）` : ""}
          </p>
          <button type="button" class="danger" id="unlock-btn">解除鎖定，改回自動排班</button>
        </div>`;
    }
    return `
      <details class="card">
        <summary style="cursor:pointer;font-weight:600">🔒 鎖定這天（貼上已公布的班表）</summary>
        <p class="hint">
          已經把班表貼到群組了、之後又改了規則的話，把當初公布的那份貼回來，
          這天就會永遠照那份走，不會再跟著規則變動——次數照樣算。
          「依餐別」或「依個人」複製出來的都可以，標號和分隔線都不用清掉。
        </p>
        <textarea id="lock-input" class="text-schedule-area" rows="10"
          placeholder="把當初公布的文字班表整段貼在這裡（依餐別、依個人都可以）"></textarea>
        <div class="row" style="margin-top:8px">
          <button type="button" class="primary" id="lock-btn">鎖定 ${date}</button>
        </div>
        <div id="lock-message"></div>
      </details>`;
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
      ${lockCard(selectedDate)}
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
        ${window.App.TextFormat.mealKeysOf(schedule.date || selectedDate, schedule)
          .map((meal) => mealCard(schedule.date || selectedDate, meal, schedule.meals[meal]))
          .join("")}
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

    const lockBtn = root.querySelector("#lock-btn");
    if (lockBtn) {
      lockBtn.addEventListener("click", () => {
        const input = root.querySelector("#lock-input");
        const messageEl = root.querySelector("#lock-message");
        const state = window.App.State.get();
        const result = window.App.ScheduleImport.parseScheduleText(input.value, state.members);

        if (!result.ok) {
          messageEl.innerHTML = `<div class="warning-box">讀不進去：<br>${result.errors
            .map((e) => "・" + e)
            .join("<br>")}</div>`;
          return;
        }

        state.overrides = Object.assign({}, state.overrides);
        state.overrides[selectedDate] = result.override;
        if (!state.committedDates.includes(selectedDate)) state.committedDates.push(selectedDate);
        window.App.ScheduleEngine.rebuildAll();
        lastPreview = null;
        render();
        rerenderOthers();
      });
    }

    const unlockBtn = root.querySelector("#unlock-btn");
    if (unlockBtn) {
      unlockBtn.addEventListener("click", () => {
        if (!confirm(`解除 ${selectedDate} 的鎖定之後，這天會改回自動排班，內容可能跟公布過的不一樣。確定嗎？`)) return;
        const state = window.App.State.get();
        state.overrides = Object.assign({}, state.overrides);
        delete state.overrides[selectedDate];
        window.App.ScheduleEngine.rebuildAll();
        lastPreview = null;
        render();
        rerenderOthers();
      });
    }

    const uncommitBtn = root.querySelector("#uncommit-btn");
    if (uncommitBtn) {
      uncommitBtn.addEventListener("click", () => {
        // 採買與掃廁所的指定是另外存的，取消紀錄不會動到它們（之前這裡寫錯了）
        if (!confirm(`確定要取消 ${selectedDate} 的紀錄嗎？這天就會從公平性次數裡拿掉。\n（採買、掃廁所的指定會留著，之後重排還是照原本指定的人。）`)) return;
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
