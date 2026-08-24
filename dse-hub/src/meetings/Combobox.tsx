import { useRef, useState, type KeyboardEvent } from "react";
import { useClickAway } from "../useClickAway";

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  id?: string;
}

// A light-themed autocomplete that replaces the native <datalist>: on a dark-mode OS Chrome renders
// the datalist popup as an unstyled dark, misaligned dropdown. Free text is allowed — pick a
// suggestion or type a brand-new value (e.g. a new team). Modeled on TimePicker's dropdown pattern.
export default function Combobox({ value, onChange, options, placeholder, id }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false), open);

  const q = value.trim().toLowerCase();
  const matches = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;

  function choose(o: string) {
    onChange(o);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && open && active >= 0 && matches[active]) {
      e.preventDefault();
      choose(matches[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="combo" ref={ref}>
      <input
        id={id}
        className="combo-input"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="combo-caret"
        aria-label="Toggle suggestions"
        tabIndex={-1}
        onMouseDown={(e) => { e.preventDefault(); setOpen((o) => !o); }}
      >
        ▾
      </button>
      {open && matches.length > 0 && (
        <div className="combo-menu panel" role="listbox">
          {matches.map((o, i) => (
            <button
              key={o}
              type="button"
              role="option"
              aria-selected={value === o}
              className={`combo-option ${i === active ? "active" : ""} ${value === o ? "selected" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); choose(o); }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
