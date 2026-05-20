import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type AppRow } from "../api.ts";

interface AppCtx {
  apps: AppRow[];
  selected: number | "all";
  setSelected: (id: number | "all") => void;
  selectedApp?: AppRow;
  refresh: () => void;
}

const STORAGE_KEY = "asa-ads.selected-app";
const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [apps, setApps] = useState<AppRow[]>([]);
  const [selected, setSelectedRaw] = useState<number | "all">(() => {
    const v = localStorage.getItem(STORAGE_KEY);
    if (!v || v === "all") return "all";
    const n = Number(v);
    return Number.isFinite(n) ? n : "all";
  });

  function setSelected(id: number | "all"): void {
    setSelectedRaw(id);
    localStorage.setItem(STORAGE_KEY, String(id));
  }

  async function refresh(): Promise<void> {
    try {
      const data = await api.apps();
      setApps(data);
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const selectedApp = selected === "all" ? undefined : apps.find((a) => a.app_id === selected);

  return (
    <Ctx.Provider value={{ apps, selected, setSelected, selectedApp, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
