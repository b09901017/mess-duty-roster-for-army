/*
 * 給公平性總覽頁面用的唯讀資料端點：回傳雲端那份完整狀態。
 *
 * 名冊裡有真實姓名，所以要通過其中一種檢查才給：
 *   1. 帶 LINE 的 ID token（從 LINE 點進 LIFF 時走這條，網址上不會有秘密）
 *   2. ?k=<STATE_READ_KEY>（沒有設 LIFF、或在一般瀏覽器開的時候走這條）
 * 兩個都沒設定就直接拒絕，避免不小心把整份名冊公開在網路上。
 *
 * 注意 LIFF_CHANNEL_ID 要填「LINE Login channel」的 Channel ID，
 * 不是 Messaging API channel 的——LINE 已經不允許把 LIFF 掛在 Messaging API
 * channel 上，ID token 是由 Login channel 簽發的，client_id 必須對得起來。
 */
const { loadApp } = require("./_lib/roster");
const { verifyIdToken } = require("./_lib/line");

async function authorize(req) {
  const key = process.env.STATE_READ_KEY;
  const channelId = process.env.LIFF_CHANNEL_ID;

  if (!key && !channelId) {
    return {
      ok: false,
      status: 500,
      error:
        "伺服器還沒設定 STATE_READ_KEY 或 LIFF_CHANNEL_ID，為安全起見不提供資料。" +
        "只想先用起來的話，設一個 STATE_READ_KEY 就夠了，不一定要開 LIFF。",
    };
  }

  const auth = req.headers.authorization || "";
  const idToken = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (idToken && !channelId) {
    return {
      ok: false,
      status: 500,
      error:
        "從 LINE 帶了身分 token 進來，但伺服器沒設 LIFF_CHANNEL_ID，沒辦法驗證。" +
        "請填上「LINE Login channel」的 Channel ID（不是 Messaging API channel 的）並 Redeploy。",
    };
  }

  if (idToken && channelId) {
    const profile = await verifyIdToken(idToken, channelId);
    if (profile) return { ok: true };
    return {
      ok: false,
      status: 401,
      error:
        "LINE 身分驗證沒過。通常是 LIFF_CHANNEL_ID 填成 Messaging API channel 的 Channel ID 了，" +
        "要填發出這個 LIFF 的那個「LINE Login channel」的 Channel ID。",
    };
  }

  const url = new URL(req.url, "http://localhost");
  if (key && url.searchParams.get("k") === key) return { ok: true };

  return { ok: false, status: 401, error: "沒有權限讀取這份資料。" };
}

module.exports = async (req, res) => {
  const allowed = await authorize(req);
  if (!allowed.ok) {
    res.status(allowed.status).json({ error: allowed.error });
    return;
  }

  try {
    const { payload, updatedAt } = await loadApp(process.env);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ payload, updatedAt });
  } catch (err) {
    console.error("讀取班表資料失敗", err);
    res.status(500).json({ error: err.message });
  }
};
