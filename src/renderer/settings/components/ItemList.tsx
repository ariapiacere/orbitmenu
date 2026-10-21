// Items of the current ring in clockwise order. Drag rows to reorder;
// Alt+↑/↓ moves the selected row, Delete removes it.
import { useState } from 'react';
import type { MenuItem } from '@shared/types';
import { describeAction } from '@shared/describe';
import { validateItem } from '@shared/validation';
import { LIMITS } from '@shared/limits';
import { ops, useEditor } from '../store';
import { Button, cx, Icon, ItemIcon } from './ui';

interface DragState {
  from: number;
  over: number;
  after: boolean;
}

export function ItemList({ items }: { items: MenuItem[] }) {
  const selectedId = useEditor((s) => s.selectedItemId);
  const menus = useEditor((s) => s.config.menus);
  const [drag, setDrag] = useState<DragState | null>(null);
  const menuIds = new Set(menus.map((m) => m.id));
  const full = items.length >= LIMITS.maxItemsPerLevel;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = items.findIndex((x) => x.id === selectedId);
    if (i < 0) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      ops.moveItem(i, e.key === 'ArrowUp' ? i - 1 : i + 1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const j = Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowUp' ? -1 : 1)));
      ops.selectItemSafe(items[j]!.id);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      ops.deleteItem(items[i]!.id);
    } else if (e.key === 'Enter' && items[i]!.action.type === 'submenu') {
      ops.enterSubmenu(items[i]!.id);
    }
  };

  return (
    <div>
      <div className="item-list" role="listbox" aria-label="Items" tabIndex={0} onKeyDown={onKeyDown}>
        {items.map((item, i) => {
          const issues = validateItem(item, menuIds);
          const level = issues.some((x) => x.level === 'error') ? 'error' : issues.length ? 'warn' : null;
          return (
            <div
              key={item.id}
              role="option"
              aria-selected={item.id === selectedId}
              className={cx(
                'item-row',
                item.id === selectedId && 'is-selected',
                drag?.from === i && 'is-dragging',
                drag && drag.over === i && drag.from !== i && (drag.after ? 'drop-after' : 'drop-before'),
              )}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', item.id);
                setDrag({ from: i, over: i, after: false });
              }}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                const after = e.clientY > r.top + r.height / 2;
                if (drag.over !== i || drag.after !== after) setDrag({ ...drag, over: i, after });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!drag) return;
                let to = drag.after ? drag.over + 1 : drag.over;
                if (drag.from < to) to -= 1;
                ops.moveItem(drag.from, to);
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
              onClick={() => ops.selectItemSafe(item.id)}
              onDoubleClick={() => item.action.type === 'submenu' && ops.enterSubmenu(item.id)}
            >
              <Icon name="GripVertical" className="drag-handle" size={14} />
              <ItemIcon spec={item.icon} action={item.action} label={item.name} className="row-icon" />
              <div className="row-text">
                <div className="row-name">
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name || 'Untitled'}</span>
                  {item.hint && <kbd className="key" style={{ height: 17, fontSize: 10 }}>{item.hint.toUpperCase()}</kbd>}
                  {level && <span className={cx('issue-dot', level === 'error' && 'error')} title={issues.map((x) => x.message).join('\n')} />}
                </div>
                <div className="row-meta">
                  {item.action.type === 'submenu'
                    ? `Submenu · ${item.children.length} item${item.children.length === 1 ? '' : 's'}`
                    : item.description || describeAction(item.action, menus)}
                </div>
              </div>
              <div className="row-actions">
                {item.action.type === 'submenu' && (
                  <Button small variant="ghost" icon="CornerDownRight" title="Open submenu" onClick={(e) => (e.stopPropagation(), ops.enterSubmenu(item.id))} />
                )}
                <Button small variant="ghost" icon="Copy" title="Duplicate" disabled={full} onClick={(e) => (e.stopPropagation(), ops.duplicateItem(item.id))} />
                <Button small variant="ghost" icon="Trash2" title="Delete" onClick={(e) => (e.stopPropagation(), ops.deleteItem(item.id))} />
              </div>
            </div>
          );
        })}
        {items.length === 0 && <p className="muted" style={{ margin: '4px 6px' }}>This ring is empty. Add an item to get started.</p>}
      </div>
      <div className="list-actions">
        <Button icon="Plus" disabled={full} onClick={() => ops.addItem('item')}>
          Item
        </Button>
        <Button icon="CircleDot" disabled={full} onClick={() => ops.addItem('submenu')}>
          Submenu
        </Button>
        <span className="muted" style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12 }}>
          {items.length}/{LIMITS.maxItemsPerLevel}
        </span>
      </div>
    </div>
  );
}
