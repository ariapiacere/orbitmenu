import { describe, expect, it } from 'vitest';
import { sniffImageType } from '../src/main/icon-sniff';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe('sniffImageType', () => {
  it('recognises binary formats by their signature', () => {
    expect(sniffImageType(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe('.png');
    expect(sniffImageType(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toBe('.jpg');
    expect(sniffImageType(bytes('GIF89a', [1, 0]))).toBe('.gif');
    expect(sniffImageType(bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 '))).toBe('.webp');
    expect(sniffImageType(bytes([0, 0, 1, 0, 1, 0, 16, 16]))).toBe('.ico');
    expect(sniffImageType(bytes('BM', new Array(40).fill(0)))).toBe('.bmp');
  });

  it('recognises SVG text with BOM, prolog or comments', () => {
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('.svg');
    expect(sniffImageType(new TextEncoder().encode('﻿<?xml version="1.0"?>\n<!-- logo -->\n<svg viewBox="0 0 1 1"></svg>'))).toBe('.svg');
  });

  it('ignores the file name: WebP data named .svg is WebP', () => {
    // The type is decided from content only, so a hidden or wrong extension does not matter.
    expect(sniffImageType(bytes('RIFF', [0, 0, 0, 0], 'WEBP'))).toBe('.webp');
  });

  it('rejects everything else', () => {
    expect(sniffImageType(new TextEncoder().encode('MZ\x90\x00 not an image'))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode('<html><body>hi</body></html>'))).toBeNull();
    expect(sniffImageType(new Uint8Array([1, 2]))).toBeNull();
  });
});
