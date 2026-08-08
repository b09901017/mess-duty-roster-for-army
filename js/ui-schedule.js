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
    // 三餐勤務停用之後那一餐一段都沒有，整張卡片不用畫
    if (!block.sections.length) return "";
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

  /*
   * 全日勤務。撤收的資料在 meals[meal].cleanup（它本來就分餐別），
   * 但顯示上跟掃廁所、換水、洗衣籃放同一張卡最好對，所以整份班表都要傳進來。
   */
  function dailyCard(schedule) {
    const S = window.App.State;
    const daily = schedule.daily || {};
    const idsOf = (duty) => {
      const meal = S.CLEANUP_ROW_MEAL[duty];
      if (meal) return ((schedule.meals || {})[meal] || {}).cleanup || [];
      return daily[duty] || [];
    };
    const rows = S.DAILY_DUTY_ROWS.filter((duty) => idsOf(duty).length);
    if (!rows.length) return "";
    return `
      <div class="meal-card">
        <h3>全日</h3>
        ${rows.map((duty) => dutyLine(duty, idsOf(duty))).join("")}
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

  /** 前一天／後一天，超出勤務期間就回 null（按鈕會變灰） */
  function shiftDate(dateStr, days) {
    const S = window.App.State;
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + days);
    const iso = d.toISOString().slice(0, 10);
    if (iso < S.DUTY_PERIOD_START || iso > S.DUTY_PERIOD_END) return null;
    return iso;
  }

  /*
   * 日期列：‹ 8/8（六） ›
   *
   * 以前只有一個 date input，要換日期得點開系統的日期選擇器；
   * 但實際上九成的操作是「看今天」跟「排明天」，所以做成左右箭頭一鍵切換，
   * 底下那行小字仍然是 date input，要跳到別天還是點得到。
   */
  function dateNav() {
    const S = window.App.State;
    const prev = shiftDate(selectedDate, -1);
    const next = shiftDate(selectedDate, 1);
    const today = S.todayStr();
    const isToday = selectedDate === today;
    const canJumpToday = today >= S.DUTY_PERIOD_START && today <= S.DUTY_PERIOD_END;
    return `
      <div class="card">
        <div class="date-nav">
          <button type="button" class="date-step" id="prev-day" ${prev ? "" : "disabled"}>‹</button>
          <div class="date-current">
            <strong>${window.App.TextFormat.formatDateHeader(selectedDate)}${isToday ? "　今天" : ""}</strong>
            <input type="date" id="schedule-date" value="${selectedDate}"
              min="${S.DUTY_PERIOD_START}" max="${S.DUTY_PERIOD_END}">
          </div>
          <button type="button" class="date-step" id="next-day" ${next ? "" : "disabled"}>›</button>
        </div>
        ${
          !isToday && canJumpToday
            ? `<div class="btn-row"><button type="button" class="big-btn ghost" id="today-btn">回到今天</button></div>`
            : ""
        }
      </div>`;
  }

  /*
   * 動作區。
   *
   * 以前是「先按預覽、再按確定紀錄」兩顆按鈕，而且沒按預覽之前確定是灰的——
   * 排班本來就是決定性的（預覽跟確定的結果一定一樣），所以現在一進來就自動算好給你看，
   * 只留一顆「確定紀錄」。少一個步驟、也少一個要解釋的概念。
   */
  function actionCard(committed) {
    return `
      <div class="card">
        <div class="status-line ${committed ? "status-done" : "status-todo"}">
          <span class="status-dot"></span>
          ${committed ? "已確定紀錄" : "還沒紀錄（下面是試算結果）"}
        </div>
        <div class="btn-row">
          ${
            committed
              ? `<button type="button" class="big-btn ghost" id="recommit-btn">重排這天</button>
                 <button type="button" class="big-btn ghost" id="uncommit-btn">取消紀錄</button>`
              : `<button type="button" class="big-btn primary" id="confirm-btn">✅ 確定紀錄</button>`
          }
        </div>
        <div class="btn-row">
          <button type="button" class="big-btn ghost" id="copy-btn">📋 複製班表文字</button>
        </div>
      </div>`;
  }

  function render() {
    const state = window.App.State.get();
    const committed = state.committedDates.includes(selectedDate);

    /*
     * 沒紀錄過的日子直接算一份出來顯示（不會寫入任何東西）。
     * 這樣畫面永遠有內容，不用先按一次「預覽」。
     */
    if (!committed && (!lastPreview || lastPreview.date !== selectedDate)) {
      const result = window.App.ScheduleEngine.previewDay(selectedDate);
      lastPreview = result.ok
        ? { date: selectedDate, meals: result.meals, daily: result.daily, warnings: result.warnings }
        : { date: selectedDate, error: result.error };
    }

    container().innerHTML = `
      ${dateNav()}
      ${actionCard(committed)}
      <div id="schedule-result"></div>
      ${lockCard(selectedDate)}
    `;

    const resultEl = container().querySelector("#schedule-result");
    if (committed && state.schedules[selectedDate]) {
      renderResult(resultEl, state.schedules[selectedDate], true);
    } else if (lastPreview && lastPreview.error) {
      resultEl.innerHTML = `<div class="warning-box">⚠️ ${lastPreview.error}</div>`;
    } else if (lastPreview) {
      renderResult(resultEl, lastPreview, false);
    }

    bindEvents();
  }

  function renderResult(resultEl, schedule, committed) {
    resultEl.innerHTML = `
      ${schedule.warnings && schedule.warnings.length
        ? `<div class="warning-box">${schedule.warnings.map((w) => "⚠️ " + w).join("<br>")}</div>`
        : ""
      }
      <div class="meal-grid">
        ${window.App.TextFormat.mealKeysOf(schedule.date || selectedDate, schedule)
          .map((meal) => mealCard(schedule.date || selectedDate, meal, schedule.meals[meal]))
          .join("")}
        ${dailyCard(schedule)}
      </div>
    `;
  }

  function bindEvents() {
    const root = container();

    /** 換日期：清掉試算結果讓 render() 重新算 */
    const goTo = (date) => {
      if (!date) return;
      selectedDate = date;
      lastPreview = null;
      render();
      rerenderOthers();
    };

    const dateInput = root.querySelector("#schedule-date");
    if (dateInput) dateInput.addEventListener("change", () => goTo(dateInput.value));

    const prevBtn = root.querySelector("#prev-day");
    if (prevBtn) prevBtn.addEventListener("click", () => goTo(shiftDate(selectedDate, -1)));
    const nextBtn = root.querySelector("#next-day");
    if (nextBtn) nextBtn.addEventListener("click", () => goTo(shiftDate(selectedDate, 1)));
    const todayBtn = root.querySelector("#today-btn");
    if (todayBtn) todayBtn.addEventListener("click", () => goTo(window.App.State.todayStr()));

    /*
     * 複製班表文字。組法跟 LINE 卡片同源（js/textFormat.js），
     * 所以複製出去的跟機器人回的內容一致。
     */
    const copyBtn = root.querySelector("#copy-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const state = window.App.State.get();
        const schedule = state.schedules[selectedDate] || lastPreview;
        if (!schedule || schedule.error) {
          alert("這天還沒有班表可以複製。");
          return;
        }
        const TF = window.App.TextFormat;
        const text = TF.buildMealText(selectedDate, schedule, TF.displayNameMap());
        let ok = false;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            ok = true;
          }
        } catch (err) {
          ok = false;
        }
        if (!ok) {
          // 不能用剪貼簿 API（http 或舊瀏覽器）時退回「選起來讓他自己複製」
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          try {
            ok = document.execCommand("copy");
          } catch (err) {
            ok = false;
          }
          document.body.removeChild(ta);
        }
        copyBtn.textContent = ok ? "✅ 已複製，去貼到群組" : "請長按畫面手動複製";
        setTimeout(() => (copyBtn.textContent = "📋 複製班表文字"), 1800);
      });
    }

    const confirmBtn = root.querySelector("#confirm-btn");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", () => {
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
