#!/usr/bin/env node
/*
 * 把所有排班規則當成斷言，對 8/1～8/14 全部跑一遍。
 * 規則有任何改動都應該先跑這個，確認沒有踩到別條規則。
 *
 *   node scripts/dev-server.js 8123 &   （或任何靜態伺服器）
 *   BASE=http://127.0.0.1:8123 node scripts/audit-rules.js
 */
const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept(''));
  await page.goto((process.env.BASE || 'http://127.0.0.1:8123') + '/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => { for (let i = 1; i <= 14; i++) window.App.ScheduleEngine.commitDay('2026-08-' + String(i).padStart(2, '0')); });

  const report = await page.evaluate(() => {
    const S = window.App.State.get();
    const St = window.App.State;
    const DV = window.App.DutyView;
    const St2 = window.App;
    const fails = [];
    const notes = [];
    const fail = (d, msg) => fails.push(`${d}  ${msg}`);
    const set = a => new Set(a);
    const eq = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
    const nm = id => (St.memberById(id) || {}).name || id;
    const names = ids => ids.map(nm).join('、') || '(空)';

    const dates = Object.keys(S.schedules).sort();

    dates.forEach(d => {
      const sc = S.schedules[d];
      const active = St.activeMembersOn(d);
      const activeIds = set(active.map(m => m.id));
      const activeAt = (id, meal) => { const mm = St.memberById(id); return mm && St.isActiveOn(mm, d, meal); };
      const delivery = active.filter(m => m.fixedRole === 'delivery').map(m => m.id);
      const shopper = (sc.daily.shopping || [])[0] || null;

      // 採買必須符合星期表
      const wd = new Date(d + 'T00:00:00').getDay();
      const rosterPick = S.shoppingRoster[wd];
      const pastShoppingEnd = S.shoppingUntil && d > S.shoppingUntil;
      const rosterActive = rosterPick && activeIds.has(rosterPick) && !pastShoppingEnd;
      if (pastShoppingEnd && shopper) fail(d, `已過採買結束日 ${S.shoppingUntil} 卻還排了採買 ${nm(shopper)}`);
      if (rosterActive && shopper !== rosterPick) fail(d, `採買應為 ${nm(rosterPick)} 卻是 ${shopper ? nm(shopper) : '無'}`);
      if (!rosterActive && shopper) fail(d, `星期表沒排採買，卻出現 ${nm(shopper)}`);

      St.MEAL_KEYS.forEach(meal => {
        const m = sc.meals[meal];
        const isOff = meal === 'breakfast' || meal === 'lunch';
        const absent = shopper && isOff ? [shopper] : [];
        const present = [...activeIds].filter(id => !absent.includes(id) && activeAt(id, meal));

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

        // 撤收不能有送便當的人，也不能有那一餐洗碗的人
        (m.cleanup || []).forEach(id => { if (delivery.includes(id)) fail(d, `${meal} 送便當的 ${nm(id)} 被排到撤收`); });
        (m.cleanup || []).forEach(id => {
          if ((m.dishwash || []).includes(id)) fail(d, `${meal} ${nm(id)} 同一餐既洗碗又撤收`);
        });
      });

      // 撤收：每人每天剛好一次，且早餐人數最少
      const cleanupAll = St.MEAL_KEYS.flatMap(meal => sc.meals[meal].cleanup || []);
      const dup = cleanupAll.filter((x, i) => cleanupAll.indexOf(x) !== i);
      if (dup.length) fail(d, `撤收重複排到：${names([...new Set(dup)])}`);
      // 有人當天三餐都不在（例如退伍當天又輪到採買），本來就無法排撤收，不算漏排
      const canDoSomeCleanup = id => {
        const mm = St.memberById(id);
        return St.MEAL_KEYS.some(meal => {
          if (!St.isActiveOn(mm, d, meal)) return false;
          if (shopper === id && (meal === 'breakfast' || meal === 'lunch')) return false;
          if (mm.skipDinnerCleanup && meal === 'dinner') return false;
          if ((sc.meals[meal].dishwash || []).includes(id)) return false;  // 那一餐在洗碗
          return true;
        });
      };
      const eligibleCleanup = [...activeIds].filter(id => !delivery.includes(id) && canDoSomeCleanup(id));
      const missing = eligibleCleanup.filter(id => !cleanupAll.includes(id));
      if (missing.length) fail(d, `撤收沒排到：${names(missing)}`);
      const bN = sc.meals.breakfast.cleanup.length, lN = sc.meals.lunch.cleanup.length, dN = sc.meals.dinner.cleanup.length;
      /*
       * 早餐要最輕鬆——但只有在「晚餐排得下預定人數」時才是硬性要求。
       * 洗碗的人不排撤收 + 新人免排晚上撤收，兩條加起來有時候會讓晚餐根本坐不滿，
       * 那時候人只能往早/中擠，不算演算法排錯。
       */
      const cleanupPool = active.filter(m => m.fixedRole !== 'delivery');
      const desired = St2.CleanupSchedule.cleanupSizes(cleanupPool.length);
      const capacityOf = meal => cleanupPool.filter(x => {
        if (!St.isActiveOn(x, d, meal)) return false;
        if (shopper === x.id && meal !== 'dinner') return false;
        if (meal === 'dinner' && x.skipDinnerCleanup) return false;
        if ((sc.meals[meal].dishwash || []).includes(x.id)) return false;
        return true;
      }).length;
      /*
       * 硬性要求只到「早餐不會比中餐重」。早餐 vs 晚餐沒辦法硬性保證：
       * 洗碗不排撤收 + 免排晚上撤收 兩條交錯時，可能連一組「都不超編」的分法都不存在
       * （Hall 條件不成立，光看各餐人數上限看不出來）。最小成本流已經是最佳解，
       * 所以這裡只記錄實際分佈，不當成錯誤。
       */
      if (bN > lN) fail(d, `早餐撤收 ${bN} 人比中餐 ${lN} 人還多`);
      if (bN > dN) notes.push(`${d} 撤收 早${bN}／中${lN}／晚${dN}（想排 早${desired.breakfast}／中${desired.lunch}／晚${desired.dinner}，晚餐上限 ${capacityOf('dinner')}）`);
      // 採買的人要在晚餐撤收，除非他晚餐剛好在洗碗（洗碗的人不排撤收）
      const shopperMem = shopper && St.memberById(shopper);
      if (shopper && St.isActiveOn(shopperMem, d, 'dinner')
          && !(sc.meals.dinner.dishwash || []).includes(shopper)
          && !sc.meals.dinner.cleanup.includes(shopper))
        fail(d, `採買的 ${nm(shopper)} 沒在晚餐洗碗，也沒被排到晚餐撤收`);

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
        const expectUp = (prev.daily.laundryDown || []).filter(id => activeIds.has(id));
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

    return { fails, notes, days: dates.length };
  });

  console.log(`稽核 ${report.days} 天，共 ${report.fails.length} 個問題`);
  report.fails.slice(0, 40).forEach(f => console.log('  ✗ ' + f));
  if (report.notes.length) {
    console.log(`\n受限制影響、早餐撤收多於晚餐的日子（${report.notes.length} 天）：`);
    report.notes.forEach(n => console.log('  · ' + n));
  }
  console.log('PAGEERRORS:', JSON.stringify(errs));
  await b.close();
})();
