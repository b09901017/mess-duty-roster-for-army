/*
 * LIFF 頁面開起來時要先知道自己的 LIFF ID 才能呼叫 liff.init()。
 * LIFF ID 本來就會出現在 liff.line.me 的網址上，不是秘密，所以這個端點不設限。
 */
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).json({ liffId: process.env.LIFF_ID || null });
};
