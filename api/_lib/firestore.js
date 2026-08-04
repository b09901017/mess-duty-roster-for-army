/*
 * 讀取網頁「雲端同步」寫上去的那份資料。
 *
 * 走 Firestore 的 REST API + 匿名登入，用的是你已經貼在網頁裡的那組 Firebase 設定
 * （Web API Key ＋ Project ID），不需要另外下載服務帳戶金鑰。
 * 這樣現有的 Firestore 規則（allow read, write: if request.auth != null）就夠用了。
 *
 * 需要的環境變數：
 *   FIREBASE_API_KEY     firebaseConfig 裡的 apiKey
 *   FIREBASE_PROJECT_ID  firebaseConfig 裡的 projectId
 *   ROSTER_ROOM_CODE     網頁「雲端同步」分頁裡的房間代碼
 */

const IDENTITY_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signUp";
const FIRESTORE_URL = "https://firestore.googleapis.com/v1/projects";

// 匿名登入拿到的 token 可以用一小時，同一個 container 的請求就不用每次重登
let cachedToken = null;

async function signInAnonymously(apiKey) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.idToken;
  }

  const res = await fetch(`${IDENTITY_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firebase 匿名登入失敗（${res.status}）：${body.slice(0, 300)}`);
  }

  const data = await res.json();
  cachedToken = {
    idToken: data.idToken,
    expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000,
  };
  return cachedToken.idToken;
}

/** Firestore REST 回傳的欄位是 { stringValue: "..." } 這種包裝，這裡拆開 */
function unwrap(value) {
  if (!value || typeof value !== "object") return value;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  return value;
}

/**
 * 抓出雲端那份狀態。
 * @returns {Promise<{payload: string, updatedAt: string|null}>}
 */
async function fetchRoster(env) {
  const apiKey = env.FIREBASE_API_KEY;
  const projectId = env.FIREBASE_PROJECT_ID;
  const roomCode = env.ROSTER_ROOM_CODE;

  const missing = [
    !apiKey && "FIREBASE_API_KEY",
    !projectId && "FIREBASE_PROJECT_ID",
    !roomCode && "ROSTER_ROOM_CODE",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`還沒設定環境變數：${missing.join("、")}`);
  }

  const idToken = await signInAnonymously(apiKey);
  const url = `${FIRESTORE_URL}/${encodeURIComponent(projectId)}/databases/(default)/documents/rosters/${encodeURIComponent(
    roomCode
  )}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });

  if (res.status === 404) {
    throw new Error(`雲端還沒有房間「${roomCode}」的資料。請先在網頁的「雲端同步」分頁按一次上傳。`);
  }
  if (!res.ok) {
    const body = await res.text();
    // token 過期就丟掉重登，下一次請求會重新拿
    if (res.status === 401 || res.status === 403) cachedToken = null;
    throw new Error(`讀取 Firestore 失敗（${res.status}）：${body.slice(0, 300)}`);
  }

  const doc = await res.json();
  const fields = doc.fields || {};
  const payload = unwrap(fields.payload);
  if (!payload) {
    throw new Error("雲端那份資料沒有 payload 欄位，請在網頁上重新上傳一次。");
  }

  return { payload, updatedAt: unwrap(fields.updatedAt) || null };
}

module.exports = { fetchRoster };
