// Publishes the version in package.json as a GitHub Release that installed
// copies of OrbitMenu pick up as an update.
//
//   1. Bump the version:   npm version minor --no-git-tag-version   (or patch / major)
//   2. Describe it in CHANGELOG.md under "## <version>", commit everything.
//   3. Publish:            npm run release
//
// Requires the GitHub CLI (`gh`) logged in with access to the repository.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const repo = pkg.orbitmenu?.updateRepository;
const version = pkg.version;
const tag = `v${version}`;

const out = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim();
const run = (cmd, args) => {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  // npm is a .cmd script on Windows. Run its JavaScript entry point with node
  // instead of going through a shell (npm sets npm_execpath for `npm run`).
  const [exe, argv] =
    cmd === 'npm' && process.env.npm_execpath ? [process.execPath, [process.env.npm_execpath, ...args]] : [cmd, args];
  const r = spawnSync(exe, argv, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} failed.`);
};
if (!process.env.npm_execpath) fail('run this through npm: npm run release');
function fail(message) {
  console.error(`\nRelease aborted: ${message}`);
  process.exit(1);
}

if (!repo) fail('package.json has no orbitmenu.updateRepository.');
if (out('git', ['status', '--porcelain'])) fail('the working tree has uncommitted changes. Commit them first.');
const viewed = spawnSync('gh', ['release', 'view', tag, '--repo', repo], { cwd: root, stdio: 'ignore' });
if (viewed.status === 0) fail(`${tag} is already published. Bump the version first (npm version patch --no-git-tag-version).`);

// Release notes from CHANGELOG.md.
const changelog = existsSync(join(root, 'CHANGELOG.md')) ? readFileSync(join(root, 'CHANGELOG.md'), 'utf8') : '';
const section = changelog.split(/^## /m).find((s) => s.startsWith(`${version}`));
if (!section) fail(`CHANGELOG.md has no "## ${version}" section.`);
const notes = section.split('\n').slice(1).join('\n').trim();

run('npm', ['test']);
run('npm', ['run', 'make']);

const squirrel = join(root, 'out', 'make', 'squirrel.windows', 'x64');
const files = [
  join(squirrel, 'OrbitMenu-Setup.exe'),
  join(squirrel, `OrbitMenu-${version}-full.nupkg`),
  join(squirrel, 'RELEASES'),
  join(root, 'out', 'make', 'zip', 'win32', 'x64', `OrbitMenu-win32-x64-${version}.zip`),
];
for (const f of files) if (!existsSync(f)) fail(`missing build output ${f}`);
// RELEASES may list older packages left in out/make; the updater only needs this version's line.
const releasesLine = readFileSync(join(squirrel, 'RELEASES'), 'utf8')
  .split(/\r?\n/)
  .find((l) => l.includes(`OrbitMenu-${version}-full.nupkg`));
if (!releasesLine) fail('RELEASES does not mention the new full package.');
writeFileSync(join(squirrel, 'RELEASES'), releasesLine.trim(), 'utf8');

const notesFile = join(mkdtempSync(join(tmpdir(), 'orbit-release-')), 'notes.md');
writeFileSync(notesFile, `${notes}\n\n---\nInstall: download **OrbitMenu-Setup.exe**. Installed copies update themselves from this release.\n`, 'utf8');

if (!out('git', ['tag', '--list', tag])) run('git', ['tag', '-a', tag, '-m', `OrbitMenu ${version}`]);
run('git', ['push', 'origin', 'HEAD']);
run('git', ['push', 'origin', tag]);
run('gh', ['release', 'create', tag, ...files, '--repo', repo, '--title', `OrbitMenu ${version}`, '--notes-file', notesFile, '--verify-tag']);
console.log(`\nPublished ${tag}: https://github.com/${repo}/releases/tag/${tag}`);
