"""Map data for the browser: camera bounds derived from the places, and the optional
hand-written labels from `map_labels` in site.json."""
from __future__ import annotations

KINDS = ("region", "town", "ridge")
MARGIN_RATIO = 0.25      # of the span of the places, on every side
MIN_MARGIN = 1.0         # degrees; also what a single place gets


def bounds(places: dict) -> list[float] | None:
    """[south, west, north, east] of all places with coordinates plus a margin, or None."""
    coords = [m["coords"] for m in places.values() if m.get("coords")]
    if not coords:
        return None
    lats, lons = [c[0] for c in coords], [c[1] for c in coords]
    south, north, west, east = min(lats), max(lats), min(lons), max(lons)
    dlat = max(MIN_MARGIN, (north - south) * MARGIN_RATIO)
    dlon = max(MIN_MARGIN, (east - west) * MARGIN_RATIO)
    return [round(max(-80.0, south - dlat), 3), round(max(-180.0, west - dlon), 3),
            round(min(80.0, north + dlat), 3), round(min(180.0, east + dlon), 3)]


def labels(config: dict) -> list[dict]:
    """The validated `map_labels` of the config: [{text{lang: str}, lat, lon, kind}]."""
    raw = config.get("map_labels", [])
    if not isinstance(raw, list):
        raise ValueError("map_labels must be a list")
    out = []
    for i, item in enumerate(raw):
        where = f"map_labels[{i}]"
        if not isinstance(item, dict):
            raise ValueError(f"{where} must be an object")
        text = item.get("text")
        if not isinstance(text, dict) or not text or not all(isinstance(v, str) and v for v in text.values()):
            raise ValueError(f"{where}: text must map language -> non-empty text")
        for key in ("lat", "lon"):
            if isinstance(item.get(key), bool) or not isinstance(item.get(key), (int, float)):
                raise ValueError(f"{where}: {key} must be a number")
        if not -90 <= item["lat"] <= 90 or not -180 <= item["lon"] <= 180:
            raise ValueError(f"{where}: lat/lon out of range")
        if item.get("kind") not in KINDS:
            raise ValueError(f"{where}: kind must be one of {', '.join(KINDS)}")
        out.append({"text": text, "lat": item["lat"], "lon": item["lon"], "kind": item["kind"]})
    return out


def map_data(places: dict, config: dict) -> dict:
    """The content of the `map` data file."""
    return {"bounds": bounds(places), "labels": labels(config)}
