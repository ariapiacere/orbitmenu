// Marking-menu stroke analysis. The engine is DOM-free: feed it pointer
// positions and it reports where an intentional selection happened (a sharp
// corner, a pause, or a stroke that reached a fixed length). The caller decides
// whether the item under that point accepts a mid-stroke selection (submenus do,
// leaf actions wait for the button or modifier release).
import type { Vec2 } from './types';
import { distance } from './geometry';

export interface GestureOptions {
  deadZone: number;
  dragThreshold: number;
  minStrokeLength: number;
  minStrokeAngle: number;
  jitter: number;
  fixedStrokeLength: number;
}

export type StrokeReason = 'corner' | 'pause' | 'length';

export interface StrokeCandidate {
  point: Vec2;
  reason: StrokeReason;
}

/** Scales distance thresholds by the pointer sensitivity setting. */
export function applySensitivity(opts: GestureOptions, sensitivity: number): GestureOptions {
  const s = Math.max(0.1, sensitivity);
  return {
    deadZone: opts.deadZone,
    dragThreshold: opts.dragThreshold / s,
    minStrokeLength: opts.minStrokeLength / s,
    minStrokeAngle: opts.minStrokeAngle,
    jitter: opts.jitter / s,
    fixedStrokeLength: opts.fixedStrokeLength / s,
  };
}

function angleBetween(a: Vec2, b: Vec2): number {
  const la = Math.hypot(a.x, a.y);
  const lb = Math.hypot(b.x, b.y);
  if (la === 0 || lb === 0) return 0;
  const cos = Math.min(1, Math.max(-1, (a.x * b.x + a.y * b.y) / (la * lb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

export class GestureEngine {
  private opts: GestureOptions;
  private origin: Vec2 = { x: 0, y: 0 };
  private start: Vec2 = { x: 0, y: 0 };
  private anchor: Vec2 = { x: 0, y: 0 };
  private active = false;
  private dragged = false;

  constructor(opts: GestureOptions) {
    this.opts = opts;
  }

  setOptions(opts: GestureOptions): void {
    this.opts = opts;
  }

  /** Starts a stroke: `origin` is the menu centre, `start` the pointer position. */
  begin(origin: Vec2, start: Vec2): void {
    this.origin = { ...origin };
    this.start = { ...start };
    this.anchor = { ...start };
    this.active = true;
    this.dragged = false;
  }

  end(): void {
    this.active = false;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** True once the pointer travelled further than the drag threshold. */
  get hasDragged(): boolean {
    return this.dragged;
  }

  /** Called after a submenu opened mid-stroke; the stroke continues from there. */
  setOrigin(point: Vec2): void {
    this.origin = { ...point };
    this.anchor = { ...point };
  }

  move(p: Vec2): StrokeCandidate | null {
    if (!this.active) return null;
    if (!this.dragged) {
      if (distance(p, this.start) < this.opts.dragThreshold) return null;
      this.dragged = true;
    }
    if (distance(p, this.anchor) < this.opts.jitter) return null;

    let candidate: StrokeCandidate | null = null;
    const stroke = { x: this.anchor.x - this.origin.x, y: this.anchor.y - this.origin.y };
    const segment = { x: p.x - this.anchor.x, y: p.y - this.anchor.y };
    const strokeLength = Math.hypot(stroke.x, stroke.y);

    if (
      strokeLength >= this.opts.minStrokeLength &&
      angleBetween(stroke, segment) >= this.opts.minStrokeAngle
    ) {
      candidate = { point: { ...this.anchor }, reason: 'corner' };
    } else if (
      this.opts.fixedStrokeLength > 0 &&
      distance(p, this.origin) >= this.opts.fixedStrokeLength
    ) {
      candidate = { point: { ...p }, reason: 'length' };
    }
    this.anchor = { ...p };
    return candidate;
  }

  /** The caller detected that the pointer rested; decide if that is a selection. */
  pause(p: Vec2): StrokeCandidate | null {
    if (!this.active || !this.dragged) return null;
    const minDistance = Math.max(this.opts.deadZone, this.opts.minStrokeLength / 2);
    if (distance(p, this.origin) < minDistance) return null;
    return { point: { ...p }, reason: 'pause' };
  }
}
