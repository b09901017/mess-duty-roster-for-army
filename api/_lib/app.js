/*
 * 在 Node 裡跑瀏覽器那份排班程式碼。
 *
 * js/ 底下的檔案都是純瀏覽器腳本（IIFE 掛到 window.App），為了不讓 LINE bot 跟
 * 網頁的規則慢慢長歪，這裡不重寫一份，而是直接把同一批檔案丟進 vm sandbox 執行，
 * 只補一個記憶體版的 localStorage 給 state.js 用。
 *
 * 也就是說：機器人算出來的班表，跟你在網頁上按「確定紀錄」看到的，
 * 一定是同一份。
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const JS_DIR = path.join(__dirname, "..", "..", "js");

/*
 * 載入順序有關係：scheduleEngine.js 在載入當下就會讀 window.App.State.MEAL_KEYS，
 * 所以 state.js 一定要在最前面，scheduleEngine.js 要在最後面。
 * 這裡只載入純邏輯的檔案，ui-*.js 需要 DOM，不載。
 */
const FILES = [
  "state.js",
  "shoppingRoster.js",
  "dutySizeConfig.js",
  "washSchedule.js",
  "otherDuties.js",
  "cleanupSchedule.js",
  "laundry.js",
  "waterSchedule.js",
  "servingLine.js",
  "dutyView.js",
  "scheduleImport.js",
  "textFormat.js",
  "fairnessChart.js",
  "scheduleEngine.js",
];

// 檔案內容只讀一次，之後同一個 container 的請求就直接重用
let sources = null;
function readSources() {
  if (!sources) {
    sources = FILES.map((file) => ({
      file,
      code: fs.readFileSync(path.join(JS_DIR, file), "utf8"),
    }));
  }
  return sources;
}

function memoryLocalStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

/**
 * 建一個乾淨的 App 實例。每個請求都重新建一份，狀態才不會在請求之間互相污染。
 * @param {string|object|null} payload - 雲端存的整份狀態（JSON 字串或已 parse 的物件）
 * @returns {object} window.App
 */
function createApp(payload) {
  const sandbox = {
    console,
    localStorage: memoryLocalStorage(),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);
  readSources().forEach(({ file, code }) => {
    vm.runInContext(code, context, { filename: `js/${file}` });
  });

  const App = sandbox.window.App;

  if (payload) {
    const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
    App.State.replaceState(App.State.migrate(parsed));
    // 依現在這份程式碼的規則把已確定的日期重播一遍，
    // 雲端資料就算是舊版寫的，機器人回的也會是最新規則的結果。
    App.ScheduleEngine.rebuildAll();
  }

  return App;
}

module.exports = { createApp, FILES };
