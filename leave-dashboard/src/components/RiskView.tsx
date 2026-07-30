import { useMemo } from "react";
import type { CoverageDay } from "../types";
import type { MonthKey } from "../compute";
import { MONTH_NAMES, toISO } from "../compute";

interface Props {
  days: CoverageDay[];
  selectedTeams: Set<string>;
  month: MonthKey;
  threshold: number;
  onThreshold: (v: number) => void;
  onMonth: (m: MonthKey) => void;
  months: MonthKey[];
  nameOf: (slug: string) => string;
}

// Team × day heatmap of the OUT fraction, with a live threshold that flags high-risk cells.
export default function RiskView(props: Props) {
  const { days, selectedTeams, month, threshold, onThreshold, onMonth, months, nameOf } = props;

  const teams = useMemo(
    () => [...new Set(days.filter((d) => selectedTeams.has(d.team)).map((d) => d.team))].sort(),
    [days, selectedTeams],
  );
  const byKey = useMemo(() => {
    const m = new Map<string, CoverageDay>();
    for (const d of days) m.set(`${d.team}|${d.date}`, d);
    return m;
  }, [days]);

  const daysInMonth = new Date(month.year, month.month + 1, 0).getDate();
  const cols = Array.from({ length: daysInMonth }, (_, i) => {
    const dt = new Date(month.year, month.month, i + 1);
    return { n: i + 1, iso: toISO(dt), weekend: dt.getDay() === 0 || dt.getDay() === 6 };
  });

  const flaggedInSpan = useMemo(
    () => days.filter((d) => selectedTeams.has(d.team) && d.out_pct >= threshold).length,
    [days, selectedTeams, threshold],
  );

  const idx = months.findIndex((m) => m.year === month.year && m.month === month.month);

  return (
    <>
      <div className="riskbar panel">
        <div className="monthnav">
          <button className="btn iconbtn" disabled={idx <= 0} onClick={() => onMonth(months[idx - 1])}>‹</button>
          <div className="label">{MONTH_NAMES[month.month]} {month.year}</div>
          <button className="btn iconbtn" disabled={idx >= months.length - 1} onClick={() => onMonth(months[idx + 1])}>›</button>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontWeight: 600 }}>
          High-risk threshold
          <input
            type="range"
            min={5}
            max={100}
            step={5}
            value={Math.round(threshold * 100)}
            onChange={(e) => onThreshold(Number(e.target.value) / 100)}
          />
          <span className="risk-th">{Math.round(threshold * 100)}%</span>
        </label>
        <div style={{ marginLeft: "auto", color: "var(--muted)", fontSize: "0.85rem" }}>
          <b style={{ color: "var(--red)" }}>{flaggedInSpan}</b> flagged team-days across the PI
        </div>
      </div>

      <div className="riskgrid panel">
        <table>
          <thead>
            <tr>
              <th className="team">Team</th>
              {cols.map((c) => (
                <th key={c.iso} className={`dh ${c.weekend ? "we" : ""}`}>{c.n}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team}>
                <th className="team">{team}</th>
                {cols.map((c) => {
                  const cov = byKey.get(`${team}|${c.iso}`);
                  const pct = cov?.out_pct ?? 0;
                  const flag = pct >= threshold && (cov?.out_count ?? 0) > 0;
                  const alpha = pct === 0 ? 0 : Math.min(0.15 + pct * 0.85, 1);
                  // Derive the shade from --red (via color-mix) so it tracks the theme instead of a
                  // fixed light-mode rgba; higher OUT fraction → more opaque red over the cell.
                  const bg = flag
                    ? "var(--red)"
                    : `color-mix(in srgb, var(--red) ${Math.round(alpha * 100)}%, transparent)`;
                  const title = cov && cov.out_count + cov.limited.length > 0
                    ? `${team} · ${c.iso}\n${cov.out_count}/${cov.team_size} out (${Math.round(pct * 100)}%)`
                      + (cov.people_out.length ? `\nOut: ${cov.people_out.map(nameOf).join(", ")}` : "")
                      + (cov.limited.length ? `\nLimited: ${cov.limited.map(nameOf).join(", ")}` : "")
                    : `${team} · ${c.iso}\nfully covered`;
                  return (
                    <td key={c.iso} className={`rc ${flag ? "flag" : ""}`} title={title}>
                      <div className="box" style={{ background: bg }}>
                        {(cov?.out_count ?? 0) > 0 ? cov!.out_count : ""}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {teams.length === 0 && (
              <tr><td className="team" style={{ padding: "0.6rem" }}>No teams selected.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
