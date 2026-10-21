// Icon rendering shared by the overlay and the editor. Lucide icons are
// bundled (no network access needed); image and shell icons arrive from the
// main process as data URLs.
import { createElement, icons, type IconNode } from 'lucide';
import type { ActionConfig, IconSpec } from '@shared/types';
import { iconTargetOf } from '@shared/tree';
import { ACTION_TYPE_INFO } from '@shared/describe';

const lucideIcons = icons as Record<string, IconNode>;

/** Unique icon names (the lucide export also contains aliases). */
export const LUCIDE_NAMES: string[] = (() => {
  const seen = new Set<IconNode>();
  const names: string[] = [];
  for (const [name, node] of Object.entries(lucideIcons)) {
    if (seen.has(node)) continue;
    seen.add(node);
    names.push(name);
  }
  return names.sort();
})();

export function hasLucideIcon(name: string): boolean {
  return name in lucideIcons;
}

export function lucideSvg(name: string, strokeWidth = 1.8): SVGElement | null {
  const node = lucideIcons[name];
  if (!node) return null;
  const svg = createElement(node, { 'stroke-width': strokeWidth, width: '100%', height: '100%' });
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

export interface IconContext {
  /** Resolved data URLs keyed by the path in the config. */
  resolved: Record<string, string>;
  /** Action of the item, used for "auto" icons and fallbacks. */
  action?: ActionConfig;
  /** Text used for a monogram fallback. */
  label?: string;
}

function monogram(label: string | undefined): HTMLElement {
  const span = document.createElement('span');
  span.className = 'om-icon-monogram';
  const letters = (label ?? '?').trim().split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2);
  span.textContent = letters.toUpperCase() || '?';
  return span;
}

function fallbackFor(ctx: IconContext): Node {
  const typeIcon = ctx.action ? ACTION_TYPE_INFO[ctx.action.type]?.icon : undefined;
  return (typeIcon && lucideSvg(typeIcon)) || monogram(ctx.label);
}

function image(src: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  img.draggable = false;
  img.className = 'om-icon-image';
  return img;
}

/** Builds the DOM for an icon. Never throws; unknown icons fall back gracefully. */
export function renderIcon(spec: IconSpec, ctx: IconContext): Node {
  switch (spec.kind) {
    case 'lucide':
      return lucideSvg(spec.name) ?? fallbackFor(ctx);
    case 'emoji': {
      const span = document.createElement('span');
      span.className = 'om-icon-emoji';
      span.textContent = spec.value;
      return span;
    }
    case 'image': {
      const src = ctx.resolved[spec.path];
      return src ? image(src) : fallbackFor(ctx);
    }
    case 'auto': {
      const target = ctx.action ? iconTargetOf(ctx.action) : null;
      const src = target ? ctx.resolved[target] : undefined;
      return src ? image(src) : fallbackFor(ctx);
    }
    case 'none':
      return monogram(ctx.label);
  }
}
