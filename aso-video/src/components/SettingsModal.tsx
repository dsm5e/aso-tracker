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
        background: 'rgba(0,0,0,0.55)',
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
          background: 'var(--bg-raised, #1a1a1f)',
          color: 'var(--text, #fff)',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          border: '1px solid var(--border, rgba(255,255,255,0.1))',
        }}
      >
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>API Keys</h2>
            <span style={{ fontSize: 11, color: 'var(--text-muted, #888)' }}>
              stored at <code style={{ fontSize: 11 }}>~/.aso-studio/keys.json</code> (mode 0600)
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted, #888)', lineHeight: 1.5 }}>
            Keys are local-only — never sent anywhere except the API endpoints they belong to. Inputs are masked while you type;
            click 👁 to reveal a draft.
          </div>

          {error && (
            <div style={{
              padding: 12, borderRadius: 8,
              background: 'rgba(239,68,68,0.1)', color: '#f87171',
              fontSize: 12, lineHeight: 1.5,
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
              <div key={name} style={{
                border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
                borderRadius: 10,
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{info.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted, #888)' }}>{info.description}</div>
                  </div>
                  <a
                    href={info.getUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 11.5, color: 'var(--accent, #6ee7b7)', textDecoration: 'none', whiteSpace: 'nowrap' }}
                  >
                    Get key ↗
                  </a>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  {cur?.set ? (
                    <>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: 'rgba(110,231,183,0.12)',
                        color: '#6ee7b7',
                        fontSize: 11,
                      }}>● configured</span>
                      <code style={{ fontSize: 11.5 }}>{cur.masked}</code>
                      <span style={{ fontSize: 11, color: 'var(--text-muted, #888)' }}>({cur.source})</span>
                    </>
                  ) : (
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: 'rgba(248,113,113,0.12)',
                      color: '#f87171',
                      fontSize: 11,
                    }}>○ not set</span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type={isRevealed ? 'text' : 'password'}
                    placeholder={cur?.set ? 'Replace key…' : 'Paste API key…'}
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [name]: e.target.value }))}
                    style={{
                      flex: 1,
                      padding: '7px 10px',
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: 12,
                      borderRadius: 6,
                      border: '1px solid var(--border, rgba(255,255,255,0.12))',
                      background: 'var(--bg-sunken, rgba(0,0,0,0.2))',
                      color: 'var(--text, #fff)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => toggleReveal(name)}
                    title={isRevealed ? 'Hide draft' : 'Reveal draft'}
                    className="btn btn-ghost btn-sm"
                  >
                    {isRevealed ? '🙈' : '👁'}
                  </button>
                  <button
                    type="button"
                    disabled={!draft.trim() || busy === name}
                    onClick={() => save(name, draft.trim())}
                    className="btn btn-sm"
                    style={{
                      background: !draft.trim() ? 'var(--bg-sunken)' : 'var(--accent, #6ee7b7)',
                      color: !draft.trim() ? 'var(--text-muted)' : '#000',
                      fontWeight: 600,
                    }}
                  >
                    {busy === name ? '…' : 'Save'}
                  </button>
                  {cur?.set && cur.source === 'keys.json' && (
                    <button
                      type="button"
                      disabled={busy === name}
                      onClick={() => save(name, null)}
                      className="btn btn-ghost btn-sm"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
