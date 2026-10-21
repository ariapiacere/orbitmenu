import { describe, expect, it } from 'vitest';
import { GestureEngine, applySensitivity, type GestureOptions } from '@shared/gestures';

const OPTS: GestureOptions = {
  deadZone: 40,
  dragThreshold: 12,
  minStrokeLength: 100,
  minStrokeAngle: 25,
  jitter: 8,
  fixedStrokeLength: 0,
};

/** Feeds a straight line of points from a to b in `steps` steps. */
function line(engine: GestureEngine, a: [number, number], b: [number, number], steps = 20) {
  const out = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const c = engine.move({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t });
    if (c) out.push(c);
  }
  return out;
}

describe('GestureEngine', () => {
  it('treats small movements as a click, not a drag', () => {
    const g = new GestureEngine(OPTS);
    g.begin({ x: 0, y: 0 }, { x: 0, y: 0 });
    line(g, [0, 0], [6, 0], 3);
    expect(g.hasDragged).toBe(false);
  });

  it('does not select on a straight stroke', () => {
    const g = new GestureEngine(OPTS);
    g.begin({ x: 0, y: 0 }, { x: 0, y: 0 });
    expect(line(g, [0, 0], [0, -300], 30)).toEqual([]);
    expect(g.hasDragged).toBe(true);
  });

  it('detects a corner after a long enough stroke', () => {
    const g = new GestureEngine(OPTS);
    g.begin({ x: 0, y: 0 }, { x: 0, y: 0 });
    expect(line(g, [0, 0], [0, -150], 15)).toEqual([]);
    const hits = line(g, [0, -150], [120, -150], 12);
    expect(hits[0]?.reason).toBe('corner');
    expect(hits[0]!.point.y).toBeCloseTo(-150);
    expect(Math.abs(hits[0]!.point.x)).toBeLessThan(15);
  });

  it('ignores corners in short strokes', () => {
    const g = new GestureEngine(OPTS);
    g.begin({ x: 0, y: 0 }, { x: 0, y: 0 });
    line(g, [0, 0], [0, -50], 5);
    expect(line(g, [0, -50], [80, -50], 8)).toEqual([]);
  });

  it('continues from a new origin after a submenu opened', () => {
    const g = new GestureEngine(OPTS);
    g.begin({ x: 0, y: 0 }, { x: 0, y: 0 });
    line(g, [0, 0], [0, -150], 15);
    const [corner] = line(g, [0, -150], [120, -150], 12);
    g.setOrigin(corner!.point);
    // Second leg must again be long before another corner counts.
    expect(line(g, [120, -150], [160, -150], 4)).toEqual([]);
  });

  it('selects on a pause only away from the centre', () => {
    const g = new GestureEngine(OPTS);
    g.begin({ x: 0, y: 0 }, { x: 0, y: 0 });
    line(g, [0, 0], [0, -30], 3);
    expect(g.pause({ x: 0, y: -30 })).toBeNull();
    line(g, [0, -30], [0, -90], 6);
    expect(g.pause({ x: 0, y: -90 })?.reason).toBe('pause');
  });

  it('supports a fixed stroke length', () => {
    const g = new GestureEngine({ ...OPTS, fixedStrokeLength: 120 });
    g.begin({ x: 0, y: 0 }, { x: 0, y: 0 });
    const hits = line(g, [0, 0], [130, 0], 13);
    expect(hits.some((h) => h.reason === 'length')).toBe(true);
  });

  it('filters jitter', () => {
    const g = new GestureEngine(OPTS);
    g.begin({ x: 0, y: 0 }, { x: 0, y: 0 });
    line(g, [0, 0], [0, -150], 15);
    // A wobble smaller than the jitter threshold is not a corner.
    expect(g.move({ x: 4, y: -152 })).toBeNull();
  });

  it('scales distances with sensitivity', () => {
    const s = applySensitivity(OPTS, 2);
    expect(s.minStrokeLength).toBe(50);
    expect(s.dragThreshold).toBe(6);
    expect(s.minStrokeAngle).toBe(OPTS.minStrokeAngle);
  });
});
