// Short random identifiers for menus, items and macro steps.
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function randomId(length = 12): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}
