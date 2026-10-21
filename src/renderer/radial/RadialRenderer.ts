// DOM renderer for radial menus. It draws a stack of levels (the root and any
// open submenus): the top level is fully expanded, ancestors collapse into
// small hubs joined by tether lines. It knows nothing about input; a
// controller tells it what to show.
import type { AppearanceSettings, IconSpec, Vec2 } from '@shared/types';
import { annularSectorPath, computeWedges, directionOf, NONE, PARENT, angleOf } from '@shared/geometry';
import { renderIcon, lucideSvg, type IconContext } from '../common/icons';
import type { ActionConfig } from '@shared/types';

export interface RenderItem {
  id: string;
  name: string;
  icon: IconSpec;
  action: ActionConfig;
  hint: string;
  isSubmenu: boolean;
  subtitle: string;
}

export interface LevelSpec {
  title: string;
  icon: IconSpec;
  items: RenderItem[];
  angles: number[];
  parentAngle: number | null;
  center: Vec2;
  ringRadius: number;
}

interface LevelView {
  spec: LevelSpec;
  el: HTMLDivElement;
  items: HTMLDivElement[];
  wedges: SVGPathElement[];
  parentWedge: SVGPathElement | null;
  backItem: HTMLDivElement | null;
  hubTitle: HTMLDivElement;
  hubSub: HTMLDivElement;
  hubIcon: HTMLDivElement;
  needle: HTMLDivElement;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

const THEME_ACCENTS: Record<AppearanceSettings['theme'], string> = {
  nebula: '#9b8cff',
  daylight: '#4361ee',
  graphite: '#f5a524',
};

export class RadialRenderer {
  private readonly stage: HTMLDivElement;
  private readonly tethers: SVGSVGElement;
  private readonly trailCanvas: HTMLCanvasElement | null;
  private levels: LevelView[] = [];
  private appearance: AppearanceSettings | null = null;
  private resolved: Record<string, string> = {};
  private hovered = NONE;
  private trail: { x: number; y: number; t: number }[] = [];
  private trailFrame = 0;

  constructor(
    private readonly root: HTMLElement,
    opts: { trail?: boolean; preview?: boolean } = {},
  ) {
    root.classList.add('om-root');
    if (opts.preview) root.classList.add('om-preview');
    this.trailCanvas = opts.trail ? document.createElement('canvas') : null;
    if (this.trailCanvas) {
      this.trailCanvas.className = 'om-trail';
      root.appendChild(this.trailCanvas);
    }
    this.tethers = document.createElementNS(SVG_NS, 'svg');
    this.tethers.classList.add('om-tethers');
    root.appendChild(this.tethers);
    this.stage = document.createElement('div');
    this.stage.className = 'om-stage';
    root.appendChild(this.stage);
  }

  setAppearance(a: AppearanceSettings): void {
    this.appearance = a;
    const s = this.root.style;
    this.root.dataset.theme = a.theme;
    s.setProperty('--om-accent', a.accent || THEME_ACCENTS[a.theme]);
    s.setProperty('--om-item-size', `${a.itemSize}px`);
    s.setProperty('--om-hub-size', `${a.innerRadius * 2}px`);
    s.setProperty('--om-anim', `${a.animationMs}ms`);
    s.setProperty('--om-scale', String(a.scale));
    this.root.classList.toggle('om-labels-hover', a.showLabels === 'hover');
    this.root.classList.toggle('om-no-wedges', !a.showWedges);
  }

  setResolvedIcons(map: Record<string, string>): void {
    this.resolved = map;
  }

  get depth(): number {
    return this.levels.length;
  }

  clear(): void {
    this.levels = [];
    this.stage.replaceChildren();
    this.tethers.replaceChildren();
    this.hovered = NONE;
    this.clearTrail();
    this.root.classList.remove('om-closing');
  }

  /** Adds a level on top. `from` is where it grows out of (the selection point). */
  push(spec: LevelSpec, from?: Vec2, animate = true): void {
    const parent = this.levels.at(-1);
    if (parent) parent.el.classList.add('is-parent');
    const view = this.buildLevel(spec);
    this.levels.push(view);
    this.stage.appendChild(view.el);
    if (animate) this.animateIn(view, from ?? spec.center);
    this.drawTethers();
    this.hovered = NONE;
    this.applyHover(view, NONE);
  }

  /** Removes the top level and re-expands its parent. */
  pop(): void {
    const top = this.levels.pop();
    if (!top) return;
    top.el.classList.add('is-leaving');
    const el = top.el;
    window.setTimeout(() => el.remove(), this.animMs());
    const parent = this.levels.at(-1);
    if (parent) {
      parent.el.classList.remove('is-parent');
      this.hovered = NONE;
      this.applyHover(parent, NONE);
    }
    this.drawTethers();
  }

  setHover(index: number): void {
    const top = this.levels.at(-1);
    if (!top || index === this.hovered) return;
    this.hovered = index;
    this.applyHover(top, index);
  }

  get hoveredIndex(): number {
    return this.hovered;
  }

  /** Points the needle at the pointer (or hides it when null / inside the dead zone). */
  setPointer(p: Vec2 | null, deadZone = 0): void {
    const top = this.levels.at(-1);
    if (!top) return;
    if (!p) {
      top.needle.classList.remove('is-visible');
      return;
    }
    const dx = p.x - top.spec.center.x;
    const dy = p.y - top.spec.center.y;
    const dist = Math.hypot(dx, dy);
    const visible = dist > Math.max(deadZone, 4);
    top.needle.classList.toggle('is-visible', visible);
    if (visible) top.needle.style.transform = `rotate(${angleOf(dx, dy)}deg)`;
  }

  /** Points the needle at an item (keyboard navigation). */
  pointAt(index: number): void {
    const top = this.levels.at(-1);
    if (!top) return;
    const angle = index === PARENT ? top.spec.parentAngle : top.spec.angles[index];
    if (angle === undefined || angle === null) {
      top.needle.classList.remove('is-visible');
      return;
    }
    top.needle.classList.add('is-visible');
    top.needle.style.transform = `rotate(${angle}deg)`;
  }

  /** Temporary hub subtitle, e.g. "Click to run". Pass null to restore. */
  setHubNote(note: string | null): void {
    const top = this.levels.at(-1);
    if (!top) return;
    top.hubSub.dataset.note = note ?? '';
    top.hubSub.classList.toggle('has-note', !!note);
    if (note) top.hubSub.textContent = note;
    else this.applyHover(top, this.hovered);
  }

  /** Brief highlight on the chosen item. */
  pulse(index: number): void {
    const top = this.levels.at(-1);
    const el = index >= 0 ? top?.items[index] : top?.backItem;
    if (!el) return;
    el.classList.remove('is-chosen');
    void el.offsetWidth;
    el.classList.add('is-chosen');
  }

  /** Fades everything out; resolves when the animation is done. */
  close(): Promise<void> {
    this.root.classList.add('om-closing');
    return new Promise((r) => window.setTimeout(r, Math.min(this.animMs(), 160)));
  }

  addTrailPoint(p: Vec2): void {
    if (!this.trailCanvas || !this.appearance?.showTrail) return;
    this.trail.push({ x: p.x, y: p.y, t: performance.now() });
    if (this.trail.length > 240) this.trail.splice(0, this.trail.length - 240);
    if (!this.trailFrame) this.trailFrame = requestAnimationFrame(() => this.drawTrail());
  }

  clearTrail(): void {
    this.trail = [];
    if (this.trailFrame) cancelAnimationFrame(this.trailFrame);
    this.trailFrame = 0;
    const c = this.trailCanvas;
    if (c) c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  }

  // ───────────────────────── internals ─────────────────────────

  private animMs(): number {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
    return this.appearance?.animationMs ?? 160;
  }

  private buildLevel(spec: LevelSpec): LevelView {
    const a = this.appearance!;
    const scale = a.scale;
    const el = document.createElement('div');
    el.className = 'om-level';
    el.style.left = `${spec.center.x}px`;
    el.style.top = `${spec.center.y}px`;

    const inner = el.appendChild(document.createElement('div'));
    inner.className = 'om-level-inner';
    inner.style.transform = `scale(${scale})`;

    // Wedges and orbit ring.
    const outer = Math.max(a.outerRadius, spec.ringRadius + a.itemSize / 2 + 12);
    const innerR = a.innerRadius + 4;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.classList.add('om-wedges');
    svg.setAttribute('width', String(outer * 2));
    svg.setAttribute('height', String(outer * 2));
    svg.setAttribute('viewBox', `${-outer} ${-outer} ${outer * 2} ${outer * 2}`);
    const ring = document.createElementNS(SVG_NS, 'circle');
    ring.classList.add('om-ring');
    ring.setAttribute('r', String(spec.ringRadius));
    svg.appendChild(ring);
    const { items: wedgeAngles, parent: parentWedge } = computeWedges(spec.angles, spec.parentAngle);
    const gap = spec.items.length + (spec.parentAngle === null ? 0 : 1) > 1 ? 1.2 : 0;
    const wedgePath = (w: { start: number; end: number }) => {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', annularSectorPath(innerR, outer, w.start + gap / 2, w.end - gap / 2));
      path.classList.add('om-wedge');
      svg.appendChild(path);
      return path;
    };
    const wedges = wedgeAngles.map((w) => wedgePath(w));
    const parentPath = parentWedge ? wedgePath(parentWedge) : null;
    parentPath?.classList.add('is-back');
    inner.appendChild(svg);

    const needle = inner.appendChild(document.createElement('div'));
    needle.className = 'om-needle';
    needle.style.setProperty('--om-needle-len', `${spec.ringRadius - a.itemSize / 2 - 6}px`);

    // Items.
    const items = spec.items.map((item, i) => {
      const node = this.buildItem(item, spec.angles[i]!, spec.ringRadius);
      inner.appendChild(node);
      return node;
    });

    let backItem: HTMLDivElement | null = null;
    if (spec.parentAngle !== null) {
      backItem = document.createElement('div');
      backItem.className = 'om-item om-back';
      const pos = directionOf(spec.parentAngle);
      const r = spec.ringRadius * 0.82;
      backItem.style.setProperty('--x', `${pos.x * r}px`);
      backItem.style.setProperty('--y', `${pos.y * r}px`);
      const disc = backItem.appendChild(document.createElement('div'));
      disc.className = 'om-disc';
      const arrow = lucideSvg('ArrowUp', 2.2);
      if (arrow) {
        (arrow as SVGElement).style.transform = `rotate(${spec.parentAngle}deg)`;
        disc.appendChild(arrow);
      }
      inner.appendChild(backItem);
    }

    // Hub.
    const hub = inner.appendChild(document.createElement('div'));
    hub.className = 'om-hub';
    const hubIcon = hub.appendChild(document.createElement('div'));
    hubIcon.className = 'om-hub-icon';
    hubIcon.appendChild(renderIcon(spec.icon, { resolved: this.resolved, label: spec.title }));
    const hubTitle = hub.appendChild(document.createElement('div'));
    hubTitle.className = 'om-hub-title';
    const hubSub = hub.appendChild(document.createElement('div'));
    hubSub.className = 'om-hub-sub';

    if (spec.items.length === 0) {
      const empty = inner.appendChild(document.createElement('div'));
      empty.className = 'om-empty';
      empty.textContent = 'This menu is empty — add items in Settings.';
    }

    return { spec, el, items, wedges, parentWedge: parentPath, backItem, hubTitle, hubSub, hubIcon, needle };
  }

  private buildItem(item: RenderItem, angle: number, radius: number): HTMLDivElement {
    const node = document.createElement('div');
    node.className = 'om-item';
    if (item.isSubmenu) node.classList.add('is-submenu');
    const d = directionOf(angle);
    node.style.setProperty('--x', `${d.x * radius}px`);
    node.style.setProperty('--y', `${d.y * radius}px`);
    // Labels sit on the outside of the ring so they never cover the hub.
    node.dataset.side = Math.abs(d.y) > 0.55 ? (d.y < 0 ? 'top' : 'bottom') : d.x < 0 ? 'left' : 'right';

    const disc = node.appendChild(document.createElement('div'));
    disc.className = 'om-disc';
    const ctx: IconContext = { resolved: this.resolved, action: item.action, label: item.name };
    disc.appendChild(renderIcon(item.icon, ctx));
    if (item.isSubmenu) {
      const dots = disc.appendChild(document.createElement('span'));
      dots.className = 'om-sub-mark';
      dots.style.transform = `rotate(${angle}deg)`;
    }
    if (item.hint) {
      const kbd = node.appendChild(document.createElement('kbd'));
      kbd.className = 'om-hint';
      kbd.textContent = item.hint.toUpperCase();
    }
    const label = node.appendChild(document.createElement('div'));
    label.className = 'om-label';
    label.textContent = item.name;
    return node;
  }

  private animateIn(view: LevelView, from: Vec2): void {
    const el = view.el;
    const dx = from.x - view.spec.center.x;
    const dy = from.y - view.spec.center.y;
    el.style.setProperty('--from-x', `${dx}px`);
    el.style.setProperty('--from-y', `${dy}px`);
    el.classList.add('is-entering');
    // Commit the start state with a forced style flush, then start the
    // transition in the same frame: the menu is visible on the first paint.
    void el.offsetWidth;
    el.classList.remove('is-entering');
  }

  private applyHover(view: LevelView, index: number): void {
    view.items.forEach((el, i) => el.classList.toggle('is-hovered', i === index));
    view.wedges.forEach((w, i) => w.classList.toggle('is-hovered', i === index));
    view.backItem?.classList.toggle('is-hovered', index === PARENT);
    view.parentWedge?.classList.toggle('is-hovered', index === PARENT);
    view.el.classList.toggle('has-hover', index !== NONE);
    if (view.hubSub.classList.contains('has-note')) return;
    const item = index >= 0 ? view.spec.items[index] : undefined;
    view.hubIcon.replaceChildren(
      item
        ? renderIcon(item.icon, { resolved: this.resolved, action: item.action, label: item.name })
        : index === PARENT
          ? (lucideSvg('Undo2') ?? document.createTextNode('←'))
          : renderIcon(view.spec.icon, { resolved: this.resolved, label: view.spec.title }),
    );
    view.hubTitle.textContent = item ? item.name : index === PARENT ? 'Back' : view.spec.title;
    view.hubSub.textContent = item ? item.subtitle : index === PARENT ? 'Return to the previous ring' : '';
  }

  private drawTethers(): void {
    this.tethers.replaceChildren();
    for (let i = 1; i < this.levels.length; i++) {
      const a = this.levels[i - 1]!.spec.center;
      const b = this.levels[i]!.spec.center;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', String(a.x));
      line.setAttribute('y1', String(a.y));
      line.setAttribute('x2', String(b.x));
      line.setAttribute('y2', String(b.y));
      line.classList.add('om-tether');
      this.tethers.appendChild(line);
    }
  }

  private drawTrail(): void {
    this.trailFrame = 0;
    const c = this.trailCanvas;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const now = performance.now();
    const LIFE = 420;
    this.trail = this.trail.filter((p) => now - p.t < LIFE);
    if (this.trail.length > 1) {
      const accent = getComputedStyle(this.root).getPropertyValue('--om-accent').trim() || '#9b8cff';
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = accent;
      for (let i = 1; i < this.trail.length; i++) {
        const p0 = this.trail[i - 1]!;
        const p1 = this.trail[i]!;
        const life = 1 - (now - p1.t) / LIFE;
        g.globalAlpha = Math.max(0, life) * 0.85;
        g.lineWidth = 1.5 + life * 3.5;
        g.beginPath();
        g.moveTo(p0.x, p0.y);
        g.lineTo(p1.x, p1.y);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    if (this.trail.length) this.trailFrame = requestAnimationFrame(() => this.drawTrail());
  }
}
