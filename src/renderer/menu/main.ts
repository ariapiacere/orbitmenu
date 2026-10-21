// Overlay controller: turns pointer, keyboard and modifier events into
// navigation. Four ways to choose an item, all active at once:
//  • point and click — click anywhere inside an item's wedge;
//  • marking — press, stroke toward items; corners and pauses open submenus,
//    releasing the button selects;
//  • turbo — keep the shortcut's modifier held, move, release to select;
//  • hover (optional) — rest on an item for the configured delay.
// Arrow keys, Tab, Enter, Backspace, Escape and per-item hint keys work too.
import '../radial/radial.css';
import './menu.css';
import type { MenuBridge, MenuShowPayload } from '@shared/ipc';
import type { MenuItem, NavigationSettings, Vec2 } from '@shared/types';
import { NONE, PARENT, angleOf, clampCenter, distance, pickByAngle, pointAt } from '@shared/geometry';
import { GestureEngine, applySensitivity, type StrokeCandidate } from '@shared/gestures';
import { isHoverUnsafe } from '@shared/validation';
import { RadialRenderer, type LevelSpec } from '../radial/RadialRenderer';
import { buildLevel, levelExtent } from '../radial/levels';

interface Level {
  spec: LevelSpec;
  items: MenuItem[];
  /** Item ids from the menu root to the submenu this level shows. */
  path: string[];
}

type Via = 'pointer' | 'keyboard';

let bridge: MenuBridge;

class OverlayController {
  private readonly renderer: RadialRenderer;
  private readonly gesture: GestureEngine;
  private payload: MenuShowPayload | null = null;
  private levels: Level[] = [];
  private pointer: Vec2 | null = null;
  private pressed = false;
  private turboActive = false;
  private closing = false;
  private keyboardMode = false;
  private pauseTimer = 0;
  private hoverTimer = 0;

  constructor(root: HTMLElement) {
    this.renderer = new RadialRenderer(root, { trail: true });
    this.gesture = new GestureEngine({
      deadZone: 40,
      dragThreshold: 12,
      minStrokeLength: 110,
      minStrokeAngle: 24,
      jitter: 8,
      fixedStrokeLength: 0,
    });

    window.addEventListener('pointermove', (e) => this.onPointerMove(e), { passive: true });
    window.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));

    bridge.onShow((p) => this.show(p));
    bridge.onClose(() => void this.close());
    bridge.onClear(() => this.clear());
    bridge.onTurboReleased(() => this.turboRelease());
    bridge.ready();
  }

  private get nav(): NavigationSettings {
    return this.payload!.settings.navigation;
  }

  private get top(): Level {
    return this.levels[this.levels.length - 1]!;
  }

  // ───────────────────────── lifecycle ─────────────────────────

  private show(p: MenuShowPayload): void {
    const switching = this.payload !== null && p.sessionId === this.payload.sessionId;
    this.resetState();
    this.payload = p;
    const a = p.settings.appearance;
    const nav = p.settings.navigation;
    this.renderer.clear();
    this.renderer.setAppearance(a);
    this.renderer.setResolvedIcons(p.icons);
    this.gesture.setOptions(
      applySensitivity(
        {
          deadZone: nav.deadZone,
          dragThreshold: nav.dragThreshold,
          minStrokeLength: nav.minStrokeLength,
          minStrokeAngle: nav.minStrokeAngle,
          jitter: nav.jitter,
          fixedStrokeLength: nav.fixedStrokeLength,
        },
        nav.sensitivity,
      ),
    );

    const area = p.workArea;
    const areaCenter = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
    const wanted = p.center ?? (p.menu.openAt === 'screen-center' ? areaCenter : p.cursor);
    let level = buildLevel(p.menu.name, p.menu.icon, p.menu.items, wanted, null, a, p.menuNames);
    const center = clampCenter(wanted, levelExtent(level, a), area);
    level = { ...level, center };
    this.levels = [{ spec: level, items: p.menu.items, path: [] }];
    this.renderer.push(level, switching ? center : p.cursor);

    this.pointer = { ...p.cursor };
    // Keep the pointer on the hub when the menu had to move away from the cursor.
    if (!switching && distance(center, p.cursor) > 2) this.warp(center);

    this.turboActive = p.turbo && nav.turbo;
    if (this.turboActive) this.gesture.begin(center, this.pointer);
    this.updateHover(this.pointer);
    window.focus();
    // rAF runs before the frame is drawn; the timeout lands just after it.
    requestAnimationFrame(() => setTimeout(() => bridge.painted(p.sessionId)));
  }

  private resetState(): void {
    window.clearTimeout(this.pauseTimer);
    window.clearTimeout(this.hoverTimer);
    this.levels = [];
    this.pressed = false;
    this.turboActive = false;
    this.closing = false;
    this.keyboardMode = false;
    this.gesture.end();
  }

  private clear(): void {
    this.resetState();
    this.payload = null;
    this.renderer.clear();
    // Ack after the empty frame has been painted, so the hidden window holds no stale menu.
    requestAnimationFrame(() => setTimeout(() => bridge.cleared()));
  }

  private async close(): Promise<void> {
    if (this.closing || !this.payload) return;
    this.closing = true;
    window.clearTimeout(this.pauseTimer);
    window.clearTimeout(this.hoverTimer);
    const id = this.payload.sessionId;
    await this.renderer.close();
    bridge.cancel(id);
  }

  // ───────────────────────── pointer ─────────────────────────

  private onPointerMove(e: PointerEvent): void {
    if (!this.payload || this.closing || !this.levels.length) return;
    const p = { x: e.clientX, y: e.clientY };
    this.pointer = p;
    this.keyboardMode = false;
    if (this.pressed || this.turboActive) {
      const candidate = this.gesture.move(p);
      if (this.gesture.hasDragged) this.renderer.addTrailPoint(p);
      if (candidate) this.onStrokeCandidate(candidate);
      this.schedulePause();
    }
    this.updateHover(p);
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.payload || this.closing || !this.levels.length) return;
    const p = { x: e.clientX, y: e.clientY };
    this.pointer = p;
    if (e.button === 0) {
      // A click ends turbo mode; the press is handled as a normal stroke.
      this.turboActive = false;
      this.pressed = true;
      if (this.nav.marking) this.gesture.begin(this.top.spec.center, p);
      else this.gesture.end();
    } else if (e.button === 2) {
      if (this.nav.rightClickGoesBack && this.levels.length > 1) this.back();
      else void this.close();
    } else if (e.button === 1) {
      void this.close();
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.button !== 0 || !this.pressed || !this.payload || this.closing) return;
    const p = { x: e.clientX, y: e.clientY };
    this.pressed = false;
    const dragged = this.gesture.isActive && this.gesture.hasDragged;
    this.gesture.end();
    window.clearTimeout(this.pauseTimer);
    this.selectAt(p, dragged ? 'release' : 'click');
  }

  private schedulePause(): void {
    window.clearTimeout(this.pauseTimer);
    this.pauseTimer = window.setTimeout(() => {
      if (!(this.pressed || this.turboActive) || !this.pointer || this.closing) return;
      const candidate = this.gesture.pause(this.pointer);
      if (candidate) this.onStrokeCandidate(candidate);
    }, this.nav.pauseMs);
  }

  /** A corner, pause or long stroke happened mid-gesture. Only submenus (and Back) react. */
  private onStrokeCandidate(c: StrokeCandidate): void {
    const idx = this.hit(c.point);
    if (idx === PARENT && c.reason !== 'length') {
      this.back();
      return;
    }
    if (idx >= 0 && this.top.items[idx]!.action.type === 'submenu') this.openSubmenu(idx, c.point, 'pointer');
  }

  private hit(p: Vec2): number {
    const top = this.top;
    const c = top.spec.center;
    if (distance(p, c) < this.nav.deadZone) return NONE;
    return pickByAngle(angleOf(p.x - c.x, p.y - c.y), top.spec.angles, top.spec.parentAngle);
  }

  private updateHover(p: Vec2): void {
    const idx = this.hit(p);
    this.renderer.setPointer(p, this.nav.deadZone);
    if (idx === this.renderer.hoveredIndex) return;
    this.renderer.setHover(idx);
    this.renderer.setHubNote(null);
    this.scheduleHover(idx);
  }

  private scheduleHover(idx: number): void {
    window.clearTimeout(this.hoverTimer);
    if (!this.nav.hover || idx === NONE || this.pressed || this.turboActive || this.keyboardMode) return;
    this.hoverTimer = window.setTimeout(() => {
      if (this.closing || this.pressed || this.turboActive || this.renderer.hoveredIndex !== idx) return;
      if (idx === PARENT) return this.back();
      const item = this.top.items[idx];
      if (!item) return;
      if (item.action.type === 'submenu') this.openSubmenu(idx, this.pointer ?? this.top.spec.center, 'pointer');
      else if (item.action.type === 'menu') this.switchMenu(item.action.menuId);
      else if (this.nav.hoverLeafRequiresClick || isHoverUnsafe(item.action) || item.action.type === 'none') {
        this.renderer.setHubNote('Click to run');
      } else this.execute(idx);
    }, this.nav.hoverDelayMs);
  }

  // ───────────────────────── turbo ─────────────────────────

  private onKeyUp(e: KeyboardEvent): void {
    if (!this.turboActive) return;
    if (!['Control', 'Shift', 'Alt', 'Meta', 'OS'].includes(e.key)) return;
    if (!e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) this.turboRelease();
  }

  /** The activation modifiers were released (reported by keyup or by the main-process poller). */
  private turboRelease(): void {
    if (!this.turboActive || !this.payload || this.closing) return;
    this.turboActive = false;
    const moved = this.gesture.hasDragged;
    this.gesture.end();
    window.clearTimeout(this.pauseTimer);
    // A quick tap of the shortcut without moving leaves the menu open for clicking.
    if (moved && this.pointer) this.selectAt(this.pointer, 'release');
  }

  // ───────────────────────── keyboard ─────────────────────────

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.payload || this.closing || !this.levels.length) return;
    const top = this.top;
    const arrow: Record<string, number> = { ArrowUp: 0, ArrowRight: 90, ArrowDown: 180, ArrowLeft: 270 };
    if (e.key in arrow) {
      e.preventDefault();
      this.keyboardSelect(pickByAngle(arrow[e.key]!, top.spec.angles, top.spec.parentAngle));
      return;
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        void this.close();
        return;
      case 'Backspace':
        e.preventDefault();
        if (this.levels.length > 1) this.back();
        else void this.close();
        return;
      case 'Enter': {
        e.preventDefault();
        const idx = this.renderer.hoveredIndex;
        if (idx === PARENT) this.back();
        else if (idx >= 0) this.activate(idx, top.spec.center, 'keyboard');
        return;
      }
      case 'Tab': {
        e.preventDefault();
        this.cycle(e.shiftKey ? -1 : 1);
        return;
      }
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    // Physical key first, so hints work with any keyboard layout.
    const ch = /^Key[A-Z]$/.test(e.code)
      ? e.code.slice(3).toLowerCase()
      : /^(Digit|Numpad)[0-9]$/.test(e.code)
        ? e.code.slice(-1)
        : e.key.length === 1
          ? e.key.toLowerCase()
          : '';
    if (!ch) return;
    let idx = top.items.findIndex((i) => i.hint && i.hint.toLowerCase() === ch);
    if (idx === -1 && /^[1-9]$/.test(ch)) {
      const n = Number(ch) - 1;
      if (n < top.items.length) idx = n;
    }
    if (idx >= 0) {
      e.preventDefault();
      this.renderer.setHover(idx);
      this.activate(idx, top.spec.center, 'keyboard');
    }
  }

  private keyboardSelect(idx: number): void {
    this.keyboardMode = true;
    window.clearTimeout(this.hoverTimer);
    this.renderer.setHover(idx);
    this.renderer.pointAt(idx);
    this.renderer.setHubNote(null);
  }

  /** Tab order is clockwise from the top. */
  private cycle(step: number): void {
    const angles = this.top.spec.angles;
    if (!angles.length) return;
    const order = angles.map((a, i) => ({ a, i })).sort((x, y) => x.a - y.a).map((o) => o.i);
    const current = order.indexOf(this.renderer.hoveredIndex);
    const next = current === -1 ? (step > 0 ? 0 : order.length - 1) : (current + step + order.length) % order.length;
    this.keyboardSelect(order[next]!);
  }

  // ───────────────────────── selection ─────────────────────────

  private selectAt(p: Vec2, how: 'click' | 'release'): void {
    const idx = this.hit(p);
    if (idx === NONE) {
      // Clicking the hub goes back one level, or closes the root menu.
      if (how === 'click') {
        if (this.levels.length > 1) this.back();
        else void this.close();
      }
      return;
    }
    if (idx === PARENT) {
      this.back();
      return;
    }
    this.activate(idx, p, 'pointer');
  }

  private activate(idx: number, at: Vec2, via: Via): void {
    const item = this.top.items[idx];
    if (!item) return;
    switch (item.action.type) {
      case 'submenu':
        this.openSubmenu(idx, at, via);
        return;
      case 'menu':
        this.switchMenu(item.action.menuId);
        return;
      case 'none':
        this.renderer.setHubNote('No action assigned');
        return;
      default:
        this.execute(idx);
    }
  }

  private execute(idx: number): void {
    const p = this.payload;
    const item = this.top.items[idx];
    if (!p || !item || this.closing) return;
    this.closing = true;
    window.clearTimeout(this.pauseTimer);
    window.clearTimeout(this.hoverTimer);
    this.renderer.pulse(idx);
    bridge.select({ sessionId: p.sessionId, menuId: p.menu.id, path: [...this.top.path, item.id] });
  }

  private switchMenu(menuId: string): void {
    const p = this.payload;
    if (!p || menuId === p.menu.id) return;
    bridge.switchMenu({ sessionId: p.sessionId, menuId, center: this.top.spec.center });
  }

  private openSubmenu(idx: number, at: Vec2, via: Via): void {
    const p = this.payload!;
    const a = p.settings.appearance;
    const parent = this.top;
    const item = parent.items[idx]!;
    const pc = parent.spec.center;
    const minDist = Math.max(this.nav.minParentDistance, parent.spec.ringRadius * a.scale * 0.9);

    // Pointer selections open where the pointer is (at least minDist away from
    // the parent) so a stroke can continue; keyboard ones open past the item.
    let center: Vec2;
    if (via === 'pointer' && distance(at, pc) > this.nav.deadZone) {
      const dir = angleOf(at.x - pc.x, at.y - pc.y);
      center = pointAt(pc, dir, Math.max(distance(at, pc), minDist));
    } else {
      center = pointAt(pc, parent.spec.angles[idx]!, minDist);
    }

    const build = (c: Vec2) =>
      buildLevel(item.name, item.icon, item.children, c, angleOf(pc.x - c.x, pc.y - c.y), a, p.menuNames);
    let level = build(center);
    const clamped = clampCenter(center, levelExtent(level, a), p.workArea);
    if (distance(clamped, center) > 0.5) level = build(clamped);

    this.levels.push({ spec: level, items: item.children, path: [...parent.path, item.id] });
    this.renderer.push(level, via === 'pointer' ? at : pointAt(pc, parent.spec.angles[idx]!, parent.spec.ringRadius));

    if (via === 'pointer') {
      // Only move the pointer if it would otherwise land on an item of the new
      // ring; a small offset stays inside the dead zone and is left alone.
      if (distance(level.center, at) > this.nav.deadZone * 0.8) this.warp(level.center);
      if (this.gesture.isActive) this.gesture.setOrigin(level.center);
    } else {
      this.keyboardSelect(NONE);
    }
    if (this.pointer && !this.keyboardMode) this.updateHover(this.pointer);
  }

  private back(): void {
    if (this.levels.length <= 1) {
      void this.close();
      return;
    }
    this.levels.pop();
    this.renderer.pop();
    if (this.gesture.isActive) this.gesture.setOrigin(this.top.spec.center);
    if (this.pointer && !this.keyboardMode) this.updateHover(this.pointer);
  }

  /** Moves the real pointer (and our idea of it) to a point in the overlay. */
  private warp(to: Vec2): void {
    const p = this.payload;
    if (!p || !p.canWarpPointer || !p.settings.navigation.warpPointer) return;
    bridge.warpPointer({ sessionId: p.sessionId, x: to.x, y: to.y });
    this.pointer = { ...to };
  }
}

async function boot(): Promise<void> {
  if (import.meta.env.DEV && !window.orbitMenu) (await import('../dev/mocks')).installMenuMock();
  bridge = window.orbitMenu;
  new OverlayController(document.getElementById('orbit')!);
}

void boot();
