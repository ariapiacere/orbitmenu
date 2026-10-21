// Operating-system integration surface. Everything that needs native APIs
// (input injection, window focus, pointer warping) goes through this interface
// so that a macOS or Linux backend can be added without touching the rest.
import type { ParsedShortcut, Modifier } from '@shared/accelerator';
import type { PlatformCapabilities } from '@shared/ipc';

export interface NativeWindow {
  handle: number;
  title: string;
  className: string;
  processId: number;
  /** Lower-case executable file name, e.g. "blender.exe". */
  processName: string;
  processPath: string;
}

export interface Platform {
  readonly name: string;
  readonly capabilities: PlatformCapabilities;

  /** Window that had focus before the overlay appeared (null if unknown). */
  getForegroundWindow(): number | null;
  isWindow(handle: number): boolean;
  /** Tries hard to make `handle` the foreground window. */
  bringToForeground(handle: number): boolean;
  /** Lets programs we start take the foreground (Windows foreground lock). */
  allowForegroundForNewProcesses(): void;

  sendShortcut(shortcut: ParsedShortcut): Promise<void>;
  typeText(text: string): Promise<void>;
  /** Releases nothing; waits until the user lets go of modifier keys (or times out). */
  waitForModifiersReleased(timeoutMs: number): Promise<boolean>;
  isModifierDown(modifier: Modifier): boolean;
  /** Physical state of a non-modifier key from the shortcut catalogue. */
  isKeyDown(key: string): boolean;

  listWindows(): NativeWindow[];
  /** Moves the pointer to a point in DIP screen coordinates. */
  warpPointer(x: number, y: number): void;
}

export class UnsupportedError extends Error {
  constructor(feature: string, platform: string) {
    super(`${feature} is not supported on ${platform} yet.`);
  }
}
