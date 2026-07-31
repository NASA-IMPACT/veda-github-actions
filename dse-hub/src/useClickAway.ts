import { useEffect, RefObject } from "react";

// Calls `onAway` when a mousedown lands outside `ref` (used to close popovers/menus).
// Adapted from leave-dashboard/src/useClickAway.ts.
export function useClickAway(ref: RefObject<HTMLElement>, onAway: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onAway();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [ref, onAway, active]);
}
