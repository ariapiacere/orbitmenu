import { describe, expect, it } from 'vitest';
import {
  activationShortcutError,
  displayShortcut,
  normalizeShortcut,
  parseShortcut,
  sendShortcutError,
  shortcutFromKeyEvent,
  toElectronAccelerator,
} from '@shared/accelerator';

describe('parseShortcut', () => {
  it('parses and orders modifiers', () => {
    const r = parseShortcut('shift+ctrl+s');
    expect(r.ok && r.value).toEqual({ modifiers: ['Ctrl', 'Shift'], key: 'S' });
  });

  it('accepts aliases', () => {
    expect(normalizeShortcut('Control+Option+Return')).toBe('Ctrl+Alt+Enter');
    expect(normalizeShortcut('Win+Shift+s')).toBe('Super+Shift+S');
    expect(normalizeShortcut('CmdOrCtrl+Esc')).toBe('Ctrl+Escape');
  });

  it('handles the plus key', () => {
    expect(normalizeShortcut('Ctrl++')).toBe('Ctrl+Plus');
  });

  it('allows modifier-only combinations for sending', () => {
    const r = parseShortcut('Super');
    expect(r.ok && r.value).toEqual({ modifiers: ['Super'], key: null });
    expect(sendShortcutError('Super')).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(parseShortcut('Ctrl+Foo').ok).toBe(false);
    expect(parseShortcut('A+B').ok).toBe(false);
    expect(parseShortcut('').ok).toBe(false);
    expect(parseShortcut('S+Ctrl').ok).toBe(false);
  });
});

describe('activation shortcuts', () => {
  it('requires a key and a modifier (except F-keys and media keys)', () => {
    expect(activationShortcutError('Ctrl+Space')).toBeNull();
    expect(activationShortcutError('F13')).toBeNull();
    expect(activationShortcutError('MediaPlayPause')).toBeNull();
    expect(activationShortcutError('Ctrl')).not.toBeNull();
    expect(activationShortcutError('A')).not.toBeNull();
    expect(activationShortcutError('Shift+A')).not.toBeNull();
    expect(activationShortcutError('Ctrl+Pause')).not.toBeNull();
  });

  it('converts to Electron accelerators', () => {
    const p = parseShortcut('Ctrl+Alt+Num5');
    expect(p.ok && toElectronAccelerator(p.value)).toBe('Ctrl+Alt+num5');
  });
});

describe('recording from key events', () => {
  const ev = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods,
  });

  it('uses physical keys, independent of layout', () => {
    expect(shortcutFromKeyEvent(ev('KeyQ', { ctrlKey: true }))).toBe('Ctrl+Q');
    expect(shortcutFromKeyEvent(ev('Slash', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+/');
    expect(shortcutFromKeyEvent(ev('Numpad7', { altKey: true }))).toBe('Alt+Num7');
    expect(shortcutFromKeyEvent(ev('Space', { metaKey: true }))).toBe('Super+Space');
    expect(shortcutFromKeyEvent(ev('KeyS', { metaKey: true, shiftKey: true }))).toBe('Super+Shift+S');
  });

  it('returns null while only modifiers are pressed', () => {
    expect(shortcutFromKeyEvent(ev('ControlLeft', { ctrlKey: true }))).toBeNull();
  });

  it('displays Win instead of Super', () => {
    expect(displayShortcut('Super+Shift+S')).toBe('Win + Shift + S');
  });
});
