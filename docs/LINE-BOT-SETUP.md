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
| `LIFF_ID` | 步驟 4 會拿到 | 步驟 4 再補 |
| `LIFF_CHANNEL_ID` | 步驟 4 會拿到 | 步驟 4 再補 |
| `STATE_READ_KEY` | 自己隨便打一串亂碼 | 建議填 |

填完要 **Deployments → 最新那筆 → Redeploy**，環境變數才會生效。

> `STATE_READ_KEY` 是給你在一般瀏覽器（不是從 LINE 點進去）直接開公平性頁面時用的備援金鑰。
> 從 LINE 點「看完整」進去的話走的是 LINE 的身分驗證，網址上不會帶任何秘密。

### 把 Webhook 接上

回 LINE Developers → **Messaging API** 分頁：

1. **Webhook URL** 填 `https://你的網址/api/webhook`
2. **Use webhook** 打開
3. 按 **Verify**，要顯示 **Success**

---

## 步驟 4：建 LIFF（公平性總覽的「看完整」）

1. LINE Developers → 剛剛那個 channel → **LIFF** 分頁 → **Add**
2. 填：
   - **LIFF app name**：公平性總覽
   - **Size**：**Full**
   - **Endpoint URL**：`https://你的網址/liff/`
   - **Scopes**：勾 **profile** 和 **openid**（`openid` 一定要勾，不然拿不到身分驗證用的 token）
   - **Bot link feature**：Off 就好
3. 建好之後複製 **LIFF ID**（長得像 `2000000000-abcdefgh`）
4. 回 Vercel 把 `LIFF_ID` 填成這串
5. `LIFF_CHANNEL_ID` 填 **Basic settings** 分頁的 **Channel ID**（純數字）
6. Redeploy

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

| 症狀 | 通常是 |
|------|--------|
| Verify 按下去失敗 | Webhook URL 打錯，或環境變數填完沒有 Redeploy |
| 機器人已讀不回 | `LINE_CHANNEL_ACCESS_TOKEN` 沒填／填錯；或 Auto-reply 沒關 |
| 回「讀不到班表資料」 | `FIREBASE_*` 或 `ROSTER_ROOM_CODE` 填錯，或 App 還沒上傳過 |
| 卡片出來但圖是破的 | `PUBLIC_BASE_URL` 沒填，導致圖片網址推錯 |
| 「看完整」點進去說沒有權限 | `LIFF_CHANNEL_ID` 沒填，或 LIFF 的 scope 沒勾 `openid` |
| 群組裡拉不進機器人 | **Allow bot to join group chats** 沒開 |

Vercel 的 **Deployments → 該筆 → Functions** 可以看到每次呼叫的 log，錯誤訊息都會印在那裡。

---

## 本機先試跑（選用）

不想部署就先看看長怎樣的話：

```bash
# 用 repo 裡的種子名冊，把 9 張卡片的內容和公平性 PNG 印出來／存檔
node scripts/bot-demo.js 2026-08-04 ./out

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
- **簽章驗證用原始 body**。`api/webhook.js` 結尾的 `config.api.bodyParser = false`
  就是為了這個，拿掉的話 `X-Line-Signature` 會驗不過。
