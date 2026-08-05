/*
 * 最小成本最大流（SPFA 連續最短路增廣）。
 *
 * 排勤務常常是這種形狀：一邊是人，一邊是名額，中間有一堆「這個人不能做那個」的限制，
 * 而且要在所有可行分法裡挑最公平的那一種。貪心法（排序後依序挑）會卡死——
 * 先被挑走的人可能剛好佔掉另一個人「唯一還能做的那一項」——流量演算法則保證
 * 只要存在可行分法就找得到，而且找到的是成本最低的那個。
 *
 * 撤收（人 × 三餐）與廚餘/清地板/擦桌子（人 × 三項勤務）都用這支。
 * 圖只有二十幾個節點，速度不是問題。
 */
window.App = window.App || {};

(function () {
  "use strict";

  function createNetwork(nodeCount) {
    const graph = [];
    for (let i = 0; i < nodeCount; i++) graph.push([]);
    const edges = [];

    function addEdge(from, to, capacity, cost) {
      graph[from].push(edges.length);
      edges.push({ to: to, capacity: capacity, cost: cost, flow: 0 });
      graph[to].push(edges.length);
      edges.push({ to: from, capacity: 0, cost: -cost, flow: 0 });
    }

    return { graph: graph, edges: edges, addEdge: addEdge, nodeCount: nodeCount };
  }

  /** 連續最短路增廣（成本用 SPFA 算，因為有反向邊會出現負成本） */
  function minCostMaxFlow(net, source, sink) {
    const graph = net.graph;
    const edges = net.edges;
    let totalFlow = 0;

    for (;;) {
      const dist = new Array(net.nodeCount).fill(Infinity);
      const prevEdge = new Array(net.nodeCount).fill(-1);
      const inQueue = new Array(net.nodeCount).fill(false);
      dist[source] = 0;
      const queue = [source];
      inQueue[source] = true;

      while (queue.length) {
        const u = queue.shift();
        inQueue[u] = false;
        for (let i = 0; i < graph[u].length; i++) {
          const ei = graph[u][i];
          const edge = edges[ei];
          if (edge.capacity - edge.flow <= 0) continue;
          const next = dist[u] + edge.cost;
          if (next < dist[edge.to]) {
            dist[edge.to] = next;
            prevEdge[edge.to] = ei;
            if (!inQueue[edge.to]) {
              inQueue[edge.to] = true;
              queue.push(edge.to);
            }
          }
        }
      }

      if (dist[sink] === Infinity) break;

      let push = Infinity;
      for (let v = sink; v !== source; ) {
        const ei = prevEdge[v];
        push = Math.min(push, edges[ei].capacity - edges[ei].flow);
        v = edges[ei ^ 1].to;
      }
      for (let v = sink; v !== source; ) {
        const ei = prevEdge[v];
        edges[ei].flow += push;
        edges[ei ^ 1].flow -= push;
        v = edges[ei ^ 1].to;
      }
      totalFlow += push;
    }

    return totalFlow;
  }

  window.App.MinCostFlow = { createNetwork, minCostMaxFlow };
})();
