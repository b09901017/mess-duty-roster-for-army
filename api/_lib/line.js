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

/** Vercel 預設會幫忙 parse body，這裡三種情況都接得住，拿到的一定是原始字串 */
async function readRawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
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
