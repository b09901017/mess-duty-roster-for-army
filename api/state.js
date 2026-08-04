/*
 * 給 LIFF 頁面用的唯讀資料端點：回傳雲端那份完整狀態。
 *
 * 名冊裡有真實姓名，所以要通過其中一種檢查才給：
 *   1. LIFF 頁面帶 LINE 的 ID token（正常情況走這條，網址上不會有秘密）
 *   2. ?k=<STATE_READ_KEY>（在一般瀏覽器開的時候用）
 * 兩個都沒設定的話直接拒絕，避免不小心把整份名冊公開在網路上。
 */
const { loadApp } = require("./_lib/roster");
const { verifyIdToken } = require("./_lib/line");

async function authorize(req) {
  const key = process.env.STATE_READ_KEY;
  const channelId = process.env.LIFF_CHANNEL_ID;

  if (!key && !channelId) {
    return { ok: false, status: 500, error: "伺服器還沒設定 STATE_READ_KEY 或 LIFF_CHANNEL_ID，為安全起見不提供資料。" };
  }

  const auth = req.headers.authorization || "";
  const idToken = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (idToken && channelId) {
    const profile = await verifyIdToken(idToken, channelId);
    if (profile) return { ok: true };
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
