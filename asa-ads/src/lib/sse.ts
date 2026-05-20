import { useEffect, useRef, useState } from "react";

export type SseHandler = (event: string, data: unknown) => void;

export function useSse(handler: SseHandler): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const es = new EventSource(import.meta.env.BASE_URL === "/" ? "/sse" : "/asa-sse");
    es.addEventListener("hello", () => setConnected(true));
    es.addEventListener("error", () => setConnected(false));
    const types = [
      "sync:start", "sync:phase", "sync:done", "sync:error",
      "action:enqueued", "action:applied", "action:failed", "action:cancelled",
      "alert:new",
    ];
    const listeners = types.map((t) => {
      const fn = (e: MessageEvent): void => {
        try { handlerRef.current(t, JSON.parse(e.data)); } catch { /* ignore */ }
      };
      es.addEventListener(t, fn as EventListener);
      return [t, fn] as const;
    });
    return () => {
      for (const [t, fn] of listeners) es.removeEventListener(t, fn as EventListener);
      es.close();
    };
  }, []);

  return { connected };
}

/** Track which row IDs recently changed so we can flash them in the UI. */
export function useFlashTracker(): {
  flashed: Set<string | number>;
  flash: (id: string | number) => void;
} {
  const [flashed, setFlashed] = useState<Set<string | number>>(new Set());
  function flash(id: string | number): void {
    setFlashed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setTimeout(() => {
      setFlashed((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 1400);
  }
  return { flashed, flash };
}
