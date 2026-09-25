import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../shared/ds.css';
import '../../shared/ds-components.css';
import './ds-bridge.css';
import { App } from './App';

// Theme follows the studio-wide choice (same key as the keywords app, shared
// origin behind the :5173 proxy). Light is the default; ?theme=dark|light wins.
function readTheme(): 'light' | 'dark' {
  try {
    const requested = new URLSearchParams(window.location.search).get('theme');
    if (requested === 'dark' || requested === 'light') return requested;
    return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
document.documentElement.dataset.theme = readTheme();
window.addEventListener('storage', (e) => {
  if (e.key === 'theme') document.documentElement.dataset.theme = readTheme();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
