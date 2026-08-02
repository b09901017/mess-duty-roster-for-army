/* 洗碗輪值演算法：起始梯（primary）持續指標 + 次要梯每次歸零，見 plan 中的驗證表 */
window.App = window.App || {};

(function () {
  "use strict";

  const MEAL_KEYS = window.App.State.MEAL_KEYS;

  function rotate(arr, start) {
    if (arr.length === 0) return [];
    const s = ((start % arr.length) + arr.length) % arr.length;
    return arr.slice(s).concat(arr.slice(0, s));
  }

  function washEligible(members) {
    return members.filter((m) => m.fixedRole !== "delivery");
  }

  /**
   * @param {object} washState - { primaryPointer: {261,263}, nextPrimaryCohort }
   * @param {{261: object[], 263: object[]}} pools - 已排序、已排除固定送便當的洗碗池
   * @param {number} perMealCount - 每餐需求人數
   * @param {(memberId: string, meal: string) => boolean} [isAvailable] - 那個人那一餐能不能排（採買的人早/中不能排）
   * @returns {{assignments: {breakfast:string[],lunch:string[],dinner:string[]}, newWashState: object, primaryCohort: string}}
   */
  function computeWashDay(washState, pools, perMealCount, isAvailable) {
    const available = isAvailable || (() => true);
    const primaryCohort = washState.nextPrimaryCohort;
    const secondaryCohort = primaryCohort === "261" ? "263" : "261";

    const primaryPool = washEligible(pools[primaryCohort]);
    const secondaryPool = washEligible(pools[secondaryCohort]);

    if (primaryPool.length === 0 && secondaryPool.length === 0) {
      const empty = {};
      MEAL_KEYS.forEach((meal) => (empty[meal] = []));
      return { assignments: empty, newWashState: washState, primaryCohort };
    }

    const primaryPointer = primaryPool.length
      ? ((washState.primaryPointer[primaryCohort] % primaryPool.length) + primaryPool.length) % primaryPool.length
      : 0;

    const primaryBlock = rotate(primaryPool, primaryPointer);
    const secondaryBlock = rotate(secondaryPool, 0);
    const combinedQueue = primaryBlock.concat(secondaryBlock);
    const combinedLen = combinedQueue.length;

    /*
     * 用一個「還沒排到的人」清單依序消耗，而不是用固定游標跳位。
     * 差別在於某人那一餐不能排（例如去採買）時，他只是這一餐被跳過、
     * 仍然留在清單前面等下一餐，不會平白損失一輪洗碗。
     * 清單用完就從頭再補一輪，那些人就是當天洗第二次的人。
     */
    const assignments = {};
    let remaining = combinedQueue.slice();
    const usedIds = new Set();

    MEAL_KEYS.forEach((meal) => {
      const picked = [];
      const guardLimit = combinedLen * 4 + 10;
      let guard = 0;

      while (picked.length < perMealCount && combinedLen > 0 && guard < guardLimit) {
        guard++;
        const idx = remaining.findIndex((m) => available(m.id, meal) && !picked.includes(m.id));
        if (idx === -1) {
          // 剩下的人這一餐都不能排（或都已經排過）→ 從頭再補一輪
          const hasCandidate = combinedQueue.some((m) => available(m.id, meal) && !picked.includes(m.id));
          if (!hasCandidate) break;
          remaining = remaining.concat(combinedQueue.slice());
          continue;
        }
        picked.push(remaining[idx].id);
        usedIds.add(remaining[idx].id);
        remaining.splice(idx, 1);
      }

      assignments[meal] = picked;
    });

    // 有幾個人當天被排到兩次，指標就往前推幾格，
    // 讓下次這個梯當起始梯時換下一批人重複到。
    const totalAssigned = MEAL_KEYS.reduce((sum, meal) => sum + assignments[meal].length, 0);
    const usedTwice = Math.max(0, totalAssigned - usedIds.size);
    const advance = primaryPool.length ? usedTwice % primaryPool.length : 0;
    const newPrimaryPointer = primaryPool.length
      ? (primaryPointer + advance) % primaryPool.length
      : washState.primaryPointer[primaryCohort];

    const newWashState = {
      primaryPointer: Object.assign({}, washState.primaryPointer, {
        [primaryCohort]: newPrimaryPointer,
      }),
      nextPrimaryCohort: secondaryCohort,
    };

    return { assignments, newWashState, primaryCohort };
  }

  window.App.WashSchedule = { computeWashDay, rotate, washEligible };
})();
