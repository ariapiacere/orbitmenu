// Measures real key-to-pixels latency: how long after a shortcut press the
// pixels on the display actually change. The app's own timings (logged as
// "Menu opened in …") stop at "frame requested"; this probe reads the screen,
// so it includes Chromium's compositor, the GPU and the Windows compositor.
// It also checks the overlay's safety properties between menus (off-screen,
// click-through, not holding focus) and that focus returns afterwards.
//
//   npm run latency                        10 opens 0.5 s apart, real hotkey
//   npm run latency -- 1500,500,20000      idle time (ms) before each open
//   npm run latency -- 10 --timer          let the app open itself (no key press)
//
// A test copy of the app runs with a throw-away profile and a menu whose items
// do nothing, opening at the screen centre. The default mode presses F24 — a
// key that exists on no keyboard and that no application uses — through
// SendInput, so the full path including Windows' hotkey dispatch is timed and
// the user's typing is not disturbed. Needs an unlocked, visible desktop.
import koffi from 'koffi';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const timerMode = args.includes('--timer');
const spec = args.find((a) => !a.startsWith('--')) ?? '10';
const gaps = spec.includes(',') ? spec.split(',').map(Number) : new Array(Number(spec) || 10).fill(500);
const HOLD_MS = 700;
// ORBIT_LATENCY_SHOTS=<folder>: save a screenshot with the first menu open and one after it closed.
const shotDir = process.env.ORBIT_LATENCY_SHOTS;
function screenshot(file) {
  const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size); $bmp.Save('${file.replace(/'/g, "''")}')`;
  spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
}

const user32 = koffi.load('user32.dll');
const gdi32 = koffi.load('gdi32.dll');
const GetDC = user32.func('intptr_t __stdcall GetDC(intptr_t hwnd)');
const GetPixel = gdi32.func('uint32_t __stdcall GetPixel(intptr_t hdc, int x, int y)');
const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int index)');
const SystemParametersInfoW = user32.func('int __stdcall SystemParametersInfoW(uint32_t action, uint32_t param, void *rect, uint32_t flags)');
const SetProcessDPIAware = user32.func('int __stdcall SetProcessDPIAware()');
const GetDpiForSystem = user32.func('uint32_t __stdcall GetDpiForSystem()');
const FindWindowW = user32.func('intptr_t __stdcall FindWindowW(str16 className, str16 title)');
const GetWindowRect = user32.func('int __stdcall GetWindowRect(intptr_t hwnd, void *rect)');
const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)');
const IsWindowVisible = user32.func('int __stdcall IsWindowVisible(intptr_t hwnd)');
const GetForegroundWindow = user32.func('intptr_t __stdcall GetForegroundWindow()');
const SendInput = user32.func('uint32_t __stdcall SendInput(uint32_t count, void *inputs, int size)');
SetProcessDPIAware();
const virtualScreen = { x: GetSystemMetrics(76), y: GetSystemMetrics(77), w: GetSystemMetrics(78), h: GetSystemMetrics(79) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Taps a key through SendInput (64-bit INPUT layout). */
function tapKey(vk) {
  const SIZE = 40;
  const buf = Buffer.alloc(SIZE * 2);
  for (const [i, flags] of [0, 2].entries()) {
    buf.writeUInt32LE(1, i * SIZE); // INPUT_KEYBOARD
    buf.writeUInt16LE(vk, i * SIZE + 8);
    buf.writeUInt32LE(flags, i * SIZE + 12); // 2 = KEYEVENTF_KEYUP
  }
  return SendInput(2, buf, SIZE) === 2;
}
const VK_F24 = 0x87;

/** Where the overlay window is right now and whether it could take mouse input. */
function overlayState() {
  const hwnd = FindWindowW(null, 'OrbitMenu overlay');
  if (!hwnd) return null;
  const r = Buffer.alloc(16);
  GetWindowRect(hwnd, r);
  const [left, top, right, bottom] = [0, 4, 8, 12].map((o) => r.readInt32LE(o));
  const onScreen = right > virtualScreen.x && left < virtualScreen.x + virtualScreen.w && bottom > virtualScreen.y && top < virtualScreen.y + virtualScreen.h;
  const exStyle = Number(GetWindowLongPtrW(hwnd, -20));
  return {
    t: Date.now(),
    onScreen,
    clickThrough: (exStyle & 0x20) !== 0, // WS_EX_TRANSPARENT
    toolWindow: (exStyle & 0x80) !== 0, // WS_EX_TOOLWINDOW: not in the taskbar or Alt+Tab
    shown: IsWindowVisible(hwnd) !== 0,
    focused: GetForegroundWindow() === hwnd,
  };
}

// Centre of the primary work area in physical pixels: where the bench menu's hub is drawn.
const rect = Buffer.alloc(16);
SystemParametersInfoW(0x0030 /* SPI_GETWORKAREA */, 0, rect, 0);
const work = [0, 4, 8, 12].map((o) => rect.readInt32LE(o));
const scale = GetDpiForSystem() / 96;
const cx = Math.round((work[0] + work[2]) / 2);
const cy = Math.round((work[1] + work[3]) / 2);
// A point on the hub's plain background (inside its 50 px radius, away from icon and text).
// One point only: each GetPixel call waits for the desktop compositor, about one frame.
const px = cx - Math.round(32 * scale);
const py = cy - Math.round(18 * scale);
const hdc = GetDC(0);
const sample = () => GetPixel(hdc, px, py);
const differs = (a, b) =>
  Math.abs((a & 255) - (b & 255)) + Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) + Math.abs(((a >> 16) & 255) - ((b >> 16) & 255)) > 18;

// A profile with a menu that does nothing, so nothing can be triggered by accident.
const profile = mkdtempSync(join(tmpdir(), 'orbit-latency-'));
const icons = ['Rocket', 'Globe', 'Folder', 'Music', 'Keyboard', 'Star', 'Search', 'Settings'];
const item = (i) => ({ id: `b${i}`, name: `Item ${i + 1}`, description: '', icon: { kind: 'lucide', name: icons[i] }, hint: '', fixedAngle: null, action: { type: 'none' }, children: [] });
writeFileSync(
  join(profile, 'menus.json'),
  JSON.stringify({
    version: 1,
    menus: [{ id: 'bench', name: 'Bench', icon: { kind: 'lucide', name: 'Orbit' }, shortcut: timerMode ? '' : 'F24', enabled: true, openAt: 'screen-center', items: icons.map((_, i) => item(i)) }],
  }),
);
writeFileSync(
  join(profile, 'settings.json'),
  JSON.stringify({ version: 1, navigation: { warpPointer: false, closeOnBlur: false }, general: { firstRunDone: true, launchAtLogin: false, autoCheckUpdates: false } }),
);

const child = spawn(require('electron'), ['.'], {
  cwd: root,
  stdio: 'ignore',
  env: { ...process.env, ORBIT_USER_DATA: profile, ...(timerMode ? { ORBIT_BENCH: `gaps=${gaps.join(',')}` } : {}) },
});
let exited = false;
child.on('exit', () => (exited = true));

const changes = []; // { t, colour } whenever the sampled pixel changes
const overlay = []; // overlayState() samples
const opens = []; // { t, gap }
const closes = []; // t
const focus = []; // true when the foreground window after closing equals the one before opening
let samples = 0;
let sampledMs = 0;
let last = sample();

/** Samples the pixel as fast as possible for `ms`, recording changes. */
function watch(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const now = sample();
    samples++;
    if (differs(now, last)) {
      changes.push({ t: Date.now(), colour: now });
      last = now;
    }
  }
  sampledMs += Date.now() - start;
  const state = overlayState();
  if (state) overlay.push(state);
}

if (timerMode) {
  const budget = gaps.reduce((a, b) => a + b, 0) + gaps.length * (HOLD_MS + 400) + 12_000;
  const started = Date.now();
  while (!exited && Date.now() - started < budget) {
    watch(200);
    await new Promise((r) => setImmediate(r));
  }
} else {
  // Wait for the app: overlay window created, then time for the warm-up render.
  for (let i = 0; i < 100 && !FindWindowW(null, 'OrbitMenu overlay'); i++) await sleep(100);
  // Let start-up finish (renderer load, warm-up render) so the first press is not a cold start.
  await sleep(5000);
  for (const gap of gaps) {
    // Idle time, sampled in slices so overlay checks cover it.
    for (let left = gap; left > 0; left -= 150) {
      watch(Math.min(100, left));
      await sleep(Math.min(50, Math.max(0, left - 100)));
    }
    // If a previous round left the menu open (missed key), close it so presses stay in step.
    if (overlayState()?.focused) {
      tapKey(VK_F24);
      await sleep(500);
    }
    const before = GetForegroundWindow();
    last = sample();
    const t0 = Date.now();
    if (!tapKey(VK_F24)) console.log('SendInput was refused (is the desktop locked?)');
    opens.push({ t: t0, gap });
    for (let left = HOLD_MS; left > 0; left -= 100) watch(100);
    if (shotDir && opens.length === 1) screenshot(join(shotDir, 'menu-open.png'));
    closes.push(Date.now());
    tapKey(VK_F24); // a second press toggles the menu closed
    for (let left = 450; left > 0; left -= 90) watch(90);
    focus.push(GetForegroundWindow() === before);
    if (shotDir && opens.length === 1) screenshot(join(shotDir, 'menu-closed.png'));
  }
}
if (!exited) child.kill();
const sampleMs = sampledMs / Math.max(1, samples);

const logFile = join(profile, 'logs', 'orbitmenu.log');
const log = existsSync(logFile) ? readFileSync(logFile, 'utf8').split(/\r?\n/) : [];
if (timerMode) {
  for (const l of log) {
    const o = /BENCH open (\d+) after (\d+)/.exec(l);
    if (o) opens.push({ t: Number(o[1]), gap: Number(o[2]) });
    const c = /BENCH close (\d+)/.exec(l);
    if (c) closes.push(Number(c[1]));
    if (l.includes('BENCH focus')) focus.push(l.includes('restored'));
  }
}
const internal = log.flatMap((l) => {
  const m = /Menu opened in ([\d.]+) ms \(window shown after ([\d.]+)/.exec(l);
  return m ? [{ painted: Number(m[1]), shown: Number(m[2]) }] : [];
});

console.log(`${timerMode ? 'Timer mode (app opens itself)' : 'Hotkey mode (F24 pressed through SendInput)'}; sampling pixel ${px},${py} every ${sampleMs.toFixed(1)} ms.`);
if (!opens.length) console.log('No opens recorded — did the app start? Log:', logFile);
const rows = opens.map((o, i) => {
  const end = closes[i] ?? o.t + HOLD_MS;
  const during = changes.filter((c) => c.t >= o.t - 5 && c.t <= end + 5);
  const closeChange = changes.find((c) => c.t > end);
  return {
    'idle before (ms)': o.gap,
    [timerMode ? 'open → pixels (ms)' : 'key → pixels (ms)']: during[0] ? during[0].t - o.t : 'none',
    // The last change before closing: the end of the entry animation.
    'settled (ms)': during.at(-1) ? during.at(-1).t - o.t : 'none',
    'app: frame requested (ms)': internal[i]?.painted ?? '',
    'gone after close (ms)': closeChange ? closeChange.t - end : 'none',
  };
});
console.table(rows);
const key = timerMode ? 'open → pixels (ms)' : 'key → pixels (ms)';
const firsts = rows.map((r) => r[key]).filter((v) => typeof v === 'number').sort((a, b) => a - b);
const settled = rows.map((r) => r['settled (ms)']).filter((v) => typeof v === 'number').sort((a, b) => a - b);
const median = (list) => list[Math.floor(list.length / 2)];
if (firsts.length) {
  console.log(`first pixels: median ${median(firsts)} ms, min ${firsts[0]} ms, max ${firsts.at(-1)} ms; fully settled: median ${median(settled)} ms (± ${sampleMs.toFixed(0)} ms sampling)`);
}

// Safety checks on the overlay between and during menus.
const isOpenAt = (t) => opens.some((o, i) => t >= o.t + 200 && t <= (closes[i] ?? o.t + HOLD_MS) - 50);
const isIdleAt = (t) => !opens.some((o, i) => t >= o.t - 50 && t <= (closes[i] ?? o.t + HOLD_MS) + 350);
const idle = overlay.filter((s) => isIdleAt(s.t));
const open = overlay.filter((s) => isOpenAt(s.t));
const share = (list, test) => (list.length ? `${list.filter(test).length}/${list.length}` : 'no samples');
console.log('Overlay between menus:');
console.log(`  off-screen or hidden   ${share(idle, (s) => !s.onScreen || !s.shown)}   (parked off-screen: ${share(idle, (s) => s.shown && !s.onScreen)})`);
console.log(`  cannot take clicks     ${share(idle, (s) => s.clickThrough || !s.shown || !s.onScreen)}`);
console.log(`  not holding focus      ${share(idle, (s) => !s.focused)}`);
console.log(`  out of taskbar/Alt+Tab ${share(overlay, (s) => s.toolWindow)}`);
console.log('Overlay while a menu is open:');
console.log(`  on-screen ${share(open, (s) => s.onScreen && s.shown)}, accepts clicks ${share(open, (s) => !s.clickThrough)}, has keyboard focus ${share(open, (s) => s.focused)}`);
console.log(`Focus returned to the previous window after closing: ${focus.filter(Boolean).length}/${focus.length}`);
if (process.env.ORBIT_LATENCY_LOG) writeFileSync(process.env.ORBIT_LATENCY_LOG, [`opens ${JSON.stringify(opens)}`, `closes ${JSON.stringify(closes)}`, ...log].join('\n'));
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // Chromium may still hold files for a moment.
}
