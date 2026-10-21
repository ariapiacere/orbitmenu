// Production build: esbuild bundles the main process and the two preload
// scripts, Vite builds both renderer pages. Output goes to dist/.
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

export const mainBuildOptions = {
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  // Native / runtime-provided modules stay external and ship in node_modules.
  external: ['electron', 'koffi', 'electron-squirrel-startup'],
  logLevel: 'info',
  alias: { '@shared': resolve(root, 'src/shared') },
};

export const mainEntries = [
  { entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.js' },
  { entryPoints: ['src/preload/menu.ts'], outfile: 'dist/preload/menu.js' },
  { entryPoints: ['src/preload/settings.ts'], outfile: 'dist/preload/settings.js' },
];

async function main() {
  rmSync(resolve(root, 'dist/main'), { recursive: true, force: true });
  rmSync(resolve(root, 'dist/preload'), { recursive: true, force: true });
  await Promise.all(mainEntries.map((e) => esbuild({ ...mainBuildOptions, ...e })));
  await viteBuild({ configFile: resolve(root, 'vite.config.ts'), logLevel: 'warn' });
  console.log('OrbitMenu build complete.');
}

if (!watch && fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
