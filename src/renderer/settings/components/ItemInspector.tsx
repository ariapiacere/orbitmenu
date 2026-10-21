// Properties of the selected item: look, action, and advanced placement.
import { useState } from 'react';
import type { ActionType, MenuDefinition, MenuItem } from '@shared/types';
import { ACTION_TYPES } from '@shared/describe';
import { validateItem } from '@shared/validation';
import { childrenAtPath, defaultAction } from '@shared/tree';
import { computeItemAngles } from '@shared/geometry';
import { api } from '../api';
import { ops, useEditor } from '../store';
import { ActionEditor } from './ActionEditor';
import { IconPicker } from './IconPicker';
import { useImageDrop } from './useImageDrop';
import { Button, Callout, cx, Field, Icon, ItemIcon, Issues, Slider, Switch, TextInput } from './ui';

const LEAF_TYPES = new Set<ActionType>(['launch', 'open', 'url', 'hotkey', 'text', 'command', 'focus', 'macro']);
const INPUT_TYPES = new Set<ActionType>(['hotkey', 'text', 'macro']);

export function ItemInspector({ item, menu, siblings }: { item: MenuItem; menu: MenuDefinition; siblings: MenuItem[] }) {
  const path = useEditor((s) => s.path);
  const menus = useEditor((s) => s.config.menus);
  const toast = useEditor((s) => s.toast);
  const [iconAnchor, setIconAnchor] = useState<HTMLElement | null>(null);
  const [testing, setTesting] = useState(false);
  const issues = validateItem(item, new Set(menus.map((m) => m.id)));
  const upd = (fn: (i: MenuItem) => MenuItem, key?: string) => ops.updateItem(item.id, fn, key);
  const drop = useImageDrop((icon) => upd((i) => ({ ...i, icon })));

  const index = siblings.findIndex((s) => s.id === item.id);
  const autoAngle = Math.round(computeItemAngles(siblings, path.length ? 180 : null)[index] ?? 0);
  const hintClash = item.hint && siblings.some((s) => s.id !== item.id && s.hint.toLowerCase() === item.hint.toLowerCase());

  // Places this item can be moved to: the parent ring and sibling submenus.
  const targets: { label: string; path: string[] }[] = [];
  if (path.length) targets.push({ label: '↑ Parent ring', path: path.slice(0, -1) });
  for (const s of siblings) {
    if (s.id !== item.id && s.action.type === 'submenu') targets.push({ label: `→ ${s.name}`, path: [...path, s.id] });
  }

  const test = async () => {
    setTesting(true);
    try {
      // Input actions go to the window in front, so give the user time to switch to it.
      if (INPUT_TYPES.has(item.action.type)) {
        toast('Running in 3 seconds — switch to the window that should receive the input.', 'info');
        await new Promise((r) => setTimeout(r, 3000));
      }
      const r = await api().testAction(item.action);
      if (r.ok) toast(`“${item.name}” ran successfully.`, 'ok');
      else if (r.error && r.error !== 'Cancelled') toast(r.error, 'error');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="inspector">
      <div className={cx('inspector-head', 'drop-zone', drop.over && 'is-drop-over')} {...drop.handlers}>
        <button
          type="button"
          className={cx('icon-button', drop.over && 'is-drop-target', drop.busy && 'is-busy')}
          title="Change icon — or drop an image here"
          onClick={(e) => setIconAnchor(e.currentTarget)}
        >
          <ItemIcon spec={item.icon} action={item.action} label={item.name} className="ui-icon" />
          <span className="edit-chip">
            <Icon name={drop.over ? 'ImageDown' : 'Pencil'} />
          </span>
        </button>
        {drop.over && <div className="drop-hint">Drop to use as the icon</div>}
        <div className="stack" style={{ gap: 6 }}>
          <TextInput value={item.name} onChange={(name) => upd((i) => ({ ...i, name }), 'name')} placeholder="Name" aria-label="Item name" maxLength={120} />
          <TextInput value={item.description} onChange={(description) => upd((i) => ({ ...i, description }), 'description')} placeholder="Subtitle shown in the hub (optional)" aria-label="Description" maxLength={500} />
        </div>
      </div>
      {iconAnchor && (
        <IconPicker
          anchor={iconAnchor}
          value={item.icon}
          allowAuto={['launch', 'open', 'command', 'focus'].includes(item.action.type)}
          onChange={(icon) => upd((i) => ({ ...i, icon }))}
          onClose={() => setIconAnchor(null)}
        />
      )}

      <Field label="Action">
        <div className="type-grid">
          {ACTION_TYPES.map((t) => (
            <button
              key={t.type}
              type="button"
              title={t.blurb}
              className={cx('type-card', item.action.type === t.type && 'is-active')}
              disabled={t.type === 'submenu' && path.length >= 11}
              onClick={() => item.action.type !== t.type && upd((i) => ({ ...i, action: defaultAction(t.type) }))}
            >
              <Icon name={t.icon} />
              {t.label}
            </button>
          ))}
        </div>
      </Field>

      <ActionEditor item={item} onChange={(action, key) => upd((i) => ({ ...i, action }), key)} />

      <Issues issues={issues.filter((i) => i.field !== 'name')} />

      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--text-2)' }}>Placement & keyboard</summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <Field label="Hint key" hint="Press this key while the ring is open to choose the item. Shown as a badge.">
            <TextInput
              className="mono"
              style={{ width: 70, textAlign: 'center' }}
              value={item.hint.toUpperCase()}
              onChange={(v) => {
                const hint = v.slice(-1).toLowerCase();
                if (hint === '' || /^[a-z0-9]$/.test(hint)) upd((i) => ({ ...i, hint }));
              }}
              placeholder="—"
              aria-label="Hint key"
            />
          </Field>
          {hintClash && <Callout kind="warn">Another item in this ring uses the same hint key; the first one wins.</Callout>}
          <Switch
            checked={item.fixedAngle !== null}
            onChange={(on) => upd((i) => ({ ...i, fixedAngle: on ? autoAngle % 360 : null }))}
            label="Pin to a direction"
            description="Keeps the item at a fixed angle; other items fill the gaps."
          />
          {item.fixedAngle !== null && (
            <>
              <Slider
                label="Direction"
                value={item.fixedAngle}
                min={0}
                max={359}
                onChange={(fixedAngle) => upd((i) => ({ ...i, fixedAngle }), 'angle')}
                format={(v) => `${v}° ${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(v / 45) % 8]}`}
              />
              <span className="field-hint">Pinned directions must increase clockwise in list order, otherwise the item is placed automatically.</span>
            </>
          )}
          {targets.length > 0 && (
            <Field label="Move to">
              <select className="select" value="" onChange={(e) => e.target.value && ops.moveItemTo(item.id, JSON.parse(e.target.value))} aria-label="Move item to">
                <option value="">Choose a ring…</option>
                {targets.map((t) => (
                  <option key={t.path.join('/')} value={JSON.stringify(t.path)} disabled={(childrenAtPath(menu, t.path)?.length ?? 0) >= 12}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </details>

      <div className="row" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        {LEAF_TYPES.has(item.action.type) && (
          <Button icon="Play" onClick={() => void test()} disabled={testing || issues.some((i) => i.level === 'error')} title="Run this action now">
            {testing ? 'Running…' : 'Test'}
          </Button>
        )}
        <Button icon="Copy" onClick={() => ops.duplicateItem(item.id)}>
          Duplicate
        </Button>
        <Button icon="Trash2" variant="danger" onClick={() => ops.deleteItem(item.id)} style={{ marginLeft: 'auto' }}>
          Delete
        </Button>
      </div>
    </div>
  );
}
