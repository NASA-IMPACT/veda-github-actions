import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

interface Props {
  onComplete: () => void;
  ms?: number; // hold duration; default 2000
  label?: string;
  holdingLabel?: string;
}

// Press-and-HOLD to delete: the action only fires after a continuous `ms` hold, and a fill bar
// animates across the button in lockstep. Releasing (pointer up / leave / cancel) before the end
// aborts. Replaces a confirm() dialog with a deliberate, hard-to-trigger-by-accident gesture.
export default function HoldToDelete({
  onComplete,
  ms = 2000,
  label = "🗑 Delete meeting",
  holdingLabel = "Hold to delete…",
}: Props) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);

  function start(primary: boolean) {
    if (!primary || holding) return;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onComplete();
    }, ms);
  }
  function cancel() {
    if (timer.current != null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setHolding(false);
  }

  return (
    <button
      type="button"
      className={`btn danger hold-btn ${holding ? "holding" : ""}`}
      style={{ "--hold-ms": `${ms}ms` } as CSSProperties}
      onPointerDown={(e: PointerEvent) => start(e.button === 0)}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); start(true); }
      }}
      onKeyUp={cancel}
      onBlur={cancel}
      title={`Press and hold ${ms / 1000}s to delete`}
      aria-label={`${label} — press and hold ${ms / 1000} seconds`}
    >
      <span className="hold-fill" aria-hidden />
      <span className="hold-label">{holding ? holdingLabel : label}</span>
    </button>
  );
}
