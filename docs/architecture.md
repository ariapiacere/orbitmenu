# Architecture

OrbitMenu is an Electron app with one main process and two sandboxed renderers. Shared, DOM-free logic lives in `src/shared` and is unit-tested.

```
src/
  shared/      types, zod schema, defaults, geometry, gesture engine, accelerators,
               argument splitting, validation, tree helpers, IPC contract
  main/        app controller, config store, hotkeys, overlay & settings windows,
               tray, IPC router, icon resolver, action engine, platform layer
    actions/   engine (registry, errors), handlers, safe process spawning
    platform/  Platform interface, win32 backend (koffi), generic fallback
  preload/     contextBridge APIs for the overlay and the settings window
  renderer/
    radial/    RadialRenderer (DOM + SVG) and level builder — used by both pages
    menu/      overlay controller
    settings/  React editor, Zustand store, components
    dev/       browser mocks for UI work (dev builds only)
```

## Processes and security

- Both renderers run with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`; packaged pages carry a strict CSP. Navigation and new windows are blocked.
- The **overlay** can only report *which configured item* was chosen (menu id + item id path). The main process looks the item up in its own copy of the config and runs it — a compromised overlay cannot make the app run arbitrary commands.
- Every IPC message is checked against the sending window and must come from the app's own renderer files (`src/main/ipc.ts`).
- Commands run with `shell: false` and an argument array; batch files (which Windows always runs through `cmd.exe`) are refused if their arguments contain cmd metacharacters. Commands that look destructive (`del`, `format`, `shutdown`, shells, `Remove-Item`, …) require confirmation unless the user explicitly opts out per item.

## Opening a menu

1. `HotkeyManager` registers each menu's accelerator with `globalShortcut` and reports per-menu status (`ok`, `conflict`, `duplicate`, `invalid`, …).
2. On trigger, `OrbitApp.openMenu` records the foreground window (`GetForegroundWindow`), decides whether turbo is possible (a shortcut modifier is still held), and calls `MenuWindow.show`.
3. `MenuWindow` keeps one transparent, frameless, always-on-top `toolbar` window alive but hidden. Showing costs a resize to the display under the pointer (set twice to work around mixed-DPI sizing) and one IPC message. The window covers the display so strokes can go anywhere, and is **hidden** (not just made transparent) whenever a menu closes.
4. While visible, a 15 ms poller (`GetAsyncKeyState`) watches the shortcut's modifiers (turbo release) and its main key (to tell auto-repeat from a deliberate second press, which toggles the menu closed). `Escape` is registered globally as a failsafe that works even if the renderer hangs.
5. Before hiding, the overlay clears its DOM and acknowledges, so the next show never flashes a stale frame.

## Layout and navigation

- `computeItemAngles` spreads free items evenly from the top (balanced for odd counts), honours pinned angles that increase clockwise, and reserves a slot for the direction back to the parent so no child covers it.
- Each item owns the wedge of directions closest to it (`pickByAngle`), so selection works at any distance outside the dead zone.
- `ringRadiusFor` grows the ring only when items would overlap; `clampCenter` keeps a ring and its labels inside the work area (separate horizontal/vertical extents).
- `GestureEngine` is pure: fed pointer positions, it reports **corners** (direction change ≥ angle after a stroke ≥ minimum length), **pauses**, and optional **fixed-length** strokes, with jitter filtering and a drag threshold; all distances scale with the sensitivity setting. The overlay controller decides what a candidate means: submenus (and Back) open mid-stroke, leaf actions wait for the button or modifier release.
- Submenus open at the selection point, at least `minParentDistance` from the parent, so marking strokes can continue through several levels. Ancestors collapse into small hubs joined by tether lines.

## Executing actions

`ActionEngine` validates an action with the shared rules, then dispatches to a typed handler. Handlers receive an `ActionContext` with the platform backend, an abort signal (macros), `focusTarget()` (returns focus to the previously active window once, then waits `focusDelayMs`), and `confirm()`.

- Keyboard shortcuts: canonical shortcut → virtual-key codes with fixed US-layout OEM codes for punctuation (layout-independent; `VkKeyScanEx` fails on e.g. the Thai layout), left-hand modifier keys, scan codes and the extended-key flag where needed, one `SendInput` call. The handler first waits for the user to release physical modifiers.
- Text: *paste* snapshots every clipboard MIME type via Electron's async clipboard API, writes the snippet, sends Ctrl+V, waits, and restores only if the clipboard still holds the snippet; *type* sends `KEYEVENTF_UNICODE` events in small batches (works with any layout; newlines and tabs as real keys).
- Focus window: enumerate visible, uncloaked, unowned top-level windows (`EnumWindows`, `DwmGetWindowAttribute`, `QueryFullProcessImageNameW`), match by process and/or title, cycle through matches, bring to front with `SetForegroundWindow` → `AttachThreadInput` → `SwitchToThisWindow` fallbacks; optionally start the program if nothing matches.
- Programs started by OrbitMenu receive `AllowSetForegroundWindow` so they come to the front despite the foreground lock.

## Configuration

`settings.json` and `menus.json` in `%APPDATA%\OrbitMenu`. Every field has a schema default, so partial or older files load; invalid values are repaired field by field; depth, item count, macro length and text size are capped. Writes are atomic (temp file + rename) with a `.bak` of the previous version; an unparsable file is renamed to `*.broken-<timestamp>.json`, the backup is tried, and the user is told. External edits are detected with `fs.watch` and applied live.

## Adding a platform

Implement `Platform` (`src/main/platform/types.ts`) for the new OS and select it in `src/main/platform/index.ts`. Everything else (actions, overlay, editor) uses the interface and its `capabilities` flags; the editor shows which capabilities are available.

## Updates

`src/main/updater/` checks `GET /repos/<repo>/releases/latest` (anonymously for the public repository; with the user's encrypted token if one is set, e.g. for a private fork), compares versions, and on request downloads `RELEASES` and the full `.nupkg` through the GitHub API (the redirect to signed storage drops the Authorization header). The package is verified against the SHA-1 and size in `RELEASES`, then Electron's `autoUpdater` (Squirrel.Windows) is pointed at the local folder and installs it beside the running version; `quitAndInstall` restarts into it. Squirrel cannot authenticate to GitHub itself, which is why the download happens in the app. Pure parsing and version logic live in `releases.ts` and are unit-tested; `npm run selftest` downloads and verifies the real latest release (anonymously, or with `ORBIT_TEST_GITHUB_TOKEN` if set).

## Icons

`src/main/icon-store.ts` copies user-chosen icon images into `<install root>\icons` (Squirrel root, which survives updates; next to the exe for portable copies; the profile folder in development) under content-hash names and stores `icons/<hash>.<ext>` references. Older absolute image paths are migrated on load; exports embed the referenced files as base64 and imports restore them after checking the hash.
