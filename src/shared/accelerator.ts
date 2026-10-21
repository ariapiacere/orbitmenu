// Keyboard shortcut parsing and formatting. One canonical text form
// ("Ctrl+Shift+S") is used for both global activation shortcuts (converted to
// Electron accelerators) and for key combinations that actions send to other
// applications (converted to Windows virtual-key codes in the main process).

export type Modifier = 'Ctrl' | 'Alt' | 'Shift' | 'Super';
// Windows convention: "Ctrl+Win+Left", "Win+Shift+S", "Ctrl+Alt+Del".
export const MODIFIER_ORDER: readonly Modifier[] = ['Ctrl', 'Super', 'Alt', 'Shift'];

const MODIFIER_ALIASES: Record<string, Modifier> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  commandorcontrol: 'Ctrl',
  cmdorctrl: 'Ctrl',
  cmd: 'Ctrl',
  command: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  menu: 'Alt',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  win: 'Super',
  windows: 'Super',
};

export interface KeyInfo {
  /** Canonical display name. */
  name: string;
  /** Electron accelerator token, or null when Electron cannot register it. */
  electron: string | null;
  aliases?: string[];
  group: 'letter' | 'digit' | 'function' | 'navigation' | 'editing' | 'punctuation' | 'numpad' | 'media' | 'system';
}

const KEYS: KeyInfo[] = [];
const add = (k: KeyInfo) => KEYS.push(k);

for (let c = 65; c <= 90; c++) {
  const ch = String.fromCharCode(c);
  add({ name: ch, electron: ch, group: 'letter' });
}
for (let d = 0; d <= 9; d++) add({ name: String(d), electron: String(d), group: 'digit' });
for (let f = 1; f <= 24; f++) add({ name: `F${f}`, electron: `F${f}`, group: 'function' });

add({ name: 'Space', electron: 'Space', group: 'editing' });
add({ name: 'Tab', electron: 'Tab', group: 'editing' });
add({ name: 'Enter', electron: 'Enter', aliases: ['Return'], group: 'editing' });
add({ name: 'Escape', electron: 'Escape', aliases: ['Esc'], group: 'editing' });
add({ name: 'Backspace', electron: 'Backspace', aliases: ['Back'], group: 'editing' });
add({ name: 'Delete', electron: 'Delete', aliases: ['Del'], group: 'editing' });
add({ name: 'Insert', electron: 'Insert', aliases: ['Ins'], group: 'editing' });
add({ name: 'Home', electron: 'Home', group: 'navigation' });
add({ name: 'End', electron: 'End', group: 'navigation' });
add({ name: 'PageUp', electron: 'PageUp', aliases: ['PgUp'], group: 'navigation' });
add({ name: 'PageDown', electron: 'PageDown', aliases: ['PgDn', 'PageDn'], group: 'navigation' });
add({ name: 'Up', electron: 'Up', aliases: ['ArrowUp'], group: 'navigation' });
add({ name: 'Down', electron: 'Down', aliases: ['ArrowDown'], group: 'navigation' });
add({ name: 'Left', electron: 'Left', aliases: ['ArrowLeft'], group: 'navigation' });
add({ name: 'Right', electron: 'Right', aliases: ['ArrowRight'], group: 'navigation' });
add({ name: 'CapsLock', electron: 'Capslock', group: 'system' });
add({ name: 'NumLock', electron: 'Numlock', group: 'system' });
add({ name: 'ScrollLock', electron: 'Scrolllock', group: 'system' });
add({ name: 'PrintScreen', electron: 'PrintScreen', aliases: ['PrtSc', 'PrintScr'], group: 'system' });
add({ name: 'Pause', electron: null, aliases: ['Break'], group: 'system' });
add({ name: 'Apps', electron: null, aliases: ['ContextMenu'], group: 'system' });

const PUNCTUATION: [string, string[]][] = [
  ['Plus', []],
  ['-', ['Minus']],
  ['=', ['Equal', 'Equals']],
  [',', ['Comma']],
  ['.', ['Period', 'Dot']],
  ['/', ['Slash']],
  [';', ['Semicolon']],
  ["'", ['Quote', 'Apostrophe']],
  ['[', ['BracketLeft']],
  [']', ['BracketRight']],
  ['\\', ['Backslash']],
  ['`', ['Backquote', 'Grave']],
];
for (const [name, aliases] of PUNCTUATION) add({ name, electron: name, aliases, group: 'punctuation' });

for (let d = 0; d <= 9; d++) add({ name: `Num${d}`, electron: `num${d}`, aliases: [`Numpad${d}`], group: 'numpad' });
add({ name: 'NumAdd', electron: 'numadd', aliases: ['NumpadAdd'], group: 'numpad' });
add({ name: 'NumSub', electron: 'numsub', aliases: ['NumpadSubtract'], group: 'numpad' });
add({ name: 'NumMult', electron: 'nummult', aliases: ['NumpadMultiply'], group: 'numpad' });
add({ name: 'NumDiv', electron: 'numdiv', aliases: ['NumpadDivide'], group: 'numpad' });
add({ name: 'NumDec', electron: 'numdec', aliases: ['NumpadDecimal'], group: 'numpad' });

add({ name: 'VolumeUp', electron: 'VolumeUp', group: 'media' });
add({ name: 'VolumeDown', electron: 'VolumeDown', group: 'media' });
add({ name: 'VolumeMute', electron: 'VolumeMute', group: 'media' });
add({ name: 'MediaPlayPause', electron: 'MediaPlayPause', aliases: ['PlayPause'], group: 'media' });
add({ name: 'MediaNextTrack', electron: 'MediaNextTrack', aliases: ['NextTrack'], group: 'media' });
add({ name: 'MediaPreviousTrack', electron: 'MediaPreviousTrack', aliases: ['PrevTrack'], group: 'media' });
add({ name: 'MediaStop', electron: 'MediaStop', group: 'media' });

export const KEY_CATALOGUE: readonly KeyInfo[] = KEYS;

const KEY_LOOKUP = new Map<string, KeyInfo>();
for (const k of KEYS) {
  KEY_LOOKUP.set(k.name.toLowerCase(), k);
  for (const a of k.aliases ?? []) KEY_LOOKUP.set(a.toLowerCase(), k);
}

export function lookupKey(token: string): KeyInfo | undefined {
  return KEY_LOOKUP.get(token.trim().toLowerCase());
}

export interface ParsedShortcut {
  modifiers: Modifier[];
  /** Canonical key name, or null for a modifier-only combination (e.g. "Super"). */
  key: string | null;
}

export type ParseOutcome = { ok: true; value: ParsedShortcut } | { ok: false; error: string };

export function parseShortcut(input: string): ParseOutcome {
  const text = input.trim();
  if (!text) return { ok: false, error: 'Shortcut is empty.' };
  // "Ctrl++" ends with a literal plus key.
  const tokens = text.split('+').map((t) => t.trim());
  if (tokens.length >= 3 && tokens.at(-1) === '' && tokens.at(-2) === '') {
    tokens.splice(-2, 2, 'Plus');
  }
  const modifiers = new Set<Modifier>();
  let key: string | null = null;
  for (const token of tokens) {
    if (!token) return { ok: false, error: `"${input}" has an empty part.` };
    const mod = MODIFIER_ALIASES[token.toLowerCase()];
    if (mod) {
      if (key) return { ok: false, error: 'Modifiers must come before the key.' };
      modifiers.add(mod);
      continue;
    }
    const info = lookupKey(token);
    if (!info) return { ok: false, error: `Unknown key "${token}".` };
    if (key) return { ok: false, error: 'A shortcut can contain only one non-modifier key.' };
    key = info.name;
  }
  return {
    ok: true,
    value: { modifiers: MODIFIER_ORDER.filter((m) => modifiers.has(m)), key },
  };
}

export function formatShortcut(p: ParsedShortcut): string {
  return [...p.modifiers, ...(p.key ? [p.key] : [])].join('+');
}

/** Canonical text form, or the trimmed input when it cannot be parsed. */
export function normalizeShortcut(input: string): string {
  const r = parseShortcut(input);
  return r.ok ? formatShortcut(r.value) : input.trim();
}

export function toElectronAccelerator(p: ParsedShortcut): string | null {
  if (!p.key) return null;
  const info = lookupKey(p.key);
  if (!info?.electron) return null;
  return [...p.modifiers, info.electron].join('+');
}

/** Validates a global activation shortcut. Returns an error message or null. */
export function activationShortcutError(input: string): string | null {
  if (!input.trim()) return null;
  const r = parseShortcut(input);
  if (!r.ok) return r.error;
  if (!r.value.key) return 'Add a non-modifier key (for example Ctrl+Space).';
  if (!toElectronAccelerator(r.value)) return `${r.value.key} cannot be used as a global shortcut.`;
  const { modifiers, key } = r.value;
  if (modifiers.length === 0 && !/^F\d+$/.test(key) && lookupKey(key)?.group !== 'media') {
    return 'Use at least one modifier (Ctrl, Alt, Shift or Win) unless the key is F1–F24 or a media key.';
  }
  if (modifiers.length === 1 && modifiers[0] === 'Shift' && lookupKey(key)?.group !== 'function') {
    return 'Shift alone would block normal typing; add Ctrl, Alt or Win.';
  }
  return null;
}

/** Validates a key combination that an action sends. Returns an error or null. */
export function sendShortcutError(input: string): string | null {
  const r = parseShortcut(input);
  if (!r.ok) return r.error;
  if (!r.value.key && r.value.modifiers.length === 0) return 'Shortcut is empty.';
  return null;
}

const CODE_TO_KEY: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  IntlBackslash: '\\',
  Backquote: '`',
  CapsLock: 'CapsLock',
  NumLock: 'NumLock',
  ScrollLock: 'ScrollLock',
  PrintScreen: 'PrintScreen',
  Pause: 'Pause',
  ContextMenu: 'Apps',
  NumpadAdd: 'NumAdd',
  NumpadSubtract: 'NumSub',
  NumpadMultiply: 'NumMult',
  NumpadDivide: 'NumDiv',
  NumpadDecimal: 'NumDec',
  AudioVolumeUp: 'VolumeUp',
  AudioVolumeDown: 'VolumeDown',
  AudioVolumeMute: 'VolumeMute',
  MediaPlayPause: 'MediaPlayPause',
  MediaTrackNext: 'MediaNextTrack',
  MediaTrackPrevious: 'MediaPreviousTrack',
  MediaStop: 'MediaStop',
};

export interface KeyEventLike {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * Converts a DOM keyboard event into a shortcut string. Uses the physical key
 * (`code`) so the result is independent of the active keyboard layout.
 * Returns null while only modifiers are held.
 */
export function shortcutFromKeyEvent(e: KeyEventLike): string | null {
  let key: string | undefined;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.code)) key = e.code;
  else if (/^Numpad[0-9]$/.test(e.code)) key = `Num${e.code.slice(6)}`;
  else key = CODE_TO_KEY[e.code];
  if (!key) return null;
  const held = new Set<Modifier>();
  if (e.ctrlKey) held.add('Ctrl');
  if (e.altKey) held.add('Alt');
  if (e.shiftKey) held.add('Shift');
  if (e.metaKey) held.add('Super');
  return formatShortcut({ modifiers: MODIFIER_ORDER.filter((m) => held.has(m)), key });
}

/** Human-friendly label ("Win" instead of "Super"). */
export function displayShortcut(input: string): string {
  const r = parseShortcut(input);
  if (!r.ok) return input;
  return [...r.value.modifiers.map((m) => (m === 'Super' ? 'Win' : m)), ...(r.value.key ? [r.value.key] : [])].join(' + ');
}
