// What the event's page on science.data.nasa.gov will say, laid out in the portal's own section
// order. Read-only: the text is edited in the Submit form (Events → "Edit page"), and this same
// component previews it live there, so what you type is what the web team receives.

import type { Algorithm, Hazard } from "../types";
import { modality as modalityStyle } from "../colors";
import { pageView, portalDate, type PageEvent } from "../pageExport";

interface Props {
  event: PageEvent;
  algorithms: Algorithm[];
  hazards: Hazard[];
}

export default function EventPage({ event, algorithms, hazards }: Props) {
  const v = pageView(event, algorithms, hazards);
  const missing = <span className="page-missing">not set</span>;

  return (
    <article className="page-preview" aria-label="Event page preview">
      <header className="page-hero">
        <div className="page-kicker">Event</div>
        <h1 className="page-title">{v.title || missing}</h1>
        {v.subtitle && <p className="page-sub">{v.subtitle}</p>}
      </header>

      <dl className="page-meta">
        <dt>Type</dt>
        <dd>{v.type}</dd>
        <dt>Need</dt>
        <dd>{v.needs.join(", ") || missing}</dd>
        <dt>Hazard</dt>
        <dd>{v.hazards.join(", ") || missing}</dd>
        <dt>Region</dt>
        <dd>{v.region.join("; ") || missing}</dd>
        <dt>Start Date</dt>
        <dd>{v.startDate ? portalDate(v.startDate) : missing}</dd>
      </dl>
      {v.govLink && (
        <p className="page-gov">
          What the U.S. government is doing{" "}
          <a href={v.govLink} target="_blank" rel="noreferrer">
            Learn more ↗
          </a>
        </p>
      )}

      <section>
        <h2 className="page-h">Overview</h2>
        {v.paragraphs.length > 0 ? (
          v.paragraphs.map((p, i) => <p key={i}>{p}</p>)
        ) : (
          <p className="page-missing">No intro written yet — the Overview section will be empty.</p>
        )}
      </section>

      <section>
        <h2 className="page-h">
          Event Data Gallery <span className="count">({v.gallery.length})</span>
        </h2>
        <div className="page-gallery">
          {v.gallery.map((g, i) => {
            const m = g.modality ? modalityStyle(g.modality) : null;
            return (
              <div
                key={i}
                className={g.inCatalog ? "page-card" : "page-card ext"}
                style={m ? { borderTopColor: m.color } : undefined}
                title={g.inCatalog ? undefined : "No algorithm in this catalog produces this layer"}
              >
                {m && <span aria-hidden>{m.icon} </span>}
                {g.title}
              </div>
            );
          })}
          {v.gallery.length === 0 && <span className="opt">No layers recorded.</span>}
        </div>
      </section>
    </article>
  );
}
