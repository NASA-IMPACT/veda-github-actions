// Light/dark theme: an attribute on <html> (`data-theme`) drives the CSS variable overrides in
// styles.css. Default is dark; a manual choice is remembered in localStorage. The initial attribute
// is set by a tiny inline script in index.html (no-FOUC) — this module keeps React in sync with it.
export type Theme = "light" | "dark";

const KEY = "board-theme";

export function getInitialTheme(): Theme {
  const stored = localStorage.getItem(KEY);
  return stored === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(KEY, theme);
}
