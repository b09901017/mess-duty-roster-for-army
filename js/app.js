/* 進入點：分頁切換、匯出/匯入 */
(function () {
  "use strict";

  // 四個分頁；公平性、雲端同步、備份、進階設定都收在「更多」裡面
  const TABS = ["schedule", "shopping", "roster", "more"];

  function renderAll() {
    window.App.UI.Roster.render();
    window.App.UI.DutyConfig.render();
    window.App.UI.Schedule.render();
    window.App.UI.TextSchedule.render();
    window.App.UI.Shopping.render();
    window.App.UI.Dashboard.render();
    window.App.UI.Cloud.render();
  }

  /*
   * 切分頁時把畫面捲回最上面。
   * 手機上從很長的名冊切到班表，如果停在原本的捲動位置會看到半截內容，
   * 很容易以為「怎麼是空的」。
   */
  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "auto" });
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
      scrollToTop();
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

    /*
     * 班表、次數這些都是「算出來的」快取，會跟著存進 localStorage。
     * 如果排班規則改版了，舊快取不會自己更新，重新整理後看到的還會是舊版算的結果。
     * 所以每次開啟時都依現行規則重播一次，確保畫面永遠是最新邏輯算出來的。
     * 包在 saveWithoutNotifying 裡是為了不要在雲端還沒拉下來之前就搶著上傳。
     */
    window.App.State.saveWithoutNotifying(() => {
      window.App.ScheduleEngine.rebuildAll();
    });

    renderAll();

    window.App.CloudSync.onStatusChange(() => {
      if (window.App.UI.Cloud) window.App.UI.Cloud.refreshStatusOnly();
    });
    window.App.CloudSync.init();
  });
})();
