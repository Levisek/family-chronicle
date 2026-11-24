"""Document whitelist and export to WebP (without metadata).

A document (scan, photo, PDF page) is published only when none of its linked people
is living, excluded or out of scope. A foreign work is published only as a crop;
`crop_only` does the same for your own sheet that also mentions a living person
(the crop leaves the person out, the whole sheet would not).

All paths in documents.json are relative to the directory of site.json (`base_dir`)
and must stay inside it; documents.json itself may live in a subfolder.
"""
from __future__ import annotations

import hashlib
import io
import json
import re
from pathlib import Path

from PIL import Image, ImageOps

from familychronicle.scope import Scope

DEFAULT_CUTOFF_YEAR = 1950     # default for config `documents_cutoff_year`
CROP_DIR = "crops"             # a file in a folder of this name counts as a crop
COLORS_FILE = "colors.json"    # per-folder colour overrides: {"06": "blue"}
CROP_MAX, CROP_QUALITY = 1400, 80
SHEET_MAX, SHEET_QUALITY = 2600, 75
PDF_ZOOM = 2.2


def _resolve(source: str, base_dir: Path) -> Path:
    """Path of a file without the `#rotation` suffix; it must lie inside `base_dir`."""
    base = Path(base_dir).resolve()
    p = (base / source.split("#")[0]).resolve()
    if not p.is_relative_to(base):
        raise ValueError(f"Path outside the base directory: {source}")
    return p


def load_documents(path, base_dir) -> list[dict]:
    """Read documents.json and validate it. Paths resolve against `base_dir`
    (the directory of site.json), wherever documents.json itself lies."""
    path = Path(path)
    base = Path(base_dir).resolve()
    documents = json.loads(path.read_text(encoding="utf-8"))
    ids = set()
    for d in documents:
        if d["id"] in ids:
            raise ValueError(f"Duplicate document id: {d['id']}")
        ids.add(d["id"])
        for field in ("source", "marked"):
            if d.get(field) and not _resolve(d[field], base).is_file():
                raise ValueError(f"Document {d['id']}: {field} does not exist: {d[field]}")
        extra = set(d.get("main") or []) - set(d.get("people") or [])
        if extra:
            raise ValueError(f"Document {d['id']}: main people are not in `people`: "
                             f"{', '.join(sorted(extra))}")
    return documents


def main_people(d: dict) -> list[str]:
    """People the record is about (the baptised, the couple, the deceased). Without `main`
    all linked people (a household in a census, a marriage record); the others
    are only mentioned in the document."""
    return list(d["main"]) if "main" in d else list(d.get("people") or [])


def _color(d: dict, base_dir: Path) -> str | None:
    """Colour of a crop from `colors.json` next to the source (key = first 2 digits of the file name)."""
    p = _resolve(d["source"], base_dir)
    m = re.match(r"(\d{2})", p.name)
    f = p.parent / COLORS_FILE
    if not m or not f.is_file():
        return None
    return json.loads(f.read_text(encoding="utf-8")).get(m.group(1))


def is_crop(d: dict) -> bool:
    """A crop is an entry with `crop`, or a file in a `crops/` folder."""
    if d.get("crop"):
        return True
    return CROP_DIR in Path(d["source"].split("#")[0]).parts[:-1]


def is_verified(d: dict, base_dir: Path) -> bool:
    if d.get("verified") is not None:
        return bool(d["verified"])
    return _color(d, base_dir) != "blue"


def unverified_label(d: dict, strings: dict) -> str:
    """Label of an unverified document: a foreign work is an "unverified source", not a candidate ancestor."""
    return (strings.get("unverified_source") if d.get("foreign_work") else None) \
        or strings.get("unverified", "")


def decide(documents: list[dict], scope: Scope, base_dir: Path,
           cutoff_year: int = DEFAULT_CUTOFF_YEAR) -> tuple[list[dict], list[tuple[dict, str]]]:
    """(published, withheld with the reason)."""
    published, withheld = [], []
    for d in documents:
        reason = None
        people = d.get("people") or []
        living = [p for p in people if p in scope.living]
        outside = [p for p in people if p not in scope.people]
        if living:
            reason = "linked living person: " + ", ".join(living)
        elif outside:
            reason = "linked person out of scope or excluded: " + ", ".join(outside)
        elif not people and not (d.get("year") is not None and d["year"] < cutoff_year):
            reason = f"no linked person and the year is not before {cutoff_year}"
        elif d.get("foreign_work") and not is_crop(d):
            reason = "foreign work without a crop (whole page)"
        elif _color(d, base_dir) == "gray":
            reason = f"excluded (gray in {COLORS_FILE})"
        (withheld.append((d, reason)) if reason else published.append(d))
    return published, withheld


def load_image(source: str, crop, base_dir: Path) -> Image.Image:
    """Load an image, or a first PDF page (`file.pdf#rotation`), rotate and crop it."""
    path = _resolve(source, base_dir)
    if "#" in source:
        import pymupdf  # PyMuPDF; only needed for PDF sources
        rotation = int(source.split("#")[1])
        page = pymupdf.open(path)[0]
        pix = page.get_pixmap(matrix=pymupdf.Matrix(PDF_ZOOM, PDF_ZOOM))
        im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples).rotate(rotation, expand=True)
    else:
        im = ImageOps.exif_transpose(Image.open(path))
        im = _flatten(im)
    if crop:
        im = im.crop(tuple(crop))
    return im


def _flatten(im: Image.Image) -> Image.Image:
    """RGB; transparency goes onto white, not black."""
    if im.mode in ("RGBA", "LA", "PA") or "transparency" in im.info:
        im = im.convert("RGBA")
        im = Image.alpha_composite(Image.new("RGBA", im.size, (255, 255, 255, 255)), im)
    return im.convert("RGB")


def _shrink(im: Image.Image, size: int) -> Image.Image:
    im = _flatten(im)
    im.thumbnail((size, size), Image.LANCZOS)
    return im


def _save(im: Image.Image, name: str, quality: int, dest: Path) -> str:
    """Save as WebP without EXIF/ICC/XMP; returns the relative path with a content hash."""
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=quality, method=6)
    data = buf.getvalue()
    rel = f"documents/{name.format(h=hashlib.sha256(data).hexdigest()[:8])}.webp"
    (dest / "documents").mkdir(parents=True, exist_ok=True)
    (dest / rel).write_bytes(data)
    return rel


def export(document: dict, dest: Path, base_dir: Path) -> dict:
    """Write the crop (and the whole sheet unless it is a foreign work or `crop_only`)
    to `dest/documents/`. Returns {"crop", "sheet", "width", "height"}; paths are relative to `dest`."""
    dest = Path(dest)
    if document.get("foreign_work") and not is_crop(document):
        raise ValueError(f"Document {document['id']}: a foreign work without a crop cannot be exported")
    for field in ("source", "marked"):
        if document.get(field):
            _resolve(document[field], base_dir)  # must lie inside base_dir
    crop = tuple(document["crop"]) if document.get("crop") else None
    cropped = _shrink(load_image(document["source"], crop, base_dir), CROP_MAX)
    ident = document["id"]
    result = {"crop": _save(cropped, ident + "-{h}", CROP_QUALITY, dest), "sheet": None,
              "width": cropped.width, "height": cropped.height}
    if not document.get("foreign_work") and not document.get("crop_only"):
        sheet = _shrink(load_image(document.get("marked") or document["source"], None, base_dir),
                        SHEET_MAX)
        result["sheet"] = _save(sheet, ident + "-sheet-{h}", SHEET_QUALITY, dest)
    return result


def document_for_image(documents: list[dict], source: str, crop) -> dict | None:
    """Match a book image (same source and crop) to a document."""
    crop = tuple(crop) if crop else None
    for d in documents:
        if d["source"] == source and (tuple(d["crop"]) if d.get("crop") else None) == crop:
            return d
    return None


def image_document(published: list[dict], source: str, crop) -> dict | None:
    """The published document that lets the book typeset `source` (with `crop`), or None.
    An exact match (same source and crop) always counts. Another crop of the same source is
    allowed only when the whole sheet is published, i.e. not for a foreign work or `crop_only`."""
    exact = document_for_image(published, source, crop)
    if exact:
        return exact
    return next((d for d in published if d["source"] == source
                 and not d.get("foreign_work") and not d.get("crop_only")), None)
