// Turns icon references into data URLs the sandboxed renderers can display:
// local image files are read directly, everything else uses the Windows shell
// icon of the file, folder or program (app.getFileIcon).
import { app } from 'electron';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import type { MenuDefinition } from '@shared/types';
import { iconTargetOf, walkItems } from '@shared/tree';
import { expandEnv, findOnPath } from './actions/process';
import { storedIconFile } from './icon-store';
import { log } from './log';

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const cache = new Map<string, string | null>();

async function resolveOne(raw: string): Promise<string | null> {
  const stored = storedIconFile(raw);
  const path = stored ?? expandEnv(raw.trim().replace(/^"(.*)"$/, '$1'));
  if (!path) return null;
  const full = stored ?? findOnPath(path);
  if (!full || !existsSync(full)) return null;
  const ext = extname(full).toLowerCase();
  const mime = IMAGE_TYPES[ext];
  try {
    if (mime && ext !== '.ico') {
      if (statSync(full).size > MAX_IMAGE_BYTES) return null;
      return `data:${mime};base64,${readFileSync(full).toString('base64')}`;
    }
    const icon = await app.getFileIcon(full, { size: 'large' });
    return icon.isEmpty() ? null : icon.toDataURL();
  } catch (err) {
    log.debug(`No icon for ${full}:`, (err as Error).message);
    return null;
  }
}

export async function resolveIcons(paths: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    [...new Set(paths)].map(async (p) => {
      if (!cache.has(p)) cache.set(p, await resolveOne(p));
      const v = cache.get(p);
      if (v) out[p] = v;
    }),
  );
  return out;
}

/** Every icon path a menu needs, so they can be resolved before it opens. */
export function iconPathsOf(menus: readonly MenuDefinition[]): string[] {
  const paths: string[] = [];
  for (const menu of menus) {
    if (menu.icon.kind === 'image') paths.push(menu.icon.path);
    walkItems(menu.items, (item) => {
      if (item.icon.kind === 'image') paths.push(item.icon.path);
      if (item.icon.kind === 'auto') {
        const target = iconTargetOf(item.action);
        if (target) paths.push(target);
      }
    });
  }
  return paths;
}

export function clearIconCache(): void {
  cache.clear();
}
