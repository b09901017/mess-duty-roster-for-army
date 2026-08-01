/*
 * 雲端同步（Firebase Firestore）。
 *
 * 目的：手機瀏覽器清快取、換手機、或不小心清掉資料時，班表不會不見。
 *
 * 設計：
 *  - localStorage 仍然是主要儲存，離線也能正常用；雲端只是鏡像。
 *  - Firebase 設定與房間代碼存在「另一個」localStorage key，不會被同步覆蓋，
 *    也不會出現在匯出的備份檔裡。
 *  - 整份 state 以 JSON 字串存成一個欄位（Firestore 不支援巢狀陣列，
 *    而 cleanupGroups.groups 正是陣列包陣列，所以不能直接存物件）。
 *  - 用匿名登入，Firestore 規則可以要求 request.auth != null，避免完全公開。
 *  - 衝突處理：最後寫入者為準，畫面上會顯示雲端最後更新時間讓你判斷。
 *  - 沒設定或載不到 Firebase 時完全不影響本機使用。
 */
window.App = window.App || {};

(function () {
  "use strict";

  const CONFIG_KEY = "mess-duty-roster-cloud-config";
  const SDK_VERSION = "10.12.2";
  const PUSH_DEBOUNCE_MS = 1500;

  let cfg = loadConfig();
  let fb = null; // { db, doc, setDoc, getDoc, onSnapshot, serverTimestamp }
  let docRef = null;
  let unsubscribe = null;
  let pushTimer = null;
  let applyingRemote = false;
  let status = { state: "off", message: "尚未設定雲端同步", lastPush: null, lastPull: null, cloudUpdatedAt: null };
  const statusListeners = [];

  function loadConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (raw) return JSON.parse(raw);
    } catch (err) {
      console.warn("讀取雲端設定失敗", err);
    }
    return { enabled: false, firebaseConfig: null, roomCode: "", deviceId: randomId(8) };
  }

  function saveConfig() {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  }

  function randomId(len) {
    const chars = "abcdefghijkmnpqrstuvwxyz23456789";
    let out = "";
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function getConfig() {
    return cfg;
  }

  function getStatus() {
    return status;
  }

  function onStatusChange(fn) {
    statusListeners.push(fn);
  }

  function setStatus(state, message, extra) {
    status = Object.assign({}, status, { state, message }, extra || {});
    statusListeners.forEach((fn) => {
      try {
        fn(status);
      } catch (err) {
        console.warn(err);
      }
    });
  }

  /** 解析使用者貼上的 firebaseConfig，支援純 JSON 或整段 `const firebaseConfig = {...};` */
  function parseFirebaseConfig(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) throw new Error("設定內容是空的");

    const braceStart = trimmed.indexOf("{");
    const braceEnd = trimmed.lastIndexOf("}");
    if (braceStart === -1 || braceEnd === -1) throw new Error("找不到 { } 設定區塊");
    const objText = trimmed.slice(braceStart, braceEnd + 1);

    let parsed;
    try {
      parsed = JSON.parse(objText);
    } catch (err) {
      // 允許 JS 物件字面值（沒有引號的 key、單引號、結尾逗號）
      // eslint-disable-next-line no-new-func
      parsed = Function('"use strict";return (' + objText + ");")();
    }

    if (!parsed || !parsed.projectId || !parsed.apiKey) {
      throw new Error("設定裡缺少 apiKey 或 projectId，請確認貼的是 Firebase 網頁應用程式的設定");
    }
    return parsed;
  }

  async function loadSdk(firebaseConfig) {
    const base = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;
    const [appMod, storeMod, authMod] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-firestore.js`),
      import(`${base}/firebase-auth.js`),
    ]);

    const app = appMod.initializeApp(firebaseConfig, "mess-duty-roster");
    const auth = authMod.getAuth(app);
    await authMod.signInAnonymously(auth);
    const db = storeMod.getFirestore(app);

    return {
      db,
      doc: storeMod.doc,
      setDoc: storeMod.setDoc,
      getDoc: storeMod.getDoc,
      onSnapshot: storeMod.onSnapshot,
      serverTimestamp: storeMod.serverTimestamp,
    };
  }

  function describeError(err) {
    const code = (err && err.code) || "";
    if (code.includes("auth/configuration-not-found") || code.includes("auth/operation-not-allowed")) {
      return "Firebase 專案還沒開啟「匿名登入」。請到 Firebase 主控台 → Authentication → Sign-in method → 啟用「匿名」。";
    }
    if (code.includes("permission-denied")) {
      return "Firestore 權限被拒絕。請確認資料庫規則已允許登入的使用者讀寫 rosters 集合（README 有規則可直接複製）。";
    }
    if (code.includes("unavailable") || (err && err.message && err.message.includes("Failed to fetch"))) {
      return "連不上雲端（可能是網路問題或載入 Firebase 失敗），資料仍然安全存在這台裝置。";
    }
    return (err && err.message) || String(err);
  }

  /** 啟用雲端同步：連線、拉一次雲端資料、開始監聽 */
  async function connect() {
    if (!cfg.enabled || !cfg.firebaseConfig || !cfg.roomCode) {
      setStatus("off", "尚未設定雲端同步");
      return { ok: false };
    }

    setStatus("connecting", "連線中…");
    try {
      fb = await loadSdk(cfg.firebaseConfig);
      docRef = fb.doc(fb.db, "rosters", cfg.roomCode);

      if (unsubscribe) unsubscribe();
      unsubscribe = fb.onSnapshot(
        docRef,
        (snap) => {
          if (!snap.exists()) {
            setStatus("connected", "雲端還沒有這個房間的資料，按「上傳到雲端」建立第一份備份。");
            return;
          }
          const data = snap.data();
          if (data.updatedBy === cfg.deviceId) {
            setStatus("connected", "已同步", { cloudUpdatedAt: toDateString(data.updatedAt) });
            return;
          }
          applyRemote(data);
        },
        (err) => setStatus("error", describeError(err))
      );

      return { ok: true };
    } catch (err) {
      setStatus("error", describeError(err));
      return { ok: false, error: describeError(err) };
    }
  }

  function toDateString(ts) {
    if (!ts) return null;
    try {
      const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
      return d.toLocaleString("zh-TW", { hour12: false });
    } catch (err) {
      return null;
    }
  }

  function applyRemote(data) {
    let parsed;
    try {
      parsed = JSON.parse(data.payload);
    } catch (err) {
      setStatus("error", "雲端資料格式看不懂，已略過。");
      return;
    }
    applyingRemote = true;
    window.App.State.saveWithoutNotifying(() => {
      window.App.State.replaceState(window.App.State.migrate(parsed));
      window.App.ScheduleEngine.rebuildAll();
    });
    applyingRemote = false;
    setStatus("connected", "已從雲端更新", {
      lastPull: new Date().toLocaleString("zh-TW", { hour12: false }),
      cloudUpdatedAt: toDateString(data.updatedAt),
    });
    if (window.App.renderAll) window.App.renderAll();
  }

  /** 立刻把本機資料寫上雲端 */
  async function pushNow() {
    if (!fb || !docRef) {
      const result = await connect();
      if (!result.ok) return result;
    }
    try {
      setStatus("syncing", "上傳中…");
      await fb.setDoc(docRef, {
        payload: window.App.State.exportJson(),
        updatedAt: fb.serverTimestamp(),
        updatedBy: cfg.deviceId,
      });
      const now = new Date().toLocaleString("zh-TW", { hour12: false });
      setStatus("connected", "已同步", { lastPush: now, cloudUpdatedAt: now });
      return { ok: true };
    } catch (err) {
      const message = describeError(err);
      setStatus("error", message);
      return { ok: false, error: message };
    }
  }

  /** 從雲端拉一份覆蓋本機 */
  async function pullNow() {
    if (!fb || !docRef) {
      const result = await connect();
      if (!result.ok) return result;
    }
    try {
      setStatus("syncing", "下載中…");
      const snap = await fb.getDoc(docRef);
      if (!snap.exists()) {
        setStatus("connected", "雲端還沒有這個房間的資料。");
        return { ok: false, error: "雲端還沒有這個房間的資料。" };
      }
      applyRemote(snap.data());
      return { ok: true };
    } catch (err) {
      const message = describeError(err);
      setStatus("error", message);
      return { ok: false, error: message };
    }
  }

  function schedulePush() {
    if (!cfg.enabled || applyingRemote) return;
    clearTimeout(pushTimer);
    setStatus("pending", "有變更，稍後自動上傳…");
    pushTimer = setTimeout(() => {
      pushNow();
    }, PUSH_DEBOUNCE_MS);
  }

  /** 儲存設定並（若啟用）重新連線 */
  async function configure({ firebaseConfigText, roomCode, enabled }) {
    try {
      if (enabled) {
        const parsedConfig = parseFirebaseConfig(firebaseConfigText);
        const code = String(roomCode || "").trim();
        if (!code) throw new Error("請填一個房間代碼");
        if (!/^[A-Za-z0-9_-]{4,64}$/.test(code)) {
          throw new Error("房間代碼只能用英數字、-、_，長度 4～64");
        }
        cfg.firebaseConfig = parsedConfig;
        cfg.roomCode = code;
      }
      cfg.enabled = !!enabled;
      if (!cfg.deviceId) cfg.deviceId = randomId(8);
      saveConfig();
    } catch (err) {
      setStatus("error", err.message);
      return { ok: false, error: err.message };
    }

    if (!cfg.enabled) {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      fb = null;
      docRef = null;
      setStatus("off", "已停用雲端同步（資料仍存在這台裝置）");
      return { ok: true };
    }

    return connect();
  }

  function disconnect() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    fb = null;
    docRef = null;
  }

  function init() {
    window.App.State.onSave(schedulePush);
    if (cfg.enabled && cfg.firebaseConfig && cfg.roomCode) {
      connect();
    } else {
      setStatus("off", "尚未設定雲端同步");
    }
  }

  window.App.CloudSync = {
    init,
    configure,
    connect,
    disconnect,
    pushNow,
    pullNow,
    getConfig,
    getStatus,
    onStatusChange,
    randomId,
    parseFirebaseConfig,
  };
})();
