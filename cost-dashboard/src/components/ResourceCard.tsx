// One resource in the cart: a per-service input form + its live monthly subtotal + a breakdown.
import { useMemo } from "react";
import type { PricingDoc, Resource } from "../types";
import { SERVICE_LABEL, costOf, ESTIMATE_CATEGORIES } from "../compute";
import { money, rate } from "../format";

interface Props {
  resource: Resource;
  pricing: PricingDoc;
  onChange: (next: Resource) => void;
  onRemove: (id: string) => void;
}

function Num(props: {
  label: string; value: number; onChange: (n: number) => void;
  min?: number; step?: number; suffix?: string; hint?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      <span className="field-input">
        <input
          type="number"
          value={Number.isFinite(props.value) ? props.value : 0}
          min={props.min ?? 0}
          step={props.step ?? 1}
          onChange={(e) => props.onChange(Math.max(props.min ?? 0, Number(e.target.value) || 0))}
        />
        {props.suffix && <span className="field-suffix">{props.suffix}</span>}
      </span>
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  );
}

// Hours/month presets: 720 = a 30-day month, 730 = AWS's average-month convention.
const HOURS_HINT = "720 = 30 days · 730 = avg month";

function Sel(props: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      <select className="field-input" value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

export function ResourceCard({ resource, pricing, onChange, onRemove }: Props) {
  const cost = useMemo(() => costOf(resource, pricing), [resource, pricing]);

  const ec2Options = useMemo(
    () =>
      Object.entries(pricing.ec2.instances)
        .sort((a, b) => a[1].hourlyUSD - b[1].hourlyUSD)
        .map(([t, i]) => ({
          value: t,
          label: `${t} · ${i.vcpu ?? "?"} vCPU · ${i.memoryGiB ?? "?"} GiB · ${rate(i.hourlyUSD)}/hr`,
        })),
    [pricing],
  );

  const rdsByEngine = useMemo(() => {
    const groups: Record<string, { key: string; label: string; hourly: number }[]> = {};
    for (const [key, inst] of Object.entries(pricing.rds.instances)) {
      (groups[inst.engine] ||= []).push({
        key,
        label: `${inst.instanceType} · ${rate(inst.hourlyUSD)}/hr`,
        hourly: inst.hourlyUSD,
      });
    }
    for (const g of Object.values(groups)) g.sort((a, b) => a.hourly - b.hourly);
    return groups;
  }, [pricing]);

  const ebsOptions = Object.keys(pricing.ebs).sort().map((k) => ({ value: k, label: `${k} (${rate(pricing.ebs[k])}/GB-mo)` }));
  const rdsStorageOptions = Object.keys(pricing.rds.storage).sort().map((k) => ({ value: k, label: `${k} (${rate(pricing.rds.storage[k])}/GB-mo)` }));

  const set = (patch: object) => onChange({ ...resource, params: { ...resource.params, ...patch } } as Resource);

  return (
    <div className="card" data-service={resource.service}>
      <div className="card-head">
        <span className="badge">{resource.service.toUpperCase()}</span>
        <span className="card-title">{SERVICE_LABEL[resource.service]}</span>
        <input
          className="name-input"
          value={resource.name}
          placeholder="name this resource (e.g. Disasters Hub API)…"
          onChange={(e) => onChange({ ...resource, name: e.target.value })}
        />
        <span className="card-subtotal">{money(cost.monthly)}<small>/mo</small></span>
        <button className="icon-btn" title="Remove" onClick={() => onRemove(resource.id)}>✕</button>
      </div>

      <div className="card-body">
        {resource.service === "ec2" && (
          <>
            <Sel label="Instance type" value={resource.params.instanceType}
                 onChange={(v) => set({ instanceType: v })} options={ec2Options} />
            <Num label="Instances" value={resource.params.count} min={1} onChange={(n) => set({ count: n })} />
            <Num label="Hours / month" value={resource.params.hours} min={0} onChange={(n) => set({ hours: n })} suffix="h" hint={HOURS_HINT} />
            <Sel label="EBS volume" value={resource.params.ebsType}
                 onChange={(v) => set({ ebsType: v })} options={ebsOptions} />
            <Num label="EBS size" value={resource.params.ebsGB} min={0} onChange={(n) => set({ ebsGB: n })} suffix="GB" />
          </>
        )}

        {resource.service === "s3" && (
          <>
            <Num label="Storage" value={resource.params.storageGB} min={0} onChange={(n) => set({ storageGB: n })} suffix="GB" />
            <Num label="PUT/POST/LIST reqs" value={resource.params.putCount} min={0} step={1000} onChange={(n) => set({ putCount: n })} />
            <Num label="GET/other reqs" value={resource.params.getCount} min={0} step={1000} onChange={(n) => set({ getCount: n })} />
            <Num label="Data transfer out" value={resource.params.dtoGB} min={0} onChange={(n) => set({ dtoGB: n })} suffix="GB" />
          </>
        )}

        {resource.service === "rds" && (
          <>
            <label className="field">
              <span className="field-label">DB instance</span>
              <select className="field-input" value={resource.params.instanceKey}
                      onChange={(e) => set({ instanceKey: e.target.value })}>
                {Object.keys(rdsByEngine).sort().map((engine) => (
                  <optgroup key={engine} label={engine}>
                    {rdsByEngine[engine].map((o) => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <Num label="Instances" value={resource.params.count} min={1} onChange={(n) => set({ count: n })} />
            <Num label="Hours / month" value={resource.params.hours} min={0} onChange={(n) => set({ hours: n })} suffix="h" hint={HOURS_HINT} />
            <Sel label="Storage type" value={resource.params.storageType}
                 onChange={(v) => set({ storageType: v })} options={rdsStorageOptions} />
            <Num label="Storage size" value={resource.params.storageGB} min={0} onChange={(n) => set({ storageGB: n })} suffix="GB" />
          </>
        )}

        {resource.service === "lambda" && (
          <>
            <Num label="Requests / month" value={resource.params.requests} min={0} step={100000} onChange={(n) => set({ requests: n })} />
            <Num label="Avg duration" value={resource.params.durationMs} min={0} step={10} onChange={(n) => set({ durationMs: n })} suffix="ms" />
            <Num label="Memory" value={resource.params.memoryMB} min={128} step={64} onChange={(n) => set({ memoryMB: n })} suffix="MB" />
          </>
        )}

        {resource.service === "estimate" && (
          <>
            <Sel label="Service" value={resource.params.category}
                 onChange={(v) => set({ category: v })}
                 options={ESTIMATE_CATEGORIES.map((c) => ({ value: c, label: c }))} />
            <Num label="Est. monthly cost" value={resource.params.monthlyUSD} min={0} step={1}
                 onChange={(n) => set({ monthlyUSD: n })} suffix="$/mo"
                 hint="Rough flat figure — added to the total" />
          </>
        )}
      </div>

      <div className="card-foot">
        {cost.breakdown.map((line, i) => (
          <div className="line" key={i}>
            <span className="line-label">{line.label}</span>
            <span className="line-amount">{money(line.amount)}</span>
          </div>
        ))}
        {cost.note && <div className="line-note">ⓘ {cost.note}</div>}
      </div>
    </div>
  );
}
