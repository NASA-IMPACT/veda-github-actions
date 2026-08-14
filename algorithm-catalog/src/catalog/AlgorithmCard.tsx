import { useState } from "react";
import type { Algorithm, Hazard, Product } from "../types";
import { hazardColor, hazardIcon, hazardLabel, modality as modalityStyle } from "../colors";

interface Props {
  algorithm: Algorithm;
  /** Products that satisfied the active facets — the chips explaining WHY this card is here. */
  matched: Product[];
  hazards: Hazard[];
  /** The hazards the user actually selected, when that facet is narrowing. Sorted to the front. */
  focusHazards?: Set<string>;
  /** True when the selected activation event actually used this algorithm. */
  used?: boolean;
  onOpen: () => void;
}

const MAX_CHIPS = 6;
/** Landsat and Sentinel-2 are suited to all 10 hazards; the whole list would swamp the card. */
const MAX_HAZARDS = 4;

export default function AlgorithmCard({
  algorithm: a,
  matched,
  hazards,
  focusHazards,
  used,
  onOpen,
}: Props) {
  // public/thumbs/*.png are illustrative and may simply not be there yet. A broken-image icon is
  // the worst possible answer, so the first error swaps in a flat modality-colored block.
  const [thumbBroken, setThumbBroken] = useState(false);
  const m = modalityStyle(a.modality);
  const extra = matched.length - MAX_CHIPS;

  // Hazards this card can speak to, deduped across its matched products — the quickest read of
  // "why would I deploy this?". When a hazard facet is narrowing, the hazards the user actually
  // asked for sort to the front (Array#sort is stable, so everything else keeps catalog order),
  // otherwise the truncation could hide the very hazard that produced the match.
  const cardHazards = [...new Set(matched.flatMap((p) => p.hazards))];
  const ordered = focusHazards
    ? [...cardHazards].sort((x, y) => Number(focusHazards.has(y)) - Number(focusHazards.has(x)))
    : cardHazards;
  const shownHazards = ordered.slice(0, MAX_HAZARDS);
  const moreHazards = ordered.length - shownHazards.length;

  return (
    <button className="acard" style={{ borderLeftColor: m.color }} onClick={onOpen}>
      <div className="acard-thumb-wrap">
        {thumbBroken || !a.thumb ? (
          <div
            className="acard-thumb acard-thumb-fallback"
            style={{ background: m.tint, color: m.ink }}
            aria-hidden
          >
            {m.icon}
          </div>
        ) : (
          <img
            className="acard-thumb"
            src={a.thumb}
            alt=""
            loading="lazy"
            onError={() => setThumbBroken(true)}
          />
        )}
        {used && <span className="used-flag acard-used">used here</span>}
      </div>

      <div className="acard-body">
        <div className="acard-top">
          <h3 className="acard-title">{a.title}</h3>
          <span className="mbadge" style={{ background: m.tint, color: m.ink }}>
            <span aria-hidden>{m.icon}</span> {m.label}
          </span>
          {a.status === "prototype" && (
            <span className="proto-badge" title="Code exists upstream but no DPS algorithm is registered">
              prototype
            </span>
          )}
        </div>

        <p className="acard-vendor">{a.vendor}</p>

        {/* Clamped to 3 lines so cards stay even height — the full text is in AlgorithmDetail. */}
        <p className="acard-desc" title={a.description}>
          {a.description}
        </p>

        <dl className="acard-facts">
          <div>
            <dt>Resolution</dt>
            <dd>{a.resolution}</dd>
          </div>
          <div>
            <dt>Data from</dt>
            {/* "~" flags a mission-launch date standing in for a real record start. */}
            <dd>
              {a.temporalStartApprox ? "~" : ""}
              {a.temporalStart}
            </dd>
          </div>
        </dl>

        {shownHazards.length > 0 && (
          <div className="acard-group">
            <span className="acard-group-label">Suited to</span>
            <div className="acard-hazards">
              {shownHazards.map((h) => {
                const label = hazardLabel(h, hazards);
                return (
                  <span
                    key={h}
                    className="hchip"
                    style={{ background: hazardColor(h, hazards) }}
                    title={label}
                    aria-label={label}
                  >
                    <span aria-hidden>{hazardIcon(h, hazards)}</span> {label}
                  </span>
                );
              })}
              {moreHazards > 0 && (
                <span
                  className="hchip more"
                  title={ordered.slice(MAX_HAZARDS).map((h) => hazardLabel(h, hazards)).join(", ")}
                >
                  +{moreHazards} more
                </span>
              )}
            </div>
          </div>
        )}

        <div className="acard-group">
          <span className="acard-group-label">Products</span>
          <div className="acard-chips">
            {matched.slice(0, MAX_CHIPS).map((p) => (
              <span key={p.id} className="pchip">
                {p.label}
              </span>
            ))}
            {extra > 0 && <span className="pchip more">+{extra} more</span>}
            {matched.length === 0 && <span className="pchip none">no matching product</span>}
          </div>
        </div>
      </div>
    </button>
  );
}
