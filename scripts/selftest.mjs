// Builds src/main/selftest.ts and runs it inside Electron.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mainBuildOptions } from './build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist-selftest', 'selftest.js');
await build({ ...mainBuildOptions, logLevel: 'warning', entryPoints: ['src/main/selftest.ts'], outfile: out });
const electron = createRequire(import.meta.url)('electron');
const r = spawnSync(electron, [out], { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);
