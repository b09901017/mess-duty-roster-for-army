/*
 * LINE Messaging API 的 webhook。
 *
 * 把這個網址（https://你的網域/api/webhook）填到 LINE Developers 的 Webhook URL。
 * 群組裡打「今日勤務」「8/5 勤務」或 @ 這個機器人，就會回一組可以左右滑的卡片。
 *
 * 需要的環境變數：
 *   LINE_CHANNEL_SECRET        LINE Developers → Basic settings
 *   LINE_CHANNEL_ACCESS_TOKEN  LINE Developers → Messaging API（長期 token）
 *   FIREBASE_API_KEY / FIREBASE_PROJECT_ID / ROSTER_ROOM_CODE   見 _lib/firestore.js
 *   LIFF_ID                    （選用）公平性總覽「看完整」要開的 LIFF
 *   PUBLIC_BASE_URL            （選用）圖片網址用的網域，沒設就從請求標頭推
 */
const { verifySignature, readRawBody, reply, textMessage } = require("./_lib/line");
const { parseCommand } = require("./_lib/parseCommand");
const { loadApp, scheduleFor } = require("./_lib/roster");
const { buildCarousel } = require("./_lib/cards");
const { renderFairnessImage } = require("./_lib/fairnessImage");

const HELP_TEXT = [
  "打飯班小幫手用法：",
  "・今日勤務　→ 今天的班表",
  "・明日勤務／昨日勤務",
  "・8/5 勤務　→ 指定日期",
  "・直接 @我 也會回今天的",
  "回覆是可以左右滑的卡片：三餐勤務、各梯個人分工、全日勤務、公平性總覽。",
].join("\n");

function baseUrlOf(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function fullUrlOf(req) {
  if (process.env.LIFF_ID) return `https://liff.line.me/${process.env.LIFF_ID}`;
  const key = process.env.STATE_READ_KEY;
  return `${baseUrlOf(req)}/liff/${key ? `?k=${encodeURIComponent(key)}` : ""}`;
}

/**
 * 這則訊息有沒有 @ 到「機器人自己」。
 * 只認 isSelf，不能看有沒有 mentionees——群組裡 @ 別人也會有 mentionees，
 * 那樣機器人會在每次有人被標記時都插話。
 */
function mentionsBot(message) {
  const mentionees = (message.mention && message.mention.mentionees) || [];
  return mentionees.some((m) => m.isSelf === true);
}

async function handleEvent(event, req) {
  if (event.type !== "message" || !event.message || event.message.type !== "text") return;

  const command = parseCommand(event.message.text, { mentionedBot: mentionsBot(event.message) });
  if (!command) return;

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (command.kind === "help") {
    await reply(event.replyToken, textMessage(HELP_TEXT), token);
    return;
  }

  let loaded;
  try {
    loaded = await loadApp(process.env);
  } catch (err) {
    await reply(event.replyToken, textMessage(`讀不到班表資料：${err.message}`), token);
    return;
  }

  const { App, updatedAt } = loaded;
  const result = scheduleFor(App, command.date);
  if (!result.ok) {
    await reply(event.replyToken, textMessage(result.error), token);
    return;
  }

  // 圖片走另一個端點，LINE 的 CDN 會照網址快取，所以把資料更新時間放進網址當版本
  const version = encodeURIComponent(String(updatedAt || "").replace(/[^0-9]/g, "").slice(0, 14) || "0");
  const imageUrl = `${baseUrlOf(req)}/api/fairness?v=${version}`;

  let cells = [];
  try {
    cells = renderFairnessImage(App).cells;
  } catch (err) {
    console.error("公平性圖表算不出來", err);
  }

  const carousel = buildCarousel(App, command.date, result.schedule, {
    imageUrl,
    fullUrl: fullUrlOf(req),
    cells,
    preview: result.preview,
  });

  const messages = [carousel];
  if (result.preview) {
    messages.unshift(
      textMessage(`${command.date} 還沒在 App 按「確定紀錄」，以下是即時算出來的預覽（排班是決定性的，確定後會一模一樣）。`)
    );
  }

  await reply(event.replyToken, messages, token);
}

/*
 * 用瀏覽器或 curl 打這個網址（GET）會回自我診斷。
 * LINE 後台按 Verify 失敗時，先看這裡：
 *   - 看到這份 JSON      → 函式活著，問題出在簽章或環境變數
 *   - 看到 Vercel 登入頁 → 是 Vercel 的 Deployment Protection 擋掉，請求根本沒進來
 *   - 404               → 網址打錯
 * 只回布林值，不會吐出任何密鑰內容。
 */
function diagnostics() {
  const has = (name) => Boolean(process.env[name]);
  const required = [
    "LINE_CHANNEL_SECRET",
    "LINE_CHANNEL_ACCESS_TOKEN",
    "FIREBASE_API_KEY",
    "FIREBASE_PROJECT_ID",
    "ROSTER_ROOM_CODE",
  ];
  const missing = required.filter((name) => !has(name));
  return {
    ok: missing.length === 0,
    service: "打飯班小幫手 LINE webhook",
    hint: "這個網址要填進 LINE Developers 的 Webhook URL。LINE 會用 POST 呼叫，GET 只會看到這份診斷。",
    環境變數: {
      LINE_CHANNEL_SECRET: has("LINE_CHANNEL_SECRET"),
      LINE_CHANNEL_ACCESS_TOKEN: has("LINE_CHANNEL_ACCESS_TOKEN"),
      FIREBASE_API_KEY: has("FIREBASE_API_KEY"),
      FIREBASE_PROJECT_ID: has("FIREBASE_PROJECT_ID"),
      ROSTER_ROOM_CODE: has("ROSTER_ROOM_CODE"),
      PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || null,
      LIFF_ID: has("LIFF_ID"),
      LIFF_CHANNEL_ID: has("LIFF_CHANNEL_ID"),
      STATE_READ_KEY: has("STATE_READ_KEY"),
    },
    缺少的必填項: missing,
    看完整按鈕: liffButtonMode(),
    下一步:
      missing.length > 0
        ? `到 Vercel 的 Settings → Environment Variables 補上 ${missing.join("、")}，然後一定要 Redeploy 才會生效。`
        : "環境變數都有了。如果 Verify 還是 401，請看 Vercel 的 Functions log，裡面會寫是簽章不符還是讀不到 body。",
  };
}

/** 公平性總覽那張卡片的「看完整」現在會連到哪裡、需不需要補設定 */
function liffButtonMode() {
  if (process.env.LIFF_ID) {
    return process.env.LIFF_CHANNEL_ID
      ? "LIFF 模式：按鈕開 liff.line.me，用 LINE 身分驗證。"
      : "⚠️ 設了 LIFF_ID 但沒設 LIFF_CHANNEL_ID，點進去會驗不過。請補上「LINE Login channel」的 Channel ID 並 Redeploy。";
  }
  if (process.env.STATE_READ_KEY) {
    return "網頁模式：按鈕開 /liff/?k=<STATE_READ_KEY>。注意舊卡片上的按鈕帶的是當時的金鑰，改過設定要重新叫一次「今日勤務」。";
  }
  return "⚠️ LIFF_ID 與 STATE_READ_KEY 都沒設，按鈕會連到沒有金鑰的網址，點進去會顯示「網址上沒有帶金鑰」。請設一個 STATE_READ_KEY 並 Redeploy。";
}

module.exports = async (req, res) => {
  if (req.method === "GET") {
    res.status(200).json(diagnostics());
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "只接受 POST" });
    return;
  }

  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) {
    console.error("LINE_CHANNEL_SECRET 沒有設定，無法驗證簽章。到 Vercel 設好環境變數並 Redeploy。");
    res.status(500).json({ error: "伺服器沒有設定 LINE_CHANNEL_SECRET" });
    return;
  }

  const signature = req.headers["x-line-signature"];
  const { raw: rawBody, source } = await readRawBody(req);

  if (!verifySignature(rawBody, signature, secret)) {
    // 把判斷得出來的線索寫進 log，Vercel 的 Functions log 看得到
    console.error(
      `簽章驗證失敗：有無 X-Line-Signature=${Boolean(signature)}、body 來源=${source}、body 長度=${rawBody.length}。` +
        (rawBody.length === 0
          ? "body 是空的，通常是平台先把 body parse 掉了。"
          : "body 讀得到，那多半是 LINE_CHANNEL_SECRET 填錯（注意不是 Channel access token）。")
    );
    res.status(401).json({ error: "簽章驗證失敗", bodySource: source, bodyLength: rawBody.length });
    return;
  }

  let body;
  try {
    body = JSON.parse(rawBody || "{}");
  } catch (err) {
    res.status(400).json({ error: "body 不是合法的 JSON" });
    return;
  }

  const events = body.events || [];
  // LINE 後台按「Verify」時送的是空的 events，直接回 200 就好
  const results = await Promise.allSettled(events.map((event) => handleEvent(event, req)));
  results.forEach((r) => {
    if (r.status === "rejected") console.error("處理事件失敗", r.reason);
  });

  res.status(200).json({ ok: true });
};

// 簽章一定要用原始 body 去算，所以請 Vercel 不要先幫忙 parse
module.exports.config = { api: { bodyParser: false } };
