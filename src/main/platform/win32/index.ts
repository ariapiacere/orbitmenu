// Windows backend: SendInput for keys and text, foreground-window management
// with the usual fallbacks for the foreground lock, and pointer warping.
import { screen } from 'electron';
import { basename } from 'node:path';
import type { Modifier, ParsedShortcut } from '@shared/accelerator';
import type { NativeWindow, Platform } from '../types';
import { C, api, className, enumWindows, isCloaked, processImagePath, sendKeyEvents, windowText, type KeyEvent } from './native';
import { MODIFIER_POLL_VKS, MODIFIER_VK, VK_RETURN, VK_TAB, vkForKey, type VkInfo } from './keys';
import { log } from '../../log';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function keyEvent(info: VkInfo, up: boolean): KeyEvent {
  let flags = up ? C.KEYEVENTF_KEYUP : 0;
  if (info.extended) flags |= C.KEYEVENTF_EXTENDEDKEY;
  return { vk: info.vk, scan: api.MapVirtualKeyW(info.vk, C.MAPVK_VK_TO_VSC) & 0xff, flags };
}

/** Desktop shell windows that should never be focus targets. */
const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);

export function createWin32Platform(): Platform {
  const isDown = (vk: number) => (api.GetAsyncKeyState(vk) & 0x8000) !== 0;

  const platform: Platform = {
    name: 'win32',
    capabilities: {
      sendKeys: true,
      typeText: true,
      focusWindows: true,
      warpPointer: true,
      modifierPolling: true,
      restoreFocus: true,
    },

    getForegroundWindow() {
      const h = api.GetForegroundWindow();
      return h ? Number(h) : null;
    },

    isWindow(handle) {
      return api.IsWindow(handle) !== 0;
    },

    bringToForeground(handle) {
      if (!api.IsWindow(handle)) return false;
      if (api.IsIconic(handle)) api.ShowWindow(handle, C.SW_RESTORE);
      if (api.SetForegroundWindow(handle) && api.GetForegroundWindow() === handle) return true;

      // The foreground lock refused us. Attaching to the foreground thread's
      // input queue lets this thread move the focus legitimately.
      const fg = api.GetForegroundWindow();
      const myThread = api.GetCurrentThreadId();
      const fgThread = fg ? api.GetWindowThreadProcessId(fg, null) : 0;
      const targetThread = api.GetWindowThreadProcessId(handle, null);
      const attached: number[] = [];
      for (const t of new Set([fgThread, targetThread])) {
        if (t && t !== myThread && api.AttachThreadInput(myThread, t, 1)) attached.push(t);
      }
      try {
        api.BringWindowToTop(handle);
        api.SetForegroundWindow(handle);
      } finally {
        for (const t of attached) api.AttachThreadInput(myThread, t, 0);
      }
      if (api.GetForegroundWindow() === handle) return true;

      api.SwitchToThisWindow(handle, 1);
      const ok = api.GetForegroundWindow() === handle;
      if (!ok) log.warn(`Could not bring window ${handle} to the foreground.`);
      return ok;
    },

    allowForegroundForNewProcesses() {
      api.AllowSetForegroundWindow(C.ASFW_ANY);
    },

    async sendShortcut(shortcut: ParsedShortcut) {
      const mods = shortcut.modifiers.map((m) => MODIFIER_VK[m]);
      const key = shortcut.key ? vkForKey(shortcut.key) : undefined;
      if (shortcut.key && !key) throw new Error(`The key "${shortcut.key}" cannot be sent.`);
      const events: KeyEvent[] = [
        ...mods.map((m) => keyEvent(m, false)),
        ...(key ? [keyEvent(key, false), keyEvent(key, true)] : []),
        ...[...mods].reverse().map((m) => keyEvent(m, true)),
      ];
      const sent = sendKeyEvents(events);
      if (sent !== events.length) {
        throw new Error('Windows blocked the simulated keys (the desktop may be locked, or the target window runs as administrator).');
      }
      await sleep(10);
    },

    async typeText(text: string) {
      // KEYEVENTF_UNICODE works with any keyboard layout. Line breaks and tabs
      // are sent as real keys because many apps ignore them as characters.
      const events: KeyEvent[] = [];
      const normalized = text.replace(/\r\n?/g, '\n');
      for (const ch of normalized) {
        if (ch === '\n' || ch === '\t') {
          const info = { vk: ch === '\n' ? VK_RETURN : VK_TAB, extended: false };
          events.push(keyEvent(info, false), keyEvent(info, true));
          continue;
        }
        for (let i = 0; i < ch.length; i++) {
          const unit = ch.charCodeAt(i);
          events.push({ vk: 0, scan: unit, flags: C.KEYEVENTF_UNICODE });
          events.push({ vk: 0, scan: unit, flags: C.KEYEVENTF_UNICODE | C.KEYEVENTF_KEYUP });
        }
      }
      // Small batches keep slow targets (terminals, remote desktops) from dropping input.
      const BATCH = 40;
      for (let i = 0; i < events.length; i += BATCH) {
        const chunk = events.slice(i, i + BATCH);
        if (sendKeyEvents(chunk) !== chunk.length) {
          throw new Error('Windows blocked the simulated typing (the desktop may be locked, or the target window runs as administrator).');
        }
        await sleep(8);
      }
    },

    async waitForModifiersReleased(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const held = (Object.keys(MODIFIER_POLL_VKS) as Modifier[]).some((m) => platform.isModifierDown(m));
        if (!held) return true;
        await sleep(15);
      }
      return false;
    },

    isModifierDown(modifier) {
      return MODIFIER_POLL_VKS[modifier].some(isDown);
    },

    isKeyDown(key) {
      const info = vkForKey(key);
      return info ? isDown(info.vk) : false;
    },

    listWindows() {
      const out: NativeWindow[] = [];
      const pathCache = new Map<number, string>();
      enumWindows((hwnd) => {
        if (!api.IsWindowVisible(hwnd)) return;
        const exStyle = Number(api.GetWindowLongPtrW(hwnd, C.GWL_EXSTYLE));
        const appWindow = (exStyle & C.WS_EX_APPWINDOW) !== 0;
        if (!appWindow && (exStyle & C.WS_EX_TOOLWINDOW) !== 0) return;
        if (!appWindow && api.GetWindow(hwnd, C.GW_OWNER) !== 0) return;
        if (isCloaked(hwnd)) return;
        const title = windowText(hwnd);
        if (!title) return;
        const cls = className(hwnd);
        if (SHELL_CLASSES.has(cls)) return;
        const pidOut = [0];
        api.GetWindowThreadProcessId(hwnd, pidOut);
        const pid = pidOut[0]!;
        if (pid === process.pid) return;
        let path = pathCache.get(pid);
        if (path === undefined) {
          path = processImagePath(pid);
          pathCache.set(pid, path);
        }
        out.push({
          handle: hwnd,
          title,
          className: cls,
          processId: pid,
          processPath: path,
          processName: path ? basename(path).toLowerCase() : '',
        });
      });
      return out;
    },

    warpPointer(x, y) {
      const p = screen.dipToScreenPoint({ x: Math.round(x), y: Math.round(y) });
      api.SetCursorPos(Math.round(p.x), Math.round(p.y));
    },
  };
  return platform;
}
