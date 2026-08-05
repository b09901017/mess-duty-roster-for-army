/*
 * 公平性圓圖的「資料模型」——只算數字與角度，不畫圖。
 *
 * 網頁上用它畫 SVG，LINE bot 用它畫 PNG，兩邊的圖形才會一模一樣。
 *
 * 每個人固定佔一格（角度都一樣），格子的半徑代表次數（面積正比於次數）。
 * 用等角度而不是「照比例切派」，是因為次數 0 的人在比例派裡角度是 0、
 * 根本畫不出來，這樣還沒輪到的人也看得見自己那一格。
 */
window.App = window.App || {};

(function () {
  "use strict";

  // diverging：做最少 → 剛好 → 做最多。已用 CVD 模擬驗過相鄰色差。
  const BUCKETS = [
    { key: "far-under", color: "#17539b", label: "明顯偏少" },
    { key: "under", color: "#5598e7", label: "略少" },
    { key: "fair", color: "#d3cdc1", label: "接近平均" },
    { key: "over", color: "#ef7a20", label: "略多" },
    { key: "far-over", color: "#b53c12", label: "明顯偏多" },
  ];

  const TRACK_COLOR = "#f5efe6"; // 空格子的底色
  const GAP_DEG = 1.4; // 扇形之間留的縫，取代描邊

  /*
   * 採買是固定的星期輪值，不是靠公平演算法分的，畫成公平圖沒有意義。
   * cleanupBreakfast/Lunch/Dinner 是排撤收時內部用來平衡餐別的計數，不用單獨畫圖。
   */
  const HIDDEN_FROM_CHARTS = ["shopping", "cleanupBreakfast", "cleanupLunch", "cleanupDinner"];

  function chartedDutyKeys() {
    return window.App.State.DUTY_KEYS.filter((k) => HIDDEN_FROM_CHARTS.indexOf(k) === -1);
  }

  /**
   * 誰「應該」被排到這項勤務。固定送便當的兩位不會被排到洗碗、雜項勤務與撤收，
   * 所以算公平的時候不能把他們算進去，否則他們的 0 次會被誤判成「做太少」。
   * 洗衣籃與撤收是全員一起輪（含送便當的兩位）。
   * 打菜、蓋便當、包餐盒只在「沒有打菜固定角色」的人之間輪。
   */
  function eligibleFor(dutyKey, members) {
    if (dutyKey === "delivery") return members.filter((m) => m.fixedRole === "delivery");
    if (dutyKey === "laundry") return members.filter((m) => !m.skipLaundry);
    // 換水跟洗衣籃一樣是全員輪（含送便當的兩位），只有名冊勾「免排換水」的招員不算
    if (dutyKey === "water") return members.filter((m) => !m.skipWater);
    // 撤收現在全員都排（送便當的兩位只排得到晚上，但還是有排）
    if (dutyKey === "cleanup") return members.slice();
    if (["serveDish", "lid", "boxing"].indexOf(dutyKey) !== -1) return members.filter((m) => !m.servingRole);
    return members.filter((m) => m.fixedRole !== "delivery");
  }

  /**
   * 公平區間：總共 total 人次要分給 n 個人時，最公平的分法是每人拿 floor 或 ceil。
   * 用整數區間而不是「跟平均值的比例」，是因為勤務還沒輪完一圈時（例如擦桌子一天
   * 只有3個名額），平均值會小於1，任何做過一次的人都會被誤判成「偏多」。
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

  /**
   * 算出一項勤務的圓圖模型。沒有人做過就回傳 null。
   *
   * slices 的角度以 12 點鐘方向為 0 度、順時針遞增；radiusRatio 是 0～1 的比例，
   * 實際半徑由畫圖的人自己乘上去。
   */
  function chartModel(dutyKey, members, dutyCounts) {
    const St = window.App.State;
    const countOf = (m) => (dutyCounts[m.id] && dutyCounts[m.id][dutyKey]) || 0;
    const eligible = eligibleFor(dutyKey, members);
    const total = eligible.reduce((sum, m) => sum + countOf(m), 0);
    const label = St.DUTY_LABELS[dutyKey];

    if (!eligible.length || total === 0) {
      return { dutyKey, label, total: 0, eligibleCount: eligible.length, slices: [], empty: true };
    }

    const band = fairBand(total, eligible.length);
    const rows = eligible.map((m) => ({ m, count: countOf(m) }));
    const maxCount = Math.max.apply(null, rows.map((r) => r.count));
    const sweep = 360 / rows.length;
    const gap = rows.length > 1 ? Math.min(GAP_DEG, sweep * 0.18) : 0;

    const slices = rows.map((r, i) => ({
      id: r.m.id,
      name: r.m.name,
      cohort: r.m.cohort,
      count: r.count,
      pct: total ? (r.count / total) * 100 : 0,
      startDeg: i * sweep + gap / 2,
      endDeg: (i + 1) * sweep - gap / 2,
      // 面積正比於次數 → 半徑取平方根
      radiusRatio: maxCount > 0 ? Math.sqrt(r.count / maxCount) : 0,
      bucket: bucketFor(r.count, band),
    }));

    const topNames = rows.filter((r) => r.count === maxCount).map((r) => r.m.name);
    const overNames = rows.filter((r) => r.count > band.hi).map((r) => r.m.name);
    const underNames = rows.filter((r) => r.count < band.lo).map((r) => r.m.name);

    return {
      dutyKey,
      label,
      total,
      eligibleCount: eligible.length,
      mean: total / eligible.length,
      maxCount,
      band,
      slices,
      topNames,
      overNames,
      underNames,
      zeroCount: rows.filter((r) => r.count === 0).length,
      empty: false,
    };
  }

  /**
   * 這些圖到底算了哪幾天。
   *
   * 卡片以前寫「累計到 8/7」，用的是「你問的那一天」，很容易誤會成
   * 「8/7 的勤務已經算進去了」——但 8/7 可能根本還沒排，而 8/6 排了就已經有數字。
   * 這裡直接照真正被計入的日子回答：已確定紀錄、而且不早於 COUNTS_FROM 的那些天。
   */
  function countedRange() {
    const St = window.App.State;
    const dates = (St.get().committedDates || []).filter((d) => d >= St.COUNTS_FROM).sort();
    if (!dates.length) {
      return { dates: [], from: null, to: null, label: `${St.COUNTS_FROM} 起算，目前還沒有任何一天排進去` };
    }
    const short = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
    const span = dates.length === 1 ? short(dates[0]) : `${short(dates[0])}～${short(dates[dates.length - 1])}`;
    return { dates, from: dates[0], to: dates[dates.length - 1], label: `已算進 ${span} 共 ${dates.length} 天` };
  }

  /** 一句話講完這項勤務目前公不公平 */
  function summaryLine(model) {
    if (!model || model.empty) return "還沒有人做過這項勤務。";
    const parts = [
      `最多 ${model.topNames.slice(0, 2).join("、")}${model.topNames.length > 2 ? "等" : ""} ${model.maxCount} 次`,
    ];
    if (model.zeroCount) parts.push(`還沒輪到 ${model.zeroCount} 人`);
    if (model.overNames.length || model.underNames.length) {
      const bits = [];
      if (model.overNames.length) bits.push(`偏多 ${model.overNames.length} 人`);
      if (model.underNames.length) bits.push(`偏少 ${model.underNames.length} 人`);
      parts.push(bits.join("、"));
    } else {
      parts.push("分配平均");
    }
    return parts.join("　·　");
  }

  window.App.FairnessChart = {
    BUCKETS,
    TRACK_COLOR,
    GAP_DEG,
    HIDDEN_FROM_CHARTS,
    chartedDutyKeys,
    eligibleFor,
    fairBand,
    bucketFor,
    chartModel,
    countedRange,
    summaryLine,
  };
})();
