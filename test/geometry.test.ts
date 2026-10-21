import { describe, expect, it } from 'vitest';
import {
  PARENT,
  acceptedFixedAngles,
  angleOf,
  angularDistance,
  clampCenter,
  computeItemAngles,
  computeWedges,
  normalizeAngle,
  pickByAngle,
  ringRadiusFor,
} from '@shared/geometry';

const free = (n: number) => Array.from({ length: n }, () => ({ fixedAngle: null }));

describe('angles', () => {
  it('uses 0° = up, clockwise', () => {
    expect(angleOf(0, -1)).toBeCloseTo(0);
    expect(angleOf(1, 0)).toBeCloseTo(90);
    expect(angleOf(0, 1)).toBeCloseTo(180);
    expect(angleOf(-1, 0)).toBeCloseTo(270);
  });

  it('normalizes and measures circular distance', () => {
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(720)).toBe(0);
    expect(angularDistance(350, 10)).toBe(20);
    expect(angularDistance(0, 180)).toBe(180);
  });
});

describe('computeItemAngles', () => {
  it('spreads free items evenly starting at the top', () => {
    expect(computeItemAngles(free(4))).toEqual([0, 90, 180, 270]);
    expect(computeItemAngles(free(3))).toEqual([0, 120, 240]);
  });

  it('keeps odd counts symmetric about the vertical axis', () => {
    const a = computeItemAngles(free(5));
    expect(a[0]).toBe(0);
    expect(a[1]! + a[4]!).toBeCloseTo(360);
    expect(a[2]! + a[3]!).toBeCloseTo(360);
  });

  it('reserves a slot for the parent direction', () => {
    const a = computeItemAngles(free(3), 180);
    expect(a).toEqual([270, 0, 90]);
    for (const angle of a) expect(angularDistance(angle, 180)).toBeGreaterThanOrEqual(90);
  });

  it('honours fixed angles and fills gaps between them', () => {
    const items = [{ fixedAngle: 90 }, { fixedAngle: null }, { fixedAngle: 270 }, { fixedAngle: null }];
    expect(computeItemAngles(items)).toEqual([90, 180, 270, 0]);
  });

  it('ignores fixed angles that are not increasing in list order', () => {
    expect(acceptedFixedAngles([{ fixedAngle: 200 }, { fixedAngle: 100 }, { fixedAngle: 300 }])).toEqual([200, null, 300]);
  });

  it('splits a gap around the parent', () => {
    const items = [{ fixedAngle: 0 }, { fixedAngle: null }, { fixedAngle: null }];
    const a = computeItemAngles(items, 180);
    expect(a[0]).toBe(0);
    for (const angle of a) expect(angularDistance(angle, 180)).toBeGreaterThan(30);
  });

  it('handles empty and single-item levels', () => {
    expect(computeItemAngles([])).toEqual([]);
    expect(computeItemAngles(free(1))).toEqual([0]);
  });
});

describe('selection', () => {
  it('picks the nearest item, wrapping through 0°', () => {
    const angles = [0, 90, 180, 270];
    expect(pickByAngle(10, angles)).toBe(0);
    expect(pickByAngle(350, angles)).toBe(0);
    expect(pickByAngle(134, angles)).toBe(1);
    expect(pickByAngle(136, angles)).toBe(2);
  });

  it('can pick the parent slot', () => {
    expect(pickByAngle(178, [270, 0, 90], 180)).toBe(PARENT);
  });

  it('builds wedges that tile the full circle', () => {
    const angles = computeItemAngles(free(5));
    const { items } = computeWedges(angles);
    const total = items.reduce((sum, w) => sum + (w.end - w.start), 0);
    expect(total).toBeCloseTo(360);
    items.forEach((w, i) => {
      expect(w.start).toBeLessThan(angles[i]! + (angles[i]! < w.start ? 360 : 0));
    });
  });

  it('gives a single item the whole circle', () => {
    const { items } = computeWedges([0]);
    expect(items[0]!.end - items[0]!.start).toBe(360);
  });
});

describe('layout helpers', () => {
  it('grows the ring only when items would overlap', () => {
    expect(ringRadiusFor(computeItemAngles(free(6)), null, 110, 54)).toBe(110);
    expect(ringRadiusFor(computeItemAngles(free(12)), null, 110, 54)).toBeGreaterThan(110);
  });

  it('keeps menus inside the work area', () => {
    const area = { x: 0, y: 0, width: 1000, height: 600 };
    expect(clampCenter({ x: 5, y: 5 }, 100, area)).toEqual({ x: 100, y: 100 });
    expect(clampCenter({ x: 995, y: 590 }, { x: 200, y: 120 }, area)).toEqual({ x: 800, y: 480 });
    expect(clampCenter({ x: 500, y: 300 }, 100, area)).toEqual({ x: 500, y: 300 });
    // Too large for the area: centred.
    expect(clampCenter({ x: 10, y: 10 }, 600, area)).toEqual({ x: 500, y: 300 });
  });
});
