#!/usr/bin/env node
/*
 * 驗證「不管 Vercel 有沒有先把 body parse 掉，都能算出正確的 LINE 簽章」。
 *
 * 這是整個 webhook 最容易壞的一點：平台預設會 parse JSON body，stream 就被讀完了，
 * 這時候再去讀 req 只會拿到空字串，簽章一定對不起來，LINE 後台按 Verify 就是 401。
 *
 *   node scripts/test-signature.js
 */
const crypto = require('crypto');
const { Readable } = require('stream');
const { readRawBody, verifySignature } = require('../api/_lib/line');

const SECRET = 'test-channel-secret';
// 一份很像真的 LINE webhook payload，含中文與 emoji
const BODY = JSON.stringify({
  destination: 'U1234567890abcdef',
  events: [{
    type: 'message', mode: 'active', timestamp: 1754280000000,
    source: { type: 'group', groupId: 'Cabcdef', userId: 'Uabcdef' },
    webhookEventId: '01ABC', deliveryContext: { isRedelivery: false },
    replyToken: 'rtoken', message: { type: 'text', id: '1', text: '今日勤務 🍚 一飯5菜' },
  }],
});
const SIG = crypto.createHmac('sha256', SECRET).update(BODY).digest('base64');

function makeReq(kind) {
  const req = Readable.from([Buffer.from(BODY, 'utf8')]);
  req.headers = { 'x-line-signature': SIG, 'content-type': 'application/json' };
  req.method = 'POST';
  if (kind === 'parsed') {           // Vercel 預設：body 被 parse 掉、stream 也讀完了
    req.body = JSON.parse(BODY);
    req.resume(); return new Promise(r => req.on('end', () => r(req)));
  }
  if (kind === 'buffer') req.body = Buffer.from(BODY, 'utf8');
  if (kind === 'string') req.body = BODY;
  return Promise.resolve(req);
}

let failed = 0;
(async () => {
  for (const kind of ['raw-stream', 'parsed', 'buffer', 'string']) {
    const req = await makeReq(kind === 'raw-stream' ? null : kind);
    const { raw, source } = await readRawBody(req);
    const ok = verifySignature(raw, SIG, SECRET);
    if (!ok) failed++;
    console.log(`${kind.padEnd(11)} → source=${source.padEnd(14)} len=${String(raw.length).padStart(4)}  簽章${ok ? '✅ 通過' : '❌ 失敗'}`);
  }
  // 錯的 secret 一定要擋下來
  const req = await makeReq('string');
  const { raw } = await readRawBody(req);
  console.log('錯的 secret  →', verifySignature(raw, SIG, 'wrong-secret') ? '❌ 竟然通過了' : '✅ 正確擋下');
  if (verifySignature(raw, SIG, 'wrong-secret')) failed++;
  console.log('沒有簽章    →', verifySignature(raw, undefined, SECRET) ? '❌ 竟然通過了' : '✅ 正確擋下');
  if (verifySignature(raw, undefined, SECRET)) failed++;
  process.exit(failed ? 1 : 0);
})();
