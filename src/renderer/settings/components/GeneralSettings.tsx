// General settings: appearance (with live preview), navigation modes and
// gesture tuning, behaviour, and data management.
import type { AppearanceSettings, NavigationSettings, Settings } from '@shared/types';
import { defaultSettings } from '@shared/defaults';
import { api } from '../api';
import { ops, useEditor } from '../store';
import { PreviewPane } from './PreviewPane';
import { HotkeyBadge, ShortcutField } from './ShortcutField';
import { Button, Callout, cx, Field, Icon, Segmented, Slider, Switch } from './ui';

const THEMES: { id: AppearanceSettings['theme']; name: string; bg: string; dot: string }[] = [
  { id: 'nebula', name: 'Nebula', bg: 'linear-gradient(135deg,#1b1640,#0f0c27)', dot: '#9b8cff' },
  { id: 'daylight', name: 'Daylight', bg: 'linear-gradient(135deg,#ffffff,#e8ebf7)', dot: '#4361ee' },
  { id: 'graphite', name: 'Graphite', bg: 'linear-gradient(135deg,#2a2a2e,#151517)', dot: '#f5a524' },
];

const ACCENTS = ['#9b8cff', '#4361ee', '#22c3e6', '#2ecc8f', '#f5a524', '#ff7a59', '#ff5d8f', '#e0e0ea'];

function useSection<K extends 'appearance' | 'navigation' | 'general'>(key: K) {
  const value = useEditor((s) => s.config.settings[key]) as Settings[K];
  const set = (patch: Partial<Settings[K]>, coalesce?: string) =>
    ops.updateSettings((s) => ({ ...s, [key]: { ...s[key], ...patch } }), coalesce ? `settings.${key}.${coalesce}` : undefined);
  return [value, set] as const;
}

function Appearance() {
  const [a, set] = useSection('appearance');
  const custom = a.accent && !ACCENTS.includes(a.accent);
  return (
    <div className="card">
      <h2>
        <Icon name="Palette" /> Appearance
      </h2>
      <p>How rings look on screen. Changes show up in the preview right away.</p>
      <div className="settings-grid">
        <Field label="Theme" className="full">
          <div className="theme-cards">
            {THEMES.map((t) => (
              <button key={t.id} type="button" className={cx('theme-card', a.theme === t.id && 'is-active')} onClick={() => set({ theme: t.id })}>
                <span className="theme-swatch" style={{ background: t.bg }}>
                  <span style={{ background: t.dot }} />
                </span>
                {t.name}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Accent colour" className="full">
          <div className="swatches">
            <button type="button" className={cx('swatch', !a.accent && 'is-active')} title="Theme default" onClick={() => set({ accent: '' })} style={{ background: 'conic-gradient(#9b8cff 0 33%, #4361ee 0 66%, #f5a524 0)' }} />
            {ACCENTS.map((c) => (
              <button key={c} type="button" className={cx('swatch', a.accent === c && 'is-active')} style={{ background: c }} title={c} onClick={() => set({ accent: c })} />
            ))}
            <label className={cx('swatch', 'custom', custom && 'is-active')} title="Custom colour">
              <input type="color" value={a.accent || '#9b8cff'} onChange={(e) => set({ accent: e.target.value }, 'accent')} />
            </label>
          </div>
        </Field>
        <Slider label="Size" value={a.scale} min={0.6} max={1.6} step={0.05} onChange={(scale) => set({ scale }, 'scale')} format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Item size" value={a.itemSize} min={36} max={84} unit=" px" onChange={(itemSize) => set({ itemSize }, 'itemSize')} />
        <Slider label="Hub radius (inner)" value={a.innerRadius} min={32} max={90} unit=" px" onChange={(innerRadius) => set({ innerRadius }, 'innerRadius')} />
        <Slider label="Ring radius (outer)" value={a.outerRadius} min={120} max={320} unit=" px" onChange={(outerRadius) => set({ outerRadius }, 'outerRadius')} />
        <Slider label="Animation" value={a.animationMs} min={0} max={400} step={10} unit=" ms" onChange={(animationMs) => set({ animationMs }, 'animationMs')} hint="0 turns animations off." />
        <Field label="Item labels">
          <Segmented
            value={a.showLabels}
            onChange={(showLabels) => set({ showLabels })}
            options={[
              { value: 'always', label: 'Always' },
              { value: 'hover', label: 'On hover' },
            ]}
          />
        </Field>
        <Switch checked={a.showWedges} onChange={(showWedges) => set({ showWedges })} label="Show wedge outlines" />
        <Switch checked={a.showTrail} onChange={(showTrail) => set({ showTrail })} label="Draw gesture trail" />
      </div>
    </div>
  );
}

const MODES: { key: keyof Pick<NavigationSettings, 'marking' | 'turbo' | 'hover'>; icon: string; title: string; text: string }[] = [
  { key: 'marking', icon: 'Spline', title: 'Marking gestures', text: 'Hold the mouse button and stroke toward items. Corners and short pauses open submenus; releasing selects.' },
  { key: 'turbo', icon: 'Zap', title: 'Turbo', text: 'Keep the shortcut’s modifier (e.g. Ctrl) held, move toward an item and let go to select it.' },
  { key: 'hover', icon: 'Hand', title: 'Hover', text: 'Resting on an item selects it after a delay. Risky actions always need a click.' },
];

function Navigation() {
  const [n, set] = useSection('navigation');
  const defaults = defaultSettings().navigation;
  return (
    <div className="card">
      <h2>
        <Icon name="Navigation" /> Navigation
      </h2>
      <p>Point and click always works. These modes add faster ways to choose; you can use them all at once.</p>
      <div className="mode-cards" style={{ marginBottom: 16 }}>
        <div className="mode-card is-on">
          <div className="mode-card-head">
            <strong>
              <Icon name="MousePointerClick" /> Point & click
            </strong>
            <span className="badge ok">Always on</span>
          </div>
          <p>Move toward an item — its whole wedge is clickable — and click. Right-click goes back, Esc closes. Arrow keys, Tab, Enter and Backspace work too.</p>
        </div>
        {MODES.map((m) => (
          <div key={m.key} className={cx('mode-card', n[m.key] && 'is-on')}>
            <div className="mode-card-head">
              <strong>
                <Icon name={m.icon} /> {m.title}
              </strong>
              <Switch checked={n[m.key]} onChange={(v) => set({ [m.key]: v } as Partial<NavigationSettings>)} />
            </div>
            <p>{m.text}</p>
          </div>
        ))}
      </div>
      <div className="settings-grid">
        {n.hover && (
          <>
            <Slider label="Hover delay" value={n.hoverDelayMs} min={150} max={1500} step={50} unit=" ms" onChange={(hoverDelayMs) => set({ hoverDelayMs }, 'hoverDelayMs')} />
            <Switch checked={n.hoverLeafRequiresClick} onChange={(hoverLeafRequiresClick) => set({ hoverLeafRequiresClick })} label="Hover only opens submenus" description="Actions still need a click." />
          </>
        )}
        <Slider label="Dead zone" value={n.deadZone} min={0} max={100} unit=" px" onChange={(deadZone) => set({ deadZone }, 'deadZone')} hint="Nothing is selected while the pointer is this close to the centre." />
        <Slider label="Pointer sensitivity" value={n.sensitivity} min={0.5} max={2} step={0.05} onChange={(sensitivity) => set({ sensitivity }, 'sensitivity')} format={(v) => `${v.toFixed(2)}×`} hint="Higher means shorter strokes are enough." />
        <Slider label="Drag threshold" value={n.dragThreshold} min={4} max={40} unit=" px" onChange={(dragThreshold) => set({ dragThreshold }, 'dragThreshold')} hint="Movement that turns a click into a gesture." />
        <Slider label="Gesture pause" value={n.pauseMs} min={50} max={600} step={10} unit=" ms" onChange={(pauseMs) => set({ pauseMs }, 'pauseMs')} hint="Holding still this long during a stroke opens a submenu." />
        <Slider label="Minimum stroke length" value={n.minStrokeLength} min={40} max={300} unit=" px" onChange={(minStrokeLength) => set({ minStrokeLength }, 'minStrokeLength')} />
        <Slider label="Corner angle" value={n.minStrokeAngle} min={10} max={60} unit="°" onChange={(minStrokeAngle) => set({ minStrokeAngle }, 'minStrokeAngle')} hint="Direction change that counts as a corner." />
        <Slider label="Jitter filter" value={n.jitter} min={2} max={30} unit=" px" onChange={(jitter) => set({ jitter }, 'jitter')} />
        <Slider label="Submenu distance" value={n.minParentDistance} min={80} max={300} unit=" px" onChange={(minParentDistance) => set({ minParentDistance }, 'minParentDistance')} hint="How far submenus open from their parent." />
        <Slider label="Fixed stroke length" value={n.fixedStrokeLength} min={0} max={400} step={10} onChange={(fixedStrokeLength) => set({ fixedStrokeLength }, 'fixedStrokeLength')} format={(v) => (v ? `${v} px` : 'off')} hint="Select a submenu as soon as a stroke is this long." />
        <Switch checked={n.rightClickGoesBack} onChange={(rightClickGoesBack) => set({ rightClickGoesBack })} label="Right-click goes back" description="At the top level it closes the menu." />
        <Switch checked={n.warpPointer} onChange={(warpPointer) => set({ warpPointer })} label="Move the pointer with the menu" description="When a ring is shifted away from a screen edge." />
        <Switch checked={n.closeOnBlur} onChange={(closeOnBlur) => set({ closeOnBlur })} label="Close when another window takes focus" />
        <div className="full row">
          <Button icon="RotateCcw" variant="ghost" onClick={() => ops.updateSettings((s) => ({ ...s, navigation: { ...defaults, marking: s.navigation.marking, turbo: s.navigation.turbo, hover: s.navigation.hover } }))}>
            Reset gesture tuning
          </Button>
        </div>
      </div>
    </div>
  );
}

function Behaviour() {
  const [g, set] = useSection('general');
  const status = useEditor((s) => s.hotkeys.find((h) => h.id === 'settings'));
  const info = useEditor((s) => s.info);
  return (
    <div className="card">
      <h2>
        <Icon name="SlidersHorizontal" /> Behaviour
      </h2>
      <p>Startup and timing of actions that type into other apps.</p>
      <div className="settings-grid">
        <Switch checked={g.launchAtLogin} onChange={(launchAtLogin) => set({ launchAtLogin })} label="Start OrbitMenu with Windows" description="Starts quietly in the tray when you sign in (installed app). Also in the tray menu." />
        <Field label="Open settings shortcut" aside={g.settingsShortcut ? <HotkeyBadge status={status} /> : undefined}>
          <ShortcutField mode="activation" value={g.settingsShortcut} onChange={(settingsShortcut) => set({ settingsShortcut })} placeholder="(none)" />
        </Field>
        <Slider label="Focus delay" value={g.focusDelayMs} min={0} max={400} step={10} unit=" ms" onChange={(focusDelayMs) => set({ focusDelayMs }, 'focusDelayMs')} hint="Wait after returning focus to the previous app before sending keys." />
        <Slider label="Clipboard restore delay" value={g.clipboardRestoreDelayMs} min={100} max={2000} step={50} unit=" ms" onChange={(clipboardRestoreDelayMs) => set({ clipboardRestoreDelayMs }, 'clipboardRestoreDelayMs')} hint="Increase if slow apps paste the old clipboard." />
        {info && !info.capabilities.sendKeys && (
          <div className="full">
            <Callout kind="warn">Keyboard, text and window actions are not available on this system; launching and opening still work.</Callout>
          </div>
        )}
      </div>
    </div>
  );
}

function DataCard() {
  const toast = useEditor((s) => s.toast);
  const info = useEditor((s) => s.info);
  return (
    <div className="card">
      <h2>
        <Icon name="Database" /> Your configuration
      </h2>
      <p>
        Stored as JSON in <code className="chip">{info?.configDir ?? '…'}</code>. Edits made by hand are picked up automatically.
      </p>
      <div className="row">
        <Button
          icon="Download"
          onClick={async () => {
            const r = await api().exportConfig();
            if (r.ok) toast(`Exported to ${r.path}`, 'ok');
            else if (r.error) toast(r.error, 'error');
          }}
        >
          Export…
        </Button>
        <Button
          icon="Upload"
          onClick={async () => {
            const r = await api().importConfig();
            if (r.ok) toast('Configuration imported.', 'ok');
            else if (r.error) toast(`Import failed: ${r.error}`, 'error');
          }}
        >
          Import…
        </Button>
        <Button icon="FolderOpen" variant="ghost" onClick={() => void api().openConfigFolder()}>
          Open folder
        </Button>
        <Button icon="ScrollText" variant="ghost" onClick={() => void api().openLog()}>
          Open log
        </Button>
        <Button
          icon="RotateCcw"
          variant="danger"
          style={{ marginLeft: 'auto' }}
          onClick={async () => {
            if (!window.confirm('Replace all menus and settings with the defaults? Export first if you want a backup.')) return;
            const snap = await api().resetConfig();
            useEditor.getState().applyExternal(snap);
            useEditor.getState().init(snap);
            toast('Defaults restored.', 'ok');
          }}
        >
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}

export function GeneralSettingsPage() {
  const appearance = useEditor((s) => s.config.settings.appearance);
  const menu = useEditor((s) => s.config.menus[0]);
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Settings</h1>
            <p>Look and feel of every menu, how you navigate them, and app behaviour.</p>
          </div>
        </div>
        <div className="settings-layout">
          <div>
            <Appearance />
            <Navigation />
            <Behaviour />
            <DataCard />
          </div>
          <div className="sticky-preview">
            <div className="mini-preview">{menu && <PreviewPane menu={menu} appearance={appearance} path={[]} selectedId={null} interactive={false} />}</div>
            <p className="field-hint" style={{ textAlign: 'center' }}>
              Live preview of “{menu?.name ?? '—'}”
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
