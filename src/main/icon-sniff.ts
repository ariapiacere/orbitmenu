// Recognises image files by their content rather than their name, so a file
// whose extension is wrong or hidden (e.g. "logo.svg" that is really WebP)
// is stored and displayed correctly. Pure: no Electron imports, unit-tested.

export type ImageExt = '.png' | '.jpg' | '.gif' | '.webp' | '.bmp' | '.ico' | '.svg';

const startsWith = (data: Uint8Array, bytes: number[], offset = 0) => bytes.every((b, i) => data[offset + i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** The image type of `data`, or null if it is not a supported image. */
export function sniffImageType(data: Uint8Array): ImageExt | null {
  if (data.length < 4) return null;
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return '.png';
  if (startsWith(data, [0xff, 0xd8, 0xff])) return '.jpg';
  if (startsWith(data, ascii('GIF87a')) || startsWith(data, ascii('GIF89a'))) return '.gif';
  if (startsWith(data, ascii('RIFF')) && startsWith(data, ascii('WEBP'), 8)) return '.webp';
  if (startsWith(data, ascii('BM')) && data.length > 26) return '.bmp';
  if (startsWith(data, [0x00, 0x00, 0x01, 0x00])) return '.ico';
  // SVG is text: look for an <svg element near the start (after an optional BOM, XML prolog or comments).
  const head = new TextDecoder('utf-8', { fatal: false }).decode(data.subarray(0, 4096)).replace(/^﻿/, '').trimStart();
  if (head.startsWith('<') && /<svg[\s>]/i.test(head)) return '.svg';
  return null;
}

export const IMAGE_MIME: Record<ImageExt, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};
