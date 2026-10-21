// Shortcut input: type it, or press "Record" and hit the keys. Recording uses
// physical key codes, so it works with any keyboard layout. While recording,
// OrbitMenu's own global shortcuts are paused so they don't fire.
import { useEffect, useRef, useState } from 'react';
import type { HotkeyStatus } from '@shared/types';
import { activationShortcutError, normalizeShortcut, sendShortcutError, shortcutFromKeyEvent } from '@shared/accelerator';
import { api } from '../api';
import { Badge, Button, cx, Icon } from './ui';

const COMMON: { label: string; keys: string }[] = [
  { label: 'Copy', keys: 'Ctrl+C' },
  { label: 'Paste', keys: 'Ctrl+V' },
  { label: 'Cut', keys: 'Ctrl+X' },
  { label: 'Undo', keys: 'Ctrl+Z' },
  { label: 'Redo', keys: 'Ctrl+Y' },
  { label: 'Save', keys: 'Ctrl+S' },
  { label: 'Save as', keys: 'Ctrl+Shift+S' },
  { label: 'Select all', keys: 'Ctrl+A' },
  { label: 'Find', keys: 'Ctrl+F' },
  { label: 'Print', keys: 'Ctrl+P' },
  { label: 'New tab', keys: 'Ctrl+T' },
  { label: 'Close tab', keys: 'Ctrl+W' },
  { label: 'Reopen closed tab', keys: 'Ctrl+Shift+T' },
  { label: 'Zoom in', keys: 'Ctrl+Plus' },
  { label: 'Zoom out', keys: 'Ctrl+-' },
  { label: 'Rename', keys: 'F2' },
  { label: 'Refresh', keys: 'F5' },
  { label: 'Full screen', keys: 'F11' },
  { label: 'Switch app', keys: 'Alt+Tab' },
  { label: 'Close window', keys: 'Alt+F4' },
  { label: 'Show desktop', keys: 'Super+D' },
  { label: 'File Explorer', keys: 'Super+E' },
  { label: 'Snip screen', keys: 'Super+Shift+S' },
  { label: 'Clipboard history', keys: 'Super+V' },
  { label: 'Emoji panel', keys: 'Super+.' },
  { label: 'Task view', keys: 'Super+Tab' },
  { label: 'Next desktop', keys: 'Ctrl+Super+Right' },
  { label: 'Previous desktop', keys: 'Ctrl+Super+Left' },
  { label: 'Maximize window', keys: 'Super+Up' },
  { label: 'Minimize window', keys: 'Super+Down' },
  { label: 'Snap left', keys: 'Super+Left' },
  { label: 'Snap right', keys: 'Super+Right' },
  { label: 'Task Manager', keys: 'Ctrl+Shift+Escape' },
  { label: 'Play / pause', keys: 'MediaPlayPause' },
  { label: 'Next track', keys: 'MediaNextTrack' },
  { label: 'Volume up', keys: 'VolumeUp' },
  { label: 'Volume down', keys: 'VolumeDown' },
  { label: 'Mute', keys: 'VolumeMute' },
];

const STATUS_BADGE: Record<HotkeyStatus['state'], { kind: 'ok' | 'warn' | 'danger' | undefined; label: string; icon: string }> = {
  ok: { kind: 'ok', label: 'Active', icon: 'CircleCheck' },
  conflict: { kind: 'danger', label: 'Taken by another app', icon: 'CircleAlert' },
  duplicate: { kind: 'danger', label: 'Used twice', icon: 'Copy' },
  invalid: { kind: 'danger', label: 'Invalid', icon: 'CircleAlert' },
  none: { kind: undefined, label: 'No shortcut', icon: 'Keyboard' },
  disabled: { kind: 'warn', label: 'Menu disabled', icon: 'CirclePause' },
};

export function HotkeyBadge({ status }: { status?: HotkeyStatus }) {
  if (!status) return null;
  const b = STATUS_BADGE[status.state];
  return (
    <span title={status.message}>
      <Badge kind={b.kind} icon={b.icon}>
        {b.label}
      </Badge>
    </span>
  );
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** activation: global shortcut that opens a menu; send: keys an action presses. */
  mode: 'activation' | 'send';
  placeholder?: string;
}

export function ShortcutField({ value, onChange, mode, placeholder }: Props) {
  const [recording, setRecording] = useState(false);
  const [live, setLive] = useState('');
  const [text, setText] = useState(value);
  const focusRef = useRef<HTMLInputElement>(null);

  useEffect(() => setText(value), [value]);

  useEffect(() => {
    if (!recording) return;
    void api().suspendHotkeys(true);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.type === 'keyup') {
        if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) setLive('');
        return;
      }
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        setRecording(false);
        return;
      }
      const combo = shortcutFromKeyEvent(e);
      if (!combo) {
        setLive([e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Win'].filter(Boolean).join('+') + '+…');
        return;
      }
      onChange(combo);
      setRecording(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      setLive('');
      void api().suspendHotkeys(false);
    };
  }, [recording, onChange]);

  const error = text.trim() ? (mode === 'activation' ? activationShortcutError(text) : sendShortcutError(text)) : null;

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className={cx('shortcut-field', recording && 'is-recording')}>
        <input
          ref={focusRef}
          className={cx('input', error && 'invalid')}
          value={recording ? live || 'Press the keys…' : text}
          readOnly={recording}
          placeholder={placeholder ?? (mode === 'activation' ? 'e.g. Ctrl+Space' : 'e.g. Ctrl+Shift+S')}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const n = normalizeShortcut(text);
            setText(n);
            if (n !== value) onChange(n);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          aria-label={mode === 'activation' ? 'Activation shortcut' : 'Keys to send'}
        />
        {recording ? (
          <Button icon="Square" onClick={() => setRecording(false)}>
            Stop
          </Button>
        ) : (
          <Button icon="Circle" onClick={() => setRecording(true)} title="Record a shortcut by pressing it">
            Record
          </Button>
        )}
        {mode === 'send' && (
          <select
            className="select"
            style={{ width: 118, flex: 'none' }}
            value=""
            title="Common shortcuts"
            aria-label="Common shortcuts"
            onChange={(e) => e.target.value && onChange(e.target.value)}
          >
            <option value="">Common…</option>
            {COMMON.map((c) => (
              <option key={c.keys} value={c.keys}>
                {c.label} — {c.keys.replace('Super', 'Win')}
              </option>
            ))}
          </select>
        )}
        {value && !recording && (
          <Button icon="X" variant="ghost" title="Clear" onClick={() => onChange('')} />
        )}
      </div>
      {recording && (
        <span className="field-hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="recording-dot" /> Recording — Esc cancels.
          {mode === 'send' && ' Windows reserves some Win combinations; type those instead.'}
        </span>
      )}
      {error && !recording && (
        <span className="field-hint" style={{ color: 'var(--danger)', display: 'flex', gap: 5, alignItems: 'center' }}>
          <Icon name="CircleAlert" size={13} /> {error}
        </span>
      )}
    </div>
  );
}
