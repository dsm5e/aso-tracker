import { useEffect, useState } from 'react';
import { Modal } from './shared/Modal';
import { Button } from './shared/Button';
import { Input } from './shared/Input';

const API_BASE = import.meta.env.BASE_URL === '/' ? '/api' : '/studio-api';

// Must match server/lib/keys.ts KEY_NAMES (order, names).
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

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<StatusMap | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<KeyName, string>>>({});
  const [busy, setBusy] = useState<KeyName | null>(null);
  const [revealed, setRevealed] = useState<Set<KeyName>>(new Set());

  useEffect(() => {
    if (!open) return;
    fetch(`${API_BASE}/settings/keys`).then((r) => r.json()).then(setStatus).catch(() => setStatus(null));
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

  return (
    <Modal open={open} onClose={onClose} width={560}>
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>API Keys</h2>
          <span style={{ fontSize: 11.5, color: 'var(--fg-2)' }}>
            stored at <code style={{ fontSize: 11 }}>~/.aso-studio/keys.json</code> (mode 0600)
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.5 }}>
          Keys are local-only — never sent anywhere except the API endpoints they belong to. Inputs are masked while you type;
          click 👁 to reveal a draft.
        </div>

        {(Object.keys(KEY_INFO) as KeyName[]).map((name) => {
          const info = KEY_INFO[name];
          const cur = status?.[name];
          const draft = drafts[name] ?? '';
          const isRevealed = revealed.has(name);
          return (
            <div key={name} style={{
              border: '1px solid var(--line-1)', borderRadius: 10, padding: 14,
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{info.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>{info.description}</div>
                </div>
                <a href={info.getUrl} target="_blank" rel="noreferrer"
                   style={{ fontSize: 11.5, color: 'var(--accent)', textDecoration: 'none' }}>
                  Get key ↗
                </a>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                {cur?.set ? (
                  <>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '2px 8px', borderRadius: 'var(--r-pill)',
                      background: 'var(--bg-2)', color: 'var(--pos)',
                    }}>● configured</span>
                    <code style={{ fontSize: 11.5, color: 'var(--fg-1)' }}>{cur.masked}</code>
                    <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>({cur.source})</span>
                  </>
                ) : (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '2px 8px', borderRadius: 'var(--r-pill)',
                    background: 'var(--bg-2)', color: 'var(--neg)',
                  }}>○ not set</span>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  type={isRevealed ? 'text' : 'password'}
                  placeholder={cur?.set ? 'Replace key…' : 'Paste API key…'}
                  value={draft}
                  onChange={(e) => setDrafts((d) => ({ ...d, [name]: (e.target as HTMLInputElement).value }))}
                  style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleReveal(name)}
                  title={isRevealed ? 'Hide draft' : 'Reveal draft (only what you\'re typing now)'}
                >
                  {isRevealed ? '🙈' : '👁'}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!draft.trim() || busy === name}
                  onClick={() => save(name, draft.trim())}
                >
                  {busy === name ? 'Saving…' : 'Save'}
                </Button>
                {cur?.set && cur.source === 'keys.json' && (
                  <Button variant="ghost" size="sm" disabled={busy === name} onClick={() => save(name, null)}>
                    Clear
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
