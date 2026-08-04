/*
 * 公平性總覽那張圖：主要四項勤務排成 2×2。
 *
 * 圖裡刻意不放文字（伺服器上沒有中文字型，硬塞一份進 repo 只為了四個詞不划算），
 * 項目名稱由 LINE 卡片用同樣的 2×2 排版寫在圖下面，對得起來就看得懂。
 */
const { encodePng, createCanvas, drawRose } = require("./png");

// 版面配置：洗碗 廚餘 / 打菜 撤收
const MAIN_DUTIES = ["dishwash", "foodwaste", "serveDish", "cleanup"];
const COLUMNS = 2;

const SIZE = 800; // 正方形，Flex 的 hero 用 1:1
const BG = "#fffdfb";
const GRID_LINE = "#f0e4d8";

function drawGridLines(canvas) {
  const [r, g, b] = [240, 228, 216];
  const mid = SIZE / 2;
  for (let i = 0; i < SIZE; i++) {
    for (const [x, y] of [
      [mid, i],
      [i, mid],
    ]) {
      const idx = (y * canvas.width + x) * 3;
      canvas.data[idx] = r;
      canvas.data[idx + 1] = g;
      canvas.data[idx + 2] = b;
    }
  }
}

/**
 * @param {object} App - api/_lib/app.js 建出來的 window.App
 * @returns {{png: Buffer, cells: {dutyKey, label, summary, empty}[]}}
 */
function renderFairnessImage(App) {
  const state = App.State.get();
  const members = App.TextFormat.sortedMembers(App.State.activeMembers());
  const FC = App.FairnessChart;

  const canvas = createCanvas(SIZE, SIZE, BG);
  drawGridLines(canvas);

  const cellSize = SIZE / COLUMNS;
  const radius = cellSize * 0.36;

  const cells = MAIN_DUTIES.map((dutyKey, i) => {
    const model = FC.chartModel(dutyKey, members, state.dutyCounts);
    const cx = (i % COLUMNS) * cellSize + cellSize / 2;
    const cy = Math.floor(i / COLUMNS) * cellSize + cellSize / 2;
    if (!model.empty) drawRose(canvas, model, cx, cy, radius, FC.TRACK_COLOR);
    return {
      dutyKey,
      label: model.label,
      summary: FC.summaryLine(model),
      empty: model.empty,
    };
  });

  return { png: encodePng(SIZE, SIZE, canvas.data), cells };
}

module.exports = { renderFairnessImage, MAIN_DUTIES, GRID_LINE };
