// 原生代码绘制回响同心环图标，无外部图像依赖。
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
const crc32 = bytes => {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const content = Buffer.concat([Buffer.from(type), data]); const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length); content.copy(out, 4); out.writeUInt32BE(crc32(content), out.length - 4); return out;
};
export function buildIcon(cache) {
  const size = 1024, rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * (size * 4 + 1) + 1 + x * 4;
    const dx = Math.max(Math.abs(x - 511.5) - 278, 0), dy = Math.max(Math.abs(y - 511.5) - 278, 0);
    const alpha = Math.max(0, Math.min(1, 182 - Math.hypot(dx, dy)));
    const radius = Math.hypot(x - 511.5, y - 511.5);
    const ring = Math.min(Math.abs(radius - 260), Math.abs(radius - 143));
    const white = Math.max(0, Math.min(1, 24 - ring));
    const background = [51, 79, 62];
    for (let c = 0; c < 3; c++) rows[i + c] = Math.round(background[c] * (1 - white) + [238, 240, 216][c] * white);
    rows[i + 3] = Math.round(alpha * 255);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const png = path.join(cache, 'relay-icon.png');
  fs.writeFileSync(png, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
  const set = path.join(cache, 'Relay.iconset'); fs.mkdirSync(set, { recursive: true });
  for (const n of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) execFileSync('sips', ['-z', String(n * scale), String(n * scale), png, '--out', path.join(set, `icon_${n}x${n}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'ignore' });
  const icon = path.join(cache, 'Relay.icns'); execFileSync('iconutil', ['-c', 'icns', set, '-o', icon]); return icon;
}
