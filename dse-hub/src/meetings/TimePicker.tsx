// Pill-style time picker: a button showing the current value in 12h format, clicking opens a
// dropdown list of times in 15-min increments 06:00–20:00. Stores and emits "HH:MM" 24h strings.
import { useRef, useState } from "react";
import { useClickAway } from "../useClickAway";

function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

// Generate 15-min slots from 06:00 to 20:00 inclusive.
const SLOTS: string[] = [];
for (let h = 6; h <= 20; h++) {
  for (let m = 0; m < 60; m += 15) {
    if (h === 20 && m > 0) break;
    SLOTS.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
}

interface Props {
  value: string; // "HH:MM" or ""
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
}

export default function TimePicker({ value, onChange, placeholder = "Set time", id }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false), open);

  const label = value ? to12h(value) : placeholder;

  return (
    <div className="tp-wrap" ref={ref}>
      <button
        type="button"
        id={id}
        className={`tp-pill ${value ? "has-value" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {label}
      </button>
      {open && (
        <div className="tp-dropdown panel" role="listbox">
          <button
            type="button"
            className="tp-option tp-clear"
            role="option"
            aria-selected={!value}
            onClick={() => { onChange(""); setOpen(false); }}
          >
            Clear
          </button>
          {SLOTS.map((slot) => (
            <button
              key={slot}
              type="button"
              className={`tp-option ${value === slot ? "selected" : ""}`}
              role="option"
              aria-selected={value === slot}
              onClick={() => { onChange(slot); setOpen(false); }}
            >
              {to12h(slot)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
