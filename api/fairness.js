/*
 * 公平性總覽那張圖（PNG）。LINE 的 Flex Message 只吃圖片網址，所以獨立成一個端點。
 *
 * 網址帶 ?v=<資料更新時間> 當版本，LINE 的 CDN 照網址快取，資料變了網址就會變。
 */
const { loadApp } = require("./_lib/roster");
const { renderFairnessImage } = require("./_lib/fairnessImage");

module.exports = async (req, res) => {
  try {
    const { App } = await loadApp(process.env);
    const { png } = renderFairnessImage(App);

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", png.length);
    // 網址帶版本，所以可以放心讓 CDN 長期快取
    res.setHeader("Cache-Control", "public, max-age=600, s-maxage=600, immutable");
    res.status(200).send(png);
  } catch (err) {
    console.error("產生公平性圖片失敗", err);
    res.status(500).json({ error: err.message });
  }
};
