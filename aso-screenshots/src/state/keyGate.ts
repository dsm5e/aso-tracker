import { create } from 'zustand';

const API_BASE = import.meta.env.BASE_URL === '/' ? '/api' : '/studio-api';

export type KeyName = 'FAL_API_KEY' | 'OPENAI_API_KEY';

interface MissingDialog {
  keyName: KeyName;
  /** Short user-facing reason, e.g. "AI hero generation". */
  reason: string;
}

interface KeyGateState {
  /** Last fetched status — null means not yet loaded. */
  status: Partial<Record<KeyName, boolean>> | null;
  /** When set, KeyMissingDialog renders. Null = closed. */
  missing: MissingDialog | null;
  /** When true, SettingsModal is open (controlled here so the dialog can hand off). */
  settingsOpen: boolean;

  refreshStatus: () => Promise<void>;
  /** Wrap an AI call: if the key is configured, run `fn`. Otherwise show the dialog. */
  ensureKey: (keyName: KeyName, reason: string, fn: () => void) => Promise<void>;
  closeMissing: () => void;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useKeyGate = create<KeyGateState>((set, get) => ({
  status: null,
  missing: null,
  settingsOpen: false,

  refreshStatus: async () => {
    try {
      const r = await fetch(`${API_BASE}/settings/keys`);
      if (!r.ok) return;
      const data = (await r.json()) as Record<KeyName, { set: boolean }>;
      set({ status: { FAL_API_KEY: data.FAL_API_KEY?.set, OPENAI_API_KEY: data.OPENAI_API_KEY?.set } });
    } catch {/* ignore */}
  },

  ensureKey: async (keyName, reason, fn) => {
    // Always re-fetch on demand so we see fresh state after the user just saved a key.
    let isSet = get().status?.[keyName] ?? false;
    try {
      const r = await fetch(`${API_BASE}/settings/keys`);
      if (r.ok) {
        const data = (await r.json()) as Record<KeyName, { set: boolean }>;
        isSet = data[keyName]?.set ?? false;
        set({ status: { FAL_API_KEY: data.FAL_API_KEY?.set, OPENAI_API_KEY: data.OPENAI_API_KEY?.set } });
      }
    } catch {/* fall back to cached status */}

    if (isSet) { fn(); return; }
    set({ missing: { keyName, reason } });
  },

  closeMissing: () => set({ missing: null }),
  openSettings: () => set({ settingsOpen: true, missing: null }),
  closeSettings: () => set({ settingsOpen: false }),
}));
