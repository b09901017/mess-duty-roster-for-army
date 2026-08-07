/*
 * 把一天的班表組成 LINE Flex Message 的一組卡片（可左右滑動）。
 *
 * 順序（使用者指定）：
 *   打飯流程一張（固定內容，不分日期——先講清楚一餐怎麼跑，再看今天誰做什麼）
 *   全日勤務一張（採買、掃廁所、換水、洗衣籃這些不分餐別的事，早點看到比較好安排）
 *   早餐 → 中餐 → 晚餐 各一張（那天沒有的餐就不發，例如 8/14 只吃早餐）
 *   261梯 01-08 ／ 263梯 01-05 ／ 263梯 06-10 ／ 招員（261梯 09-13）／ 旅部連
 *     個人分工各一張（那一組沒有人就不發）
 *   公平性總覽一張（圖片 ＋「看完整」按鈕）
 *
 * 每一餐的卡片照現場動線分段：前置 → 打菜 → 抬便當 → 善後勤務 → 撤收。
 * 分段的定義與內容跟網頁「文字班表」同源（js/state.js 的 MEAL_SECTIONS
 * ＋ js/textFormat.js 的 mealRows），不會兩邊長歪。
 */

const INK = "#4a3f35";
const MUTED = "#9a8f84";

/*
 * 每張卡片的標題底色。
 *
 * 分成三個色系，滑到哪一區一眼就知道：
 *   三餐   暖色，照時間由淺到深（早＝金、中＝紅、晚＝暗紫），像一天的光線變化
 *   個人   冷色，每個梯次一個色（261 青綠／263 藍／招員 綠／旅部連 紫）
 *   其他   中性色（全日＝暖褐、公平性＝深灰藍）
 *
 * 全部都退了一點飽和度（維持原本的明度，只把彩度收到約七成），
 * 顏色柔和一些、看久不刺眼，白字的對比不受影響。
 *
 * 兩件事由 npm run check:colors 把關：
 *   1. 白色標題與 80% 白的副標在每個底色上都達到 WCAG 4.5 / 3.0
 *   2. 相鄰兩張卡片的色差（CIE Lab ΔE）都 ≥ 20，滑動時看得出換了一張
 *      （兩張 263 刻意用同一色，因為本來就是同一梯）
 */
const CARD_COLORS = {
  // 流程卡是「說明」不是「今天的名單」，所以用一個誰也不像的冷中性色跟後面整組岔開
  flow: "#37566B",
  breakfast: "#8A6C2C",
  lunch: "#AC523B",
  dinner: "#77455E",
  daily: "#725D4B",
  fairness: "#39424D",
};

// 流程卡的細節用色：步驟編號的圓底用主色，說明文字比內文再淡一階
const FLOW_LINE = "#e8ddd2";

/** 卡片切法：from/to 是序號範圍（含頭含尾）；title 與 color 各組自己一套 */
const PERSON_CARDS = [
  { cohort: "261", from: 1, to: 8, title: "261 梯", color: "#256B61" },
  { cohort: "263", from: 1, to: 5, title: "263 梯", color: "#3B639E" },
  { cohort: "263", from: 6, to: 10, title: "263 梯", color: "#3B639E" },
  { cohort: "261", from: 9, to: 13, title: "招員", color: "#477043" },
  { cohort: "旅部", from: 1, to: 8, title: "旅部連", color: "#6D5A9C" },
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

function sectionTag(label, color) {
  return text(label, { size: "xs", weight: "bold", color: color, margin: "lg" });
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

/*
 * 打飯流程卡。
 *
 * 內容是固定的（js/state.js 的 MEAL_FLOW），跟哪一天無關——放第一張是因為
 * 「一餐怎麼跑」要先講清楚，後面幾張才是「今天誰做什麼」。
 *
 * 版面分兩層，兩層講同一件事、深淺不同：
 *   上面一行  整條流程擠在一行，一眼掃完（前置 › 打菜 › … › 撤收）
 *   下面逐步  編號圓底 ＋ 標題 ＋ 誰做 ＋ 細項，要細看時才往下讀
 * 每一步之間畫一條分隔線，滑的時候段落感才清楚。
 */
function stepBadge(no, color) {
  return {
    type: "box",
    layout: "vertical",
    width: "22px",
    height: "22px",
    cornerRadius: "11px",
    backgroundColor: color,
    justifyContent: "center",
    alignItems: "center",
    contents: [text(String(no), { size: "xxs", weight: "bold", color: "#ffffff", align: "center" })],
  };
}

function flowStep(step, no, color, isLast) {
  const right = [text(step.title, { size: "sm", weight: "bold", color: INK })];
  if (step.who) right.push(text(step.who, { size: "xxs", color: color, margin: "xs" }));
  step.notes.forEach((note) => right.push(text(`・${note}`, { size: "xxs", color: MUTED, margin: "xs" })));

  const row = {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    margin: "lg",
    contents: [
      { type: "box", layout: "vertical", flex: 0, width: "24px", contents: [stepBadge(no, color)] },
      { type: "box", layout: "vertical", flex: 1, contents: right },
    ],
  };
  return isLast ? [row] : [row, { type: "separator", margin: "lg", color: FLOW_LINE }];
}

function flowBubble(App) {
  const FLOW = App.State.MEAL_FLOW;
  const color = CARD_COLORS.flow;

  const contents = [
    // 整條流程一行掃完；用細箭頭而不是 ➡️，一行才塞得下不折行
    text(FLOW.map((s) => s.title).join(" › "), { size: "xs", color: color, weight: "bold" }),
    { type: "separator", margin: "lg", color: FLOW_LINE },
  ];
  FLOW.forEach((step, i) => {
    flowStep(step, i + 1, color, i === FLOW.length - 1).forEach((node) => contents.push(node));
  });

  return {
    type: "bubble",
    size: "giga",
    header: header("打飯流程", "每一餐都照這個順序　·　固定內容，不分日期", color),
    body: { type: "box", layout: "vertical", paddingAll: "14px", contents },
  };
}

function mealBubble(App, dateStr, schedule, mealKey, names) {
  const TF = App.TextFormat;
  const color = CARD_COLORS[mealKey];
  const block = TF.mealRows(dateStr, schedule, mealKey, names);
  const contents = [];
  block.sections.forEach((section, si) => {
    if (si > 0) contents.push({ type: "separator", margin: "xl", color: "#f0e4d8" });
    contents.push(sectionTag(section.title + (section.hint ? `（${section.hint}）` : ""), color));
    section.notes.forEach((note) => contents.push(text(`・${note}`, { size: "xs", color: MUTED, margin: "md" })));
    section.rows.forEach((row, i) => contents.push(dutyRow(i + 1, row.label, row.value, TF.step)));
  });

  return {
    type: "bubble",
    size: "giga",
    header: header(block.heading, `${TF.formatDateHeader(dateStr)}　${block.menu}`, color),
    body: { type: "box", layout: "vertical", paddingAll: "14px", contents },
  };
}

/**
 * 一個人一段：粗體名字，底下三餐的打菜與勤務用換行擠在同一個 text 裡（省 JSON 體積）。
 * 名字用整張卡片的主色，一眼看得出「這張是哪一梯的」，滑過去也比較好認。
 */
function personBlock(App, dateStr, schedule, member, names, color) {
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
      text(`${person.seqLabel}　${person.name}`, { size: "sm", weight: "bold", color: color || INK }),
      text(lines.join("\n"), { size: "xs", color: "#6b6259", margin: "xs" }),
    ],
  };
}

function personBubble(App, dateStr, schedule, names, card) {
  const TF = App.TextFormat;
  const members = TF.sortedMembers(App.State.activeMembersOn(dateStr)).filter(
    (m) => m.cohort === card.cohort && m.seq >= card.from && m.seq <= card.to
  );

  /*
   * 標題的號碼範圍照「這天實際有誰」算，不是照設定的上下界。
   * 旅部連設定寫到 8 號是留空間給之後加人，但目前只有 4 位，
   * 寫「01-08」會讓人以為有人漏掉了。
   */
  const range = members.length
    ? `${String(members[0].seq).padStart(2, "0")}-${String(members[members.length - 1].seq).padStart(2, "0")}`
    : `${String(card.from).padStart(2, "0")}-${String(card.to).padStart(2, "0")}`;
  const contents = members.length
    ? members.map((m) => personBlock(App, dateStr, schedule, m, names, card.color))
    : [text("這個區間目前沒有人。", { size: "sm", color: MUTED, margin: "lg" })];

  return {
    type: "bubble",
    size: "giga",
    header: header(
      `${card.title}　${range}`,
      `${TF.formatDateHeader(dateStr)}　個人分工　${members.length} 人`,
      card.color
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
    header: header("全日勤務", `${TF.formatDateHeader(dateStr)}　不分餐別的事`, CARD_COLORS.daily),
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
  /*
   * 副標寫「真正算進去的是哪幾天」，不是「你問的那一天」。
   * 問 8/7 的勤務時，圖上算的其實是「已經確定紀錄過、而且 8/6 以後」的那些天，
   * 寫成「累計到 8/7」會讓人以為 8/7 已經算進去了。
   */
  const counted = App.FairnessChart.countedRange();
  return {
    type: "bubble",
    size: "giga",
    header: header("公平性總覽", `主要四項勤務　·　${counted.label}`, CARD_COLORS.fairness),
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
          color: CARD_COLORS.fairness,
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

  // 先講流程，再講不分餐別的全日勤務，然後才是三餐與個人分工
  const bubbles = [flowBubble(App), dailyBubble(App, dateStr, schedule, names)];

  App.TextFormat.mealKeysOf(dateStr, schedule).forEach((mealKey) =>
    bubbles.push(mealBubble(App, dateStr, schedule, mealKey, names))
  );
  /*
   * 沒有人的那一組就不發卡片（旅部連 8/7 起調走了）。
   * 空卡片只是讓人多滑一次，還會以為是不是漏掉誰。
   */
  PERSON_CARDS.forEach((card) => {
    const has = App.State.activeMembersOn(dateStr).some(
      (m) => m.cohort === card.cohort && m.seq >= card.from && m.seq <= card.to
    );
    if (has) bubbles.push(personBubble(App, dateStr, schedule, names, card));
  });
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

module.exports = { buildCarousel, PERSON_CARDS, CARD_COLORS };
