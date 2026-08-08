/* 雲端同步設定頁面 */
window.App = window.App || {};
window.App.UI = window.App.UI || {};

(function () {
  "use strict";

  const container = () => document.getElementById("tab-cloud");

  const STATUS_STYLE = {
    off: { icon: "⚪", cls: "hint" },
    connecting: { icon: "🔄", cls: "hint" },
    syncing: { icon: "🔄", cls: "hint" },
    pending: { icon: "⏳", cls: "hint" },
    connected: { icon: "✅", cls: "hint" },
    error: { icon: "⚠️", cls: "warning-box" },
  };

  function escapeAttr(str) {
    return String(str == null ? "" : str).replace(/"/g, "&quot;");
  }

  function statusBlock() {
    const s = window.App.CloudSync.getStatus();
    const style = STATUS_STYLE[s.state] || STATUS_STYLE.off;
    const bits = [];
    if (s.cloudUpdatedAt) bits.push(`雲端最後更新：${s.cloudUpdatedAt}`);
    if (s.lastPush) bits.push(`本機最後上傳：${s.lastPush}`);
    if (s.lastPull) bits.push(`最後下載：${s.lastPull}`);
    return `
      <div class="${style.cls}" id="cloud-status">
        ${style.icon} ${s.message}
        ${bits.length ? `<br><span class="hint">${bits.join("　·　")}</span>` : ""}
      </div>`;
  }

  function render() {
    const cfg = window.App.CloudSync.getConfig();
    const configText = cfg.firebaseConfig ? JSON.stringify(cfg.firebaseConfig, null, 2) : "";

    container().innerHTML = `
      ${statusBlock()}

      <div class="card">
        <h2>為什麼要設定這個</h2>
        <p class="hint">
          預設情況下所有資料只存在這支手機/這台電腦的瀏覽器裡，清快取或換裝置就會不見。
          接上 Firebase 之後，每次變更都會自動備份到雲端，換裝置時只要填一樣的房間代碼就能把班表整份拉回來，
          手機跟電腦也可以同步看同一份。沒設定的話 App 一樣能正常用，只是沒有雲端備份。
        </p>
      </div>

      <div class="card">
        <h2>設定步驟</h2>
        <ol class="setup-steps">
          <li>到 <a href="https://console.firebase.google.com/" target="_blank" rel="noopener">Firebase 主控台</a> 免費建立一個專案。</li>
          <li>專案裡新增一個「網頁應用程式」，複製它給你的 <code>firebaseConfig</code> 整段設定，貼到下面的框裡。</li>
          <li>左邊選單 <strong>Build → Firestore Database</strong> → 建立資料庫（選正式版模式即可，規則等一下換掉）。</li>
          <li>左邊選單 <strong>Build → Authentication → Sign-in method</strong> → 啟用<strong>「匿名」</strong>登入。</li>
          <li>回到 Firestore 的「規則」分頁，把規則換成下面這段後發布：</li>
        </ol>
        <textarea class="text-schedule-area" readonly rows="9" id="rules-text">rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rosters/{roomId} {
      allow read, write: if request.auth != null;
    }
    match /briefings/{roomId} {
      allow read, write: if request.auth != null;
    }
  }
}</textarea>
        <button type="button" class="ghost-btn" id="copy-rules-btn">📋 複製規則</button>
        <p class="warning-box" style="margin-top:12px">
          ⚠️ 這組規則的意思是「任何登入過的人都能讀寫任何房間」。因為名冊裡有真實姓名，
          <strong>請把房間代碼當成密碼</strong>，用下面的「隨機產生」按鈕產一組不好猜的，不要用 <code>test</code>、<code>123</code> 這種。
          知道代碼的人就看得到、改得到你的班表。
        </p>
      </div>

      <div class="card">
        <h2>雲端設定</h2>
        <label class="field">
          <span>Firebase 設定（整段貼上即可）</span>
          <textarea id="cloud-config-input" class="text-schedule-area" rows="10"
            placeholder='const firebaseConfig = {
  apiKey: "...",
  authDomain: "xxx.firebaseapp.com",
  projectId: "xxx",
  ...
};'>${escapeAttr(configText)}</textarea>
        </label>
        <label class="field">
          <span>房間代碼（換裝置時要填一樣的）</span>
          <span class="row">
            <input type="text" id="cloud-room-input" value="${escapeAttr(cfg.roomCode)}" placeholder="例如 mess-a7k2p9x4">
            <button type="button" id="gen-room-btn">🎲 隨機產生</button>
          </span>
        </label>
        <div class="row" style="margin-top:12px">
          <button type="button" class="primary" id="cloud-save-btn">${cfg.enabled ? "儲存並重新連線" : "啟用雲端同步"}</button>
          ${cfg.enabled ? `<button type="button" id="cloud-disable-btn">停用</button>` : ""}
        </div>
      </div>

      <div class="card">
        <h2>手動同步</h2>
        <p class="hint">平常有變更就會自動上傳，這兩個按鈕是給你需要立刻處理時用的。換新手機時，填好上面的設定後按「從雲端下載」就能把資料拉回來。</p>
        <div class="row">
          <button type="button" id="cloud-push-btn">⬆️ 上傳到雲端（覆蓋雲端）</button>
          <button type="button" class="danger" id="cloud-pull-btn">⬇️ 從雲端下載（覆蓋本機）</button>
        </div>
      </div>
    `;

    bindEvents();
  }

  function refreshStatusOnly() {
    const el = container().querySelector("#cloud-status");
    if (!el) return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = statusBlock();
    el.replaceWith(wrapper.firstElementChild);
  }

  function bindEvents() {
    const root = container();

    const copyRules = root.querySelector("#copy-rules-btn");
    if (copyRules) {
      copyRules.addEventListener("click", async () => {
        const ta = root.querySelector("#rules-text");
        ta.select();
        let ok = false;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(ta.value);
            ok = true;
          }
        } catch (err) {
          ok = false;
        }
        if (!ok) {
          try {
            ok = document.execCommand("copy");
          } catch (err) {
            ok = false;
          }
        }
        copyRules.textContent = ok ? "✅ 已複製" : "請手動選取複製";
        setTimeout(() => (copyRules.textContent = "📋 複製規則"), 1500);
      });
    }

    const genRoom = root.querySelector("#gen-room-btn");
    if (genRoom) {
      genRoom.addEventListener("click", () => {
        root.querySelector("#cloud-room-input").value = "mess-" + window.App.CloudSync.randomId(10);
      });
    }

    const saveBtn = root.querySelector("#cloud-save-btn");
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true;
        const typedConfig = root.querySelector("#cloud-config-input").value;
        const typedRoom = root.querySelector("#cloud-room-input").value;
        const result = await window.App.CloudSync.configure({
          firebaseConfigText: typedConfig,
          roomCode: typedRoom,
          enabled: true,
        });
        saveBtn.disabled = false;

        if (!result.ok) {
          // 設定有問題時不要重畫整頁，否則使用者剛打的內容會被清掉
          refreshStatusOnly();
          return;
        }

        render();
        {
          const push = confirm("連線成功！要現在把這台裝置的資料上傳到雲端嗎？\n\n（如果雲端已經有較新的資料，請改按「從雲端下載」。）");
          if (push) {
            await window.App.CloudSync.pushNow();
            refreshStatusOnly();
          }
        }
      });
    }

    const disableBtn = root.querySelector("#cloud-disable-btn");
    if (disableBtn) {
      disableBtn.addEventListener("click", async () => {
        await window.App.CloudSync.configure({ enabled: false });
        render();
      });
    }

    const pushBtn = root.querySelector("#cloud-push-btn");
    if (pushBtn) {
      pushBtn.addEventListener("click", async () => {
        pushBtn.disabled = true;
        const r = await window.App.CloudSync.pushNow();
        pushBtn.disabled = false;
        refreshStatusOnly();
        if (!r.ok) alert(r.error);
      });
    }

    const pullBtn = root.querySelector("#cloud-pull-btn");
    if (pullBtn) {
      pullBtn.addEventListener("click", async () => {
        if (!confirm("從雲端下載會覆蓋這台裝置目前的資料，確定嗎？")) return;
        pullBtn.disabled = true;
        const r = await window.App.CloudSync.pullNow();
        pullBtn.disabled = false;
        refreshStatusOnly();
        if (!r.ok) alert(r.error);
      });
    }
  }

  window.App.UI.Cloud = { render, refreshStatusOnly };
})();
