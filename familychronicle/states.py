"""Historical states: which country a person lived in, by the places and years of their events.

An optional file (`states` in site.json) describes three things, all data of the family:

    {"flags":   {"<flag key>": {"stripes": ["#rrggbb", ...], "direction": "horizontal"|"vertical",
                                 "hoist_triangle": "#rrggbb", "color": "#rrggbb"}},
     "states":  {"<state key>": {"name": {"<lang>": "..."}, "flag": "<flag key>"}},
     "regions": {"<region>": [[from_year, "<state key>"], ...]}}

A region is a list of (year it starts, state), each valid until the next one. Years may carry a
fraction (1918.82 = late October 1918). A place belongs to the region named in its `region` entry in
places.json, otherwise to the region named like its country in the default language. The flags are
simplified (stripes and an optional triangle) and drawn as small SVG data URIs, so no extra file is
needed. States are computed for deceased people only: for the living a historical state would give
away their age.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import quote

COLOR = re.compile(r"#[0-9a-fA-F]{3,8}")
DIRECTIONS = ("horizontal", "vertical")
MAX_STRIPES = 6
OUTLINE = '<rect x=".25" y=".25" width="29.5" height="19.5" fill="none" stroke="#000" stroke-opacity=".25" stroke-width=".5"/>'


class StatesError(ValueError):
    """The states file is not usable (the message names the problem)."""


class States:
    def __init__(self, data: dict, languages: list[str]):
        if not isinstance(data, dict):
            raise StatesError("states file: must be an object")
        flags, states, regions = (data.get(k, {}) for k in ("flags", "states", "regions"))
        for name, value in (("flags", flags), ("states", states), ("regions", regions)):
            if not isinstance(value, dict):
                raise StatesError(f"states file: {name} must be an object")
        self.flags = {k: self._flag(k, v) for k, v in flags.items()}
        self.states = {k: self._state(k, v, languages) for k, v in states.items()}
        self.regions = {k: self._region(k, v) for k, v in regions.items()}
        self._palette()

    # --- validation ---------------------------------------------------------------

    def _flag(self, key: str, v) -> dict:
        if not isinstance(v, dict):
            raise StatesError(f"flag {key}: must be an object")
        stripes = v.get("stripes")
        if (not isinstance(stripes, list) or not 1 <= len(stripes) <= MAX_STRIPES
                or not all(isinstance(c, str) and COLOR.fullmatch(c) for c in stripes)):
            raise StatesError(f"flag {key}: stripes must be 1-{MAX_STRIPES} colours such as #aabbcc")
        direction = v.get("direction", "horizontal")
        if direction not in DIRECTIONS:
            raise StatesError(f"flag {key}: direction must be one of {', '.join(DIRECTIONS)}")
        for field in ("hoist_triangle", "color"):
            if field in v and not (isinstance(v[field], str) and COLOR.fullmatch(v[field])):
                raise StatesError(f"flag {key}: {field} must be a colour such as #aabbcc")
        return {"stripes": stripes, "direction": direction, "hoist_triangle": v.get("hoist_triangle"),
                "color": v.get("color")}

    def _state(self, key: str, v, languages: list[str]) -> dict:
        if not isinstance(v, dict) or not isinstance(v.get("name"), dict):
            raise StatesError(f"state {key}: name must map language -> text")
        missing = [x for x in languages if not isinstance(v["name"].get(x), str) or not v["name"][x].strip()]
        if missing:
            raise StatesError(f"state {key}: name is missing for {', '.join(missing)}")
        if v.get("flag") not in self.flags:
            raise StatesError(f"state {key}: flag {v.get('flag')!r} is not in flags")
        return {"name": {x: v["name"][x] for x in languages}, "flag": v["flag"]}

    def _region(self, key: str, v) -> list[tuple[float, str]]:
        if not isinstance(v, list) or not v:
            raise StatesError(f"region {key}: must be a non-empty list of [from_year, state]")
        out = []
        for item in v:
            if (not isinstance(item, list) or len(item) != 2 or isinstance(item[0], bool)
                    or not isinstance(item[0], (int, float))):
                raise StatesError(f"region {key}: every entry must be [from_year, state]")
            if item[1] not in self.states:
                raise StatesError(f"region {key}: unknown state {item[1]!r}")
            out.append((float(item[0]), item[1]))
        if [y for y, _ in out] != sorted(y for y, _ in out) or len({y for y, _ in out}) != len(out):
            raise StatesError(f"region {key}: years must be strictly increasing")
        return out

    def _palette(self) -> None:
        """A flag without its own `color` gets an evenly spread hue (used by the colour mode "state")."""
        n = max(1, len(self.flags))
        for i, key in enumerate(sorted(self.flags)):
            if not self.flags[key]["color"]:
                self.flags[key]["color"] = f"hsl({round(360 * i / n)}, 42%, 58%)"

    # --- flags ----------------------------------------------------------------------

    def flag_svg(self, key: str) -> str:
        f = self.flags[key]
        stripes = f["stripes"]
        n = len(stripes)
        body = ""
        for i, c in enumerate(stripes):
            if f["direction"] == "horizontal":
                body += f'<rect y="{20 * i / n:.3f}" width="30" height="{20 / n + 0.05:.3f}" fill="{c}"/>'
            else:
                body += f'<rect x="{30 * i / n:.3f}" width="{30 / n + 0.05:.3f}" height="20" fill="{c}"/>'
        if f["hoist_triangle"]:
            body += f'<path d="M0 0L15 10L0 20Z" fill="{f["hoist_triangle"]}"/>'
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20">{body}{OUTLINE}</svg>'

    def flag_uri(self, key: str) -> str:
        """The flag as a data URI (works from disk, no extra file)."""
        return "data:image/svg+xml," + quote(self.flag_svg(key), safe=" =:/.-")

    def page_data(self) -> dict:
        """What the scripts need: names, flag images and colours (page data keys `states`, `flags`)."""
        return {"states": {k: {"name": v["name"], "flag": v["flag"]} for k, v in self.states.items()},
                "flags": {k: {"src": self.flag_uri(k), "color": f["color"]} for k, f in self.flags.items()}}

    # --- timeline -------------------------------------------------------------------

    def region_of(self, places, town: str | None, default_language: str) -> str | None:
        """Region of a canonical town: its `region`, else its country in the default language."""
        entry = places.data.get(town) if town else None
        if not entry:
            return None
        region = entry.get("region") or (entry.get("country") or {}).get(default_language)
        return region if region in self.regions else None

    def state_at(self, region: str, year: float) -> str | None:
        found = None
        for start, state in self.regions.get(region, []):
            if year >= start:
                found = state
        return found

    def states_between(self, region: str, start: float, end: float) -> list[tuple[str, float, float]]:
        """The states of a region valid within [start, end], with the years clipped to it."""
        line = self.regions.get(region)
        if not line:
            return []
        out = []
        for i, (since, state) in enumerate(line):
            until = line[i + 1][0] if i + 1 < len(line) else 9999.0
            a, b = max(since, start), min(until, end)
            if a < b or (a == b == start and since <= start < until):
                out.append((state, a, b))
        return out

    def lifetime(self, points: list[tuple[float, str | None]]) -> list[list]:
        """points = [(time, region or None)]. Between two points the person lives in the region of
        the first (a point without a place carries on in the previous region). Result
        [[state, year_from, year_to]] with equal neighbours merged; [] when no region is known."""
        points = sorted(points, key=lambda p: p[0])
        known = next((r for _, r in points if r), None)
        if known is None:
            return []
        filled, current = [], known
        for t, r in points:
            current = r or current
            filled.append((t, current))
        stretches: list[tuple[str, float, float]] = []
        for i, (t, r) in enumerate(filled):
            end = filled[i + 1][0] if i + 1 < len(filled) else t
            stretches += self.states_between(r, t, end)
        out: list[list] = []
        for state, a, b in stretches:
            if out and out[-1][0] == state:
                out[-1][2] = max(out[-1][2], int(b))
            else:
                out.append([state, int(a), int(b)])
        return out

    def person_states(self, tree, places, pid: str, default_language: str, living: set[str]) -> list[list]:
        """States in which a deceased person lived, from their dated events and marriages. A marriage
        with a living partner is left out (its date is sensitive, like in the `marriages` of the person)."""
        person = tree.people[pid]
        events = list(person.events)
        for fid in person.families:
            family = tree.families.get(fid)
            if not family:
                continue
            other = family.wife if family.husband == pid else family.husband
            if other not in living:
                events += [e for e in family.events if e.type == "MARR"]
        points = []
        for e in events:
            t = moment(e.date)
            if t is None:
                continue
            town = places.town(e.place) if e.place else None
            points.append((t, self.region_of(places, town, default_language)))
        return self.lifetime(points)


def moment(date) -> float | None:
    """A GEDCOM date -> year with a fraction (a missing month counts as mid-year); None without a year."""
    if not date or not date.year:
        return None
    if not date.month:
        return date.year + 0.5
    return date.year + (date.month - 1) / 12 + ((date.day or 1) - 1) / 365


def load(path: Path, languages: list[str]) -> States:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise StatesError(f"cannot read the states file {path}: {error}")
    return States(data, languages)
