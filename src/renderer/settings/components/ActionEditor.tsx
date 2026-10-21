// Type-specific fields for an item's action.
import { useState } from 'react';
import type { ActionConfig, ActionOf, MacroStep, MacroStepType, MenuItem } from '@shared/types';
import type { WindowSummary } from '@shared/ipc';
import { splitArgs } from '@shared/args';
import { commandSensitivity, normalizeUrl } from '@shared/validation';
import { MACRO_STEP_LABELS } from '@shared/describe';
import { randomId } from '@shared/ids';
import { LIMITS } from '@shared/limits';
import { api } from '../api';
import { ops, useEditor } from '../store';
import { PathField } from './PathField';
import { ShortcutField } from './ShortcutField';
import { Button, Callout, Field, Icon, Popover, Segmented, Switch, TextInput, cx } from './ui';

type Patch<T extends ActionConfig['type']> = (p: Partial<ActionOf<T>>) => void;

const ENV_HINT = (
  <>
    Environment variables like <code>%USERPROFILE%</code> are expanded.
  </>
);

function ArgsPreview({ args }: { args: string }) {
  const parts = splitArgs(args);
  if (!args.trim()) return null;
  return (
    <span className="chips" title="How the arguments will be passed">
      {parts.map((p, i) => (
        <span key={i} className="chip">
          {p || '""'}
        </span>
      ))}
    </span>
  );
}

function LaunchFields({ a, patch }: { a: ActionOf<'launch'>; patch: Patch<'launch'> }) {
  return (
    <div className="stack">
      <Field label="Program" hint={<>An .exe, a shortcut (.lnk) or a name on PATH such as <code>code</code>. {ENV_HINT}</>}>
        <PathField value={a.path} onChange={(path) => patch({ path })} kinds={[{ kind: 'program', label: 'Choose program', icon: 'FolderOpen' }]} placeholder="C:\Program Files\…\app.exe" invalid={!a.path.trim()} ariaLabel="Program path" />
      </Field>
      <Field label="Arguments" hint="Quote arguments that contain spaces. Passed directly — no shell is involved.">
        <TextInput className="mono" value={a.args} onChange={(args) => patch({ args })} placeholder='--new-window "C:\My Files\project"' aria-label="Arguments" />
        <ArgsPreview args={a.args} />
      </Field>
      <Field label="Start in" hint="Optional working folder. Defaults to the program’s folder.">
        <PathField value={a.cwd} onChange={(cwd) => patch({ cwd })} kinds={[{ kind: 'folder', label: 'Choose folder', icon: 'Folder' }]} placeholder="(program folder)" ariaLabel="Working folder" />
      </Field>
    </div>
  );
}

function OpenFields({ a, patch }: { a: ActionOf<'open'>; patch: Patch<'open'> }) {
  return (
    <div className="stack">
      <Field label="File or folder" hint={ENV_HINT}>
        <PathField
          value={a.path}
          onChange={(path) => patch({ path })}
          kinds={[
            { kind: 'file', label: 'Choose File', icon: 'File' },
            { kind: 'folder', label: 'Choose Folder', icon: 'Folder' },
          ]}
          placeholder="C:\Users\you\Documents\report.pdf"
          invalid={!a.path.trim()}
          ariaLabel="File or folder path"
        />
      </Field>
      <Switch checked={a.reveal} onChange={(reveal) => patch({ reveal })} label="Show in File Explorer" description="Select the item in Explorer instead of opening it." />
    </div>
  );
}

function UrlFields({ a, patch }: { a: ActionOf<'url'>; patch: Patch<'url'> }) {
  const r = normalizeUrl(a.url);
  const error = 'error' in r ? r.error : null;
  const normalized = 'url' in r && r.url !== a.url.trim() ? r.url : null;
  return (
    <Field
      label="Address"
      hint={error ? <span style={{ color: 'var(--danger)' }}>{error}</span> : normalized ? <>Will open {normalized}</> : 'Also works with app links such as ms-settings: or spotify:.'}
    >
      <TextInput className="mono" value={a.url} onChange={(url) => patch({ url })} invalid={!!error} placeholder="https://example.com" aria-label="URL" />
    </Field>
  );
}

function HotkeyFields({ a, patch }: { a: ActionOf<'hotkey'>; patch: Patch<'hotkey'> }) {
  return (
    <div className="stack">
      <Field label="Keys to press">
        <ShortcutField mode="send" value={a.keys} onChange={(keys) => patch({ keys })} />
      </Field>
      <Callout>Sent to the window that was active before the menu opened. Apps running as administrator ignore simulated keys unless OrbitMenu also runs as administrator.</Callout>
    </div>
  );
}

function TextFields({ a, patch }: { a: ActionOf<'text'>; patch: Patch<'text'> }) {
  return (
    <div className="stack">
      <Field label="Text" aside={<span className="muted">{a.text.length.toLocaleString()} chars</span>}>
        <textarea className="textarea" value={a.text} maxLength={LIMITS.maxTextLength} onChange={(e) => patch({ text: e.target.value })} placeholder="Best regards,&#10;Alex" aria-label="Snippet text" />
      </Field>
      <Field label="Insert by">
        <Segmented
          value={a.method}
          onChange={(method) => patch({ method })}
          options={[
            { value: 'paste', label: 'Pasting', icon: 'ClipboardPaste' },
            { value: 'type', label: 'Typing', icon: 'Keyboard' },
          ]}
        />
      </Field>
      {a.method === 'paste' ? (
        <>
          <Switch checked={a.restoreClipboard} onChange={(restoreClipboard) => patch({ restoreClipboard })} label="Restore the clipboard afterwards" />
          <Callout>Pasting is instant and keeps formatting-free text intact. Text, HTML, RTF and images on the clipboard are restored; copied files and app-specific formats are not.</Callout>
        </>
      ) : (
        <Callout>Typing simulates each character, which works in terminals and fields that block pasting, but is slower for long text.</Callout>
      )}
    </div>
  );
}

function CommandFields({ a, patch }: { a: ActionOf<'command'>; patch: Patch<'command'> }) {
  const s = commandSensitivity(a.command, a.args);
  return (
    <div className="stack">
      <Field label="Program" hint={<>Runs directly without a shell. For shell syntax use <code>cmd.exe</code> with <code>/c …</code> or <code>powershell.exe</code> with <code>-Command …</code>.</>}>
        <PathField value={a.command} onChange={(command) => patch({ command })} kinds={[{ kind: 'program', label: 'Choose program', icon: 'FolderOpen' }]} placeholder="git.exe" invalid={!a.command.trim()} ariaLabel="Command" />
      </Field>
      <Field label="Arguments">
        <TextInput className="mono" value={a.args} onChange={(args) => patch({ args })} placeholder="pull --rebase" aria-label="Arguments" />
        <ArgsPreview args={a.args} />
      </Field>
      <Field label="Run in" hint={ENV_HINT}>
        <PathField value={a.cwd} onChange={(cwd) => patch({ cwd })} kinds={[{ kind: 'folder', label: 'Choose folder', icon: 'Folder' }]} placeholder="(program folder)" ariaLabel="Working folder" />
      </Field>
      <Switch checked={a.console} onChange={(console) => patch({ console })} label="Show the program window" description="Off runs the command hidden in the background." />
      <Field label="Ask before running">
        <Segmented
          value={a.confirm}
          onChange={(confirm) => patch({ confirm })}
          options={[
            { value: 'auto', label: 'If it looks risky' },
            { value: 'always', label: 'Always' },
            { value: 'never', label: 'Never' },
          ]}
        />
      </Field>
      {s.sensitive && a.confirm !== 'never' && (
        <Callout kind="warn" icon="ShieldAlert">
          OrbitMenu will ask for confirmation: {s.reason}
        </Callout>
      )}
      {s.sensitive && a.confirm === 'never' && (
        <Callout kind="danger" icon="ShieldOff">
          {s.reason} It will run without confirmation.
        </Callout>
      )}
    </div>
  );
}

function MenuFields({ a, patch }: { a: ActionOf<'menu'>; patch: Patch<'menu'> }) {
  const menus = useEditor((s) => s.config.menus);
  const view = useEditor((s) => s.view);
  const current = view.kind === 'menu' ? view.menuId : '';
  return (
    <Field label="Switch to" hint="The current menu is replaced by the chosen one, at the same position.">
      <select className="select" value={a.menuId} onChange={(e) => patch({ menuId: e.target.value })} aria-label="Target menu">
        <option value="">Choose a menu…</option>
        {menus
          .filter((m) => m.id !== current)
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
      </select>
    </Field>
  );
}

function FocusFields({ a, patch }: { a: ActionOf<'focus'>; patch: Patch<'focus'> }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [windows, setWindows] = useState<WindowSummary[] | null>(null);
  const openPicker = async (el: HTMLElement) => {
    setAnchor(el);
    setWindows(await api().listWindows());
  };
  return (
    <div className="stack">
      <Button icon="ScanSearch" onClick={(e) => void openPicker(e.currentTarget)}>
        Pick from open windows…
      </Button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)}>
          <div className="popover-body">
            {windows === null && <p className="muted">Looking for windows…</p>}
            {windows?.length === 0 && <p className="muted">No windows found (or not supported on this system).</p>}
            <div className="window-list">
              {windows?.map((w, i) => (
                <button
                  key={i}
                  type="button"
                  className="window-option"
                  onClick={() => {
                    patch({ processName: w.processName, title: '' });
                    setAnchor(null);
                  }}
                >
                  <span>{w.title}</span>
                  <small>{w.processName}</small>
                </button>
              ))}
            </div>
          </div>
        </Popover>
      )}
      <Field label="Process name" hint="Executable name, e.g. blender.exe. Leave empty to match by title only.">
        <TextInput className="mono" value={a.processName} onChange={(processName) => patch({ processName })} placeholder="blender.exe" aria-label="Process name" />
      </Field>
      <Field label="Window title">
        <div className="input-row">
          <TextInput value={a.title} onChange={(title) => patch({ title })} placeholder="(any title)" aria-label="Window title" />
          <select className="select" style={{ width: 130 }} value={a.titleMatch} onChange={(e) => patch({ titleMatch: e.target.value as ActionOf<'focus'>['titleMatch'] })} aria-label="Title match mode">
            <option value="contains">contains</option>
            <option value="exact">is exactly</option>
            <option value="regex">matches regex</option>
          </select>
        </div>
      </Field>
      <Field label="If no window is open, start" hint="Optional. Leave empty to show an error instead.">
        <PathField value={a.launchPath} onChange={(launchPath) => patch({ launchPath })} kinds={[{ kind: 'program', label: 'Choose program', icon: 'FolderOpen' }]} placeholder="C:\Program Files\…\app.exe" ariaLabel="Program to start" />
      </Field>
      <Callout>Repeating the action cycles through matching windows. Store apps such as Calculator are best matched by title.</Callout>
    </div>
  );
}

const STEP_ICONS: Record<MacroStepType, string> = {
  keys: 'Keyboard',
  delay: 'Timer',
  text: 'Type',
  launch: 'Rocket',
  open: 'ExternalLink',
};

function newStep(type: MacroStepType): MacroStep {
  const id = randomId();
  switch (type) {
    case 'keys':
      return { id, type, keys: '' };
    case 'delay':
      return { id, type, ms: 500 };
    case 'text':
      return { id, type, text: '', method: 'type' };
    case 'launch':
      return { id, type, path: '', args: '' };
    case 'open':
      return { id, type, target: '' };
  }
}

function StepFields({ step, onChange }: { step: MacroStep; onChange: (s: MacroStep) => void }) {
  switch (step.type) {
    case 'keys':
      return <ShortcutField mode="send" value={step.keys} onChange={(keys) => onChange({ ...step, keys })} />;
    case 'delay':
      return (
        <div className="input-row">
          <input className="input mono" type="number" min={0} max={LIMITS.maxMacroDelayMs} step={50} value={step.ms} onChange={(e) => onChange({ ...step, ms: Math.max(0, Math.min(LIMITS.maxMacroDelayMs, Number(e.target.value) || 0)) })} aria-label="Delay in milliseconds" />
          <span className="muted">ms</span>
        </div>
      );
    case 'text':
      return (
        <>
          <textarea className="textarea" style={{ minHeight: 60 }} value={step.text} onChange={(e) => onChange({ ...step, text: e.target.value })} aria-label="Text" />
          <Segmented value={step.method} onChange={(method) => onChange({ ...step, method })} options={[{ value: 'type', label: 'Type' }, { value: 'paste', label: 'Paste' }]} />
        </>
      );
    case 'launch':
      return (
        <>
          <PathField value={step.path} onChange={(path) => onChange({ ...step, path })} kinds={[{ kind: 'program', label: 'Choose program', icon: 'FolderOpen' }]} placeholder="notepad.exe" ariaLabel="Program" />
          <TextInput className="mono" value={step.args} onChange={(args) => onChange({ ...step, args })} placeholder="arguments (optional)" aria-label="Arguments" />
        </>
      );
    case 'open':
      return <PathField value={step.target} onChange={(target) => onChange({ ...step, target })} kinds={[{ kind: 'any', label: 'Choose file', icon: 'File' }]} placeholder="C:\file.txt or https://…" ariaLabel="File or URL" />;
  }
}

function MacroFields({ a, patch }: { a: ActionOf<'macro'>; patch: Patch<'macro'> }) {
  const setSteps = (steps: MacroStep[]) => patch({ steps });
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= a.steps.length) return;
    const next = [...a.steps];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setSteps(next);
  };
  return (
    <div className="stack">
      <div className="macro-steps">
        {a.steps.map((step, i) => (
          <div key={step.id} className="macro-step">
            <div className="macro-step-body">
              <span className="macro-step-type">
                <Icon name={STEP_ICONS[step.type]} /> {MACRO_STEP_LABELS[step.type]}
              </span>
              <StepFields step={step} onChange={(s) => setSteps(a.steps.map((x) => (x.id === s.id ? s : x)))} />
            </div>
            <div className="macro-step-tools">
              <Button small variant="ghost" icon="ChevronUp" title="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
              <Button small variant="ghost" icon="ChevronDown" title="Move down" disabled={i === a.steps.length - 1} onClick={() => move(i, 1)} />
              <Button small variant="ghost" icon="Trash2" title="Remove step" onClick={() => setSteps(a.steps.filter((x) => x.id !== step.id))} />
            </div>
          </div>
        ))}
      </div>
      <div className="row">
        {(Object.keys(MACRO_STEP_LABELS) as MacroStepType[]).map((t) => (
          <Button key={t} small icon={STEP_ICONS[t]} disabled={a.steps.length >= LIMITS.maxMacroSteps} onClick={() => setSteps([...a.steps, newStep(t)])}>
            {MACRO_STEP_LABELS[t]}
          </Button>
        ))}
      </div>
      <Switch checked={a.stopOnError} onChange={(stopOnError) => patch({ stopOnError })} label="Stop at the first failing step" description="Off skips failed steps and continues." />
      <Callout>Press Esc (or use the tray menu) to cancel a running macro. Keys and text go to the window in front — after a launch step, that is usually the new program.</Callout>
    </div>
  );
}

function SubmenuFields({ item }: { item: MenuItem }) {
  return (
    <div className="stack">
      <p className="field-hint" style={{ margin: 0 }}>
        {item.children.length} item{item.children.length === 1 ? '' : 's'} in this submenu. Open it to add or arrange them.
      </p>
      <Button icon="CornerDownRight" onClick={() => ops.enterSubmenu(item.id)}>
        Open submenu
      </Button>
    </div>
  );
}

export function ActionEditor({ item, onChange }: { item: MenuItem; onChange: (a: ActionConfig, key?: string) => void }) {
  const a = item.action;
  // Each field gets its own undo-coalescing key so typing collapses into one step.
  const patch = <T extends ActionConfig['type']>(p: Partial<ActionOf<T>>) => onChange({ ...a, ...p } as ActionConfig, `action:${Object.keys(p).join(',')}`);
  switch (a.type) {
    case 'launch':
      return <LaunchFields a={a} patch={patch} />;
    case 'open':
      return <OpenFields a={a} patch={patch} />;
    case 'url':
      return <UrlFields a={a} patch={patch} />;
    case 'hotkey':
      return <HotkeyFields a={a} patch={patch} />;
    case 'text':
      return <TextFields a={a} patch={patch} />;
    case 'command':
      return <CommandFields a={a} patch={patch} />;
    case 'menu':
      return <MenuFields a={a} patch={patch} />;
    case 'focus':
      return <FocusFields a={a} patch={patch} />;
    case 'macro':
      return <MacroFields a={a} patch={patch} />;
    case 'submenu':
      return <SubmenuFields item={item} />;
    case 'none':
      return <p className={cx('field-hint')}>Pick what this item should do.</p>;
  }
}
