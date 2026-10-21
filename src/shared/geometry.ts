// Radial layout math. Angles are in degrees, 0 = straight up, increasing
// clockwise (screen coordinates, y grows downwards).
import type { Rect, Vec2 } from './types';

export const PARENT = -2;
export const NONE = -1;

export function normalizeAngle(a: number): number {
  const r = a % 360;
  return r < 0 ? r + 360 : r;
}

/** Direction of the vector (dx, dy) as a menu angle. */
export function angleOf(dx: number, dy: number): number {
  return normalizeAngle((Math.atan2(dx, -dy) * 180) / Math.PI);
}

/** Smallest absolute difference between two angles, in [0, 180]. */
export function angularDistance(a: number, b: number): number {
  const d = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return d > 180 ? 360 - d : d;
}

export function directionOf(angle: number): Vec2 {
  const r = (angle * Math.PI) / 180;
  return { x: Math.sin(r), y: -Math.cos(r) };
}

export function pointAt(center: Vec2, angle: number, radius: number): Vec2 {
  const d = directionOf(angle);
  return { x: center.x + d.x * radius, y: center.y + d.y * radius };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export interface LayoutItem {
  fixedAngle?: number | null;
}

/**
 * Fixed angles are honoured only while they increase clockwise in list order;
 * an item whose fixed angle would break that order is laid out like a free item.
 */
export function acceptedFixedAngles(items: readonly LayoutItem[]): (number | null)[] {
  let last = -1;
  return items.map((item) => {
    const a = item.fixedAngle;
    if (a === null || a === undefined || !Number.isFinite(a)) return null;
    const n = normalizeAngle(a);
    if (n <= last) return null;
    last = n;
    return n;
  });
}

/**
 * Computes the direction of every item in a level.
 *
 * Free items are spread evenly through the gaps between pinned items. When the
 * level is a submenu, `parentAngle` is the direction back to the parent; it
 * takes a slot of its own so that no child is drawn on top of the way back.
 */
export function computeItemAngles(
  items: readonly LayoutItem[],
  parentAngle: number | null = null,
): number[] {
  const n = items.length;
  if (n === 0) return [];
  const fixed = acceptedFixedAngles(items);
  const anchors = fixed.flatMap((a, i) => (a === null ? [] : [i]));
  const parent = parentAngle === null ? null : normalizeAngle(parentAngle);
  const out = new Array<number>(n);

  if (anchors.length === 0) {
    if (parent === null) {
      for (let i = 0; i < n; i++) out[i] = (i * 360) / n;
    } else {
      for (let i = 0; i < n; i++) out[i] = normalizeAngle(parent + ((i + 1) * 360) / (n + 1));
    }
    return out;
  }

  for (const i of anchors) out[i] = fixed[i]!;

  // Walk each gap between consecutive anchors (cyclically).
  for (let k = 0; k < anchors.length; k++) {
    const startIdx = anchors[k]!;
    const endIdx = anchors[(k + 1) % anchors.length]!;
    const a = fixed[startIdx]!;
    let b = fixed[endIdx]!;
    if (b <= a) b += 360;
    const free: number[] = [];
    for (let i = (startIdx + 1) % n; i !== endIdx; i = (i + 1) % n) free.push(i);
    if (free.length === 0) continue;

    let p = parent;
    if (p !== null && p < a) p += 360;
    if (p !== null && p > a && p < b) {
      // Split the gap at the parent and share the items proportionally.
      const m = free.length;
      const first = Math.round((m * (p - a)) / (b - a));
      const left = free.slice(0, first);
      const right = free.slice(first);
      left.forEach((idx, j) => (out[idx] = normalizeAngle(a + ((j + 1) * (p! - a)) / (left.length + 1))));
      right.forEach((idx, j) => (out[idx] = normalizeAngle(p! + ((j + 1) * (b - p!)) / (right.length + 1))));
    } else {
      free.forEach((idx, j) => (out[idx] = normalizeAngle(a + ((j + 1) * (b - a)) / (free.length + 1))));
    }
  }
  return out;
}

export interface Wedge {
  /** Clockwise start angle. */
  start: number;
  /** Clockwise end angle; may exceed 360 when the wedge wraps through 0. */
  end: number;
}

interface Slot {
  key: number;
  angle: number;
}

/**
 * Each item owns the angular range closest to it. Returns one wedge per item and,
 * for submenus, the wedge of the parent slot.
 */
export function computeWedges(
  angles: readonly number[],
  parentAngle: number | null = null,
): { items: Wedge[]; parent: Wedge | null } {
  const slots: Slot[] = angles.map((angle, key) => ({ key, angle: normalizeAngle(angle) }));
  if (parentAngle !== null) slots.push({ key: PARENT, angle: normalizeAngle(parentAngle) });
  const items: Wedge[] = new Array(angles.length);
  let parent: Wedge | null = null;
  if (slots.length === 0) return { items, parent };
  if (slots.length === 1) {
    const only = slots[0]!;
    const w = { start: only.angle - 180, end: only.angle + 180 };
    if (only.key === PARENT) parent = w;
    else items[only.key] = w;
    return { items, parent };
  }
  const sorted = [...slots].sort((a, b) => a.angle - b.angle);
  sorted.forEach((slot, i) => {
    const prev = sorted[(i - 1 + sorted.length) % sorted.length]!;
    const next = sorted[(i + 1) % sorted.length]!;
    let prevAngle = prev.angle;
    let nextAngle = next.angle;
    if (prevAngle >= slot.angle) prevAngle -= 360;
    if (nextAngle <= slot.angle) nextAngle += 360;
    const w = { start: (prevAngle + slot.angle) / 2, end: (slot.angle + nextAngle) / 2 };
    if (slot.key === PARENT) parent = w;
    else items[slot.key] = w;
  });
  return { items, parent };
}

/** Returns the item index nearest to `angle`, PARENT for the parent slot, or NONE. */
export function pickByAngle(
  angle: number,
  angles: readonly number[],
  parentAngle: number | null = null,
): number {
  let best = NONE;
  let bestDist = Infinity;
  angles.forEach((a, i) => {
    const d = angularDistance(angle, a);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  if (parentAngle !== null && angularDistance(angle, parentAngle) < bestDist) best = PARENT;
  return best;
}

/** The item closest to a compass direction, used for arrow-key navigation. */
export function pickNearestDirection(direction: number, angles: readonly number[]): number {
  return pickByAngle(direction, angles, null);
}

/**
 * Ring radius at which items of the given size do not overlap. Grows beyond the
 * preferred radius only when the level is crowded.
 */
export function ringRadiusFor(
  angles: readonly number[],
  parentAngle: number | null,
  preferred: number,
  itemSize: number,
  gap = 10,
): number {
  const all = [...angles, ...(parentAngle === null ? [] : [parentAngle])]
    .map(normalizeAngle)
    .sort((a, b) => a - b);
  if (all.length < 2) return preferred;
  let minSep = 360;
  for (let i = 0; i < all.length; i++) {
    const next = i === all.length - 1 ? all[0]! + 360 : all[i + 1]!;
    minSep = Math.min(minSep, next - all[i]!);
  }
  if (minSep <= 0.5) return preferred;
  const needed = (itemSize + gap) / (2 * Math.sin(((minSep / 2) * Math.PI) / 180));
  return Math.min(Math.max(preferred, needed), preferred * 2.2);
}

/**
 * Moves a menu centre so that its extent (a radius, or separate horizontal and
 * vertical half-sizes) stays inside `area`. If the area is too small along an
 * axis, the menu is centred on that axis.
 */
export function clampCenter(center: Vec2, extent: number | Vec2, area: Rect): Vec2 {
  const ex = typeof extent === 'number' ? extent : extent.x;
  const ey = typeof extent === 'number' ? extent : extent.y;
  const clampAxis = (v: number, min: number, size: number, half: number) => {
    if (size <= half * 2) return min + size / 2;
    return Math.min(Math.max(v, min + half), min + size - half);
  };
  return {
    x: clampAxis(center.x, area.x, area.width, ex),
    y: clampAxis(center.y, area.y, area.height, ey),
  };
}

/** SVG path for an annular sector between two clockwise angles. */
export function annularSectorPath(
  inner: number,
  outer: number,
  start: number,
  end: number,
): string {
  const span = end - start;
  if (span >= 359.99) {
    // Two half-arcs per ring; a single arc cannot describe a full circle.
    return [
      `M 0 ${-outer} A ${outer} ${outer} 0 1 1 0 ${outer} A ${outer} ${outer} 0 1 1 0 ${-outer} Z`,
      `M 0 ${-inner} A ${inner} ${inner} 0 1 0 0 ${inner} A ${inner} ${inner} 0 1 0 0 ${-inner} Z`,
    ].join(' ');
  }
  const large = span > 180 ? 1 : 0;
  const o0 = pointAt({ x: 0, y: 0 }, start, outer);
  const o1 = pointAt({ x: 0, y: 0 }, end, outer);
  const i1 = pointAt({ x: 0, y: 0 }, end, inner);
  const i0 = pointAt({ x: 0, y: 0 }, start, inner);
  const f = (v: number) => v.toFixed(2);
  return (
    `M ${f(o0.x)} ${f(o0.y)} A ${outer} ${outer} 0 ${large} 1 ${f(o1.x)} ${f(o1.y)} ` +
    `L ${f(i1.x)} ${f(i1.y)} A ${inner} ${inner} 0 ${large} 0 ${f(i0.x)} ${f(i0.y)} Z`
  );
}
