/*
 * 採買・掃廁所分頁：逐日指定「今天誰去」的兩項勤務 ＋ 集合時間 ＋ 次數統計。
 *
 * 這兩項都不是程式排的，是當下才決定的（採買臨時派、掃廁所爬梯子），所以放在一起：
 * 一天一張卡，展開就選人。
 *
 *   採買   ：沒有固定星期也沒有固定人數，勾到的人那天早餐、中餐完全不排
 *            （打菜、勤務、撤收、換水都不排），晚上才歸隊，班表會自動跟著少人。
 *   掃廁所 ：早上9點，一天一位。9 點已經是早餐收完之後的事，不影響其他勤務，
 *            但那天要去採買的人不能選（他 9 點還在外面）。
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

  /** 那一天可以掃廁所的人：早上在營就行，含「只排掃廁所」的愷宸 */
  function toiletCandidatesOn(dateStr) {
    const S = window.App.State;
    return S.get()
      .members.filter((m) => S.isActiveOn(m, dateStr, "breakfast"))
      .sort(S.rosterOrder);
  }

  /** 那一天可以被派去採買的人（早上還在營的，不含只排掃廁所的） */
  function candidatesOn(dateStr) {
    const S = window.App.State;
    return S.get()
      .members.filter((m) => S.isActiveOn(m, dateStr, "breakfast") && !m.dutyExempt)
      .sort(S.rosterOrder);
  }

  function dayRow(dateStr, picked, toilet, names) {
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

    /*
     * 掃廁所是一天一位，用下拉選單而不是打勾——爬梯子只會抽到一個人，
     * 下拉比一排勾勾好按，也不會不小心勾到兩個。
     * 那天要去採買的人不列進選項：他 9 點還在外面。
     */
    const toiletId = toilet[0] || "";
    const toiletOptions = toiletCandidatesOn(dateStr)
      .filter((m) => picked.indexOf(m.id) === -1 || m.id === toiletId)
      .map(
        (m) =>
          `<option value="${m.id}"${m.id === toiletId ? " selected" : ""}>${escapeHtml(
            `${m.cohort}-${String(m.seq).padStart(2, "0")} ${m.name}`
          )}</option>`
      )
      .join("");
    /*
     * 選單本身已經濾掉那天要採買的人，但順序反過來也會發生：
     * 先選好掃廁所，之後才把同一個人勾成採買。這時舊的選擇還留著，要講出來。
     */
    const toiletGhost = toiletId && !toiletCandidatesOn(dateStr).some((m) => m.id === toiletId);
    const toiletIsShopper = toiletId && picked.indexOf(toiletId) !== -1;

    const chips = [];
    if (picked.length) {
      chips.push(
        `<span class="chip chip-261">採買 ${picked.length} 人</span> ${escapeHtml(
          picked.map((id) => names[id] || id).join("、")
        )}`
      );
    }
    if (toiletId) chips.push(`<span class="chip chip-263">🚻 ${escapeHtml(names[toiletId] || toiletId)}</span>`);

    return `
      <!--
        預設全部收起來。摘要那一行已經看得到「採買 N 人」跟掃廁所是誰，
        指定過就自動展開的話 14 天有 8 天是開的，要捲很久才找得到想改的那天。
      -->
      <details class="card shopping-day" data-date="${dateStr}"${openDates.has(dateStr) ? " open" : ""}>
        <summary style="cursor:pointer">
          <strong>${dateStr.slice(5)}（${R.WEEKDAY_LABELS[wd].slice(1)}）</strong>
          ${chips.length ? chips.join("　") : `<span class="hint">還沒指定</span>`}
        </summary>

        <p class="section-tag">🛒 採買（早餐、中餐都不排）</p>
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

        <p class="section-tag">🚻 掃廁所（0900、2100）</p>
        <div class="row" style="margin:10px 0">
          <select class="toilet-pick" data-date="${dateStr}">
            <option value="">（還沒抽）</option>
            ${toiletOptions}
          </select>
          <span class="hint">爬梯子抽到誰就選誰，一天一位</span>
        </div>
        ${
          toiletGhost
            ? `<div class="warning-box">⚠️ ${escapeHtml(
                names[toiletId] || toiletId
              )} 這天早上不在營，請改選其他人。</div>`
            : ""
        }
        ${
          toiletIsShopper
            ? `<div class="warning-box">⚠️ ${escapeHtml(
                names[toiletId] || toiletId
              )} 這天要去採買，9 點還在外面，班表不會排他掃廁所，請改選其他人。</div>`
            : ""
        }
      </details>`;
  }

  function render() {
    if (!container()) return; // 容器被搬走或還沒建立時安靜結束

    const S = window.App.State;
    const state = S.get();
    const byDate = state.shoppingByDate || {};
    const toiletByDate = state.toiletByDate || {};
    const names = window.App.TextFormat.displayNameMap();

    const dayCards = periodDates()
      .map((dateStr) => dayRow(dateStr, (byDate[dateStr] || []).slice(), (toiletByDate[dateStr] || []).slice(), names))
      .join("");

    const active = S.activeMembers();
    const countRows = active
      .map((m) => ({
        m,
        shopping: (state.dutyCounts[m.id] && state.dutyCounts[m.id].shopping) || 0,
        toilet: (state.dutyCounts[m.id] && state.dutyCounts[m.id].toilet) || 0,
      }))
      .sort((a, b) => b.shopping + b.toilet - (a.shopping + a.toilet) || S.rosterOrder(a.m, b.m))
      .map(
        (r) => `<tr>
          <td>${escapeHtml(`${r.m.cohort}-${r.m.seq} ${r.m.name}`)}</td>
          <td class="num">${r.shopping}</td>
          <td class="num">${r.toilet}</td>
        </tr>`
      )
      .join("");

    container().innerHTML = `
      <details class="card collapse-card">
        <summary><span class="collapse-title">🛒 採買・🚻 掃廁所</span><span class="hint">這兩項是當下才決定的，一天一天指定</span></summary>
        <p class="hint">
          <strong>🛒 採買</strong>：沒有固定星期、也沒有固定人數，哪天要採買就展開那一天勾人。
          勾到的人<strong>那天早餐、中餐完全不排</strong>，晚上才歸隊，撤收名額會自動跟著少。
        </p>
        <p class="hint">
          <strong>🚻 掃廁所</strong>：0900 與 2100 兩個時段、同一位包辦，爬梯子抽到誰就選誰。
          這是三餐之外的時段，<strong>不影響他當天其他勤務</strong>；那天要採買的人不會出現在選單裡。
        </p>
      </details>
      ${dayCards}
      <details class="card collapse-card">
        <summary><span class="collapse-title">📈 次數</span><span class="hint">從 ${S.COUNTS_FROM} 起算，抽的時候可以避開做過的人</span></summary>
        <div class="table-scroll">
        <table>
          <thead><tr><th>人員</th><th class="num">🛒 採買</th><th class="num">🚻 掃廁所</th></tr></thead>
          <tbody>${countRows}</tbody>
        </table>
        </div>
      </details>
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

    root.querySelectorAll(".toilet-pick").forEach((sel) => {
      sel.addEventListener("change", () => {
        const state = window.App.State.get();
        const date = sel.dataset.date;
        const next = Object.assign({}, state.toiletByDate);
        if (sel.value) next[date] = [sel.value];
        else delete next[date];
        state.toiletByDate = next;
        openDates.add(date);
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
