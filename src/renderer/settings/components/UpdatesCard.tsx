// Update status, actions and the GitHub access token for private releases.
import { useState } from 'react';
import type { UpdateState } from '@shared/ipc';
import { api } from '../api';
import { ops, useEditor } from '../store';
import { Badge, Button, Callout, Icon, Switch } from './ui';

function bytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

function StatusLine({ u }: { u: UpdateState }) {
  switch (u.status) {
    case 'checking':
      return <Badge icon="RefreshCw">Checking…</Badge>;
    case 'up-to-date':
      return (
        <Badge kind="ok" icon="CircleCheck">
          Up to date
        </Badge>
      );
    case 'available':
      return (
        <Badge kind="accent" icon="Download">
          Version {u.latestVersion} is available
        </Badge>
      );
    case 'downloading':
      return <Badge icon="Download">Downloading {u.latestVersion}…</Badge>;
    case 'ready':
      return (
        <Badge kind="ok" icon="CircleCheck">
          {u.latestVersion} is ready — restart to finish
        </Badge>
      );
    case 'error':
      return (
        <Badge kind="danger" icon="CircleAlert">
          Update problem
        </Badge>
      );
    default:
      return <Badge icon="Clock">Not checked yet</Badge>;
  }
}

function TokenField({ u }: { u: UpdateState }) {
  const [value, setValue] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async (token: string | null) => {
    setSaving(true);
    try {
      const r = await api().setUpdateToken(token);
      setResult(r);
      if (r.ok) setValue('');
    } finally {
      setSaving(false);
    }
  };
  // Not needed for the public repository, so it stays folded away unless a
  // token is saved or the last check failed.
  return (
    <details className="token-field" open={u.hasToken || u.status === 'error'}>
      <summary className="field-label">
        <span>GitHub access token (optional)</span>
        {u.hasToken ? (
          <Badge kind="ok" icon="KeyRound">
            Saved
          </Badge>
        ) : (
          <Badge icon="KeyRound">Not needed</Badge>
        )}
      </summary>
      <div className="stack" style={{ gap: 8, marginTop: 8 }}>
      <div className="input-row">
        <input
          className="input mono"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={u.hasToken ? 'Paste a new token to replace the saved one' : 'github_pat_…'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="GitHub access token"
        />
        <Button variant="primary" disabled={!value.trim() || saving} onClick={() => void save(value)}>
          {saving ? 'Checking…' : 'Save'}
        </Button>
        {u.hasToken && (
          <Button variant="ghost" icon="Trash2" title="Remove the saved token" onClick={() => void save(null)} />
        )}
      </div>
      {result && (
        <span className="field-hint" style={{ color: result.ok ? 'var(--ok)' : 'var(--danger)' }}>
          {result.message}
        </span>
      )}
      <span className="field-hint">
        Updates come from the public repository {u.repository}, so no token is needed. Add one only if GitHub limits anonymous requests on
        a shared network, or if you build from a private fork: create a{' '}
        <button className="link" type="button" onClick={() => void api().openExternal('https://github.com/settings/personal-access-tokens/new')}>
          fine-grained token
        </button>{' '}
        with read-only <code>Contents</code> access to that repository. It is stored encrypted for this Windows account and never
        included in exports.
      </span>
      </div>
    </details>
  );
}

export function UpdatesCard() {
  const u = useEditor((s) => s.updateInfo);
  const general = useEditor((s) => s.config.settings.general);
  const [busy, setBusy] = useState(false);
  if (!u) return null;
  const run = async (fn: () => Promise<UpdateState>) => {
    setBusy(true);
    try {
      // Progress also arrives as events; the result makes sure the card is current.
      useEditor.setState({ updateInfo: await fn() });
    } finally {
      setBusy(false);
    }
  };
  const percent = u.totalBytes ? Math.min(100, Math.round((u.receivedBytes / u.totalBytes) * 100)) : 0;
  return (
    <div className="card">
      <h2>
        <Icon name="RefreshCw" /> Updates
      </h2>
      <p>
        You have version <strong>{u.currentVersion}</strong>. New versions come from GitHub Releases of <code className="chip">{u.repository}</code>.
      </p>
      <div className="stack">
        <div className="row">
          <StatusLine u={u} />
          {u.checkedAt && <span className="muted" style={{ fontSize: 12 }}>checked {new Date(u.checkedAt).toLocaleString()}</span>}
        </div>

        {u.status === 'error' && u.error && <Callout kind="danger" icon="CircleAlert">{u.error}</Callout>}

        {u.status === 'downloading' && (
          <div className="stack" style={{ gap: 4 }}>
            <div className="progress">
              <span style={{ width: `${percent}%` }} />
            </div>
            <span className="field-hint">
              {bytes(u.receivedBytes)} of {bytes(u.totalBytes)} ({percent}%)
            </span>
          </div>
        )}

        {(u.status === 'available' || u.status === 'ready') && (u.releaseNotes || u.releaseName) && (
          <div className="release-notes">
            <strong>{u.releaseName}</strong>
            {u.releaseNotes && <pre>{u.releaseNotes}</pre>}
          </div>
        )}

        {u.status === 'available' && !u.canInstall && (
          <Callout>This copy was not installed with the setup program, so it cannot update itself. Download OrbitMenu-Setup.exe from the release page.</Callout>
        )}

        <div className="row">
          {u.status === 'ready' ? (
            <Button variant="primary" icon="RotateCw" onClick={() => void api().installUpdate()}>
              Restart and update
            </Button>
          ) : u.status === 'available' && u.canInstall && u.installable ? (
            <Button variant="primary" icon="Download" disabled={busy} onClick={() => void run(() => api().downloadUpdate())}>
              Download and install {u.latestVersion}
            </Button>
          ) : null}
          <Button icon="RefreshCw" disabled={busy || u.status === 'checking' || u.status === 'downloading'} onClick={() => void run(() => api().checkForUpdates())}>
            Check now
          </Button>
          {u.releaseUrl && (
            <Button variant="ghost" icon="ExternalLink" onClick={() => void api().openExternal(u.releaseUrl)}>
              Release page
            </Button>
          )}
        </div>

        <div className="settings-grid" style={{ marginTop: 4 }}>
          <Switch
            checked={general.autoCheckUpdates}
            onChange={(autoCheckUpdates) => ops.updateSettings((s) => ({ ...s, general: { ...s.general, autoCheckUpdates } }))}
            label="Check automatically"
            description="At startup and every 6 hours."
          />
          <Switch
            checked={general.autoDownloadUpdates}
            onChange={(autoDownloadUpdates) => ops.updateSettings((s) => ({ ...s, general: { ...s.general, autoDownloadUpdates } }))}
            label="Download automatically"
            description="Installs on the next restart; you are told when it is ready."
          />
        </div>

        <TokenField u={u} />
      </div>
    </div>
  );
}
