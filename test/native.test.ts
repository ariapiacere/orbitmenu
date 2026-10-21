import { describe, expect, it } from 'vitest';
import { KEY_CATALOGUE } from '@shared/accelerator';
import { MODIFIER_VK, vkForKey } from '../src/main/platform/win32/keys';

describe('virtual-key table', () => {
  it('maps every key in the catalogue', () => {
    const missing = KEY_CATALOGUE.filter((k) => !vkForKey(k.name)).map((k) => k.name);
    expect(missing).toEqual([]);
  });

  it('uses layout-independent codes for punctuation', () => {
    expect(vkForKey('/')?.vk).toBe(0xbf);
    expect(vkForKey('Plus')?.vk).toBe(0xbb);
    expect(MODIFIER_VK.Super.extended).toBe(true);
  });
});

describe.runIf(process.platform === 'win32')('Win32 bindings (koffi)', () => {
  it('loads user32 and enumerates windows', async () => {
    const native = await import('../src/main/platform/win32/native');
    let count = 0;
    native.enumWindows(() => {
      count++;
    });
    expect(count).toBeGreaterThan(0);
  });

  it('reads window titles as UTF-16', async () => {
    const native = await import('../src/main/platform/win32/native');
    const titles: string[] = [];
    native.enumWindows((hwnd) => {
      const t = native.windowText(hwnd);
      if (t) titles.push(t);
      return titles.length < 5;
    });
    expect(titles.every((t) => typeof t === 'string' && !t.includes('\u0000'))).toBe(true);
  });

  it('sends nothing for an empty batch', async () => {
    const native = await import('../src/main/platform/win32/native');
    expect(native.sendKeyEvents([])).toBe(0);
  });
});
