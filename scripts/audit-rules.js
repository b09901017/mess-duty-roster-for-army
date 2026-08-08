#!/usr/bin/env node
/*
 * 把所有排班規則當成斷言，對 8/1～8/14 全部跑一遍。
 * 規則有任何改動都應該先跑這個，確認沒有踩到別條規則。
 *
 *   node scripts/dev-server.js 8123 &   （或任何靜態伺服器）
 *   BASE=http://127.0.0.1:8123 node scripts/audit-rules.js
 */
/* playwright 可能是全域安裝的，兩個位置都試 */
function loadChromium() {
  const candidates = ['playwright', 'playwright-core', '/opt/node22/lib/node_modules/playwright'];
  for (const name of candidates) {
    try { return require(name).chromium; } catch (err) { /* 換下一個 */ }
  }
  console.error('找不到 playwright，請先 npm i -D playwright 或用全域安裝的版本。');
  process.exit(1);
}
const chromium = loadChromium();

(async () => {
  const b = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
  );
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept(''));
  await page.goto((process.env.BASE || 'http://127.0.0.1:8123') + '/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  /*
   * 稽核要跑在「有採買、有掃廁所」的情境下。
   * 預設資料兩者都是空的，那些斷言等於從來沒被執行過——採買的人有沒有真的被抽掉、
   * 掃廁所有沒有跟採買撞在一起，都要有人排下去才驗得到。
   */
  await page.evaluate(() => {
    const S = window.App.State.get();
    S.shoppingByDate = { '2026-08-09': ['261-3', '261-5'], '2026-08-11': ['263-4'] };
    for (let i = 1; i <= 14; i++) window.App.ScheduleEngine.commitDay('2026-08-' + String(i).padStart(2, '0'));
  });

  const report = await page.evaluate(() => {
    const S = window.App.State.get();
    const St = window.App.State;
    const DV = window.App.DutyView;
    const St2 = window.App;
    const fails = [];
    const notes = [];
    const locked = [];
    const fail = (d, msg) => fails.push(`${d}  ${msg}`);
    const set = a => new Set(a);
    const eq = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
    const nm = id => (St.memberById(id) || {}).name || id;
    const names = ids => ids.map(nm).join('、') || '(空)';

    const dates = Object.keys(S.schedules).sort();

    dates.forEach(d => {
      const sc = S.schedules[d];
      /*
       * 被「鎖定」的日子照公布過的版本走，本來就不該套用自動排班的規則
       * （那天的規則可能跟現在不一樣），所以規則檢查跳過，只在下面另外對次數。
       */
      if ((S.overrides || {})[d]) { locked.push(d); return; }
      // 只排掃廁所的人（愷宸）不算進出勤人數，班表任何欄位都不該出現他
      const active = St.activeMembersOn(d).filter(x => !x.dutyExempt);
      const exempt = St.activeMembersOn(d).filter(x => x.dutyExempt);
      const activeIds = set(active.map(m => m.id));
      const activeAt = (id, meal) => { const mm = St.memberById(id); return mm && St.isActiveOn(mm, d, meal); };
      const delivery = active.filter(m => m.fixedRole === 'delivery').map(m => m.id);
      const shoppers = (sc.daily.shopping || []).slice();
      const isShopper = id => shoppers.indexOf(id) !== -1;

      // 採買是逐日指定的名單，班表上的人必須跟設定的一致，而且那天要在營
      const wanted = (S.shoppingByDate[d] || []).filter(id => {
        const mm = St.memberById(id);
        return mm && St.isActiveOn(mm, d, 'breakfast');
      });
      if (!eq(set(shoppers), set(wanted))) {
        fail(d, `採買名單不符：設定 ${names(wanted)}，班表 ${names(shoppers)}`);
      }

      const MEALS = St.mealsOn(d);
      /*
       * ── 三餐勤務的規則（2026/08/08 起停用）──────────────────────
       * 洗碗、廚餘、擦桌子、清地板、送便當、打菜、抬便當都改由班長現場律定，
       * 程式不排，這些斷言自然沒有對象。整段留著，旗標打開就會一起跑。
       */
      if (St.MEAL_DUTIES_ENABLED) {
        MEALS.forEach(meal => {
          const m = sc.meals[meal];
          const isOff = meal === 'breakfast' || meal === 'lunch';
          const absent = isOff ? shoppers.slice() : [];
          const present = [...activeIds].filter(id => !absent.includes(id) && activeAt(id, meal));

          // 對照表是按「扣掉送便當之後的人數」查的，四項加起來要剛好等於那個數
          const deliveryHere = delivery.filter(id => activeAt(id, meal));
          const splitCount = present.length - deliveryHere.length;
          const cfg = St2.DutySizeConfig.lookupDutySize(S.dutySizeTable, splitCount);
          if (cfg) {
            const got = (m.dishwash||[]).length + (m.foodwaste||[]).length + (m.wipe||[]).length + (m.floor||[]).length;
            if (got !== splitCount) fail(d, `${meal} 扣掉送便當後有 ${splitCount} 人，但四項勤務只排掉 ${got} 人`);
          } else {
            fail(d, `${meal} 扣掉送便當後 ${splitCount} 人，對照表沒有這一列`);
          }

          // 每個人在同一餐不能同時做兩個主要勤務
          const primary = ['dishwash', 'foodwaste', 'wipe', 'floor', 'delivery'];
          const seen = {};
          primary.forEach(k => (m[k] || []).forEach(id => {
            if (seen[id]) fail(d, `${meal} ${nm(id)} 同時被排到 ${seen[id]} 與 ${k}`);
            seen[id] = k;
          }));

          // 不在的人不能出現在任何欄位
          ['dishwash','foodwaste','wipe','floor','delivery','carryVehicle','carryUpstairs','cleanup']
            .forEach(k => (m[k] || []).forEach(id => {
              if (absent.includes(id)) fail(d, `${meal} ${nm(id)} 去採買了卻被排到 ${k}`);
              if (!activeAt(id, meal)) fail(d, `${meal} ${nm(id)} 這一餐不在營卻被排到 ${k}`);
            }));

          // 洗碗不能有送便當的人
          (m.dishwash || []).forEach(id => { if (delivery.includes(id)) fail(d, `${meal} 送便當的 ${nm(id)} 被排到洗碗`); });

          /*
           * ── 固定勤務（招員：早晚洗碗＋中午廚餘）──
           * 指定了哪幾餐就那幾餐一定要在名單裡；沒指定的那幾餐不能出現在那一項的輪替裡。
           */
          present.forEach(id => {
            const mem = St.memberById(id);
            [['fixedDishwashMeals', 'dishwash', '洗碗'], ['fixedFoodwasteMeals', 'foodwaste', '廚餘']]
              .forEach(([key, field, label]) => {
                const fixedMeals = Array.isArray(mem[key]) ? mem[key] : [];
                if (!fixedMeals.length) return;
                const listed = (m[field] || []).includes(id);
                if (fixedMeals.includes(meal) && !listed) {
                  fail(d, `${meal} ${nm(id)} 固定${label}卻沒被排到`);
                }
                if (!fixedMeals.includes(meal) && listed) {
                  fail(d, `${meal} ${nm(id)} 這一餐不是他固定${label}的餐別，卻被排到${label}`);
                }
              });
            /*
             * 有固定洗碗餐別的人整天不進洗碗輪替，也不做擦桌子／清地板——
             * 早晚在洗碗、中午在廚餘，本來就沒有空檔。
             */
            if ((St.fixedDishwashMealsOf(mem) || []).length) {
              ['wipe', 'floor'].forEach(k => {
                if ((m[k] || []).includes(id)) fail(d, `${meal} 有固定洗碗餐別的 ${nm(id)} 被排到 ${k}`);
              });
            }
          });

          // 送便當欄位 = 那一餐還在營的固定送便當的人
          const deliveryThisMeal = delivery.filter(id => activeAt(id, meal));
          if (!eq(set(m.delivery || []), set(deliveryThisMeal))) fail(d, `${meal} 送便當名單不符`);

          /*
           * ── 抬便當（8/7 訂正後的流程）──
           * 抬下車、抬上車：隨時到隨時搬，當餐在場的人全部一起（含送便當的兩位）
           * 抬上樓：集合之後分出來的那一批 ＝ 在場 − 送便當 − 倒廚餘
           */
          if (!eq(set(m.carryDown || []), set(present))) fail(d, `${meal} 抬下車應該是全員`);
          if (!eq(set(m.carryVehicle || []), set(present))) fail(d, `${meal} 抬上車應該是全員`);
          const upExpect = set(present.filter(id =>
            !deliveryHere.includes(id) && !(m.foodwaste || []).includes(id)));
          if (!eq(set(m.carryUpstairs || []), upExpect)) {
            fail(d, `${meal} 抬上樓應該是「在場 − 送便當 − 倒廚餘」`);
          }
          // 倒廚餘的人不能同時被排到抬上樓——那兩批是同時進行的
          (m.foodwaste || []).forEach(id => {
            if ((m.carryUpstairs || []).includes(id)) fail(d, `${meal} ${nm(id)} 同時被排到倒廚餘與抬上樓`);
          });
          // 倒廚餘 ＋ 抬上樓 要把「在場扣掉送便當」的人剛好分完，不能有人兩邊都不在
          const splitBoth = new Set([...(m.foodwaste || []), ...(m.carryUpstairs || [])]);
          const shouldSplit = set(present.filter(id => !deliveryHere.includes(id)));
          if (!eq(splitBoth, shouldSplit)) fail(d, `${meal} 倒廚餘＋抬上樓沒有把在場的人分完`);

          // ── 打菜流程 ──
          const sv = m.serving || {};
          const svAll = ['rice','serveDish','lid','count','drinks','boxing'].flatMap(k => sv[k] || []);
          // 每個在場的人剛好被排到一項，不多不少
          const svDup = svAll.filter((x,i) => svAll.indexOf(x) !== i);
          if (svDup.length) fail(d, `${meal} 打菜流程重複排到：${names([...new Set(svDup)])}`);
          const svMissing = present.filter(id => !svAll.includes(id));
          if (svMissing.length) fail(d, `${meal} 打菜流程沒排到：${names(svMissing)}`);
          svAll.forEach(id => {
            if (!present.includes(id)) fail(d, `${meal} 打菜流程排到不在場的 ${nm(id)}`);
          });

          const withRice = St.servesRiceAt(meal);
          const holdersOf = role => present
            .filter(id => (St.memberById(id) || {}).servingRole === role)
            .sort((a, b) => ((St.memberById(a).servingRank || 1) - (St.memberById(b).servingRank || 1))
              || St.rosterOrder(St.memberById(a), St.memberById(b)));

          /*
           * 固定角色的名額會隨人數縮（抬飲料 2→1），縮的時候一定是留 rank 小的那位，
           * 沒被留下的併進打菜的輪替池。所以檢查的是「選到的是不是前 n 位」。
           */
          ['rice','count','drinks'].forEach(role => {
            const holders = holdersOf(role);
            const got = (sv[role] || []);
            if (role === 'rice' && !withRice) {
              if (got.length) fail(d, `${meal} 早餐不打飯，打飯那一行應該是空的`);
              holders.forEach(id => {
                if (!(sv.boxing || []).includes(id)) fail(d, `${meal} 不打飯，${nm(id)} 應改成包便當`);
              });
              return;
            }
            got.forEach(id => {
              if ((St.memberById(id) || {}).servingRole !== role) fail(d, `${meal} ${nm(id)} 名冊不是 ${role}`);
            });
            const expect = holders.slice(0, got.length);
            if (!eq(set(got), set(expect))) {
              fail(d, `${meal} ${role} 只留 ${got.length} 位時應該留 ${names(expect)}，實際 ${names(got)}`);
            }
            // 沒被留下的要落在打菜的輪替裡，不能整個不見
            holders.slice(got.length).forEach(id => {
              if (!(sv.serveDish || []).includes(id) && !(sv.boxing || []).includes(id) && !(sv.lid || []).includes(id)) {
                fail(d, `${meal} ${nm(id)} 沒被排到 ${role}，也沒有併進打菜／蓋便當／包便當`);
              }
            });
          });

          // 打菜是硬性需求：2×菜數。湊不齊的時候班表會跳提醒，那時才允許少
          const dishes = m.dishes;
          const shortWarn = (sc.warnings || []).some(w => w.indexOf('道菜只會有 1 個人') !== -1);
          if (!shortWarn && (sv.serveDish || []).length !== dishes * 2) {
            fail(d, `${meal} ${dishes} 道菜，打菜應 ${dishes * 2} 人，實際 ${(sv.serveDish || []).length} 人`);
          }
          // 蓋便當只有三種狀態：正常 2 位、由計數的兩位兼（這一行空著）、人力不足取消
          const lidLen = (sv.lid || []).length;
          if (m.countMergedIntoLid) {
            if (lidLen) fail(d, `${meal} 計數的兩位兼蓋便當時，蓋便當不該另外列人`);
          } else if (lidLen !== 0 && lidLen !== 2) {
            fail(d, `${meal} 蓋便當應該是 2 位或 0 位，實際 ${lidLen} 位`);
          }
          // 輪替的三項不能排到「這一餐真的在擔任固定角色」的人
          ['serveDish','lid'].forEach(role => {
            (sv[role] || []).forEach(id => {
              const onFixed = ['rice','count','drinks'].some(r => (sv[r] || []).includes(id));
              if (onFixed) fail(d, `${meal} ${nm(id)} 已經有固定角色卻又被排到 ${role}`);
            });
          });

          // 送便當的兩位只能排晚餐撤收（早、中在外面跑便當）；那一餐洗碗的人也不能排
          if (meal !== 'dinner') {
            (m.cleanup || []).forEach(id => {
              if (delivery.includes(id)) fail(d, `${meal} 送便當的 ${nm(id)} 被排到早/中撤收`);
            });
          }
          (m.cleanup || []).forEach(id => {
            if ((m.dishwash || []).includes(id)) fail(d, `${meal} ${nm(id)} 同一餐既洗碗又撤收`);
          });
        });
      }
      // 撤收：每餐固定 早5／中7／晚7，同一天不會有人被排兩次
      // 只排掃廁所的人不能出現在任何一餐
      exempt.forEach(x => MEALS.forEach(meal => {
        const mm = sc.meals[meal] || {};
        const inAny = ['dishwash','foodwaste','wipe','floor','delivery','cleanup','carryDown','carryVehicle','carryUpstairs']
          .some(k => (mm[k] || []).includes(x.id))
          || Object.keys(mm.serving || {}).some(r => (mm.serving[r] || []).includes(x.id));
        if (inAny) fail(d, `${nm(x.id)} 只排掃廁所，卻出現在 ${meal} 的班表裡`);
      }));
      /*
       * 全日勤務也要擋。掃廁所是他唯一該做的事，換水、洗衣籃、採買都不行。
       * （之前只檢查三餐，洗衣籃拿的是整份名冊、沒有經過「不算人頭」那道濾網，
       *   結果他真的被排到抬洗衣籃，稽核卻抓不到。）
       */
      exempt.forEach(x => {
        ['water', 'laundryUp', 'laundryDown', 'shopping'].forEach(k => {
          if ((sc.daily[k] || []).includes(x.id)) fail(d, `${nm(x.id)} 只排掃廁所，卻被排到 ${k}`);
        });
      });

      const cleanupAll = MEALS.flatMap(meal => sc.meals[meal].cleanup || []);
      const dup = cleanupAll.filter((x, i) => cleanupAll.indexOf(x) !== i);
      if (dup.length) fail(d, `撤收同一天重複排到：${names([...new Set(dup)])}`);

      if (St.MEAL_DUTIES_ENABLED) {
        /*
         * 撤收改成「固定名額、做最少的先輪」，不再要求每個人每天都輪到一次。
         * 所以檢查的是名額有沒有坐滿，以及有沒有排到不該排的人。
         */
        /*
         * 招員早、晚在洗碗（洗碗的人那一餐不排撤收），但中午做的是廚餘，
         * 廚餘沒有免撤收這條，所以他們中午照樣要排撤收——不能整組扣掉。
         * 只有「三餐都固定洗碗」的人整天排不到撤收，人數階梯才要把他們扣掉。
         * 而且引擎會先問「今天最多真的排得出幾個人次」再查階梯，人頭數會高估
         * （退伍當天只剩早中、送便當只有晚上），所以直接拿引擎當天的目標來比。
         */
        const cleanupPool = active.filter(x => !St.isFixedDishwashAllDay(x));
        const desired = sc.cleanupDesired || St2.CleanupSchedule.cleanupSizes(cleanupPool.length);
        cleanupAll.forEach(id => {
          if (St.isFixedDishwashAllDay(St.memberById(id) || {})) fail(d, `三餐都固定洗碗的 ${nm(id)} 被排到撤收`);
        });
        const ladderHit = [desired.breakfast, desired.lunch, desired.dinner].join('/');
        if (desired.breakfast + desired.lunch + desired.dinner > cleanupPool.length) {
          fail(d, `撤收名額 ${ladderHit} 超過排得動撤收的 ${cleanupPool.length} 人`);
        }
        const capacityOf = meal => cleanupPool.filter(x => {
          if (!St.isActiveOn(x, d, meal)) return false;
          if (isShopper(x.id) && meal !== 'dinner') return false;
          if (x.fixedRole === 'delivery' && meal !== 'dinner') return false;
          if (meal === 'dinner' && x.skipDinnerCleanup) return false;
          if ((sc.meals[meal].dishwash || []).includes(x.id)) return false;
          return true;
        }).length;
        /*
         * 名額不可以超編，也不可以超過那一餐排得動的人數。
         * 「沒坐滿」不一定是錯：每人一天最多排一次，當名額總數逼近當天人數時
         * （例如 8/3 是 18 人 18 個名額），限制一交錯就湊不出完美配對，這是數學上的必然。
         */
        let shortTotal = 0;
        MEALS.forEach(meal => {
          const got = (sc.meals[meal].cleanup || []).length;
          const cap = capacityOf(meal);
          if (got > desired[meal]) fail(d, `${meal} 撤收 ${got} 人，超過預定的 ${desired[meal]} 人`);
          if (got > cap) fail(d, `${meal} 撤收 ${got} 人，超過那一餐排得動的 ${cap} 人`);
          shortTotal += Math.max(0, desired[meal] - got);
        });
        if (shortTotal) {
          const total = MEALS.reduce((a, meal) => a + desired[meal], 0);
          notes.push(`${d} 撤收名額 ${total} 個、排得動的 ${cleanupPool.length} 人，少坐了 ${shortTotal} 個`
            + `（${MEALS.map(mm => `${St.MEAL_LABELS[mm]}${sc.meals[mm].cleanup.length}`).join('／')}）`);
        }
      } else {
        /*
         * ── 撤收：單純照號碼輪（2026/08/08 起）────────────────────────
         * 規則只剩兩條：每餐幾個人照人數階梯、誰去照 263 → 新進五位 → 261 的隊伍輪。
         */
        const pool = active.slice().sort(St.cleanupOrder);
        const want = St2.CleanupSchedule.cleanupSizes(pool.length);
        MEALS.forEach(meal => {
          const got = (sc.meals[meal].cleanup || []).length;
          // 那一餐在營的人可能不夠（退伍當天的晚上），所以只檢查不超編
          if (got > want[meal]) fail(d, `${meal} 撤收 ${got} 人，超過階梯的 ${want[meal]} 人`);
          (sc.meals[meal].cleanup || []).forEach(id => {
            if (!activeAt(id, meal)) fail(d, `${meal} ${nm(id)} 這一餐不在營卻被排到撤收`);
            if (isShopper(id) && meal !== 'dinner') fail(d, `${meal} 採買的 ${nm(id)} 不該被排到撤收`);
          });
          const short = want[meal] - got;
          if (short > 0) {
            notes.push(`${d} ${meal} 撤收 ${got}/${want[meal]}（那一餐在營的人不夠）`);
          }
        });

        /*
         * 同一餐內要照隊伍順序（index 遞增，最多繞一圈）。
         *
         * 跨餐不比：那一餐不在的人會被跳過、游標可能繞回開頭，
         * 「上一餐最後一個」跟「這一餐第一個」在隊伍上不一定相鄰，比了只會誤報。
         */
        const order = {};
        pool.forEach((m, i) => (order[m.id] = i));
        MEALS.forEach(meal => {
          const ids = (sc.meals[meal].cleanup || []).map(id => order[id]).filter(i => i != null);
          let wraps = 0;
          for (let i = 1; i < ids.length; i++) if (ids[i] < ids[i - 1]) wraps++;
          if (wraps > 1) fail(d, `${meal} 撤收沒有照隊伍順序排（繞了 ${wraps} 次）`);
        });
      }

      // ── 換水：只有早餐、固定 5 人、不排招員、不跟早餐撤收重複 ──
      const water = sc.daily.water || [];
      MEALS.forEach(meal => {
        if ((sc.meals[meal].water || []).length) fail(d, `換水不該出現在 ${meal} 的勤務欄位（應該在全日）`);
      });
      const waterCap = active.filter(x => !x.skipWater && St.isActiveOn(x, d, 'breakfast')
        && !isShopper(x.id)
        && !(sc.meals.breakfast.cleanup || []).includes(x.id)).length;
      // 換水從 WATER_START 才開始，之前的日子不該有
      const waterWant = d < St.WATER_START ? 0 : Math.min(St.WATER_COUNT, waterCap);
      if (water.length !== waterWant) fail(d, `換水 ${water.length} 人，應為 ${waterWant} 人`);
      water.forEach(id => {
        const mm = St.memberById(id);
        if (mm.skipWater) fail(d, `換水排到免排換水的 ${nm(id)}`);
        if (!St.isActiveOn(mm, d, 'breakfast')) fail(d, `換水排到早餐不在的 ${nm(id)}`);
        if ((sc.meals.breakfast.cleanup || []).includes(id)) fail(d, `${nm(id)} 早餐既撤收又換水`);
      });
      const waterDup = water.filter((x, i) => water.indexOf(x) !== i);
      if (waterDup.length) fail(d, `換水重複排到：${names([...new Set(waterDup)])}`);
      /*
       * 不能有人連兩天換水（使用者指定）。比對的是「上一個排班日」而不是日曆上的昨天，
       * 因為中間可能有沒排的日子。鎖定的日子也要算進來——8/6 是鎖定的，
       * 8/7 照樣不能跟它重複（進度會從鎖定的內容接下去）。
       * 真的湊不出來時程式會放寬並跳警告，那種情況就不算錯。
       */
      const wIdx = dates.indexOf(d);
      // 8/7 早上已經照舊換過水了，那天不套這條（見 State.WATER_RULES_FROM）
      if (wIdx > 0 && water.length && d >= St.WATER_RULES_FROM) {
        const prevWater = S.schedules[dates[wIdx - 1]].daily.water || [];
        const backToBack = water.filter(id => prevWater.includes(id));
        const relaxWarned = (sc.warnings || []).some(w => w.indexOf('只好連兩天') !== -1);
        if (backToBack.length && !relaxWarned) {
          fail(d, `換水連兩天排到同一個人：${names(backToBack)}（上一個排班日 ${dates[wIdx - 1]}）`);
        }
      }

      // ── 掃廁所：早上9點、人工指定，程式只負責照抄與擋掉不合理的指定 ──
      const toilet = sc.daily.toilet || [];
      const toiletWant = (S.toiletByDate[d] || []).filter(id => {
        const mm = St.memberById(id);
        return mm && St.isActiveOn(mm, d, 'breakfast') && !isShopper(id);
      });
      if (!eq(set(toilet), set(toiletWant))) {
        fail(d, `掃廁所名單不符：設定 ${names(toiletWant)}，班表 ${names(toilet)}`);
      }
      toilet.forEach(id => {
        if (isShopper(id)) fail(d, `${nm(id)} 這天去採買，9 點不在營區卻被排到掃廁所`);
        if (!activeAt(id, 'breakfast')) fail(d, `掃廁所排到早上不在的 ${nm(id)}`);
      });
      MEALS.forEach(meal => {
        if ((sc.meals[meal].toilet || []).length) fail(d, `掃廁所不該出現在 ${meal} 的勤務欄位（應該在全日）`);
      });

      /*
       * 採買的人早、中完全不排，晚上歸隊。撤收現在是「固定名額、做最少的先輪」，
       * 所以不能硬性要求他一定被排到晚餐撤收——只檢查早/中真的沒排到他。
       */
      shoppers.forEach(id => {
        if ((sc.daily.water || []).includes(id)) fail(d, `採買的 ${nm(id)} 不該被排到換水`);
        ['breakfast', 'lunch'].filter(mm => MEALS.indexOf(mm) !== -1).forEach(meal => {
          const m = sc.meals[meal];
          ['dishwash','foodwaste','wipe','floor','delivery','cleanup','carryVehicle'].forEach(k => {
            if ((m[k] || []).includes(id)) fail(d, `${meal} 採買的 ${nm(id)} 不該被排到 ${k}`);
          });
          Object.keys(m.serving || {}).forEach(role => {
            if ((m.serving[role] || []).includes(id)) fail(d, `${meal} 採買的 ${nm(id)} 不該出現在打菜的 ${role}`);
          });
        });
      });

      // 新人不排洗衣籃、不排晚上撤收
      S.members.filter(x => x.skipLaundry).forEach(x => {
        if ((sc.daily.laundryUp||[]).includes(x.id) || (sc.daily.laundryDown||[]).includes(x.id))
          fail(d, `${nm(x.id)} 設定免排洗衣籃卻被排到`);
      });
      // 「免排晚上撤收」只在舊規則有效；8/8 起使用者明確說撤收不看這個，照號碼輪就好
      if (St.MEAL_DUTIES_ENABLED && sc.meals.dinner) {
        S.members.filter(x => x.skipDinnerCleanup).forEach(x => {
          if ((sc.meals.dinner.cleanup||[]).includes(x.id)) fail(d, `${nm(x.id)} 設定免排晚上撤收卻被排到`);
        });
      }
      // 退出打飯班的人，當天早上起完全不能出現
      S.members.filter(x => x.dischargeDate === d && x.leaveMode === 'immediate').forEach(x => {
        MEALS.forEach(meal => {
          ['dishwash','foodwaste','wipe','floor','delivery','carryVehicle','cleanup'].forEach(k => {
            if ((sc.meals[meal][k]||[]).includes(x.id)) fail(d, `${nm(x.id)} 已退出打飯班卻被排到 ${meal} ${k}`);
            const sv2 = sc.meals[meal].serving || {};
            if (Object.values(sv2).some(list => (list||[]).includes(x.id))) fail(d, `${nm(x.id)} 已退出打飯班卻出現在 ${meal} 打菜流程`);
          });
        });
        if ((sc.daily.shopping||[]).includes(x.id)) fail(d, `${nm(x.id)} 已退出打飯班卻被排到採買`);
      });
      // 退伍當天：早/中要能排，晚上不能出現
      S.members.filter(x => x.dischargeDate === d && x.leaveMode !== 'immediate').forEach(x => {
        // 8/14 只吃早餐，那天沒有晚餐可以檢查
        if (sc.meals.dinner) ['dishwash','foodwaste','wipe','floor','delivery','carryVehicle','cleanup'].forEach(k => {
          if ((sc.meals.dinner[k]||[]).includes(x.id)) fail(d, `${nm(x.id)} 退伍當天晚上已離營卻被排到 ${k}`);
        });
        if ((sc.daily.laundryUp||[]).includes(x.id) || (sc.daily.laundryDown||[]).includes(x.id))
          fail(d, `${nm(x.id)} 退伍當天卻被排到洗衣籃`);
      });
      // 還沒加入的人不能出現
      S.members.filter(x => x.joinDate && d < x.joinDate).forEach(x => {
        MEALS.forEach(meal => {
          ['dishwash','foodwaste','wipe','floor','delivery','carryVehicle','cleanup'].forEach(k => {
            if ((sc.meals[meal][k]||[]).includes(x.id)) fail(d, `${nm(x.id)} 還沒報到（${x.joinDate}）卻被排到 ${meal} ${k}`);
          });
        });
      });

      // 洗衣籃：抬上來 = 上一個排班日抬下去的人（還在役的）
      const idx = dates.indexOf(d);
      if (idx > 0 && d >= St.LAUNDRY_START) {
        const prev = S.schedules[dates[idx - 1]];
        // 抬上來是下午的事，所以要看「晚上還在不在」——退伍當天的人不算
        const expectUp = (prev.daily.laundryDown || [])
          .filter(id => { const mm = St.memberById(id); return mm && St.isActiveOn(mm, d, 'dinner'); });
        if (!eq(set(sc.daily.laundryUp || []), set(expectUp))) fail(d, `抬洗衣籃上來應為 ${names(expectUp)}，實際 ${names(sc.daily.laundryUp || [])}`);
      }
      if (d < St.LAUNDRY_START && ((sc.daily.laundryUp || []).length || (sc.daily.laundryDown || []).length)) {
        fail(d, `洗衣籃輪替還沒開始就排了人`);
      }

      // 個人分工文字要跟班表資料一致（三餐勤務停用後沒有對象，一起 gate）
      if (St.MEAL_DUTIES_ENABLED) {
        // 個人分工文字要跟班表資料一致
        active.forEach(mem => {
          MEALS.forEach(meal => {
            const m = sc.meals[meal];
            const labels = DV.mealDutyLabels(m, mem.id);
            if (!activeAt(mem.id, meal)) return;  // 已離營，個人分工顯示「已離營」
            /*
             * 個人分工只列「抬上樓」——抬下車、抬上車是全員一起，寫出來只是洗版。
             * 「我今天是去倒廚餘還是抬上樓」才是個人分工要回答的事。
             */
            const shouldUp = (m.carryUpstairs || []).includes(mem.id);
            if (shouldUp !== labels.includes('抬上樓')) {
              fail(d, `${meal} ${nm(mem.id)} 個人分工的抬上樓 與班表不一致（班表:${shouldUp} 文字:${labels.includes('抬上樓')}）`);
            }
            if (labels.includes('抬下車') || labels.includes('抬上車')) {
              fail(d, `${meal} ${nm(mem.id)} 個人分工不該列抬下車／抬上車（那是全員一起的）`);
            }
            const shouldClean = (m.cleanup || []).includes(mem.id);
            if (shouldClean !== labels.includes('撤收')) fail(d, `${meal} ${nm(mem.id)} 個人分工的撤收 不一致`);
            // 打菜流程的個人分工：在場的人一定要有一個打菜角色，而且要對得上班表
            if (DV.isAbsent(m, mem.id)) {   // 採買的人這一餐不在，兩段都顯示「採買」
              if (DV.mealServingLabels(m, mem.id).join('') !== '採買')
                fail(d, `${meal} ${nm(mem.id)} 去採買了，打菜那格卻不是「採買」`);
              return;
            }
            const svLabels = DV.mealServingLabels(m, mem.id);
            if (!svLabels.length) fail(d, `${meal} ${nm(mem.id)} 在場卻沒有任何打菜角色`);
            const sv3 = m.serving || {};
            const svRoles = ['rice','serveDish','lid','count','drinks','boxing']
              .filter(r => (sv3[r] || []).includes(mem.id))
              .map(r => St.DUTY_SHORT_LABELS[r]);
            if (svRoles.join('|') !== svLabels.join('|'))
              fail(d, `${meal} ${nm(mem.id)} 打菜個人分工「${svLabels.join('、')}」與班表「${svRoles.join('、')}」不一致`);
          });
        });
      }
    });

    return { fails, notes, locked, countsFrom: St.COUNTS_FROM, days: dates.length };
  });

  console.log(`稽核 ${report.days} 天（其中 ${report.locked.length} 天已鎖定、跳過規則檢查），共 ${report.fails.length} 個問題`);
  console.log(`  公平性次數從 ${report.countsFrom} 起算`);
  if (report.locked.length) console.log('  已鎖定：' + report.locked.join('、'));
  report.fails.slice(0, 40).forEach(f => console.log('  ✗ ' + f));
  if (report.notes.length) {
    console.log(`\n提醒（不是錯誤）：`);
    report.notes.forEach(n => console.log('  · ' + n));
  }
  console.log('PAGEERRORS:', JSON.stringify(errs));
  await b.close();
})();
