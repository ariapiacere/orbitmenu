// Editor for one menu: header (name, shortcut, options), live preview with
// breadcrumbs, item list and inspector.
import { useState } from 'react';
import type { MenuDefinition } from '@shared/types';
import { childrenAtPath, itemAtPath } from '@shared/tree';
import { validateMenu } from '@shared/validation';
import { api } from '../api';
import { currentItems, ops, useEditor } from '../store';
import { IconPicker } from './IconPicker';
import { ItemInspector } from './ItemInspector';
import { ItemList } from './ItemList';
import { PreviewPane } from './PreviewPane';
import { HotkeyBadge, ShortcutField } from './ShortcutField';
import { Button, Field, Icon, ItemIcon, Issues, Segmented, Switch } from './ui';

function Breadcrumbs({ menu, path }: { menu: MenuDefinition; path: string[] }) {
  const setPath = useEditor((s) => s.setPath);
  const crumbs = [{ id: '', name: menu.name, icon: menu.icon, path: [] as string[] }];
  path.forEach((id, i) => {
    const item = itemAtPath(menu, path.slice(0, i + 1));
    if (item) crumbs.push({ id, name: item.name, icon: item.icon, path: path.slice(0, i + 1) });
  });
  return (
    <nav className="crumbs" aria-label="Submenu path">
      {crumbs.map((c, i) => (
        <span key={c.path.join('/') || 'root'} style={{ display: 'contents' }}>
          {i > 0 && <Icon name="ChevronRight" className="crumb-sep" />}
          <button type="button" className={`crumb ${i === crumbs.length - 1 ? 'is-current' : ''}`} onClick={() => setPath(c.path)}>
            <ItemIcon spec={c.icon} label={c.name} className="ui-icon" />
            {c.name || 'Untitled'}
          </button>
        </span>
      ))}
      {path.length > 0 && (
        <Button small variant="ghost" icon="ArrowUp" title="Up one level" style={{ marginLeft: 'auto' }} onClick={() => setPath(path.slice(0, -1))}>
          Up
        </Button>
      )}
    </nav>
  );
}

export function MenuEditor({ menu }: { menu: MenuDefinition }) {
  const path = useEditor((s) => s.path);
  const selectedId = useEditor((s) => s.selectedItemId);
  const appearance = useEditor((s) => s.config.settings.appearance);
  const status = useEditor((s) => s.hotkeys.find((h) => h.id === menu.id));
  const menuCount = useEditor((s) => s.config.menus.length);
  const items = useEditor((s) => currentItems(s));
  const [iconAnchor, setIconAnchor] = useState<HTMLElement | null>(null);
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const validPath = childrenAtPath(menu, path) !== null;
  const issues = validateMenu(menu).filter((i) => i.field !== 'shortcut');

  return (
    <div className="editor">
      <header className="editor-header">
        <button type="button" className="icon-button" style={{ width: 46, height: 46 }} title="Menu icon" onClick={(e) => setIconAnchor(e.currentTarget)}>
          <ItemIcon spec={menu.icon} label={menu.name} className="ui-icon" />
        </button>
        {iconAnchor && <IconPicker anchor={iconAnchor} value={menu.icon} allowAuto={false} onChange={(icon) => ops.updateMenu(menu.id, { icon })} onClose={() => setIconAnchor(null)} />}
        <div className="field" style={{ minWidth: 200 }}>
          <span className="field-label">Menu name</span>
          <input className="input menu-name-input" value={menu.name} maxLength={120} onChange={(e) => ops.updateMenu(menu.id, { name: e.target.value }, `${menu.id}:name`)} aria-label="Menu name" />
        </div>
        <Field label="Shortcut" aside={<HotkeyBadge status={status} />} className="grow">
          <ShortcutField mode="activation" value={menu.shortcut} onChange={(shortcut) => ops.updateMenu(menu.id, { shortcut })} />
        </Field>
        <Field label="Opens at">
          <Segmented
            value={menu.openAt}
            onChange={(openAt) => ops.updateMenu(menu.id, { openAt })}
            options={[
              { value: 'cursor', label: 'Pointer', icon: 'MousePointer2' },
              { value: 'screen-center', label: 'Center', icon: 'Crosshair' },
            ]}
          />
        </Field>
        <div className="field">
          <span className="field-label">Enabled</span>
          <div style={{ height: 34, display: 'flex', alignItems: 'center' }}>
            <Switch checked={menu.enabled} onChange={(enabled) => ops.updateMenu(menu.id, { enabled })} />
          </div>
        </div>
        <div className="row">
          <Button icon="Play" variant="primary" disabled={!menu.enabled} onClick={() => void api().testMenu(menu.id)} title="Open this menu now">
            Test
          </Button>
          <Button icon="CopyPlus" title="Duplicate menu" onClick={() => ops.duplicateMenu(menu.id)} />
          <Button
            icon="Trash2"
            variant="danger"
            title="Delete menu"
            disabled={menuCount <= 1}
            onClick={() => {
              if (window.confirm(`Delete the menu “${menu.name}” and all of its items?`)) ops.deleteMenu(menu.id);
            }}
          />
        </div>
      </header>

      <div className="editor-body">
        <section className="preview-col" aria-label="Preview">
          <Breadcrumbs menu={menu} path={validPath ? path : []} />
          <PreviewPane
            menu={menu}
            appearance={appearance}
            path={validPath ? path : []}
            selectedId={selectedId}
            onSelect={(id) => ops.selectItemSafe(id)}
            onUp={() => path.length && useEditor.getState().setPath(path.slice(0, -1))}
          />
          <div className="preview-help">
            <span>
              <Icon name="MousePointerClick" size={13} /> Click to edit
            </span>
            <span>
              <Icon name="CornerDownRight" size={13} /> Click again or double-click to enter a submenu
            </span>
            <span>
              <Icon name="CircleDot" size={13} /> Click the hub to go up
            </span>
          </div>
        </section>

        <aside className="side-col">
          <section className="panel-section">
            <div className="panel-title">
              <span>Items {path.length ? 'in this submenu' : ''}</span>
              <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>
                clockwise from top
              </span>
            </div>
            <ItemList items={items} />
          </section>
          <section className="panel-section" style={{ borderBottom: 0 }}>
            {selected ? (
              <ItemInspector key={selected.id} item={selected} menu={menu} siblings={items} />
            ) : (
              <div className="stack">
                <div className="panel-title">Menu</div>
                <Issues issues={issues} />
                <p className="field-hint" style={{ margin: 0 }}>
                  Select an item in the list or the preview to edit it. Keep 6–8 items per ring for fast gestures; the four compass directions are the easiest to hit.
                </p>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
