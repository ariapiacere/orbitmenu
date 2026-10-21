// Built-in action handlers.
import { clipboard, ClipboardItem, shell } from 'electron';
import { existsSync } from 'node:fs';
import type { ActionOf, MacroStep, TextMethod } from '@shared/types';
import { parseShortcut } from '@shared/accelerator';
import { formatCommandLine, splitArgs } from '@shared/args';
import { needsConfirmation, normalizeUrl } from '@shared/validation';
import { ActionEngine, ActionError, CancelledError, sleep, type ActionContext, type ActionHandler } from './engine';
import { expandEnv, startProgram } from './process';
import { log } from '../log';

async function sendKeys(keys: string, ctx: ActionContext): Promise<void> {
  const parsed = parseShortcut(keys);
  if (!parsed.ok) throw new ActionError(parsed.error);
  if (!ctx.platform.capabilities.sendKeys) throw new ActionError('Sending keys is not supported on this system.');
  // Keys the user is still holding (e.g. from the activation shortcut) would
  // combine with ours, so wait for them to be released first.
  await ctx.platform.waitForModifiersReleased(1500);
  ctx.beforeSendingKeys(keys);
  try {
    await ctx.platform.sendShortcut(parsed.value);
  } finally {
    ctx.afterSendingKeys();
  }
}

async function insertText(text: string, method: TextMethod, restoreClipboard: boolean, ctx: ActionContext): Promise<void> {
  if (!text) return;
  await ctx.platform.waitForModifiersReleased(1500);
  if (method === 'type') {
    if (!ctx.platform.capabilities.typeText) throw new ActionError('Typing text is not supported on this system.');
    await ctx.platform.typeText(text);
    return;
  }
  // Paste: put the snippet on the clipboard, press Ctrl+V, then put back what
  // was there. Every MIME type Electron exposes is restored (text, HTML, RTF,
  // images); formats it cannot read, such as files copied in Explorer or
  // private application data, are lost — see docs/limitations.md.
  const saved = restoreClipboard ? await snapshotClipboard() : null;
  await clipboard.writeText(text);
  const paste = parseShortcut('Ctrl+V');
  if (!paste.ok) return;
  await ctx.platform.sendShortcut(paste.value);
  if (!saved) return;
  await sleep(ctx.settings.general.clipboardRestoreDelayMs);
  // If something else replaced the clipboard meanwhile, leave it alone.
  if ((await clipboard.readText()) !== text) return;
  await restoreClipboardSnapshot(saved);
}

export async function snapshotClipboard(): Promise<ClipboardItem[] | null> {
  try {
    const copies: ClipboardItem[] = [];
    for (const item of await clipboard.read()) {
      const data: Record<string, Blob | Electron.ClipboardBookmark> = {};
      for (const type of item.types) {
        try {
          data[type] = await item.getType(type);
        } catch {
          // Unreadable format; skip it.
        }
      }
      if (Object.keys(data).length) copies.push(new ClipboardItem(data));
    }
    return copies;
  } catch (err) {
    log.warn('Could not read the clipboard before pasting:', err);
    return null;
  }
}

export async function restoreClipboardSnapshot(items: ClipboardItem[]): Promise<void> {
  try {
    if (items.length) await clipboard.write(items);
    else clipboard.clear();
  } catch (err) {
    log.warn('Could not restore every clipboard format:', err);
  }
}

async function openTarget(rawTarget: string, ctx: ActionContext): Promise<void> {
  const target = expandEnv(rawTarget.trim());
  // Drive letters ("C:\…") look like URL schemes; treat anything that exists on disk as a path.
  if (existsSync(target)) {
    ctx.platform.allowForegroundForNewProcesses();
    const err = await shell.openPath(target);
    if (err) throw new ActionError(err);
    return;
  }
  const url = normalizeUrl(target);
  if ('url' in url && /^[a-z][a-z0-9+.-]+:/i.test(target)) {
    ctx.platform.allowForegroundForNewProcesses();
    await shell.openExternal(url.url);
    return;
  }
  throw new ActionError(`Not found: ${target}`);
}

const launch: ActionHandler<'launch'> = {
  type: 'launch',
  async execute(a, ctx) {
    ctx.platform.allowForegroundForNewProcesses();
    await startProgram(a.path, { args: a.args, cwd: a.cwd, console: true });
  },
};

const open: ActionHandler<'open'> = {
  type: 'open',
  async execute(a, ctx) {
    const path = expandEnv(a.path.trim().replace(/^"(.*)"$/, '$1'));
    if (!existsSync(path)) throw new ActionError(`File or folder not found: ${path}`);
    ctx.platform.allowForegroundForNewProcesses();
    if (a.reveal) {
      shell.showItemInFolder(path);
      return;
    }
    const err = await shell.openPath(path);
    if (err) throw new ActionError(err);
  },
};

const url: ActionHandler<'url'> = {
  type: 'url',
  async execute(a, ctx) {
    const r = normalizeUrl(a.url);
    if ('error' in r) throw new ActionError(r.error);
    ctx.platform.allowForegroundForNewProcesses();
    try {
      await shell.openExternal(r.url);
    } catch (err) {
      throw new ActionError(`No application is registered for this link (${(err as Error).message}).`);
    }
  },
};

const hotkey: ActionHandler<'hotkey'> = {
  type: 'hotkey',
  async execute(a, ctx) {
    await ctx.focusTarget();
    await sendKeys(a.keys, ctx);
  },
};

const text: ActionHandler<'text'> = {
  type: 'text',
  async execute(a, ctx) {
    await ctx.focusTarget();
    await insertText(a.text, a.method, a.restoreClipboard, ctx);
  },
};

const command: ActionHandler<'command'> = {
  type: 'command',
  async execute(a, ctx) {
    const check = needsConfirmation(a);
    if (check.sensitive) {
      const line = formatCommandLine(expandEnv(a.command), splitArgs(expandEnv(a.args)));
      const detail = `${check.reason}\n\n${line}${a.cwd ? `\n\nIn: ${expandEnv(a.cwd)}` : ''}`;
      if (!(await ctx.confirm(`Run "${ctx.label}"?`, detail))) throw new CancelledError();
    }
    ctx.platform.allowForegroundForNewProcesses();
    await startProgram(a.command, { args: a.args, cwd: a.cwd, console: a.console });
  },
};

function titleMatches(title: string, pattern: string, mode: ActionOf<'focus'>['titleMatch']): boolean {
  if (!pattern) return true;
  const t = title.toLowerCase();
  const p = pattern.toLowerCase();
  if (mode === 'exact') return t === p;
  if (mode === 'regex') {
    try {
      return new RegExp(pattern, 'i').test(title);
    } catch {
      return false;
    }
  }
  return t.includes(p);
}

const focus: ActionHandler<'focus'> = {
  type: 'focus',
  async execute(a, ctx) {
    if (!ctx.platform.capabilities.focusWindows) throw new ActionError('Focusing windows is not supported on this system.');
    const wanted = a.processName.trim().toLowerCase().replace(/\.exe$/, '');
    const matches = ctx.platform.listWindows().filter((w) => {
      if (wanted && w.processName.replace(/\.exe$/, '') !== wanted) return false;
      return titleMatches(w.title, a.title.trim(), a.titleMatch);
    });
    if (matches.length === 0) {
      if (a.launchPath.trim()) {
        ctx.platform.allowForegroundForNewProcesses();
        await startProgram(a.launchPath, { args: '', cwd: '', console: true });
        return;
      }
      throw new ActionError(`No open window matches ${[a.processName, a.title].filter(Boolean).join(' / ')}.`);
    }
    // Windows are listed front to back; if the frontmost match is the window the
    // user came from, cycle to the next one so repeated use walks through them.
    const currentIndex = matches.findIndex((w) => w.handle === ctx.targetWindow);
    const target = matches[currentIndex === -1 ? 0 : (currentIndex + 1) % matches.length]!;
    if (!ctx.platform.bringToForeground(target.handle)) {
      throw new ActionError(`Windows did not allow OrbitMenu to focus "${target.title}".`);
    }
  },
};

const macro: ActionHandler<'macro'> = {
  type: 'macro',
  async execute(a, ctx) {
    // After a step opens something new, input goes to whatever is in front,
    // not back to the original window.
    let targetValid = true;
    const runStep = async (step: MacroStep) => {
      switch (step.type) {
        case 'keys':
          if (targetValid) await ctx.focusTarget();
          await sendKeys(step.keys, ctx);
          break;
        case 'delay':
          await sleep(step.ms, ctx.signal);
          break;
        case 'text':
          if (targetValid) await ctx.focusTarget();
          await insertText(step.text, step.method, true, ctx);
          break;
        case 'launch':
          targetValid = false;
          ctx.platform.allowForegroundForNewProcesses();
          await startProgram(step.path, { args: step.args, cwd: '', console: true });
          break;
        case 'open':
          targetValid = false;
          await openTarget(step.target, ctx);
          break;
      }
    };
    for (const [index, step] of a.steps.entries()) {
      if (ctx.signal.aborted) throw new CancelledError('Macro cancelled');
      try {
        await runStep(step);
      } catch (err) {
        if (err instanceof CancelledError) throw err;
        const message = `Step ${index + 1} (${step.type}) failed: ${(err as Error).message}`;
        if (a.stopOnError) throw new ActionError(message);
        log.warn(`[macro ${ctx.label}] ${message}; continuing.`);
      }
    }
  },
};

const none: ActionHandler<'none'> = { type: 'none', async execute() {} };

const menu: ActionHandler<'menu'> = {
  type: 'menu',
  async execute(a, ctx) {
    ctx.openMenu(a.menuId);
  },
};

export function createActionEngine(): ActionEngine {
  return new ActionEngine()
    .register(launch)
    .register(open)
    .register(url)
    .register(hotkey)
    .register(text)
    .register(command)
    .register(focus)
    .register(macro)
    .register(menu)
    .register(none);
}

