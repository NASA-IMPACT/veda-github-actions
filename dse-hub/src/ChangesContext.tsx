import { createContext, useContext, useState, type ReactNode } from "react";
import type { ChangeDoc } from "./changesData";

const LS_KEY = "dse-hub:changes";

function loadStored(): ChangeDoc[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as ChangeDoc[];
    }
  } catch { /* ignore */ }
  return [];
}

interface ChangesContextValue {
  items: ChangeDoc[];
  stage(d: ChangeDoc): void;
  remove(i: number): void;
  clear(): void;
}

const ChangesContext = createContext<ChangesContextValue>({
  items: [],
  stage: () => {},
  remove: () => {},
  clear: () => {},
});

export function ChangesProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ChangeDoc[]>(loadStored);

  function persist(next: ChangeDoc[]) {
    setItems(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  function stage(d: ChangeDoc) {
    setItems((prev) => {
      // Upsert: replace existing entry for same kind+data.id in place, or append.
      const dataId = (d.data as { id?: string }).id;
      const idx = prev.findIndex(
        (x) => x.kind === d.kind && (x.data as { id?: string }).id === dataId,
      );
      const next = idx >= 0
        ? prev.map((x, i) => (i === idx ? d : x))
        : [...prev, d];
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function remove(i: number) {
    persist(items.filter((_, idx) => idx !== i));
  }

  function clear() {
    persist([]);
  }

  return (
    <ChangesContext.Provider value={{ items, stage, remove, clear }}>
      {children}
    </ChangesContext.Provider>
  );
}

export function useChanges(): ChangesContextValue {
  return useContext(ChangesContext);
}
