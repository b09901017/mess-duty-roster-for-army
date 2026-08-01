(function () {
  "use strict";

  const STORAGE_KEY = "mess-duty-roster-state-v1";

  /** @type {{members: {name: string, excludeDates: string}[], settings: {startDate: string, endDate: string, peoplePerDay: number}}} */
  let state = loadState();

  const memberNameInput = document.getElementById("member-name");
  const addMemberBtn = document.getElementById("add-member-btn");
  const memberListEl = document.getElementById("member-list");
  const startDateInput = document.getElementById("start-date");
  const endDateInput = document.getElementById("end-date");
  const peoplePerDayInput = document.getElementById("people-per-day");
  const generateBtn = document.getElementById("generate-btn");
  const rosterResultEl = document.getElementById("roster-result");
  const resultActionsEl = document.getElementById("result-actions");
  const exportCsvBtn = document.getElementById("export-csv-btn");
  const printBtn = document.getElementById("print-btn");

  let lastRoster = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          members: Array.isArray(parsed.members) ? parsed.members : [],
          settings: parsed.settings || {},
        };
      }
    } catch (err) {
      console.warn("無法讀取儲存的資料，將使用預設值。", err);
    }
    return { members: [], settings: {} };
  }

  function saveState() {
    state.settings = {
      startDate: startDateInput.value,
      endDate: endDateInput.value,
      peoplePerDay: Number(peoplePerDayInput.value) || 1,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function renderMembers() {
    memberListEl.innerHTML = "";
    if (state.members.length === 0) {
      const li = document.createElement("li");
      li.className = "empty-state";
      li.textContent = "尚未新增任何人員";
      memberListEl.appendChild(li);
      return;
    }

    state.members.forEach((member, index) => {
      const li = document.createElement("li");

      const nameSpan = document.createElement("span");
      nameSpan.className = "member-name";
      nameSpan.textContent = member.name;

      const excludeInput = document.createElement("input");
      excludeInput.type = "text";
      excludeInput.className = "exclude-dates";
      excludeInput.placeholder = "排除日期，如 2026-08-05,2026-08-10";
      excludeInput.value = member.excludeDates || "";
      excludeInput.addEventListener("change", () => {
        state.members[index].excludeDates = excludeInput.value.trim();
        saveState();
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "remove-btn";
      removeBtn.textContent = "移除";
      removeBtn.addEventListener("click", () => {
        state.members.splice(index, 1);
        saveState();
        renderMembers();
      });

      li.appendChild(nameSpan);
      li.appendChild(excludeInput);
      li.appendChild(removeBtn);
      memberListEl.appendChild(li);
    });
  }

  function addMember() {
    const name = memberNameInput.value.trim();
    if (!name) return;
    if (state.members.some((m) => m.name === name)) {
      alert("這個名字已經在名單中了");
      return;
    }
    state.members.push({ name, excludeDates: "" });
    memberNameInput.value = "";
    saveState();
    renderMembers();
    memberNameInput.focus();
  }

  function parseExcludeDates(str) {
    if (!str) return new Set();
    return new Set(
      str
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }

  function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function enumerateDates(startStr, endStr) {
    const start = new Date(startStr + "T00:00:00");
    const end = new Date(endStr + "T00:00:00");
    const dates = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(formatDate(d));
    }
    return dates;
  }

  function generateRoster() {
    const startDate = startDateInput.value;
    const endDate = endDateInput.value;
    const peoplePerDay = Number(peoplePerDayInput.value) || 1;

    if (state.members.length === 0) {
      alert("請先新增至少一位人員");
      return;
    }
    if (!startDate || !endDate) {
      alert("請設定起始與結束日期");
      return;
    }
    if (startDate > endDate) {
      alert("結束日期不能早於起始日期");
      return;
    }
    if (peoplePerDay < 1) {
      alert("每日需求人數至少為 1");
      return;
    }

    const dates = enumerateDates(startDate, endDate);
    const membersWithExcludes = state.members.map((m) => ({
      name: m.name,
      excludeDates: parseExcludeDates(m.excludeDates),
    }));

    const dutyCount = new Map(membersWithExcludes.map((m) => [m.name, 0]));
    const assignments = [];
    const warnings = [];

    dates.forEach((date) => {
      const available = membersWithExcludes.filter((m) => !m.excludeDates.has(date));
      const assigned = [];

      if (available.length === 0) {
        warnings.push(`${date}：當天所有人員皆被排除，無法排班`);
      } else {
        const sorted = [...available].sort(
          (a, b) => dutyCount.get(a.name) - dutyCount.get(b.name)
        );
        const need = Math.min(peoplePerDay, sorted.length);
        if (sorted.length < peoplePerDay) {
          warnings.push(`${date}：可排班人數（${sorted.length}）不足需求（${peoplePerDay}）`);
        }
        for (let i = 0; i < need; i++) {
          const person = sorted[i];
          assigned.push(person.name);
          dutyCount.set(person.name, dutyCount.get(person.name) + 1);
        }
      }

      assignments.push({ date, assigned });
    });

    lastRoster = { assignments, dutyCount, warnings };
    renderRoster(lastRoster);
    saveState();
  }

  function renderRoster(roster) {
    rosterResultEl.innerHTML = "";

    if (roster.warnings.length > 0) {
      const box = document.createElement("div");
      box.className = "warning-box";
      box.innerHTML =
        "<strong>提醒：</strong><br>" + roster.warnings.map(escapeHtml).join("<br>");
      rosterResultEl.appendChild(box);
    }

    const table = document.createElement("table");
    table.className = "roster-table";

    const thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>日期</th><th>值班人員</th></tr>";
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    roster.assignments.forEach(({ date, assigned }) => {
      const tr = document.createElement("tr");
      const dateTd = document.createElement("td");
      dateTd.textContent = date;
      const assignedTd = document.createElement("td");
      assignedTd.textContent = assigned.length > 0 ? assigned.join("、") : "（無）";
      tr.appendChild(dateTd);
      tr.appendChild(assignedTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    rosterResultEl.appendChild(table);

    const summary = document.createElement("div");
    summary.className = "hint";
    const summaryText = Array.from(roster.dutyCount.entries())
      .map(([name, count]) => `${name}：${count} 次`)
      .join("　");
    summary.textContent = "值班次數統計：" + summaryText;
    rosterResultEl.appendChild(summary);

    resultActionsEl.hidden = false;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function exportCsv() {
    if (!lastRoster) return;
    const rows = [["日期", "值班人員"]];
    lastRoster.assignments.forEach(({ date, assigned }) => {
      rows.push([date, assigned.join("、")]);
    });
    const csvContent = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "duty-roster.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function init() {
    renderMembers();

    if (state.settings.startDate) startDateInput.value = state.settings.startDate;
    if (state.settings.endDate) endDateInput.value = state.settings.endDate;
    if (state.settings.peoplePerDay) peoplePerDayInput.value = state.settings.peoplePerDay;

    addMemberBtn.addEventListener("click", addMember);
    memberNameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addMember();
      }
    });

    generateBtn.addEventListener("click", generateRoster);
    exportCsvBtn.addEventListener("click", exportCsv);
    printBtn.addEventListener("click", () => window.print());

    [startDateInput, endDateInput, peoplePerDayInput].forEach((el) => {
      el.addEventListener("change", saveState);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
