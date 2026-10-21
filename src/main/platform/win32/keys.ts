// Canonical key names (see shared/accelerator.ts) → Windows virtual-key codes.
// Punctuation uses the US-layout OEM codes on purpose: shortcuts such as
// Ctrl+/ should hit the same physical key regardless of the active layout
// (looking characters up with VkKeyScanEx fails on e.g. the Thai layout).
import type { Modifier } from '@shared/accelerator';

export interface VkInfo {
  vk: number;
  extended: boolean;
}

const table = new Map<string, VkInfo>();
const set = (name: string, vk: number, extended = false) => table.set(name, { vk, extended });

for (let c = 65; c <= 90; c++) set(String.fromCharCode(c), c);
for (let d = 0; d <= 9; d++) set(String(d), 0x30 + d);
for (let f = 1; f <= 24; f++) set(`F${f}`, 0x6f + f);

set('Space', 0x20);
set('Tab', 0x09);
set('Enter', 0x0d);
set('Escape', 0x1b);
set('Backspace', 0x08);
set('Delete', 0x2e, true);
set('Insert', 0x2d, true);
set('Home', 0x24, true);
set('End', 0x23, true);
set('PageUp', 0x21, true);
set('PageDown', 0x22, true);
set('Up', 0x26, true);
set('Down', 0x28, true);
set('Left', 0x25, true);
set('Right', 0x27, true);
set('CapsLock', 0x14);
set('NumLock', 0x90, true);
set('ScrollLock', 0x91);
set('PrintScreen', 0x2c, true);
set('Pause', 0x13);
set('Apps', 0x5d, true);

set('Plus', 0xbb);
set('=', 0xbb);
set('-', 0xbd);
set(',', 0xbc);
set('.', 0xbe);
set('/', 0xbf);
set(';', 0xba);
set("'", 0xde);
set('[', 0xdb);
set(']', 0xdd);
set('\\', 0xdc);
set('`', 0xc0);

for (let d = 0; d <= 9; d++) set(`Num${d}`, 0x60 + d);
set('NumMult', 0x6a);
set('NumAdd', 0x6b);
set('NumSub', 0x6d);
set('NumDec', 0x6e);
set('NumDiv', 0x6f, true);

set('VolumeMute', 0xad, true);
set('VolumeDown', 0xae, true);
set('VolumeUp', 0xaf, true);
set('MediaNextTrack', 0xb0, true);
set('MediaPreviousTrack', 0xb1, true);
set('MediaStop', 0xb2, true);
set('MediaPlayPause', 0xb3, true);

export function vkForKey(name: string): VkInfo | undefined {
  return table.get(name);
}

/** Keys injected for each modifier (left-hand variants, which apps expect). */
export const MODIFIER_VK: Record<Modifier, VkInfo> = {
  Ctrl: { vk: 0xa2, extended: false },
  Alt: { vk: 0xa4, extended: false },
  Shift: { vk: 0xa0, extended: false },
  Super: { vk: 0x5b, extended: true },
};

/** Keys polled to decide whether the user still holds a modifier (either side). */
export const MODIFIER_POLL_VKS: Record<Modifier, number[]> = {
  Ctrl: [0x11],
  Alt: [0x12],
  Shift: [0x10],
  Super: [0x5b, 0x5c],
};

export const VK_RETURN = 0x0d;
export const VK_TAB = 0x09;
