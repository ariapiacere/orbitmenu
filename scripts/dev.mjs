// Development runner: Vite dev server for the renderers (with HMR for the
// settings UI), esbuild in watch mode for main + preload, and an Electron
// process that restarts whenever the main bundle changes.
import { context } from 'esbuild';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { mainBuildOptions, mainEntries } from './build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electronPath = require('electron');

const server = await createServer({ configFile: resolve(root, 'vite.config.ts') });
await server.listen();
const url = `http://localhost:${server.config.server.port}`;
console.log(`[dev] renderer dev server at ${url}`);

let child = null;
let restartTimer = null;
function startElectron() {
  if (child) {
    child.removeAllListeners('exit');
    child.kill();
  }
  child = spawn(electronPath, ['.'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ORBIT_DEV_SERVER_URL: url },
  });
  child.on('exit', (code) => {
    console.log(`[dev] electron exited (${code}); stopping dev runner`);
    process.exit(code ?? 0);
  });
}

const restartPlugin = {
  name: 'restart-electron',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) return;
      clearTimeout(restartTimer);
      restartTimer = setTimeout(startElectron, 150);
    });
  },
};

for (const entry of mainEntries) {
  const ctx = await context({ ...mainBuildOptions, ...entry, plugins: [restartPlugin] });
  await ctx.watch();
}
