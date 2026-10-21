// Locations of bundled resources and renderer entry points.
import { app } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Root of the built app (dist/ in development and inside app.asar when packaged). */
const distRoot = join(__dirname, '..');

export function preloadPath(name: 'menu' | 'settings'): string {
  return join(distRoot, 'preload', `${name}.js`);
}

export function rendererEntry(page: 'menu' | 'settings'): { url?: string; file?: string } {
  const dev = process.env.ORBIT_DEV_SERVER_URL;
  if (dev && !app.isPackaged) return { url: `${dev}/${page}.html` };
  return { file: join(distRoot, 'renderer', `${page}.html`) };
}

/** Origin prefixes that IPC messages are accepted from. */
export function trustedRendererPrefixes(): string[] {
  const prefixes = [pathToFileURL(join(distRoot, 'renderer')).href.toLowerCase()];
  const dev = process.env.ORBIT_DEV_SERVER_URL;
  if (dev && !app.isPackaged) prefixes.push(dev);
  return prefixes;
}

export function assetPath(...parts: string[]): string {
  // assets/ sits next to dist/ both in the repo and inside the package.
  return join(distRoot, '..', 'assets', ...parts);
}
