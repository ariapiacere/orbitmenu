import { createRoot } from 'react-dom/client';
import '../radial/radial.css';
import './settings.css';
import { App } from './App';
import { saveNow, useEditor } from './store';

async function boot(): Promise<void> {
  if (import.meta.env.DEV && !window.orbit) (await import('../dev/mocks')).installSettingsMock();
  const snapshot = await window.orbit.getConfig();
  useEditor.getState().init(snapshot);
  window.orbit.onConfigChanged((s) => useEditor.getState().applyExternal(s));
  useEditor.setState({ updateInfo: await window.orbit.getUpdateState() });
  window.orbit.onUpdateState((updateInfo) => useEditor.setState({ updateInfo }));
  // Flush a pending save if the window is closed right after an edit.
  window.addEventListener('beforeunload', () => {
    if (useEditor.getState().saveState === 'pending') void saveNow();
  });
  // Files dropped outside a drop target would otherwise make the window navigate
  // to them. Capture phase, so real drop targets can still accept the drop.
  document.addEventListener(
    'dragover',
    (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'none';
    },
    true,
  );
  document.addEventListener('drop', (e) => e.preventDefault(), true);
  createRoot(document.getElementById('app')!).render(<App />);
}

void boot();
