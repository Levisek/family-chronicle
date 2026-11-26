"""Write the golden outputs of the Python build that the JS port must match.

Run: .venv/bin/python -I tests/golden/make_golden.py
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import markdown

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
TEXT = {".html", ".json", ".md", ".txt", ".xml"}


def render(text: str) -> str:
    # The same parameters as familychronicle/chronicles.py uses.
    return markdown.markdown(text, extensions=["tables", "footnotes", "sane_lists"],
                             extension_configs={"footnotes": {"UNIQUE_IDS": True, "BACKLINK_TEXT": ""}})


def basemap_golden() -> None:
    """Feature count per layer of basemap.py over app/data/world.js and example/places.json."""
    sys.path.insert(0, str(REPO))
    from familychronicle import basemap
    text = (REPO / "app" / "data" / "world.js").read_text(encoding="utf-8")
    world = json.loads(text[text.index("=") + 1:].strip().rstrip(";"))
    box = basemap.bbox_from_places(REPO / "example" / "places.json", 3)
    counts: dict[str, int] = {}
    for stem, (layer, polygon) in basemap.LAYERS.items():
        fc = {"features": [{"geometry": g} for g in world[layer]]}
        counts[layer] = len(basemap.process_layer(layer, polygon, fc, box))
    (HERE / "basemap-example.json").write_text(json.dumps({"bbox": list(box), "features": counts}, indent=1) + "\n",
                                               encoding="utf-8")


def main() -> int:
    basemap_golden()
    for md in sorted((HERE / "markdown").glob("*.md")):
        md.with_suffix(".html").write_text(render(md.read_text(encoding="utf-8")), encoding="utf-8")
    target = HERE / "example"
    if target.exists():
        shutil.rmtree(target)
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out"
        subprocess.run([sys.executable, "-I", str(REPO / "build.py"), "--config", str(REPO / "example" / "site.json"),
                        "--out", str(out), "--today", "2026-11-23"], check=True)
        for f in sorted(out.rglob("*")):
            if f.is_file() and f.suffix in TEXT:
                dest = target / f.relative_to(out)
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(f, dest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
