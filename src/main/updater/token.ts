// The GitHub access token for private releases, encrypted with Electron's
// safeStorage (Windows DPAPI: only this Windows user can decrypt it). It lives
// in its own file, never in settings.json, so exports never contain it.
import { safeStorage } from 'electron';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { log } from '../log';

export class TokenStore {
  constructor(private readonly file: string) {}

  has(): boolean {
    return existsSync(this.file);
  }

  get(): string | null {
    if (!existsSync(this.file)) return null;
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(readFileSync(this.file)) || null;
    } catch (err) {
      log.warn('The saved update token could not be decrypted:', (err as Error).message);
      return null;
    }
  }

  set(token: string | null): void {
    if (!token) {
      rmSync(this.file, { force: true });
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows cannot encrypt the token on this account.');
    writeFileSync(this.file, safeStorage.encryptString(token));
  }
}
