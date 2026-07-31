import { useEffect, useState } from "react";
import { TABS } from "./tabs";
import { useViewTz } from "./TzContext";
import { useChanges } from "./ChangesContext";
import { TZ_OPTIONS } from "./tz";
import ChangesCart from "./ChangesCart";

// Hub shell: state-based header tabs + subtabs (no router), synced to the URL hash so a tab is
// linkable/refresh-safe (#/meetings/tracker). The active subtab's component renders below.

function readHash(): { tab: string; sub: string } {
  const h = window.location.hash.replace(/^#\/?/, "");
  const [tab, sub] = h.split("/");
  return { tab, sub };
}

export default function App() {
  const initial = readHash();
  const { tz, setTz } = useViewTz();
  const { items: cartItems } = useChanges();
  const [tabId, setTabId] = useState(() =>
    TABS.some((t) => t.id === initial.tab) ? initial.tab : TABS[0].id,
  );
  const tab = TABS.find((t) => t.id === tabId) ?? TABS[0];

  const [subId, setSubId] = useState(() =>
    tab.subs.some((s) => s.id === initial.sub) ? initial.sub : tab.subs[0].id,
  );
  const sub = tab.subs.find((s) => s.id === subId) ?? tab.subs[0];

  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    window.location.hash = `/${tab.id}/${sub.id}`;
  }, [tab.id, sub.id]);

  function selectTab(id: string) {
    const t = TABS.find((x) => x.id === id);
    if (!t) return;
    setTabId(id);
    setSubId(t.subs[0].id);
  }

  const Active = sub.component;

  // Build the options list: TZ_OPTIONS + browser tz if not already in the list.
  const browserTz = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; }
  })();
  const extraBrowser = browserTz && !TZ_OPTIONS.some((o) => o.id === browserTz)
    ? [{ id: browserTz, label: `${browserTz} (your time)` }]
    : [];
  const tzSelectOptions = [...TZ_OPTIONS, ...extraBrowser];

  return (
    <div className="app">
      <header className="hub-header">
        <div className="hub-brand">
          <span className="hub-logo">DSE</span>
          <span className="hub-title">Hub</span>
        </div>
        <nav className="hub-tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={t.id === tab.id ? "active" : ""}
              onClick={() => selectTab(t.id)}
            >
              {t.icon && <span className="tab-icon">{t.icon}</span>}
              {t.label}
            </button>
          ))}
        </nav>
        <div className="hub-right">
          <button
            className="changes-btn"
            onClick={() => setCartOpen(true)}
            aria-label={`Changes cart${cartItems.length > 0 ? `, ${cartItems.length} staged` : ""}`}
          >
            🧺 Changes
            {cartItems.length > 0 && (
              <span className="changes-badge">{cartItems.length}</span>
            )}
          </button>
          <span className="tz-globe" aria-hidden>🌐</span>
          <select
            className="tz-picker"
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            aria-label="View timezone"
          >
            {tzSelectOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
      </header>

      <div className="hub-subtabs" role="tablist" aria-label={`${tab.label} views`}>
        {tab.subs.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={s.id === sub.id}
            className={s.id === sub.id ? "active" : ""}
            onClick={() => setSubId(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <main className="hub-main">
        <Active />
      </main>

      {cartOpen && <ChangesCart onClose={() => setCartOpen(false)} />}
    </div>
  );
}
