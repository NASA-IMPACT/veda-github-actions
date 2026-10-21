#!/usr/bin/env python3
"""Fill each product's STAC names in data/algorithms.json FROM THE LIVE DISASTERS STAC — never by hand.

    stacAsset        the product-specific asset key on the live items, e.g. "truecolor", "colorir",
                     "backscatter", "blackmarble_hd" — the asset whose roles include "data"
    stacCollections  every live collection carrying it, e.g. ["sentinel2-truecolor-daily",
                     "sentinel2-truecolor-subdaily"]

These two fields are GENERATED. Nobody types them and the app offers no way to edit them; re-run this
script instead. `cog_default` (the collections' generic item_assets entry) and the
`rendered_preview_*` / dashboard renders are NOT asset names and are never used.

Which collection belongs to which product is decided by rule, and an unsure match is reported,
never guessed. A product CLAIMS a collection when:
  * its sensor (the id's first segment, e.g. "sentinel2", "umbra") is the product's algorithm id
    [strong] or appears in the product's portal card title [weak], and
  * its live asset key equals the product's token or output folder [strong], or appears in the
    product's portal card title [weak] — that is how "Umbra Backscatter" finds `backscatter` and
    "Black Marble HD" finds `blackmarble_hd`;
  * or, regardless of sensor, the asset key equals the product's token/folder AND no other live
    collection uses that key (an exact, unique name cannot be ambiguous: `burnseverity`).
A product with any strong-sensor claim drops its weak-sensor ones: SkySat's card says "Planet", but
SkySat has its own skysat-* collections, so it must not also take planet-colorir-daily.
Each collection goes to its single highest-scoring claimant (strong = 2, weak = 1). A tie at the
top is assigned to nobody and listed for a human — so "Planet NDVI Change" mentioning NDVI never
steals `planet-ndvi-daily` from Planet NDVI, but two equally good claims are never guessed.

Run (needs network; stdlib only):
    python3 -I algorithm-catalog/scripts/sync_stac_assets.py            # update algorithms.json
    python3 -I algorithm-catalog/scripts/sync_stac_assets.py --check    # exit 1 if it is stale
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # algorithm-catalog/
ALGORITHMS = ROOT / "data" / "algorithms.json"
CARDS = ROOT / "data" / "portal-cards.json"
DEFAULT_API = "https://disasters.openveda.cloud/api/stac"
CADENCE = re.compile(r"-(daily|subdaily|composite)$")

norm = lambda s: re.sub(r"[^a-z0-9]", "", (s or "").lower())  # noqa: E731


def get(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


def live_assets(api: str) -> dict[str, str]:
    """{collection id: its product-specific asset key}, read off a real item of each collection."""
    ids = [c["id"] for c in get(f"{api}/collections?limit=1000")["collections"]]

    def one(cid: str) -> tuple[str, str | None]:
        feats = get(f"{api}/collections/{cid}/items?limit=1").get("features") or []
        if not feats:
            return cid, None
        keys = [k for k, a in feats[0].get("assets", {}).items() if "data" in (a.get("roles") or []) and k != "cog_default"]
        return cid, keys[0] if len(keys) == 1 else None

    with ThreadPoolExecutor(max_workers=8) as pool:
        return {cid: key for cid, key in pool.map(one, ids) if key}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--api", default=DEFAULT_API, help=f"STAC API root (default {DEFAULT_API})")
    ap.add_argument("--check", action="store_true", help="report only; exit 1 if algorithms.json is stale")
    args = ap.parse_args(argv)

    text = ALGORITHMS.read_text()
    algorithms = json.loads(text)
    cards = json.loads(CARDS.read_text()) if CARDS.exists() else {}
    assets = live_assets(args.api)
    print(f"{len(assets)} live collections with a product-specific asset ({args.api})")

    key_uses: dict[str, int] = {}
    for key in assets.values():
        key_uses[norm(key)] = key_uses.get(norm(key), 0) + 1

    claims: dict[str, list[tuple[int, dict, dict]]] = {}
    for a in algorithms:
        for p in a["products"]:
            title = norm(cards.get(p.get("portalData", ""), {}).get("title", ""))
            names = {norm(p["id"]), norm(p.get("folder", ""))}
            mine: list[tuple[str, int, int]] = []  # (collection, sensor score, total score)
            for cid, key in assets.items():
                sensor = norm(cid.split("-")[0])
                k = norm(key)
                sensor_score = 2 if sensor == norm(a["id"]) else 1 if sensor in title else 0
                name_score = 2 if k in names else 1 if (title and k in title) else 0
                if sensor_score and name_score:
                    mine.append((cid, sensor_score, sensor_score + name_score))
                elif name_score == 2 and key_uses[k] == 1:
                    mine.append((cid, 0, 2))
            strong_sensor = any(ss == 2 for _, ss, _ in mine)
            for cid, ss, score in mine:
                if strong_sensor and ss == 1:
                    continue  # a sensor only named in the card title, when the product has its own
                claims.setdefault(cid, []).append((score, a, p))

    found: dict[int, set[str]] = {}
    ambiguous = []
    for cid, who in sorted(claims.items()):
        top = max(score for score, _, _ in who)
        best = [(a, p) for score, a, p in who if score == top]
        if len(best) > 1:
            ambiguous.append(f"{cid} ({assets[cid]}) — equally claimed by {', '.join(f'{a['id']}:{p['id']}' for a, p in best)}")
            continue
        found.setdefault(id(best[0][1]), set()).add(cid)

    changes = []
    for a in algorithms:
        for p in a["products"]:
            cols = sorted(found.get(id(p), set()))
            keys = sorted({assets[c] for c in cols})
            if len(keys) > 1:
                ambiguous.append(f"{a['id']}:{p['id']} — its collections disagree on the asset key: {keys}")
                cols, keys = [], []
            before = (p.get("stacAsset"), p.get("stacCollections"))
            p.pop("stacAsset", None)
            p.pop("stacCollections", None)
            if keys:
                p["stacAsset"] = keys[0]
                p["stacCollections"] = cols
            after = (p.get("stacAsset"), p.get("stacCollections"))
            if before != after:
                changes.append(f"{a['id']}:{p['id']}: {before[0] or '—'} -> {after[0] or '—'} {after[1] or ''}")

    linked = {c for cs in found.values() for c in cs}
    print(f"{sum(1 for a in algorithms for p in a['products'] if p.get('stacAsset'))} products linked to live STAC")
    for c in changes:
        print(f"  change  {c}")
    for x in ambiguous:
        print(f"  UNSURE  {x}")
    unclaimed = sorted(c for c in assets if c not in linked and c not in claims)
    print(f"  {len(unclaimed)} live collections match no catalog product: {', '.join(unclaimed)}")

    if args.check:
        return 1 if changes else 0
    out = json.dumps(algorithms, indent=2, ensure_ascii=False) + "\n"
    if out != text:
        ALGORITHMS.write_text(out, encoding="utf-8")
        print("wrote data/algorithms.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
