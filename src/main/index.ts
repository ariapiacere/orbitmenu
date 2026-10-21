// Entry point of the Electron main process.
import { app } from 'electron';
import { initLog, log } from './log';
import { LOGIN_ITEM_NAME, OrbitApp } from './app';
import { registerIpc } from './ipc';

/**
 * Command line:
 *   OrbitMenu.exe                 start (or, if running, open the settings window)
 *   OrbitMenu.exe --settings      start and open the settings window
 *   OrbitMenu.exe --menu <name>   open a menu by name or id (from scripts, other launchers, mouse software)
 *   OrbitMenu.exe --hidden        start silently (used by "launch at login")
 */
function menuArg(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--menu=')) return a.slice('--menu='.length);
    if (a === '--menu' && argv[i + 1] && !argv[i + 1]!.startsWith('--')) return argv[i + 1];
  }
  return undefined;
}

interface InstanceMessage {
  menu?: string;
}

// Uninstalling: remove the "start with Windows" entry before Squirrel deletes
// the app, otherwise Windows keeps a dead startup item.
if (process.platform === 'win32' && process.argv.includes('--squirrel-uninstall')) {
  try {
    app.setLoginItemSettings({ openAtLogin: false, name: LOGIN_ITEM_NAME });
  } catch {
    // Best effort.
  }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
if (process.platform === 'win32' && require('electron-squirrel-startup')) {
  // Squirrel.Windows runs the app with --squirrel-* flags during install and
  // uninstall; electron-squirrel-startup creates/removes shortcuts and exits.
  app.quit();
} else if (!app.requestSingleInstanceLock({ menu: menuArg(process.argv) } satisfies InstanceMessage)) {
  // Another instance owns the shortcuts; it receives our request and handles it.
  app.quit();
} else {
  app.setAppUserModelId('com.orbitmenu.app');
  // Keep the hidden overlay's renderer at full speed so it opens instantly.
  app.commandLine.appendSwitch('disable-renderer-backgrounding');

  let orbit: OrbitApp | null = null;

  app.on('second-instance', (_e, _argv, _cwd, data) => {
    const menu = (data as InstanceMessage | undefined)?.menu;
    if (typeof menu === 'string' && menu) orbit?.openMenuByName(menu);
    else orbit?.openSettings();
  });
  // The app lives in the tray; closing the settings window must not quit it.
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => orbit?.quit());

  process.on('uncaughtException', (err) => log.error('Uncaught exception:', err));
  process.on('unhandledRejection', (err) => log.error('Unhandled rejection:', err));

  app.whenReady().then(() => {
    initLog();
    orbit = new OrbitApp();
    registerIpc(orbit);
    orbit.start();
    if (process.argv.includes('--settings')) orbit.openSettings();
    const menu = menuArg(process.argv);
    if (menu) setTimeout(() => orbit?.openMenuByName(menu), 500);
  });
}
