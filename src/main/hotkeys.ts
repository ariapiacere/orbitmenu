// Global shortcut registration with per-binding status so the editor can show
// exactly which shortcuts work, which are taken by another application and
// which are duplicated between menus.
import { globalShortcut } from 'electron';
import type { HotkeyStatus } from '@shared/types';
import { activationShortcutError, parseShortcut, toElectronAccelerator, type ParsedShortcut } from '@shared/accelerator';
import { log } from './log';

export interface HotkeyBinding {
  id: string;
  label: string;
  shortcut: string;
  enabled: boolean;
  onTrigger: (shortcut: ParsedShortcut) => void;
}

export class HotkeyManager {
  private bindings: HotkeyBinding[] = [];
  private registered: string[] = [];
  private statuses: HotkeyStatus[] = [];
  private suspended = false;

  get status(): HotkeyStatus[] {
    return this.statuses;
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  apply(bindings: HotkeyBinding[]): HotkeyStatus[] {
    this.bindings = bindings;
    this.unregisterAll();
    const seen = new Map<string, string>();
    this.statuses = bindings.map((b) => this.register(b, seen));
    return this.statuses;
  }

  /** Temporarily releases all shortcuts, e.g. while the editor records a new one. */
  setSuspended(suspended: boolean): void {
    if (suspended === this.suspended) return;
    this.suspended = suspended;
    if (suspended) this.unregisterAll();
    else this.apply(this.bindings);
  }

  dispose(): void {
    this.unregisterAll();
  }

  private register(b: HotkeyBinding, seen: Map<string, string>): HotkeyStatus {
    const status = (state: HotkeyStatus['state'], message: string): HotkeyStatus => ({
      id: b.id,
      accelerator: b.shortcut,
      state,
      message,
    });
    if (!b.shortcut.trim()) return status('none', 'No shortcut assigned.');
    if (!b.enabled) return status('disabled', 'The menu is disabled.');
    const error = activationShortcutError(b.shortcut);
    const parsed = parseShortcut(b.shortcut);
    if (error || !parsed.ok) return status('invalid', error ?? 'Invalid shortcut.');
    const accelerator = toElectronAccelerator(parsed.value);
    if (!accelerator) return status('invalid', 'This key cannot be used as a global shortcut.');
    const key = accelerator.toLowerCase();
    const owner = seen.get(key);
    if (owner) return status('duplicate', `Already used by "${owner}".`);
    seen.set(key, b.label);
    if (this.suspended) return status('ok', 'Paused while recording a shortcut.');
    try {
      const ok = globalShortcut.register(accelerator, () => b.onTrigger(parsed.value));
      if (!ok) {
        log.warn(`Shortcut ${accelerator} for "${b.label}" is taken by another application.`);
        return status('conflict', 'Another application already uses this shortcut.');
      }
      this.registered.push(accelerator);
      return status('ok', 'Active.');
    } catch (err) {
      return status('invalid', `Electron rejected the shortcut: ${(err as Error).message}`);
    }
  }

  private unregisterAll(): void {
    for (const acc of this.registered) {
      try {
        globalShortcut.unregister(acc);
      } catch {
        // Already gone.
      }
    }
    this.registered = [];
  }
}
