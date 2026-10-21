// In-app updates from GitHub Releases.
//
//   check     GET /repos/<repo>/releases/latest; newer tag → "available".
//   download  OrbitMenu downloads RELEASES and the full .nupkg itself (with an
//             optional access token, e.g. for private forks), verifies size and SHA-1,
//             then hands the local folder to Squirrel (Electron's autoUpdater),
//             which installs the new version next to the running one.
//   install   autoUpdater.quitAndInstall() restarts into the new version.
//
// Doing the download here (instead of pointing Squirrel at GitHub) keeps
// token support for private forks and lets us verify and report progress.
import { app, autoUpdater } from 'electron';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { TokenResult, UpdateState } from '@shared/ipc';
import type { GeneralSettings } from '@shared/types';
import {
  compareVersions,
  entryForPackage,
  formatReleasesEntry,
  parseGitHubRelease,
  parseReleasesFile,
  pickInstallableAssets,
  type ReleaseAsset,
  type ReleaseInfo,
} from './releases';
import { TokenStore } from './token';
import { log } from '../log';

const FIRST_CHECK_DELAY_MS = 20_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const API = 'https://api.github.com';

export interface UpdaterOptions {
  repository: string;
  tokenFile: string;
  cacheRoot: string;
  settings: () => GeneralSettings;
  notify: (title: string, body: string) => void;
  /** Tests only: use this token instead of the saved one. */
  tokenOverride?: string;
}

export class Updater extends EventEmitter {
  private readonly tokens: TokenStore;
  private release: ReleaseInfo | null = null;
  private timer: NodeJS.Timeout | null = null;
  private notifiedVersion = '';
  private busy: Promise<UpdateState> | null = null;
  private squirrelWired = false;
  state: UpdateState;

  constructor(private readonly opts: UpdaterOptions) {
    super();
    this.tokens = new TokenStore(opts.tokenFile);
    this.state = {
      status: 'idle',
      currentVersion: app.getVersion(),
      latestVersion: null,
      releaseName: '',
      releaseNotes: '',
      releaseUrl: '',
      publishedAt: null,
      totalBytes: 0,
      receivedBytes: 0,
      error: null,
      checkedAt: null,
      canInstall: Updater.squirrelInstalled(),
      installable: false,
      hasToken: this.tokens.has(),
      repository: opts.repository,
    };
  }

  /** True when running from a Squirrel installation (Update.exe one folder up). */
  static squirrelInstalled(): boolean {
    return app.isPackaged && process.platform === 'win32' && existsSync(resolve(dirname(process.execPath), '..', 'Update.exe'));
  }

  start(): void {
    this.cleanCache();
    const tick = () => {
      if (this.opts.settings().autoCheckUpdates) void this.check(false);
    };
    setTimeout(tick, FIRST_CHECK_DELAY_MS);
    this.timer = setInterval(tick, CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private set(patch: Partial<UpdateState>): UpdateState {
    this.state = { ...this.state, ...patch, hasToken: this.tokens.has() };
    this.emit('state', this.state);
    return this.state;
  }

  private headers(accept = 'application/vnd.github+json'): Record<string, string> {
    const h: Record<string, string> = {
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': `OrbitMenu/${app.getVersion()}`,
    };
    const token = this.opts.tokenOverride ?? this.tokens.get();
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  /** Turns GitHub's status codes into something a person can act on. */
  private describeHttpError(status: number, what: string): string {
    const hasToken = this.tokens.has();
    if (status === 401) return 'GitHub rejected the access token (expired or revoked). Enter a new one.';
    if (status === 403 || status === 429) {
      return hasToken
        ? 'GitHub refused the request (rate limit or missing permission). Try again later.'
        : 'GitHub limits anonymous update checks per network. Try again later, or add an access token under About & updates.';
    }
    if (status === 404) {
      return hasToken
        ? `${what} was not found. The token may not have access to ${this.opts.repository}, or nothing has been released yet.`
        : `${what} was not found on ${this.opts.repository}. Nothing has been released yet, or the repository is private and needs an access token.`;
    }
    return `GitHub answered ${status} while fetching ${what}.`;
  }

  /** Checks GitHub for a newer release. Concurrent calls share one check. */
  check(manual: boolean): Promise<UpdateState> {
    if (this.busy) return this.busy;
    if (this.state.status === 'downloading' || this.state.status === 'ready') return Promise.resolve(this.state);
    this.busy = this.doCheck(manual).finally(() => (this.busy = null));
    return this.busy;
  }

  private async doCheck(manual: boolean): Promise<UpdateState> {
    this.set({ status: 'checking', error: null });
    try {
      const release = await this.latestRelease();
      this.release = release;
      const newer = compareVersions(release.version, app.getVersion()) > 0;
      const base = {
        latestVersion: release.version,
        releaseName: release.name,
        releaseNotes: release.notes,
        releaseUrl: release.url,
        publishedAt: release.publishedAt,
        checkedAt: Date.now(),
        installable: pickInstallableAssets(release) !== null,
        totalBytes: pickInstallableAssets(release)?.fullPackage.size ?? 0,
        receivedBytes: 0,
      };
      if (!newer) return this.set({ ...base, status: 'up-to-date' });
      const state = this.set({ ...base, status: 'available' });
      log.info(`Update available: ${release.version} (running ${app.getVersion()}).`);
      if (!manual && this.notifiedVersion !== release.version) {
        this.notifiedVersion = release.version;
        this.opts.notify(`OrbitMenu ${release.version} is available`, 'Open Settings → About & updates to install it.');
      }
      if (!manual && this.opts.settings().autoDownloadUpdates && state.canInstall && state.installable) {
        return this.download();
      }
      return state;
    } catch (err) {
      const message = errorMessage(err);
      log.warn('Update check failed:', message);
      return this.set({ status: 'error', error: message, checkedAt: Date.now() });
    }
  }

  /** The newest published (non-draft, non-prerelease) release. */
  async latestRelease(): Promise<ReleaseInfo> {
    const res = await fetch(`${API}/repos/${this.opts.repository}/releases/latest`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(this.describeHttpError(res.status, 'The latest release'));
    return parseGitHubRelease(await res.json());
  }

  /**
   * Downloads the release's full package into `dir`, verifies it against
   * RELEASES and writes a RELEASES file listing only that package. Returns the
   * package path.
   */
  async fetchPackage(release: ReleaseInfo, dir: string): Promise<string> {
    const assets = pickInstallableAssets(release);
    if (!assets) throw new Error('The release does not contain an installable package.');
    mkdirSync(dir, { recursive: true });
    this.set({ receivedBytes: 0, totalBytes: assets.fullPackage.size });
    const releasesText = await (await this.fetchAsset(assets.releases)).text();
    const entry = entryForPackage(parseReleasesFile(releasesText), assets.fullPackage.name);
    if (!entry) throw new Error('RELEASES does not list the full package.');
    const target = join(dir, assets.fullPackage.name);
    await this.downloadVerified(assets.fullPackage, target, entry.sha1, entry.size);
    // Only the full package was downloaded, so Squirrel must not look for deltas.
    writeFileSync(join(dir, 'RELEASES'), formatReleasesEntry(entry), 'utf8');
    return target;
  }

  /** Downloads, verifies and stages the latest release with Squirrel. */
  download(): Promise<UpdateState> {
    if (this.busy) return this.busy;
    this.busy = this.doDownload().finally(() => (this.busy = null));
    return this.busy;
  }

  private async doDownload(): Promise<UpdateState> {
    const release = this.release;
    if (!release || compareVersions(release.version, app.getVersion()) <= 0) {
      return this.set({ status: 'error', error: 'There is no newer version to download. Check for updates first.' });
    }
    if (!this.state.canInstall) {
      return this.set({
        status: 'error',
        error: 'This copy was not installed with OrbitMenu-Setup.exe, so it cannot update itself. Download the setup program from the release page.',
      });
    }
    const dir = join(this.opts.cacheRoot, release.version);
    try {
      this.set({ status: 'downloading', error: null });
      await this.fetchPackage(release, dir);
      await this.stageWithSquirrel(dir);
      log.info(`Update ${release.version} is ready; restart to apply.`);
      this.opts.notify(`OrbitMenu ${release.version} is ready`, 'Restart OrbitMenu to finish updating.');
      return this.set({ status: 'ready' });
    } catch (err) {
      const message = errorMessage(err);
      log.error('Update download failed:', message);
      return this.set({ status: 'error', error: message });
    }
  }

  private async fetchAsset(asset: ReleaseAsset): Promise<Response> {
    // The API URL answers with a redirect to signed storage; fetch drops the
    // Authorization header when it leaves api.github.com.
    const res = await fetch(`${API}/repos/${this.opts.repository}/releases/assets/${asset.id}`, {
      headers: this.headers('application/octet-stream'),
      redirect: 'follow',
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!res.ok || !res.body) throw new Error(this.describeHttpError(res.status, asset.name));
    return res;
  }

  private async downloadVerified(asset: ReleaseAsset, target: string, sha1: string, size: number): Promise<void> {
    const res = await this.fetchAsset(asset);
    const part = `${target}.part`;
    const hash = createHash('sha1');
    const out = createWriteStream(part);
    let received = 0;
    let lastEmit = 0;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk);
        received += chunk.length;
        if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
        if (Date.now() - lastEmit > 200) {
          lastEmit = Date.now();
          this.set({ receivedBytes: received });
        }
      }
      await new Promise<void>((resolveEnd, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolveEnd())));
    } catch (err) {
      out.destroy();
      rmSync(part, { force: true });
      throw err;
    }
    this.set({ receivedBytes: received });
    const digest = hash.digest('hex').toUpperCase();
    if (received !== size || digest !== sha1) {
      rmSync(part, { force: true });
      throw new Error('The downloaded package is damaged (size or checksum mismatch). Try again.');
    }
    rmSync(target, { force: true });
    renameSync(part, target);
  }

  /** Lets Squirrel install the package from our local folder. */
  private stageWithSquirrel(dir: string): Promise<void> {
    return new Promise((resolveStage, reject) => {
      const onDownloaded = () => {
        cleanup();
        resolveStage();
      };
      const onNotAvailable = () => {
        cleanup();
        reject(new Error('The installer found nothing to update.'));
      };
      const onError = (err: Error) => {
        cleanup();
        reject(new Error(`Squirrel could not apply the update: ${err.message}`));
      };
      const cleanup = () => {
        autoUpdater.removeListener('update-downloaded', onDownloaded);
        autoUpdater.removeListener('update-not-available', onNotAvailable);
        autoUpdater.removeListener('error', onError);
      };
      if (!this.squirrelWired) {
        // Without a listener, autoUpdater errors would be thrown as uncaught.
        autoUpdater.on('error', (err) => log.warn('autoUpdater:', err.message));
        this.squirrelWired = true;
      }
      autoUpdater.once('update-downloaded', onDownloaded);
      autoUpdater.once('update-not-available', onNotAvailable);
      autoUpdater.once('error', onError);
      autoUpdater.setFeedURL({ url: dir });
      autoUpdater.checkForUpdates();
    });
  }

  install(): void {
    if (this.state.status !== 'ready') return;
    log.info('Restarting to install the update.');
    autoUpdater.quitAndInstall();
  }

  /** Validates a token against the repository before saving it. */
  async setToken(token: string | null): Promise<TokenResult> {
    const value = typeof token === 'string' ? token.trim() : '';
    if (!value) {
      this.tokens.set(null);
      this.set({});
      return { ok: true, message: 'Access token removed.' };
    }
    if (!/^[A-Za-z0-9_]{20,255}$/.test(value)) return { ok: false, message: 'That does not look like a GitHub token.' };
    try {
      const res = await fetch(`${API}/repos/${this.opts.repository}`, {
        headers: { ...this.headers(), Authorization: `Bearer ${value}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 401) return { ok: false, message: 'GitHub rejected this token.' };
      if (res.status === 404) return { ok: false, message: `This token cannot see ${this.opts.repository}. Give it read access to that repository.` };
      if (!res.ok) return { ok: false, message: `GitHub answered ${res.status}; the token was not saved.` };
      this.tokens.set(value);
      this.set({ error: null, status: this.state.status === 'error' ? 'idle' : this.state.status });
      return { ok: true, message: 'Token saved (encrypted for this Windows account).' };
    } catch (err) {
      return { ok: false, message: `Could not reach GitHub: ${errorMessage(err)}` };
    }
  }

  /** Removes downloaded packages that are no newer than the running version. */
  private cleanCache(): void {
    try {
      if (!existsSync(this.opts.cacheRoot)) return;
      for (const name of readdirSync(this.opts.cacheRoot)) {
        if (compareVersions(name, app.getVersion()) <= 0) rmSync(join(this.opts.cacheRoot, name), { recursive: true, force: true });
      }
    } catch (err) {
      log.debug('Update cache cleanup skipped:', (err as Error).message);
    }
  }
}

function errorMessage(err: unknown): string {
  const e = err as Error & { cause?: { code?: string; message?: string } };
  if (e?.name === 'TimeoutError') return 'GitHub did not answer in time.';
  if (e?.cause?.code === 'ENOTFOUND' || e?.cause?.code === 'ECONNREFUSED') return 'No connection to GitHub.';
  return e?.message || String(err);
}
