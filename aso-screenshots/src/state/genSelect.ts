import { create } from 'zustand';

/**
 * Ephemeral per-tile "include in batch generate" selection for PPO — NOT
 * persisted. Keyed by `${strategyId}:${screenId}`. We store only the user's
 * EXPLICIT choices; the effective state falls back to a caller-provided default
 * (undone → on, already-done → off) so freshly-rendered tiles auto-deselect.
 */
interface GenSelectState {
  explicit: Record<string, boolean>;
  toggle: (key: string, fallback: boolean) => void;
  setMany: (keys: string[], val: boolean) => void;
}

export const useGenSelect = create<GenSelectState>((set) => ({
  explicit: {},
  toggle: (key, fallback) =>
    set((s) => ({ explicit: { ...s.explicit, [key]: !(s.explicit[key] ?? fallback) } })),
  setMany: (keys, val) =>
    set((s) => {
      const e = { ...s.explicit };
      for (const k of keys) e[k] = val;
      return { explicit: e };
    }),
}));

/** Effective selection: explicit choice if set, else the fallback default. */
export function isGenSelected(explicit: Record<string, boolean>, key: string, fallback: boolean): boolean {
  return explicit[key] ?? fallback;
}
