/**
 * Client-side logger. Prints to console AND posts to /api/client-log so the
 * dev agent can read it from /tmp/aso-studio-dev.log without opening DevTools.
 *
 * Usage:
 *   import { clog } from '../lib/clog';
 *   clog('enhance', 'click', { someContext: '...' });
 *   clog.error('enhance', 'failed', { err: ... });
 */

type Level = 'info' | 'warn' | 'error';

// API base depends on how the app was reached:
//   - direct (port 5180):           /api/...
//   - via unified Keywords origin:  /studio-api/...   (BASE_URL = '/studio/')
const API_BASE = import.meta.env.BASE_URL === '/' ? '/api' : '/studio-api';

function send(level: Level, tag: string, msg: unknown, meta?: Record<string, unknown>) {
  const stringMsg = typeof msg === 'string' ? msg : JSON.stringify(msg);
  // Mirror to browser console for visibility
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    `[${tag}] ${stringMsg}`,
    meta ?? '',
  );
  // Best-effort post; never block UI if it fails
  fetch(`${API_BASE}/client-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level, tag, msg: stringMsg, meta }),
    keepalive: true,
  }).catch(() => {
    /* swallow */
  });
}

export function clog(tag: string, msg: unknown, meta?: Record<string, unknown>) {
  send('info', tag, msg, meta);
}
clog.warn = (tag: string, msg: unknown, meta?: Record<string, unknown>) => send('warn', tag, msg, meta);
clog.error = (tag: string, msg: unknown, meta?: Record<string, unknown>) => send('error', tag, msg, meta);

/** Auto-attach: forward any uncaught error to the server too. */
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    send('error', 'uncaught', e.message || 'window error', {
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    const msg =
      reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : JSON.stringify(reason);
    send('error', 'unhandledrejection', msg);
  });
}
