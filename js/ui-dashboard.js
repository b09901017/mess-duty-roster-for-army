/*
 * 公平性總覽：每項勤務一個圓圖。
 *
 * 每個人固定佔一格（角度都一樣），格子往外伸得越長＝做越多次。
 * 顏色代表相對「公平份額」的偏離程度（做太多偏橘紅、剛好是灰、做太少偏藍），
 * 因為十幾個人不可能用十幾種能分辨的顏色，把顏色改成表達「公不公平」才真的一目了然。
 * 顏色是 dataviz 的 diverging 配色，已用 validate_palette.js 驗過
 * （CVD ΔE 17.9、一般視覺 ΔE 18.1，皆通過門檻）。
 *
 * 數字與角度都由 js/fairnessChart.js 算好（LINE bot 畫 PNG 用的是同一份模型），
 * 這裡只負責把模型畫成 SVG。
 */
window.App = window.App || {};
window.App.UI = window.App.UI || {};

(function () {
  "use strict";

  const container = () => document.getElementById("tab-dashboard");

  const SURFACE = "#ffffff";
  const RADIUS = 78;
  const CENTER = 92;

  function polar(angleDeg, radius) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return [CENTER + radius * Math.cos(rad), CENTER + radius * Math.sin(rad)];
  }

  function arcPath(startDeg, endDeg, radius) {
    const sweep = endDeg - startDeg;
    if (sweep <= 0 || radius <= 0) return "";
    // 整圈的情況 path 畫不出來，用兩段半圓
    if (sweep >= 359.999) {
      const [x0, y0] = polar(0, radius);
      const [x1, y1] = polar(180, radius);
      return `M ${x0} ${y0} A ${radius} ${radius} 0 1 1 ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x0} ${y0} Z`;
    }
    const [sx, sy] = polar(startDeg, radius);
    const [ex, ey] = polar(endDeg, radius);
    const largeArc = sweep > 180 ? 1 : 0;
    return `M ${CENTER} ${CENTER} L ${sx} ${sy} A ${radius} ${radius} 0 ${largeArc} 1 ${ex} ${ey} Z`;
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function dutySection(dutyKey, members, dutyCounts) {
    const FC = window.App.FairnessChart;
    const model = FC.chartModel(dutyKey, members, dutyCounts);
    const label = `${window.App.State.DUTY_ICONS[dutyKey]} ${model.label}`;

    if (model.empty) {
      return `
        <section class="duty-chart-card">
          <h3>${label}</h3>
          <p class="empty-state">還沒有人做過這項勤務。</p>
        </section>`;
    }

    const slices = model.slices.map((s) => ({
      trackPath: arcPath(s.startDeg, s.endDeg, RADIUS),
      path: arcPath(s.startDeg, s.endDeg, RADIUS * s.radiusRatio),
      color: s.bucket.color,
      title: `${s.name}（${s.cohort}梯）${s.count} 次・佔 ${s.pct.toFixed(1)}%・${s.bucket.label}`,
    }));

    const tableRows = model.slices
      .slice()
      .sort((a, b) => b.count - a.count || a.cohort.localeCompare(b.cohort) || a.name.localeCompare(b.name))
      .map(
        (s) => `<tr>
          <td><span class="swatch" style="background:${s.bucket.color}"></span>${escapeHtml(s.name)}</td>
          <td class="num">${s.count}</td>
          <td class="num">${s.pct.toFixed(1)}%</td>
        </tr>`
      )
      .join("");

    // band 是「從頭待到現在的人」該做幾次；中途報到／退伍的人按在營天數等比例縮放
    const bandText =
      model.band.lo === model.band.hi ? `待滿的人 ${model.band.lo} 次` : `待滿的人 ${model.band.lo}～${model.band.hi} 次`;

    return `
      <section class="duty-chart-card">
        <h3>${label}</h3>
        <p class="chart-caption">共 ${model.total} 人次，${model.eligibleCount} 人分，平均 ${model.mean.toFixed(
      1
    )} 次（公平範圍：${bandText}）</p>
        <p class="chart-extremes">${escapeHtml(FC.summaryLine(model))}</p>
        <div class="chart-and-table">
          <svg class="pie" viewBox="0 0 ${CENTER * 2} ${CENTER * 2}" role="img"
               aria-label="${model.label}各人次數佔比">
            ${slices.map((s) => `<path d="${s.trackPath}" class="slice-track"/>`).join("")}
            ${slices
              .map(
                (s) =>
                  `<g class="slice"><path d="${s.trackPath}" fill="transparent"/>${
                    s.path ? `<path d="${s.path}" fill="${s.color}"/>` : ""
                  }<title>${escapeHtml(s.title)}</title></g>`
              )
              .join("")}
          </svg>
          <div class="table-scroll chart-table">
            <table>
              <thead><tr><th>人員</th><th class="num">次數</th><th class="num">佔比</th></tr></thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
        </div>
      </section>`;
  }

  function legend() {
    const BUCKETS = window.App.FairnessChart.BUCKETS;
    const counted = window.App.FairnessChart.countedRange();
    return `
      <div class="card">
        <h2>怎麼看這些圖</h2>
        <p class="hint">
          📅 <strong>${counted.label}</strong>。
          只有「確定紀錄」過的日子才算，還沒排、或只是預覽的那天不會出現在圖上。
        </p>
        <p class="hint">
          <strong>每個人固定佔一格</strong>（角度都一樣，依名冊順序排），格子往外<strong>伸得越長＝做越多次</strong>；
          淺色底代表那一格目前是空的，也就是這個人還沒輪到。
          顏色是拿他的次數跟<strong>公平範圍</strong>比：勤務還沒輪完整圈時（例如擦桌子一天只有3個名額），
          每人拿 0 次或 1 次都算公平，所以都是灰色；真的超出公平範圍才會變橘色或藍色。
          公平範圍是<strong>按每個人在營幾天等比例算</strong>的——中途才報到、或提早退伍的人待得比較短，
          次數本來就會比較少，不會因此被標成偏少。
          <strong>整張圖越接近灰色、長度越整齊＝分配越平均</strong>。
          完整數字看旁邊的表格，滑鼠移到格子上也會顯示。
          固定送便當的兩位不會被排到洗碗與其他雜項勤務，那幾張圖不會把他們算進去；
          打菜、蓋便當、包便當則只算沒有打菜固定角色的人（打飯、計數、抬飲料那幾位本來就不進輪替）。
          只排掃廁所的愷宸不做任何勤務，每張圖都不算他。
        </p>
        <div class="legend-row">
          ${BUCKETS.map(
            (b) => `<span class="legend-item"><span class="swatch" style="background:${b.color}"></span>${b.label}</span>`
          ).join("")}
        </div>
      </div>`;
  }

  function render() {
    const state = window.App.State.get();
    const active = window.App.TextFormat.sortedMembers(window.App.State.activeMembers());

    if (active.length === 0) {
      container().innerHTML = `<div class="empty-state">名冊中沒有現役人員。</div>`;
      return;
    }

    container().innerHTML = `
      ${legend()}
      <div class="duty-chart-grid">
        ${window.App.FairnessChart.chartedDutyKeys()
          .map((duty) => dutySection(duty, active, state.dutyCounts))
          .join("")}
      </div>
    `;
  }

  window.App.UI.Dashboard = { render, SURFACE };
})();
