// The header tab configuration. Adding a tab = one entry here plus its component — the shell in
// App.tsx renders whatever is listed. dse-hub's 33-line pattern, flattened: this app has no
// subtabs, so `HeaderTab` carries the component directly.
//
// Order is deliberate and matches how the app is used: SUBMIT first (it is the landing tab — a
// responder arrives with an event to file), then the two viewing tabs.

import { createElement, type ComponentType } from "react";
import Catalog from "./catalog/Catalog";
import EventList from "./events/EventList";
import RequestForm from "./request/RequestForm";
import { loadAlgorithms, loadHazards } from "./data";

export interface HeaderTab {
  id: string;
  label: string;
  icon?: string;
  component: ComponentType;
}

// RequestForm is deliberately data-agnostic (it takes the catalog as props), so its tab entry is a
// zero-prop adapter. The datasets are plain bundled JSON, so loading them once at module scope is
// free and keeps the adapter from re-deriving them on every render.
const ALGORITHMS = loadAlgorithms();
const HAZARDS = loadHazards();
const SubmitTab = () => createElement(RequestForm, { algorithms: ALGORITHMS, hazards: HAZARDS });
SubmitTab.displayName = "SubmitTab";

export const TABS: HeaderTab[] = [
  { id: "submit", label: "Submit", icon: "📝", component: SubmitTab },
  { id: "events", label: "Events", icon: "🌀", component: EventList },
  { id: "algorithms", label: "Algorithms", icon: "🛰", component: Catalog },
];

// ---------------------------------------------------------------------------------------------
// Cross-tab navigation, without a router (zero new dependencies)
//
// Clicking a layer chip on an event has to do two things at once: switch the header tab, and hand
// the Algorithms tab something to filter to. A plain callback cannot do it — the Algorithms tab is
// UNMOUNTED while Events is showing, so it is not there to receive anything. So the intent is
// PARKED in a module variable and announced on `window`: App (always mounted) hears the event and
// switches tabs; the newly-mounted tab picks the parked intent up in its mount effect.
// ---------------------------------------------------------------------------------------------

export interface NavIntent {
  tab: string;
  /** Algorithm id to narrow the sensor facet to. */
  algorithm?: string;
  /** ActivationEvent id to prefill the facets from. */
  event?: string;
}

export const NAV_EVENT = "algorithm-catalog:navigate";

let parked: NavIntent | null = null;

export function navigate(intent: NavIntent): void {
  parked = intent;
  window.dispatchEvent(new CustomEvent<NavIntent>(NAV_EVENT, { detail: intent }));
}

/** Read-and-clear. Safe to call twice — React StrictMode double-invokes mount effects in dev. */
export function takeNavIntent(): NavIntent | null {
  const intent = parked;
  parked = null;
  return intent;
}
