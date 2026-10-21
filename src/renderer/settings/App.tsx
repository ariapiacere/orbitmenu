// Settings window shell: title bar, sidebar with menus, and the active page.
import { useEffect } from 'react';
import logo from '../../../assets/icons/orbitmenu.png';
import { displayShortcut } from '@shared/accelerator';
import { currentMenu, ops, saveNow, useEditor } from './store';
import { AboutPage } from './components/About';
import { GeneralSettingsPage } from './components/GeneralSettings';
import { MenuEditor } from './components/MenuEditor';
import { Button, Callout, cx, Icon, ItemIcon } from './components/ui';

function SaveIndicator() {
  const state = useEditor((s) => s.saveState);
  const errors = useEditor((s) => s.saveErrors);
  const label = { saved: 'All changes saved', pending: 'Saving…', saving: 'Saving…', error: 'Not saved' }[state];
  return (
    <span className={cx('save-state', (state === 'pending' || state === 'saving') && 'saving', state === 'error' && 'error')} title={errors.join('\n')}>
      <span className="dot" />
      {label}
    </span>
  );
}

function TitleBar() {
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const { undo, redo } = useEditor.getState();
  return (
    <header className="titlebar">
      <span className="brand">
        <img src={logo} alt="" className="brand-mark" />
        OrbitMenu
      </span>
      <span className="spacer" />
      <Button small variant="ghost" icon="Undo2" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo} />
      <Button small variant="ghost" icon="Redo2" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={redo} />
      <SaveIndicator />
    </header>
  );
}

function Sidebar() {
  const menus = useEditor((s) => s.config.menus);
  const view = useEditor((s) => s.view);
  const hotkeys = useEditor((s) => s.hotkeys);
  const setView = useEditor((s) => s.setView);
  const update = useEditor((s) => s.updateInfo);
  const updateBadge = update?.status === 'ready' ? 'Restart to update' : update?.status === 'available' ? `${update.latestVersion} available` : null;
  return (
    <nav className="sidebar" aria-label="Menus and settings">
      <div className="sidebar-section">
        <div className="sidebar-title">
          <span>Menus</span>
          <Button small variant="ghost" icon="Plus" title="New menu" onClick={() => ops.addMenu()} />
        </div>
      </div>
      <div className="menu-list">
        {menus.map((m) => {
          const status = hotkeys.find((h) => h.id === m.id);
          const problem = status && (status.state === 'conflict' || status.state === 'duplicate' || status.state === 'invalid');
          return (
            <button
              key={m.id}
              type="button"
              className={cx('nav-item', view.kind === 'menu' && view.menuId === m.id && 'is-active', !m.enabled && 'is-disabled')}
              onClick={() => setView({ kind: 'menu', menuId: m.id })}
            >
              <span className="nav-icon">
                <ItemIcon spec={m.icon} label={m.name} className="ui-icon" />
              </span>
              <span className="nav-text">
                <span className="nav-name">{m.name || 'Untitled'}</span>
                <span className="nav-meta" style={problem ? { color: 'var(--danger)' } : undefined}>
                  {problem ? status!.message : m.shortcut ? displayShortcut(m.shortcut) : 'No shortcut'}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="sidebar-footer">
        <button type="button" className={cx('nav-item', view.kind === 'general' && 'is-active')} onClick={() => setView({ kind: 'general' })}>
          <span className="nav-icon">
            <Icon name="Settings2" />
          </span>
          <span className="nav-text">
            <span className="nav-name">Settings</span>
          </span>
        </button>
        <button type="button" className={cx('nav-item', view.kind === 'about' && 'is-active')} onClick={() => setView({ kind: 'about' })}>
          <span className="nav-icon">
            <Icon name="Info" />
          </span>
          <span className="nav-text">
            <span className="nav-name">About & updates</span>
            {updateBadge && (
              <span className="nav-meta" style={{ color: 'var(--accent)' }}>
                {updateBadge}
              </span>
            )}
          </span>
          {updateBadge && <span className="update-dot" />}
        </button>
      </div>
    </nav>
  );
}

function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  const dismiss = useEditor((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx('toast', t.kind)} onClick={() => dismiss(t.id)}>
          <Icon name={t.kind === 'ok' ? 'CircleCheck' : t.kind === 'error' ? 'CircleAlert' : 'Info'} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

function isTextTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

export function App() {
  const view = useEditor((s) => s.view);
  const menu = useEditor((s) => currentMenu(s));
  const warnings = useEditor((s) => s.loadWarnings);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        void saveNow();
        return;
      }
      // Inside text fields the browser's own undo is more useful.
      if (isTextTarget(e.target)) return;
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        useEditor.getState().undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        useEditor.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="shell">
      <TitleBar />
      <Sidebar />
      <main className="main">
        {warnings.length > 0 && (
          <div style={{ padding: '12px 22px 0' }}>
            <Callout kind="warn" icon="TriangleAlert">
              {warnings.join(' ')}
            </Callout>
          </div>
        )}
        {view.kind === 'menu' && menu && <MenuEditor key={menu.id} menu={menu} />}
        {view.kind === 'general' && <GeneralSettingsPage />}
        {view.kind === 'about' && <AboutPage />}
      </main>
      <Toasts />
    </div>
  );
}
