import { Modal } from './shared/Modal';
import { Button } from './shared/Button';
import { useKeyGate } from '../state/keyGate';
import { Sparkles, Settings as SettingsIcon } from 'lucide-react';

const KEY_LABELS: Record<string, { label: string; getUrl: string }> = {
  FAL_API_KEY: { label: 'fal.ai', getUrl: 'https://fal.ai/dashboard/keys' },
  OPENAI_API_KEY: { label: 'OpenAI', getUrl: 'https://platform.openai.com/api-keys' },
};

export function KeyMissingDialog() {
  const missing = useKeyGate((s) => s.missing);
  const close = useKeyGate((s) => s.closeMissing);
  const openSettings = useKeyGate((s) => s.openSettings);

  if (!missing) return null;
  const info = KEY_LABELS[missing.keyName];

  return (
    <Modal open={true} onClose={close} width={420}>
      <div style={{
        padding: 28,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
        textAlign: 'center',
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: 14,
          background: 'linear-gradient(135deg, #7C3AED 0%, #A78BFA 100%)',
          display: 'grid', placeItems: 'center',
          boxShadow: '0 10px 30px -10px rgba(124, 58, 237, 0.5)',
        }}>
          <Sparkles size={26} color="#fff" />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
            {info.label} API key required
          </h2>
          <p style={{ fontSize: 13.5, color: 'var(--fg-2)', margin: 0, lineHeight: 1.5 }}>
            Add your <strong style={{ color: 'var(--fg-0)' }}>{missing.keyName}</strong> to use {missing.reason}.
            Keys are stored locally in <code style={{ fontSize: 12 }}>~/.aso-studio/keys.json</code> and
            never leave your machine.
          </p>
        </div>

        <a
          href={info.getUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: 12.5, color: 'var(--accent)', textDecoration: 'none',
            padding: '4px 10px', borderRadius: 'var(--r-pill)',
            background: 'var(--bg-2)',
          }}
        >
          Get your {info.label} key ↗
        </a>

        <div style={{ display: 'flex', gap: 8, marginTop: 6, width: '100%' }}>
          <Button variant="ghost" onClick={close} style={{ flex: 1 }}>Cancel</Button>
          <Button
            variant="primary"
            onClick={openSettings}
            leftIcon={<SettingsIcon size={14} />}
            style={{ flex: 1 }}
          >
            Open Settings
          </Button>
        </div>
      </div>
    </Modal>
  );
}
