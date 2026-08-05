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
    S.shoppingByDate = { '2026-08-07': ['261-3', '261-5'], '2026-08-11': ['263-4'] };
    S.toiletByDate = { '2026-08-06': ['261-9'], '2026-08-07': ['263-2'], '2026-08-12': ['旅部-1'] };
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
      const active = St.activeMembersOn(d);
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

      St.MEAL_KEYS.forEach(meal => {
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

        // 送便當欄位 = 那一餐還在營的固定送便當的人
        const deliveryThisMeal = delivery.filter(id => activeAt(id, meal));
        if (!eq(set(m.delivery || []), set(deliveryThisMeal))) fail(d, `${meal} 送便當名單不符`);

        // 抬上車/上樓 = 在場 − 送便當（洗碗的人也要抬）
        const expectCarry = set(present.filter(id => !deliveryThisMeal.includes(id)));
        if (!eq(set(m.carryVehicle || []), expectCarry)) {
          fail(d, `${meal} 抬上車名單不符：多/少 ${names([...expectCarry].filter(x => !(m.carryVehicle||[]).includes(x)))} / ${names((m.carryVehicle||[]).filter(x => !expectCarry.has(x)))}`);
        }
        if (!eq(set(m.carryUpstairs || []), expectCarry)) fail(d, `${meal} 抬上樓名單與抬上車不一致`);

        // ── 打菜流程 ──
        const sv = m.serving || {};
        const svAll = ['rice','serveDish','lid','count','drinks','boxing'].flatMap(k => sv[k] || []);
        // 每個在場的人剛好被排到一項
        const svDup = svAll.filter((x,i) => svAll.indexOf(x) !== i);
        if (svDup.length) fail(d, `${meal} 打菜流程重複排到：${names([...new Set(svDup)])}`);
        const svMissing = present.filter(id => !svAll.includes(id));
        if (svMissing.length) fail(d, `${meal} 打菜流程沒排到：${names(svMissing)}`);
        svAll.forEach(id => {
          if (!present.includes(id)) fail(d, `${meal} 打菜流程排到不在場的 ${nm(id)}`);
        });
        // 固定角色必須是名冊指定的人；早餐不打飯，rice 必須是空的且那兩位改成包餐盒
        const withRice = St.servesRiceAt(meal);
        ['rice','count','drinks'].forEach(role => {
          const roleMembers = present.filter(id => (St.memberById(id)||{}).servingRole === role);
          const expect = (role === 'rice' && !withRice) ? [] : roleMembers;
          if (!eq(set(sv[role] || []), set(expect))) fail(d, `${meal} 打菜固定角色 ${role} 名單不符`);
        });
        const riceMembers = present.filter(id => (St.memberById(id)||{}).servingRole === 'rice');
        if (!withRice) riceMembers.forEach(id => {
          if (!(sv.boxing || []).includes(id)) fail(d, `${meal} 不打飯，${nm(id)} 應改成包餐盒`);
        });
        // 輪替的三項不能排到有固定角色的人
        ['serveDish','lid','boxing'].forEach(role => {
          (sv[role] || []).forEach(id => {
            const mm = St.memberById(id);
            if (mm && mm.servingRole && role !== 'boxing') fail(d, `${meal} ${nm(id)} 有固定角色卻被排到 ${role}`);
          });
        });
        // 打菜人數：足夠時就是 2×菜數
        const dishes = m.dishes;
        // 打菜/蓋便當的候選池 = 在場的人扣掉「名冊上有固定角色」的人（不打飯的那餐也一樣扣）
        const fixedCount = present.filter(id => (St.memberById(id)||{}).servingRole).length;
        const poolSize = present.length - fixedCount;
        const wantDish = Math.min(dishes * 2, poolSize);
        if ((sv.serveDish||[]).length !== wantDish) fail(d, `${meal} 打菜應 ${wantDish} 人，實際 ${(sv.serveDish||[]).length} 人`);
        // 蓋便當：人夠就是2人，不夠就是0
        const wantLid = poolSize >= dishes*2 + 2 ? 2 : 0;
        if ((sv.lid||[]).length !== wantLid) fail(d, `${meal} 蓋便當應 ${wantLid} 人，實際 ${(sv.lid||[]).length} 人`);

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

      // 撤收：每餐固定 早5／中7／晚7，同一天不會有人被排兩次
      const cleanupAll = St.MEAL_KEYS.flatMap(meal => sc.meals[meal].cleanup || []);
      const dup = cleanupAll.filter((x, i) => cleanupAll.indexOf(x) !== i);
      if (dup.length) fail(d, `撤收同一天重複排到：${names([...new Set(dup)])}`);
      /*
       * 撤收改成「固定名額、做最少的先輪」，不再要求每個人每天都輪到一次。
       * 所以檢查的是名額有沒有坐滿，以及有沒有排到不該排的人。
       */
      const cleanupPool = active.slice();
      const desired = St2.CleanupSchedule.cleanupSizes(cleanupPool.length);
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
      St.MEAL_KEYS.forEach(meal => {
        const got = (sc.meals[meal].cleanup || []).length;
        const cap = capacityOf(meal);
        if (got > desired[meal]) fail(d, `${meal} 撤收 ${got} 人，超過預定的 ${desired[meal]} 人`);
        if (got > cap) fail(d, `${meal} 撤收 ${got} 人，超過那一餐排得動的 ${cap} 人`);
        shortTotal += Math.max(0, desired[meal] - got);
      });
      if (shortTotal) {
        const total = St.MEAL_KEYS.reduce((a, meal) => a + desired[meal], 0);
        notes.push(`${d} 撤收名額 ${total} 個、當天 ${cleanupPool.length} 人，少坐了 ${shortTotal} 個`
          + `（早${sc.meals.breakfast.cleanup.length}／中${sc.meals.lunch.cleanup.length}／晚${sc.meals.dinner.cleanup.length}）`);
      }

      // ── 換水：只有早餐、固定 5 人、不排招員、不跟早餐撤收重複 ──
      const water = sc.daily.water || [];
      St.MEAL_KEYS.forEach(meal => {
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
      St.MEAL_KEYS.forEach(meal => {
        if ((sc.meals[meal].toilet || []).length) fail(d, `掃廁所不該出現在 ${meal} 的勤務欄位（應該在全日）`);
      });

      /*
       * 採買的人早、中完全不排，晚上歸隊。撤收現在是「固定名額、做最少的先輪」，
       * 所以不能硬性要求他一定被排到晚餐撤收——只檢查早/中真的沒排到他。
       */
      shoppers.forEach(id => {
        if ((sc.daily.water || []).includes(id)) fail(d, `採買的 ${nm(id)} 不該被排到換水`);
        ['breakfast', 'lunch'].forEach(meal => {
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
      S.members.filter(x => x.skipDinnerCleanup).forEach(x => {
        if ((sc.meals.dinner.cleanup||[]).includes(x.id)) fail(d, `${nm(x.id)} 設定免排晚上撤收卻被排到`);
      });
      // 退出打飯班的人，當天早上起完全不能出現
      S.members.filter(x => x.dischargeDate === d && x.leaveMode === 'immediate').forEach(x => {
        St.MEAL_KEYS.forEach(meal => {
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
        ['dishwash','foodwaste','wipe','floor','delivery','carryVehicle','cleanup'].forEach(k => {
          if ((sc.meals.dinner[k]||[]).includes(x.id)) fail(d, `${nm(x.id)} 退伍當天晚上已離營卻被排到 ${k}`);
        });
        if ((sc.daily.laundryUp||[]).includes(x.id) || (sc.daily.laundryDown||[]).includes(x.id))
          fail(d, `${nm(x.id)} 退伍當天卻被排到洗衣籃`);
      });
      // 還沒加入的人不能出現
      S.members.filter(x => x.joinDate && d < x.joinDate).forEach(x => {
        St.MEAL_KEYS.forEach(meal => {
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

      // 個人分工文字要跟班表資料一致
      active.forEach(mem => {
        St.MEAL_KEYS.forEach(meal => {
          const m = sc.meals[meal];
          const labels = DV.mealDutyLabels(m, mem.id);
          if (!activeAt(mem.id, meal)) return;  // 已離營，個人分工顯示「已離營」
          const shouldCarry = (m.carryVehicle || []).includes(mem.id);
          const hasCarry = labels.includes('抬上車/上樓');
          if (shouldCarry !== hasCarry) fail(d, `${meal} ${nm(mem.id)} 個人分工的抬上車/上樓 與班表不一致（班表:${shouldCarry} 文字:${hasCarry}）`);
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
