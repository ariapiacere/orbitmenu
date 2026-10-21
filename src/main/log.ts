// Minimal file logger. Writes to <userData>/logs/orbitmenu.log and keeps the
// file under ~1 MB by rotating to orbitmenu.old.log.
import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

type Level = 'debug' | 'info' | 'warn' | 'error';

let logFile = '';
const MAX_BYTES = 1_000_000;

export function initLog(): string {
  const dir = join(app.getPath('userData'), 'logs');
  mkdirSync(dir, { recursive: true });
  logFile = join(dir, 'orbitmenu.log');
  try {
    if (existsSync(logFile) && statSync(logFile).size > MAX_BYTES) {
      renameSync(logFile, join(dir, 'orbitmenu.old.log'));
    }
  } catch {
    // Rotation is best effort.
  }
  return logFile;
}

export function logFilePath(): string {
  return logFile;
}

function format(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function write(level: Level, parts: unknown[]): void {
  const line = `${new Date().toISOString()} [${level}] ${parts.map(format).join(' ')}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else if (!app.isPackaged) console.log(line);
  if (!logFile) return;
  try {
    appendFileSync(logFile, line + '\n');
  } catch {
    // Never let logging crash the app.
  }
}

export const log = {
  debug: (...p: unknown[]) => {
    if (!app.isPackaged) write('debug', p);
  },
  info: (...p: unknown[]) => write('info', p),
  warn: (...p: unknown[]) => write('warn', p),
  error: (...p: unknown[]) => write('error', p),
};
