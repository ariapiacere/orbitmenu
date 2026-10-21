# Changelog

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
