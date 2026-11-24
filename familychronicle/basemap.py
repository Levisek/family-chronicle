"""Map basemap: Natural Earth 50m (public domain) cropped to the area of your places.

    python -I familychronicle/basemap.py --config example/site.json
    python -I familychronicle/basemap.py --places example/places.json --margin 3
    python -I familychronicle/basemap.py --bbox 5,36,38,55 --output basemap.geojson

Downloads the layers from github.com/nvkelso/natural-earth-vector (or reads them
from --source-dir), crops them to the bounding box, rounds to 3 decimals and writes
one GeoJSON file. Feature properties are dropped except `layer`.
"""
from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/{}.geojson"
LAYERS = {  # file stem -> (layer name, is polygon)
    "ne_50m_land": ("land", True),
    "ne_50m_lakes": ("lakes", True),
    "ne_50m_admin_0_boundary_lines_land": ("borders", False),
    "ne_50m_rivers_lake_centerlines": ("rivers", False),
}
DEFAULT_NAME = "basemap.geojson"

Bbox = tuple[float, float, float, float]    # lon0, lon1, lat0, lat1


def parse_bbox(text: str) -> Bbox:
    """"lon0,lon1,lat0,lat1" -> tuple; ValueError when malformed or inverted."""
    try:
        lon0, lon1, lat0, lat1 = (float(x) for x in text.split(","))
    except ValueError:
        raise ValueError(f"bbox must be four numbers lon0,lon1,lat0,lat1 (got {text!r})") from None
    if lon0 >= lon1 or lat0 >= lat1:
        raise ValueError(f"bbox is empty or inverted: {text!r}")
    return (lon0, lon1, lat0, lat1)


def bbox_from_places(path: Path, margin: float) -> Bbox:
    """Bounding box of all place coordinates, widened by `margin` degrees on each side."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    coords = [e["coords"] for e in data.values() if e.get("coords")]
    if not coords:
        raise ValueError(f"{path}: no places with coords")
    lats = [c[0] for c in coords]
    lons = [c[1] for c in coords]
    return (max(min(lons) - margin, -180.0), min(max(lons) + margin, 180.0),
            max(min(lats) - margin, -90.0), min(max(lats) + margin, 90.0))


def _edge(p, q, axis: int, value: float):
    """Intersection of segment pq with a clip edge (axis 0 = lon, 1 = lat)."""
    t = (value - p[axis]) / (q[axis] - p[axis])
    r = [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]
    r[axis] = value
    return r


def clip_ring(ring: list, box: Bbox) -> list:
    """Sutherland-Hodgman against the rectangle."""
    lon0, lon1, lat0, lat1 = box
    out = [list(b[:2]) for b in ring]
    for axis, value, inside in ((0, lon0, lambda v: v >= lon0), (0, lon1, lambda v: v <= lon1),
                                (1, lat0, lambda v: v >= lat0), (1, lat1, lambda v: v <= lat1)):
        src, out = out, []
        for i, b in enumerate(src):
            a = src[i - 1]
            if inside(b[axis]):
                if not inside(a[axis]):
                    out.append(_edge(a, b, axis, value))
                out.append(b)
            elif inside(a[axis]):
                out.append(_edge(a, b, axis, value))
        if not out:
            return []
    return out


def clip_line(line: list, box: Bbox) -> list[list]:
    """Split a polyline into the pieces inside the rectangle (Liang-Barsky per segment)."""
    lon0, lon1, lat0, lat1 = box
    pieces: list[list] = []
    cur: list = []
    for a, b in zip(line, line[1:]):
        t0, t1 = 0.0, 1.0
        dx, dy = b[0] - a[0], b[1] - a[1]
        ok = True
        for p, q in ((-dx, a[0] - lon0), (dx, lon1 - a[0]), (-dy, a[1] - lat0), (dy, lat1 - a[1])):
            if p == 0:
                if q < 0:
                    ok = False
                    break
            else:
                r = q / p
                if p < 0:
                    t0 = max(t0, r)
                else:
                    t1 = min(t1, r)
        if not ok or t0 > t1:
            if len(cur) > 1:
                pieces.append(cur)
            cur = []
            continue
        p0 = [a[0] + t0 * dx, a[1] + t0 * dy]
        p1 = [a[0] + t1 * dx, a[1] + t1 * dy]
        if not cur or t0 > 0:
            if len(cur) > 1:
                pieces.append(cur)
            cur = [p0]
        cur.append(p1)
        if t1 < 1:
            pieces.append(cur)
            cur = []
    if len(cur) > 1:
        pieces.append(cur)
    return pieces


def _round(points: list) -> list:
    out: list = []
    for b in points:
        r = [round(b[0], 3), round(b[1], 3)]
        if not out or r != out[-1]:
            out.append(r)
    return out


def _area(p: list) -> float:
    return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(p, p[1:] + p[:1]))) / 2


def process_layer(layer: str, polygon: bool, geojson: dict, box: Bbox) -> list[dict]:
    features = []
    for f in geojson["features"]:
        g = f["geometry"]
        if not g:
            continue
        if polygon:
            many = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
            polygons = []
            for poly in many:
                rings = []
                for i, ring in enumerate(poly):
                    r = _round(clip_ring(ring, box))
                    if len(r) >= 3 and _area(r) > 0.0005:
                        rings.append(r + [r[0]])
                    elif i == 0:
                        break      # the outer ring vanished: drop the whole polygon
                else:
                    if rings:
                        polygons.append(rings)
            if polygons:
                features.append({"type": "Feature", "properties": {"layer": layer},
                                 "geometry": {"type": "MultiPolygon", "coordinates": polygons}})
        else:
            many = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
            pieces = [k for line in many for k in map(_round, clip_line(line, box)) if len(k) > 1]
            if pieces:
                features.append({"type": "Feature", "properties": {"layer": layer},
                                 "geometry": {"type": "MultiLineString", "coordinates": pieces}})
    return features


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Crop Natural Earth to a GeoJSON basemap.")
    ap.add_argument("--bbox", help="lon0,lon1,lat0,lat1")
    ap.add_argument("--places", type=Path, help="places.json: bbox from the places")
    ap.add_argument("--margin", type=float, default=3.0, help="degrees around the places (default 3)")
    ap.add_argument("--config", type=Path, help="site.json: places file and `basemap` output from it")
    ap.add_argument("--output", type=Path, help=f"default: {DEFAULT_NAME} next to the config/places file")
    ap.add_argument("--source-dir", type=Path, help="already downloaded *.geojson (else downloaded)")
    a = ap.parse_args(argv)

    places, output = a.places, a.output
    if a.config:
        base = a.config.resolve().parent       # paths in site.json are relative to it
        cfg = json.loads(a.config.read_text(encoding="utf-8"))
        places = places or (base / cfg["places"]).resolve()
        output = output or (base / cfg.get("basemap", DEFAULT_NAME)).resolve()
    if a.bbox:
        box = parse_bbox(a.bbox)
    elif places:
        box = bbox_from_places(places, a.margin)
    else:
        ap.error("give --bbox, --places or --config")
    if output is None:
        output = (places.parent if places else Path.cwd()) / DEFAULT_NAME

    features: list[dict] = []
    for stem, (layer, polygon) in LAYERS.items():
        if a.source_dir:
            raw = (a.source_dir / f"{stem}.geojson").read_bytes()
        else:
            with urllib.request.urlopen(URL.format(stem), timeout=60) as r:
                raw = r.read()
        features += process_layer(layer, polygon, json.loads(raw), box)
    text = json.dumps({"type": "FeatureCollection", "features": features},
                      separators=(",", ":"), ensure_ascii=False)
    Path(output).write_text(text, encoding="utf-8")
    print(f"{output}: {len(text) / 1e6:.2f} MB, {len(features)} features, bbox {box}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
