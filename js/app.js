/* 進入點：分頁切換、匯出/匯入 */
(function () {
  "use strict";

  const TABS = ["schedule", "textschedule", "roster", "dutyconfig", "shopping", "dashboard", "cloud"];

  function renderAll() {
    window.App.UI.Roster.render();
    window.App.UI.DutyConfig.render();
    window.App.UI.Schedule.render();
    window.App.UI.TextSchedule.render();
    window.App.UI.Shopping.render();
    window.App.UI.Dashboard.render();
    window.App.UI.Cloud.render();
  }
  window.App.renderAll = renderAll;

  function showTab(tabName) {
    TABS.forEach((name) => {
      document.getElementById(`tab-${name}`).classList.toggle("active", name === tabName);
    });
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });
  }

  function initTabs() {
    document.getElementById("tab-bar").addEventListener("click", (e) => {
      const btn = e.target.closest(".tab-btn");
      if (!btn) return;
      showTab(btn.dataset.tab);
    });
  }

  function initExportImport() {
    document.getElementById("export-btn").addEventListener("click", () => {
      const json = window.App.State.exportJson();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mess-duty-roster-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    document.getElementById("import-input").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          window.App.State.importJson(reader.result);
          renderAll();
          alert("匯入成功！");
        } catch (err) {
          alert("匯入失敗，檔案格式不正確。");
          console.error(err);
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initExportImport();
    renderAll();

    window.App.CloudSync.onStatusChange(() => {
      if (window.App.UI.Cloud) window.App.UI.Cloud.refreshStatusOnly();
    });
    window.App.CloudSync.init();
  });
})();
