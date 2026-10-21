// The overlay: one transparent, frameless, always-on-top window that is
// created at startup and kept hidden, so opening a menu costs only a resize
// and an IPC message. While visible it covers the display under the pointer
// so strokes can go anywhere; when a menu closes the window is hidden (never
// just made transparent), so nothing is left intercepting clicks.
import { app, BrowserWindow, screen } from 'electron';
import type { Rect, Vec2 } from '@shared/types';
import { IPC, type MenuShowPayload } from '@shared/ipc';
import { preloadPath, rendererEntry } from './paths';
import { log } from './log';
import type { Platform } from './platform';

export class MenuWindow {
  private win: BrowserWindow | null = null;
  private loaded = false;
  private loadWaiters: (() => void)[] = [];
  private clearWaiter: (() => void) | null = null;
  private visible = false;
  private shownAt = 0;
  private warmed = false;

  constructor(
    private readonly platform: Platform,
    private readonly handlers: { onBlur: () => void; onCrash: () => void },
  ) {}

  get isVisible(): boolean {
    return this.visible;
  }

  get webContentsId(): number | null {
    return this.win?.webContents.id ?? null;
  }

  get msSinceShown(): number {
    return Date.now() - this.shownAt;
  }

  create(): void {
    if (this.win && !this.win.isDestroyed()) return;
    this.loaded = false;
    this.warmed = false;
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
    if (!this.warmed) void this.prewarm();
  }

  /**
   * The very first show of a transparent window is slow (Chromium and DWM set
   * up its surfaces). Do that once at startup, invisible and click-through, so
   * the first real shortcut press is as fast as every later one.
   */
  private async prewarm(): Promise<void> {
    const win = this.win;
    if (!win || win.isDestroyed() || this.visible) return;
    this.warmed = true;
    const t = performance.now();
    try {
      win.setOpacity(0);
      win.setIgnoreMouseEvents(true);
      win.showInactive();
      await new Promise((r) => setTimeout(r, 150));
    } finally {
      if (!win.isDestroyed()) {
        if (!this.visible) win.hide();
        win.setIgnoreMouseEvents(false);
        win.setOpacity(1);
      }
    }
    log.debug(`overlay pre-warmed in ${(performance.now() - t).toFixed(0)} ms`);
  }

  markCleared(): void {
    this.clearWaiter?.();
    this.clearWaiter = null;
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
    const tLoaded = performance.now();
    const win = this.win!;
    const { bounds, workArea } = MenuWindow.layoutFor(screenPoint);
    const cursor = { x: screenPoint.x - bounds.x, y: screenPoint.y - bounds.y };
    const current = win.getBounds();
    if (current.x !== bounds.x || current.y !== bounds.y || current.width !== bounds.width || current.height !== bounds.height) {
      // Setting the bounds twice works around Electron sizing a window with the
      // previous display's scale factor when it moves between mixed-DPI monitors.
      win.setBounds(bounds);
      win.setBounds(bounds);
    }
    const tBounds = performance.now();
    win.webContents.send(IPC.menuShow, { ...payload, cursor, workArea } satisfies MenuShowPayload);
    this.visible = true;
    this.shownAt = Date.now();
    win.show();
    const tShow = performance.now();
    win.moveTop();
    win.focus();
    log.debug(
      `overlay show: load ${(tLoaded - t0).toFixed(1)} ms, bounds ${(tBounds - tLoaded).toFixed(1)} ms, show ${(tShow - tBounds).toFixed(1)} ms, focus ${(performance.now() - tShow).toFixed(1)} ms`,
    );
    const actual = win.getBounds();
    if (actual.width !== bounds.width || actual.height !== bounds.height || actual.x !== bounds.x) win.setBounds(bounds);
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
   * Hides the overlay. The renderer first drops its content so that the next
   * show does not flash the previous menu for a frame.
   */
  async hide(): Promise<void> {
    if (!this.visible || !this.win) return;
    this.visible = false;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 120);
      this.clearWaiter = () => {
        clearTimeout(t);
        resolve();
      };
      this.win!.webContents.send(IPC.menuClear);
    });
    this.win?.hide();
  }

  forceHide(): void {
    this.visible = false;
    this.clearWaiter?.();
    this.clearWaiter = null;
    if (this.win && !this.win.isDestroyed()) this.win.hide();
  }

  destroy(): void {
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
