import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { useSse } from "./lib/sse.ts";
import Dashboard from "./screens/Dashboard.tsx";
import CommandCenter from "./screens/CommandCenter.tsx";
import Profitability from "./screens/Profitability.tsx";
import Keywords from "./screens/Keywords.tsx";
import SearchTerms from "./screens/SearchTerms.tsx";
import Actions from "./screens/Actions.tsx";
import CampaignDetail from "./screens/CampaignDetail.tsx";
import Alerts from "./screens/Alerts.tsx";
import SettingsPage from "./screens/Settings.tsx";
import Negatives from "./screens/Negatives.tsx";
import KeywordMatrix from "./screens/KeywordMatrix.tsx";
import TrafficIntelligence from "./screens/TrafficIntelligence.tsx";
import KeywordScreen from "./components/KeywordScreen.tsx";
import AppSwitcher from "./components/AppSwitcher.tsx";
import StudioSwitcher from "./components/StudioSwitcher.tsx";
import { api } from "./api.ts";

export default function App() {
  const [syncing, setSyncing] = useState(false);
  const [phase, setPhase] = useState<{ label: string; progress: number } | null>(null);
  const [lastSync, setLastSync] = useState<string>("");
  const [reloadKey, setReloadKey] = useState(0);

  // On mount — check if a sync is in progress (e.g. user navigated away and back)
  useEffect(() => {
    api.syncStatus().then((s) => {
      if (s.active) {
        setSyncing(true);
        setPhase({ label: s.label, progress: s.progress });
      } else if (s.finished_at) {
        setLastSync(new Date(s.finished_at).toLocaleTimeString());
      }
    }).catch(() => {});
  }, []);

  const { connected } = useSse((event, data) => {
    if (event === "sync:start") {
      setSyncing(true);
        setPhase({ label: "Запуск синхронизации", progress: 0.02 });
    }
    if (event === "sync:phase") {
      const d = data as { label: string; progress: number };
      setPhase(d);
    }
    if (event === "sync:done") {
      setPhase({ label: "Синхронизировано", progress: 1 });
      setLastSync(new Date().toLocaleTimeString());
      setReloadKey((k) => k + 1);
      setTimeout(() => {
        setSyncing(false);
        setPhase(null);
      }, 800);
    }
    if (event === "sync:error") {
      setPhase({ label: "Ошибка синхронизации", progress: 1 });
      setTimeout(() => { setSyncing(false); setPhase(null); }, 2000);
    }
    if (event === "action:applied" || event === "action:failed") {
      setReloadKey((k) => k + 1);
    }
  });

  async function doSync(): Promise<void> {
    if (syncing) return;
    setSyncing(true);
    setPhase({ label: "Подключение к Apple Ads…", progress: 0.02 });
    try {
      await api.sync(14);
    } catch (e) {
      console.error(e);
      setPhase({ label: `Ошибка: ${(e as Error).message}`, progress: 1 });
      setTimeout(() => { setSyncing(false); setPhase(null); }, 3000);
    }
  }

  useEffect(() => {
    document.title = "Ads";
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <StudioSwitcher />
        <AppSwitcher />
        <nav>
          <NavLink to="/" end>Обзор</NavLink>
          <NavLink to="/command">Матрица решений</NavLink>
          <NavLink to="/profitability">Экономика</NavLink>
          <NavLink to="/keyword-matrix">Матрица ключей</NavLink>
          <NavLink to="/traffic">Трафик</NavLink>
          <NavLink to="/keywords">Ключевые слова</NavLink>
          <NavLink to="/search-terms">Поисковые запросы</NavLink>
          <NavLink to="/negatives">Минус-слова</NavLink>
          <NavLink to="/actions">Очередь действий</NavLink>
          <NavLink to="/alerts">Оповещения</NavLink>
          <NavLink to="/settings">Настройки и API</NavLink>
        </nav>
        <div className="spacer" />
        <div className="status">
          <div className={`live ${connected ? "" : "off"}`}>{connected ? "Онлайн" : "Нет соединения"}</div>
          {lastSync && <div className="meta">Обновлено · {lastSync}</div>}
        </div>
        {syncing && phase ? (
          <div className="sync-progress">
            <div className="sync-progress-label">{phase.label}</div>
            <div className="sync-progress-bar">
              <div className="sync-progress-fill" style={{ width: `${Math.round(phase.progress * 100)}%` }} />
            </div>
            <div className="sync-progress-pct">{Math.round(phase.progress * 100)}%</div>
          </div>
        ) : (
          <button className="sync-btn primary" onClick={doSync} disabled={syncing}>
            Обновить данные
          </button>
        )}
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard reloadKey={reloadKey} />} />
          <Route path="/command" element={<CommandCenter reloadKey={reloadKey} />} />
          <Route path="/profitability" element={<Profitability reloadKey={reloadKey} />} />
          <Route path="/campaigns/:id" element={<CampaignDetail />} />
          <Route path="/keywords" element={<Keywords reloadKey={reloadKey} />} />
          <Route path="/keyword-matrix" element={
            <KeywordScreen title="Матрица ключей">
              {(k) => (
                <KeywordMatrix
                  app={{ id: k.app.id, name: k.app.name, iTunesId: k.app.iTunesId, bundle: k.app.bundle, iconUrl: k.app.iconUrl }}
                  locale={k.locale}
                  artworks={k.artworks}
                  sharedTopFive={k.sharedTopFive}
                  sharedTopFiveStatus={k.sharedTopFiveStatus}
                  onResolveTopFive={k.resolveTopFive}
                  onEnsureArtworks={k.ensureArtworks}
                />
              )}
            </KeywordScreen>
          } />
          <Route path="/traffic" element={
            <KeywordScreen title="Трафик">
              {(k) => (
                <TrafficIntelligence
                  className="content"
                  app={{ id: k.app.id, name: k.app.name, iTunesId: k.app.iTunesId, bundle: k.app.bundle, iconUrl: k.app.iconUrl }}
                  locale={k.locale}
                  rankings={k.rankings}
                  artworks={k.artworks}
                  sharedTopFive={k.sharedTopFive}
                  sharedTopFiveStatus={k.sharedTopFiveStatus}
                  onResolveTopFive={k.resolveTopFive}
                  onEnsureArtworks={k.ensureArtworks}
                />
              )}
            </KeywordScreen>
          } />
          <Route path="/search-terms" element={<SearchTerms reloadKey={reloadKey} />} />
          <Route path="/actions" element={<Actions reloadKey={reloadKey} />} />
          <Route path="/negatives" element={<Negatives />} />
          <Route path="/alerts" element={<Alerts reloadKey={reloadKey} />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
