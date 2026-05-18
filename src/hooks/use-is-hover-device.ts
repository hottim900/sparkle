import { useEffect, useState } from "react";

/**
 * Returns true when the current device reports `(hover: hover)` — i.e. the
 * pointer can hover over elements without first interacting. False on touch
 * devices that fall back to tap-to-activate semantics.
 *
 * Used by WikilinkChip to choose between HoverCard (desktop) and a
 * tap-triggered Popover (mobile) so the preview is reachable on both
 * surface types (DES-2).
 *
 * SSR-safe: returns `true` (the desktop default) on the first render so
 * server output matches the most common case. Re-evaluates on mount.
 */
export function useIsHoverDevice(): boolean {
  const [isHover, setIsHover] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(hover: hover)");
    setIsHover(mq.matches);
    const listener = (e: MediaQueryListEvent) => setIsHover(e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  return isHover;
}
