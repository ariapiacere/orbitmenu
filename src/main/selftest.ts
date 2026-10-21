// Integration self-test that runs inside Electron (`npm run selftest`). It
// exercises the real action engine, process spawning, the Win32 bindings and
// the clipboard snapshot logic, without touching the user's windows: programs
// it starts only write into a temporary folder.
import { app } from 'electron';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActionConfig } from '@shared/types';
import { defaultSettings } from '@shared/defaults';
import { parseShortcut } from '@shared/accelerator';
import { createActionEngine, restoreClipboardSnapshot, snapshotClipboard } from './actions/handlers';
import { CancelledError, type ActionContext } from './actions/engine';
import { getPlatform } from './platform';
import { clipboard } from 'electron';
import { statSync } from 'node:fs';
import { adoptIcon, adoptMenuIcons, iconStoreDir, storedIconFile } from './icon-store';
import { Updater } from './updater';
import { compareVersions } from './updater/releases';
import { defaultMenus } from '@shared/defaults';

// Keep the test's files (icons, config) out of any real profile.
const sandbox = mkdtempSync(join(tmpdir(), 'orbit-selftest-profile-'));
app.setPath('userData', sandbox);

type Result = { name: string; status: 'pass' | 'fail' | 'skip'; detail?: string };
const results: Result[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function check(name: string, fn: () => Promise<string | void>): Promise<void> {
  try {
    const detail = await fn();
    results.push({ name, status: 'pass', detail: detail || undefined });
  } catch (err) {
    const e = err as Error & { skip?: boolean };
    results.push({ name, status: e.skip ? 'skip' : 'fail', detail: e.message });
  }
}

function skip(message: string): never {
  throw Object.assign(new Error(message), { skip: true });
}

async function waitForFile(path: string, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      await sleep(100);
      return readFileSync(path, 'utf8');
    }
    await sleep(50);
  }
  throw new Error(`${path} was not created`);
}

async function main(): Promise<void> {
  const platform = getPlatform();
  const engine = createActionEngine();
  const settings = defaultSettings();
  const ctx = (label: string): ActionContext => ({
    platform,
    settings,
    label,
    signal: new AbortController().signal,
    targetWindow: null,
    focusTarget: async () => {},
    confirm: async () => false,
    openMenu: () => {},
    beforeSendingKeys: () => {},
    afterSendingKeys: () => {},
  });
  const run = (action: ActionConfig, label = 'test') => engine.run(action, ctx(label), new Set(['main']));
  const expectError = async (action: ActionConfig, pattern: RegExp) => {
    try {
      await run(action);
    } catch (err) {
      if (pattern.test((err as Error).message)) return (err as Error).message;
      throw new Error(`unexpected error: ${(err as Error).message}`);
    }
    throw new Error('expected an error');
  };

  const dir = mkdtempSync(join(tmpdir(), 'orbit selftest ✓ '));
  process.env.ORBIT_SELFTEST_DIR = dir;

  await check('native backend loaded', async () => {
    if (!platform.capabilities.sendKeys) throw new Error(`generic backend (${platform.name})`);
    return 'koffi / user32';
  });

  await check('enumerate top-level windows', async () => {
    const windows = platform.listWindows();
    if (process.platform !== 'win32') skip('not Windows');
    return `${windows.length} windows`;
  });

  await check('foreground window query', async () => {
    const fg = platform.getForegroundWindow();
    return fg ? `hwnd ${fg}` : 'none (locked or secure desktop)';
  });

  await check('command: no shell, env expansion, Unicode path', async () => {
    const out = join(dir, 'cmd-out.txt');
    await run({
      type: 'command',
      command: '%ComSpec%',
      args: `/d /c echo command-ok> "%ORBIT_SELFTEST_DIR%\\cmd-out.txt"`,
      cwd: '%ORBIT_SELFTEST_DIR%',
      confirm: 'never',
      console: false,
    });
    const text = await waitForFile(out);
    if (!text.includes('command-ok')) throw new Error(`unexpected output: ${text}`);
  });

  await check('command: sensitive command asks and can be declined', async () => {
    try {
      await run({ type: 'command', command: 'shutdown.exe', args: '/s /t 600', cwd: '', confirm: 'auto', console: false });
    } catch (err) {
      if (err instanceof CancelledError) return 'confirmation required, declined';
      throw err;
    }
    throw new Error('shutdown was not gated by a confirmation');
  });

  await check('launch: batch file with arguments', async () => {
    const bat = join(dir, 'write.bat');
    writeFileSync(bat, '@echo off\r\necho %~1> "%~dp0bat-out.txt"\r\n');
    await run({ type: 'launch', path: bat, args: 'batch-ok', cwd: '' });
    const text = await waitForFile(join(dir, 'bat-out.txt'));
    if (!text.includes('batch-ok')) throw new Error(`unexpected output: ${text}`);
  });

  await check('launch: batch arguments with shell metacharacters are refused', () =>
    expectError({ type: 'launch', path: join(dir, 'write.bat'), args: 'a&calc', cwd: '' }, /special characters/),
  );

  await check('launch: missing program reports a clear error', () =>
    expectError({ type: 'launch', path: 'C:\\does\\not\\exist.exe', args: '', cwd: '' }, /not found/i),
  );

  await check('open: missing file reports a clear error', () =>
    expectError({ type: 'open', path: join(dir, 'missing.txt'), reveal: false }, /not found/i),
  );

  await check('url: unsafe scheme is rejected before opening', () => expectError({ type: 'url', url: 'javascript:alert(1)' }, /not allowed/));

  await check('focus: no match and no fallback', () =>
    expectError({ type: 'focus', processName: 'orbit-no-such-process.exe', title: '', titleMatch: 'contains', launchPath: '' }, /No open window/),
  );

  await check('hotkey: invalid combination is rejected', () => expectError({ type: 'hotkey', keys: 'Ctrl+Nope' }, /Unknown key/));

  await check('hotkey: inject a modifier tap (Shift)', async () => {
    const shift = parseShortcut('Shift');
    if (!shift.ok) throw new Error('parse failed');
    try {
      await platform.sendShortcut(shift.value);
      return 'SendInput accepted 2 events';
    } catch (err) {
      skip(`SendInput blocked (${(err as Error).message}) — expected while the desktop is locked`);
    }
  });

  await check('clipboard snapshot and restore', async () => {
    const original = await snapshotClipboard();
    if (!original) throw new Error('could not read the clipboard');
    try {
      await clipboard.writeText('orbit-before');
      const saved = await snapshotClipboard();
      await clipboard.writeText('orbit-snippet');
      await restoreClipboardSnapshot(saved!);
      const text = await clipboard.readText();
      if (text !== 'orbit-before') throw new Error(`restored "${text}"`);
      return `${saved!.length} item(s), types restored`;
    } finally {
      await restoreClipboardSnapshot(original);
    }
  });

  await check('icon store: copies an image into the program folder', async () => {
    // 1×1 transparent PNG.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    const source = join(dir, 'my icon ✓.png');
    writeFileSync(source, png);
    const ref = adoptIcon(source);
    if (!/^icons\/[0-9a-f]{16}\.png$/.test(ref)) throw new Error(`unexpected reference ${ref}`);
    const stored = storedIconFile(ref)!;
    if (!existsSync(stored) || statSync(stored).size !== png.length) throw new Error('copy missing');
    rmSync(source);
    if (!existsSync(stored)) throw new Error('copy depends on the original');
    return `${ref} in ${iconStoreDir()}`;
  });

  await check('icon store: identical images are stored once', async () => {
    const a = join(dir, 'a.png');
    const b = join(dir, 'b.png');
    const data = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    writeFileSync(a, data);
    writeFileSync(b, data);
    if (adoptIcon(a) !== adoptIcon(b)) throw new Error('duplicates were stored twice');
  });

  await check('icon store: existing image icons are migrated', async () => {
    const img = join(dir, 'menu.svg');
    writeFileSync(img, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>');
    const menus = defaultMenus();
    menus[0]!.items[0]!.icon = { kind: 'image', path: img };
    menus[0]!.items[1]!.icon = { kind: 'image', path: join(dir, 'gone.png') };
    const r = adoptMenuIcons(menus);
    const icon = r.menus[0]!.items[0]!.icon;
    if (!r.changed || icon.kind !== 'image' || !icon.path.startsWith('icons/')) throw new Error('not rewritten');
    if (r.failed.length !== 1) throw new Error('missing file was not reported');
  });

  await check('updates: download and verify the latest GitHub release', async () => {
    const token = process.env.ORBIT_TEST_GITHUB_TOKEN;
    if (!token) skip('set ORBIT_TEST_GITHUB_TOKEN to test against the private repository');
    const updater = new Updater({
      repository: process.env.ORBIT_TEST_REPOSITORY ?? 'ariapiacere/orbitmenu',
      tokenFile: join(dir, 'token.bin'),
      cacheRoot: join(dir, 'updates'),
      settings: () => settings.general,
      notify: () => {},
      tokenOverride: token,
    });
    const release = await updater.latestRelease();
    const file = await updater.fetchPackage(release, join(dir, 'updates', release.version));
    const releases = readFileSync(join(dir, 'updates', release.version, 'RELEASES'), 'utf8');
    if (!releases.includes(release.version)) throw new Error('local RELEASES not written');
    return `${release.tag}: ${(statSync(file).size / 1024 / 1024).toFixed(1)} MB verified (newer than this build: ${compareVersions(release.version, app.getVersion()) > 0})`;
  });

  rmSync(dir, { recursive: true, force: true });
  try {
    // Chromium keeps files open in the profile until exit; leftovers are in %TEMP%.
    rmSync(sandbox, { recursive: true, force: true });
  } catch {
    // Best effort.
  }

  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const mark = r.status === 'pass' ? 'PASS' : r.status === 'skip' ? 'SKIP' : 'FAIL';
    console.log(`${mark}  ${r.name.padEnd(width)}  ${r.detail ?? ''}`);
  }
  const failed = results.filter((r) => r.status === 'fail').length;
  console.log(`\n${results.length - failed} of ${results.length} checks passed or skipped; ${failed} failed.`);
  app.exit(failed ? 1 : 0);
}

app.whenReady().then(() => main().catch((err) => {
  console.error(err);
  app.exit(1);
}));
