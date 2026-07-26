import { useEffect, useRef } from "react";

/**
 * Preserves a scroll container's position across tab switches.
 *
 * Inactive tabs stay mounted but go `display: none`, which resets scrollTop to 0.
 * The value can't be read in an effect on deactivation — that runs after the tab
 * is already hidden — so a scroll listener keeps it current while it's visible.
 *
 * LogView doesn't use this: its virtualizer drops its measurement cache while
 * hidden, so it restores by row index instead of pixels.
 */
export function useKeepScroll<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);
  const saved = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      if (activeRef.current) saved.current = el.scrollTop;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (active && ref.current) ref.current.scrollTop = saved.current;
  }, [active]);

  return ref;
}
