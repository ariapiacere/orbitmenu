// Semantic checks on top of the schema: things that are structurally valid
// JSON but would fail or be unsafe at run time. Shared by the editor (inline
// warnings) and the main process (refusing to execute invalid actions).
import type { ActionConfig, MacroStep, MenuDefinition, MenuItem } from './types';
import { activationShortcutError, sendShortcutError } from './accelerator';
import { LIMITS } from './limits';

export type IssueLevel = 'error' | 'warning';

export interface Issue {
  level: IssueLevel;
  field?: string;
  message: string;
}

const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'blob:', 'file:', 'about:']);

/**
 * Normalises a URL typed by the user. Bare domains get https:// prepended.
 * Custom app schemes (ms-settings:, spotify:, steam:) are allowed; script-like
 * and local-file schemes are not (use the "Open file" action for files).
 */
export function normalizeUrl(input: string): { url: string } | { error: string } {
  const text = input.trim();
  if (!text) return { error: 'Enter a URL.' };
  let candidate = text;
  if (!/^[a-z][a-z0-9+.-]+:/i.test(candidate)) {
    if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(candidate) || /^localhost(:\d+)?([/?#].*)?$/i.test(candidate)) {
      candidate = `https://${candidate}`;
    } else {
      return { error: 'Include a scheme such as https://.' };
    }
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { error: 'This is not a valid URL.' };
  }
  if (BLOCKED_SCHEMES.has(parsed.protocol)) {
    return { error: `${parsed.protocol} links are not allowed here.` };
  }
  if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.hostname) {
    return { error: 'The URL has no host name.' };
  }
  return { url: parsed.href };
}

/** Commands whose name or arguments suggest they can destroy data or end the session. */
const SENSITIVE_COMMANDS = new Set([
  'del', 'erase', 'rd', 'rmdir', 'rm', 'format', 'diskpart', 'shutdown', 'logoff', 'reg', 'regedit',
  'bcdedit', 'cipher', 'takeown', 'icacls', 'cacls', 'net', 'netsh', 'sc', 'schtasks', 'wmic',
  'taskkill', 'vssadmin', 'wbadmin', 'manage-bde', 'mountvol', 'fsutil', 'sdelete', 'robocopy',
]);
const SHELLS = new Set(['cmd', 'powershell', 'pwsh', 'wsl', 'bash', 'sh', 'wscript', 'cscript', 'mshta']);
const SENSITIVE_WORDS =
  /\b(del|erase|rd|rmdir|rm|format|shutdown|remove-item|stop-computer|restart-computer|clear-disk|format-volume|diskpart|reg\s+delete|taskkill|stop-process|rimraf)\b|-recurse|\/mir\b/i;

export function executableBaseName(command: string): string {
  const base = command.trim().replace(/^"|"$/g, '').split(/[\\/]/).pop() ?? '';
  return base.toLowerCase().replace(/\.(exe|com|bat|cmd|ps1)$/, '');
}

export interface Sensitivity {
  sensitive: boolean;
  reason: string;
}

export function commandSensitivity(command: string, args: string): Sensitivity {
  const base = executableBaseName(command);
  if (SENSITIVE_COMMANDS.has(base)) return { sensitive: true, reason: `"${base}" can change or delete system data.` };
  if (SHELLS.has(base)) {
    if (SENSITIVE_WORDS.test(args)) return { sensitive: true, reason: 'The script contains a potentially destructive command.' };
    return { sensitive: true, reason: `Runs a ${base} script.` };
  }
  if (SENSITIVE_WORDS.test(args)) return { sensitive: true, reason: 'The arguments contain a potentially destructive command.' };
  return { sensitive: false, reason: '' };
}

/** Whether running the action needs an explicit confirmation dialog. */
export function needsConfirmation(action: ActionConfig): Sensitivity {
  if (action.type !== 'command') return { sensitive: false, reason: '' };
  if (action.confirm === 'always') return { sensitive: true, reason: 'This item always asks before running.' };
  if (action.confirm === 'never') return { sensitive: false, reason: '' };
  return commandSensitivity(action.command, action.args);
}

/**
 * Leaf actions that hover navigation must never trigger on its own: anything
 * that runs a program with side effects or replays input.
 */
export function isHoverUnsafe(action: ActionConfig): boolean {
  return action.type === 'command' || action.type === 'macro';
}

function requirePath(path: string, field: string, label: string): Issue[] {
  return path.trim() ? [] : [{ level: 'error', field, message: `${label} is required.` }];
}

export function validateMacroStep(step: MacroStep): Issue[] {
  switch (step.type) {
    case 'keys': {
      const err = sendShortcutError(step.keys);
      return err ? [{ level: 'error', field: 'keys', message: err }] : [];
    }
    case 'delay':
      return step.ms > LIMITS.maxMacroDelayMs
        ? [{ level: 'error', field: 'ms', message: `Delays are limited to ${LIMITS.maxMacroDelayMs / 1000} s.` }]
        : [];
    case 'text':
      return step.text ? [] : [{ level: 'warning', field: 'text', message: 'The text is empty.' }];
    case 'launch':
      return requirePath(step.path, 'path', 'Program');
    case 'open':
      return requirePath(step.target, 'target', 'File, folder or URL');
  }
}

export function validateAction(action: ActionConfig, menuIds: ReadonlySet<string>): Issue[] {
  switch (action.type) {
    case 'none':
      return [{ level: 'warning', message: 'This item does nothing yet. Choose an action.' }];
    case 'submenu':
      return [];
    case 'launch':
      return requirePath(action.path, 'path', 'Program');
    case 'open':
      return requirePath(action.path, 'path', 'Path');
    case 'url': {
      const r = normalizeUrl(action.url);
      return 'error' in r ? [{ level: 'error', field: 'url', message: r.error }] : [];
    }
    case 'hotkey': {
      const err = sendShortcutError(action.keys);
      return err ? [{ level: 'error', field: 'keys', message: err }] : [];
    }
    case 'text':
      return action.text ? [] : [{ level: 'warning', field: 'text', message: 'The snippet is empty.' }];
    case 'command': {
      const issues = requirePath(action.command, 'command', 'Command');
      if (action.confirm === 'never' && commandSensitivity(action.command, action.args).sensitive) {
        issues.push({ level: 'warning', field: 'confirm', message: 'This command looks sensitive but will run without asking.' });
      }
      return issues;
    }
    case 'menu':
      if (!action.menuId) return [{ level: 'error', field: 'menuId', message: 'Choose a menu.' }];
      return menuIds.has(action.menuId)
        ? []
        : [{ level: 'error', field: 'menuId', message: 'The target menu no longer exists.' }];
    case 'focus': {
      if (!action.processName.trim() && !action.title.trim()) {
        return [{ level: 'error', message: 'Enter a process name, a window title, or both.' }];
      }
      if (action.titleMatch === 'regex' && action.title) {
        try {
          new RegExp(action.title, 'i');
        } catch {
          return [{ level: 'error', field: 'title', message: 'The title pattern is not a valid regular expression.' }];
        }
      }
      return [];
    }
    case 'macro': {
      if (action.steps.length === 0) return [{ level: 'warning', field: 'steps', message: 'The macro has no steps.' }];
      const issues: Issue[] = [];
      action.steps.forEach((s, i) =>
        validateMacroStep(s).forEach((issue) => issues.push({ ...issue, field: `steps.${i}`, message: `Step ${i + 1}: ${issue.message}` })),
      );
      return issues;
    }
  }
}

export function validateItem(item: MenuItem, menuIds: ReadonlySet<string>): Issue[] {
  const issues: Issue[] = [];
  if (!item.name.trim()) issues.push({ level: 'warning', field: 'name', message: 'The item has no name.' });
  issues.push(...validateAction(item.action, menuIds));
  if (item.action.type === 'submenu') {
    if (item.children.length === 0) issues.push({ level: 'warning', message: 'The submenu is empty.' });
    if (item.children.length === 1) issues.push({ level: 'warning', message: 'Submenus work best with 2–12 items.' });
  }
  return issues;
}

export function validateMenu(menu: MenuDefinition): Issue[] {
  const issues: Issue[] = [];
  const err = activationShortcutError(menu.shortcut);
  if (err) issues.push({ level: 'error', field: 'shortcut', message: err });
  if (menu.items.length === 0) issues.push({ level: 'warning', message: 'The menu has no items.' });
  if (menu.items.length > 8) issues.push({ level: 'warning', message: 'More than 8 items per level makes gestures harder to hit; consider a submenu.' });
  return issues;
}
