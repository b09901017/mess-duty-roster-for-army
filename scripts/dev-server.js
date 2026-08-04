#!/usr/bin/env node
/*
 * 本機模擬 Vercel：靜態檔案 ＋ api/ 底下的函式，方便在部署前先跑過一遍。
 *
 *   node scripts/dev-server.js [port]
 *
 * 預設用 repo 裡的種子名冊當雲端資料（MOCK_ROSTER=1），
 * 想接真的 Firestore 就把 MOCK_ROSTER 拿掉並設好 FIREBASE_* 環境變數。
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.argv[2] || 8123);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

/* 假的 Firestore：直接用種子資料算出整段期間的班表，省得部署前還要接雲端 */
function installMockRoster() {
  if (!process.env.MOCK_ROSTER) return;
  const { createApp } = require("../api/_lib/app");
  const App = createApp(null);
  for (let d = 1; d <= 14; d++) App.ScheduleEngine.commitDay(`2026-08-${String(d).padStart(2, "0")}`);
  const payload = App.State.exportJson();

  require("../api/_lib/firestore").fetchRoster = async () => ({
    payload,
    updatedAt: new Date().toISOString(),
  });
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

/** 把 Node 原生的 res 補上 Vercel 函式會用到的幾個方法 */
function vercelify(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(obj));
  };
  res.send = (body) => res.end(body);
  return res;
}

const server = http.createServer(async (req, res) => {
  vercelify(res);
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (pathname.startsWith("/api/")) {
    const name = pathname.slice(5).replace(/\/$/, "");
    const modulePath = path.join(ROOT, "api", `${name}.js`);
    if (!fs.existsSync(modulePath)) {
      res.status(404).json({ error: `沒有 /api/${name}` });
      return;
    }
    try {
      delete require.cache[require.resolve(modulePath)];
      const handler = require(modulePath);
      await handler(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
    return;
  }

  let filePath = path.join(ROOT, pathname === "/" ? "index.html" : pathname.replace(/^\//, ""));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath)) {
    res.status(404).send("Not found");
    return;
  }
  sendFile(res, filePath);
});

installMockRoster();
server.listen(PORT, "127.0.0.1", () => {
  console.log(`http://127.0.0.1:${PORT}/            App`);
  console.log(`http://127.0.0.1:${PORT}/liff/       LIFF 公平性總覽`);
  console.log(`http://127.0.0.1:${PORT}/api/fairness  公平性 PNG`);
  if (process.env.MOCK_ROSTER) console.log("（使用種子名冊，未連 Firestore）");
});

/** 幫忙算 LINE 簽章，測 webhook 用 */
module.exports.sign = (body, secret) =>
  crypto.createHmac("sha256", secret).update(body).digest("base64");
