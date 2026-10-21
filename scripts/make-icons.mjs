// Generates the OrbitMenu logo (a hub with satellites on an orbit ring) as
// PNG and multi-size ICO files without any image libraries: shapes are
// evaluated analytically and supersampled for anti-aliasing.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icons');
mkdirSync(out, { recursive: true });

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const C = {
  discTop: hex('#2c2470'),
  discEdge: hex('#0f0c27'),
  violet: hex('#a493ff'),
  cyan: hex('#5ee3f5'),
  hub: hex('#f4f2ff'),
  satellite: hex('#c3b8ff'),
  coral: hex('#ff9db8'),
};

const RING_R = 0.29;
const sat = (deg, r) => ({ x: RING_R * Math.sin((deg * Math.PI) / 180), y: -RING_R * Math.cos((deg * Math.PI) / 180), r });
const MAIN = sat(48, 0.082);
const SMALL = [
  { ...sat(172, 0.046), color: C.cyan },
  { ...sat(282, 0.038), color: C.coral },
];

/** Colour of the logo at (u, v) in [-0.5, 0.5]²; returns [r, g, b, a]. */
function shade(u, v, { background }) {
  const r = Math.hypot(u, v);
  let color = null;
  if (background && r < 0.48) color = [...mix(C.discTop, C.discEdge, Math.min(1, Math.hypot(u, v + 0.18) / 0.62)), 255];
  // Orbit ring with a violet → cyan sweep, interrupted around the main satellite.
  const nearMain = Math.hypot(u - MAIN.x, v - MAIN.y) < MAIN.r + 0.04;
  if (Math.abs(r - RING_R) < 0.03 && !nearMain) {
    const t = (Math.atan2(u, -v) + Math.PI) / (2 * Math.PI);
    color = [...mix(C.violet, C.cyan, t), 255];
  }
  for (const s of SMALL) if (Math.hypot(u - s.x, v - s.y) < s.r) color = [...s.color, 255];
  if (Math.hypot(u - MAIN.x, v - MAIN.y) < MAIN.r) {
    const hl = Math.hypot(u - MAIN.x + 0.025, v - MAIN.y + 0.025) < 0.03;
    color = [...(hl ? C.hub : C.satellite), 255];
  }
  if (r < 0.105) color = [...C.hub, 255];
  return color ?? [0, 0, 0, 0];
}

function render(size, opts) {
  const SS = size <= 32 ? 6 : 4;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size - 0.5;
          const v = (y + (sy + 0.5) / SS) / size - 0.5;
          const [cr, cg, cb, ca] = shade(u, v, opts);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const i = (y * size + x) * 4;
      const n = SS * SS;
      px[i] = a ? Math.round(r / a) : 0;
      px[i + 1] = a ? Math.round(g / a) : 0;
      px[i + 2] = a ? Math.round(b / a) : 0;
      px[i + 3] = Math.round(a / n);
    }
  }
  return px;
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    header[e] = size >= 256 ? 0 : size;
    header[e + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

const make = (size, opts) => ({ size, data: png(size, render(size, opts)) });
const app = [16, 24, 32, 48, 64, 128, 256].map((s) => make(s, { background: true }));
writeFileSync(resolve(out, 'orbitmenu.ico'), ico(app));
writeFileSync(resolve(out, 'orbitmenu.png'), app.at(-1).data);
writeFileSync(resolve(out, 'orbitmenu-512.png'), make(512, { background: true }).data);
const tray = [16, 20, 24, 32, 40, 48, 64].map((s) => make(s, { background: true }));
writeFileSync(resolve(out, 'tray.ico'), ico(tray));
console.log(`Icons written to ${out}`);
