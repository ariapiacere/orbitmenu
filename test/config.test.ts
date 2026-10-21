import { describe, expect, it } from 'vitest';
import { splitArgs, quoteArg } from '@shared/args';
import { parseMenusFile, parseSettings } from '@shared/schema';
import { defaultMenus, defaultSettings } from '@shared/defaults';
import { commandSensitivity, needsConfirmation, normalizeUrl, validateAction, validateItem, validateMenu } from '@shared/validation';
import { cloneWithNewIds, countItems, itemAtPath, newItem, updateChildrenAtPath } from '@shared/tree';
import type { MenuItem } from '@shared/types';

describe('splitArgs (CommandLineToArgvW rules)', () => {
  it('splits on whitespace and honours quotes', () => {
    expect(splitArgs('a b  "c d" e')).toEqual(['a', 'b', 'c d', 'e']);
    expect(splitArgs('--path="C:\\Program Files\\App"')).toEqual(['--path=C:\\Program Files\\App']);
  });

  it('handles backslashes before quotes', () => {
    expect(splitArgs('"a\\"b"')).toEqual(['a"b']);
    expect(splitArgs('"C:\\dir\\\\" next')).toEqual(['C:\\dir\\', 'next']);
    expect(splitArgs('C:\\a\\b')).toEqual(['C:\\a\\b']);
  });

  it('keeps empty quoted arguments and Unicode', () => {
    expect(splitArgs('"" x')).toEqual(['', 'x']);
    expect(splitArgs('"สวัสดี โลก" 日本')).toEqual(['สวัสดี โลก', '日本']);
  });

  it('round-trips through quoteArg', () => {
    const args = ['plain', 'with space', 'quote"inside', 'trail\\', 'C:\\Program Files\\x\\'];
    expect(splitArgs(args.map(quoteArg).join(' '))).toEqual(args);
  });
});

describe('schema', () => {
  it('fills every default from an empty object', () => {
    const s = parseSettings({});
    expect(s).toEqual(defaultSettings());
    expect(s.navigation.marking).toBe(true);
    expect(s.appearance.theme).toBe('nebula');
  });

  it('repairs invalid values instead of failing', () => {
    const s = parseSettings({ appearance: { theme: 'neon', itemSize: 9999 }, navigation: 'nope' });
    expect(s.appearance.theme).toBe('nebula');
    expect(s.appearance.itemSize).toBe(54);
    expect(s.navigation).toEqual(defaultSettings().navigation);
  });

  it('accepts the default menus unchanged', () => {
    const menus = defaultMenus();
    const r = parseMenusFile({ version: 1, menus });
    expect(r.issues).toEqual([]);
    expect(r.value.menus).toEqual(menus);
  });

  it('drops unknown action types to "none" and bad macro steps', () => {
    const r = parseMenusFile({
      version: 1,
      menus: [
        {
          id: 'm',
          name: 'M',
          items: [
            { id: 'a', name: 'A', action: { type: 'format-disk' } },
            { id: 'b', name: 'B', action: { type: 'macro', steps: [{ id: 's', type: 'keys', keys: 'Ctrl+C' }, { type: 'evil' }] } },
          ],
        },
      ],
    });
    const items = r.value.menus[0]!.items;
    expect(items[0]!.action).toEqual({ type: 'none' });
    expect(items[1]!.action.type === 'macro' && items[1]!.action.steps).toHaveLength(1);
  });

  it('limits nesting depth', () => {
    let node: Record<string, unknown> = { id: 'leaf', name: 'leaf', action: { type: 'none' }, children: [] };
    for (let i = 0; i < 40; i++) node = { id: `n${i}`, name: `n${i}`, action: { type: 'submenu' }, children: [node] };
    const r = parseMenusFile({ version: 1, menus: [{ id: 'm', name: 'M', items: [node] }] });
    expect(countItems(r.value.menus[0]!.items)).toBeLessThanOrEqual(14);
  });

  it('rejects a file without a menu list', () => {
    expect(parseMenusFile({ nope: true }).issues.length).toBeGreaterThan(0);
  });
});

describe('validation', () => {
  it('normalizes URLs and blocks dangerous schemes', () => {
    expect(normalizeUrl('example.com')).toEqual({ url: 'https://example.com/' });
    expect(normalizeUrl('ms-settings:display')).toEqual({ url: 'ms-settings:display' });
    expect('error' in normalizeUrl('javascript:alert(1)')).toBe(true);
    expect('error' in normalizeUrl('file:///C:/x')).toBe(true);
    expect('error' in normalizeUrl('not a url')).toBe(true);
  });

  it('flags sensitive commands', () => {
    expect(commandSensitivity('shutdown.exe', '/s /t 0').sensitive).toBe(true);
    expect(commandSensitivity('powershell', '-Command Remove-Item x -Recurse').sensitive).toBe(true);
    expect(commandSensitivity('C:\\Tools\\git.exe', 'status').sensitive).toBe(false);
    expect(
      needsConfirmation({ type: 'command', command: 'git', args: 'status', cwd: '', confirm: 'always', console: false }).sensitive,
    ).toBe(true);
    expect(
      needsConfirmation({ type: 'command', command: 'del', args: 'x', cwd: '', confirm: 'never', console: false }).sensitive,
    ).toBe(false);
  });

  it('reports missing fields and dangling menu links', () => {
    expect(validateAction({ type: 'launch', path: '', args: '', cwd: '' }, new Set())[0]?.level).toBe('error');
    expect(validateAction({ type: 'menu', menuId: 'gone' }, new Set(['main']))[0]?.message).toMatch(/no longer exists/);
    expect(validateAction({ type: 'hotkey', keys: 'Ctrl+Nope' }, new Set())[0]?.level).toBe('error');
    expect(validateAction({ type: 'focus', processName: '', title: '(', titleMatch: 'regex', launchPath: '' }, new Set())[0]?.level).toBe('error');
  });

  it('accepts all default menus', () => {
    const menus = defaultMenus();
    const ids = new Set(menus.map((m) => m.id));
    for (const menu of menus) {
      expect(validateMenu(menu).filter((i) => i.level === 'error')).toEqual([]);
      const walk = (items: MenuItem[]) =>
        items.forEach((item) => {
          expect(validateItem(item, ids).filter((i) => i.level === 'error')).toEqual([]);
          walk(item.children);
        });
      walk(menu.items);
    }
  });
});

describe('tree helpers', () => {
  it('finds and edits items by path', () => {
    const [main] = defaultMenus();
    const apps = main!.items[0]!;
    const notepad = apps.children[0]!;
    expect(itemAtPath(main!, [apps.id, notepad.id])?.name).toBe('Notepad');
    const edited = updateChildrenAtPath(main!, [apps.id], (items) => [...items, newItem({ name: 'Extra' })]);
    expect(itemAtPath(edited, [apps.id])!.children.at(-1)!.name).toBe('Extra');
    expect(main!.items[0]!.children.length).toBe(apps.children.length);
  });

  it('clones with fresh ids', () => {
    const [main] = defaultMenus();
    const copy = cloneWithNewIds(main!.items[0]!);
    expect(copy.id).not.toBe(main!.items[0]!.id);
    expect(copy.children[0]!.id).not.toBe(main!.items[0]!.children[0]!.id);
  });
});
