/*
 * 公平性總覽：每項勤務一個圓餅圖。
 *
 * 扇形大小 = 這個人佔該項勤務的比例（做越多次，扇形越大）。
 * 扇形顏色 = 相對「公平份額」的偏離程度（做太多偏橘紅、剛好是灰、做太少偏藍），
 * 因為18個人不可能用18種能分辨的顏色，把顏色改成表達「公不公平」才真的一目了然。
 * 顏色是 dataviz 的 diverging 配色，已用 validate_palette.js 驗過
 * （CVD ΔE 17.9、一般視覺 ΔE 18.1，皆通過門檻）。
 */
window.App = window.App || {};
window.App.UI = window.App.UI || {};

(function () {
  "use strict";

  const container = () => document.getElementById("tab-dashboard");
  const DUTY_KEYS = ["dishwash", "foodwaste", "lunchbag", "wipe", "floor", "cleanup", "shopping"];

  // diverging：做最少 → 剛好 → 做最多
  const BUCKETS = [
    { key: "far-under", color: "#17539b", label: "明顯偏少" },
    { key: "under", color: "#5598e7", label: "略少" },
    { key: "fair", color: "#d3cdc1", label: "接近平均" },
    { key: "over", color: "#ef7a20", label: "略多" },
    { key: "far-over", color: "#b53c12", label: "明顯偏多" },
  ];

  const SURFACE = "#ffffff";
  const RADIUS = 78;
  const CENTER = 92;
  const GAP_DEG = 1.4; // 扇形之間留 surface 色的縫，取代描邊

  function bucketFor(count, mean) {
    if (mean <= 0) return BUCKETS[2];
    const ratio = count / mean;
    if (ratio >= 1.35) return BUCKETS[4];
    if (ratio >= 1.1) return BUCKETS[3];
    if (ratio <= 0.65) return BUCKETS[0];
    if (ratio <= 0.9) return BUCKETS[1];
    return BUCKETS[2];
  }

  function polar(angleDeg, radius) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return [CENTER + radius * Math.cos(rad), CENTER + radius * Math.sin(rad)];
  }

  function arcPath(startDeg, endDeg) {
    const sweep = endDeg - startDeg;
    if (sweep <= 0) return "";
    // 整圈的情況 path 畫不出來，用兩段半圓
    if (sweep >= 359.999) {
      const [x0, y0] = polar(0, RADIUS);
      const [x1, y1] = polar(180, RADIUS);
      return `M ${x0} ${y0} A ${RADIUS} ${RADIUS} 0 1 1 ${x1} ${y1} A ${RADIUS} ${RADIUS} 0 1 1 ${x0} ${y0} Z`;
    }
    const [sx, sy] = polar(startDeg, RADIUS);
    const [ex, ey] = polar(endDeg, RADIUS);
    const largeArc = sweep > 180 ? 1 : 0;
    return `M ${CENTER} ${CENTER} L ${sx} ${sy} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${ex} ${ey} Z`;
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function dutySection(dutyKey, members, dutyCounts) {
    const rows = members
      .map((m) => ({ m, count: (dutyCounts[m.id] && dutyCounts[m.id][dutyKey]) || 0 }))
      .filter((r) => r.count > 0);

    const total = rows.reduce((s, r) => s + r.count, 0);
    const label = `${window.App.State.DUTY_ICONS[dutyKey]} ${window.App.State.DUTY_LABELS[dutyKey]}`;

    if (total === 0) {
      return `
        <section class="duty-chart-card">
          <h3>${label}</h3>
          <p class="empty-state">還沒有人做過這項勤務。</p>
        </section>`;
    }

    // 平均只看「有做過的人」以外也要算進從沒做過的人，否則平均會被高估
    const mean = total / members.length;

    // 扇形順序固定用名冊順序（不依次數排名），這樣不同勤務之間位置一致、比較好對照
    const ordered = members
      .map((m) => ({ m, count: (dutyCounts[m.id] && dutyCounts[m.id][dutyKey]) || 0 }))
      .filter((r) => r.count > 0);

    const maxCount = Math.max(...ordered.map((r) => r.count));
    const minCount = Math.min(...ordered.map((r) => r.count));

    let cursor = 0;
    const slices = ordered.map((r) => {
      const sweep = (r.count / total) * 360;
      const bucket = bucketFor(r.count, mean);
      const gap = ordered.length > 1 ? Math.min(GAP_DEG, sweep * 0.25) : 0;
      const start = cursor;
      const end = cursor + sweep;
      cursor = end;
      const pct = ((r.count / total) * 100).toFixed(1);
      return {
        path: arcPath(start + gap / 2, end - gap / 2),
        midDeg: (start + end) / 2,
        bucket,
        name: r.m.name,
        cohort: r.m.cohort,
        count: r.count,
        pct,
      };
    });

    // 18個扇形沒辦法每個都標名字（會疊在一起），改成只在圖下方點名最多與最少的人，
    // 完整數字由旁邊的表格與滑鼠提示提供。
    const topNames = ordered.filter((r) => r.count === maxCount).map((r) => r.m.name);
    const bottomNames = ordered.filter((r) => r.count === minCount).map((r) => r.m.name);
    const zeroNames = members
      .filter((m) => !((dutyCounts[m.id] && dutyCounts[m.id][dutyKey]) || 0))
      .map((m) => m.name);

    const extremeParts = [`最多 ${topNames.slice(0, 3).join("、")}${topNames.length > 3 ? "等" : ""} ${maxCount} 次`];
    if (zeroNames.length) {
      extremeParts.push(`還沒輪到 ${zeroNames.length} 人`);
    } else if (minCount !== maxCount) {
      extremeParts.push(`最少 ${bottomNames.slice(0, 3).join("、")}${bottomNames.length > 3 ? "等" : ""} ${minCount} 次`);
    }

    const tableRows = members
      .map((m) => ({ m, count: (dutyCounts[m.id] && dutyCounts[m.id][dutyKey]) || 0 }))
      .sort((a, b) => b.count - a.count || a.m.cohort.localeCompare(b.m.cohort) || a.m.seq - b.m.seq)
      .map((r) => {
        const pct = total ? ((r.count / total) * 100).toFixed(1) : "0.0";
        const bucket = bucketFor(r.count, mean);
        return `<tr>
          <td><span class="swatch" style="background:${bucket.color}"></span>${escapeHtml(r.m.name)}</td>
          <td class="num">${r.count}</td>
          <td class="num">${pct}%</td>
        </tr>`;
      })
      .join("");

    return `
      <section class="duty-chart-card">
        <h3>${label}</h3>
        <p class="chart-caption">共 ${total} 人次，平均每人 ${mean.toFixed(1)} 次</p>
        <p class="chart-extremes">${escapeHtml(extremeParts.join("　·　"))}</p>
        <div class="chart-and-table">
          <svg class="pie" viewBox="0 0 ${CENTER * 2} ${CENTER * 2}" role="img"
               aria-label="${window.App.State.DUTY_LABELS[dutyKey]}各人次數佔比">
            ${slices
              .map(
                (s) =>
                  `<path d="${s.path}" fill="${s.bucket.color}" class="slice"><title>${escapeHtml(s.name)}（${
                    s.cohort
                  }梯）${s.count} 次・${s.pct}%・${s.bucket.label}</title></path>`
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
    return `
      <div class="card">
        <h2>怎麼看這些圖</h2>
        <p class="hint">扇形越大＝這個人做這項勤務的次數越多。顏色代表跟「平均值」比起來偏多還偏少，<strong>整張圖越接近灰色就代表分配越平均</strong>。每張圖下方會點名做最多與最少的人，完整數字看旁邊的表格，滑鼠移到扇形上也會顯示。還沒輪到的人次數為 0，不會出現在圓餅圖裡，但表格中看得到。</p>
        <div class="legend-row">
          ${BUCKETS.map(
            (b) => `<span class="legend-item"><span class="swatch" style="background:${b.color}"></span>${b.label}</span>`
          ).join("")}
        </div>
      </div>`;
  }

  function render() {
    const state = window.App.State.get();
    const active = window.App.State.activeMembers().sort((a, b) => {
      if (a.cohort !== b.cohort) return a.cohort.localeCompare(b.cohort);
      return a.seq - b.seq;
    });

    if (active.length === 0) {
      container().innerHTML = `<div class="empty-state">名冊中沒有現役人員。</div>`;
      return;
    }

    container().innerHTML = `
      ${legend()}
      <div class="duty-chart-grid">
        ${DUTY_KEYS.map((duty) => dutySection(duty, active, state.dutyCounts)).join("")}
      </div>
    `;
  }

  window.App.UI.Dashboard = { render, SURFACE };
})();
