"""Place table: GEDCOM PLAC -> canonical town and coordinates. Street addresses are dropped.

`places.json` maps a town name to `{"coords": [lat, lon], "country": {lang: name},
"aliases": [...]}`. A place that is neither mapped nor ignored is not fatal: it is
left off the map and collected in `Places.missing` so the build can warn about it."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Iterable


def _key(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().casefold()


# Czech "č. p." / "čp." / "č." and English "No." followed by a house number
_HOUSE_NUMBER = re.compile(r"\b(?:č\.\s*p\.|čp\.|č\.|no\.?)\s*\d+\S*", re.I)
_STREET_ADDRESS = re.compile(r"^\d+\w*\s+\S")      # "12 High Street": a street, not a town


def _clean_segment(segment: str) -> str:
    s = segment.replace("(?)", " ")                # uncertain reading of a house number
    s = _HOUSE_NUMBER.sub("", s)
    s = re.sub(r"\bul\.\s.*$", "", s, flags=re.I)  # Czech "ul." (street)
    s = re.sub(r"\s+\d+\S*$", "", s)               # trailing house number
    return s.strip()


def _to_town(place: str) -> str:
    """The town part of a place: no house numbers, streets or later segments.

    "Brno, č. p. 12" -> "Brno"; "12 High Street, York" -> "York"."""
    segments = [_clean_segment(s) for s in place.split(",")]
    for i, s in enumerate(segments):
        if _STREET_ADDRESS.match(s) and i + 1 < len(segments):
            continue                               # leading street address: the town follows
        return s
    return segments[-1]


class Places:
    def __init__(self, path: Path, ignore: Iterable[str]):
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        self.data: dict[str, dict] = data
        self._index: dict[str, str] = {}
        for name, entry in data.items():
            self._index[_key(name)] = name
            for alias in entry.get("aliases", []):
                self._index[_key(alias)] = name
        self._ignore = {_key(x) for x in ignore}
        self.missing: set[str] = set()      # towns seen in the tree that are not in the table

    def town(self, place: str | None) -> str | None:
        """Canonical town for a PLAC value, or None when it is not in the table."""
        if not place:
            return None
        k = _key(place)
        if k in self._index:
            return self._index[k]
        town = _to_town(place)
        return self._index.get(_key(town)) if town else None

    def coords(self, town: str) -> tuple[float, float] | None:
        entry = self.data.get(town)
        if not entry:
            return None
        lat, lon = entry["coords"]
        return (lat, lon)

    def is_ignored(self, place: str) -> bool:
        return _key(place) in self._ignore or _key(_to_town(place)) in self._ignore

    def unknown(self, places: Iterable[str | None]) -> list[str]:
        """Unmapped, non-ignored places (town only, no address), without duplicates."""
        out: list[str] = []
        for p in places:
            if not p or self.town(p) or self.is_ignored(p):
                continue
            town = _to_town(p) or p.split(",")[0].strip()
            if town not in out:
                out.append(town)
        return out
