// The overlay: one transparent, frameless, always-on-top window, created at
// startup. While a menu is open it covers the display under the pointer so
// strokes can go anywhere.
//
// Between menus the window is "parked" (the default): moved beyond the edge of
// all displays, made click-through and emptied — but kept shown. Hiding and
// re-showing a transparent full-screen window costs Chromium and the Windows
// compositor several frames; a parked window only has to be moved back, which
// `npm run latency` measured as roughly 100 ms faster per open. A parked
// window cannot intercept input: it is off-screen, it is click-through in case
// Windows ever moves it back (monitor changes, remote sessions), and it
// re-parks itself whenever it is moved.
//
// "hide" mode is the classic behaviour (really hide the window between menus),
// kept as a fallback that users can select in the settings.
import { app, BrowserWindow, screen } from 'electron';
import type { Rect, Vec2 } from '@shared/types';
import { IPC, type MenuShowPayload } from '@shared/ipc';
import { preloadPath, rendererEntry } from './paths';
import { log } from './log';
import type { Platform } from './platform';

export type OverlayMode = 'park' | 'hide';

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

export class MenuWindow {
  private win: BrowserWindow | null = null;
  private loaded = false;
  private loadWaiters: (() => void)[] = [];
  private clearWaiter: (() => void) | null = null;
  private visible = false;
  private shownAt = 0;
  private warmTimer: NodeJS.Timeout | null = null;
  private mode: OverlayMode = 'park';
  private clickThrough = false;
  /** Guards against reacting to our own setBounds while parking. */
  private parking = false;
  /** Size of the display the overlay last covered; parking keeps it so re-opening is a pure move. */
  private lastSize: { width: number; height: number } | null = null;
  /** Supplies a payload to render invisibly so fonts, icons and shaders are warm. */
  warmPayload: (() => Omit<MenuShowPayload, 'cursor' | 'workArea'> | null) | null = null;

  constructor(
    private readonly platform: Platform,
    private readonly handlers: { onBlur: () => void; onCrash: () => void },
  ) {
    const repark = () => {
      if (!this.visible) this.park();
    };
    screen.on('display-added', repark);
    screen.on('display-removed', repark);
    screen.on('display-metrics-changed', repark);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  get webContentsId(): number | null {
    return this.win?.webContents.id ?? null;
  }

  get msSinceShown(): number {
    return Date.now() - this.shownAt;
  }

  /** Development override: ORBIT_OVERLAY=hide|park wins over the setting. */
  private static forcedMode(): OverlayMode | null {
    const v = app.isPackaged ? undefined : process.env.ORBIT_OVERLAY;
    return v === 'hide' || v === 'park' ? v : null;
  }

  setMode(mode: OverlayMode): void {
    const next = MenuWindow.forcedMode() ?? mode;
    if (next === this.mode) return;
    this.mode = next;
    const win = this.win;
    if (!win || win.isDestroyed() || this.visible) return;
    if (next === 'park') {
      this.park();
    } else {
      win.hide();
      this.setClickThrough(false);
    }
  }

  create(): void {
    if (this.win && !this.win.isDestroyed()) return;
    this.loaded = false;
    this.clickThrough = false;
    const win = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      focusable: true,
      thickFrame: false,
      roundedCorners: false,
      // WS_EX_TOOLWINDOW: keeps the overlay out of the taskbar and Alt+Tab.
      type: 'toolbar',
      title: 'OrbitMenu overlay',
      webPreferences: {
        preload: preloadPath('menu'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false,
        devTools: !app.isPackaged,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.on('blur', () => {
      if (this.visible) this.handlers.onBlur();
    });
    // If anything moves the parked overlay (Windows does this when monitors
    // change), put it straight back.
    win.on('move', () => {
      if (!this.visible && !this.parking) this.park();
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      log.error('Menu renderer crashed:', details.reason);
      this.forceHide();
      this.win?.destroy();
      this.win = null;
      this.handlers.onCrash();
      this.create();
    });
    win.on('unresponsive', () => {
      log.warn('Menu renderer is unresponsive; hiding the overlay.');
      this.forceHide();
    });

    const entry = rendererEntry('menu');
    const load = entry.url ? win.loadURL(entry.url) : win.loadFile(entry.file!);
    load.catch((err) => log.error('Failed to load menu renderer:', err));
    this.win = win;
  }

  /** Called when the renderer reports that its scripts are running. */
  markReady(): void {
    this.loaded = true;
    for (const w of this.loadWaiters.splice(0)) w();
    this.prewarm();
  }

  markCleared(): void {
    this.clearWaiter?.();
    this.clearWaiter = null;
  }

  /** Toggles click-through, skipping the (window-style changing) call when nothing changes. */
  private setClickThrough(on: boolean): void {
    if (on === this.clickThrough || !this.win || this.win.isDestroyed()) return;
    this.clickThrough = on;
    this.win.setIgnoreMouseEvents(on);
  }

  /** Off-screen home of the parked overlay: to the right of every display. */
  private parkBounds(): Rect {
    const displays = screen.getAllDisplays();
    const right = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width));
    const top = Math.min(...displays.map((d) => d.bounds.y));
    const size = this.lastSize ?? screen.getPrimaryDisplay().bounds;
    return { x: right + 400, y: top, width: size.width, height: size.height };
  }

  /** Moves the overlay off-screen and makes it click-through; it stays shown. */
  private park(): void {
    const win = this.win;
    if (!win || win.isDestroyed() || this.mode !== 'park') return;
    this.setClickThrough(true);
    const target = this.parkBounds();
    if (!sameRect(win.getBounds(), target)) {
      this.parking = true;
      try {
        win.setBounds(target);
      } finally {
        this.parking = false;
      }
    }
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.showInactive();
  }

  /**
   * Renders a real menu once while the overlay is invisible, so the first
   * shortcut press does not pay for font loading, icon building and GPU
   * shader compilation. Repeated every few minutes to keep that memory
   * resident on machines under memory pressure.
   */
  prewarm(): void {
    const win = this.win;
    if (!win || win.isDestroyed() || !this.loaded || this.visible) return;
    if (this.mode === 'park') {
      this.park();
    } else {
      win.setOpacity(0);
      this.setClickThrough(true);
      win.showInactive();
    }
    const payload = this.warmPayload?.();
    if (payload) {
      const { width, height } = win.getBounds();
      win.webContents.send(IPC.menuShow, {
        ...payload,
        prewarm: true,
        cursor: { x: width / 2, y: height / 2 },
        workArea: { x: 0, y: 0, width, height },
      } satisfies MenuShowPayload);
    }
    setTimeout(() => {
      // A real menu may have opened in the meantime; leave it alone.
      if (this.visible || !this.win || this.win.isDestroyed()) return;
      this.win.webContents.send(IPC.menuClear);
      if (this.mode === 'hide') {
        this.win.hide();
        this.setClickThrough(false);
        this.win.setOpacity(1);
      }
    }, 400);
    if (!this.warmTimer) {
      this.warmTimer = setInterval(() => this.prewarm(), 4 * 60_000);
      this.warmTimer.unref?.();
    }
  }

  private waitUntilLoaded(timeoutMs = 4000): Promise<void> {
    if (this.loaded) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(resolve, timeoutMs);
      this.loadWaiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  /** The display and its geometry for a screen point. */
  static layoutFor(point: Vec2): { bounds: Rect; workArea: Rect; scale: number } {
    const display = screen.getDisplayNearestPoint({ x: Math.round(point.x), y: Math.round(point.y) });
    const b = display.bounds;
    const w = display.workArea;
    return {
      bounds: { ...b },
      workArea: { x: w.x - b.x, y: w.y - b.y, width: w.width, height: w.height },
      scale: display.scaleFactor,
    };
  }

  async show(payload: Omit<MenuShowPayload, 'cursor' | 'workArea'>, screenPoint: Vec2): Promise<void> {
    const t0 = performance.now();
    this.create();
    await this.waitUntilLoaded();
    const win = this.win!;
    const { bounds, workArea } = MenuWindow.layoutFor(screenPoint);
    const cursor = { x: screenPoint.x - bounds.x, y: screenPoint.y - bounds.y };
    // Content first: the renderer starts building the menu while the window moves.
    win.webContents.send(IPC.menuShow, { ...payload, cursor, workArea } satisfies MenuShowPayload);
    this.visible = true;
    this.shownAt = Date.now();
    this.lastSize = { width: bounds.width, height: bounds.height };
    this.setClickThrough(false);
    if (!sameRect(win.getBounds(), bounds)) {
      win.setBounds(bounds);
      // Electron can size a window with the previous display's scale factor when
      // it moves between mixed-DPI monitors; a second call corrects that.
      if (!sameRect(win.getBounds(), bounds)) win.setBounds(bounds);
    }
    const tBounds = performance.now();
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.moveTop();
    win.focus();
    log.debug(`overlay show (${this.mode}): bounds ${(tBounds - t0).toFixed(1)} ms, show+focus ${(performance.now() - tBounds).toFixed(1)} ms`);
    // The hotkey recipient may take the foreground, but if Windows still
    // refused, attach to the foreground thread and try again.
    if (!win.isFocused()) {
      const hwnd = MenuWindow.handleOf(win);
      if (hwnd) this.platform.bringToForeground(hwnd);
    }
    this.debugCapture();
  }

  /** Development aid: ORBIT_DEBUG_CAPTURE=<file.png> saves what the overlay rendered. */
  private debugCapture(): void {
    const file = process.env.ORBIT_DEBUG_CAPTURE;
    if (!file || app.isPackaged) return;
    setTimeout(async () => {
      try {
        const image = await this.win?.webContents.capturePage();
        if (image) (await import('node:fs')).writeFileSync(file, image.toPNG());
        log.info(`Overlay captured to ${file} (focused: ${this.win?.isFocused()})`);
      } catch (err) {
        log.warn('Overlay capture failed:', err);
      }
    }, 600);
  }

  /** Re-sends a payload to the already visible overlay (menu switch). */
  update(payload: MenuShowPayload): void {
    this.win?.webContents.send(IPC.menuShow, payload);
  }

  /** Overlay-relative coordinates → screen DIP coordinates. */
  toScreen(p: Vec2): Vec2 {
    const b = this.win?.getBounds() ?? { x: 0, y: 0 };
    return { x: b.x + p.x, y: b.y + p.y };
  }

  bounds(): Rect | null {
    return this.win?.getBounds() ?? null;
  }

  send(channel: string): void {
    this.win?.webContents.send(channel);
  }

  /**
   * Takes the overlay off the screen and gives keyboard focus back to
   * `focusTarget` (the window that was active before the menu opened), or
   * leaves focus alone with 'keep' (the user already moved to another window).
   *
   * Parked mode is immediate: the window leaves the screen first and is
   * emptied afterwards. Hide mode empties it first so the next show does not
   * flash the previous menu, then hides it.
   */
  async hide(focusTarget: number | null | 'keep' = null): Promise<void> {
    const win = this.win;
    if (!this.visible || !win || win.isDestroyed()) return;
    this.visible = false;
    if (this.mode === 'park') {
      this.park();
      win.webContents.send(IPC.menuClear);
      // A parked window keeps keyboard focus unless it is handed on explicitly.
      if (focusTarget === 'keep') return;
      if (focusTarget && this.platform.isWindow(focusTarget)) this.platform.bringToForeground(focusTarget);
      else win.blur();
      return;
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 120);
      this.clearWaiter = () => {
        clearTimeout(t);
        resolve();
      };
      win.webContents.send(IPC.menuClear);
    });
    if (!win.isDestroyed()) win.hide();
    if (focusTarget && focusTarget !== 'keep' && this.platform.isWindow(focusTarget) && this.platform.getForegroundWindow() !== focusTarget) {
      this.platform.bringToForeground(focusTarget);
    }
  }

  /** Emergency exit (renderer hung or crashed): get off the screen without its cooperation. */
  forceHide(): void {
    this.visible = false;
    this.clearWaiter?.();
    this.clearWaiter = null;
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    this.setClickThrough(true);
    win.hide();
  }

  destroy(): void {
    if (this.warmTimer) clearInterval(this.warmTimer);
    this.warmTimer = null;
    this.win?.destroy();
    this.win = null;
  }

  static handleOf(win: BrowserWindow): number | null {
    const buf = win.getNativeWindowHandle();
    if (buf.length >= 8) return Number(buf.readBigUInt64LE(0));
    if (buf.length >= 4) return buf.readUInt32LE(0);
    return null;
  }
}
