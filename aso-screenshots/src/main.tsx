import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './lib/clog'; // installs window error/rejection forwarders → /api/client-log
import './lib/claudeBridge'; // exposes window.asoStudio for Claude Code agents
import { loadPresetFonts } from './lib/fontLoader';
import { loadScreenshotBlob } from './lib/screenshotStore';
import { useStudio } from './state/studio';
import { startStudioStateSync } from './lib/stateSync';
import './styles/tokens.css';
import './styles/app.css';

loadPresetFonts();

// Re-hydrate uploaded screenshot blob URLs from IndexedDB. Zustand persists the
// metadata (filename, positions), but `URL.createObjectURL` outputs only live for
// a single page session — without this step every uploaded screenshot would
// disappear on reload.
async function rehydrateScreenshotBlobs() {
  const { screenshots, updateScreenshot } = useStudio.getState();
  for (const s of screenshots) {
    // Skip slots with a valid non-blob sourceUrl (https AI renders, data: URLs).
    if (s.sourceUrl && !s.sourceUrl.startsWith('blob:')) continue;
    // null OR stale blob: — try IDB for both.
    try {
      const rec = await loadScreenshotBlob(s.id);
      if (rec) {
        updateScreenshot(s.id, { sourceUrl: URL.createObjectURL(rec.blob), filename: rec.filename });
      } else if (s.sourceUrl?.startsWith('blob:')) {
        updateScreenshot(s.id, { sourceUrl: null });
      }
    } catch {
      if (s.sourceUrl?.startsWith('blob:')) updateScreenshot(s.id, { sourceUrl: null });
    }
  }
}
void rehydrateScreenshotBlobs();

// Legacy migration — Pastel Dots used to ship #E04A6F as a per-sample pill bg.
// We've since removed pillBg from samples so the accent picker can drive it.
// Persisted state from before still holds the old hex; clear it so the colour
// fallback to appColor kicks in for everyone.
{
  const st = useStudio.getState();
  for (const s of st.screenshots) {
    if (s.pillBg === '#E04A6F') st.updateScreenshot(s.id, { pillBg: undefined });
  }
}

// Open the file ↔ Zustand bridge. After the first SSE message the server's
// ~/.aso-studio/state.json is canonical; local edits are debounced upstream.
startStudioStateSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
