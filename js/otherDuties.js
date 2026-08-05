/*
 * 廚餘 / 清地板收垃圾 / 擦桌子 的公平分配。
 *
 * 三項是「一起」分的，不是一項一項分完再分下一項。
 *
 * 為什麼：那一餐扣掉洗碗與送便當之後剩下的人數，剛好等於三項名額的總和
 * （對照表就是這樣定的，例如 21 人分成 廚7 清4 擦3）。一項一項分的話，
 * 前面兩項把「該項做最少的人」挑走，輪到最後一項時剩下幾個人就剛好幾個名額，
 * **完全沒有挑的餘地**——那一項等於沒有在管公平。實測 9 天下來，排在最後的擦桌子
 * 會出現有人 4 次、有人 2 次（公平範圍是 2~3），而前兩項都只差 1 次。
 *
 * 所以改成一次把「人 × 三項」丟進最小成本最大流：每個人最多拿一項，每一項剛好要
 * 幾個人，成本是「這個人這一項已經做過幾次」。求總成本最低 ⇒ 在所有可行分法裡，
 * 挑「大家各項次數最平均」的那一種。同分時照名冊順序，結果才是決定性的。
 */
window.App = window.App || {};

(function () {
  "use strict";

  const DUTY_ORDER = ["foodwaste", "floor", "wipe"];

  const stableCompare = (a, b) => window.App.State.rosterOrder(a, b);

  /**
   * @param {object[]} pool - 該餐可用人員（已排除當餐洗碗、固定送便當）
   * @param {object} dutyCounts - { [memberId]: { foodwaste, wipe, floor, ... } }
   * @param {{foodwaste:number, wipe:number, floor:number}} sizeConfig
   * @returns {{foodwaste:string[], floor:string[], wipe:string[]}}
   */
  function assignOtherDuties(pool, dutyCounts, sizeConfig) {
    const result = {};
    DUTY_ORDER.forEach((k) => (result[k] = []));

    const people = pool.slice().sort(stableCompare);
    const needs = DUTY_ORDER.map((k) => sizeConfig[k] || 0);
    if (!people.length || !needs.some((n) => n > 0)) return result;

    /*
     * 節點：0 = 源點，1..n = 人，n+1..n+3 = 三項勤務，n+4 = 匯點。
     * 成本放在「人 → 勤務」這條邊上：已經做過幾次就多貴。乘 1000 再加名冊順序，
     * 是為了讓次數永遠壓過順序，同時同分時固定挑號碼小的（結果才可重播）。
     */
    const n = people.length;
    const SOURCE = 0;
    const DUTY0 = n + 1;
    const SINK = n + DUTY_ORDER.length + 1;
    const net = window.App.MinCostFlow.createNetwork(SINK + 1);

    people.forEach((m, i) => {
      net.addEdge(SOURCE, i + 1, 1, 0);
      DUTY_ORDER.forEach((dutyKey, j) => {
        if (!needs[j]) return;
        const done = (dutyCounts[m.id] && dutyCounts[m.id][dutyKey]) || 0;
        net.addEdge(i + 1, DUTY0 + j, 1, done * 1000 + i);
      });
    });
    DUTY_ORDER.forEach((dutyKey, j) => {
      if (needs[j]) net.addEdge(DUTY0 + j, SINK, needs[j], 0);
    });

    window.App.MinCostFlow.minCostMaxFlow(net, SOURCE, SINK);

    // 把有流量的「人 → 勤務」邊讀回來
    people.forEach((m, i) => {
      net.graph[i + 1].forEach((ei) => {
        const edge = net.edges[ei];
        if (edge.flow <= 0) return;
        const j = edge.to - DUTY0;
        if (j < 0 || j >= DUTY_ORDER.length) return;
        result[DUTY_ORDER[j]].push(m.id);
      });
    });

    // 名單照名冊順序輸出，看起來才整齊（people 已排序，所以直接照加入順序就是）
    return result;
  }

  window.App.OtherDuties = { assignOtherDuties, stableCompare, DUTY_ORDER };
})();
