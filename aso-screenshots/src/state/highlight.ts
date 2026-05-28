import { create } from 'zustand';

/**
 * Ephemeral "just changed by an agent/external push" highlight — NOT persisted.
 * `applyServerState` (SSE) diffs the incoming state and flashes the changed
 * element ids; components add the `aso-flash` class while their id is in the
 * set. Mirrors aso-video's flashingIds pattern (yellow pulse on agent edits).
 *
 * Element id conventions:
 *   - screenshot slot:  the screenshot id (e.g. "ms01ip")
 *   - PPO strategy:     the strategy id
 *   - PPO tile:         `${strategyId}:${screenId}`
 */
interface HighlightState {
  ids: Set<string>;
  flash: (ids: string[]) => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useHighlight = create<HighlightState>((set) => ({
  ids: new Set<string>(),
  flash: (ids) => {
    if (!ids.length) return;
    set({ ids: new Set(ids) });
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => set({ ids: new Set<string>() }), 1800);
  },
}));
