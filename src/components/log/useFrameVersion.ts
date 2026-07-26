import { useEffect, useState } from "react";
import { useApp } from "../../store";

type AppSnapshot = ReturnType<typeof useApp.getState>;

/** bufVersions bumps at batch rate — 30Hz per live source, more with several.
 * Each bump is its own zustand set → its own render pass, and on a slow machine
 * those renders queue back-to-back and starve the frame budget. Subscribe
 * through an rAF gate instead: however many batches land, the view repaints at
 * most once per frame, always with the latest version.
 *
 * `read` must be identity-stable (useCallback keyed on the source ids). */
export function useFrameVersion(active: boolean, read: (s: AppSnapshot) => number): number {
  const [version, setVersion] = useState(() => read(useApp.getState()));
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let latest = read(useApp.getState());
    setVersion(latest);
    const unsub = useApp.subscribe((s) => {
      const next = read(s);
      if (next === latest) return;
      latest = next;
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          setVersion(latest);
        });
      }
    });
    return () => {
      unsub();
      cancelAnimationFrame(raf);
    };
  }, [active, read]);
  // hidden tabs unsubscribe from batches; activation flips the sentinel → one fresh paint
  return active ? version : -1;
}
