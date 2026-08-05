# LINE bot 設定步驟

把機器人拉進打飯班群組，打「今日勤務」就會回一組可以左右滑的卡片。

整套跑在 **Vercel 免費方案**（不用信用卡），資料讀的是你在 App「雲端同步」分頁上傳的那份 Firestore。

> **為什麼不用 Google Apps Script**：GAS 沒辦法產生 PNG（公平性總覽那張圖），
> 而且 LIFF 在 GAS 的巢狀 iframe 裡跑不起來。這兩個功能都會卡死，所以用 Vercel。

---

## 你會拿到什麼

打「今日勤務」→ 機器人回 **9 張卡片**，左右滑：

| # | 卡片 | 內容 |
|---|------|------|
| 1 | 早餐 | 打菜流程 ＋ 勤務 |
| 2 | 中餐 | 打菜流程 ＋ 勤務 |
| 3 | 晚餐 | 打菜流程 ＋ 勤務 |
| 4 | 261 梯 01-08 | 個人分工 |
| 5 | 263 梯 01-05 | 個人分工 |
| 6 | 263 梯 06-10 | 個人分工 |
| 7 | 261 梯 09-13 | 個人分工 |
| 8 | 全日勤務 | 採買（含集合時間）、洗衣籃 |
| 9 | 公平性總覽 | 主要四項勤務的圖 ＋「看完整」按鈕 |

支援的講法：

- `今日勤務`、`今天的勤務`、`勤務`
- `明日勤務`、`昨日勤務`、`後天勤務`
- `8/5 勤務`、`8-5勤務`、`8月5日勤務`、`８／５ 勤務`（全形也認得）
- 直接 `@機器人` → 回今天的
- `勤務說明` → 顯示用法

群組裡其他閒聊一律不理會（沒有「勤務」或「班表」兩個字就不回話）。

---

## 步驟 1：先確認 App 的雲端同步是好的

機器人是去讀你上傳到 Firestore 的那份資料，所以這步一定要先做完。

1. 打開 App → **☁️ 雲端同步** 分頁，照上面的說明接好自己的 Firebase 專案。
2. 記下三個東西，等一下要填進 Vercel：
   - `firebaseConfig` 裡的 **apiKey**
   - `firebaseConfig` 裡的 **projectId**
   - 你設的**房間代碼**
3. 按一次上傳，確認畫面顯示「已同步」。

機器人用**匿名登入**去讀，跟 App 一樣，所以現有的 Firestore 規則
（`allow read, write: if request.auth != null`）就夠用，不需要另外下載服務帳戶金鑰。

---

## 步驟 2：建 LINE 官方帳號（Messaging API）

1. 到 [LINE Developers Console](https://developers.line.biz/console/) 用 LINE 帳號登入。
2. 建一個 **Provider**（隨便取名，例如「打飯班」）。
3. 在該 Provider 底下建 **Create a new channel → Messaging API**。
4. 建好之後記下兩個值：
   - **Basic settings** 分頁 → **Channel secret**
   - **Messaging API** 分頁 → **Channel access token (long-lived)**，按 Issue 產生
5. 一樣在 **Messaging API** 分頁把這些設好：
   - **Allow bot to join group chats** → **Enabled**（不開的話拉不進群組）
   - **Auto-reply messages** → **Disabled**（不關的話每句話都會收到罐頭回覆）
   - **Greeting messages** → 看你要不要，關掉比較清爽

---

## 步驟 3：部署到 Vercel

1. 到 [vercel.com](https://vercel.com/) 用 GitHub 登入。
2. **Add New → Project**，選這個 repo，Framework Preset 選 **Other**，其他都不用改，按 Deploy。
3. 部署完會給你一個網址，例如 `https://mess-duty-roster-for-army.vercel.app`。

### 填環境變數

進 **Settings → Environment Variables**，加這幾個（Production 環境）：

| 變數名 | 值 | 必填 |
|--------|-----|------|
| `LINE_CHANNEL_SECRET` | 步驟 2 的 Channel secret | ✅ |
| `LINE_CHANNEL_ACCESS_TOKEN` | 步驟 2 的 Channel access token | ✅ |
| `FIREBASE_API_KEY` | firebaseConfig 的 apiKey | ✅ |
| `FIREBASE_PROJECT_ID` | firebaseConfig 的 projectId | ✅ |
| `ROSTER_ROOM_CODE` | 雲端同步的房間代碼 | ✅ |
| `PUBLIC_BASE_URL` | 你的 Vercel 網址（結尾不要斜線） | 建議填 |
| `LIFF_ID` | 步驟 4 會拿到（做法 A 不用填） | 選填 |
| `LIFF_CHANNEL_ID` | **LINE Login channel** 的 Channel ID（做法 A 不用填） | 選填 |
| `STATE_READ_KEY` | 自己隨便打一串亂碼 | ✅ 建議填 |

填完要 **Deployments → 最新那筆 → Redeploy**，環境變數才會生效。

> `STATE_READ_KEY` 是給你在一般瀏覽器（不是從 LINE 點進去）直接開公平性頁面時用的備援金鑰。
> 從 LINE 點「看完整」進去的話走的是 LINE 的身分驗證，網址上不會帶任何秘密。

### 把 Webhook 接上

回 LINE Developers → **Messaging API** 分頁：

1. **Webhook URL** 填 `https://你的網址/api/webhook`
2. **Use webhook** 打開
3. 按 **Verify**，要顯示 **Success**

> **Webhook URL 一定要用正式網域**（`專案名.vercel.app`），不要用部署專屬網址
> （`專案名-a1b2c3d4-你的帳號.vercel.app` 那種帶亂碼的）——後者受 Vercel
> Deployment Protection 保護，LINE 會拿到 401。

---

## 步驟 4：公平性總覽的「看完整」

有兩種做法，**先看你要哪一種**。

> ⚠️ LINE 從 2024 年底起**不再允許把 LIFF 加到 Messaging API channel**。
> 在 Messaging API channel 的 LIFF 分頁只會看到
> 「You can no longer add LIFF apps to a Messaging API channel」。
> 要用 LIFF 就得**另外開一個 LINE Login channel**（做法 B）。

### 做法 A：不開 LIFF，直接開網頁（最省事）

按鈕會用 LINE 的內建瀏覽器開一般網頁，畫面內容完全一樣。

1. Vercel 的 `LIFF_ID` **留空不要填**
2. `STATE_READ_KEY` 填一串自己想的亂碼
3. Redeploy

程式偵測到沒有 `LIFF_ID` 就會自動改用 `https://你的網址/liff/?k=<STATE_READ_KEY>`。

代價：那串 key 會出現在按鈕的網址裡，群組成員長按複製就看得到。因為知道 key 的人就能看到整份名冊，所以**請當成密碼看待**，不要用好猜的字串。以你們的情況（本來就是同一個群組的人）通常沒差。

### 做法 B：正式的 LIFF（網址上不帶秘密）

多開一個 LINE Login channel，用 LINE 的身分驗證取代那串 key。

1. LINE Developers Console → **跟 Messaging API channel 同一個 Provider** → **Create a new channel** → 選 **LINE Login**
2. 建立時 **App types** 勾 **Web app**
3. 建好之後進這個新 channel 的 **LIFF** 分頁 → **Add**
   - **LIFF app name**：公平性總覽
   - **Size**：**Full**
   - **Endpoint URL**：`https://你的網址/liff/`
   - **Scopes**：勾 **profile** 和 **openid**（`openid` 一定要勾，不然拿不到身分驗證用的 token）
   - **Bot link feature**：Off 就好（機器人你已經直接邀進群組了）
4. 複製 **LIFF ID**（長得像 `2000000000-abcdefgh`）→ 填進 Vercel 的 `LIFF_ID`
5. **`LIFF_CHANNEL_ID` 填這個 LINE Login channel 的 Channel ID**（純數字，在它自己的 **Basic settings** 分頁）

   ⚠️ **不是** Messaging API channel 的 Channel ID。ID token 是 Login channel 簽發的，填錯會一直驗不過。
6. 這個 LINE Login channel 要 **Published**（不是 Developing）。停在 Developing 的話只有你自己開得起來，群組其他人會被擋。狀態在該 channel 首頁上方切換。
7. Redeploy

`STATE_READ_KEY` 建議還是留著，這樣你在電腦的一般瀏覽器也開得起來。

---

## 步驟 5：拉進群組

1. LINE Developers → **Messaging API** 分頁最下面有 **QR code**，用手機掃描加好友。
2. 在打飯班群組裡 **邀請** 這個官方帳號。
3. 打一句 `今日勤務` 試試。

---

## 平常怎麼用

- **改了名冊或排了新的一天** → 在 App 按確定紀錄，雲端同步會自動上傳，機器人下一次回答就是最新的（有 30 秒的快取）。
- **那天還沒按「確定紀錄」** → 機器人還是會回，但會先講一句「這是即時算出來的預覽」。因為排班是決定性的，之後按確定得到的會一模一樣。
- **問到 8/1～8/14 以外的日期** → 機器人會直接說不在勤務期間。

---

## 出問題的話

### 先做這一步：打開自我診斷

用瀏覽器（或 curl）打開 **`https://你的網址/api/webhook`**。這是 GET，不會觸發任何動作，只會回一份診斷，而且**只回布林值、不會吐出密鑰內容**。

```bash
curl -i https://你的網址/api/webhook
```

看到什麼決定接下來查哪裡：

| 你看到 | 代表 | 怎麼修 |
|--------|------|--------|
| 一份 JSON，`"ok": true` | 函式活著、環境變數齊全 | 問題在簽章，往下看「Verify 顯示 401」 |
| 一份 JSON，`"ok": false` | 函式活著，但**環境變數缺**（JSON 裡的「缺少的必填項」會列出來） | 補上，然後**一定要 Redeploy** |
| **Vercel 的登入頁 / `Authentication Required`** | **Deployment Protection 把請求擋掉了**，根本沒進到程式 | 見下面 |
| 404 | 網址打錯 | 確認結尾是 `/api/webhook` |

### Verify 顯示 401 Unauthorized

依照上面的診斷結果，401 只會是這三種之一：

**① Vercel Deployment Protection（最常見）**

Vercel 會擋掉未登入的請求並回 401，LINE 當然過不了。特別容易發生在**你把「部署專屬網址」貼進 LINE**（像 `專案名-a1b2c3d4-你的帳號.vercel.app` 這種帶一串亂碼的），那種網址一定受保護。

- 改用**正式網域**：Vercel 專案首頁 **Domains** 區塊最上面那個乾淨的網址（`專案名.vercel.app`）
- 如果正式網域也被擋：**Settings → Deployment Protection → Vercel Authentication** 關掉（或設成只保護 Preview）

同一件事也會讓公平性總覽那張圖load不出來，因為 LINE 的伺服器也要能匿名抓 `/api/fairness`。

**② `LINE_CHANNEL_SECRET` 沒設或設錯**

診斷 JSON 會直接告訴你有沒有設。最常見的錯是**把 Channel access token 貼到 Channel secret**——這是兩個不同的值：

- Channel secret：在 **Basic settings** 分頁，短短一串
- Channel access token：在 **Messaging API** 分頁，很長一串

改完之後**一定要 Redeploy**，Vercel 的環境變數不會套用到已經部署好的版本。

**③ 原始 body 讀不到**

程式已經用四種方式輪流去拿原始 body（平台有沒有先 parse 掉都接得住，`npm run test:signature` 驗過），正常不會遇到。真的遇到的話，Vercel 的 **Deployments → 該筆 → Functions** log 會寫：

```
簽章驗證失敗：有無 X-Line-Signature=true、body 來源=empty、body 長度=0
```

`body 長度=0` 就是這一種，把這行貼給我。反過來如果長度不是 0，那就是上面的 ②。

### 其他症狀

| 症狀 | 通常是 |
|------|--------|
| 機器人已讀不回 | `LINE_CHANNEL_ACCESS_TOKEN` 沒填／填錯；或 Auto-reply 沒關 |
| 回「讀不到班表資料」 | `FIREBASE_*` 或 `ROSTER_ROOM_CODE` 填錯，或 App 還沒上傳過 |
| 卡片出來但圖是破的 | `PUBLIC_BASE_URL` 沒填，或 Deployment Protection 擋住 `/api/fairness` |
| 「看完整」點進去說沒有權限 | `LIFF_CHANNEL_ID` 填成 Messaging API channel 的了（要填 LINE Login channel 的），或 LIFF 的 scope 沒勾 `openid`，或 Login channel 還停在 Developing |
| 群組裡拉不進機器人 | **Allow bot to join group chats** 沒開 |

Vercel 的 **Deployments → 該筆 → Functions** 可以看到每次呼叫的 log，錯誤訊息都會印在那裡。

---

## 本機先試跑（選用）

不想部署就先看看長怎樣的話：

```bash
# 用 repo 裡的種子名冊，把 9 張卡片的內容和公平性 PNG 印出來／存檔
node scripts/bot-demo.js 2026-08-04 ./out

# 驗證「不管平台有沒有先 parse body，簽章都算得對」
npm run test:signature

# 起一個模擬 Vercel 的本機伺服器（不連 Firestore）
MOCK_ROSTER=1 STATE_READ_KEY=devkey node scripts/dev-server.js 8123
#   http://127.0.0.1:8123/               App
#   http://127.0.0.1:8123/liff/?k=devkey LIFF 公平性總覽
#   http://127.0.0.1:8123/api/fairness   公平性 PNG
```

---

## 技術上的幾個選擇（之後要改的話先看這裡）

- **機器人跟網頁跑的是同一份排班程式碼**。`api/_lib/app.js` 把 `js/` 底下那些瀏覽器腳本
  直接丟進 Node 的 `vm` sandbox 執行，只補一個記憶體版的 `localStorage`。
  所以規則只要改 `js/`，兩邊會一起變，不會長歪。
- **公平性那張 PNG 是自己畫的**（`api/_lib/png.js`），純 JavaScript、零套件。
  圓圖只有「填色的扇形」一種圖形，自己畫比裝原生的 SVG 轉檔模組單純，
  而且不用為了四個中文詞在 repo 裡塞一份幾 MB 的字型——
  圖裡不放文字，項目名稱由卡片用同樣的 2×2 排版寫在圖下面。
- **卡片文字跟網頁「文字班表」同源**（`js/textFormat.js`），改一邊兩邊都會變。
- **簽章驗證用原始 body**。這是最容易壞的一點：平台預設會把 JSON body parse 掉，
  stream 也就被讀完了，這時候再去讀 `req` 只會拿到空字串，簽章一定對不起來。
  `api/_lib/line.js` 的 `readRawBody()` 依序試四條路（body 是字串／Buffer／
  `req.rawBody`／stream 還沒被讀），最後一條保險是把已經 parse 的物件重新序列化
  ——LINE 送的是 compact JSON、非 ASCII 不轉義、鍵是字串，所以還原得回同一份位元組。
  `npm run test:signature` 會把這四種情況都跑一遍。
- **`/api/webhook` 的 GET 是自我診斷**，回報環境變數有沒有設（只回布林值），
  用來分辨「函式沒活」「環境變數缺」「Vercel Deployment Protection 擋掉」三種 401。
