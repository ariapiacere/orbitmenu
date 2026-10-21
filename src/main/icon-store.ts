// Icon images chosen by the user are copied into OrbitMenu's own folder, so a
// menu keeps its icons when the original file is moved or deleted. Copies are
// named by content hash (identical images are stored once) and referenced in
// the config as "icons/<file>", relative to the store.
//
// Location: the install root of a Squirrel installation
// (%LOCALAPPDATA%\OrbitMenu\icons), which survives updates — the versioned
// app-x.y.z folder next to it is replaced by every update. A portable copy
// uses the folder next to OrbitMenu.exe; if that is not writable, or in
// development, the per-user config folder is used.
import { app } from 'electron';
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import type { IconSpec, MenuDefinition, MenuItem } from '@shared/types';
import { expandEnv } from './actions/process';
import { log } from './log';

export const ICON_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'];
export const MAX_ICON_BYTES = 2 * 1024 * 1024;
const STORED_REF = /^icons[\\/]([0-9a-f]{16}\.[a-z]+)$/i;

let storeDir: string | null = null;

function writable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function iconStoreDir(): string {
  if (storeDir) return storeDir;
  const fallback = join(app.getPath('userData'), 'icons');
  let dir = fallback;
  if (app.isPackaged) {
    const exeDir = dirname(process.execPath);
    const squirrelRoot = resolve(exeDir, '..');
    dir = existsSync(join(squirrelRoot, 'Update.exe')) ? join(squirrelRoot, 'icons') : join(exeDir, 'icons');
    if (!writable(dir)) {
      log.warn(`Icon folder ${dir} is not writable; using ${fallback}.`);
      dir = fallback;
    }
  }
  mkdirSync(dir, { recursive: true });
  storeDir = dir;
  return dir;
}

export function isStoredIcon(path: string): boolean {
  return STORED_REF.test(path.trim());
}

/** Absolute file for a stored reference ("icons/ab12….png"), or null. */
export function storedIconFile(ref: string): string | null {
  const m = STORED_REF.exec(ref.trim());
  return m ? join(iconStoreDir(), m[1]!.toLowerCase()) : null;
}

/** Copies an image into the store and returns its reference. Throws a readable error. */
export function adoptIcon(source: string): string {
  if (isStoredIcon(source)) return source.replace(/\\/g, '/');
  const path = expandEnv(source.trim().replace(/^"(.*)"$/, '$1'));
  if (!isAbsolute(path) || !existsSync(path)) throw new Error(`Image not found: ${path}`);
  const ext = extname(path).toLowerCase();
  if (!ICON_EXTENSIONS.includes(ext)) throw new Error(`${ext || 'This file type'} is not a supported image (PNG, JPG, SVG, ICO, WebP, GIF, BMP).`);
  if (statSync(path).size > MAX_ICON_BYTES) throw new Error('The image is larger than 2 MB.');
  const data = readFileSync(path);
  const name = `${createHash('sha1').update(data).digest('hex').slice(0, 16)}${ext === '.jpeg' ? '.jpg' : ext}`;
  const target = join(iconStoreDir(), name);
  if (!existsSync(target)) copyFileSync(path, target);
  return `icons/${name}`;
}

/**
 * Copies every image icon that still points outside the store into it and
 * rewrites the references. Missing files are left untouched and reported.
 */
export function adoptMenuIcons(menus: MenuDefinition[]): { menus: MenuDefinition[]; changed: boolean; failed: string[] } {
  let changed = false;
  const failed: string[] = [];
  const fix = (icon: IconSpec): IconSpec => {
    if (icon.kind !== 'image' || !icon.path.trim() || isStoredIcon(icon.path)) return icon;
    try {
      const ref = adoptIcon(icon.path);
      changed = true;
      return { kind: 'image', path: ref };
    } catch (err) {
      failed.push(`${icon.path}: ${(err as Error).message}`);
      return icon;
    }
  };
  const fixItems = (items: MenuItem[]): MenuItem[] =>
    items.map((item) => ({ ...item, icon: fix(item.icon), children: fixItems(item.children) }));
  const next = menus.map((m) => ({ ...m, icon: fix(m.icon), items: fixItems(m.items) }));
  return { menus: changed ? next : menus, changed, failed };
}

function storedRefs(menus: readonly MenuDefinition[]): Set<string> {
  const refs = new Set<string>();
  const visit = (icon: IconSpec) => {
    if (icon.kind === 'image' && isStoredIcon(icon.path)) refs.add(icon.path.replace(/\\/g, '/'));
  };
  const walk = (items: readonly MenuItem[]) =>
    items.forEach((i) => {
      visit(i.icon);
      walk(i.children);
    });
  for (const m of menus) {
    visit(m.icon);
    walk(m.items);
  }
  return refs;
}

/** Base64 copies of the icons a configuration uses, for export bundles. */
export function exportIconFiles(menus: readonly MenuDefinition[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ref of storedRefs(menus)) {
    const file = storedIconFile(ref);
    if (file && existsSync(file)) out[ref] = readFileSync(file).toString('base64');
  }
  return out;
}

/** Writes icons from an export bundle into the store. Unknown names are ignored. */
export function importIconFiles(files: unknown): number {
  if (!files || typeof files !== 'object') return 0;
  let written = 0;
  for (const [ref, b64] of Object.entries(files as Record<string, unknown>)) {
    const file = storedIconFile(ref);
    if (!file || typeof b64 !== 'string') continue;
    const data = Buffer.from(b64, 'base64');
    if (data.length === 0 || data.length > MAX_ICON_BYTES) continue;
    // The name is the content hash; skip data that does not match it.
    if (!basename(file).startsWith(createHash('sha1').update(data).digest('hex').slice(0, 16))) continue;
    if (!existsSync(file)) writeFileSync(file, data);
    written++;
  }
  return written;
}
