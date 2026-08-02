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
  // 採買是固定的星期輪值，不是靠公平演算法分的，畫成公平圖沒有意義，次數在「採買」分頁看
  const DUTY_KEYS = window.App.State.DUTY_KEYS.filter((k) => k !== "shopping");

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

  /**
   * 誰「應該」被排到這項勤務。固定送便當的兩位不會被排到洗碗、雜項勤務與撤收，
   * 所以算公平的時候不能把他們算進去，否則他們的 0 次會被誤判成「做太少」。
   * 洗衣籃是全員一起輪（含送便當的兩位）。
   */
  function eligibleFor(dutyKey, members) {
    if (dutyKey === "delivery") return members.filter((m) => m.fixedRole === "delivery");
    if (dutyKey === "laundry") return members;
    return members.filter((m) => m.fixedRole !== "delivery");
  }

  /**
   * 公平區間：總共 total 人次要分給 n 個人時，最公平的分法是每人拿 floor 或 ceil，
   * 落在這個區間內就算公平。用整數區間而不是「跟平均值的比例」，是因為勤務還沒輪完
   * 一圈時（例如擦桌子一天只有3個名額），平均值會小於1，任何做過一次的人都會被
   * 誤判成「偏多」。
   */
  function fairBand(total, n) {
    if (n <= 0) return { lo: 0, hi: 0 };
    return { lo: Math.floor(total / n), hi: Math.ceil(total / n) };
  }

  function bucketFor(count, band) {
    if (count > band.hi) return count >= band.hi + 2 ? BUCKETS[4] : BUCKETS[3];
    if (count < band.lo) return count <= band.lo - 2 ? BUCKETS[0] : BUCKETS[1];
    return BUCKETS[2];
  }

  function polar(angleDeg, radius) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return [CENTER + radius * Math.cos(rad), CENTER + radius * Math.sin(rad)];
  }

  function arcPath(startDeg, endDeg, radius) {
    const r = radius == null ? RADIUS : radius;
    const sweep = endDeg - startDeg;
    if (sweep <= 0 || r <= 0) return "";
    // 整圈的情況 path 畫不出來，用兩段半圓
    if (sweep >= 359.999) {
      const [x0, y0] = polar(0, r);
      const [x1, y1] = polar(180, r);
      return `M ${x0} ${y0} A ${r} ${r} 0 1 1 ${x1} ${y1} A ${r} ${r} 0 1 1 ${x0} ${y0} Z`;
    }
    const [sx, sy] = polar(startDeg, r);
    const [ex, ey] = polar(endDeg, r);
    const largeArc = sweep > 180 ? 1 : 0;
    return `M ${CENTER} ${CENTER} L ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey} Z`;
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function dutySection(dutyKey, members, dutyCounts) {
    const countOf = (m) => (dutyCounts[m.id] && dutyCounts[m.id][dutyKey]) || 0;
    const eligible = eligibleFor(dutyKey, members);
    const total = eligible.reduce((s, m) => s + countOf(m), 0);
    const label = `${window.App.State.DUTY_ICONS[dutyKey]} ${window.App.State.DUTY_LABELS[dutyKey]}`;

    if (total === 0) {
      return `
        <section class="duty-chart-card">
          <h3>${label}</h3>
          <p class="empty-state">還沒有人做過這項勤務。</p>
        </section>`;
    }

    const band = fairBand(total, eligible.length);
    const mean = total / eligible.length;

    // 每個人固定一格（角度都一樣），格子的半徑代表次數，面積正比於次數。
    // 用等角度而不是「照比例切派」，是因為次數 0 的人在比例派裡角度是 0、根本畫不出來，
    // 這樣還沒輪到的人也看得見自己那一格。順序固定用名冊順序，不同勤務之間才好對照。
    const rows = eligible.map((m) => ({ m, count: countOf(m) }));
    const maxCount = Math.max(...rows.map((r) => r.count));
    const sweep = 360 / rows.length;
    const gap = rows.length > 1 ? Math.min(GAP_DEG, sweep * 0.18) : 0;

    const slices = rows.map((r, i) => {
      const start = i * sweep;
      const end = start + sweep;
      // 面積正比於次數 → 半徑取平方根
      const radius = maxCount > 0 ? RADIUS * Math.sqrt(r.count / maxCount) : 0;
      const pct = total ? ((r.count / total) * 100).toFixed(1) : "0.0";
      return {
        trackPath: arcPath(start + gap / 2, end - gap / 2, RADIUS),
        path: arcPath(start + gap / 2, end - gap / 2, radius),
        bucket: bucketFor(r.count, band),
        name: r.m.name,
        cohort: r.m.cohort,
        count: r.count,
        pct,
      };
    });

    const topNames = rows.filter((r) => r.count === maxCount).map((r) => r.m.name);
    const zeroCount = eligible.filter((m) => countOf(m) === 0).length;
    const overNames = eligible.filter((m) => countOf(m) > band.hi).map((m) => m.name);
    const underNames = eligible.filter((m) => countOf(m) < band.lo).map((m) => m.name);

    const extremeParts = [`最多 ${topNames.slice(0, 3).join("、")}${topNames.length > 3 ? "等" : ""} ${maxCount} 次`];
    if (zeroCount) extremeParts.push(`還沒輪到 ${zeroCount} 人`);
    if (overNames.length || underNames.length) {
      const bits = [];
      if (overNames.length) bits.push(`偏多 ${overNames.length} 人`);
      if (underNames.length) bits.push(`偏少 ${underNames.length} 人`);
      extremeParts.push(bits.join("、"));
    } else {
      extremeParts.push("目前分配平均 ✅");
    }

    const tableRows = eligible
      .map((m) => ({ m, count: countOf(m) }))
      .sort((a, b) => b.count - a.count || a.m.cohort.localeCompare(b.m.cohort) || a.m.seq - b.m.seq)
      .map((r) => {
        const pct = total ? ((r.count / total) * 100).toFixed(1) : "0.0";
        const bucket = bucketFor(r.count, band);
        return `<tr>
          <td><span class="swatch" style="background:${bucket.color}"></span>${escapeHtml(r.m.name)}</td>
          <td class="num">${r.count}</td>
          <td class="num">${pct}%</td>
        </tr>`;
      })
      .join("");

    const bandText = band.lo === band.hi ? `每人 ${band.lo} 次` : `每人 ${band.lo}～${band.hi} 次`;

    return `
      <section class="duty-chart-card">
        <h3>${label}</h3>
        <p class="chart-caption">共 ${total} 人次，${eligible.length} 人分，平均 ${mean.toFixed(
          1
        )} 次（公平範圍：${bandText}）</p>
        <p class="chart-extremes">${escapeHtml(extremeParts.join("　·　"))}</p>
        <div class="chart-and-table">
          <svg class="pie" viewBox="0 0 ${CENTER * 2} ${CENTER * 2}" role="img"
               aria-label="${window.App.State.DUTY_LABELS[dutyKey]}各人次數佔比">
            ${slices.map((s) => `<path d="${s.trackPath}" class="slice-track"/>`).join("")}
            ${slices
              .map(
                (s) =>
                  `<g class="slice"><path d="${s.trackPath}" fill="transparent"/>${
                    s.path ? `<path d="${s.path}" fill="${s.bucket.color}"/>` : ""
                  }<title>${escapeHtml(s.name)}（${s.cohort}梯）${s.count} 次・佔 ${s.pct}%・${
                    s.bucket.label
                  }</title></g>`
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
        <p class="hint">
          <strong>每個人固定佔一格</strong>（角度都一樣，依名冊順序排），格子往外<strong>伸得越長＝做越多次</strong>；
          淺色底代表那一格目前是空的，也就是這個人還沒輪到。
          顏色是拿他的次數跟<strong>公平範圍</strong>比：勤務還沒輪完整圈時（例如擦桌子一天只有3個名額），
          每人拿 0 次或 1 次都算公平，所以都是灰色；真的超出公平範圍才會變橘色或藍色。
          <strong>整張圖越接近灰色、長度越整齊＝分配越平均</strong>。
          完整數字看旁邊的表格，滑鼠移到格子上也會顯示。
          固定送便當的兩位不會被排到洗碗與其他雜項勤務，那幾張圖不會把他們算進去。
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
