"""Helper: print a skeleton of documents.json for files that are not in it yet.

    python -I familychronicle/documents_draft.py --config example/site.json > /tmp/draft.json

Scans the directory of the config. People are left empty; a human fills them in.
Folders listed in config `documents_skip_dirs` (default none) are skipped, e.g. the
folder with marked copies.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf"}


def _skip(p: Path, base: Path, skip_dirs) -> bool:
    parts = p.relative_to(base).parts[:-1]
    if any(c in skip_dirs or c.startswith(".") or c.endswith("_files") for c in parts):
        return True
    return p.suffix.lower() not in EXTENSIONS      # html, json, md, docx, css ...


def _id(name: str) -> str:
    t = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")[:60]


def _year(name: str):
    m = re.search(r"(?<!\d)(1[5-9]\d\d|20[0-2]\d)(?!\d)", name)
    return int(m.group(1)) if m else None


def _skeleton(source: str, p: Path, base: Path, marked_dir: str | None, languages) -> dict:
    marked = None
    if marked_dir and (p.parent / marked_dir / p.name).is_file():
        marked = (p.parent / marked_dir / p.name).relative_to(base).as_posix()
    return {"id": _id(p.stem), "source": source, "crop": None, "marked": marked,
            "people": [], "year": _year(p.stem), "description": {l: "" for l in languages},
            "citation": "", "notes": [], "foreign_work": False, "verified": None}


def draft(base_dir, existing: list[dict], skip_dirs=frozenset(), marked_dir: str | None = None,
          languages=("en",)) -> list[dict]:
    """Skeleton entries for image/PDF files under `base_dir` that `existing` does not cover."""
    base = Path(base_dir).resolve()
    have = {d["source"].split("#")[0] for d in existing}
    result, seen = [], set()
    for p in sorted(base.rglob("*")):
        if not p.is_file() or _skip(p, base, set(skip_dirs)):
            continue
        rel = p.relative_to(base).as_posix()
        if rel in have or rel in seen:
            continue
        seen.add(rel)
        result.append(_skeleton(rel + "#0" if p.suffix.lower() == ".pdf" else rel, p, base, marked_dir, languages))
    counts = {}
    for d in result:                               # unique ids
        n = counts.get(d["id"], 0)
        counts[d["id"]] = n + 1
        if n:
            d["id"] += f"-{n + 1}"
    return result


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--config", required=True, help="path to site.json")
    ap.add_argument("--marked-dir", default=None, help="name of the folder with marked copies")
    args = ap.parse_args(argv)
    cfg_path = Path(args.config).resolve()
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    docs_file = cfg_path.parent / cfg.get("documents", "documents.json")
    existing = json.loads(docs_file.read_text(encoding="utf-8")) if docs_file.is_file() else []
    skeleton = draft(cfg_path.parent, existing, set(cfg.get("documents_skip_dirs", [])), args.marked_dir,
                     cfg.get("languages") or ["en"])
    json.dump(skeleton, sys.stdout, ensure_ascii=False, indent=2)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
