// Editor state (zustand). Every edit goes through `update`, which records undo
// history (coalescing rapid edits to the same field) and schedules a debounced
// save to the main process.
import { create } from 'zustand';
import type { ConfigSnapshot, PlatformInfo, UpdateState } from '@shared/ipc';
import type { HotkeyStatus, MenuDefinition, MenuItem, OrbitConfig, Settings } from '@shared/types';
import {
  childrenAtPath,
  cloneMenuWithNewIds,
  cloneWithNewIds,
  newItem,
  updateChildrenAtPath,
  iconTargetOf,
  walkItems,
} from '@shared/tree';
import { randomId } from '@shared/ids';
import { LIMITS } from '@shared/limits';
import { api } from './api';

export type View = { kind: 'menu'; menuId: string } | { kind: 'general' } | { kind: 'about' };
export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

export interface Toast {
  id: string;
  kind: 'ok' | 'error' | 'info';
  text: string;
}

interface HistoryEntry {
  config: OrbitConfig;
  key: string | null;
  at: number;
}

interface EditorState {
  loaded: boolean;
  config: OrbitConfig;
  hotkeys: HotkeyStatus[];
  info: PlatformInfo | null;
  loadWarnings: string[];
  view: View;
  /** Submenu path (item ids) inside the selected menu. */
  path: string[];
  selectedItemId: string | null;
  saveState: SaveState;
  saveErrors: string[];
  past: HistoryEntry[];
  future: OrbitConfig[];
  icons: Record<string, string>;
  toasts: Toast[];
  updateInfo: UpdateState | null;

  init(s: ConfigSnapshot): void;
  applyExternal(s: ConfigSnapshot): void;
  update(fn: (c: OrbitConfig) => OrbitConfig, coalesceKey?: string): void;
  undo(): void;
  redo(): void;
  setView(v: View): void;
  setPath(path: string[]): void;
  selectItem(id: string | null): void;
  toast(text: string, kind?: Toast['kind']): void;
  dismissToast(id: string): void;
}

const EMPTY: OrbitConfig = { settings: {} as Settings, menus: [] };
const HISTORY_LIMIT = 100;
const COALESCE_MS = 1200;
let saveTimer: number | undefined;

export const useEditor = create<EditorState>((set, get) => ({
  loaded: false,
  config: EMPTY,
  hotkeys: [],
  info: null,
  loadWarnings: [],
  view: { kind: 'general' },
  path: [],
  selectedItemId: null,
  saveState: 'saved',
  saveErrors: [],
  past: [],
  future: [],
  icons: {},
  toasts: [],
  updateInfo: null,

  init(s) {
    const first = s.config.menus[0];
    set({
      loaded: true,
      config: s.config,
      hotkeys: s.hotkeys,
      info: s.info,
      loadWarnings: s.loadWarnings,
      view: first ? { kind: 'menu', menuId: first.id } : { kind: 'general' },
      path: [],
      selectedItemId: null,
    });
    void refreshIcons();
  },

  applyExternal(s) {
    // The files changed on disk (or were imported): take them as the new truth.
    const { view } = get();
    const stillThere = view.kind !== 'menu' || s.config.menus.some((m) => m.id === view.menuId);
    set({
      config: s.config,
      hotkeys: s.hotkeys,
      loadWarnings: s.loadWarnings,
      past: [],
      future: [],
      saveState: 'saved',
      ...(stillThere ? {} : { view: { kind: 'general' as const }, path: [], selectedItemId: null }),
    });
    void refreshIcons();
  },

  update(fn, coalesceKey) {
    const { config, past } = get();
    const next = fn(config);
    if (next === config) return;
    const now = Date.now();
    const last = past.at(-1);
    const coalesce = coalesceKey && last && last.key === coalesceKey && now - last.at < COALESCE_MS;
    const history = coalesce
      ? [...past.slice(0, -1), { ...last!, at: now }]
      : [...past, { config, key: coalesceKey ?? null, at: now }].slice(-HISTORY_LIMIT);
    set({ config: next, past: history, future: [], saveState: 'pending' });
    scheduleSave();
  },

  undo() {
    const { past, config, future } = get();
    const prev = past.at(-1);
    if (!prev) return;
    set({ config: prev.config, past: past.slice(0, -1), future: [config, ...future], saveState: 'pending' });
    fixSelection();
    scheduleSave();
  },

  redo() {
    const { past, config, future } = get();
    const next = future[0];
    if (!next) return;
    set({ config: next, past: [...past, { config, key: null, at: 0 }], future: future.slice(1), saveState: 'pending' });
    fixSelection();
    scheduleSave();
  },

  setView(view) {
    set({ view, path: [], selectedItemId: null });
  },

  setPath(path) {
    set({ path, selectedItemId: null });
  },

  selectItem(id) {
    set({ selectedItemId: id });
  },

  toast(text, kind = 'info') {
    const id = randomId();
    set({ toasts: [...get().toasts, { id, kind, text }] });
    window.setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3200);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveNow(), 350);
}

export async function saveNow(): Promise<void> {
  window.clearTimeout(saveTimer);
  const { config } = useEditor.getState();
  useEditor.setState({ saveState: 'saving' });
  try {
    const r = await api().saveConfig(config);
    // A newer edit may have happened while saving; keep it pending in that case.
    const current = useEditor.getState().config;
    useEditor.setState({
      hotkeys: r.hotkeys,
      saveErrors: r.errors,
      saveState: !r.ok ? 'error' : current === config ? 'saved' : 'pending',
    });
    if (!r.ok) useEditor.getState().toast(`Could not save: ${r.errors[0] ?? 'unknown error'}`, 'error');
  } catch (err) {
    useEditor.setState({ saveState: 'error', saveErrors: [(err as Error).message] });
  }
  void refreshIcons();
}

/** After undo/redo the selected menu, path or item may no longer exist. */
function fixSelection(): void {
  const { view, config, path, selectedItemId } = useEditor.getState();
  if (view.kind !== 'menu') return;
  const menu = config.menus.find((m) => m.id === view.menuId);
  if (!menu) {
    useEditor.setState({ view: config.menus[0] ? { kind: 'menu', menuId: config.menus[0].id } : { kind: 'general' }, path: [], selectedItemId: null });
    return;
  }
  const items = childrenAtPath(menu, path);
  if (!items) {
    useEditor.setState({ path: [], selectedItemId: null });
    return;
  }
  if (selectedItemId && !items.some((i) => i.id === selectedItemId)) useEditor.setState({ selectedItemId: null });
}

async function refreshIcons(): Promise<void> {
  const { config, icons } = useEditor.getState();
  const wanted = new Set<string>();
  for (const menu of config.menus) {
    if (menu.icon.kind === 'image') wanted.add(menu.icon.path);
    walkItems(menu.items, (item) => {
      if (item.icon.kind === 'image') wanted.add(item.icon.path);
      if (item.icon.kind === 'auto') {
        const t = iconTargetOf(item.action);
        if (t) wanted.add(t);
      }
    });
  }
  const missing = [...wanted].filter((p) => p && !(p in icons));
  if (!missing.length) return;
  try {
    const resolved = await api().resolveIcons(missing);
    // Remember misses too, so they are not requested on every save.
    const misses = Object.fromEntries(missing.filter((p) => !(p in resolved)).map((p) => [p, '']));
    useEditor.setState({ icons: { ...useEditor.getState().icons, ...misses, ...resolved } });
  } catch {
    // Icons are cosmetic.
  }
}

// ───────────────────────── selectors & operations ─────────────────────────

export function currentMenu(s: EditorState = useEditor.getState()): MenuDefinition | null {
  const v = s.view;
  return v.kind === 'menu' ? (s.config.menus.find((m) => m.id === v.menuId) ?? null) : null;
}

// A shared empty list keeps zustand selectors referentially stable.
const NO_ITEMS: MenuItem[] = [];

export function currentItems(s: EditorState = useEditor.getState()): MenuItem[] {
  const menu = currentMenu(s);
  return menu ? (childrenAtPath(menu, s.path) ?? NO_ITEMS) : NO_ITEMS;
}

const editMenu = (menuId: string, fn: (m: MenuDefinition) => MenuDefinition, key?: string) =>
  useEditor.getState().update((c) => ({ ...c, menus: c.menus.map((m) => (m.id === menuId ? fn(m) : m)) }), key);

export const ops = {
  updateSettings(fn: (s: Settings) => Settings, key?: string) {
    useEditor.getState().update((c) => ({ ...c, settings: fn(c.settings) }), key);
  },

  updateMenu(menuId: string, patch: Partial<MenuDefinition>, key?: string) {
    editMenu(menuId, (m) => ({ ...m, ...patch }), key);
  },

  addMenu() {
    const { config } = useEditor.getState();
    if (config.menus.length >= LIMITS.maxMenus) return;
    const menu: MenuDefinition = {
      id: randomId(),
      name: `Menu ${config.menus.length + 1}`,
      icon: { kind: 'lucide', name: 'Orbit' },
      shortcut: '',
      enabled: true,
      openAt: 'cursor',
      items: [
        newItem({ name: 'Website', icon: { kind: 'lucide', name: 'Globe' }, action: { type: 'url', url: 'https://' } }),
        newItem({ name: 'Program', icon: { kind: 'auto' }, action: { type: 'launch', path: '', args: '', cwd: '' } }),
        newItem({ name: 'Copy', icon: { kind: 'lucide', name: 'Copy' }, action: { type: 'hotkey', keys: 'Ctrl+C' } }),
        newItem({ name: 'Paste', icon: { kind: 'lucide', name: 'ClipboardPaste' }, action: { type: 'hotkey', keys: 'Ctrl+V' } }),
      ],
    };
    useEditor.getState().update((c) => ({ ...c, menus: [...c.menus, menu] }));
    useEditor.getState().setView({ kind: 'menu', menuId: menu.id });
  },

  duplicateMenu(menuId: string) {
    const { config } = useEditor.getState();
    const src = config.menus.find((m) => m.id === menuId);
    if (!src || config.menus.length >= LIMITS.maxMenus) return;
    // The copy gets no shortcut so it does not collide with the original.
    const copy = { ...cloneMenuWithNewIds(src), name: `${src.name} copy`, shortcut: '' };
    useEditor.getState().update((c) => ({ ...c, menus: [...c.menus, copy] }));
    useEditor.getState().setView({ kind: 'menu', menuId: copy.id });
  },

  deleteMenu(menuId: string) {
    const st = useEditor.getState();
    const remaining = st.config.menus.filter((m) => m.id !== menuId);
    st.update((c) => ({ ...c, menus: c.menus.filter((m) => m.id !== menuId) }));
    st.setView(remaining[0] ? { kind: 'menu', menuId: remaining[0].id } : { kind: 'general' });
  },

  moveMenu(menuId: string, delta: number) {
    useEditor.getState().update((c) => {
      const i = c.menus.findIndex((m) => m.id === menuId);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= c.menus.length) return c;
      const menus = [...c.menus];
      [menus[i], menus[j]] = [menus[j]!, menus[i]!];
      return { ...c, menus };
    });
  },

  /** Edits the items of the level currently shown in the editor. */
  editLevel(fn: (items: MenuItem[]) => MenuItem[], key?: string) {
    const st = useEditor.getState();
    const menu = currentMenu(st);
    if (!menu) return;
    editMenu(menu.id, (m) => updateChildrenAtPath(m, st.path, fn), key);
  },

  updateItem(itemId: string, fn: (item: MenuItem) => MenuItem, key?: string) {
    ops.editLevel((items) => items.map((i) => (i.id === itemId ? fn(i) : i)), key ? `${itemId}:${key}` : undefined);
  },

  addItem(kind: 'item' | 'submenu') {
    const items = currentItems();
    if (items.length >= LIMITS.maxItemsPerLevel) {
      useEditor.getState().toast(`A ring holds at most ${LIMITS.maxItemsPerLevel} items. Use a submenu for more.`, 'info');
      return;
    }
    if (useEditor.getState().path.length >= LIMITS.maxDepth && kind === 'submenu') return;
    const item =
      kind === 'submenu'
        ? newItem({ name: 'Submenu', icon: { kind: 'lucide', name: 'CircleDot' }, action: { type: 'submenu' } })
        : newItem({ name: 'New item' });
    ops.editLevel((list) => [...list, item]);
    useEditor.getState().selectItem(item.id);
  },

  duplicateItem(itemId: string) {
    const items = currentItems();
    if (items.length >= LIMITS.maxItemsPerLevel) return;
    let copyId = '';
    ops.editLevel((list) => {
      const i = list.findIndex((x) => x.id === itemId);
      if (i < 0) return list;
      const copy = { ...cloneWithNewIds(list[i]!), name: `${list[i]!.name} copy` };
      copyId = copy.id;
      return [...list.slice(0, i + 1), copy, ...list.slice(i + 1)];
    });
    if (copyId) useEditor.getState().selectItem(copyId);
  },

  deleteItem(itemId: string) {
    ops.editLevel((list) => list.filter((x) => x.id !== itemId));
    if (useEditor.getState().selectedItemId === itemId) useEditor.getState().selectItem(null);
  },

  moveItem(from: number, to: number) {
    ops.editLevel((list) => {
      if (from === to || from < 0 || from >= list.length) return list;
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(Math.max(0, Math.min(to, next.length)), 0, moved!);
      return next;
    });
  },

  /** Moves an item out of the current level into another submenu (or the parent). */
  moveItemTo(itemId: string, targetPath: string[]) {
    const st = useEditor.getState();
    const menu = currentMenu(st);
    if (!menu) return;
    const item = (childrenAtPath(menu, st.path) ?? []).find((i) => i.id === itemId);
    const target = childrenAtPath(menu, targetPath);
    if (!item || !target) return;
    if (target.length >= LIMITS.maxItemsPerLevel) {
      st.toast('The target ring is full.', 'info');
      return;
    }
    if (targetPath.includes(itemId)) return;
    editMenu(menu.id, (m) => {
      const without = updateChildrenAtPath(m, st.path, (list) => list.filter((i) => i.id !== itemId));
      return updateChildrenAtPath(without, targetPath, (list) => [...list, item]);
    });
    st.selectItem(null);
  },

  selectItemSafe(itemId: string | null) {
    useEditor.getState().selectItem(itemId);
  },

  enterSubmenu(itemId: string) {
    const st = useEditor.getState();
    useEditor.setState({ path: [...st.path, itemId], selectedItemId: null });
  },
};
