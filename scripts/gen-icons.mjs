// Generates the extension icons as PNGs with no dependencies.
// Motif: a near-black rounded square with a white ring and a single hand pointing to 12 — a quiet timer.
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../public/icons');
const SIZES = [16, 32, 48, 128];
const SUPERSAMPLE = 4;

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Returns [r,g,b,a] for a point in unit space (0..1), before anti-aliasing. */
function sample(u, v) {
  const cx = u - 0.5;
  const cy = v - 0.5;
  // Rounded square background.
  const radius = 0.22;
  const half = 0.5;
  const qx = Math.max(Math.abs(cx) - (half - radius), 0);
  const qy = Math.max(Math.abs(cy) - (half - radius), 0);
  const insideSquare = Math.hypot(qx, qy) <= radius;
  if (!insideSquare) return [0, 0, 0, 0];

  const dist = Math.hypot(cx, cy);
  const ringOuter = 0.31;
  const ringInner = 0.24;
  const inRing = dist <= ringOuter && dist >= ringInner;
  const handWidth = 0.035;
  const inHand = Math.abs(cx) <= handWidth && cy <= 0.02 && cy >= -ringInner - 0.01;
  const inDot = dist <= 0.055;
  if (inRing || inHand || inDot) return [255, 255, 255, 255];
  return [10, 10, 10, 255];
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const u = (x + (sx + 0.5) / SUPERSAMPLE) / size;
          const v = (y + (sy + 0.5) / SUPERSAMPLE) / size;
          const [pr, pg, pb, pa] = sample(u, v);
          r += pr * pa;
          g += pg * pa;
          b += pb * pa;
          a += pa;
        }
      }
      const i = (y * size + x) * 4;
      if (a > 0) {
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(g / a);
        rgba[i + 2] = Math.round(b / a);
      }
      rgba[i + 3] = Math.round(a / (SUPERSAMPLE * SUPERSAMPLE));
    }
  }
  return encodePng(size, size, rgba);
}

fs.mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, render(size));
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
