// The event page as it will look ON THE DISASTERS PORTAL (science.data.nasa.gov/disasters) — the
// portal's own header, hero masthead, sidebar and Event Data Gallery, with its fonts, colors and
// proportions (measured off the live California page), at the portal's 1280px desktop width.
// <PortalFrame> scales that to whatever space it is given, so it reads like a screenshot of the
// real site rather than a reflowed approximation.
//
// Everything shown is what the generated portal file (src/portal.ts) will produce: the masthead
// description is the sub-title, the tags are its theme ids and CONTENT_CATEGORIES, and the gallery
// is the REAL portal cards the file imports — snapshotted into data/portal-cards.json by
// scripts/sync_portal_cards.py, since this app never fetches at run time.

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import "../portal.css";
import type { Algorithm, Hazard, PageImage } from "../types";
import { driveFileId } from "../rules";
import { NEED_LABELS, PORTAL_PLACEHOLDER_IMAGE, typographic, type PortalInput } from "../portal";
import { portalDate } from "../pageExport";
import cardsRaw from "../../data/portal-cards.json";

interface PortalCard {
  title: string;
  description: string;
  themes: string[];
  categories: string[];
  image: string;
}
const CARDS = cardsRaw as Record<string, PortalCard>;

/** The portal's card tag row: themes, then categories, then the content type — 5 shown. */
const MAX_TAGS = 5;
const tagLabel = (t: string) => (NEED_LABELS[t as keyof typeof NEED_LABELS] ?? t).toUpperCase();

const today = () => new Date().toISOString().slice(0, 10);

// Our copy of the portal's placeholder hero; the generated file points at the portal's own.
const HERO = `/portal/${PORTAL_PLACEHOLDER_IMAGE.split("/").pop()}`;

/** The cards the generated page will show (in order), and the layers that have none on the portal. */
export function portalGallery(ev: PortalInput, algorithms: Algorithm[]) {
  const cards: PortalCard[] = [];
  const seen = new Set<string>();
  const unmapped: string[] = [];
  for (const l of ev.layers) {
    const a = algorithms.find((x) => x.id === l.algorithm);
    const p = a?.products.find((x) => x.id === l.product);
    const card = p?.portalData ? CARDS[p.portalData] : undefined;
    if (p?.portalData && card) {
      if (!seen.has(p.portalData)) cards.push(card);
      seen.add(p.portalData);
    } else {
      unmapped.push(a && p ? `${a.title} ${p.label}` : `${l.algorithm} ${l.product}`);
    }
  }
  return { cards, unmapped };
}

function Tags({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="pp-tags">
      {items.slice(0, MAX_TAGS).map((t) => (
        <span key={t} className="pp-tag">
          {tagLabel(t)}
        </span>
      ))}
      {items.length > MAX_TAGS && <span className="pp-more">+ {items.length - MAX_TAGS} more ...</span>}
    </div>
  );
}

/**
 * A Drive file as an <img>, via Drive's thumbnail endpoint (works for "Anyone with the link"
 * files). A file that is not shared fails to load — say so plainly instead of a broken icon.
 */
function DriveImage({ image, className, width = 1600 }: { image: PageImage; className?: string; width?: number }) {
  const id = driveFileId(image.url);
  const [failed, setFailed] = useState(false);
  if (!id || failed) {
    return (
      // `<class>-missing`, not `<class>`: a failed hero must not cover the masthead like the image would.
      <div className={`pp-img-missing${className ? ` ${className}-missing` : ""}`}>
        {id ? "Can't load this image from Google Drive — set its sharing to “Anyone with the link”." : "Not a Google Drive file link."}
      </div>
    );
  }
  return (
    <img
      className={className}
      src={`https://drive.google.com/thumbnail?id=${id}&sz=w${width}`}
      alt={image.alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

const Arrow = () => (
  <span className="pp-arrow" aria-hidden>
    →
  </span>
);

interface Props {
  event: PortalInput;
  algorithms: Algorithm[];
  hazards: Hazard[];
  /** The page's datePublished; defaults to today, as the generator does. */
  published?: string;
}

export default function PortalPage({ event: ev, algorithms, hazards, published }: Props) {
  const page = ev.page;
  const { cards } = portalGallery(ev, algorithms);
  const categories = [...new Set(ev.hazards.map((h) => hazards.find((v) => v.id === h)?.portal).filter(Boolean))] as string[];
  const region = page?.region?.trim() || ev.locations.join("; ");
  const hero = page?.images?.find((i) => i.placement === "hero" && i.url.trim());
  const figures = (page?.images ?? []).filter((i) => i.placement === "overview" && i.url.trim());
  const paragraphs = (page?.intro ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div className="pp">
      <header className="pp-nav">
        <div className="pp-brand">
          <img src="/portal/disasters-logo.svg" alt="" width={46} height={38} />
          <span>
            <b>DISASTERS</b>
            <br />
            PROGRAM
          </span>
        </div>
        <nav className="pp-menu" aria-hidden>
          <span>About Us</span>
          <span>Explore By Need ⌄</span>
          <span>Explore Data ⌄</span>
          <span>Resources &amp; Learning ⌄</span>
        </nav>
      </header>

      <section className="pp-hero" style={{ backgroundImage: `url(${HERO})` }}>
        {hero && <DriveImage key={hero.url} image={hero} className="pp-hero-img" width={2000} />}
        <div className="pp-hero-text">
          <h1 className={ev.name ? "" : "pp-placeholder"}>{ev.name ? typographic(ev.name) : "Activation event name"}</h1>
          {page?.subtitle?.trim() ? (
            <p>{typographic(page.subtitle.trim())}</p>
          ) : (
            <p className="pp-placeholder">Your sub-title appears here, under the title.</p>
          )}
          <div className="pp-published">PUBLISHED: {portalDate(published ?? today()).toUpperCase()}</div>
        </div>
      </section>

      <div className="pp-body">
        <aside className="pp-side">
          <div className="pp-label">On this page</div>
          <ul className="pp-toc">
            <li>Overview</li>
            {cards.length > 0 && <li>Event Data Gallery</li>}
          </ul>

          <dl className="pp-meta">
            <div>
              <dt>Type</dt>
              <dd>
                <Tags items={["event"]} />
              </dd>
            </div>
            {page?.needs?.length ? (
              <div>
                <dt>Need</dt>
                <dd>
                  <Tags items={page.needs} />
                </dd>
              </div>
            ) : null}
            {categories.length > 0 && (
              <div>
                <dt>Hazard</dt>
                <dd>
                  <Tags items={categories} />
                </dd>
              </div>
            )}
            <div>
              <dt>Region</dt>
              <dd className="pp-strong">{region ? typographic(region) : <span className="pp-placeholder">Your locations</span>}</dd>
            </div>
            <div>
              <dt>Start Date</dt>
              <dd className="pp-strong">{ev.start ? portalDate(ev.start) : <span className="pp-placeholder">—</span>}</dd>
            </div>
          </dl>
        </aside>

        <main className="pp-main">
          {page?.govLink?.trim() && (
            <div className="pp-gov">
              <div className="pp-label">What the U.S. government is doing</div>
              <span className="pp-learn">Learn more ↗</span>
            </div>
          )}

          <h2>Overview</h2>
          {paragraphs.length > 0 ? (
            paragraphs.map((p, i) => <p key={i}>{typographic(p)}</p>)
          ) : (
            <p className="pp-placeholder">Your intro paragraph appears here. Leave a blank line between paragraphs.</p>
          )}
          {figures.map((img, i) => (
            <figure key={`${i}-${img.url}`} className="pp-figure">
              <DriveImage image={img} />
              {img.caption && <figcaption>{typographic(img.caption)}</figcaption>}
            </figure>
          ))}

          {cards.length > 0 && (
            <>
              <div className="pp-gallery-head">
                <h2>Event Data Gallery</h2>
                <span className="pp-viewall">
                  View all <Arrow />
                </span>
              </div>
              {cards.map((c) => (
                <article key={c.title} className="pp-card">
                  <img src={c.image} alt="" loading="lazy" />
                  <div>
                    <h3>{c.title}</h3>
                    <p>{c.description}</p>
                    <Tags items={[...c.themes, ...c.categories, "data"]} />
                    <span className="pp-viewdata">
                      View Data <Arrow />
                    </span>
                  </div>
                </article>
              ))}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

/**
 * Renders `children` at the portal's desktop width and scales it down to fit this box, so the
 * preview keeps the real site's proportions. A transform does not change layout size, so the
 * outer height is set from the unscaled height × scale.
 */
export function PortalFrame({ children, width = 1280 }: { children: ReactNode; width?: number }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 0.5, height: 0 });

  useLayoutEffect(() => {
    const measure = () => {
      if (!outer.current || !inner.current) return;
      const scale = outer.current.clientWidth / width;
      setFit({ scale, height: inner.current.offsetHeight * scale });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (outer.current) ro.observe(outer.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div ref={outer} className="pp-frame" style={{ height: fit.height }}>
      <div ref={inner} className="pp-scale" style={{ width, transform: `scale(${fit.scale})` }}>
        {children}
      </div>
    </div>
  );
}
