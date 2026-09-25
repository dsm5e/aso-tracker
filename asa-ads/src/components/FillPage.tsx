import { useEffect, useState, type ReactNode } from "react";

/**
 * Folds the page header while a long list inside the returned ref's element is
 * scrolled: true after 48px down, false only back at the very top.
 * Returns [compact, callbackRef] — a callback ref so an element that mounts late
 * (after a loading state) is still picked up.
 */
export function useFoldOnScroll(): [boolean, (node: HTMLElement | null) => void] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (!node) return;
    // scroll does not bubble: listen in the capture phase for whichever list scrolls inside
    const onScroll = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.scrollHeight - target.clientHeight < 160) return;
      // hysteresis: fold after 48px, unfold only back at the top — no flicker at the edge
      setCompact((was) => (was ? target.scrollTop > 4 : target.scrollTop > 48));
    };
    node.addEventListener("scroll", onScroll, true);
    return () => node.removeEventListener("scroll", onScroll, true);
  }, [node]);
  return [compact, setNode];
}

/**
 * List-screen frame: fills the viewport so the table scrolls inside its own
 * card (sticky column header, horizontal scrollbar in view) and folds the
 * page summary (.fold) while the list is scrolled.
 */
export default function FillPage({ className = "", children }: { className?: string; children: ReactNode }) {
  const [compact, ref] = useFoldOnScroll();
  return <div ref={ref} className={`page-fill ${compact ? "is-compact" : ""} ${className}`.trim()}>{children}</div>;
}
