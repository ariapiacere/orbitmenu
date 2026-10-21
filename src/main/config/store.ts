// Configuration persistence: settings.json and menus.json in the user data
// folder. Writes are atomic (temp file + rename) and keep a .bak of the last
// good version; unreadable files are set aside instead of being overwritten.
import { EventEmitter } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { MenuDefinition, MenuItem, OrbitConfig, Settings } from '@shared/types';
import { MENUS_VERSION, SETTINGS_VERSION, parseMenusFile, parseSettings } from '@shared/schema';
import { defaultMenus, defaultSettings } from '@shared/defaults';
import { normalizeShortcut } from '@shared/accelerator';
import { randomId } from '@shared/ids';
import { log } from '../log';

type FileKind = 'settings' | 'menus';

const hash = (text: string) => createHash('sha1').update(text).digest('hex');

export interface ExportBundle {
  app: 'OrbitMenu';
  exportedAt: string;
  settings: Settings;
  menus: MenuDefinition[];
  /** Copies of stored icon images (reference → base64), so icons travel with the export. */
  iconFiles?: Record<string, string>;
}

export class ConfigStore extends EventEmitter {
  readonly dir: string;
  private readonly files: Record<FileKind, string>;
  private lastWritten: Partial<Record<FileKind, string>> = {};
  private watcher: FSWatcher | null = null;
  private reloadTimer: NodeJS.Timeout | null = null;

  settings: Settings = defaultSettings();
  menus: MenuDefinition[] = [];
  loadWarnings: string[] = [];

  constructor(dir: string) {
    super();
    this.dir = dir;
    this.files = { settings: join(dir, 'settings.json'), menus: join(dir, 'menus.json') };
  }

  get config(): OrbitConfig {
    return { settings: this.settings, menus: this.menus };
  }

  load(): void {
    mkdirSync(this.dir, { recursive: true });
    this.loadWarnings = [];
    const settingsRaw = this.readJson('settings');
    this.settings = parseSettings(this.migrate('settings', settingsRaw));
    const menusRaw = this.readJson('menus');
    if (menusRaw === undefined) {
      this.menus = defaultMenus();
    } else {
      const parsed = parseMenusFile(this.migrate('menus', menusRaw));
      if (parsed.issues.length) {
        this.loadWarnings.push(`menus.json could not be read (${parsed.issues[0]}); default menus were loaded.`);
        this.setAside('menus');
        this.menus = defaultMenus();
      } else {
        this.menus = sanitizeMenus(parsed.value.menus);
      }
    }
    // Persist defaults and any repaired values so the files on disk are complete.
    this.writeAll();
    for (const w of this.loadWarnings) log.warn(w);
  }

  /** Validates and saves a configuration coming from the editor. */
  save(config: OrbitConfig): { ok: boolean; errors: string[] } {
    const settings = parseSettings(config.settings);
    const parsed = parseMenusFile({ version: MENUS_VERSION, menus: config.menus });
    if (parsed.issues.length) return { ok: false, errors: parsed.issues };
    this.settings = settings;
    this.menus = sanitizeMenus(parsed.value.menus);
    this.writeAll();
    return { ok: true, errors: [] };
  }

  reset(): void {
    this.settings = { ...defaultSettings(), general: { ...defaultSettings().general, firstRunDone: true } };
    this.menus = defaultMenus();
    this.writeAll();
  }

  exportBundle(): ExportBundle {
    return { app: 'OrbitMenu', exportedAt: new Date().toISOString(), settings: this.settings, menus: this.menus };
  }

  /**
   * Imports an exported bundle (or a bare menus.json). Throws with a readable
   * message. Returns the bundle's icon files for the caller to store.
   */
  importBundle(text: string): unknown {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error('The file is not valid JSON.');
    }
    if (!raw || typeof raw !== 'object') throw new Error('The file does not contain an OrbitMenu configuration.');
    const obj = raw as Record<string, unknown>;
    if (!Array.isArray(obj.menus)) throw new Error('The file has no "menus" list.');
    const parsed = parseMenusFile({ version: MENUS_VERSION, menus: obj.menus });
    if (parsed.issues.length) throw new Error(`The menus are invalid: ${parsed.issues[0]}`);
    if (obj.settings) this.settings = parseSettings(obj.settings);
    this.menus = sanitizeMenus(parsed.value.menus);
    this.writeAll();
    return obj.iconFiles;
  }

  /** Reloads when the files are edited by hand while the app runs. */
  watch(): void {
    if (this.watcher) return;
    try {
      this.watcher = watch(this.dir, (_event, filename) => {
        if (filename !== 'settings.json' && filename !== 'menus.json') return;
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => this.reloadIfChanged(), 300);
      });
    } catch (err) {
      log.warn('Config folder cannot be watched:', err);
    }
  }

  dispose(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  private reloadIfChanged(): void {
    let changed = false;
    for (const kind of ['settings', 'menus'] as const) {
      try {
        const text = readFileSync(this.files[kind], 'utf8');
        if (hash(text) !== this.lastWritten[kind]) changed = true;
      } catch {
        // A missing file while an editor saves is transient; ignore.
      }
    }
    if (!changed) return;
    log.info('Configuration changed on disk; reloading.');
    this.load();
    this.emit('changed');
  }

  private readJson(kind: FileKind): unknown {
    for (const file of [this.files[kind], `${this.files[kind]}.bak`]) {
      if (!existsSync(file)) continue;
      try {
        const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
        const value = JSON.parse(text);
        if (file.endsWith('.bak')) this.loadWarnings.push(`${kind}.json was damaged; restored the backup copy.`);
        return value;
      } catch (err) {
        if (file === this.files[kind]) {
          this.loadWarnings.push(`${kind}.json is not valid JSON (${(err as Error).message}).`);
          this.setAside(kind);
        }
      }
    }
    return undefined;
  }

  private migrate(kind: FileKind, raw: unknown): unknown {
    if (!raw || typeof raw !== 'object') return raw;
    const version = (raw as { version?: unknown }).version;
    const current = kind === 'settings' ? SETTINGS_VERSION : MENUS_VERSION;
    if (typeof version === 'number' && version > current) {
      this.loadWarnings.push(`${kind}.json was written by a newer OrbitMenu (format ${version}); unknown fields are ignored.`);
    }
    // Format 1 is the first public format; future migrations go here.
    return raw;
  }

  /** Moves a broken file out of the way so the user can recover it by hand. */
  private setAside(kind: FileKind): void {
    const file = this.files[kind];
    if (!existsSync(file)) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = file.replace(/\.json$/, `.broken-${stamp}.json`);
    try {
      renameSync(file, target);
      this.loadWarnings.push(`The unreadable file was kept as ${target}.`);
    } catch (err) {
      log.warn('Could not set aside broken config file:', err);
    }
  }

  private writeAll(): void {
    this.writeFile('settings', { ...this.settings, version: SETTINGS_VERSION });
    this.writeFile('menus', { version: MENUS_VERSION, menus: this.menus });
  }

  private writeFile(kind: FileKind, data: unknown): void {
    const file = this.files[kind];
    const text = JSON.stringify(data, null, 2) + '\n';
    if (this.lastWritten[kind] === hash(text) && existsSync(file)) return;
    try {
      if (existsSync(file)) copyFileSync(file, `${file}.bak`);
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, text, 'utf8');
      renameSync(tmp, file);
      this.lastWritten[kind] = hash(text);
    } catch (err) {
      log.error(`Failed to write ${file}:`, err);
      throw new Error(`Could not save ${kind}.json: ${(err as Error).message}`);
    }
  }
}

/** Repairs things the schema cannot express: duplicate ids, stale children, shortcut spelling. */
export function sanitizeMenus(menus: MenuDefinition[]): MenuDefinition[] {
  const menuIds = new Set<string>();
  const itemIds = new Set<string>();
  const fixItems = (items: MenuItem[]): MenuItem[] =>
    items.map((item) => {
      let id = item.id;
      while (itemIds.has(id)) id = randomId();
      itemIds.add(id);
      return {
        ...item,
        id,
        // Children of non-submenu items are kept so that switching the type back restores them.
        children: fixItems(item.children),
      };
    });
  return menus.map((menu) => {
    let id = menu.id;
    while (menuIds.has(id)) id = randomId();
    menuIds.add(id);
    return { ...menu, id, shortcut: normalizeShortcut(menu.shortcut), items: fixItems(menu.items) };
  });
}
