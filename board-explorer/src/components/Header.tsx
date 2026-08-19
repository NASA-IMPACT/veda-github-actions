import { useState } from "react";
import type { Theme } from "../theme";
import type { BoardDoc } from "../types";

interface Props {
  doc: BoardDoc;
  source: "live" | "snapshot";
  theme: Theme;
  onToggleTheme: () => void;
}

/** "2026-08-19T14:52:09Z" -> "19 Aug, 14:52 UTC" — short enough for a header, still unambiguous. */
function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${d.toLocaleString("en", { month: "short", timeZone: "UTC" })}, ${String(
    d.getUTCHours(),
  ).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

export default function Header({ doc, source, theme, onToggleTheme }: Props) {
  const [copied, setCopied] = useState(false);

  function copyLink() {
    navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <header className="hdr">
      <div className="hdr-brand">
        <span className="hdr-logo" aria-hidden>▦</span>
        <div>
          <h1>Board Explorer</h1>
          <p className="hdr-sub">
            <a href={doc.board.url} target="_blank" rel="noreferrer">
              {doc.board.title}
            </a>{" "}
            · {doc.stats.items} items
          </p>
        </div>
      </div>

      <div className="hdr-right">
        <span
          className={source === "live" ? "srcbadge live" : "srcbadge snap"}
          title={
            source === "live"
              ? "Read from the board-explorer/data branch, refreshed by the sync workflow"
              : "The data branch was unreachable — showing the snapshot bundled at build time"
          }
        >
          {source === "live" ? "● live" : "○ snapshot"} · {stamp(doc.generated)}
        </span>
        <button className="btn" onClick={copyLink} title="Copy a link that reopens this exact view">
          {copied ? "✓ Link copied" : "🔗 Copy link"}
        </button>
        <button
          className="btn iconbtn"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
      </div>
    </header>
  );
}
