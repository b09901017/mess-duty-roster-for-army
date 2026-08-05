/*
 * 把一天的班表組成 LINE Flex Message 的 9 張卡片（可左右滑動）。
 *
 * 順序（使用者指定）：
 *   1 早餐勤務   2 中餐勤務   3 晚餐勤務
 *   4 261梯 01-08 個人分工
 *   5 263梯 01-05 個人分工
 *   6 263梯 06-10 個人分工
 *   7 261梯 09-13 個人分工
 *   8 全日勤務
 *   9 公平性總覽（圖片 ＋「看完整」按鈕進 LIFF）
 *
 * 卡片內容跟網頁「文字班表」分頁是同一份資料（js/textFormat.js），不會兩邊長歪。
 */

const INK = "#4a3f35";
const MUTED = "#9a8f84";
const PRIMARY = "#e87a52";
const ACCENT = "#3f8f7f";
const COHORT_COLORS = { 261: "#e87a52", 263: "#3486a0", 旅部: "#7a6bb5" };

/** 卡片切法：{ cohort, from, to }，from/to 是序號範圍（含頭含尾） */
const PERSON_CARDS = [
  { cohort: "261", from: 1, to: 8 },
  { cohort: "263", from: 1, to: 5 },
  { cohort: "263", from: 6, to: 10 },
  { cohort: "261", from: 9, to: 13 },
  { cohort: "旅部", from: 1, to: 8 },
];

function text(content, opts) {
  return Object.assign({ type: "text", text: content, wrap: true }, opts || {});
}

function header(title, subtitle, color) {
  return {
    type: "box",
    layout: "vertical",
    paddingAll: "14px",
    backgroundColor: color,
    contents: [
      text(title, { size: "lg", weight: "bold", color: "#ffffff" }),
      text(subtitle, { size: "xs", color: "#ffffffcc", margin: "xs" }),
    ],
  };
}

function sectionTag(label) {
  return text(label, { size: "xs", weight: "bold", color: PRIMARY, margin: "lg" });
}

/** 一個項目兩行：標號＋名稱在上，人員名單在下 */
function dutyRow(no, label, value, step) {
  return {
    type: "box",
    layout: "vertical",
    margin: "md",
    contents: [
      text(`${step(no)} ${label}`, { size: "xs", color: MUTED }),
      text(value, { size: "sm", color: INK, margin: "xs" }),
    ],
  };
}

function mealBubble(App, dateStr, schedule, mealKey, names) {
  const TF = App.TextFormat;
  const block = TF.mealRows(dateStr, schedule, mealKey, names);
  const contents = [sectionTag("打菜")];
  block.serving.forEach((row, i) => contents.push(dutyRow(i + 1, row.label, row.value, TF.step)));
  contents.push({ type: "separator", margin: "xl", color: "#f0e4d8" });
  contents.push(sectionTag("勤務"));
  block.duties.forEach((row, i) => contents.push(dutyRow(i + 1, row.label, row.value, TF.step)));

  return {
    type: "bubble",
    size: "giga",
    header: header(block.heading, `${TF.formatDateHeader(dateStr)}　${block.menu}`, PRIMARY),
    body: { type: "box", layout: "vertical", paddingAll: "14px", contents },
  };
}

/** 一個人一段：粗體名字，底下三餐的打菜與勤務用換行擠在同一個 text 裡（省 JSON 體積） */
function personBlock(App, dateStr, schedule, member, names) {
  const person = App.TextFormat.personRows(dateStr, schedule, member, names);
  const lines = [];
  person.meals.forEach((meal) => {
    if (meal.note) {
      lines.push(`${meal.head}　${meal.note}`);
      return;
    }
    lines.push(`${meal.head}　打菜：${meal.serving}`);
    lines.push(`　　勤務：${meal.duties}`);
  });
  person.extra.forEach((label) => lines.push(`另　${label}`));

  return {
    type: "box",
    layout: "vertical",
    margin: "lg",
    contents: [
      text(`${person.seqLabel}　${person.name}`, { size: "sm", weight: "bold", color: INK }),
      text(lines.join("\n"), { size: "xs", color: "#6b6259", margin: "xs" }),
    ],
  };
}

function personBubble(App, dateStr, schedule, names, card) {
  const TF = App.TextFormat;
  const members = TF.sortedMembers(App.State.activeMembersOn(dateStr)).filter(
    (m) => m.cohort === card.cohort && m.seq >= card.from && m.seq <= card.to
  );

  const range = `${String(card.from).padStart(2, "0")}-${String(card.to).padStart(2, "0")}`;
  const contents = members.length
    ? members.map((m) => personBlock(App, dateStr, schedule, m, names))
    : [text("這個區間目前沒有人。", { size: "sm", color: MUTED, margin: "lg" })];

  return {
    type: "bubble",
    size: "giga",
    header: header(
      `${(App.State.COHORT_LABELS || {})[card.cohort] || card.cohort}　${range}`,
      `${TF.formatDateHeader(dateStr)}　個人分工　${members.length} 人`,
      COHORT_COLORS[card.cohort] || PRIMARY
    ),
    body: { type: "box", layout: "vertical", paddingAll: "14px", contents },
  };
}

function dailyBubble(App, dateStr, schedule, names) {
  const TF = App.TextFormat;
  const rows = TF.dailyRows(dateStr, schedule, names);
  const contents = rows.length
    ? rows.map((row, i) => dutyRow(i + 1, row.label, row.value, TF.step))
    : [text("今天沒有全日勤務。", { size: "sm", color: MUTED, margin: "lg" })];

  return {
    type: "bubble",
    size: "giga",
    header: header("全日勤務", `${TF.formatDateHeader(dateStr)}　採買與洗衣籃`, ACCENT),
    body: { type: "box", layout: "vertical", paddingAll: "14px", contents },
  };
}

/** 2×2 的項目說明，位置跟圖片裡四張小圖一一對應 */
function fairnessLegend(cells) {
  const cell = (c) =>
    c
      ? {
          type: "box",
          layout: "vertical",
          flex: 1,
          contents: [
            text(c.label, { size: "sm", weight: "bold", color: INK }),
            text(c.summary, { size: "xxs", color: MUTED, margin: "xs" }),
          ],
        }
      : { type: "filler", flex: 1 };

  const rows = [];
  for (let i = 0; i < cells.length; i += 2) {
    rows.push({
      type: "box",
      layout: "horizontal",
      margin: "md",
      spacing: "md",
      contents: [cell(cells[i]), cell(cells[i + 1])],
    });
  }
  return rows;
}

function fairnessBubble(App, dateStr, cells, imageUrl, fullUrl) {
  const TF = App.TextFormat;
  return {
    type: "bubble",
    size: "giga",
    hero: {
      type: "image",
      url: imageUrl,
      size: "full",
      aspectRatio: "1:1",
      aspectMode: "fit",
      backgroundColor: "#fffdfb",
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "14px",
      contents: [
        text("公平性總覽", { size: "lg", weight: "bold", color: INK }),
        text(`主要四項勤務　·　累計到 ${TF.formatDateHeader(dateStr)}`, {
          size: "xs",
          color: MUTED,
          margin: "xs",
        }),
        text("每人固定佔一格，往外伸得越長＝做越多次；顏色偏橘＝偏多，偏藍＝偏少，灰色＝公平範圍內。", {
          size: "xxs",
          color: MUTED,
          margin: "md",
        }),
        { type: "separator", margin: "md", color: "#f0e4d8" },
        ...fairnessLegend(cells),
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "12px",
      contents: [
        {
          type: "button",
          style: "primary",
          height: "sm",
          color: PRIMARY,
          action: { type: "uri", label: "看完整", uri: fullUrl },
        },
      ],
    },
  };
}

/**
 * 組出整組輪播。
 * @returns {{type:"flex", altText:string, contents:{type:"carousel", contents:object[]}}}
 */
function buildCarousel(App, dateStr, schedule, options) {
  const opts = options || {};
  const names = App.TextFormat.displayNameMap();

  const bubbles = App.State.MEAL_KEYS.map((mealKey) => mealBubble(App, dateStr, schedule, mealKey, names));
  PERSON_CARDS.forEach((card) => bubbles.push(personBubble(App, dateStr, schedule, names, card)));
  bubbles.push(dailyBubble(App, dateStr, schedule, names));
  if (opts.imageUrl && opts.fullUrl) {
    bubbles.push(fairnessBubble(App, dateStr, opts.cells || [], opts.imageUrl, opts.fullUrl));
  }

  const suffix = opts.preview ? "（尚未確定紀錄，僅供預覽）" : "";
  return {
    type: "flex",
    altText: `${App.TextFormat.formatDateHeader(dateStr)} 打飯班勤務${suffix}`,
    contents: { type: "carousel", contents: bubbles },
  };
}

module.exports = { buildCarousel, PERSON_CARDS };
