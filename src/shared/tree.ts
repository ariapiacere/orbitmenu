// Helpers for walking and editing the item tree immutably.
import type { ActionConfig, ActionType, MacroStep, MenuDefinition, MenuItem } from './types';
import { randomId } from './ids';
import { LIMITS } from './limits';

/** Follows a path of item ids from the menu root. Returns null if any id is missing. */
export function itemAtPath(menu: MenuDefinition, path: readonly string[]): MenuItem | null {
  let items = menu.items;
  let found: MenuItem | null = null;
  for (const id of path) {
    found = items.find((i) => i.id === id) ?? null;
    if (!found) return null;
    items = found.children;
  }
  return found;
}

/** Children shown at a path: the root items for [], otherwise the submenu's children. */
export function childrenAtPath(menu: MenuDefinition, path: readonly string[]): MenuItem[] | null {
  if (path.length === 0) return menu.items;
  const item = itemAtPath(menu, path);
  return item && item.action.type === 'submenu' ? item.children : null;
}

/** Replaces the children list at `path` using `fn`, returning a new menu. */
export function updateChildrenAtPath(
  menu: MenuDefinition,
  path: readonly string[],
  fn: (items: MenuItem[]) => MenuItem[],
): MenuDefinition {
  if (path.length === 0) return { ...menu, items: fn(menu.items) };
  const recurse = (items: MenuItem[], depth: number): MenuItem[] =>
    items.map((item) => {
      if (item.id !== path[depth]) return item;
      if (depth === path.length - 1) return { ...item, children: fn(item.children) };
      return { ...item, children: recurse(item.children, depth + 1) };
    });
  return { ...menu, items: recurse(menu.items, 0) };
}

export function updateItem(
  menu: MenuDefinition,
  parentPath: readonly string[],
  itemId: string,
  fn: (item: MenuItem) => MenuItem,
): MenuDefinition {
  return updateChildrenAtPath(menu, parentPath, (items) => items.map((i) => (i.id === itemId ? fn(i) : i)));
}

export function walkItems(items: readonly MenuItem[], visit: (item: MenuItem, depth: number) => void, depth = 0): void {
  for (const item of items) {
    visit(item, depth);
    if (depth < LIMITS.maxDepth) walkItems(item.children, visit, depth + 1);
  }
}

export function countItems(items: readonly MenuItem[]): number {
  let n = 0;
  walkItems(items, () => n++);
  return n;
}

/** Deep copy with fresh ids, used for duplicate and paste. */
export function cloneWithNewIds(item: MenuItem): MenuItem {
  const action: ActionConfig =
    item.action.type === 'macro'
      ? { ...item.action, steps: item.action.steps.map((s) => ({ ...s, id: randomId() }) as MacroStep) }
      : { ...item.action };
  return { ...item, id: randomId(), action, children: item.children.map(cloneWithNewIds) };
}

export function cloneMenuWithNewIds(menu: MenuDefinition): MenuDefinition {
  return { ...menu, id: randomId(), items: menu.items.map(cloneWithNewIds) };
}

export function defaultAction(type: ActionType): ActionConfig {
  switch (type) {
    case 'none':
      return { type };
    case 'submenu':
      return { type };
    case 'launch':
      return { type, path: '', args: '', cwd: '' };
    case 'open':
      return { type, path: '', reveal: false };
    case 'url':
      return { type, url: 'https://' };
    case 'hotkey':
      return { type, keys: '' };
    case 'text':
      return { type, text: '', method: 'paste', restoreClipboard: true };
    case 'command':
      return { type, command: '', args: '', cwd: '', confirm: 'auto', console: false };
    case 'menu':
      return { type, menuId: '' };
    case 'focus':
      return { type, processName: '', title: '', titleMatch: 'contains', launchPath: '' };
    case 'macro':
      return { type, steps: [], stopOnError: true };
  }
}

export function newItem(partial: Partial<MenuItem> = {}): MenuItem {
  return {
    id: randomId(),
    name: 'New item',
    description: '',
    icon: { kind: 'lucide', name: 'Circle' },
    hint: '',
    fixedAngle: null,
    action: { type: 'none' },
    children: [],
    ...partial,
  };
}

/** Path-like values an item points at, used to resolve "auto" shell icons. */
export function iconTargetOf(action: ActionConfig): string | null {
  switch (action.type) {
    case 'launch':
      return action.path || null;
    case 'open':
      return action.path || null;
    case 'command':
      return action.command.includes('\\') || action.command.includes('/') ? action.command : null;
    case 'focus':
      return action.launchPath || null;
    default:
      return null;
  }
}
