# Changelog

## 0.2.3

- **Drag and drop icons**: drop an image from Explorer (or a browser) onto an item's icon or name area, the menu icon, or the icon picker. It is copied into OrbitMenu's icon folder like a chosen file.
- Image type is detected from the file's content, so files with a wrong or hidden extension (e.g. a WebP named `.svg`) work; non-images are rejected with a clear message.
- Fixed image icons appearing tiny in the editor (icon circle, sidebar, breadcrumbs).
- Dropping a file elsewhere in the settings window no longer tries to open it.

## 0.2.2

- The repository is now public: updates work on every PC without a GitHub token.
- The access-token field under About & updates is optional and folded away; messages explain rate limits instead of asking for a token.
- README: direct download link for the installer.

## 0.2.1

- First release delivered through the in-app updater (tests the update path from 0.2.0).
- Release script runs npm without a shell, removing Node's DEP0190 security warning.

## 0.2.0

- **Updates from GitHub**: OrbitMenu checks for new releases at startup and every 6 hours, downloads and verifies them, and installs on restart (Settings → About & updates, or the tray menu). The private repository needs a read-only GitHub token, entered once per PC and stored encrypted.
- **Starts with Windows** by default (toggle in the tray menu or Settings).
- **Faster shortcut**: the overlay is warmed up at startup, menus are visible from the first frame with a shorter 110 ms animation, and closing a menu to run an action takes one frame instead of two.
- **Icons are kept by OrbitMenu**: images chosen as icons are copied into the program's own `icons` folder (deduplicated), so moving or deleting the original no longer breaks the menu. Existing image icons are copied automatically; exports now include the icon files.
- `--menu=<name>` command-line switch opens a menu from scripts or mouse software.

## 0.1.0

- First version: radial overlay with point-and-click, marking gestures, turbo and hover navigation; ten action types; visual menu editor; themes; tray app; Squirrel installer.
