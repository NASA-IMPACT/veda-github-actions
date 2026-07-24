import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { computeTrends } from "../trends";
import type { Allocation } from "../types";

/** Multi-PI trends: capacity/demand + role bottleneck, with a "what to act on" alert panel. */
export default function TrendsView({ allocations }: { allocations: Allocation[] }) {
  const t = useMemo(() => computeTrends(allocations), [allocations]);

  const g1 = t.perPi.map((p) => ({
    pi: p.pi,
    demand: p.demand,
    util: Math.round(p.utilization * 100),
    over: p.overCount,
  }));

  const g2 = t.pis.map((pi, i) => {
    const row: Record<string, number | string> = { pi };
    for (const r of t.roles) row[r] = t.roleSeries[r][i];
    return row;
  });

  const barColor = (util: number) =>
    util >= 100 ? "var(--red)" : util >= 80 ? "var(--amber)" : "var(--blue)";

  if (t.pis.length < 2) {
    return (
      <div className="panel">
        <h2>Trends</h2>
        <p className="hint">Trends need at least 2 Program Increments of data — only {t.pis.length} present so far.</p>
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <h2>⚠️ What to act on</h2>
        {t.alerts.length === 0 ? (
          <p className="hint">No alerts — capacity looks healthy across all PIs.</p>
        ) : (
          <ul className="alerts">
            {t.alerts.map((a, i) => (
              <li key={i} className={`alert ${a.severity}`}>
                <span className="dot" />
                {a.text}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel">
        <h2>Capacity vs demand over PIs</h2>
        <p className="hint">
          Total demand (Σ raw FTE) vs team capacity ({t.capacity} people). Bars turn <b>amber ≥80%</b> /{" "}
          <b>red ≥100%</b> utilization; the red line tracks the number of over-allocated people. Individuals
          can be over even when the team isn't fully utilized — watch both.
        </p>
        <ResponsiveContainer width="100%" height={330}>
          <ComposedChart data={g1} margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="pi" tick={{ fontSize: 12 }} />
            <YAxis yAxisId="fte" tick={{ fontSize: 11 }} label={{ value: "FTE", angle: -90, position: "insideLeft", fontSize: 11 }} />
            <YAxis yAxisId="cnt" orientation="right" allowDecimals={false} tick={{ fontSize: 11 }} label={{ value: "# over", angle: 90, position: "insideRight", fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <ReferenceLine yAxisId="fte" y={t.capacity} stroke="var(--ink)" strokeDasharray="6 3" label={{ value: `capacity ${t.capacity}`, fontSize: 11, position: "insideTopRight" }} />
            <Bar yAxisId="fte" dataKey="demand" name="Demand FTE" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {g1.map((d, i) => (
                <Cell key={i} fill={barColor(d.util)} />
              ))}
            </Bar>
            <Line yAxisId="cnt" type="monotone" dataKey="over" name="# over-allocated" stroke="var(--red)" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="panel">
        <h2>Role demand vs supply</h2>
        <p className="hint">
          FTE demand per role across PIs. A role trending above its supply is a bottleneck — hire or rebalance.
          <b> Bottleneck roles are drawn bold red.</b>
        </p>
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={g2} margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="pi" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 11 }} label={{ value: "FTE", angle: -90, position: "insideLeft", fontSize: 11 }} />
            <Tooltip />
            <Legend />
            {t.roles.map((r) => {
              const bottleneck = t.bottleneckRoles.has(r);
              return (
                <Line
                  key={r}
                  type="monotone"
                  dataKey={r}
                  name={bottleneck ? `${r} ⚠ (supply ${t.roleSupply[r]})` : r}
                  stroke={bottleneck ? "var(--red)" : "var(--muted)"}
                  strokeWidth={bottleneck ? 3 : 1.25}
                  strokeOpacity={bottleneck ? 1 : 0.6}
                  dot={bottleneck ? { r: 3 } : false}
                  isAnimationActive={false}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
        <p className="hint">
          Supply (people × 1.0): {t.roles.map((r) => `${r} ${t.roleSupply[r]}`).join(" · ")}
        </p>
      </div>
    </>
  );
}
