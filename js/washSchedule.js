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
   * @returns {{assignments: {breakfast:string[],lunch:string[],dinner:string[]}, newWashState: object, primaryCohort: string}}
   */
  function computeWashDay(washState, pools, perMealCount) {
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

    const assignments = {};
    let cursor = 0;
    MEAL_KEYS.forEach((meal) => {
      const ids = [];
      for (let i = 0; i < perMealCount; i++) {
        if (combinedLen === 0) break;
        ids.push(combinedQueue[(cursor + i) % combinedLen].id);
      }
      assignments[meal] = ids;
      cursor += perMealCount;
    });

    const totalNeeded = perMealCount * MEAL_KEYS.length;
    const overflow = Math.max(0, totalNeeded - combinedLen);
    const advance = primaryPool.length ? overflow % primaryPool.length : 0;
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
