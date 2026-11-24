"""Events for the map and the story: from the GEDCOM, manual ones and migration lines.

An event is a dict with the keys `id, type, year, date, place, branch, people,
description, documents, certainty`. `place` is a canonical town from places.json,
`description` is `{lang: text}` for every configured language, `certainty` is one of CERTAINTIES."""
from __future__ import annotations

import json
from pathlib import Path

from familychronicle.dates import CS_NOM, EN_FULL, EN_SHORT
from familychronicle.gedcom import GDate, Tree
from familychronicle.places import Places
from familychronicle.scope import Scope

TYPES = {"birth", "marriage", "death", "burial", "move", "war", "transport", "other"}
CERTAINTIES = {"document", "tree", "chronicle", "uncertain"}
REQUIRED = ("id", "type", "year", "date", "place", "branch", "people", "description",
            "documents", "certainty")
_TYPE = {"BIRT": "birth", "DEAT": "death", "BURI": "burial", "MARR": "marriage"}
_WORD = {   # type -> (Czech, English) word in the description
    "birth": ("narození", "birth"), "death": ("úmrtí", "death"),
    "burial": ("pohřeb", "burial"), "marriage": ("sňatek", "marriage"),
}
_ABOUT = {"cs": "kolem", "en": "about"}


def format_date(d: GDate | None, lang: str = "en") -> str:
    """Display text of a date: "5 Mar 1890" (en), "5. 3. 1890" (cs), "about 1890"."""
    if d is None:
        return ""
    if d.year is None:
        return d.text
    cs = lang == "cs"
    if d.day and d.month:
        t = f"{d.day}. {d.month}. {d.year}" if cs else f"{d.day} {EN_SHORT[d.month - 1]} {d.year}"
    elif d.month:
        t = f"{(CS_NOM if cs else EN_FULL)[d.month - 1]} {d.year}"
    else:
        t = str(d.year)
    return f"{_ABOUT[lang if cs else 'en']} {t}" if d.approximate else t


def _name(tree: Tree, pid: str) -> str:
    p = tree.people[pid]
    return f"{p.given} {p.surname}".strip()


def from_gedcom(tree: Tree, scope: Scope, places: Places, lang: str = "en",
                languages: tuple[str, ...] = ("cs", "en")) -> list[dict]:
    """Birth, death, burial and marriage events of deceased map people.

    An event whose place is not in the table is left off the map and its town is
    added to `places.missing`; ignored places are silently skipped. `lang` is the
    language of the `date` text; `description` gets one entry per language of `languages`
    (words known in Czech and English, English for any other language)."""
    candidates: list[tuple] = []   # (type, event, people, id, branch, names)
    for pid in sorted(scope.map_people - scope.living):    # map: only ancestors and siblings
        for e in tree.people[pid].events:
            if e.type in _TYPE:
                t = _TYPE[e.type]
                candidates.append((t, e, [pid], f"{t}-{pid}",
                                   scope.branch_of.get(pid, ""), _name(tree, pid)))
    for fid in sorted(tree.families):
        f = tree.families[fid]
        spouses = [x for x in (f.husband, f.wife) if x and x in tree.people]
        if len(spouses) != 2 or not any(x in scope.map_people for x in spouses):
            continue
        if any(x in scope.living or (x not in scope.map_people and not tree.people[x].has_death)
               for x in spouses):
            continue
        branch = next((scope.branch_of[x] for x in spouses if x in scope.branch_of), "")
        names = " + ".join(_name(tree, x) for x in spouses)
        for e in f.events:
            if e.type == "MARR":
                candidates.append(("marriage", e, [x for x in spouses if x in scope.map_people],
                                   f"marriage-{fid}", branch, names))
    places.missing.update(places.unknown(e.place for _, e, *_ in candidates if e.place))
    out = []
    for t, e, people, eid, branch, names in candidates:
        town = places.town(e.place) if e.place else None
        if town is None:        # no place, ignored or missing: not on the map
            continue
        words = {"cs": _WORD[t][0]}
        out.append({
            "id": eid, "type": t, "year": e.date.year if e.date else None,
            "date": format_date(e.date, lang), "place": town, "branch": branch,
            "people": people, "description": {l: f"{words.get(l, _WORD[t][1])} — {names}" for l in languages},
            "documents": [], "certainty": "tree",
        })
    return out


def manual(path: Path, places: Places, languages: tuple[str, ...] = ("cs", "en")) -> list[dict]:
    """Hand-written events (events.json). Malformed entries raise ValueError listing all problems.
    `description` must have a text for every language in `languages`."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    out, errors = [], []
    for i, e in enumerate(data):
        ident = e.get("id", f"#{i}")
        absent = [k for k in REQUIRED if k not in e]
        if absent:
            errors.append(f"{ident}: missing {', '.join(absent)}")
            continue
        if e["type"] not in TYPES:
            errors.append(f"{ident}: unknown type {e['type']}")
        if e["certainty"] not in CERTAINTIES:
            errors.append(f"{ident}: unknown certainty {e['certainty']}")
        if not isinstance(e["description"], dict) or not set(languages) <= set(e["description"]):
            errors.append(f"{ident}: description needs {', '.join(languages)}")
        if not isinstance(e["people"], list) or not isinstance(e["documents"], list):
            errors.append(f"{ident}: people and documents must be lists")
        town = places.town(e["place"]) if e["place"] else None
        if town is None:
            errors.append(f"{ident}: unknown place {e['place']}")
            continue
        out.append({**e, "place": town})
    if errors:
        raise ValueError("; ".join(errors))
    return out


_NO_END = object()


def migration_lines(tree: Tree, scope: Scope, events: list[dict], places: Places,
                    living_town: dict | None = None) -> list[dict]:
    """Lines from parents to children, as `{"branch", "from", "to", "points"}`.

    A point is `[lat, lon, year, certainty]` (the web draws uncertain ones dashed).
    A line to a living child ends in their town from `living_town`; without one
    it ends at the parent's last point (no extra point)."""
    living_town = living_town or {}

    def point(town: str, year, certainty: str = "tree"):
        lat, lon = places.coords(town)
        return [lat, lon, year, certainty]

    def order(e):
        return (e["year"] is None, e["year"] or 0, e["type"] != "birth")

    lines = []
    for a in sorted(scope.ahnentafel, key=scope.ahnentafel.get):
        if a in scope.living:
            continue
        mine = sorted((e for e in events if a in e["people"] and e["place"]), key=order)
        if not mine:
            continue
        for c in tree.children(a):
            if c not in scope.ahnentafel:
                continue
            if c in scope.living:
                town = living_town.get(c)
                end = point(town, None) if town and places.town(town) else _NO_END
            else:
                birth = next((e for e in events if e["type"] == "birth"
                              and e["people"] == [c] and e["place"]), None)
                end = point(birth["place"], birth["year"], birth["certainty"]) if birth else None
            if end is None:
                continue
            points: list = []
            for e in mine:
                p = point(e["place"], e["year"], e["certainty"])
                if not points or points[-1][:2] != p[:2]:
                    points.append(p)
            if end is _NO_END:          # living child without a town: no further point
                pass
            elif points[-1][:2] == end[:2]:
                points[-1][2:] = end[2:]
            else:
                points.append(end)
            lines.append({"branch": scope.branch_of.get(a, ""), "from": a, "to": c, "points": points})
    return lines
