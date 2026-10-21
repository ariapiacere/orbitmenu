// Action registry: each action type has one handler. The engine validates an
// action before running it and turns failures into readable errors.
import type { ActionConfig, ActionOf, ActionType, Settings } from '@shared/types';
import { validateAction } from '@shared/validation';
import type { Platform } from '../platform';

export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionError';
  }
}

/** Thrown when the user declines a confirmation or cancels a macro. Not an error to report. */
export class CancelledError extends Error {
  constructor(message = 'Cancelled') {
    super(message);
    this.name = 'CancelledError';
  }
}

export interface ActionContext {
  platform: Platform;
  settings: Settings;
  /** Label shown in confirmations and error messages. */
  label: string;
  signal: AbortSignal;
  /**
   * Gives focus back to the window that was active before the menu opened,
   * then waits for it to settle. Safe to call more than once.
   */
  focusTarget(): Promise<void>;
  /** The window that was active before the menu opened, if known. */
  targetWindow: number | null;
  confirm(message: string, detail: string): Promise<boolean>;
  /** Opens another menu (used by "switch menu" when run outside the overlay). */
  openMenu(menuId: string): void;
  /** Called before a step sends Escape, so a global cancel key does not swallow it. */
  beforeSendingKeys(keys: string): void;
  afterSendingKeys(): void;
}

export interface ActionHandler<T extends ActionType = ActionType> {
  type: T;
  execute(action: ActionOf<T>, ctx: ActionContext): Promise<void>;
}

export class ActionEngine {
  private readonly handlers = new Map<ActionType, ActionHandler>();

  register<T extends ActionType>(handler: ActionHandler<T>): this {
    this.handlers.set(handler.type, handler as unknown as ActionHandler);
    return this;
  }

  has(type: ActionType): boolean {
    return this.handlers.has(type);
  }

  async run(action: ActionConfig, ctx: ActionContext, menuIds: ReadonlySet<string>): Promise<void> {
    const errors = validateAction(action, menuIds).filter((i) => i.level === 'error');
    if (errors.length) throw new ActionError(errors.map((e) => e.message).join(' '));
    const handler = this.handlers.get(action.type);
    if (!handler) throw new ActionError(`Actions of type "${action.type}" cannot be run.`);
    if (ctx.signal.aborted) throw new CancelledError();
    await handler.execute(action as never, ctx);
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError('Macro cancelled'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new CancelledError('Macro cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
