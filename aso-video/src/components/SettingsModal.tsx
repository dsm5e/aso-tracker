import { useEffect, useState } from 'react';

/**
 * Global Settings modal — accessible from the gear icon in the main TopBar
 * regardless of which page (Overview / Keywords / Analytics / Studio) the
 * user is on. Backed by the same `~/.aso-studio/keys.json` file that the
 * Studio sub-tools read; the API call is proxied through Vite to the Studio
 * backend at :5181 so we don't need a key server in the keywords app.
 */

// All requests go through the Vite dev proxy — `/studio-api/*` rewrites to
// `aso-screenshots :5181/api/*`. In production the same prefix is used by
// the unified deployment so both relative paths resolve correctly.
const API_BASE = '/studio-api';

type KeyName = 'FAL_API_KEY' | 'OPENAI_API_KEY';

interface KeyStatus {
  set: boolean;
  masked: string | null;
  source: 'env' | 'keys.json' | null;
}

type StatusMap = Record<KeyName, KeyStatus>;

const KEY_INFO: Record<KeyName, { label: string; description: string; getUrl: string }> = {
  FAL_API_KEY: {
    label: 'fal.ai',
    description: 'AI image generation (gpt-image-2 via fal.ai). Used by Screenshots hero, PPO, and Polish.',
    getUrl: 'https://fal.ai/dashboard/keys',
  },
  OPENAI_API_KEY: {
    label: 'OpenAI',
    description: 'Batch translate headlines into other locales (gpt-4o-mini).',
    getUrl: 'https://platform.openai.com/api-keys',
  },
};

export default function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<StatusMap | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<KeyName, string>>>({});
  const [busy, setBusy] = useState<KeyName | null>(null);
  const [revealed, setRevealed] = useState<Set<KeyName>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    fetch(`${API_BASE}/settings/keys`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} — is the Studio backend running on :5181?`);
        return r.json();
      })
      .then(setStatus)
      .catch((e) => setError((e as Error).message));
    setDrafts({});
    setRevealed(new Set());
  }, [open]);

  async function save(name: KeyName, value: string | null) {
    setBusy(name);
    try {
      const r = await fetch(`${API_BASE}/settings/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, value }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const next = (await r.json()) as StatusMap;
      setStatus(next);
      setDrafts((d) => ({ ...d, [name]: '' }));
    } catch (e) {
      alert(`Failed to save: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  function toggleReveal(name: KeyName) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'color-mix(in srgb, var(--ds-strong) 30%, transparent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 92vw)',
          maxHeight: '88vh',
          overflowY: 'auto',
          background: 'var(--ds-panel)',
          color: 'var(--ds-text)',
          borderRadius: 'var(--ds-radius-card)',
          boxShadow: 'var(--ds-shadow-pop)',
        }}
      >
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <h2 className="ds-h2" style={{ margin: 0 }}>API Keys</h2>
            <span className="ds-note">
              stored at <code style={{ fontFamily: 'var(--ds-font-mono)', fontSize: 12 }}>~/.aso-studio/keys.json</code> (mode 0600)
            </span>
          </div>
          <div className="ds-note">
            Keys are local-only — never sent anywhere except the API endpoints they belong to. Inputs are masked while you type;
            click 👁 to reveal a draft.
          </div>

          {error && (
            <div style={{
              padding: 12, borderRadius: 'var(--ds-radius-card)',
              background: 'var(--ds-bad-soft)', color: 'var(--ds-bad)',
              fontSize: 13, lineHeight: '19px',
            }}>
              {error}
            </div>
          )}

          {(Object.keys(KEY_INFO) as KeyName[]).map((name) => {
            const info = KEY_INFO[name];
            const cur = status?.[name];
            const draft = drafts[name] ?? '';
            const isRevealed = revealed.has(name);
            return (
              <div key={name} className="ds-card" style={{
                background: 'var(--ds-panel-2)',
                boxShadow: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div className="ds-card-title">{info.label}</div>
                    <div className="ds-note">{info.description}</div>
                  </div>
                  <a
                    href={info.getUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 13, fontWeight: 600, color: 'var(--ds-accent)', textDecoration: 'none', whiteSpace: 'nowrap' }}
                  >
                    Get key ↗
                  </a>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  {cur?.set ? (
                    <>
                      <span className="ds-badge ds-badge-good">configured</span>
                      <code style={{ fontFamily: 'var(--ds-font-mono)', fontSize: 12 }}>{cur.masked}</code>
                      <span className="ds-note">({cur.source})</span>
                    </>
                  ) : (
                    <span className="ds-badge ds-badge-bad">not set</span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="ds-input"
                    type={isRevealed ? 'text' : 'password'}
                    placeholder={cur?.set ? 'Replace key…' : 'Paste API key…'}
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [name]: e.target.value }))}
                    style={{ flex: 1, fontFamily: 'var(--ds-font-mono)', fontSize: 13 }}
                  />
                  <button
                    type="button"
                    onClick={() => toggleReveal(name)}
                    title={isRevealed ? 'Hide draft' : 'Reveal draft'}
                    className="ds-btn"
                    style={{ width: 40, padding: 0 }}
                  >
                    {isRevealed ? '🙈' : '👁'}
                  </button>
                  <button
                    type="button"
                    disabled={!draft.trim() || busy === name}
                    onClick={() => save(name, draft.trim())}
                    className="ds-btn ds-btn-primary"
                  >
                    {busy === name ? '…' : 'Save'}
                  </button>
                  {cur?.set && cur.source === 'keys.json' && (
                    <button
                      type="button"
                      disabled={busy === name}
                      onClick={() => save(name, null)}
                      className="ds-btn ds-btn-danger"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} className="ds-btn">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
