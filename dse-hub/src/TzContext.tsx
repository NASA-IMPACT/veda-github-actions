import { createContext, useContext, useState, type ReactNode } from "react";

const LS_KEY = "dse-hub:viewTz";

function defaultTz(): string {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) return saved;
  } catch { /* ignore */ }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
  } catch { /* ignore */ }
  return "America/Chicago";
}

interface TzContextValue {
  tz: string;
  setTz: (tz: string) => void;
}

const TzContext = createContext<TzContextValue>({
  tz: "America/Chicago",
  setTz: () => {},
});

export function TzProvider({ children }: { children: ReactNode }) {
  const [tz, setTzState] = useState<string>(defaultTz);

  function setTz(next: string) {
    setTzState(next);
    try { localStorage.setItem(LS_KEY, next); } catch { /* ignore */ }
  }

  return (
    <TzContext.Provider value={{ tz, setTz }}>
      {children}
    </TzContext.Provider>
  );
}

export function useViewTz(): TzContextValue {
  return useContext(TzContext);
}
