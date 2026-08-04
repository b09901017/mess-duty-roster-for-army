/* LINE Messaging API 的兩件小事：驗簽章、回訊息 */
const crypto = require("crypto");

const REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const VERIFY_ID_TOKEN_URL = "https://api.line.me/oauth2/v2.1/verify";

/**
 * 驗證 X-Line-Signature。一定要用「原始」的 request body 去算，
 * 重新 JSON.stringify 過的字串空白與鍵順序可能不同，簽章就會對不起來。
 */
function verifySignature(rawBody, signature, channelSecret) {
  if (!signature || !channelSecret) return false;
  const expected = crypto.createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * 拿到原始的 request body 字串。
 *
 * 這件事在 Vercel 上比想像中麻煩：平台預設會幫忙把 JSON body parse 掉，
 * stream 也就被讀完了，這時候再去讀 req 只會拿到空字串，簽章一定對不起來
 * （症狀就是 LINE 後台按 Verify 顯示 401）。`config.api.bodyParser = false`
 * 不是每種部署形態都吃得到，所以這裡按可靠度依序試四條路，
 * 並回報是從哪一條拿到的，方便從 log 判斷。
 *
 * @returns {Promise<{raw: string, source: string}>}
 */
async function readRawBody(req) {
  if (typeof req.body === "string") return { raw: req.body, source: "body-string" };
  if (Buffer.isBuffer(req.body)) return { raw: req.body.toString("utf8"), source: "body-buffer" };
  if (req.rawBody) {
    const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody.toString("utf8") : String(req.rawBody);
    return { raw, source: "raw-body-field" };
  }

  // stream 還沒被讀掉就直接讀，這是最準的一條
  if (!req.readableEnded && !req.readableDidRead) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (raw) return { raw, source: "stream" };
  }

  /*
   * 最後手段：body 已經被平台 parse 成物件了，只能重新序列化。
   * LINE 送的是沒有空白的 compact JSON、非 ASCII 不轉義、鍵是字串（V8 會保留插入順序），
   * 所以 JSON.parse → JSON.stringify 對 LINE 的 payload 實務上會還原成同一份位元組。
   * 這條只是保險，正常情況會走上面的 stream。
   */
  if (req.body && typeof req.body === "object") {
    return { raw: JSON.stringify(req.body), source: "restringified" };
  }

  return { raw: "", source: "empty" };
}

async function reply(replyToken, messages, channelAccessToken) {
  const res = await fetch(REPLY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({ replyToken, messages: [].concat(messages) }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE reply 失敗（${res.status}）：${body.slice(0, 500)}`);
  }
}

/** LIFF 頁面拿 /api/state 時用這個確認呼叫的人真的是從 LINE 進來的 */
async function verifyIdToken(idToken, channelId) {
  const res = await fetch(VERIFY_ID_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }).toString(),
  });
  if (!res.ok) return null;
  return res.json();
}

function textMessage(content) {
  return { type: "text", text: content };
}

module.exports = { verifySignature, readRawBody, reply, verifyIdToken, textMessage };
