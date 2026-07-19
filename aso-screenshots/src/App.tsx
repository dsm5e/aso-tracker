import { useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from './AppShell';
import { SetupScreen } from './screens/Setup';
import { CatalogScreen } from './screens/Catalog';
import { EditorScreen } from './screens/Editor';
import { PolishScreen } from './screens/Polish';
import { ExportScreen } from './screens/Export';
import { LocalesScreen } from './screens/Locales';
import { PPOScreen } from './screens/PPO';
import { IconGeneratorScreen } from './screens/IconGenerator';
import { AgentCursor } from './components/AgentCursor';
import { useStudio } from './state/studio';

// BASE_URL is '/studio/' when proxied via Keywords origin, '/' for direct access.
// React Router wants no trailing slash, hence the replace.
const ROUTER_BASENAME = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/';

const LAST_ROUTE_KEY = 'aso-studio:last-route';
const KNOWN_ROUTES = new Set(['/setup', '/catalog', '/editor', '/polish', '/locales', '/export', '/ppo', '/icon-generator']);

/** Persists the current route to localStorage so cross-app navigation
 *  (Studio → Tracker → Studio) restores the last screen instead of always
 *  dumping the user back on /setup. */
function RouteMemory() {
  const loc = useLocation();
  useEffect(() => {
    if (KNOWN_ROUTES.has(loc.pathname)) {
      localStorage.setItem(LAST_ROUTE_KEY, loc.pathname);
    }
  }, [loc.pathname]);
  return null;
}

/** Agent-driven navigation: when the bridge sets `agentNav` (and pushes it),
 *  route every open tab there so the user watches me step through the wizard,
 *  then clear it. */
function AgentNavigator() {
  const nav = useNavigate();
  const loc = useLocation();
  const agentNav = useStudio((s) => s.agentNav);
  useEffect(() => {
    if (!agentNav) return;
    if (agentNav !== loc.pathname) nav(agentNav);
    // Clear locally so we don't re-navigate on every render / re-broadcast.
    useStudio.setState({ agentNav: null });
  }, [agentNav, loc.pathname, nav]);
  return null;
}

/** First-render redirect from index ("/") to the last visited route, falling
 *  back to /setup. Renders nothing when source/target match. */
function HomeRedirect() {
  const nav = useNavigate();
  useEffect(() => {
    const last = localStorage.getItem(LAST_ROUTE_KEY);
    nav(last && KNOWN_ROUTES.has(last) ? last : '/setup', { replace: true });
  }, [nav]);
  return null;
}

export function App() {
  return (
    <BrowserRouter basename={ROUTER_BASENAME}>
      <RouteMemory />
      <AgentNavigator />
      <AgentCursor />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomeRedirect />} />
          <Route path="/setup" element={<SetupScreen />} />
          <Route path="/catalog" element={<CatalogScreen />} />
          <Route path="/editor" element={<EditorScreen />} />
          <Route path="/polish" element={<PolishScreen />} />
          <Route path="/locales" element={<LocalesScreen />} />
          <Route path="/export" element={<ExportScreen />} />
          <Route path="/ppo" element={<PPOScreen />} />
          <Route path="/icon-generator" element={<IconGeneratorScreen />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
