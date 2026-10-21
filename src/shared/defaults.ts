// First-run configuration: sensible settings and two example menus that show
// off every action type without touching anything destructive.
import type { ActionConfig, IconSpec, MenuDefinition, MenuItem, Settings } from './types';
import { MENUS_VERSION, parseSettings } from './schema';
import { randomId } from './ids';

export function defaultSettings(): Settings {
  return parseSettings({});
}

const lucide = (name: string): IconSpec => ({ kind: 'lucide', name });

function item(
  name: string,
  icon: IconSpec,
  action: ActionConfig,
  extra: Partial<MenuItem> = {},
): MenuItem {
  return {
    id: randomId(),
    name,
    description: '',
    icon,
    hint: '',
    fixedAngle: null,
    action,
    children: [],
    ...extra,
  };
}

function submenu(name: string, icon: IconSpec, children: MenuItem[], extra: Partial<MenuItem> = {}): MenuItem {
  return item(name, icon, { type: 'submenu' }, { children, ...extra });
}

const keys = (name: string, icon: string, combo: string, hint = '') =>
  item(name, lucide(icon), { type: 'hotkey', keys: combo }, { hint });
const launch = (name: string, icon: IconSpec, path: string, args = '') =>
  item(name, icon, { type: 'launch', path, args, cwd: '' });
const folder = (name: string, icon: string, path: string) =>
  item(name, lucide(icon), { type: 'open', path, reveal: false });
const web = (name: string, icon: string, url: string) => item(name, lucide(icon), { type: 'url', url });
const snippet = (name: string, icon: IconSpec, text: string) =>
  item(name, icon, { type: 'text', text, method: 'paste', restoreClipboard: true });

export const MAIN_MENU_ID = 'main';
export const QUICK_EDIT_MENU_ID = 'quick-edit';

export function defaultMenus(): MenuDefinition[] {
  const main: MenuDefinition = {
    id: MAIN_MENU_ID,
    name: 'Orbit',
    icon: lucide('Orbit'),
    shortcut: 'Ctrl+Space',
    enabled: true,
    openAt: 'cursor',
    items: [
      submenu(
        'Apps',
        lucide('LayoutGrid'),
        [
          launch('Notepad', { kind: 'auto' }, 'notepad.exe'),
          launch('Calculator', lucide('Calculator'), 'calc.exe'),
          launch('Paint', lucide('Palette'), 'mspaint.exe'),
          launch('Command Prompt', lucide('SquareTerminal'), 'cmd.exe'),
          launch('Explorer', lucide('FolderTree'), 'explorer.exe'),
        ],
        { hint: 'A' },
      ),
      submenu(
        'Web',
        lucide('Globe'),
        [
          web('Search', 'Search', 'https://www.google.com'),
          web('YouTube', 'SquarePlay', 'https://www.youtube.com'),
          web('GitHub', 'GitBranch', 'https://github.com'),
          web('Wikipedia', 'BookOpen', 'https://www.wikipedia.org'),
          web('Windows Settings', 'Settings', 'ms-settings:'),
        ],
        { hint: 'W' },
      ),
      item('Quick edit', lucide('PencilLine'), { type: 'menu', menuId: QUICK_EDIT_MENU_ID }, {
        hint: 'E',
        description: 'Switches to the Quick Edit menu.',
      }),
      submenu(
        'Windows',
        lucide('AppWindow'),
        [
          keys('Show desktop', 'Monitor', 'Super+D'),
          keys('Task view', 'LayoutPanelTop', 'Super+Tab'),
          keys('Snip screen', 'Scissors', 'Super+Shift+S'),
          keys('Clipboard history', 'ClipboardList', 'Super+V'),
          keys('Task Manager', 'Activity', 'Ctrl+Shift+Escape'),
          item('Focus Explorer', lucide('FolderSearch'), {
            type: 'focus',
            processName: 'explorer.exe',
            title: '',
            titleMatch: 'contains',
            launchPath: 'explorer.exe',
          }),
          item('Lock PC', lucide('Lock'), {
            type: 'command',
            command: 'rundll32.exe',
            args: 'user32.dll,LockWorkStation',
            cwd: '',
            confirm: 'always',
            console: false,
          }),
        ],
        { hint: 'N' },
      ),
      submenu(
        'Media',
        lucide('Music'),
        [
          keys('Play / Pause', 'CirclePlay', 'MediaPlayPause'),
          keys('Next track', 'SkipForward', 'MediaNextTrack'),
          keys('Volume up', 'Volume2', 'VolumeUp'),
          keys('Mute', 'VolumeX', 'VolumeMute'),
          keys('Volume down', 'Volume1', 'VolumeDown'),
          keys('Previous track', 'SkipBack', 'MediaPreviousTrack'),
        ],
        { hint: 'M' },
      ),
      submenu(
        'Snippets',
        lucide('TextQuote'),
        [
          snippet('Thanks', { kind: 'emoji', value: '🙏' }, 'Thanks a lot!'),
          snippet('Sign-off', lucide('Signature'), 'Best regards,\n'),
          snippet('Shrug', { kind: 'emoji', value: '🤷' }, '¯\\_(ツ)_/¯'),
          item('Type greeting', lucide('Keyboard'), {
            type: 'text',
            text: 'Hello from OrbitMenu ✨',
            method: 'type',
            restoreClipboard: false,
          }),
        ],
        { hint: 'S' },
      ),
      submenu(
        'Folders',
        lucide('Folder'),
        [
          folder('Home', 'House', '%USERPROFILE%'),
          folder('Downloads', 'Download', '%USERPROFILE%\\Downloads'),
          folder('Documents', 'FileText', '%USERPROFILE%\\Documents'),
          folder('Desktop', 'Monitor', '%USERPROFILE%\\Desktop'),
          folder('Pictures', 'Image', '%USERPROFILE%\\Pictures'),
        ],
        { hint: 'F' },
      ),
      item(
        'Notepad demo',
        lucide('Sparkles'),
        {
          type: 'macro',
          stopOnError: true,
          steps: [
            { id: randomId(), type: 'launch', path: 'notepad.exe', args: '' },
            { id: randomId(), type: 'delay', ms: 1200 },
            { id: randomId(), type: 'text', text: 'Written by an OrbitMenu macro.', method: 'type' },
            { id: randomId(), type: 'keys', keys: 'Enter' },
          ],
        },
        { hint: 'D', description: 'Opens Notepad and types a line.' },
      ),
    ],
  };

  const quickEdit: MenuDefinition = {
    id: QUICK_EDIT_MENU_ID,
    name: 'Quick Edit',
    icon: lucide('PencilLine'),
    shortcut: 'Ctrl+Alt+Space',
    enabled: true,
    openAt: 'cursor',
    items: [
      keys('Copy', 'Copy', 'Ctrl+C', 'C'),
      keys('Paste', 'ClipboardPaste', 'Ctrl+V', 'V'),
      keys('Redo', 'Redo2', 'Ctrl+Y', 'Y'),
      keys('Save', 'Save', 'Ctrl+S', 'S'),
      keys('Select all', 'TextSelect', 'Ctrl+A', 'A'),
      keys('Find', 'Search', 'Ctrl+F', 'F'),
      keys('Undo', 'Undo2', 'Ctrl+Z', 'Z'),
      keys('Cut', 'Scissors', 'Ctrl+X', 'X'),
    ],
  };

  return [main, quickEdit];
}

export function defaultMenusFile() {
  return { version: MENUS_VERSION, menus: defaultMenus() };
}
