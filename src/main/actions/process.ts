// Starting programs safely: arguments are passed as an array with shell: false,
// so nothing the user typed is ever interpreted by cmd.exe. Batch files are the
// one exception Windows forces on us (they always run through cmd.exe), so
// their arguments are restricted to characters cmd.exe treats literally.
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, dirname, extname, isAbsolute, join } from 'node:path';
import { shell } from 'electron';
import { CMD_METACHARACTERS, splitArgs } from '@shared/args';
import { ActionError } from './engine';
import { log } from '../log';

/** Expands %VARIABLE% references using the current environment. */
export function expandEnv(input: string): string {
  return input.replace(/%([^%\s]+)%/g, (match, name: string) => process.env[name] ?? match);
}

const DIRECT_EXTENSIONS = new Set(['.exe', '.com']);
const BATCH_EXTENSIONS = new Set(['.bat', '.cmd']);

const pathCache = new Map<string, string | null>();

/** Finds a bare program name ("notepad.exe", "code") on PATH, like the shell would. */
export function findOnPath(name: string): string | null {
  if (isAbsolute(name) || /[\\/]/.test(name)) return existsSync(name) ? name : null;
  const key = name.toLowerCase();
  if (pathCache.has(key)) return pathCache.get(key)!;
  const exts = extname(name) ? [''] : (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';');
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  let found: string | null = null;
  outer: for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext.toLowerCase());
      if (existsSync(candidate)) {
        found = candidate;
        break outer;
      }
    }
  }
  pathCache.set(key, found);
  return found;
}

export interface StartOptions {
  args: string;
  cwd: string;
  /** Show the program window. False starts it hidden (useful for background commands). */
  console: boolean;
}

/** Resolves when the process has started; rejects with a readable error otherwise. */
export async function startProgram(rawPath: string, opts: StartOptions): Promise<void> {
  const path = expandEnv(rawPath.trim().replace(/^"(.*)"$/, '$1'));
  if (!path) throw new ActionError('No program is set.');
  const resolved = findOnPath(path) ?? (isAbsolute(path) ? null : path);
  if (isAbsolute(path) && !existsSync(path)) throw new ActionError(`Program not found: ${path}`);
  if (resolved && existsSync(resolved) && statSync(resolved).isDirectory()) {
    throw new ActionError(`${path} is a folder. Use "Open file or folder" instead.`);
  }

  const target = resolved ?? path;
  const ext = extname(target).toLowerCase();
  const args = splitArgs(expandEnv(opts.args));
  const cwd = opts.cwd.trim() ? expandEnv(opts.cwd.trim()) : isAbsolute(target) ? dirname(target) : undefined;
  if (cwd && !existsSync(cwd)) throw new ActionError(`Working folder not found: ${cwd}`);

  if (ext === '.ps1') {
    throw new ActionError('PowerShell scripts need the "Run command" action with powershell.exe -File <script>.');
  }

  // Shortcuts, Control Panel items, documents… let the Windows shell decide.
  if (ext && !DIRECT_EXTENSIONS.has(ext) && !BATCH_EXTENSIONS.has(ext)) {
    if (args.length) throw new ActionError(`Arguments cannot be passed to ${ext} files; point the item at the program itself.`);
    const err = await shell.openPath(target);
    if (err) throw new ActionError(err);
    return;
  }

  let command = target;
  let argv = args;
  if (BATCH_EXTENSIONS.has(ext)) {
    const unsafe = [target, ...args].find((a) => CMD_METACHARACTERS.test(a));
    if (unsafe !== undefined) {
      throw new ActionError(`Batch files run through cmd.exe, which would interpret special characters in "${unsafe}".`);
    }
    command = process.env.ComSpec ?? 'cmd.exe';
    argv = ['/d', '/c', target, ...args];
  }

  await new Promise<void>((resolve, reject) => {
    let child;
    try {
      child = spawn(command, argv, {
        cwd,
        shell: false,
        detached: true,
        stdio: 'ignore',
        // Hidden windows suit background commands; launched apps must stay visible.
        windowsHide: !opts.console,
      });
    } catch (err) {
      reject(new ActionError(`Could not start ${path}: ${(err as Error).message}`));
      return;
    }
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
    child.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') reject(new ActionError(`Program not found: ${path}`));
      else if (err.code === 'EACCES' || err.code === 'EPERM') reject(new ActionError(`Windows refused to start ${path} (it may require administrator rights).`));
      else reject(new ActionError(`Could not start ${path}: ${err.message}`));
    });
    child.once('exit', (code) => {
      if (code) log.info(`${path} exited with code ${code}`);
    });
  });
}
