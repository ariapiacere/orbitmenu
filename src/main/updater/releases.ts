// Pure helpers for the updater (no Electron imports, unit-tested): version
// comparison, GitHub release parsing and Squirrel RELEASES files.

/** Compares two semantic versions ("1.2.3", "v1.2.3-beta.1"). Returns -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre = ''] = v.trim().replace(/^v/i, '').split('-', 2) as [string, string?];
    const nums = core.split('.').map((n) => Number.parseInt(n, 10) || 0);
    while (nums.length < 3) nums.push(0);
    return { nums, pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    if (x.nums[i]! !== y.nums[i]!) return x.nums[i]! > y.nums[i]! ? 1 : -1;
  }
  // A release outranks its pre-releases: 1.0.0 > 1.0.0-beta.
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre.localeCompare(y.pre, 'en', { numeric: true }) > 0 ? 1 : -1;
}

export interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
  url: string;
}

export interface ReleaseInfo {
  version: string;
  tag: string;
  name: string;
  notes: string;
  url: string;
  publishedAt: string | null;
  assets: ReleaseAsset[];
}

/** Extracts what the updater needs from a GitHub "release" API object. */
export function parseGitHubRelease(json: unknown): ReleaseInfo {
  const r = json as Record<string, unknown>;
  const tag = typeof r?.tag_name === 'string' ? r.tag_name : '';
  if (!tag) throw new Error('The release has no tag.');
  const version = tag.replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error(`The release tag "${tag}" is not a version number.`);
  const assets = Array.isArray(r.assets) ? r.assets : [];
  return {
    version,
    tag,
    name: typeof r.name === 'string' && r.name ? r.name : tag,
    notes: typeof r.body === 'string' ? r.body : '',
    url: typeof r.html_url === 'string' ? r.html_url : '',
    publishedAt: typeof r.published_at === 'string' ? r.published_at : null,
    assets: assets.flatMap((a) => {
      const x = a as Record<string, unknown>;
      return typeof x.id === 'number' && typeof x.name === 'string'
        ? [{ id: x.id, name: x.name, size: Number(x.size) || 0, url: String(x.url ?? '') }]
        : [];
    }),
  };
}

export interface ReleasesEntry {
  sha1: string;
  file: string;
  size: number;
}

/** Parses a Squirrel.Windows RELEASES file ("SHA1 filename size" per line). */
export function parseReleasesFile(text: string): ReleasesEntry[] {
  return text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const m = /^([0-9a-fA-F]{40})\s+(\S+)\s+(\d+)$/.exec(line);
      return m ? [{ sha1: m[1]!.toUpperCase(), file: m[2]!, size: Number(m[3]) }] : [];
    });
}

export function formatReleasesEntry(e: ReleasesEntry): string {
  return `${e.sha1} ${e.file} ${e.size}`;
}

export interface InstallableAssets {
  releases: ReleaseAsset;
  fullPackage: ReleaseAsset;
  setup: ReleaseAsset | null;
}

/** Finds the Squirrel files of a release; null when it cannot be installed in place. */
export function pickInstallableAssets(release: ReleaseInfo): InstallableAssets | null {
  const releases = release.assets.find((a) => a.name === 'RELEASES');
  const fullPackage =
    release.assets.find((a) => a.name.endsWith(`-${release.version}-full.nupkg`)) ??
    release.assets.find((a) => a.name.endsWith('-full.nupkg'));
  if (!releases || !fullPackage) return null;
  const setup = release.assets.find((a) => /setup\.exe$/i.test(a.name)) ?? null;
  return { releases, fullPackage, setup };
}

/** The RELEASES line describing the full package we are going to download. */
export function entryForPackage(entries: readonly ReleasesEntry[], fileName: string): ReleasesEntry | null {
  return entries.find((e) => e.file === fileName) ?? null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
