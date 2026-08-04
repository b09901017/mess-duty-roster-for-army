/*
 * 看懂群組裡的訊息是不是在問勤務。
 *
 * 機器人在群組裡收得到所有人的每一句話，所以預設是「不理會」，
 * 只有明確出現「勤務」「班表」或 @ 到機器人時才回話，免得洗版。
 */

const FULLWIDTH_DIGITS = "０１２３４５６７８９";

/** 全形數字、全形斜線、各種破折號都先正規化，使用者怎麼打都認得 */
function normalize(raw) {
  return String(raw || "")
    .replace(/[０-９]/g, (ch) => String(FULLWIDTH_DIGITS.indexOf(ch)))
    .replace(/[／∕]/g, "/")
    .replace(/[—–－ー]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** 台灣時間的今天（UTC+8，沒有日光節約，直接加 8 小時就準） */
function todayInTaipei(now) {
  const t = (now instanceof Date ? now : new Date()).getTime();
  return new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 從訊息裡找出日期。支援 8/5、08/05、8-5、8月5日；沒寫年份就用勤務期間所在的那一年。
 */
function findExplicitDate(text, periodStart) {
  const year = periodStart.slice(0, 4);
  const match = text.match(/(\d{1,2})\s*[/\-月]\s*(\d{1,2})/);
  if (!match) return null;
  const month = String(Number(match[1])).padStart(2, "0");
  const day = String(Number(match[2])).padStart(2, "0");
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
  return `${year}-${month}-${day}`;
}

/**
 * @returns {null | {kind:"schedule", date:string} | {kind:"help"}}
 *   null 代表這句話不用理會。
 */
function parseCommand(rawText, options) {
  const opts = options || {};
  const text = normalize(rawText);
  if (!text) return null;

  // 「打飯班」在這個群組本來就常出現，不能當觸發字，不然會一直洗版
  const mentionedBot = Boolean(opts.mentionedBot);
  const asksSchedule = /勤務|班表/.test(text);
  if (!asksSchedule && !mentionedBot) return null;

  if (/說明|help|怎麼用|指令/i.test(text)) return { kind: "help" };

  const today = todayInTaipei(opts.now);
  const periodStart = opts.periodStart || today;

  const explicit = findExplicitDate(text, periodStart);
  if (explicit) return { kind: "schedule", date: explicit };

  if (/明天|明日/.test(text)) return { kind: "schedule", date: shiftDate(today, 1) };
  if (/昨天|昨日/.test(text)) return { kind: "schedule", date: shiftDate(today, -1) };
  if (/後天/.test(text)) return { kind: "schedule", date: shiftDate(today, 2) };

  // 「今日勤務」「今天的勤務」「勤務」或單純 @機器人 → 今天
  return { kind: "schedule", date: today };
}

module.exports = { parseCommand, normalize, todayInTaipei, shiftDate, findExplicitDate };
