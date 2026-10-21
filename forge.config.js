// Electron Forge packaging. `npm run package` produces out/OrbitMenu-win32-<arch>,
// `npm run make` additionally builds a Squirrel installer and a portable zip.
// Run `npm run build` first (the npm scripts do this for you).

const { existsSync, readFileSync } = require('node:fs');
const { join, relative } = require('node:path');

const KEEP_KOFFI = /^\/node_modules\/koffi\/build\/koffi\/win32_(x64|arm64)(\/|$)/;

/**
 * Folders of the production dependency tree (package.json "dependencies",
 * resolved the way Node does: nested first, then hoisted). Everything else in
 * node_modules — build tools, React, Vite — is already bundled or unneeded.
 */
function productionModules() {
  const keep = new Set();
  const visit = (name, fromDir) => {
    for (let dir = fromDir; ; dir = join(dir, '..', '..')) {
      const candidate = join(dir, 'node_modules', name);
      if (existsSync(join(candidate, 'package.json'))) {
        const rel = '/' + relative(__dirname, candidate).split('\\').join('/');
        if (keep.has(rel)) return;
        keep.add(rel);
        const pkg = JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8'));
        for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, candidate);
        return;
      }
      if (dir === __dirname || dir.length <= __dirname.length) return;
    }
  };
  const root = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));
  for (const dep of Object.keys(root.dependencies ?? {})) visit(dep, __dirname);
  return [...keep];
}

const PROD_MODULES = productionModules();

/** Everything except the built app, assets and production dependencies stays out of the package. */
function ignore(path) {
  if (!path) return false;
  if (path === '/package.json') return false;
  if (path.endsWith('.map')) return true;
  if (/^\/(dist|assets)(\/|$)/.test(path)) return false;
  if (path === '/node_modules') return false;
  if (path.startsWith('/node_modules/')) {
    // Keep a path if it is inside a production module, or is a parent folder of one.
    const wanted = PROD_MODULES.some((m) => path === m || path.startsWith(m + '/') || m.startsWith(path + '/'));
    if (!wanted) return true;
    // koffi ships binaries for every OS; keep only the Windows ones and drop its sources.
    if (path.startsWith('/node_modules/koffi/build/koffi/')) return !KEEP_KOFFI.test(path);
    if (/^\/node_modules\/koffi\/(src|vendor|doc)(\/|$)/.test(path)) return true;
    return false;
  }
  return true;
}

module.exports = {
  packagerConfig: {
    name: 'OrbitMenu',
    executableName: 'OrbitMenu',
    appBundleId: 'com.orbitmenu.app',
    appCopyright: 'Copyright © 2026 OrbitMenu contributors',
    icon: 'assets/icons/orbitmenu',
    asar: true,
    ignore,
    win32metadata: {
      CompanyName: 'OrbitMenu',
      ProductName: 'OrbitMenu',
      FileDescription: 'OrbitMenu radial launcher',
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'OrbitMenu',
        authors: 'OrbitMenu contributors',
        description: 'Radial launcher for Windows',
        exe: 'OrbitMenu.exe',
        setupExe: 'OrbitMenu-Setup.exe',
        setupIcon: 'assets/icons/orbitmenu.ico',
        noMsi: true,
      },
    },
    { name: '@electron-forge/maker-zip', platforms: ['win32'] },
  ],
  plugins: [
    // Native .node files (koffi) cannot be loaded from inside app.asar.
    { name: '@electron-forge/plugin-auto-unpack-natives', config: {} },
  ],
};
