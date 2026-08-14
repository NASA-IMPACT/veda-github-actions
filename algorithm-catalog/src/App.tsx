// The shell: a flat 3-tab header (no subtabs), the active tab's component, and the requests cart.
//
// State-based navigation, no router (zero new dependencies), synced to the URL hash so a tab is
// linkable and refresh-safe (#/algorithms). The hash listener is what makes an external jump work
// too — see `navigate()` in tabs.ts for the Events → Algorithms case.

import { useEffect, useState } from "react";
import { TABS, NAV_EVENT, type NavIntent } from "./tabs";
import { useRequests } from "./RequestsContext";
import RequestsCart from "./RequestsCart";

function readHash(): string {
  return window.location.hash.replace(/^#\/?/, "").split("/")[0];
}

export default function App() {
  const { items } = useRequests();
  const [tabId, setTabId] = useState(() => {
    const h = readHash();
    return TABS.some((t) => t.id === h) ? h : TABS[0].id;
  });
  const [cartOpen, setCartOpen] = useState(false);

  const tab = TABS.find((t) => t.id === tabId) ?? TABS[0];

  useEffect(() => {
    window.location.hash = `/${tab.id}`;
  }, [tab.id]);

  // A layer chip on an event asks for the Algorithms tab; the tab itself picks up the parked
  // intent once it mounts.
  useEffect(() => {
    const onNav = (e: Event) => {
      const intent = (e as CustomEvent<NavIntent>).detail;
      if (intent?.tab && TABS.some((t) => t.id === intent.tab)) setTabId(intent.tab);
    };
    window.addEventListener(NAV_EVENT, onNav);
    return () => window.removeEventListener(NAV_EVENT, onNav);
  }, []);

  const Active = tab.component;

  return (
    <div className="app">
      <header className="hub-header">
        <div className="hub-brand">
          <span className="hub-logo" aria-hidden>
            🛰
          </span>
          <span className="hub-title">Algorithm Catalog</span>
        </div>

        <nav className="hub-tabs" role="tablist" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === tab.id}
              className={t.id === tab.id ? "active" : ""}
              onClick={() => setTabId(t.id)}
            >
              {t.icon && (
                <span className="tab-icon" aria-hidden>
                  {t.icon}
                </span>
              )}
              {t.label}
            </button>
          ))}
        </nav>

        <div className="hub-right">
          <button
            className="cart-btn"
            onClick={() => setCartOpen(true)}
            aria-label={`Requests cart${items.length > 0 ? `, ${items.length} staged` : ", empty"}`}
          >
            🧺 Requests
            {items.length > 0 && <span className="cart-badge">{items.length}</span>}
          </button>
        </div>
      </header>

      <main className="hub-main">
        <Active />
      </main>

      {cartOpen && <RequestsCart onClose={() => setCartOpen(false)} />}
    </div>
  );
}
