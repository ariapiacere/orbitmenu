// Core configuration model shared by the main process and both renderers.
// The zod schemas in schema.ts validate persisted JSON against these types.

export type IconSpec =
  | { kind: 'lucide'; name: string }
  | { kind: 'emoji'; value: string }
  /** A local image file (png, jpg, svg, ico). */
  | { kind: 'image'; path: string }
  /** The Windows shell icon of the item's target (exe, file or folder). */
  | { kind: 'auto' }
  | { kind: 'none' };

export type TextMethod = 'paste' | 'type';
export type ConfirmMode = 'auto' | 'always' | 'never';
export type TitleMatch = 'contains' | 'exact' | 'regex';

export type MacroStep =
  | { id: string; type: 'keys'; keys: string }
  | { id: string; type: 'delay'; ms: number }
  | { id: string; type: 'text'; text: string; method: TextMethod }
  | { id: string; type: 'launch'; path: string; args: string }
  /** A file, folder or URL, opened with its default handler. */
  | { id: string; type: 'open'; target: string };

export type MacroStepType = MacroStep['type'];

export type ActionConfig =
  | { type: 'none' }
  | { type: 'submenu' }
  | { type: 'launch'; path: string; args: string; cwd: string }
  | { type: 'open'; path: string; reveal: boolean }
  | { type: 'url'; url: string }
  | { type: 'hotkey'; keys: string }
  | { type: 'text'; text: string; method: TextMethod; restoreClipboard: boolean }
  | {
      type: 'command';
      command: string;
      args: string;
      cwd: string;
      confirm: ConfirmMode;
      /** Show the program's window; false runs it hidden in the background. */
      console: boolean;
    }
  | { type: 'menu'; menuId: string }
  | {
      type: 'focus';
      processName: string;
      title: string;
      titleMatch: TitleMatch;
      /** Optional executable to start when no matching window exists. */
      launchPath: string;
    }
  | { type: 'macro'; steps: MacroStep[]; stopOnError: boolean };

export type ActionType = ActionConfig['type'];
export type ActionOf<T extends ActionType> = Extract<ActionConfig, { type: T }>;

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  icon: IconSpec;
  /** Single-key shortcut that selects this item while its level is open. */
  hint: string;
  /** Pin the item to a direction (degrees, 0 = up, clockwise). */
  fixedAngle: number | null;
  action: ActionConfig;
  /** Child items; only used when action.type === 'submenu'. */
  children: MenuItem[];
}

export type OpenPosition = 'cursor' | 'screen-center';

export interface MenuDefinition {
  id: string;
  name: string;
  icon: IconSpec;
  /** Electron-style accelerator, e.g. "Ctrl+Space". Empty = no shortcut. */
  shortcut: string;
  enabled: boolean;
  openAt: OpenPosition;
  items: MenuItem[];
}

export type ThemeName = 'nebula' | 'daylight' | 'graphite';
export type LabelMode = 'always' | 'hover';

export interface AppearanceSettings {
  theme: ThemeName;
  /** CSS colour; empty string = theme default. */
  accent: string;
  scale: number;
  /** Radius of the centre hub. */
  innerRadius: number;
  /** Outer radius of the wedge ring; items sit between inner and outer. */
  outerRadius: number;
  itemSize: number;
  showLabels: LabelMode;
  showWedges: boolean;
  showTrail: boolean;
  animationMs: number;
}

export interface NavigationSettings {
  marking: boolean;
  turbo: boolean;
  hover: boolean;
  hoverDelayMs: number;
  /** In hover mode, leaf actions still need a click. */
  hoverLeafRequiresClick: boolean;
  /** No item is selected while the pointer is this close to the centre. */
  deadZone: number;
  /** Multiplier applied to gesture distances (higher = shorter strokes). */
  sensitivity: number;
  /** Pointer travel that turns a press into a drag. */
  dragThreshold: number;
  /** A stroke must be at least this long before a corner can select. */
  minStrokeLength: number;
  /** Direction change (degrees) that counts as a corner. */
  minStrokeAngle: number;
  /** Movements smaller than this are treated as jitter. */
  jitter: number;
  /** Holding still this long during a stroke selects a submenu. */
  pauseMs: number;
  /** If > 0, a stroke this long always selects (0 = off). */
  fixedStrokeLength: number;
  /** Submenus open at least this far from their parent's centre. */
  minParentDistance: number;
  rightClickGoesBack: boolean;
  /** Move the pointer when the menu has to be shifted away from screen edges. */
  warpPointer: boolean;
  closeOnBlur: boolean;
}

export interface GeneralSettings {
  launchAtLogin: boolean;
  /** Optional global shortcut that opens the settings window. */
  settingsShortcut: string;
  /** Delay between restoring focus and sending input to the target app. */
  focusDelayMs: number;
  /** How long a pasted snippet stays on the clipboard before it is restored. */
  clipboardRestoreDelayMs: number;
  firstRunDone: boolean;
  /** Look for new releases on GitHub at startup and every few hours. */
  autoCheckUpdates: boolean;
  /** Download (but not install) new releases as soon as they are found. */
  autoDownloadUpdates: boolean;
}

export interface Settings {
  version: number;
  appearance: AppearanceSettings;
  navigation: NavigationSettings;
  general: GeneralSettings;
}

export interface MenusFile {
  version: number;
  menus: MenuDefinition[];
}

export interface OrbitConfig {
  settings: Settings;
  menus: MenuDefinition[];
}

export type HotkeyState = 'ok' | 'conflict' | 'invalid' | 'duplicate' | 'none' | 'disabled';

export interface HotkeyStatus {
  /** Menu id, or "settings" for the settings shortcut. */
  id: string;
  accelerator: string;
  state: HotkeyState;
  message: string;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
