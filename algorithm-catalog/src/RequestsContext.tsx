// The staging area for activation requests, mirroring dse-hub/src/ChangesContext.tsx.
//
// Nothing here talks to a server. Requests live in localStorage until the user opens the cart and
// submits them as one prefilled PR — GitHub is the only datastore, and an approved PR is the only
// thing that changes the catalog.

import { createContext, useContext, useState, type ReactNode } from "react";
import type { AlgorithmRequest } from "./types";

const LS_KEY = "algorithm-catalog:requests";

function loadStored(): AlgorithmRequest[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as AlgorithmRequest[];
    }
  } catch {
    /* corrupt or unavailable storage — start empty rather than break the app */
  }
  return [];
}

interface RequestsContextValue {
  items: AlgorithmRequest[];
  stage(r: AlgorithmRequest): void;
  remove(i: number): void;
  clear(): void;
}

const RequestsContext = createContext<RequestsContextValue>({
  items: [],
  stage: () => {},
  remove: () => {},
  clear: () => {},
});

export function RequestsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<AlgorithmRequest[]>(loadStored);

  function persist(next: AlgorithmRequest[]) {
    setItems(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  /** Upsert by id: re-staging the same event replaces it in place instead of duplicating. */
  function stage(r: AlgorithmRequest) {
    setItems((prev) => {
      const idx = prev.findIndex((x) => x.id === r.id);
      const next = idx >= 0 ? prev.map((x, i) => (i === idx ? r : x)) : [...prev, r];
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
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
    <RequestsContext.Provider value={{ items, stage, remove, clear }}>
      {children}
    </RequestsContext.Provider>
  );
}

export function useRequests(): RequestsContextValue {
  return useContext(RequestsContext);
}
