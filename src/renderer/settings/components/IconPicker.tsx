// Icon chooser: bundled line icons (searchable), emoji, a local image, the
// target's own Windows icon, or none (monogram).
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { IconSpec } from '@shared/types';
import { LUCIDE_NAMES, lucideSvg } from '../../common/icons';
import { api } from '../api';
import { useImageDrop } from './useImageDrop';
import { Button, cx, Icon, Popover, Segmented, TextInput } from './ui';

const EMOJI = [
  '🚀', '⭐', '🔥', '⚡', '✨', '🎯', '💡', '🧠', '📁', '📂', '📄', '📝', '📋', '📌', '📎', '🔗',
  '🌐', '🔍', '🔒', '🔑', '⚙️', '🛠️', '🧰', '🧪', '💻', '🖥️', '⌨️', '🖱️', '🖨️', '📷', '🎥', '🎬',
  '🎨', '🖌️', '✏️', '🧩', '🎮', '🎧', '🎵', '🔊', '🔇', '📺', '📻', '☕', '🍕', '🏠', '🏢', '🚗',
  '✈️', '🌙', '☀️', '🌈', '❄️', '🌊', '🌱', '🐱', '🐶', '🦊', '🐙', '🦄', '❤️', '💜', '💙', '💚',
  '✅', '❌', '⚠️', '❓', '💬', '📧', '📅', '⏰', '⏱️', '🔔', '📊', '📈', '💰', '🛒', '🎁', '🏆',
  '👍', '👋', '🙏', '👀', '🤖', '👾', '💾', '🗑️', '♻️', '🧹', '🔄', '▶️', '⏸️', '⏹️', '⏭️', '⏮️',
];

type Tab = 'icons' | 'emoji' | 'image' | 'other';

function LucideCell({ name, active, onPick }: { name: string; active: boolean; onPick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    ref.current?.replaceChildren(lucideSvg(name) ?? '');
  }, [name]);
  return <button ref={ref} type="button" className={cx('icon-cell', active && 'is-active')} title={name} onClick={onPick} />;
}

export function IconPicker({ anchor, value, onChange, onClose, allowAuto }: { anchor: HTMLElement | null; value: IconSpec; onChange: (v: IconSpec) => void; onClose: () => void; allowAuto: boolean }) {
  const [tab, setTab] = useState<Tab>(value.kind === 'emoji' ? 'emoji' : value.kind === 'image' ? 'image' : value.kind === 'lucide' ? 'icons' : 'other');
  const [query, setQuery] = useState('');
  const [customEmoji, setCustomEmoji] = useState(value.kind === 'emoji' ? value.value : '');
  const [importError, setImportError] = useState('');
  const drop = useImageDrop((icon) => pick(icon));

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/[\s-]+/g, '');
    const list = q ? LUCIDE_NAMES.filter((n) => n.toLowerCase().includes(q)) : LUCIDE_NAMES;
    return list.slice(0, 320);
  }, [query]);

  const pick = (spec: IconSpec) => {
    onChange(spec);
    onClose();
  };

  return (
    <Popover anchor={anchor} onClose={onClose} width={400}>
      <div className="popover-head">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'icons', label: 'Icons', icon: 'Shapes' },
            { value: 'emoji', label: 'Emoji', icon: 'Smile' },
            { value: 'image', label: 'Image', icon: 'Image' },
            { value: 'other', label: 'Other', icon: 'Ellipsis' },
          ]}
        />
        {tab === 'icons' && <TextInput autoFocus placeholder={`Search ${LUCIDE_NAMES.length} icons…`} value={query} onChange={setQuery} />}
      </div>
      <div className="popover-body">
        {tab === 'icons' && (
          <>
            <div className="icon-grid">
              {matches.map((name) => (
                <LucideCell key={name} name={name} active={value.kind === 'lucide' && value.name === name} onPick={() => pick({ kind: 'lucide', name })} />
              ))}
            </div>
            {matches.length === 0 && <p className="muted">No icon matches “{query}”.</p>}
            {matches.length === 320 && <p className="field-hint">Showing the first 320 matches — refine the search.</p>}
          </>
        )}
        {tab === 'emoji' && (
          <div className="stack">
            <div className="icon-grid">
              {EMOJI.map((e) => (
                <button key={e} type="button" className={cx('icon-cell', value.kind === 'emoji' && value.value === e && 'is-active')} onClick={() => pick({ kind: 'emoji', value: e })}>
                  <span className="emoji">{e}</span>
                </button>
              ))}
            </div>
            <div className="input-row">
              <TextInput placeholder="Or type / paste any emoji (Win + .)" value={customEmoji} onChange={(v) => setCustomEmoji([...v].slice(0, 4).join(''))} />
              <Button variant="primary" disabled={!customEmoji.trim()} onClick={() => pick({ kind: 'emoji', value: customEmoji.trim() })}>
                Use
              </Button>
            </div>
          </div>
        )}
        {tab === 'image' && (
          <div className="stack">
            <p className="field-hint" style={{ margin: 0 }}>
              PNG, JPG, SVG, ICO, WebP, GIF or BMP up to 2 MB — choose a file, or drag one onto the icon. OrbitMenu keeps its own copy, so the original can be moved or deleted.
            </p>
            {value.kind === 'image' && <code className="chip">{value.path}</code>}
            {importError && <span className="field-hint" style={{ color: 'var(--danger)' }}>{importError}</span>}
            <div className={cx('drop-box', drop.over && 'is-drop-over')} {...drop.handlers}>
              <Icon name="ImageDown" size={22} />
              <span>{drop.busy ? 'Copying…' : 'Drop an image here'}</span>
            </div>
            <Button
              icon="FolderOpen"
              onClick={async () => {
                const r = await api().importIcon();
                if (r.error) setImportError(r.error);
                else if (r.path) pick({ kind: 'image', path: r.path });
              }}
            >
              Choose image…
            </Button>
          </div>
        )}
        {tab === 'other' && (
          <div className="stack">
            {allowAuto && (
              <Button icon="AppWindow" onClick={() => pick({ kind: 'auto' })}>
                Use the program’s / file’s own icon
              </Button>
            )}
            <Button icon="Type" onClick={() => pick({ kind: 'none' })}>
              No icon (show initials)
            </Button>
          </div>
        )}
      </div>
    </Popover>
  );
}
