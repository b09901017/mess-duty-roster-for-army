#!/usr/bin/env node
/*
 * 不用 LINE、不用 Firebase，直接在本機把整條 bot 流程跑一遍：
 *   種子資料 → 排班引擎 → 9 張卡片的 Flex JSON → 公平性 PNG
 *
 * 用法：
 *   node scripts/bot-demo.js [日期] [輸出目錄]
 *   node scripts/bot-demo.js 2026-08-04 /tmp/out
 *
 * 會印出每張卡片的文字內容與整包 JSON 的大小（LINE 上限 50KB），
 * 並把公平性圖片存成 PNG 讓你直接看。
 */
const fs = require("fs");
const path = require("path");

const { createApp } = require("../api/_lib/app");
const { scheduleFor } = require("../api/_lib/roster");
const { buildCarousel } = require("../api/_lib/cards");
const { renderFairnessImage } = require("../api/_lib/fairnessImage");
const { parseCommand } = require("../api/_lib/parseCommand");

const date = process.argv[2] || "2026-08-04";
const outDir = process.argv[3] || path.join(__dirname, "..", ".demo-out");

function collectText(node, lines) {
  if (!node || typeof node !== "object") return lines;
  if (Array.isArray(node)) {
    node.forEach((n) => collectText(n, lines));
    return lines;
  }
  if (node.type === "text" && node.text) lines.push(node.text);
  if (node.type === "button" && node.action) lines.push(`[按鈕] ${node.action.label} → ${node.action.uri}`);
  if (node.type === "image") lines.push(`[圖片] ${node.url}`);
  ["header", "hero", "body", "footer", "contents"].forEach((key) => {
    if (node[key]) collectText(node[key], lines);
  });
  return lines;
}

function main() {
  fs.mkdirSync(outDir, { recursive: true });

  // 沒有雲端資料時就用 repo 裡的種子名冊，並把整段期間都當作已確定
  const App = createApp(null);
  const state = App.State.get();
  for (let d = 1; d <= 14; d++) {
    App.ScheduleEngine.commitDay(`2026-08-${String(d).padStart(2, "0")}`);
  }
  console.log(`名冊 ${state.members.length} 人，已確定 ${state.committedDates.length} 天\n`);

  const result = scheduleFor(App, date);
  if (!result.ok) {
    console.error("取不到班表：", result.error);
    process.exit(1);
  }

  const { png, cells } = renderFairnessImage(App);
  const pngPath = path.join(outDir, "fairness.png");
  fs.writeFileSync(pngPath, png);

  const carousel = buildCarousel(App, date, result.schedule, {
    imageUrl: "https://example.vercel.app/api/fairness?v=demo",
    fullUrl: "https://liff.line.me/0000000000-demo",
    cells,
    preview: result.preview,
  });

  const bubbles = carousel.contents.contents;
  bubbles.forEach((bubble, i) => {
    console.log("═".repeat(58));
    console.log(`卡片 ${i + 1} / ${bubbles.length}`);
    console.log("─".repeat(58));
    console.log(collectText(bubble, []).join("\n"));
    console.log("");
  });

  const json = JSON.stringify(carousel);
  const bytes = Buffer.byteLength(json, "utf8");
  console.log("═".repeat(58));
  console.log(`卡片張數：${bubbles.length}（LINE 上限 12）`);
  console.log(`Flex JSON：${(bytes / 1024).toFixed(1)} KB（LINE 上限 50 KB）`);
  console.log(`公平性 PNG：${(png.length / 1024).toFixed(1)} KB → ${pngPath}`);

  fs.writeFileSync(path.join(outDir, "carousel.json"), JSON.stringify(carousel, null, 2));

  console.log("\n訊息解析測試：");
  [
    "今日勤務",
    "8/5勤務",
    "８／５　勤務",
    "8-13 勤務",
    "明天勤務",
    "8月7日的勤務",
    "勤務說明",
    "今天中午吃什麼",
    "洗碗好累",
  ].forEach((msg) => {
    const parsed = parseCommand(msg, { now: new Date("2026-08-04T02:00:00Z") });
    console.log(`  ${JSON.stringify(msg).padEnd(18)} → ${parsed ? JSON.stringify(parsed) : "（不理會）"}`);
  });

  if (bytes > 50 * 1024) {
    console.error("\n⚠️ Flex JSON 超過 LINE 的 50KB 上限，卡片內容要再精簡。");
    process.exit(1);
  }
}

main();
