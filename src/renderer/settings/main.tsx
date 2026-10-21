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
  createRoot(document.getElementById('app')!).render(<App />);
}

void boot();
