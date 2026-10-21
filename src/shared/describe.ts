// Human-readable metadata about action types, shared by the overlay (hub
// subtitle) and the editor (type picker, list badges).
import type { ActionConfig, ActionType, MacroStepType, MenuDefinition } from './types';
import { displayShortcut } from './accelerator';

export interface ActionTypeInfo {
  type: ActionType;
  label: string;
  /** Lucide icon used for the type in the editor. */
  icon: string;
  blurb: string;
}

export const ACTION_TYPES: readonly ActionTypeInfo[] = [
  { type: 'submenu', label: 'Submenu', icon: 'CircleDot', blurb: 'Opens a nested ring of items.' },
  { type: 'launch', label: 'Launch application', icon: 'Rocket', blurb: 'Starts a program, optionally with arguments.' },
  { type: 'open', label: 'Open file or folder', icon: 'FolderOpen', blurb: 'Opens a file with its default app, or a folder in Explorer.' },
  { type: 'url', label: 'Open website', icon: 'Globe', blurb: 'Opens a link in the default browser.' },
  { type: 'hotkey', label: 'Keyboard shortcut', icon: 'Keyboard', blurb: 'Sends a key combination to the app you were using.' },
  { type: 'text', label: 'Paste text', icon: 'ClipboardType', blurb: 'Inserts a text snippet into the app you were using.' },
  { type: 'command', label: 'Run command', icon: 'SquareTerminal', blurb: 'Runs a program with arguments, without a shell.' },
  { type: 'focus', label: 'Focus window', icon: 'AppWindow', blurb: 'Brings an open window to the front.' },
  { type: 'macro', label: 'Macro', icon: 'ListVideo', blurb: 'Runs a sequence of keys, text, delays and launches.' },
  { type: 'menu', label: 'Switch menu', icon: 'Repeat2', blurb: 'Replaces this menu with another saved menu.' },
  { type: 'none', label: 'Do nothing', icon: 'Ban', blurb: 'A placeholder while you set things up.' },
];

export const ACTION_TYPE_INFO = Object.fromEntries(ACTION_TYPES.map((t) => [t.type, t])) as Record<
  ActionType,
  ActionTypeInfo
>;

export const MACRO_STEP_LABELS: Record<MacroStepType, string> = {
  keys: 'Press keys',
  delay: 'Wait',
  text: 'Insert text',
  launch: 'Launch program',
  open: 'Open file / URL',
};

function baseName(path: string): string {
  return path.trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
}

/** One-line summary of what the action does, e.g. "Launch · blender.exe". */
export function describeAction(action: ActionConfig, menus: readonly Pick<MenuDefinition, 'id' | 'name'>[] = []): string {
  switch (action.type) {
    case 'none':
      return 'No action';
    case 'submenu':
      return 'Submenu';
    case 'launch':
      return action.path ? `Launch · ${baseName(action.path)}` : 'Launch';
    case 'open':
      return action.path ? `${action.reveal ? 'Show' : 'Open'} · ${baseName(action.path)}` : 'Open';
    case 'url': {
      try {
        return `Web · ${new URL(action.url).host || action.url}`;
      } catch {
        return 'Web';
      }
    }
    case 'hotkey':
      return action.keys ? `Keys · ${displayShortcut(action.keys)}` : 'Keys';
    case 'text': {
      const preview = action.text.replace(/\s+/g, ' ').slice(0, 28);
      return `${action.method === 'type' ? 'Type' : 'Paste'} · ${preview}${action.text.length > 28 ? '…' : ''}`;
    }
    case 'command':
      return action.command ? `Run · ${baseName(action.command)}` : 'Run';
    case 'menu': {
      const target = menus.find((m) => m.id === action.menuId);
      return target ? `Menu · ${target.name}` : 'Switch menu';
    }
    case 'focus':
      return `Focus · ${action.processName || action.title || 'window'}`;
    case 'macro':
      return `Macro · ${action.steps.length} step${action.steps.length === 1 ? '' : 's'}`;
  }
}
