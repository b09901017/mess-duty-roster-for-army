/*
 * 把公平性圓圖畫成 PNG，純 JavaScript、零套件。
 *
 * 為什麼不用現成的繪圖套件：LINE 的 Flex Message 只吃 PNG/JPEG，而伺服器上要把 SVG
 * 轉成 PNG 就得裝原生模組，還得為了中文字塞一份幾 MB 的字型進 repo。
 * 圓圖本身其實只有「填色的扇形」這一種圖形，自己畫反而最單純，
 * 而且完全沒有原生相依，部署到哪都不會壞。
 *
 * 中文字則交給 LINE 自己排——圖片裡不放任何文字，項目名稱放在卡片上，
 * 這樣在手機上還比燒進圖片裡清楚。
 */
const zlib = require("zlib");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** @param {Uint8Array} rgb - width*height*3 的 RGB 資料 */
function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0（不過濾）
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = truecolor RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // 非交錯

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function createCanvas(width, height, bgHex) {
  const data = new Uint8Array(width * height * 3);
  const [r, g, b] = hexToRgb(bgHex);
  for (let i = 0; i < data.length; i += 3) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  return { width, height, data };
}

/**
 * 畫一張玫瑰圖（等角度、半徑代表次數）。
 *
 * 沒有現成的抗鋸齒可用，所以每個像素取 3×3 個樣本再平均，邊緣才不會有階梯感。
 * 只掃描圓形的外接方框，不用掃整張畫布。
 */
function drawRose(canvas, model, cx, cy, radius, trackHex) {
  const SAMPLES = 3;
  const track = hexToRgb(trackHex);
  const slices = model.slices.map((s) => ({
    start: s.startDeg,
    end: s.endDeg,
    r: radius * s.radiusRatio,
    color: hexToRgb(s.bucket.color),
  }));
  if (!slices.length) return;

  const x0 = Math.max(0, Math.floor(cx - radius) - 1);
  const x1 = Math.min(canvas.width - 1, Math.ceil(cx + radius) + 1);
  const y0 = Math.max(0, Math.floor(cy - radius) - 1);
  const y1 = Math.min(canvas.height - 1, Math.ceil(cy + radius) + 1);
  const step = 1 / SAMPLES;
  const totalSamples = SAMPLES * SAMPLES;

  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      let hits = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        const y = py + (sy + 0.5) * step;
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = px + (sx + 0.5) * step;
          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > radius) continue;

          // 0 度在 12 點鐘方向，順時針遞增，跟 fairnessChart 的角度一致
          let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
          if (deg < 0) deg += 360;

          // 扇形數量不多，直接線性找；找到就看是落在值的部分還是空的底色
          for (let i = 0; i < slices.length; i++) {
            const s = slices[i];
            if (deg < s.start || deg >= s.end) continue;
            const color = dist <= s.r ? s.color : track;
            sumR += color[0];
            sumG += color[1];
            sumB += color[2];
            hits++;
            break;
          }
        }
      }

      if (!hits) continue;
      const idx = (py * canvas.width + px) * 3;
      // 沒被扇形蓋到的樣本保留原本的背景色
      const coverage = hits / totalSamples;
      canvas.data[idx] = Math.round((sumR / hits) * coverage + canvas.data[idx] * (1 - coverage));
      canvas.data[idx + 1] = Math.round((sumG / hits) * coverage + canvas.data[idx + 1] * (1 - coverage));
      canvas.data[idx + 2] = Math.round((sumB / hits) * coverage + canvas.data[idx + 2] * (1 - coverage));
    }
  }
}

module.exports = { encodePng, createCanvas, drawRose, hexToRgb };
