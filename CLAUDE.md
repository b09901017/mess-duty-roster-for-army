# CLAUDE.md

給接手這個 repo 的 AI agent。**動手改之前請先讀完這一頁。**

- 排班規則本身 → [`docs/RULES.md`](docs/RULES.md)
- 目前進度與待辦 → [`docs/HANDOVER.md`](docs/HANDOVER.md)
- 給使用者看的說明 → [`README.md`](README.md)
- LINE bot 部署 → [`docs/LINE-BOT-SETUP.md`](docs/LINE-BOT-SETUP.md)

---

## ⭐ 2026/08/08 起：程式只排「全日勤務」

三餐勤務（洗碗／廚餘／擦桌子／清地板／送便當／打菜流程／抬便當）改由**伙房班長現場直接律定人選**，程式不排了。

- 開關是 `js/state.js` 的 **`MEAL_DUTIES_ENABLED = false`**
- 相關程式碼**一行都沒刪**：`washSchedule.js`、`otherDuties.js`、`servingLine.js`、`dutySizeConfig.js` 原封不動；`scheduleEngine.js`、`cards.js`、`audit-rules.js` 裡那幾段用旗標包起來
- 要恢復：把旗標改回 `true`，再把 `cards.js` 裡 `buildCarousel` 那段註解解開

程式現在排的七項：**掃廁所、換水、抬洗衣籃上來／下去、早／午／晚撤收**。

**撤收也換演算法了**：從「最小成本最大流 ＋ 四條限制」改成**單純照號碼輪**
（`computeCleanupRotation`，隊伍是 263 → 新進五位 → 261），不管洗碗、不管誰免排，
人數照原本那張階梯表。舊的 `computeCleanupDay` 留著沒刪。

**LINE 只發六張卡片**：全日勤務、行動準據、熱追、早／午／晚便當數。
後三種的內容是班長貼在群組裡、機器人自動解析存起來的（`js/briefing.js`）。

---

## 這是什麼

台灣教召打飯班（伙房）的排勤務工具。使用者是負責排班的役男，每天要把班表貼到 LINE 群組。

兩個介面吃**同一份排班程式碼**：

1. **網頁**（純前端，GitHub Pages）—— 排班、改名冊、看公平性總覽
2. **LINE bot**（Vercel serverless）—— 群組裡打「今日勤務」就回可以左右滑的卡片

---

## 技術限制（不要打破）

| 限制 | 原因 |
|---|---|
| **純 HTML/CSS/JS，沒有框架、沒有 build step** | 使用者要能直接開 `index.html` 用 |
| **不用 ES module，只用 `<script>` 標籤 ＋ `window.App.*` namespace** | `file://` 開啟時 ES module 會被 CORS 擋掉 |
| **不裝任何 runtime 相依套件** | `package.json` 沒有 `dependencies`。PNG 是自己寫的編碼器（`api/_lib/png.js`），不用 canvas、不用字型 |
| **`js/` 底下的檔案不能碰 DOM**（`ui-*.js` 除外） | 那些檔案會被丟進 Node 的 `vm` sandbox 給 LINE bot 用 |

### LINE bot 怎麼共用同一份程式碼

`api/_lib/app.js` 把 `js/*.js` 逐一讀進 Node 的 `vm` sandbox 執行，只補一個記憶體版的 `localStorage`。
所以**規則改一次，網頁和 bot 一起變**。

> ⚠️ 新增 `js/` 檔案時要同時加到**三個地方**：`index.html`、`liff/index.html`、`api/_lib/app.js` 的 `FILES` 陣列。
> 順序有關係——`cleanupSchedule.js` 在載入時就 destructure `window.App.MinCostFlow`，所以 `minCostFlow.js` 必須排在它前面。

---

## 核心架構：重播（replay）

**這是整個系統最重要的設計，不要破壞它。**

```
來源資料（使用者真正決定的東西）
  ├── state.members          名冊
  ├── state.committedDates   已確定紀錄的日期清單   ← 唯一的「事實」
  ├── state.overrides        鎖定的日子（照公布版走）
  ├── state.shoppingByDate   逐日採買名單
  ├── state.toiletByDate     逐日掃廁所
  ├── state.dutySizeTable    勤務人數對照表
  └── state.menuSizes        逐日菜量
            │
            │  ScheduleEngine.rebuildAll()
            │  依日期順序把每一天重算一遍
            ▼
推導出來的快取（不要手動改）
  ├── state.schedules        每天的班表
  ├── state.dutyCounts       公平性次數
  ├── state.washState        洗碗輪到誰
  ├── state.laundryState     洗衣籃輪到誰
  └── state.waterState       換水輪到誰
```

**任何變動（改名冊、改設定、排一天、取消一天）都會觸發 `rebuildAll()` 從頭重算。**

這保證了：

- 同一天不管重排幾次，只要來源資料沒變，結果一定一模一樣
- **次數永遠不會疊加**——次數不是「每排一次 +1」，而是每次都從零重數
- 「預覽」跟之後「確定紀錄」的結果保證一致（`previewDay` 用 `snapshotBefore` 重播到前一天）
- 取消某天再排回來，還是同一份班表

> 改任何東西之前先問自己：**這個東西是「來源」還是「推導」？** 推導出來的東西不要直接寫，改來源然後 rebuild。

---

## 版本戳記遷移（踩過的坑）

`localStorage`／雲端存的資料會**蓋過**程式裡的預設值。所以改預設值不會自動生效。

| 常數 | 改了什麼要 +1 | 會換掉什麼 |
|---|---|---|
| `ROSTER_VERSION` | 名冊種子（`seedMembers`） | `members`、補上 `toiletByDate` 種子 |
| `CONFIG_VERSION` | 勤務人數對照表、預設菜量、預鎖的 `overrides` | `dutySizeTable`、`menuDefaults`、`menuSizes` 清空、`overrides` 換新 |

> **真實案例**：把「包便當袋子」欄位拿掉、名額分給其他四項時忘了 +1，瀏覽器裡留著舊表（含已不存在的欄位），19 人只排掉 16 個，**剩 3 個人整餐沒有勤務**。使用者回報「3 個人沒排到」才發現。

改 `seedMembers` 或 `defaultDutySizeTable` / `defaultMenuDefaults` / `defaultOverrides` → **記得 +1**。

---

## 演算法：為什麼用最小成本最大流

`js/minCostFlow.js`（SPFA 連續最短路增廣，~25 個節點）被兩個地方用：

### 1. 撤收（`js/cleanupSchedule.js`）

四條限制互相牽制（送便當只能晚上、洗碗的人不排、免排晚上撤收、採買早中不在），而且要同時決定三餐。
**貪心法會卡死**：先被早餐挑走的人可能剛好是晚餐唯一排得動的人。

### 2. 廚餘／擦桌子／清地板（`js/otherDuties.js`）

原本是一項一項分，但那一餐剩下的人數剛好等於三項名額的總和，**最後一項完全沒有挑的餘地**，等於沒在管公平。
改成「人 × 三項」一次丟進流量，成本 ＝ 該人該項已做次數 × 1000 + 名冊順序（順序當 tiebreak，保證決定性）。

> 成本用線性的「已做次數」，等價於最小化次數的平方和 ——「從 k 次變 k+1 次」的邊際成本隨 k 遞增，正好是公平化要的。

---

## 決定性（determinism）

**排班結果必須是決定性的**，不然重播就失去意義。所有排序都要有 tiebreak：

- 洗碗：游標位置決定，`washOrder`（263→261→旅部）
- 廚餘等三項：流量成本裡加 `rosterIndex`
- 撤收：`cleanup 次數 ×1e6 + 該餐別次數 ×1e3 + rosterIndex`
- 打菜／蓋便當：`pickLeast` 同次數時照 `rosterOrder`

> 加新的分配邏輯時，**永遠要有 tiebreak**。`Math.random()`、`Date.now()`、物件屬性列舉順序都不行。

---

## 檔案地圖

### 排班核心（DOM-free，bot 也會載入）

| 檔案 | 做什麼 |
|---|---|
| `js/state.js` | **所有常數、名冊種子、規則參數、localStorage、遷移**。要改規則多半從這裡開始 |
| `js/scheduleEngine.js` | `computeDay`（純計算）、`rebuildAll`（重播）、`previewDay`／`commitDay`／`uncommitDay` |
| `js/minCostFlow.js` | 最小成本最大流，撤收與雜項勤務共用 |
| `js/washSchedule.js` | 洗碗：`fixedDishwashMeals` 指定的人先進，其餘走單一佇列 |
| `js/otherDuties.js` | 廚餘／擦桌子／清地板（三項一起分；`fixedFoodwasteMeals` 的人先佔位） |
| `js/cleanupSchedule.js` | 撤收（含人數階梯與容量壓縮） |
| `js/servingLine.js` | 打菜流程（含讓步順序與正取／候補） |
| `js/laundry.js` | 洗衣籃 |
| `js/waterSchedule.js` | 換水 |
| `js/shoppingRoster.js` | 採買（逐日名單） |
| `js/toiletDuty.js` | 掃廁所（逐日名單） |
| `js/briefing.js` | **班長每日通知的解析**（熱追／便當數量／行動準據），含日期推斷與合併 |
| `js/dutySizeConfig.js` | 人數對照表查詢 |
| `js/dutyView.js` | 「某人某餐要做什麼」的共用推導 |
| `js/textFormat.js` | 文字班表的組法（**網頁與 LINE bot 共用**） |
| `js/fairnessChart.js` | 公平性圓圖的資料模型（**SVG 與 PNG 共用**） |
| `js/scheduleImport.js` | 把公布過的文字班表讀回來（鎖定用） |
| `js/roster.js` | 人員 CRUD |

### 畫面（需要 DOM，bot 不載入）

`js/ui-schedule.js`／`ui-textschedule.js`／`ui-roster.js`／`ui-dutyconfig.js`／`ui-shopping.js`／`ui-dashboard.js`／`ui-cloud.js`、`js/app.js`（分頁切換）、`js/cloudSync.js`

### LINE bot（Vercel）

| 檔案 | 做什麼 |
|---|---|
| `api/webhook.js` | 驗簽章、解析訊息、回卡片 |
| `api/_lib/app.js` | 在 `vm` sandbox 裡跑 `js/` 那份程式碼 |
| `api/_lib/cards.js` | 組 Flex 卡片（配色、分段） |
| `api/_lib/line.js` | 驗簽章（`readRawBody` 有四種取法）、回訊息 |
| `api/_lib/firestore.js` | 匿名登入 ＋ 讀名冊狀態（`rosters/`）＋ 讀寫班長通知（`briefings/`，**另一份文件**） |
| `api/_lib/png.js` | 純 JS 的 PNG 編碼 + 圓圖描繪（零套件、無字型） |
| `api/_lib/fairnessImage.js` | 四項勤務排成 2×2 |
| `api/fairness.js`／`api/state.js`／`api/config.js` | 圖片、LIFF 唯讀資料、LIFF ID |

---

## 驗證（改完一定要跑）

```bash
npm run check           # 全部檔案 node --check
python3 -m http.server 8123 &   # audit 需要靜態伺服器
npm run audit           # ⭐ 把所有規則當斷言，8/1~8/14 全跑一遍
npm run verify:counts   # ⭐ 不看存的次數，從班表重數一遍再比對；5 種情境
npm run check:colors    # LINE 卡片配色（WCAG 對比 + CIE Lab ΔE）
npm run bot:demo        # 本機跑一遍 bot 流程，印出卡片、存出 PNG
```

**`npm run audit` 是最重要的一支。** 規則互相牽制得很緊，改一條很容易踩到另一條。它會檢查：

- 勤務人數加總 = 那一餐要分的人數
- 每個人同一餐不會被排到兩項主要勤務
- 打菜流程每個在場的人剛好一個位置
- 固定角色的人選符合正取／候補
- 抬便當分組不重疊且分完
- 撤收的四條限制、名額沒超編
- 換水不跟早餐撤收重複、招員不排
- 洗衣籃銜接、免排旗標
- 退伍／退出／加入日期
- 採買的人早中真的沒被排到
- `dutyExempt` 的人完全不出現
- **個人分工文字跟班表資料一致**

> audit 與 verify:counts 都會**自己塞情境進去**（採買、抬便當分組），因為預設資料是空的，不塞的話那些斷言等於從來沒執行過。這個坑踩過一次。

### 手機版

使用者只在手機上看。改畫面之後用 Playwright 開 375px 寬確認：

```js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 375, height: 1200 } });
```

---

## 踩過的坑（不要重蹈覆轍）

| 坑 | 教訓 |
|---|---|
| 改了預設值但沒 +VERSION | localStorage 會蓋過程式，**一定要 +1** |
| 遷移後沒推上雲端 | `cloudSync.applyRemote` 要比對 `exportJson()` 有沒有變，變了就推 |
| 貪心法排撤收 | 限制交錯會卡死，用流量 |
| 一項一項分雜項勤務 | 最後一項沒有挑的餘地，要一起分 |
| 公平範圍用全體平均 | 中途退伍／報到的人永遠被標偏少，要**按在營天數等比例** |
| 公平圖分母算錯 | 換水漏算送便當、多算招員；每次改「誰要做什麼」都要回頭看 `eligibleFor` |
| 撤收階梯直接用人頭數 | 會高估（退伍當天只剩早中、送便當只有晚上），要用**實際排得動的容量**壓 |
| 只有一餐的日子用三餐階梯 | 8/14 早餐會從 4 掉到 2，要取那一餐該有的數字 |
| 同一個人列在兩行 | 抬飲料重複列在包便當、計數重複列在蓋便當——`audit` 的「剛好一項」斷言會抓到 |
| LINE 驗簽章失敗 | Vercel 會先 parse body 導致 stream 是空的，`readRawBody` 要試四種取法 |
| 用 RGB 距離判斷卡片配色 | 會低估色相差異，要用 **CIE Lab ΔE** |
| 寫死三餐 | 8/14 只吃早餐，用 `State.mealsOn(date)` / `TextFormat.mealKeysOf()` |
| 用「有沒有加入日期」判斷是不是招員 | `isNewcomer = !!joinDate` 這種推斷會誤傷——8/10 補進來的新人也有加入日期，一被當成招員，免排洗衣籃／晚上撤收／換水全部跟著跑掉。改用序號明確列出（`RECRUIT_SEQS`） |
| `dutyExempt` 只在 `computeDay` 擋 | 三餐的勤務是靠 dayMembers 濾掉擋住的，但**洗衣籃拿的是整份名冊**（輪替進度要一個不會變動的座標系），所以 `laundry.js` 要自己擋一次。以前沒擋，只是剛好被「愷宸有 joinDate 所以 skipLaundry」蓋住，改名冊判斷之後就露出來了 |
| 手寫「顯示標籤 → 欄位」的對照表 | `scheduleImport.js` 以前是手寫的，標籤改名（包餐盒→包便當、掃廁所加時段）之後沒跟上，貼回來鎖定會**靜默漏掉**那幾行（查不到 key 直接 return，不報錯）。一律用 `buildLabelIndex()` 從 `DUTY_LABELS` 反推，括號裡的補充說明比對前先去掉 |
| 鎖定的日子忘記推進輪替進度 | 洗衣籃（`lastDown`）和洗碗（`washNextStartId`）都有從 override 接續，換水漏了 → 隔天從隊伍頭重來，柏宇 8/6、8/7 連兩天。**每加一項有輪替進度的勤務，都要回頭看 `computeDay` 的 override 區塊有沒有一起推進** |
| 段落標題的比對規定「整行到〕就結束」 | `scheduleImport` 的 `^〔(.+?)〕$` 只認沒有補充說明的標題。8/7 幫「抬便當」「集合」這些段落加上（隨時到、隨時搬）之後，那些行不再被認成標題，`section` 就沿用上一段的值——整段被當成還在「打菜」，倒廚餘、送便當**全部讀不到**。改成 `^〔(.+?)〕`（不要求結尾），而且「哪一段是打菜」從 `MEAL_SECTIONS` 反查、不寫死標題 |
| 把倒廚餘當成善後勤務 | 倒廚餘是**集合完馬上做**的，跟抬上樓兩批同時進行；善後勤務是休息完才做的，只有洗碗／擦桌子／清地板。四項的**人數還是一起算**（§4 那張表），只是做的時間點不同 |
| 機器人跟網頁 App 寫同一份 Firestore 文件 | App 是整份 state 一次覆蓋的。班長貼通知的同時值星按「確定紀錄」，其中一邊就沒了。班長通知存在 **`briefings/{房間代碼}`**，跟 `rosters/{房間代碼}` 分開 |
| 停用一整組功能時直接刪程式碼 | 使用者明講「先不要刪，用註解關掉就好」——規則常常改回來。用旗標（`MEAL_DUTIES_ENABLED`）比註解掉幾百行安全，而且 `git diff` 看得懂 |
| 自動判斷文字班表格式時認段落標題 | `parseScheduleText` 以前用 `〔打菜〕` 判斷是不是「依餐別」格式。段落會隨規則增減（三餐停用後一段都不剩），改認 `【早餐】【全日】` 這種大標題 |
| 讓 override 留下空的餐別 | `computeDay` 只看「這一餐有沒有 override」，空殼是 truthy → 整餐被鎖成空白。只貼一半、或 8/14 這種只有一餐的日子都會踩到，所以 `pruneEmptyMeals()` 要把沒讀到內容的餐別整個刪掉 |

---

## 使用者是誰、怎麼溝通

- 台灣役男，**看得懂邏輯但不看程式碼**
- 用**繁體中文**回覆，術語用他們的講法（打菜、撤收、包便當、抬洗衣籃）
- **規則常常改**，而且是「昨天講的今天又不一樣」——所以才有「鎖定已公布班表」的機制
- 他會**邊改規則邊公布班表**，所以改規則之前先確認**已公布的日子有沒有被鎖住**
- 決策要用**數字說服**：跑兩種方案給他看實際差別，比講道理有用
- 他問「你覺得呢」的時候是真的要建議，不是要選項清單

### 規則改動的標準流程

1. 先確認要不要**鎖住已公布的日子**（`defaultOverrides()` 加一筆，或叫他在 UI 上貼）
2. 改 `js/state.js` 的常數／種子，**記得 +VERSION**
3. 改對應的演算法模組
4. 三個顯示層（`textFormat` / `ui-schedule` / `cards`）跟上——**共用的分段定義在 `MEAL_SECTIONS`**
5. `scripts/audit-rules.js` 補上新規則的斷言，**而且要塞情境進去**
6. 跑全套驗證
7. 更新 `docs/RULES.md`、`README.md`
8. commit（訊息寫**為什麼**，不只寫改了什麼）

---

## Git

- 開發分支：`claude/new-repo-init-l5ckx3`
- commit 訊息用繁體中文，說明**為什麼這樣改**、量化的話附上數字
- **不要自己開 PR**，除非使用者明講
- GitHub Pages 的 `pages build and deployment` 是 GitHub 自動產生的，**repo 裡沒有 `.github/workflows`**。它偶爾會因為 GitHub 自己沒有 runner 而失敗（`runner_id: 0`、`The job was not acquired by Runner of type hosted`），那不是程式問題，重跑就好
