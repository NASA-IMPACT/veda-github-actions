import { RefObject, useEffect } from "react";

// Close a popover when the user clicks/taps outside `ref` (instead of on mouse-leave, which
// makes small dropdowns disappear the moment the cursor drifts off).
export function useClickAway(ref: RefObject<HTMLElement | null>, onAway: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: Event) => {
      const target = e.target as Node;
      if (ref.current && !ref.current.contains(target)) onAway();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onAway();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, onAway, active]);
}
