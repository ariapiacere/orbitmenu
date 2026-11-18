// Records what the menu looks like frame by frame, straight from the screen,
// and checks for a "stale frame": the previous menu flashing at its old
// position when the next one opens somewhere else.
//
//   npm run frames [-- <output folder>]
//
// Writes open.png (a strip of consecutive frames of a menu opening at the
// screen centre) and stale.png (the screen centre while a second menu opens at
// the pointer, after the centre menu was closed — it should stay empty).
// Like `npm run latency`, a test copy of the app runs with a throw-away
// profile and harmless menus, triggered with F24/F23 through SendInput.
import koffi from 'koffi';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = resolve(process.argv[2] ?? join(root, 'out', 'frames'));
mkdirSync(outDir, { recursive: true });

const user32 = koffi.load('user32.dll');
const gdi32 = koffi.load('gdi32.dll');
const GetDC = user32.func('intptr_t __stdcall GetDC(intptr_t hwnd)');
const CreateCompatibleDC = gdi32.func('intptr_t __stdcall CreateCompatibleDC(intptr_t hdc)');
const CreateCompatibleBitmap = gdi32.func('intptr_t __stdcall CreateCompatibleBitmap(intptr_t hdc, int w, int h)');
const SelectObject = gdi32.func('intptr_t __stdcall SelectObject(intptr_t hdc, intptr_t obj)');
const BitBlt = gdi32.func('int __stdcall BitBlt(intptr_t dst, int x, int y, int w, int h, intptr_t src, int sx, int sy, uint32_t rop)');
const GetDIBits = gdi32.func('int __stdcall GetDIBits(intptr_t hdc, intptr_t bmp, uint32_t start, uint32_t lines, void *bits, void *info, uint32_t usage)');
const SystemParametersInfoW = user32.func('int __stdcall SystemParametersInfoW(uint32_t action, uint32_t param, void *rect, uint32_t flags)');
const SetProcessDPIAware = user32.func('int __stdcall SetProcessDPIAware()');
const FindWindowW = user32.func('intptr_t __stdcall FindWindowW(str16 className, str16 title)');
const GetCursorPos = user32.func('int __stdcall GetCursorPos(void *point)');
const SendInput = user32.func('uint32_t __stdcall SendInput(uint32_t count, void *inputs, int size)');
SetProcessDPIAware();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tapKey(vk) {
  const SIZE = 40;
  const buf = Buffer.alloc(SIZE * 2);
  for (const [i, flags] of [0, 2].entries()) {
    buf.writeUInt32LE(1, i * SIZE);
    buf.writeUInt16LE(vk, i * SIZE + 8);
    buf.writeUInt32LE(flags, i * SIZE + 12);
  }
  SendInput(2, buf, SIZE);
}
const VK_F23 = 0x86;
const VK_F24 = 0x87;

const rect = Buffer.alloc(16);
SystemParametersInfoW(0x0030, 0, rect, 0);
const work = [0, 4, 8, 12].map((o) => rect.readInt32LE(o));
const cx = Math.round((work[0] + work[2]) / 2);
const cy = Math.round((work[1] + work[3]) / 2);
const SIZE = 420;
const screenDc = GetDC(0);
const memDc = CreateCompatibleDC(screenDc);
const bitmap = CreateCompatibleBitmap(screenDc, SIZE, SIZE);
SelectObject(memDc, bitmap);
const info = Buffer.alloc(40);
info.writeUInt32LE(40, 0);
info.writeInt32LE(SIZE, 4);
info.writeInt32LE(-SIZE, 8); // top-down
info.writeUInt16LE(1, 12);
info.writeUInt16LE(32, 14);

/** Grabs the SIZE×SIZE square centred on (x, y) as BGRA. */
function grab(x, y) {
  BitBlt(memDc, 0, 0, SIZE, SIZE, screenDc, x - SIZE / 2, y - SIZE / 2, 0x00cc0020);
  const bits = Buffer.alloc(SIZE * SIZE * 4);
  GetDIBits(memDc, bitmap, 0, SIZE, bits, info, 0);
  return { t: Date.now(), bits };
}

const diffCount = (a, b) => {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++;
  }
  return n;
};

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(8 + body.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 4 + body.length);
  return out;
};

/** Writes frames side by side (`perRow` per row; half size unless `full`) as one PNG. */
function writeStrip(file, frames, perRow = 6, full = false) {
  const step = full ? 1 : 2;
  const cell = SIZE / step;
  const rows = Math.ceil(frames.length / perRow);
  const w = perRow * (cell + 4);
  const h = rows * (cell + 4);
  const raw = Buffer.alloc(h * (w * 3 + 1), 40);
  frames.forEach((f, i) => {
    const ox = (i % perRow) * (cell + 4) + 2;
    const oy = Math.floor(i / perRow) * (cell + 4) + 2;
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        // Average step×step source pixels.
        let r = 0, g = 0, b = 0;
        for (let dy = 0; dy < step; dy++) {
          for (let dx = 0; dx < step; dx++) {
            const s = ((y * step + dy) * SIZE + x * step + dx) * 4;
            b += f.bits[s]; g += f.bits[s + 1]; r += f.bits[s + 2];
          }
        }
        const n = step * step;
        const d = (oy + y) * (w * 3 + 1) + 1 + (ox + x) * 3;
        raw[d] = r / n; raw[d + 1] = g / n; raw[d + 2] = b / n;
      }
    }
  });
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const profile = mkdtempSync(join(tmpdir(), 'orbit-frames-'));
const icons = ['Rocket', 'Globe', 'Folder', 'Music', 'Keyboard', 'Star', 'Search', 'Settings'];
const items = (prefix) => icons.map((name, i) => ({ id: `${prefix}${i}`, name: `${prefix.toUpperCase()} ${i + 1}`, description: '', icon: { kind: 'lucide', name }, hint: '', fixedAngle: null, action: { type: 'none' }, children: [] }));
const menu = (id, shortcut, openAt) => ({ id, name: id, icon: { kind: 'lucide', name: 'Orbit' }, shortcut, enabled: true, openAt, items: items(id[0]) });
writeFileSync(join(profile, 'menus.json'), JSON.stringify({ version: 1, menus: [menu('centre', 'F24', 'screen-center'), menu('pointer', 'F23', 'cursor')] }));
const appearance = process.env.ORBIT_FRAMES_ANIM ? { appearance: { animationMs: Number(process.env.ORBIT_FRAMES_ANIM) } } : {};
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ version: 1, ...appearance, navigation: { warpPointer: false, closeOnBlur: false }, general: { firstRunDone: true, launchAtLogin: false, autoCheckUpdates: false } }));

const child = spawn(require('electron'), ['.'], { cwd: root, stdio: 'ignore', env: { ...process.env, ORBIT_USER_DATA: profile } });
for (let i = 0; i < 100 && !FindWindowW(null, 'OrbitMenu overlay'); i++) await sleep(100);
await sleep(5000);

// 1. The opening animation at the screen centre.
const before = grab(cx, cy);
const t0 = Date.now();
tapKey(VK_F24);
const open = [];
while (Date.now() - t0 < 330) open.push(grab(cx, cy));
writeStrip(join(outDir, 'open.png'), [before, ...open]);
// Full-size frames from the first visible one, for a close look at the motion.
const firstVisible = open.findIndex((f) => diffCount(f.bits, before.bits) > 400);
if (firstVisible >= 0) writeStrip(join(outDir, 'open-detail.png'), open.slice(firstVisible, firstVisible + 6), 3, true);
console.log(`open.png: frame 0 = before the key press, then at ${open.map((f) => f.t - t0).join(', ')} ms`);
console.log(`  pixels changed vs. the frame before: ${open.map((f, i) => diffCount(f.bits, (open[i - 1] ?? before).bits)).join(', ')}`);
await sleep(400);
tapKey(VK_F24);
await sleep(900);

// 2. Stale frame: open a menu at the pointer and watch the centre, where the previous one was.
const point = Buffer.alloc(8);
GetCursorPos(point);
const px = point.readInt32LE(0);
const py = point.readInt32LE(4);
const far = Math.hypot(px - cx, py - cy);
const empty = grab(cx, cy);
const t1 = Date.now();
tapKey(VK_F23);
const stale = [];
while (Date.now() - t1 < 260) stale.push(grab(cx, cy));
const changed = stale.map((f) => diffCount(f.bits, empty.bits));
writeStrip(join(outDir, 'stale.png'), [empty, ...stale]);
console.log(`stale.png: pointer at ${px},${py} (${Math.round(far)} px from the centre${far < SIZE ? ' — TOO CLOSE, the new menu overlaps the watched area' : ''})`);
console.log(`  pixels at the centre differing from "empty" at ${stale.map((f) => f.t - t1).join(', ')} ms: ${changed.join(', ')}`);
console.log(far >= SIZE ? (Math.max(...changed) > 400 ? '  => STALE FRAME: the old menu flashed at its previous position.' : '  => no stale frame.') : '  => inconclusive.');
await sleep(300);
tapKey(VK_F23);
await sleep(600);
child.kill();
await sleep(300);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // Chromium may still hold files for a moment.
}
