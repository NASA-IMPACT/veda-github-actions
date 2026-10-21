#!/usr/bin/env python3
"""Snapshot what the live-portal preview needs from a Disasters Portal checkout.

The Submit form's live preview renders the event page the way the portal will — including the
REAL data-gallery cards the generated page points at (data/algorithms.json `portalData`). Those
cards live in the portal repo, and this app never fetches at run time, so their text and a
downsized thumbnail are copied in here:

    data/portal-cards.json            {"DATA__X": {title, description, themes, categories, image}}
    public/portal/cards/<slug>.jpg    thumbnails, downsized to 480px with macOS `sips` (else copied)
    public/portal/template-hero.webp  the portal's placeholder hero (every generated page uses it)
    public/portal/disasters-logo.svg  the header logo

Re-run when the portal's cards change or a new `portalData` mapping is added:
    git clone --depth 1 -b develop https://github.com/Disasters-Learning-Portal/disasters-portal.git /tmp/portal
    python3 -I algorithm-catalog/scripts/sync_portal_cards.py /tmp/portal

stdlib only. Reads the portal's TypeScript with regexes — only the plain string-literal fields.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # algorithm-catalog/
OUT_JSON = ROOT / "data" / "portal-cards.json"
OUT_PUBLIC = ROOT / "public" / "portal"

_STR = r'"((?:[^"\\]|\\.)*)"'


def field(src: str, name: str) -> str:
    m = re.search(rf"\b{name}:\s*{_STR}", src)
    return json.loads(f'"{m.group(1)}"') if m else ""


def array(src: str, name: str) -> list[str]:
    m = re.search(rf"\b{name}:\s*\[(.*?)\]", src, re.S)
    return [json.loads(f'"{s}"') for s in re.findall(_STR, m.group(1))] if m else []


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print(__doc__)
        return 2
    portal = Path(argv[0]).resolve()
    algorithms = json.loads((ROOT / "data" / "algorithms.json").read_text())
    wanted = sorted({p["portalData"] for a in algorithms for p in a["products"] if p.get("portalData")})

    (OUT_PUBLIC / "cards").mkdir(parents=True, exist_ok=True)
    have_sips = shutil.which("sips") is not None
    cards: dict[str, dict] = {}
    for const in wanted:
        slug = const.removeprefix("DATA__").lower().replace("_", "-")
        path = next((p for p in (portal / f"app/site-config/data/data__{slug}{x}" for x in (".ts", ".tsx")) if p.exists()), None)
        if path is None:
            print(f"MISSING  {const}: no app/site-config/data/data__{slug}.ts(x) in the portal")
            continue
        src = path.read_text()
        thumb = re.search(r"thumbnailImage:\s*\{\s*src:\s*" + _STR, src)
        image = ""
        if thumb:
            source = portal / "public" / thumb.group(1).lstrip("/")
            dest = OUT_PUBLIC / "cards" / f"{slug}.jpg"
            if have_sips:
                subprocess.run(["sips", "-Z", "480", "-s", "format", "jpeg", "-s", "formatOptions", "70",
                                str(source), "--out", str(dest)], check=True, capture_output=True)
            else:
                dest = dest.with_suffix(source.suffix)
                shutil.copyfile(source, dest)
            image = f"/portal/cards/{dest.name}"
        cards[const] = {
            "title": field(src, "title"),
            "description": field(src, "description"),
            "themes": array(src, "themes"),
            "categories": array(src, "categories"),
            "image": image,
        }
        print(f"ok       {const}: {cards[const]['title']}")

    for name, rel in (("template-hero.webp", "img/event/template-hero.webp"), ("disasters-logo.svg", "img/disasters-logo.svg")):
        shutil.copyfile(portal / "public" / rel, OUT_PUBLIC / name)
    OUT_JSON.write_text(json.dumps(cards, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    size = sum(f.stat().st_size for f in OUT_PUBLIC.rglob("*") if f.is_file())
    print(f"\nwrote data/portal-cards.json ({len(cards)} cards) and public/portal/ ({size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
