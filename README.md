# OrbitMenu

A fast radial launcher for Windows 10 and 11. Press a shortcut anywhere and a ring of items appears around the pointer: launch programs, open files and websites, press key combinations in the app you were using, paste snippets, run commands, focus windows or play back macros — with a click, a flick of the mouse, or by releasing the shortcut's modifier key.

OrbitMenu is an independent implementation inspired by the interaction design of [Kando](https://kando.menu/). It shares no code, branding or artwork with Kando.

![OrbitMenu icon](assets/icons/orbitmenu-512.png)

## Highlights

- **Global shortcuts** – one per menu (default <kbd>Ctrl</kbd>+<kbd>Space</kbd>), with clear status when another app already owns a shortcut.
- **Transparent overlay** at the pointer (or screen centre), multi-monitor and per-monitor-DPI aware, kept inside the work area; the pointer follows when the ring has to move.
- **Four ways to choose**, all active together:
  - **Point and click** – the whole wedge is clickable, not just the icon.
  - **Marking gestures** – hold the button and stroke; corners and short pauses open submenus, releasing selects. Optional fading trail.
  - **Turbo** – keep the shortcut's modifier held, move, let go to select.
  - **Hover** (optional) – rest on an item; risky actions always need a click.
  - Keyboard: arrows, <kbd>Tab</kbd>, <kbd>Enter</kbd>, <kbd>Backspace</kbd>, <kbd>Esc</kbd>, per-item hint keys and <kbd>1</kbd>–<kbd>9</kbd>.
- **Nested submenus** that open where you selected them, with tethers back to the parent and a Back slot.
- **Ten action types**: launch application, open file/folder, open website, keyboard shortcut (real `SendInput`), paste or type text (clipboard restored), run command (no shell, confirmation for risky commands), open submenu, switch menu, focus window, macro (keys, text, delays, launches, opens; stop-on-error and <kbd>Esc</kbd> to cancel).
- **Visual editor**: live preview using the real renderer, drag-and-drop ordering, icon picker (1,600+ bundled icons, emoji, images, the program's own icon), shortcut recorder, per-type forms with validation, undo/redo, auto-save.
- **Themes**: Nebula, Daylight, Graphite, custom accent, size and radii, animation speed.
- **Robust config**: JSON files validated on load, atomic writes with backups, damaged files set aside instead of overwritten, hand edits picked up live, import/export.

## Getting started

Requirements: Windows 10/11 x64 (arm64 builds also work), Node.js 22+ for development.

```bash
npm install
```

npm 11 asks before running dependency install scripts. Approve the three this project needs (esbuild, koffi, Squirrel tooling), then download Electron:

```bash
npm approve-scripts koffi esbuild electron-winstaller
```

```bash
npx install-electron
```

Run the app:

```bash
npm start
```

OrbitMenu lives in the system tray. Press <kbd>Ctrl</kbd>+<kbd>Space</kbd> to open the example menu, or click the tray icon to open the editor.

### Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Build everything and start Electron |
| `npm run dev` | Vite dev server (hot reload for the editor) + esbuild watch for the main process; Electron restarts on main-process changes |
| `npm test` | Unit tests (Vitest): geometry, gestures, shortcuts, argument parsing, schema, validation, Win32 bindings |
| `npm run selftest` | Integration self-test inside Electron: real action engine, process spawning, confirmation gate, clipboard restore, `SendInput` |
| `npm run typecheck` | TypeScript, strict mode |
| `npm run package` | Packaged app in `out/OrbitMenu-win32-x64` |
| `npm run make` | Squirrel installer (`out/make/squirrel.windows/x64/OrbitMenu-Setup.exe`) and a portable zip |
| `npm run release` | Test, build and publish the current version as a GitHub Release (see below) |
| `npm run icons` | Regenerate the logo, app icon and tray icon from code |

Development aids: `ORBIT_BENCH=<n>` opens and closes the first menu *n* times and logs the timings; `ORBIT_DEBUG_CAPTURE=<file.png>` saves what the overlay rendered (dev builds only).

### Command line

```
OrbitMenu.exe                 start (if already running: open the settings)
OrbitMenu.exe --settings      start and open the settings
OrbitMenu.exe --menu=<name>   open a menu by name or id — bind it to a mouse button in your mouse software
```

## Using the editor

- **Menus** are listed on the left with their shortcut status. Each has a name, icon, shortcut, *opens at pointer / centre* and an enabled switch. **Test** opens it immediately.
- **Items** are listed clockwise from the top. Drag to reorder (or <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd>), <kbd>Delete</kbd> removes. Up to 12 items per ring; 6–8 is the sweet spot.
- **Preview**: click an item to edit it, click it again (or double-click) to go into a submenu, click the hub to go up.
- **Placement & keyboard**: a hint key per item, and an optional pinned direction (pinned angles must increase clockwise in list order; free items fill the gaps).
- Environment variables such as `%USERPROFILE%` work in every path field.
- **Test** runs an action right away; keyboard, text and macro tests wait 3 seconds so you can switch to the target window.

Configuration lives in `%APPDATA%\OrbitMenu\settings.json` and `menus.json`; logs are in `%APPDATA%\OrbitMenu\logs`.

Images you choose as icons are copied into OrbitMenu's own `icons` folder — `%LOCALAPPDATA%\OrbitMenu\icons` for the installed app (it survives updates), next to `OrbitMenu.exe` for the portable zip — so moving or deleting the original does not break a menu. Copies are named by content hash, so the same image is stored once. Exports include the icon files.

OrbitMenu starts with Windows by default (tray menu → *Start with Windows*, or Settings → Behaviour).

## Updates

Installed copies (from `OrbitMenu-Setup.exe`) update themselves from the GitHub Releases of `ariapiacere/orbitmenu`:

- At startup and every 6 hours OrbitMenu checks the latest release. When a newer one exists you get a notification, a tray entry and a banner in **Settings → About & updates**.
- **Download and install** fetches the package, verifies its size and SHA-1 against the release's `RELEASES` file, and lets Squirrel install it next to the running version. **Restart and update** (also in the tray) switches over. Turn on *Download automatically* to skip the first click.
- The repository is private, so each PC needs a read-only token once: on GitHub create a *fine-grained personal access token* with access to only this repository and **Contents: Read-only**, then paste it under *GitHub access token*. It is encrypted with Windows DPAPI for the current user and kept out of exports.
- The portable zip cannot update itself; the update banner links to the release page instead.

### Publishing a release

```bash
npm version patch --no-git-tag-version
```

Describe the version in `CHANGELOG.md` under `## <version>`, commit, then:

```bash
npm run release
```

The script refuses to run with uncommitted changes, runs the tests, builds the installer, tags `v<version>`, pushes, and creates the GitHub Release with `OrbitMenu-Setup.exe`, the full `.nupkg`, `RELEASES` and the portable zip. It needs the GitHub CLI (`gh`) logged in with access to the repository.

## Architecture

See [docs/architecture.md](docs/architecture.md). In short:

| System | Location |
| --- | --- |
| Electron main process / app controller | `src/main/index.ts`, `src/main/app.ts` |
| Radial menu renderer (DOM/SVG, shared with the editor preview) | `src/renderer/radial/` |
| Overlay controller (input → navigation) | `src/renderer/menu/main.ts` |
| Settings / menu editor (React + Zustand) | `src/renderer/settings/` |
| Global hotkey manager | `src/main/hotkeys.ts` |
| Navigation & gesture engine (pure, unit-tested) | `src/shared/geometry.ts`, `src/shared/gestures.ts` |
| Action execution engine (registry + handlers) | `src/main/actions/` |
| Configuration & persistence | `src/shared/schema.ts`, `src/main/config/store.ts` |
| Windows integration layer | `src/main/platform/win32/` behind `src/main/platform/types.ts` |

### Native dependency

Windows input and window management use [koffi](https://koffi.dev/) (MIT), a foreign-function interface that ships prebuilt binaries, so **no C++ toolchain, node-gyp or Visual Studio** is needed. It calls `user32.dll` (`SendInput`, `SetForegroundWindow`, `EnumWindows`, `GetAsyncKeyState`, `SetCursorPos`, …), `kernel32.dll` and `dwmapi.dll` directly. The packaged app keeps only koffi's Windows binaries and unpacks them from the asar archive. On other platforms a generic backend is used: launching, opening files and URLs work; input injection and window focusing report "not supported" (see `src/main/platform/generic.ts` for the extension point).

## Limitations

Windows imposes some rules every launcher has to live with — details in [docs/limitations.md](docs/limitations.md):

- Simulated keys and text do not reach apps running **as administrator** unless OrbitMenu also runs elevated, and nothing reaches the lock screen or UAC prompts.
- Pasting restores text, HTML, RTF and images on the clipboard; copied **files** and private app formats cannot be restored.
- Exclusive-fullscreen games may draw over the overlay.
- <kbd>Ctrl</kbd>+<kbd>Space</kbd> toggles some Asian input methods; pick another shortcut if you use one.

## License

MIT. Icons: [Lucide](https://lucide.dev) (ISC).
