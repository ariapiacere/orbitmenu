// Converts configured items into what the renderer draws for one ring.
import type { AppearanceSettings, IconSpec, MenuItem, Vec2 } from '@shared/types';
import { computeItemAngles, ringRadiusFor } from '@shared/geometry';
import { describeAction } from '@shared/describe';
import type { LevelSpec, RenderItem } from './RadialRenderer';

export function toRenderItems(items: readonly MenuItem[], menuNames: Record<string, string>): RenderItem[] {
  const menus = Object.entries(menuNames).map(([id, name]) => ({ id, name }));
  return items.map((item) => ({
    id: item.id,
    name: item.name || 'Untitled',
    icon: item.icon,
    action: item.action,
    hint: item.hint,
    isSubmenu: item.action.type === 'submenu',
    subtitle:
      item.description ||
      (item.action.type === 'submenu'
        ? `${item.children.length} item${item.children.length === 1 ? '' : 's'}`
        : describeAction(item.action, menus)),
  }));
}

/** Preferred distance of items from the centre, between hub and outer edge. */
export function preferredRing(a: AppearanceSettings): number {
  return Math.max(a.innerRadius + a.itemSize / 2 + 16, (a.innerRadius + a.outerRadius) / 2);
}

export function buildLevel(
  title: string,
  icon: IconSpec,
  items: readonly MenuItem[],
  center: Vec2,
  parentAngle: number | null,
  appearance: AppearanceSettings,
  menuNames: Record<string, string>,
): LevelSpec {
  const angles = computeItemAngles(items, parentAngle);
  const ringRadius = ringRadiusFor(angles, parentAngle, preferredRing(appearance), appearance.itemSize);
  return { title, icon, items: toRenderItems(items, menuNames), angles, parentAngle, center, ringRadius };
}

/**
 * Half-width and half-height (screen px) a level needs so items and labels are
 * not cut off at screen edges. Labels beside left/right items are wider than
 * labels above or below items, hence separate extents.
 */
export function levelExtent(level: LevelSpec, a: AppearanceSettings): Vec2 {
  const base = level.ringRadius + a.itemSize / 2;
  const hoverOnly = a.showLabels === 'hover';
  // Hover labels still appear, so leave room for them too, just less.
  const x = base + (hoverOnly ? 90 : 120);
  const y = base + 34;
  return { x: x * a.scale + 6, y: y * a.scale + 6 };
}
