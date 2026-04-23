import { useEffect, useMemo, useState } from 'react';
import { Icon, Flag, Badge } from '../design/primitives.jsx';
import { api, type AppStats } from '../api';

interface Props {
  app: AppStats;
  onChanged?: () => void;
  onRunLocaleSnapshot?: (locale: string) => void;
  /** Sync the active locale up to the parent so Rankings tab can auto-filter to it. */
  onLocaleSync?: (locale: string) => void;
  /** Initial locale from parent (if user already selected one elsewhere). */
  initialLocale?: string;
}

// Complete list of Apple App Store storefronts (≈175). Key = lowercase ISO 3166-1 alpha-2.
const LOCALE_NAMES: Record<string, string> = {
  // Americas
  us: 'United States', ca: 'Canada', mx: 'Mexico', br: 'Brazil', ar: 'Argentina',
  cl: 'Chile', co: 'Colombia', pe: 'Peru', ve: 'Venezuela', uy: 'Uruguay',
  py: 'Paraguay', bo: 'Bolivia', ec: 'Ecuador', cr: 'Costa Rica', pa: 'Panama',
  gt: 'Guatemala', hn: 'Honduras', ni: 'Nicaragua', sv: 'El Salvador',
  do: 'Dominican Republic', jm: 'Jamaica', bb: 'Barbados', bs: 'Bahamas',
  tt: 'Trinidad & Tobago', bz: 'Belize', bm: 'Bermuda', ky: 'Cayman Islands',
  ag: 'Antigua & Barbuda', dm: 'Dominica', gd: 'Grenada', kn: 'St. Kitts & Nevis',
  lc: 'St. Lucia', vc: 'St. Vincent & the Grenadines', sr: 'Suriname',
  ai: 'Anguilla', ms: 'Montserrat', tc: 'Turks & Caicos', vg: 'British Virgin Islands',

  // Western Europe
  gb: 'United Kingdom', ie: 'Ireland', de: 'Germany', at: 'Austria', ch: 'Switzerland',
  fr: 'France', be: 'Belgium', lu: 'Luxembourg', nl: 'Netherlands', mc: 'Monaco',
  es: 'Spain', pt: 'Portugal', it: 'Italy', mt: 'Malta', cy: 'Cyprus',

  // Nordics
  se: 'Sweden', no: 'Norway', dk: 'Denmark', fi: 'Finland', is: 'Iceland',

  // Eastern Europe
  pl: 'Poland', cz: 'Czechia', sk: 'Slovakia', hu: 'Hungary', ro: 'Romania',
  hr: 'Croatia', si: 'Slovenia', ua: 'Ukraine', ru: 'Russia', gr: 'Greece',
  bg: 'Bulgaria', ee: 'Estonia', lv: 'Latvia', lt: 'Lithuania',
  md: 'Moldova', by: 'Belarus', mk: 'North Macedonia', al: 'Albania',
  me: 'Montenegro', ba: 'Bosnia & Herzegovina', rs: 'Serbia', xk: 'Kosovo',

  // Middle East
  tr: 'Turkey', il: 'Israel', sa: 'Saudi Arabia', ae: 'UAE', eg: 'Egypt',
  jo: 'Jordan', lb: 'Lebanon', kw: 'Kuwait', qa: 'Qatar', bh: 'Bahrain',
  om: 'Oman', ye: 'Yemen', iq: 'Iraq',

  // Africa
  ma: 'Morocco', dz: 'Algeria', tn: 'Tunisia', ly: 'Libya',
  za: 'South Africa', ng: 'Nigeria', ke: 'Kenya', gh: 'Ghana',
  ci: 'Ivory Coast', sn: 'Senegal', tz: 'Tanzania', ug: 'Uganda',
  zw: 'Zimbabwe', zm: 'Zambia', mu: 'Mauritius', na: 'Namibia',
  bw: 'Botswana', cm: 'Cameroon', ml: 'Mali', bf: 'Burkina Faso',
  ne: 'Niger', cd: 'DR Congo', cg: 'Republic of Congo', ga: 'Gabon',
  mg: 'Madagascar', mw: 'Malawi', mz: 'Mozambique', cv: 'Cape Verde',
  sc: 'Seychelles', sz: 'Eswatini', ao: 'Angola', sl: 'Sierra Leone',
  lr: 'Liberia', rw: 'Rwanda', bj: 'Benin', td: 'Chad', gm: 'Gambia',
  gn: 'Guinea', gw: 'Guinea-Bissau', st: 'São Tomé & Príncipe',

  // Asia Pacific
  au: 'Australia', nz: 'New Zealand', jp: 'Japan', kr: 'South Korea',
  cn: 'China', tw: 'Taiwan', hk: 'Hong Kong', mo: 'Macao', sg: 'Singapore',
  id: 'Indonesia', my: 'Malaysia', th: 'Thailand', vn: 'Vietnam', ph: 'Philippines',
  mm: 'Myanmar', kh: 'Cambodia', la: 'Laos', bn: 'Brunei', mn: 'Mongolia',
  fj: 'Fiji', pg: 'Papua New Guinea', sb: 'Solomon Islands', to: 'Tonga',
  fm: 'Micronesia', pw: 'Palau',

  // South / Central Asia
  in: 'India', pk: 'Pakistan', bd: 'Bangladesh', lk: 'Sri Lanka',
  np: 'Nepal', bt: 'Bhutan', mv: 'Maldives', af: 'Afghanistan',
  kz: 'Kazakhstan', uz: 'Uzbekistan', kg: 'Kyrgyzstan', tj: 'Tajikistan',
  tm: 'Turkmenistan', am: 'Armenia', ge: 'Georgia', az: 'Azerbaijan',

  // Regional script locales (Apple uses these as keys even if the API country stays country-level)
  'es-ca': 'Catalonia (Spain)',
  'in-hi': 'India (Hindi)', 'in-gu': 'India (Gujarati)', 'in-kn': 'India (Kannada)',
  'in-ml': 'India (Malayalam)', 'in-mr': 'India (Marathi)', 'in-or': 'India (Odia)',
  'in-pa': 'India (Punjabi)', 'in-ta': 'India (Tamil)', 'in-te': 'India (Telugu)',
};

export default function KeywordsEditor({ app, onChanged, onRunLocaleSnapshot, onLocaleSync, initialLocale }: Props) {
  const [kwMap, setKwMap] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [activeLocale, setActiveLocaleState] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [addLocaleOpen, setAddLocaleOpen] = useState(false);

  const setActiveLocale = (loc: string | null) => {
    setActiveLocaleState(loc);
    if (loc) onLocaleSync?.(loc);
  };

  useEffect(() => {
    setLoading(true);
    api.keywords(app.id)
      .then((data) => {
        setKwMap(data);
        const preferred = initialLocale && data[initialLocale] ? initialLocale : Object.keys(data).sort()[0] ?? null;
        setActiveLocaleState(preferred);
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.id]);

  const localeList = useMemo(() => {
    const entries = Object.entries(kwMap).map(([code, kws]) => ({ code, count: kws.length }));
    const needle = search.toLowerCase();
    return (needle ? entries.filter((e) => e.code.toLowerCase().includes(needle) || (LOCALE_NAMES[e.code] || '').toLowerCase().includes(needle)) : entries)
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [kwMap, search]);

  const currentKws = activeLocale ? kwMap[activeLocale] ?? [] : [];
  const totalKw = Object.values(kwMap).reduce((a, b) => a + b.length, 0);

  const save = async () => {
    setSaving(true);
    try {
      await api.saveKeywords(app.id, kwMap);
      setDirty(false);
      onChanged?.();
    } finally {
      setSaving(false);
    }
  };

  const addKeyword = () => {
    if (!activeLocale) return;
    const val = input.trim();
    if (!val) return;
    if (currentKws.includes(val)) {
      setInput('');
      return;
    }
    setKwMap({ ...kwMap, [activeLocale]: [...currentKws, val] });
    setInput('');
    setDirty(true);
  };

  const removeKeyword = (kw: string) => {
    if (!activeLocale) return;
    setKwMap({ ...kwMap, [activeLocale]: currentKws.filter((k) => k !== kw) });
    setDirty(true);
  };

  const bulkPaste = () => {
    if (!activeLocale) return;
    const text = prompt('Paste keywords — one per line or comma-separated:');
    if (!text) return;
    const parts = text
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const merged = Array.from(new Set([...currentKws, ...parts]));
    setKwMap({ ...kwMap, [activeLocale]: merged });
    setDirty(true);
  };

  const removeLocale = () => {
    if (!activeLocale) return;
    if (!confirm(`Delete locale "${activeLocale.toUpperCase()}" and all ${currentKws.length} keywords?`)) return;
    const { [activeLocale]: _, ...rest } = kwMap;
    setKwMap(rest);
    setActiveLocale(Object.keys(rest).sort()[0] ?? null);
    setDirty(true);
  };

  const addLocale = (code: string) => {
    const c = code.trim().toLowerCase();
    if (!c) return;
    if (kwMap[c]) { setActiveLocale(c); setAddLocaleOpen(false); return; }
    setKwMap({ ...kwMap, [c]: [] });
    setActiveLocale(c);
    setDirty(true);
    setAddLocaleOpen(false);
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading keywords…</div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, alignItems: 'flex-start' }}>
      {/* Left panel — locales list */}
      <div style={{ background: 'var(--bg-raised)', borderRadius: 16, boxShadow: 'inset 0 0 0 1px var(--border)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--bg-sunken)', borderRadius: 8, padding: '0 10px', height: 32, boxShadow: 'inset 0 0 0 1px var(--border-subtle)' }}>
          <Icon name="search" size={12} stroke={1.8} style={{ color: 'var(--text-muted)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search locales…"
            style={{ flex: 1, fontSize: 13, background: 'transparent', border: 0, color: 'var(--text)', outline: 'none' }}
          />
        </div>

        <div className="label">Locales · {Object.keys(kwMap).length}</div>

        <div style={{ maxHeight: 520, overflow: 'auto', margin: '0 -4px', paddingRight: 4 }}>
          {localeList.map((l) => (
            <button
              key={l.code}
              onClick={() => setActiveLocale(l.code)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                height: 34, padding: '0 8px', borderRadius: 8,
                background: activeLocale === l.code ? 'var(--bg-sunken)' : 'transparent',
                boxShadow: activeLocale === l.code ? 'inset 0 0 0 1px var(--border)' : 'none',
                border: 0, cursor: 'pointer', textAlign: 'left', color: 'var(--text)',
                fontSize: 13.5, fontWeight: activeLocale === l.code ? 600 : 500,
              }}
            >
              <Flag code={l.code.toUpperCase()} size={14} />
              <span style={{ flex: 1 }}>{LOCALE_NAMES[l.code] || l.code.toUpperCase()}</span>
              <span className="num" style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>{l.count}</span>
            </button>
          ))}
        </div>

        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setAddLocaleOpen(true)}
          style={{ color: 'var(--accent)', marginTop: 6 }}
        >
          <Icon name="plus" size={12} /> Add locale
        </button>
      </div>

      {/* Right panel — keyword chips */}
      <div style={{ background: 'var(--bg-raised)', borderRadius: 16, boxShadow: 'inset 0 0 0 1px var(--border)', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!activeLocale ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
            No locale selected.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Flag code={activeLocale.toUpperCase()} size={20} />
              <div>
                <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.015em' }}>{LOCALE_NAMES[activeLocale] || activeLocale.toUpperCase()}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{currentKws.length} keywords · locale code <code>{activeLocale}</code></div>
              </div>
              <div style={{ flex: 1 }} />
              {onRunLocaleSnapshot && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => { if (dirty) { if (!confirm('You have unsaved changes. Save first?')) return; }
                    onRunLocaleSnapshot(activeLocale!);
                  }}
                  title={`Fetch positions for all ${currentKws.length} keywords in ${activeLocale?.toUpperCase()}`}
                >
                  <Icon name="play" size={11} /> Run snapshot for {activeLocale?.toUpperCase()}
                </button>
              )}
              <button className="btn btn-sm" onClick={bulkPaste}>
                <Icon name="upload" size={12} /> Bulk paste
              </button>
              <button className="btn btn-sm" onClick={removeLocale} style={{ color: 'var(--neg)' }}>
                <Icon name="x" size={12} /> Remove locale
              </button>
            </div>

            {/* Add input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: 'var(--bg-sunken)', borderRadius: 12, boxShadow: 'inset 0 0 0 1px var(--border-subtle)' }}>
              <Icon name="plus" size={13} style={{ color: 'var(--accent)' }} />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
                placeholder="Type a keyword and press Enter…"
                style={{ flex: 1, fontSize: 14, fontWeight: 500, background: 'transparent', border: 0, color: 'var(--text)', outline: 'none' }}
              />
              <button className="btn btn-primary btn-sm" onClick={addKeyword} disabled={!input.trim()}>
                Add
              </button>
            </div>

            {/* Chip grid */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 12, background: 'var(--bg-sunken)', borderRadius: 12, minHeight: 80 }}>
              {currentKws.length === 0 && (
                <div style={{ color: 'var(--text-faint)', fontSize: 13.5, padding: 12 }}>No keywords yet — add one above.</div>
              )}
              {currentKws.map((kw) => (
                <div
                  key={kw}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    height: 28, padding: '0 6px 0 10px',
                    borderRadius: 8, background: 'var(--bg-raised)',
                    boxShadow: 'inset 0 0 0 1px var(--border)',
                    fontSize: 13.5, fontWeight: 500,
                  }}
                >
                  <span>{kw}</span>
                  <button
                    onClick={() => removeKeyword(kw)}
                    className="btn btn-ghost"
                    style={{ padding: 0, width: 18, height: 18, borderRadius: 4, color: 'var(--text-faint)' }}
                  >
                    <Icon name="x" size={10} stroke={2.2} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            Total: <b style={{ color: 'var(--text-2)', fontWeight: 500 }}>{totalKw}</b> keywords across {Object.keys(kwMap).length} locales
            {dirty && <Badge tone="accent"><span style={{ marginLeft: 4 }}>unsaved changes</span></Badge>}
          </div>
          <div style={{ flex: 1 }} />
          <button
            className="btn btn-primary btn-sm"
            onClick={save}
            disabled={!dirty || saving}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {addLocaleOpen && (
        <AddLocalePicker
          existing={Object.keys(kwMap)}
          onPick={addLocale}
          onClose={() => setAddLocaleOpen(false)}
        />
      )}
    </div>
  );
}

function AddLocalePicker({ existing, onPick, onClose }: { existing: string[]; onPick: (code: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const entries = Object.entries(LOCALE_NAMES)
    .filter(([code]) => !existing.includes(code))
    .filter(([code, name]) => {
      const s = q.trim().toLowerCase();
      return !s || code.includes(s) || name.toLowerCase().includes(s);
    })
    .sort(([, a], [, b]) => a.localeCompare(b));

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(10,10,10,0.34)', backdropFilter: 'blur(3px)', zIndex: 80 }} />
      <div
        style={{
          position: 'fixed',
          top: '12vh', left: '50%',
          transform: 'translateX(-50%)',
          width: 560,
          maxHeight: '70vh',
          background: 'var(--bg-raised)',
          borderRadius: 16,
          boxShadow: 'inset 0 0 0 1px var(--border), 0 28px 80px -20px rgba(0,0,0,0.45)',
          zIndex: 90,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: 14, borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="globe" size={14} stroke={1.8} style={{ color: 'var(--text-muted)' }} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
            placeholder="Search country or locale code…"
            style={{ flex: 1, fontSize: 14, fontWeight: 500, background: 'transparent', border: 0, color: 'var(--text)', outline: 'none' }}
          />
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="x" size={13} /></button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
          {entries.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              {q ? 'No matches.' : 'All locales already added.'}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
            {entries.map(([code, name]) => (
              <button
                key={code}
                onClick={() => onPick(code)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderRadius: 8,
                  background: 'var(--bg-sunken)',
                  boxShadow: 'inset 0 0 0 1px var(--border-subtle)',
                  border: 0, cursor: 'pointer', textAlign: 'left',
                  color: 'var(--text)',
                  fontSize: 13.5, fontWeight: 500,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-sunken)'; }}
              >
                <Flag code={code.toUpperCase()} size={14} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                <span className="num" style={{ fontSize: 11.5, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>{code}</span>
                <span style={{ color: 'var(--accent)' }}><Icon name="plus" size={12} /></span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
