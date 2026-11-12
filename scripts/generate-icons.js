#!/usr/bin/env node
/**
 * Generates the PWA icon set with a tiny dependency-free PNG encoder.
 *
 *   pnpm icons
 *
 * The mark is an open book on a deep indigo rounded square with an amber
 * accent. Outputs: apps/web/public/icons/*.png
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "apps", "web", "public", "icons");
fs.mkdirSync(outDir, { recursive: true });

/* ------------------------------------------------------------------ PNG --- */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---------------------------------------------------------------- shapes --- */
const clamp01 = (value) => Math.min(1, Math.max(0, value));
const mix = (a, b, t) => a + (b - a) * t;

function insideRoundedSquare(u, v, radius) {
  const cx = Math.min(u, 1 - u);
  const cy = Math.min(v, 1 - v);
  if (cx >= radius || cy >= radius) return true;
  const dx = radius - cx;
  const dy = radius - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function insidePolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

const LEFT_PAGE = [
  [0.275, 0.385],
  [0.478, 0.345],
  [0.478, 0.655],
  [0.275, 0.615]
];
const RIGHT_PAGE = [
  [0.522, 0.345],
  [0.725, 0.385],
  [0.725, 0.615],
  [0.522, 0.655]
];

/** Returns [r,g,b,a] for a normalised point. */
function sample(u, v, { maskable }) {
  const radius = maskable ? 0 : 0.225;
  if (!insideRoundedSquare(u, v, radius)) return [0, 0, 0, 0];

  // Background gradient plus a soft top-right highlight.
  const t = clamp01((u * 0.45 + v) / 1.45);
  let r = mix(0x14, 0x33, t);
  let g = mix(0x1d, 0x4a, t);
  let b = mix(0x42, 0xa3, t);
  const glow = Math.max(0, 1 - Math.hypot(u - 0.82, v - 0.16) / 0.55);
  r += 26 * glow;
  g += 34 * glow;
  b += 60 * glow;

  const pad = maskable ? 0.16 : 0;
  const gu = (u - pad) / (1 - pad * 2);
  const gv = (v - pad) / (1 - pad * 2);
  const inGlyph = gu >= 0 && gu <= 1 && gv >= 0 && gv <= 1;

  if (inGlyph) {
    const left = insidePolygon(gu, gv, LEFT_PAGE);
    const right = insidePolygon(gu, gv, RIGHT_PAGE);
    if (left || right) {
      const shade = right ? 0.93 : 1;
      return [Math.round(255 * shade), Math.round(255 * shade), Math.round(255 * shade), 255];
    }
    // Amber bookmark above the spine.
    if (Math.hypot(gu - 0.5, gv - 0.275) < 0.042) return [0xf2, 0xb5, 0x44, 255];
  }

  return [Math.round(Math.min(255, r)), Math.round(Math.min(255, g)), Math.round(Math.min(255, b)), 255];
}

function render(size, options) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 3; // 3x3 supersampling for smooth edges
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const [cr, cg, cb, ca] = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, options);
          const alpha = ca / 255;
          r += cr * alpha;
          g += cg * alpha;
          b += cb * alpha;
          a += ca;
        }
      }
      const count = SS * SS;
      const alphaAverage = a / count;
      const unpremultiply = alphaAverage > 0 ? 255 / alphaAverage / count : 0;
      const offset = (y * size + x) * 4;
      rgba[offset] = Math.round(r * unpremultiply);
      rgba[offset + 1] = Math.round(g * unpremultiply);
      rgba[offset + 2] = Math.round(b * unpremultiply);
      rgba[offset + 3] = Math.round(alphaAverage);
    }
  }
  return encodePng(size, size, rgba);
}

const targets = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180, maskable: true }
];

for (const target of targets) {
  const png = render(target.size, { maskable: target.maskable });
  fs.writeFileSync(path.join(outDir, target.file), png);
  console.log(`[icons] ${target.file} (${target.size}x${target.size}, ${(png.length / 1024).toFixed(1)} kB)`);
}
console.log("[icons] done");
