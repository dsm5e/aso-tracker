import { useEffect, useState } from 'react';
import { Icon, Badge } from '../design/primitives.jsx';
import { api } from '../api';

interface Props {
  onClose: () => void;
  onAdded: () => void;
  /** Prefill iTunes ID and auto-run Test connection — e.g. from CompetitorSheet "Track this app" */
  initialITunesId?: string;
}

interface LookupResult {
  trackId?: number;
  trackName?: string;
  bundleId?: string;
  artistName?: string;
  primaryGenreName?: string;
  artworkUrl100?: string;
  averageUserRating?: number;
  userRatingCount?: number;
  trackViewUrl?: string;
}

const EMOJIS = ['🌙','🐾','🍜','🌊','🕯️','📚','🎨','🧘','🏃','🍔','💎','⚡','🌸','🔥','🎯','🧩','🎵','🌈','📸','☕'];

export default function AppAdder({ onClose, onAdded, initialITunesId }: Props) {
  const [iTunesId, setITunesId] = useState(initialITunesId ?? '');
  const [bundle, setBundle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [emoji, setEmoji] = useState('🌙');
  const [tagline, setTagline] = useState('');
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const testConnection = async () => {
    const id = iTunesId.trim();
    if (!id) return;
    setTesting(true);
    setTestError(null);
    setLookup(null);
    try {
      const result = await api.itunesLookup(id) as LookupResult | null;
      if (!result || !result.bundleId) {
        setTestError(`No app found with iTunes ID ${id}. Check the number on the App Store URL.`);
        return;
      }
      setLookup(result);
      if (!bundle) setBundle(result.bundleId);
      if (!displayName) setDisplayName(result.trackName || '');
      if (!tagline && result.primaryGenreName) setTagline(result.primaryGenreName);
    } catch (e) {
      setTestError((e as Error).message || 'Lookup failed');
    } finally {
      setTesting(false);
    }
  };

  // Auto-run Test connection when prefilled from CompetitorSheet
  useEffect(() => {
    if (initialITunesId) testConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSave = !!lookup && bundle.trim() && displayName.trim() && iTunesId.trim();

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const id = slugify(displayName.trim()) || iTunesId.trim();
      await api.addApp({
        id,
        name: displayName.trim(),
        emoji,
        bundle: bundle.trim(),
        iTunesId: iTunesId.trim(),
        tagline: tagline.trim() || undefined,
        iconUrl: lookup?.artworkUrl100,
      } as any);
      onAdded();
    } catch (e) {
      setSaveError((e as Error).message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(10,10,10,0.34)', backdropFilter: 'blur(3px)', zIndex: 80 }} />
      <div
        style={{
          position: 'fixed',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 560,
          maxHeight: '88vh',
          overflow: 'auto',
          background: 'var(--bg-raised)',
          borderRadius: 18,
          boxShadow: 'inset 0 0 0 1px var(--border), 0 28px 80px -20px rgba(0,0,0,0.45)',
          zIndex: 90,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header style={{ padding: '20px 24px 12px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em' }}>Add an app</h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Verify the iTunes ID, then confirm bundle + display name.</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="x" size={13} /></button>
        </header>

        <div style={{ padding: '12px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* iTunes ID + test */}
          <div>
            <label className="label" style={{ display: 'block', marginBottom: 6 }}>iTunes App ID</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--bg-sunken)', borderRadius: 10, padding: '0 12px', height: 36, boxShadow: 'inset 0 0 0 1px var(--border-subtle)' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-muted)' }}>id=</span>
                <input
                  value={iTunesId}
                  onChange={(e) => { setITunesId(e.target.value.replace(/[^0-9]/g, '')); setLookup(null); setTestError(null); }}
                  onKeyDown={(e) => e.key === 'Enter' && testConnection()}
                  placeholder="e.g. 324684580"
                  inputMode="numeric"
                  style={{ flex: 1, fontSize: 13, fontFamily: 'var(--mono)', background: 'transparent', border: 0, color: 'var(--text)', outline: 'none' }}
                />
              </div>
              <button className="btn" onClick={testConnection} disabled={!iTunesId.trim() || testing}>
                {testing ? (
                  <><Icon name="refresh" size={12} /> Testing…</>
                ) : (
                  <><Icon name="search" size={12} /> Test connection</>
                )}
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>
              Find the ID in the App Store URL: <code>https://apps.apple.com/app/id<b>324684580</b></code>
            </div>
          </div>

          {/* Result card */}
          {testError && (
            <div style={{ background: '#FFE8E2', color: '#B8270A', padding: '12px 16px', borderRadius: 10, fontSize: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <Icon name="alert" size={14} style={{ marginTop: 2 }} />
              <div>{testError}</div>
            </div>
          )}

          {lookup && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 14, background: 'var(--pos-tint)', borderRadius: 12, boxShadow: 'inset 0 0 0 1px rgba(16,185,129,0.25)' }}>
              {lookup.artworkUrl100 && (
                <img src={lookup.artworkUrl100} alt="" width={48} height={48} style={{ borderRadius: 11, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)' }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>{lookup.trackName}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{lookup.artistName}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  {lookup.primaryGenreName && <Badge tone="neutral">{lookup.primaryGenreName}</Badge>}
                  {lookup.averageUserRating != null && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      ⭐ {lookup.averageUserRating.toFixed(2)}
                      {lookup.userRatingCount ? ` (${lookup.userRatingCount.toLocaleString()})` : ''}
                    </span>
                  )}
                  <span style={{ fontSize: 10.5, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>{lookup.bundleId}</span>
                </div>
              </div>
              <div style={{ color: 'var(--pos)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600 }}>
                <Icon name="check-circle" size={14} /> Match confirmed
              </div>
            </div>
          )}

          {/* Bundle + display name */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 6 }}>Bundle match</label>
              <div style={{ display: 'inline-flex', alignItems: 'center', width: '100%', gap: 6, background: 'var(--bg-sunken)', borderRadius: 10, padding: '0 12px', height: 36, boxShadow: 'inset 0 0 0 1px var(--border-subtle)' }}>
                <input
                  value={bundle}
                  onChange={(e) => setBundle(e.target.value)}
                  placeholder="com.example.app"
                  style={{ flex: 1, fontSize: 12.5, fontFamily: 'var(--mono)', background: 'transparent', border: 0, color: 'var(--text)', outline: 'none' }}
                />
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 4 }}>
                Used to detect your app in iTunes results (prefix match).
              </div>
            </div>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 6 }}>Display name</label>
              <div style={{ display: 'inline-flex', alignItems: 'center', width: '100%', gap: 6, background: 'var(--bg-sunken)', borderRadius: 10, padding: '0 12px', height: 36, boxShadow: 'inset 0 0 0 1px var(--border-subtle)' }}>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="MyApp"
                  style={{ flex: 1, fontSize: 13, background: 'transparent', border: 0, color: 'var(--text)', outline: 'none' }}
                />
              </div>
            </div>
          </div>

          <div>
            <label className="label" style={{ display: 'block', marginBottom: 6 }}>Tagline (optional)</label>
            <div style={{ display: 'inline-flex', alignItems: 'center', width: '100%', gap: 6, background: 'var(--bg-sunken)', borderRadius: 10, padding: '0 12px', height: 36, boxShadow: 'inset 0 0 0 1px var(--border-subtle)' }}>
              <input
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="Short subtitle shown on the dashboard"
                style={{ flex: 1, fontSize: 13, background: 'transparent', border: 0, color: 'var(--text)', outline: 'none' }}
              />
            </div>
          </div>

          {/* Emoji picker */}
          <div>
            <label className="label" style={{ display: 'block', marginBottom: 6 }}>Icon emoji</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  style={{
                    width: 36, height: 36, borderRadius: 9,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18,
                    background: emoji === e ? 'var(--accent-tint)' : 'var(--bg-sunken)',
                    boxShadow: emoji === e ? 'inset 0 0 0 1.5px var(--accent)' : 'inset 0 0 0 1px var(--border-subtle)',
                    border: 0, cursor: 'pointer',
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {saveError && (
            <div style={{ background: '#FFE8E2', color: '#B8270A', padding: '10px 14px', borderRadius: 10, fontSize: 12 }}>
              {saveError}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer style={{ padding: 16, borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-sunken)', display: 'flex', gap: 8, justifyContent: 'flex-end', borderBottomLeftRadius: 18, borderBottomRightRadius: 18 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={!canSave || saving}>
            {saving ? 'Adding…' : 'Add app & start tracking'}
          </button>
        </footer>
      </div>
    </>
  );
}

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}
