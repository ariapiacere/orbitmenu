/** Hard limits that keep a malformed or hostile config from hanging the app. */
export const LIMITS = {
  maxItemsPerLevel: 12,
  maxDepth: 12,
  maxMenus: 64,
  maxMacroSteps: 200,
  maxMacroDelayMs: 60_000,
  maxTextLength: 20_000,
  maxNameLength: 120,
} as const;
