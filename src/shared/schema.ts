// Runtime validation of persisted configuration. Every field has a default so
// that older or hand-edited files load with missing keys filled in.
import { z } from 'zod';
import type {
  ActionConfig,
  IconSpec,
  MacroStep,
  MenuDefinition,
  MenuItem,
  MenusFile,
  Settings,
} from './types';
import { randomId } from './ids';

export const SETTINGS_VERSION = 1;
export const MENUS_VERSION = 1;

import { LIMITS } from './limits';

export { LIMITS };

const id = z.string().min(1).max(64).catch(() => randomId());
const str = (max = 4096) => z.string().max(max).catch('');

export const IconSchema: z.ZodType<IconSpec> = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('lucide'), name: z.string().max(80) }),
    z.object({ kind: z.literal('emoji'), value: z.string().max(16) }),
    z.object({ kind: z.literal('image'), path: z.string().max(1024) }),
    z.object({ kind: z.literal('auto') }),
    z.object({ kind: z.literal('none') }),
  ])
  .catch({ kind: 'none' });

const textMethod = z.enum(['paste', 'type']).catch('paste');

export const MacroStepSchema: z.ZodType<MacroStep> = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('keys'), keys: str(200) }),
  z.object({
    id,
    type: z.literal('delay'),
    ms: z.number().int().min(0).max(LIMITS.maxMacroDelayMs).catch(250),
  }),
  z.object({ id, type: z.literal('text'), text: str(LIMITS.maxTextLength), method: textMethod }),
  z.object({ id, type: z.literal('launch'), path: str(), args: str() }),
  z.object({ id, type: z.literal('open'), target: str() }),
]);

export const ActionSchema: z.ZodType<ActionConfig> = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('none') }),
    z.object({ type: z.literal('submenu') }),
    z.object({ type: z.literal('launch'), path: str(), args: str(), cwd: str() }),
    z.object({ type: z.literal('open'), path: str(), reveal: z.boolean().catch(false) }),
    z.object({ type: z.literal('url'), url: str() }),
    z.object({ type: z.literal('hotkey'), keys: str(200) }),
    z.object({
      type: z.literal('text'),
      text: str(LIMITS.maxTextLength),
      method: textMethod,
      restoreClipboard: z.boolean().catch(true),
    }),
    z.object({
      type: z.literal('command'),
      command: str(),
      args: str(),
      cwd: str(),
      confirm: z.enum(['auto', 'always', 'never']).catch('auto'),
      console: z.boolean().catch(false),
    }),
    z.object({ type: z.literal('menu'), menuId: str(64) }),
    z.object({
      type: z.literal('focus'),
      processName: str(260),
      title: str(512),
      titleMatch: z.enum(['contains', 'exact', 'regex']).catch('contains'),
      launchPath: str(),
    }),
    z.object({
      type: z.literal('macro'),
      // Invalid steps are dropped rather than failing the whole menu.
      steps: z
        .array(z.unknown())
        .max(LIMITS.maxMacroSteps)
        .catch([])
        .transform((steps) =>
          steps.flatMap((s) => {
            const r = MacroStepSchema.safeParse(s);
            return r.success ? [r.data] : [];
          }),
        ),
      stopOnError: z.boolean().catch(true),
    }),
  ])
  .catch({ type: 'none' });

/** Parses one item; depth-limited so a pathological file cannot recurse forever. */
function itemSchema(depth: number): z.ZodType<MenuItem> {
  return z.lazy(() =>
    z.object({
      id,
      name: z.string().max(LIMITS.maxNameLength).catch('Item'),
      description: str(500),
      icon: IconSchema,
      hint: z.string().max(1).catch(''),
      fixedAngle: z.number().min(0).lt(360).nullable().catch(null),
      action: ActionSchema,
      children:
        depth >= LIMITS.maxDepth
          ? z.array(z.unknown()).catch([]).transform(() => [] as MenuItem[])
          : z.array(itemSchema(depth + 1)).max(LIMITS.maxItemsPerLevel).catch([]),
    }),
  );
}

export const MenuItemSchema = itemSchema(0);

export const MenuSchema: z.ZodType<MenuDefinition> = z.object({
  id,
  name: z.string().max(LIMITS.maxNameLength).catch('Menu'),
  icon: IconSchema,
  shortcut: str(100),
  enabled: z.boolean().catch(true),
  openAt: z.enum(['cursor', 'screen-center']).catch('cursor'),
  items: z.array(MenuItemSchema).max(LIMITS.maxItemsPerLevel).catch([]),
});

export const MenusFileSchema: z.ZodType<MenusFile> = z.object({
  version: z.number().int().catch(MENUS_VERSION),
  menus: z.array(MenuSchema).max(LIMITS.maxMenus),
});

const num = (min: number, max: number, def: number) => z.number().min(min).max(max).catch(def);
const bool = (def: boolean) => z.boolean().catch(def);

const AppearanceSchema = z.object({
  theme: z.enum(['nebula', 'daylight', 'graphite']).catch('nebula'),
  accent: z
    .string()
    .regex(/^(#[0-9a-fA-F]{3,8})?$/)
    .catch(''),
  scale: num(0.5, 2, 1),
  innerRadius: num(24, 120, 50),
  outerRadius: num(100, 400, 170),
  itemSize: num(32, 96, 54),
  showLabels: z.enum(['always', 'hover']).catch('always'),
  showWedges: bool(true),
  showTrail: bool(true),
  animationMs: num(0, 600, 110),
});

const NavigationSchema = z.object({
  marking: bool(true),
  turbo: bool(true),
  hover: bool(false),
  hoverDelayMs: num(100, 3000, 450),
  hoverLeafRequiresClick: bool(true),
  deadZone: num(0, 120, 42),
  sensitivity: num(0.25, 3, 1),
  dragThreshold: num(2, 60, 12),
  minStrokeLength: num(30, 400, 110),
  minStrokeAngle: num(5, 90, 24),
  jitter: num(1, 40, 8),
  pauseMs: num(30, 1000, 130),
  fixedStrokeLength: num(0, 600, 0),
  minParentDistance: num(60, 400, 140),
  rightClickGoesBack: bool(true),
  warpPointer: bool(true),
  closeOnBlur: bool(true),
});

const GeneralSchema = z.object({
  launchAtLogin: bool(true),
  settingsShortcut: str(100),
  focusDelayMs: num(0, 1000, 60),
  clipboardRestoreDelayMs: num(50, 5000, 400),
  firstRunDone: bool(false),
  autoCheckUpdates: bool(true),
  autoDownloadUpdates: bool(false),
});

/** A section that is missing or not an object falls back to all-default values. */
function section<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v && typeof v === 'object' ? v : {}), schema);
}

export const SettingsSchema: z.ZodType<Settings> = z.object({
  version: z.number().int().catch(SETTINGS_VERSION),
  appearance: section(AppearanceSchema),
  navigation: section(NavigationSchema),
  general: section(GeneralSchema),
});

export function parseSettings(raw: unknown): Settings {
  return SettingsSchema.parse(raw && typeof raw === 'object' ? raw : {});
}

export interface ParseResult<T> {
  value: T;
  issues: string[];
}

export function parseMenusFile(raw: unknown): ParseResult<MenusFile> {
  const r = MenusFileSchema.safeParse(raw);
  if (r.success) return { value: r.data, issues: [] };
  return {
    value: { version: MENUS_VERSION, menus: [] },
    issues: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}
