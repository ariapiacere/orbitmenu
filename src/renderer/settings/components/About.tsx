import logo from '../../../../assets/icons/orbitmenu.png';
import { api } from '../api';
import { useEditor } from '../store';
import { Badge, Callout, Icon, Keys } from './ui';
import { UpdatesCard } from './UpdatesCard';

const CAPS: { key: keyof NonNullable<ReturnType<typeof useEditor.getState>['info']>['capabilities']; label: string }[] = [
  { key: 'sendKeys', label: 'Send keyboard shortcuts' },
  { key: 'typeText', label: 'Type and paste text' },
  { key: 'focusWindows', label: 'Find and focus windows' },
  { key: 'restoreFocus', label: 'Return focus to the previous app' },
  { key: 'modifierPolling', label: 'Turbo mode modifier tracking' },
  { key: 'warpPointer', label: 'Move the pointer with the menu' },
];

export function AboutPage() {
  const info = useEditor((s) => s.info);
  const mainMenu = useEditor((s) => s.config.menus.find((m) => m.enabled && m.shortcut));
  return (
    <div className="page">
      <div className="page-inner" style={{ maxWidth: 820 }}>
        <div className="about-hero">
          <img src={logo} alt="" />
          <div>
            <h1>OrbitMenu</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Version {info?.version ?? '…'} · Electron {info?.electron ?? '…'} · {info?.platform}
            </p>
          </div>
        </div>

        <UpdatesCard />

        <div className="card">
          <h2>
            <Icon name="Rocket" /> Quick start
          </h2>
          <ol style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.9, color: 'var(--text-2)' }}>
            <li>
              Press {mainMenu ? <Keys combo={mainMenu.shortcut} /> : 'your menu shortcut'} anywhere. The ring appears at the pointer.
            </li>
            <li>Move toward an item and click — or hold the mouse button and flick toward it.</li>
            <li>Keep the shortcut’s modifier held, move, and release for turbo selection.</li>
            <li>Esc or right-click closes. Each item can also be chosen with its hint key.</li>
          </ol>
        </div>

        <div className="card">
          <h2>
            <Icon name="Cpu" /> System integration
          </h2>
          <p>What OrbitMenu can do on this computer.</p>
          <div className="cap-list">
            {CAPS.map((c) => (
              <span key={c.key} style={{ display: 'contents' }}>
                <span>{c.label}</span>
                {info?.capabilities[c.key] ? (
                  <Badge kind="ok" icon="Check">
                    Available
                  </Badge>
                ) : (
                  <Badge kind="warn" icon="Minus">
                    Not available
                  </Badge>
                )}
              </span>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <Callout>
              Windows does not let normal programs send input to apps running as administrator. If shortcuts or snippets do nothing in such an app, run OrbitMenu as administrator too.
            </Callout>
          </div>
        </div>

        <div className="card">
          <h2>
            <Icon name="Heart" /> Credits
          </h2>
          <p style={{ marginBottom: 6 }}>
            OrbitMenu is an independent project inspired by the interaction design of{' '}
            <button className="link" type="button" onClick={() => void api().openExternal('https://kando.menu/')}>
              Kando
            </button>{' '}
            by Simon Schneegans. It shares no code or artwork with Kando.
          </p>
          <p className="muted" style={{ margin: 0 }}>
            Icons: Lucide (ISC). Native integration: koffi (MIT). Built with Electron, React and Zustand.
          </p>
        </div>
      </div>
    </div>
  );
}
