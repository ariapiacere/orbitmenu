import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  entryForPackage,
  formatReleasesEntry,
  parseGitHubRelease,
  parseReleasesFile,
  pickInstallableAssets,
} from '../src/main/updater/releases';

describe('compareVersions', () => {
  it('orders semantic versions numerically', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBe(1);
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0', '1.0.1')).toBe(-1);
  });

  it('ranks releases above their pre-releases', () => {
    expect(compareVersions('1.0.0', '1.0.0-beta.2')).toBe(1);
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.9')).toBe(1);
  });
});

const SHA = 'A'.repeat(40);

describe('RELEASES files', () => {
  it('parses Squirrel lines and ignores junk', () => {
    const text = `﻿${SHA} OrbitMenu-0.2.0-full.nupkg 155000000\r\n${'b'.repeat(40)} OrbitMenu-0.2.0-delta.nupkg 1200\n\nnot a line\n`;
    const entries = parseReleasesFile(text);
    expect(entries).toHaveLength(2);
    expect(entries[1]!.sha1).toBe('B'.repeat(40));
    expect(entryForPackage(entries, 'OrbitMenu-0.2.0-full.nupkg')?.size).toBe(155000000);
    expect(formatReleasesEntry(entries[0]!)).toBe(`${SHA} OrbitMenu-0.2.0-full.nupkg 155000000`);
  });
});

describe('GitHub releases', () => {
  const api = {
    tag_name: 'v0.2.0',
    name: 'OrbitMenu 0.2.0',
    body: 'notes',
    html_url: 'https://github.com/o/r/releases/tag/v0.2.0',
    published_at: '2026-10-21T00:00:00Z',
    assets: [
      { id: 1, name: 'OrbitMenu-Setup.exe', size: 150, url: 'u1' },
      { id: 2, name: 'OrbitMenu-0.2.0-full.nupkg', size: 140, url: 'u2' },
      { id: 3, name: 'RELEASES', size: 80, url: 'u3' },
      { id: 'bad', name: 5 },
    ],
  };

  it('extracts version and assets', () => {
    const r = parseGitHubRelease(api);
    expect(r.version).toBe('0.2.0');
    expect(r.assets).toHaveLength(3);
    const picked = pickInstallableAssets(r);
    expect(picked?.fullPackage.id).toBe(2);
    expect(picked?.releases.id).toBe(3);
    expect(picked?.setup?.id).toBe(1);
  });

  it('reports releases that cannot be installed in place', () => {
    const r = parseGitHubRelease({ ...api, assets: [api.assets[0]] });
    expect(pickInstallableAssets(r)).toBeNull();
  });

  it('rejects tags that are not versions', () => {
    expect(() => parseGitHubRelease({ tag_name: 'nightly' })).toThrow(/not a version/);
  });
});
