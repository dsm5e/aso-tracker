import { useCallback, useEffect, useState } from 'react';
import { DashboardScreen, TopBar } from './design/screen-dashboard.jsx';
import AppDetailScreen from './screens/AppDetail';
import KeywordsEditor from './screens/KeywordsEditor';
import AppAdder from './screens/AppAdder';
import AppSearch from './screens/AppSearch';
import SnapshotPanel from './screens/SnapshotPanel';
import CompetitorSheet from './screens/CompetitorSheet';
import { AppIcon } from './design/primitives.jsx';
import { api, runSnapshot, type AppStats, type LocaleAvg, type SnapshotEvent, type SnapshotSpeed } from './api';

type Screen = 'dashboard' | 'app-detail' | 'keywords';

const NAV_TO_SCREEN: Record<string, Screen> = {
  Overview: 'dashboard',
  Keywords: 'keywords',
};

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem('theme') as 'light' | 'dark') ?? 'dark'
  );
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [appAdderOpen, setAppAdderOpen] = useState(false);

  const [apps, setApps] = useState<AppStats[] | null>(null);
  const [localeStatsByApp, setLocaleStatsByApp] = useState<Record<string, LocaleAvg[]>>({});
  const [competitorSheet, setCompetitorSheet] = useState<{ appId: string; bundleId: string } | null>(null);
  const [adderPrefillITunesId, setAdderPrefillITunesId] = useState<string | undefined>(undefined);
  const [snapshotEvents, setSnapshotEvents] = useState<SnapshotEvent[]>([]);
  const [snapshotRunning, setSnapshotRunning] = useState(false);
  const [snapshotAbort, setSnapshotAbort] = useState<AbortController | null>(null);
  const [snapshotSpeed, setSnapshotSpeed] = useState<SnapshotSpeed>(
    () => (localStorage.getItem('snapshotSpeed') as SnapshotSpeed) ?? 'medium'
  );
  useEffect(() => { localStorage.setItem('snapshotSpeed', snapshotSpeed); }, [snapshotSpeed]);

  const loadApps = useCallback(async () => {
    try {
      const data = await api.apps();
      setApps(data);
      const stats: Record<string, LocaleAvg[]> = {};
      await Promise.all(
        data.map(async (a) => {
          stats[a.id] = await api.appLocales(a.id);
        })
      );
      setLocaleStatsByApp(stats);
    } catch (e) {
      console.warn('API not responding', e);
      setApps([]);
    }
  }, []);

  useEffect(() => { loadApps(); }, [loadApps]);

  useEffect(() => { localStorage.setItem('theme', theme); }, [theme]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
      if (e.key === 'Escape') {
        setCmdOpen(false);
        setAppAdderOpen(false);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));

  // scope of the current snapshot session — kept between pause & resume
  const [snapshotScope, setSnapshotScope] = useState<{ appIds?: string[]; locales?: string[]; label?: string } | null>(null);

  const openSnapshotPanel = useCallback((scope: { appIds?: string[]; locales?: string[]; label?: string }) => {
    setSnapshotScope(scope);
    setSnapshotEvents([]);
    setSnapshotOpen(true);
  }, []);

  const runSnapshotInternal = useCallback(async (scope: { appIds?: string[]; locales?: string[] }, resume: boolean) => {
    const ctrl = new AbortController();
    setSnapshotAbort(ctrl);
    setSnapshotRunning(true);
    try {
      await runSnapshot(
        { ...scope, speed: snapshotSpeed, skipExisting: resume },
        (e) => setSnapshotEvents((evs) => [...evs, e]),
        ctrl.signal
      );
    } finally {
      setSnapshotRunning(false);
      setSnapshotAbort(null);
      loadApps();
    }
  }, [snapshotSpeed, loadApps]);

  const handleStart = useCallback(() => {
    if (!snapshotScope || snapshotRunning) return;
    setSnapshotEvents([]);
    runSnapshotInternal({ appIds: snapshotScope.appIds, locales: snapshotScope.locales }, false);
  }, [snapshotScope, snapshotRunning, runSnapshotInternal]);

  const handleResume = useCallback(() => {
    if (!snapshotScope || snapshotRunning) return;
    runSnapshotInternal({ appIds: snapshotScope.appIds, locales: snapshotScope.locales }, true);
  }, [snapshotScope, snapshotRunning, runSnapshotInternal]);

  const abortSnapshot = useCallback(() => {
    snapshotAbort?.abort();
  }, [snapshotAbort]);

  const handleNavigate = (label: string) => {
    const target = NAV_TO_SCREEN[label];
    if (target) {
      setScreen(target);
      setSelectedAppId(null);
    }
  };

  const openApp = (appId: string) => {
    setSelectedAppId(appId);
    setScreen('app-detail');
  };

  const selectedApp = apps?.find((a) => a.id === selectedAppId) ?? null;
  const showEmpty = apps != null && apps.length === 0 && screen === 'dashboard';

  return (
    <div data-theme={theme} style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {screen === 'dashboard' && (
        <DashboardScreen
          theme={theme}
          onToggleTheme={toggleTheme}
          onCmdK={() => setCmdOpen(true)}
          onOpenApp={(app: AppStats) => openApp(app.id)}
          onRunAll={() => openSnapshotPanel({ label: 'All apps, all locales' })}
          onAddApp={() => setAppAdderOpen(true)}
          onNavigate={handleNavigate}
          apps={apps ?? undefined}
          localeStatsByApp={localeStatsByApp}
        />
      )}

      {screen === 'app-detail' && selectedApp && (
        <AppDetailScreen
          app={selectedApp}
          theme={theme}
          onBack={() => { setScreen('dashboard'); setSelectedAppId(null); }}
          onCmdK={() => setCmdOpen(true)}
          onToggleTheme={toggleTheme}
          onNavigate={handleNavigate}
          onOpenCompetitor={(bundleId) => setCompetitorSheet({ appId: selectedApp.id, bundleId })}
          onRunSnapshot={(opts) => openSnapshotPanel({
            appIds: [selectedApp.id],
            locales: opts?.locales,
            label: `${selectedApp.name}${opts?.locales ? ' · ' + opts.locales.map((l) => l.toUpperCase()).join(', ') : ''}`,
          })}
          onDelete={async () => {
            try {
              await api.deleteApp(selectedApp.id);
              setScreen('dashboard');
              setSelectedAppId(null);
              loadApps();
            } catch (e) {
              alert('Failed to delete: ' + (e as Error).message);
            }
          }}
        />
      )}

      {screen === 'app-detail' && !selectedApp && (
        <PlaceholderScreen
          theme={theme}
          title="Pick an app"
          subtitle="No app selected. Go back to Overview and click 'Open' on any app."
          onHome={() => setScreen('dashboard')}
        />
      )}

      {screen === 'keywords' && (apps && apps.length > 0 ? (
        <StandaloneKeywordsScreen
          theme={theme}
          apps={apps}
          onToggleTheme={toggleTheme}
          onCmdK={() => setCmdOpen(true)}
          onNavigate={handleNavigate}
          onRunLocale={(appId, loc) => openSnapshotPanel({
            appIds: [appId],
            locales: [loc],
            label: `${apps.find(a => a.id === appId)?.name ?? appId} · ${loc.toUpperCase()}`,
          })}
        />
      ) : (
        <PlaceholderScreen theme={theme} title="No apps to edit" subtitle="Add an app first on the Overview screen." onHome={() => setScreen('dashboard')} />
      ))}


      {snapshotOpen && snapshotScope && (
        <SnapshotPanel
          onClose={() => setSnapshotOpen(false)}
          events={snapshotEvents}
          running={snapshotRunning}
          paused={!snapshotRunning && snapshotEvents.length > 0}
          scopeLabel={snapshotScope.label}
          onStart={handleStart}
          onResume={handleResume}
          onAbort={abortSnapshot}
          speed={snapshotSpeed}
          onSpeedChange={setSnapshotSpeed}
        />
      )}

      {/* Floating mini indicator — shown when snapshot is running but panel is hidden */}
      {snapshotRunning && !snapshotOpen && (
        <button
          onClick={() => setSnapshotOpen(true)}
          style={{
            position: 'fixed',
            top: 14,
            right: 14,
            zIndex: 60,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            background: 'var(--bg-raised)',
            borderRadius: 999,
            boxShadow: 'inset 0 0 0 1px var(--border), 0 10px 30px -10px rgba(0,0,0,0.2)',
            cursor: 'pointer',
            border: 0,
          }}
          title="Snapshot running — click to reopen panel"
        >
          <span className="dot" style={{ width: 8, height: 8, background: 'var(--accent)', animation: 'pulse 1.4s infinite' }} />
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>
            Snapshot running · {(() => {
              const last = [...snapshotEvents].reverse().find((e) => e.type === 'keyword' || e.type === 'start');
              const completed = last && 'completed' in last ? last.completed : 0;
              const total = snapshotEvents.find((e) => e.type === 'start')?.total ?? 0;
              return total ? `${completed}/${total}` : '…';
            })()}
          </span>
        </button>
      )}
      {appAdderOpen && (
        <AppAdder
          onClose={() => { setAppAdderOpen(false); setAdderPrefillITunesId(undefined); }}
          onAdded={() => { setAppAdderOpen(false); setAdderPrefillITunesId(undefined); loadApps(); }}
          initialITunesId={adderPrefillITunesId}
        />
      )}
      {cmdOpen && (
        <AppSearch
          onClose={() => setCmdOpen(false)}
          onTrack={(iTunesId) => {
            setCmdOpen(false);
            setAdderPrefillITunesId(iTunesId);
            setAppAdderOpen(true);
          }}
        />
      )}

      {competitorSheet && (
        <CompetitorSheet
          appId={competitorSheet.appId}
          bundleId={competitorSheet.bundleId}
          onClose={() => setCompetitorSheet(null)}
          onTrack={(iTunesId) => {
            setCompetitorSheet(null);
            setAdderPrefillITunesId(iTunesId);
            setAppAdderOpen(true);
          }}
        />
      )}

      {showEmpty && (
        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div className="card" style={{ padding: 32, textAlign: 'center', maxWidth: 440, pointerEvents: 'auto', boxShadow: 'inset 0 0 0 1px var(--border), 0 20px 60px -20px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 42, marginBottom: 8 }}>✨</div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em' }}>No apps tracked yet</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '8px 0 20px', lineHeight: 1.5 }}>
              Add your first iOS app by its App Store ID, then attach keywords per locale and run your first snapshot.
            </p>
            <button className="btn btn-primary" onClick={() => setAppAdderOpen(true)}>
              + Add your first app
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StandaloneKeywordsScreen({ theme, apps, onToggleTheme, onCmdK, onNavigate, onRunLocale }: { theme: string; apps: AppStats[]; onToggleTheme: () => void; onCmdK: () => void; onNavigate: (label: string) => void; onRunLocale: (appId: string, locale: string) => void }) {
  const [selectedId, setSelectedId] = useState(apps[0].id);
  const selected = apps.find((a) => a.id === selectedId) ?? apps[0];
  return (
    <div className="app" data-theme={theme} style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <TopBar theme={theme} onToggleTheme={onToggleTheme} onCmdK={onCmdK} active="Keywords" onNavigate={onNavigate} />
      <div style={{ padding: '24px 28px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>Keywords</h1>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--bg-sunken)', borderRadius: 10, padding: 2, boxShadow: 'inset 0 0 0 1px var(--border-subtle)' }}>
            {apps.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelectedId(a.id)}
                className="btn btn-ghost btn-sm"
                style={{
                  background: selectedId === a.id ? 'var(--bg-raised)' : 'transparent',
                  color: selectedId === a.id ? 'var(--text)' : 'var(--text-muted)',
                  fontWeight: selectedId === a.id ? 500 : 400,
                  boxShadow: selectedId === a.id ? '0 0 0 1px var(--border)' : 'none',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <AppIcon bg={a.iconBg} emoji={a.emoji} iconUrl={a.iconUrl} size={20} rounded={6} />
                {a.name}
              </button>
            ))}
          </div>
        </div>
        <KeywordsEditor app={selected} onRunLocaleSnapshot={(loc) => onRunLocale(selected.id, loc)} />
      </div>
    </div>
  );
}

function PlaceholderScreen({ theme, title, subtitle, onHome }: { theme: string; title: string; subtitle: string; onHome: () => void }) {
  return (
    <div data-theme={theme} style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>{title}</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '8px 0 20px', lineHeight: 1.5 }}>{subtitle}</p>
        <button className="btn btn-primary" onClick={onHome}>← Back to Overview</button>
      </div>
    </div>
  );
}
