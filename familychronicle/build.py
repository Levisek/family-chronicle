"""Build the static website: pages, JSON data, images, manifest and the approval list.
At the end the privacy check of the output runs and a finding fails the build.

  python -I build.py --config example/site.json [--out DIR] [--today YYYY-MM-DD]

Output: DIR/<site_dir>/ (the website), DIR/manifest.json and DIR/approval.md (the last
two sit next to the site folder, not in it). Nothing is uploaded; copy the site folder yourself once
you have read approval.md. Paths in the config resolve against the config's folder."""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from string import Template

from familychronicle import chronicles, config as config_module, documents, mapview, states as states_module
from familychronicle.events import format_date, from_gedcom, manual, migration_lines
from familychronicle.gedcom import age_at_death, load as load_tree
from familychronicle.places import Places, _to_town
from familychronicle.privacy import check_output, living_for_check, locale_extensions, sensitive_dates
from familychronicle.relationship import relationship
from familychronicle.scope import determine_scope

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "templates"
STATIC = ROOT / "static"
FONTS = ROOT / "fonts"
LOCALES = ROOT / "locales"
DEFAULT_OUT = Path("out")
RESERVED_SLUG = "open-questions"
ESCAPE = re.compile(r"<(?=/|!)")
KEY = re.compile(r"[a-z0-9_-]+")
COLOR = re.compile(r"#[0-9a-fA-F]{3,8}")
SITE_DIR = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")
REQUIRED = ("root", "gedcom", "base_url", "languages", "default_language", "site_dir", "branches", "places")


class BuildError(Exception):
    """A problem in the input that stops the build (message goes to stderr)."""


# --- helpers -----------------------------------------------------------------

def _hash8(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:8]


def _template(name: str) -> Template:
    return Template((TEMPLATES / name).read_text(encoding="utf-8"))


def _e(s) -> str:
    return html.escape(str(s), quote=True)


def _template_strings(t: dict) -> dict:
    """Every text key of the strings file (escaped) as a template variable `$key`."""
    return {k: _e(v) for k, v in t.items() if isinstance(v, str)}


def _json_in_html(obj) -> str:
    """JSON for `<script type="application/json">`: `</` and `<!` are escaped."""
    return ESCAPE.sub(r"\\u003c", json.dumps(obj, ensure_ascii=False, separators=(",", ":")))


def _json(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True).encode("utf-8")


def _clean_html(h: str, table_label: str = "Table") -> str:
    """Markdown sometimes emits `style=""` (table alignment); the site allows none.
    Tables get a scrolling wrapper that can be focused from the keyboard."""
    h = re.sub(r"<table>.*?</table>", lambda m: (
        f'<div class="table-wrap" role="region" tabindex="0" aria-label="{_e(table_label)}">'
        f"{m.group(0)}</div>"), h, flags=re.S)
    h = re.sub(r'\sstyle="text-align:\s*(left|right|center);?"', r' class="align-\1"', h)
    return re.sub(r'\sstyle="[^"]*"', "", h)


def _safe_output(config_dir: Path, out: Path, site_dir: str) -> bool:
    o = out.resolve()
    c = config_dir.resolve()
    if o == Path(o.anchor) or o == Path.home().resolve():
        return False
    if o == c or o.is_relative_to(c) or c.is_relative_to(o):
        return False
    return not (o / site_dir).is_symlink()


class Writer:
    def __init__(self, folder: Path):
        self.folder = folder

    def text(self, rel: str, content: str) -> None:
        self.bytes(rel, content.encode("utf-8"))

    def bytes(self, rel: str, data: bytes) -> None:
        target = self.folder / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def hashed(self, rel_dir: str, name: str, ext: str, data: bytes) -> str:
        rel = f"{rel_dir}/{name}.{_hash8(data)}.{ext}"
        self.bytes(rel, data)
        return rel

    def data(self, name: str, data: bytes) -> str:
        """A hashed JSON file in data/ plus a script twin with the same content: opened from disk
        (file://) the browser refuses fetch(), but a <script src> still loads."""
        rel = self.hashed("data", name, "json", data)
        self.bytes(rel[:-len(".json")] + ".js",
                   f'(self.FC_DATA=self.FC_DATA||{{}})["{rel}"]='.encode("utf-8") + data + b";\n")
        return rel


# --- configuration and strings -------------------------------------------------

def _check_config(cfg: config_module.Config) -> None:
    missing = [k for k in REQUIRED if k not in cfg]
    if missing:
        raise BuildError(f"config is missing: {', '.join(missing)}")
    if not isinstance(cfg["site_dir"], str) or not SITE_DIR.fullmatch(cfg["site_dir"]) or cfg["site_dir"] in (".", ".."):
        raise BuildError(f"site_dir must be a plain folder name, not {cfg['site_dir']!r}")
    languages = cfg["languages"]
    if not languages or not all(isinstance(x, str) and KEY.fullmatch(x) for x in languages):
        raise BuildError("languages must be a list of codes such as [\"en\", \"cs\"]")
    if cfg["default_language"] not in languages:
        raise BuildError("default_language must be one of languages")
    for lang in languages:
        if not (LOCALES / f"{lang}.json").is_file():
            raise BuildError(f"no strings file locales/{lang}.json for language {lang}")
    keys = []
    for b in cfg["branches"]:
        if not isinstance(b.get("key"), str) or not KEY.fullmatch(b["key"]):
            raise BuildError(f"branch key must match [a-z0-9_-]+: {b.get('key')!r}")
        if not isinstance(b.get("name"), dict):
            raise BuildError(f"branch {b['key']}: name must map language -> text")
        keys.append(b["key"])
    if len(set(keys)) != len(keys):
        raise BuildError("duplicate branch keys")
    for b in cfg["branches"]:
        target = b.get("map_chapter")
        if target is None:
            continue
        other = next((x for x in cfg["branches"] if x.get("key") == target), None)
        if target == b["key"] or other is None:
            raise BuildError(f"branch {b['key']}: map_chapter must be the key of another branch, not {target!r}")
        if other.get("map_chapter") is not None:
            raise BuildError(f"branch {b['key']}: map_chapter {target!r} itself joins another chapter (no chains)")
    if "states" in cfg and not (isinstance(cfg["states"], str) and cfg["states"]):
        raise BuildError("states must be the name of the states file")


def _fill(value, replacements: dict):
    if isinstance(value, str):
        for k, v in replacements.items():
            value = value.replace(k, v)
        return value
    if isinstance(value, list):
        return [_fill(x, replacements) for x in value]
    if isinstance(value, dict):
        return {k: _fill(x, replacements) for k, x in value.items()}
    return value


def _merge(base: dict, over: dict) -> dict:
    """`over` on top of `base`; nested objects (chapters, branch_descriptions) merge key by key."""
    out = dict(base)
    for k, v in over.items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def _load_strings(cfg, root_given: str, root_full: str, chapter_titles: dict[str, dict]) -> dict[str, dict]:
    """Strings per language: `locales/<lang>.json`, config `strings` merged on top (nested objects key by key), `{root}` and
    `{root_full}` replaced by the root person's name, chapter names filled in."""
    overrides = cfg.get("strings") or {}
    out = {}
    for lang in cfg["languages"]:
        t = json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))
        t = _merge(t, overrides.get(lang, {}))
        t.pop("privacy", None)      # redaction data (months, birth words), not a text for the browser
        t = _fill(t, {"{root_full}": root_full, "{root}": root_given})
        chapters = t.setdefault("chapters", {})
        for slug, (title, branch_name) in chapter_titles.items():
            chapters.setdefault(slug, {"title": title, "short": branch_name.get(lang) or title, "subtitle": ""})
        out[lang] = t
    return out


# --- people and events ---------------------------------------------------------

def _town(places: Places, place: str | None) -> str | None:
    if not place:
        return None
    return places.town(place) or (_to_town(place) or None)


def _fact(e, places: Places, lang: str) -> dict | None:
    if e is None:
        return None
    return {"date": format_date(e.date, lang), "place": _town(places, e.place)}


def _partners(tree, scope, pid: str) -> dict[str, str]:
    """Partners in scope (for relationships seen from another person):
    "spouse", "divorced", or "partner" (no marriage and at least one is living)."""
    out = {}
    for fid in tree.people[pid].families:
        f = tree.families.get(fid)
        if not f:
            continue
        other = f.wife if f.husband == pid else f.husband
        if not other or other == pid or other not in scope.people:
            continue
        kinds = {e.type for e in f.events}
        if "DIV" in kinds:
            out[other] = "divorced"
        elif "MARR" not in kinds and (pid in scope.living or other in scope.living):
            out[other] = "partner"
        else:
            out[other] = "spouse"
    return out


def _age_text(years: int, approximate: bool, t: dict) -> str:
    """"53 years", "about 2 years", "under a year" from the strings (age_*)."""
    if years == 0:
        return t["age_under_year"]
    key = "age_year" if years == 1 else "age_years_few" if 2 <= years <= 4 else "age_years"
    text = t[key].format(n=years)
    return t["age_about"].format(value=text) if approximate else text


def _marriages(tree, scope, places: Places, pid: str, lang: str) -> list[dict]:
    """Marriages of a deceased person (date, town, partner in scope). A family with a
    living partner is left out entirely: the marriage date of a living person is sensitive."""
    out = []
    for fid in tree.people[pid].families:
        f = tree.families.get(fid)
        if not f:
            continue
        other = f.wife if f.husband == pid else f.husband
        if other in scope.living:
            continue
        for e in f.events:
            if e.type != "MARR":
                continue
            fact = _fact(e, places, lang)
            if fact["date"] or fact["place"]:
                out.append({"spouse": other if other in scope.people else None, **fact})
    return out


def _people_json(tree, scope, places: Places, living_town: dict, t: dict, lang: str,
                 states: states_module.States | None = None, default_language: str = "en") -> dict:
    out = {}
    for pid in sorted(scope.people):
        p = tree.people[pid]
        base = {
            "name": f"{p.given} {p.surname}".strip() or "N.N.",      # no name: nomen nescio
            "relationship": relationship(scope, pid, lang),
            "branch": scope.branch_of.get(pid, ""),
            "living": pid in scope.living,
            "ahnentafel": scope.ahnentafel.get(pid),
            "parents": [r for r in tree.parents(pid) if r in scope.people],
            "sex": p.sex if p.sex in ("M", "F") else "",
            "partners": _partners(tree, scope, pid),
        }
        if pid in scope.sibling_of:   # links in the tree (name and relation are allowed even for the living; no dates)
            base["sibling_of"] = scope.sibling_of[pid]
            if pid in scope.half_siblings:
                base["half_sibling"] = True
        if pid in scope.spouse_of:
            info = scope.spouse_families.get(pid, {})
            base["spouse_of"] = scope.spouse_of[pid]
            base["divorced"] = bool(info.get("divorce"))
            if not info.get("marriage") and not info.get("divorce"):
                base["partnership"] = True
        if pid in scope.living:
            out[pid] = {**base, "town": living_town.get(pid)}     # only these keys, nothing else
            continue
        death = next((e for e in p.events if e.type == "DEAT"), None)
        out[pid] = {
            **base,
            "town": _town(places, p.birth.place if p.birth else None),
            "birth": _fact(p.birth, places, lang),
            "death": _fact(death, places, lang) or ({"date": "", "place": None} if p.has_death else None),
            "documents": [],
            "mentions": [],
            "page": f"person/{pid}.html",
        }
        occupations = [o.value + (f" ({o.date.year})" if o.date and o.date.year else "")
                       for o in p.occupations]
        if occupations:
            out[pid]["occupations"] = occupations
        if death and death.cause:
            out[pid]["death_cause"] = death.cause
        age = age_at_death(p.birth.date if p.birth else None,
                           death.date if death else None, death.age if death else "")
        if age:
            out[pid]["death_age"] = _age_text(*age, t)
        marriages = _marriages(tree, scope, places, pid, lang)
        if marriages:
            out[pid]["marriages"] = marriages
        lived = states.person_states(tree, places, pid, default_language, scope.living) if states else []
        if lived:
            out[pid]["states"] = lived
    return out


def _link_documents(people: dict, events: list[dict], published: list[dict]) -> None:
    ids = {d["id"] for d in published}
    for e in events:
        e["documents"] = [x for x in e.get("documents", []) if x in ids]
    for d in published:
        main = documents.main_people(d)
        for pid in d.get("people") or []:
            field = "documents" if pid in main else "mentions"
            if pid in people and not people[pid]["living"] and d["id"] not in people[pid][field]:
                people[pid][field].append(d["id"])
        if d.get("year") is None:
            continue
        for e in events:
            if (e["certainty"] == "tree" and e["year"] == d["year"]
                    and any(p in (d.get("people") or []) for p in e["people"])
                    and d["id"] not in e["documents"]):
                e["documents"].append(d["id"])
                e["certainty"] = "document"


def _per_chronicle(events: list[dict], manual_ids: set[str]) -> None:
    """A manual event without a published document is "per the chronicle" (uncertain stays uncertain)."""
    for e in events:
        if e["id"] in manual_ids and e["certainty"] in ("document", "tree") and not e["documents"]:
            e["certainty"] = "chronicle"


def _without_living(events: list[dict], living: set[str]) -> tuple[list[dict], list[dict]]:
    """Manual events: remove living people from `people`; drop an event only about living people.
    Returns (events to use, events that lost a living person or were dropped entirely)."""
    out, changed = [], []
    for e in events:
        people = [p for p in e["people"] if p not in living]
        if len(people) != len(e["people"]):
            changed.append(e)
        if e["people"] and not people:
            continue
        out.append({**e, "people": people})
    return out, changed


# --- pages ---------------------------------------------------------------------

class Pages:
    def __init__(self, writer: Writer, strings: dict, static: dict, data_paths: dict,
                 branch_info: list[dict], languages: list[str], default_language: str,
                 first_chapter: str | None, extra_data: dict):
        self.writer = writer
        self.strings = strings
        self.static = static
        self.data_paths = data_paths          # lang -> {name: path}
        self.branch_info = branch_info
        self.languages = languages
        self.default = default_language
        self.first_chapter = first_chapter
        self.extra_data = extra_data
        self.base = _template("base.html")
        self.public: list[str] = []

    def prefix(self, lang: str) -> str:
        return "" if lang == self.default else f"{lang}/"

    def _scripts(self, names: list[str], root: str) -> str:
        # the settings panel (theme, colours) is on every page
        return "\n".join(f'<script src="{root}{self.static[n]}" defer></script>'
                         for n in [*names, "settings.js"] if n in self.static)

    def _css(self, root: str, css: list[str]) -> str:
        # themes.css comes last: it overrides the styles of the page
        return "\n".join(f'<link rel="stylesheet" href="{root}{self.static[n]}">'
                         for n in ["branches.css", "style.css", *css, "themes.css"] if n in self.static)

    def _theme(self, root: str) -> str:
        """The theme is set in <head> without defer, so the page does not flash in the default colours."""
        return f'<script src="{root}{self.static["theme.js"]}"></script>' if "theme.js" in self.static else ""

    def _modes(self, lang_root: str, active: str | None, t: dict) -> str:
        items = []
        if self.first_chapter:
            items.append(("story", f"story/{self.first_chapter}.html", t["mode_story"]))
        items += [("timeline", "map.html#timeline", t["mode_timeline"]),
                  ("map", "map.html#full-map", t["mode_map"])]
        return "\n".join(
            f'<a href="{lang_root}{url}"' + (' aria-current="true"' if k == active else "") +
            f">{_e(name)}</a>" for k, url, name in items)

    def page(self, lang: str, rel: str, title: str, body: str, *, body_class: str,
             scripts: list[str], data: dict, nav: str | None = None, mode: str | None = None,
             modes: bool = False, css: list[str] = (), full: bool = False) -> None:
        """`css`: files from static/ after branches.css and style.css. `full`: a full-window
        page (body.full, no footer; the page shows its sources itself)."""
        t = self.strings[lang]
        path = self.prefix(lang) + rel
        root = "../" * path.count("/")
        lang_root = root + self.prefix(lang)
        alt = {x: root + self.prefix(x) + rel for x in self.languages}
        alternate = "\n".join(
            [f'<link rel="alternate" hreflang="{x}" href="{alt[x]}">' for x in self.languages]
            + [f'<link rel="alternate" hreflang="x-default" href="{alt[self.default]}">'])
        current = ' aria-current="page"'
        switch = "\n".join(
            f'<a class="language" href="{alt[x]}" hreflang="{x}" lang="{x}" '
            f'aria-label="{_e(t["language_label"])}">{_e(self.strings[x]["language_name"])}</a>'
            for x in self.languages if x != lang)
        payload = {**data, **self.extra_data, "language": lang, "root_path": root,
                   "lang_root": lang_root, "languages": self.languages, "data": self.data_paths[lang],
                   "branches": self.branch_info, "strings": t}
        text = self.base.substitute(
            lang=lang, title=_e(title), alternate=alternate, css=self._css(root, list(css)),
            theme=self._theme(root), body_class=body_class + (" full" if full else ""), nav_label=_e(t["nav_label"]), root=lang_root,
            nav_home_url="index.html", nav_tree_url="tree.html", nav_map_url="map.html",
            nav_home=_e(t["nav_home"]), nav_tree=_e(t["nav_tree"]), nav_map=_e(t["nav_map"]),
            nav_home_cur=current if nav == "home" else "", nav_tree_cur=current if nav == "tree" else "",
            nav_map_cur=current if nav == "map" else "", language_links=switch,
            modes_label=_e(t["modes_label"]), modes=self._modes(lang_root, mode, t) if modes else "",
            content=body, footer="" if full else f'<footer>\n<p>{_e(t["sources"])}</p>\n</footer>',
            data=_json_in_html(payload), scripts=self._scripts(scripts, root))
        self.writer.text(path, text)
        self.public.append(path)


def _branch_css(cfg) -> bytes:
    """Branch colours from the config as `.branch-<key>` classes (no inline styles)."""
    rules = []
    for b in cfg["branches"]:
        color = b.get("color") or ""
        if COLOR.fullmatch(color):
            rules.append(f".branch-{b['key']} {{ --branch: {color}; }}")
    return ("/* generated from site.json */\n" + "\n".join(rules) + "\n").encode("utf-8")


def _branch_cards(cfg, slugs: dict[str, str], lang: str, t: dict) -> str:
    cards = []
    for b in cfg["branches"]:
        slug = slugs.get(b["key"])
        if not slug:
            continue
        description = (t.get("branch_descriptions") or {}).get(b["key"], "")
        cards.append(
            f'<li class="branch-{_e(b["key"])}"><a href="story/{_e(slug)}.html">'
            f'<span class="name">{_e(b["name"].get(lang) or b["key"])}</span>'
            f'<span class="description">{_e(description)}</span></a></li>')
    return "\n".join(cards)


def _people_table(people: dict, cfg, lang: str, t: dict, root: str) -> str:
    names = {b["key"]: b["name"].get(lang) or b["key"] for b in cfg["branches"]}
    names["common"] = t["branch_common"]
    names["other"] = t["branch_other"]
    names["spouses"] = t["branch_spouses"]
    order = ["common"] + [b["key"] for b in cfg["branches"]] + ["other", "spouses"]
    groups: dict[str, list] = {}
    for pid, p in people.items():
        groups.setdefault("spouses" if p.get("spouse_of") else p["branch"] or "other", []).append((pid, p))
    parts = []
    for key in order + [k for k in groups if k not in order]:
        members = sorted(groups.get(key, []),
                         key=lambda x: (x[1]["ahnentafel"] is None, x[1]["ahnentafel"] or 0, x[1]["name"]))
        if not members:
            continue
        items = []
        for pid, p in members:
            name = _e(p["name"])
            if p.get("page"):
                name = f'<a href="{root}{p["page"]}">{name}</a>'
            note = f" ({_e(t['living_label'])})" if p["living"] else ""
            items.append(f'<li id="{pid}">{name}{note} — {_e(p["relationship"])}</li>')
        parts.append(f'<section><h2>{_e(names.get(key, key))}</h2>\n<ul>\n'
                     + "\n".join(items) + "\n</ul></section>")
    return "\n".join(parts)


def _person_documents(ids: list[str], docs: dict, exports: dict, lang: str, t: dict,
                      root: str, base_dir: Path) -> str:
    figures = []
    for did in ids:
        d, ex = docs[did], exports[did]
        caption = (d.get("description") or {}).get(lang) or d["id"]
        img = (f'<img src="{root}{ex["crop"]}" width="{ex["width"]}" height="{ex["height"]}" '
               f'alt="{_e(caption)}" loading="lazy">')
        img = f'<a href="{root}{ex.get("sheet") or ex["crop"]}">{img}</a>'
        links = []
        if ex.get("sheet"):
            links.append(f'<a href="{root}{ex["sheet"]}">{_e(t["full_sheet"])}</a>')
        verified = documents.is_verified(d, base_dir)
        note = "" if verified else (
            f' <span class="unverified-caption">{_e(documents.unverified_label(d, t))}</span>')
        cls = "document" + ("" if verified else " unverified")
        figures.append(f'<figure class="{cls}">{img}<figcaption>{_e(caption)}{note}'
                       f'{" · " + " ".join(links) if links else ""}</figcaption></figure>')
    return "\n".join(figures)


def _states_html(lived: list[list], states: states_module.States, lang: str) -> str:
    """"[flag] Name -> [flag] Name" for the person page. No years: the boundaries of states next to the
    names of the parents would look like years of living namesakes to the privacy check."""
    parts = []
    for key, _start, _end in lived:
        if parts and parts[-1][0] == key:
            continue
        state = states.states[key]
        parts.append((key, f'<span class="state"><img class="flag" src="{_e(states.flag_uri(state["flag"]))}" '
                           f'alt="" width="21" height="14"> {_e(state["name"][lang])}</span>'))
    return " → ".join(h for _, h in parts)


def _person_page(pid: str, p: dict, people: dict, chapters: dict, docs: dict, exports: dict,
                 lang: str, t: dict, root: str, base_dir: Path,
                 states: states_module.States | None = None) -> str:
    details = []
    for key, label in (("birth", t["person_born"]), ("death", t["person_died"])):
        u = p[key]
        if u and (u["date"] or u["place"]):
            text = ", ".join(x for x in (u["date"], u["place"]) if x)
            details.append(f"<dt>{_e(label)}</dt><dd>{_e(text)}</dd>")
    if p.get("death_age"):
        details.append(f"<dt>{_e(t['person_age'])}</dt><dd>{_e(p['death_age'])}</dd>")
    if p.get("death_cause"):
        details.append(f"<dt>{_e(t['person_cause'])}</dt><dd>{_e(p['death_cause'])}</dd>")
    for m in p.get("marriages", []):
        who = people.get(m["spouse"]) if m["spouse"] else None
        parts = [f'<a href="{who["page"].split("/")[-1]}">{_e(who["name"])}</a>' if who and who.get("page")
                 else _e(who["name"]) if who else ""]
        parts += [_e(x) for x in (m["date"], m["place"]) if x]
        details.append(f"<dt>{_e(t['person_marriage'])}</dt><dd>{', '.join(x for x in parts if x)}</dd>")
    if p.get("occupations"):
        details.append(f"<dt>{_e(t['person_occupation'])}</dt><dd>{_e('; '.join(p['occupations']))}</dd>")
    if p.get("states") and states:
        details.append(f"<dt>{_e(t['person_states'])}</dt><dd>{_states_html(p['states'], states, lang)}</dd>")
    parents = [r for r in p["parents"] if people[r].get("page")]
    parents_html = ""
    if parents:
        parents_html = (f'<p class="parents">{_e(t["person_parents"])}: ' + ", ".join(
            f'<a href="{people[r]["page"].split("/")[-1]}">{_e(people[r]["name"])}</a>'
            for r in parents) + "</p>")
    paragraphs = "\n".join(ch.person_paragraphs[pid] for ch in chapters.values()
                           if pid in ch.person_paragraphs)
    chronicle = ""
    if paragraphs:
        chronicle = (f'<section class="from-chronicle"><h2>{_e(t["person_from_chronicle"])}</h2>\n'
                     f'{_clean_html(paragraphs, t["table"])}</section>')
    docs_html = ""
    if p["documents"]:
        docs_html = (f'<section class="documents"><h2>{_e(t["person_documents"])}</h2>\n'
                     + _person_documents(p["documents"], docs, exports, lang, t, root, base_dir)
                     + "</section>")
    if p["mentions"]:   # as a parent, godparent, witness... in someone else's document
        docs_html += (f'<details class="mentions"><summary>{_e(t["person_mentions"].format(n=len(p["mentions"])))}</summary>\n'
                      + _person_documents(p["mentions"], docs, exports, lang, t, root, base_dir)
                      + "</details>")
    return _template("person.html").substitute(
        branch=_e(p["branch"] or "common"), name=_e(p["name"]),
        relationship_heading=_e(t["person_relationship"]), relationship=_e(p["relationship"]),
        details="\n".join(details), parents=parents_html, chronicle=chronicle, documents=docs_html,
        tree_only="" if p["documents"] or p["mentions"] else
        f'<p class="tree-only">{_e(t["tree_only"])}</p>',
        root=root, map_url="map.html", tree_url="tree.html", id=_e(pid),
        on_map=_e(t["person_on_map"]), back=_e(t["person_back"]))


# --- main function ----------------------------------------------------------------

OUTPUT_MARKER = ".family-chronicle-output"   # next to <site_dir>; marks the folder as ours


def build(config_path: Path, out: Path, today: date) -> int:
    try:
        cfg = config_module.load(Path(config_path))
    except (OSError, ValueError) as error:
        print(f"Cannot read the config {config_path}: {error}", file=sys.stderr)
        return 1
    try:
        _check_config(cfg)
    except BuildError as error:
        print(f"Build stopped: {error}", file=sys.stderr)
        return 1
    out = Path(out)
    if not _safe_output(cfg.base_dir, out, cfg["site_dir"]):
        print(f"Refusing output {out}: the filesystem root, your home, the config folder, "
              "something inside it or above it.", file=sys.stderr)
        return 2
    out = out.resolve()
    existing = out / cfg["site_dir"]
    marker = out / OUTPUT_MARKER
    if existing.exists() and not marker.is_file():
        print(f"Refusing to replace {existing}: it is not the output of a previous build "
              f"(no {OUTPUT_MARKER} next to it). Choose another --out or remove the folder yourself.",
              file=sys.stderr)
        return 2
    out.mkdir(parents=True, exist_ok=True)
    # Marks the folder as ours before anything is deleted, so a failed build
    # (which removes the stale manifest) does not block the next run.
    marker.write_text("Output folder of family-chronicle build.py.\n", encoding="utf-8")
    for stale in ("manifest.json", "approval.md"):    # no stale "ok"
        (out / stale).unlink(missing_ok=True)
    try:
        return _build(cfg, out, today)
    except BuildError as error:
        print(f"Build stopped: {error}", file=sys.stderr)
        return 1


def _build(cfg: config_module.Config, out: Path, today: date) -> int:
    languages, default = list(cfg["languages"]), cfg["default_language"]
    base_dir = cfg.base_dir
    try:
        tree = load_tree(cfg.path("gedcom"))
    except (OSError, ValueError) as error:    # GedcomEncodingError is a ValueError
        raise BuildError(f"cannot read the GEDCOM: {error}")
    if cfg["root"] not in tree.people:
        raise BuildError(f"root {cfg['root']} is not in the GEDCOM")
    scope = determine_scope(tree, cfg, today)
    places = Places(cfg.path("places"), cfg.get("ignore_places", []))
    try:
        states = states_module.load(cfg.path("states"), languages) if cfg.get("states") else None
    except states_module.StatesError as error:
        raise BuildError(str(error))
    try:
        map_json = mapview.map_data(places.data, cfg)
    except ValueError as error:
        raise BuildError(str(error))
    try:
        privacy_ext = locale_extensions(languages, LOCALES, cfg.get("strings"))
    except ValueError as error:
        raise BuildError(str(error))
    living_town = cfg.get("living_town") or {}
    wrong = sorted(f"{p}: {v}" for p, v in living_town.items() if places.town(v) != v)
    if wrong:
        raise BuildError("living_town is not a canonical place from the places file: " + "; ".join(wrong))

    # chronicles: the branches that have one, in config order
    chronicle_files: dict[str, Path] = {}
    slugs: dict[str, str] = {}
    for b in cfg["branches"]:
        if not b.get("chronicle"):
            continue
        md = (base_dir / b["chronicle"]).resolve()
        if not md.is_file():
            raise BuildError(f"branch {b['key']}: chronicle file not found: {b['chronicle']}")
        slug = chronicles.chapter_slug(md)
        if slug == RESERVED_SLUG or slug in chronicle_files:
            raise BuildError(f"chronicle name {slug!r} is reserved or used twice")
        chronicle_files[slug] = md
        slugs[b["key"]] = slug

    root_person = tree.people[cfg["root"]]
    root_full = f"{root_person.given} {root_person.surname}".strip() or "N.N."
    root_given = root_person.given.split()[0] if root_person.given.split() else root_full
    strings = _load_strings(cfg, root_given, root_full, {
        slug: (slug, {l: b["name"].get(l) for l in languages})
        for slug, b in ((slugs[b["key"]], b) for b in cfg["branches"] if b["key"] in slugs)})

    # events
    try:
        manual_events: list[dict] = manual(cfg.path("events"), places, tuple(languages)) if cfg.get("events") else []
        all_documents = documents.load_documents(cfg.path("documents"), base_dir) if cfg.get("documents") else []
    except (ValueError, OSError) as error:
        raise BuildError("; ".join(str(error).split("; ")))
    manual_events, manual_changed = _without_living(manual_events, scope.living)
    manual_ids = {e["id"] for e in manual_events}
    events_by_lang = {}
    for lang in languages:
        gedcom_events = from_gedcom(tree, scope, places, lang, tuple(languages))
        events_by_lang[lang] = gedcom_events + [dict(e) for e in manual_events]
    if places.missing:
        print("Warning: places missing from the places file (left off the map): "
              + "; ".join(sorted(places.missing)), file=sys.stderr)

    published, withheld = documents.decide(all_documents, scope, base_dir,
                                           cfg.get("documents_cutoff_year", documents.DEFAULT_CUTOFF_YEAR))

    site = out / cfg["site_dir"]
    if site.exists():
        shutil.rmtree(site)
    site.mkdir(parents=True)
    writer = Writer(site)

    exports: dict[str, dict] = {}
    for d in published:
        exports[d["id"]] = documents.export(d, site, base_dir)
    docs = {d["id"]: d for d in published}
    allowed = {p.removeprefix("documents/") for ex in exports.values()
               for p in (ex["crop"], ex["sheet"]) if p}

    people_by_lang, data_paths = {}, {}
    for lang in languages:
        people = _people_json(tree, scope, places, living_town, strings[lang], lang, states, default)
        events = events_by_lang[lang]
        _link_documents(people, events, published)
        _per_chronicle(events, manual_ids)
        people_by_lang[lang] = people
        data_paths[lang] = {
            "people": writer.data(f"people-{lang}", _json(people)),
            "events": writer.data(f"events-{lang}", _json(events)),
        }
    default_events = events_by_lang[default]
    lines = migration_lines(tree, scope, default_events, places, living_town)
    shared = {
        "lines": writer.data("lines", _json(lines)),
        "places": writer.data("places", _json(
            {n: {"coords": m["coords"], "country": m.get("country", {})} for n, m in places.data.items()})),
        "documents": writer.data("documents", _json({
            did: {"description": d.get("description") or {}, "crop": exports[did]["crop"],
                  "sheet": exports[did]["sheet"], "verified": documents.is_verified(d, base_dir)}
            for did, d in docs.items()})),
    }
    shared["map"] = writer.data("map", _json(map_json))
    if cfg.get("basemap") and cfg.path("basemap").is_file():
        shared["basemap"] = writer.data("basemap", cfg.path("basemap").read_bytes())
    for lang in languages:
        data_paths[lang].update(shared)

    # people supported by sources: a source in the GEDCOM, a verified document, or an event backed by one
    default_people = people_by_lang[default]
    backed = {i for e in default_events if e.get("certainty") == "document" for i in e["people"]}
    verified_count = sum(
        1 for pid, p in default_people.items()
        if tree.people[pid].has_source or pid in backed
        or any(d in docs and documents.is_verified(docs[d], base_dir) for d in p.get("documents") or []))

    # static files
    static: dict[str, str] = {}
    if STATIC.is_dir():
        for f in sorted(STATIC.iterdir()):
            if f.is_file():
                stem, _, ext = f.name.rpartition(".")
                static[f.name] = writer.hashed("static", stem, ext, f.read_bytes())
    static["branches.css"] = writer.hashed("static", "branches", "css", _branch_css(cfg))
    for f in sorted(FONTS.glob("*.ttf")) + [FONTS / "OFL.txt"]:
        if f.is_file():
            writer.bytes(f"static/fonts/{f.name}", f.read_bytes())

    branch_info = [{"key": b["key"], "name": b["name"], "color": b.get("color"),
                    "chronicle": slugs.get(b["key"]), "map_chapter": b.get("map_chapter")} for b in cfg["branches"]]
    first_chapter = next(iter(chronicle_files), None)
    pages = Pages(writer, strings, static, data_paths, branch_info, languages, default, first_chapter,
                  {"root": cfg["root"], "root_name": root_full, "final_town": living_town.get(cfg["root"]),
                   "color_modes": ["branch", *(["state"] if states else []), "era", "documented"],
                   **(states.page_data() if states else {})})

    sensitive = [d for ds in sensitive_dates(tree, scope).values() for d in ds]
    images = [tuple(x) for x in cfg.get("chronicle_images", [])]
    open_headings = cfg.get("open_questions_headings") or {}

    # chronicles
    chapters: dict[str, dict] = {lang: {} for lang in languages}
    for lang in languages:
        for slug, md in chronicle_files.items():
            ch = chronicles.render(md, lang, sensitive, published, exports, strings[lang],
                                   "../" * (1 if lang == default else 2), default, images, base_dir, privacy_ext)
            ch.html = _clean_html(ch.html, strings[lang]["table"])
            chapters[lang][slug] = ch

    for lang in languages:
        t = strings[lang]
        people = people_by_lang[lang]
        counts = {"n": len(people), "verified": verified_count}
        # home
        paragraphs = "\n".join(f"<p>{_e(p)}</p>" for p in t["intro"])
        paragraphs += f'\n<p class="counts">{_e(t["counts"].format(**counts))}</p>'
        pages.page(lang, "index.html", t["site_title"], _template("home.html").substitute(
            title=_e(t["intro_title"]), paragraphs=paragraphs, root="",
            story_url=f"story/{first_chapter}.html" if first_chapter else "tree.html",
            tree_url="tree.html", map_url="map.html", branches_heading=_e(t["intro_branches"]),
            cards=_branch_cards(cfg, slugs, lang, t), intro_story=_e(t["intro_story"]),
            intro_tree=_e(t["intro_tree"]), intro_map=_e(t["intro_map"])),
            body_class="home", scripts=[], data={}, nav="home")
        # tree
        pages.page(lang, "tree.html", t["tree_title"], _template("tree.html").substitute(
            **{**_template_strings(t), "counts_short": _e(t["counts_short"].format(**counts)),
               "branches": _people_table(people, cfg, lang, t, "")}),
            body_class="tree", scripts=["coloring.js", "common.js", "view.js", "tree.js"], data={}, nav="tree",
            css=["tree.css"], full=True)
        # ancestor fan
        pages.page(lang, "fan.html", t["fan_title"], _template("fan.html").substitute(
            **_template_strings(t)),
            body_class="fan", scripts=["coloring.js", "common.js", "view.js", "fan.js"], data={}, nav="tree",
            css=["tree.css", "fan.css"], full=True)
        # map
        pages.page(lang, "map.html", t["map_title"], _template("map.html").substitute(
            **_template_strings(t)),
            body_class="map", scripts=["common.js", "film.js", "map-draw.js", "map-film.js"],
            data={}, nav="map", mode="timeline", modes=True, css=["map.css"], full=True)
        # story
        open_questions = []   # (chapter, [(title, html)]) for the "What we are looking for" page
        for slug in chronicle_files:
            base_ch, ch = chapters[default][slug], chapters[lang][slug]
            if len(ch.sections) != len(base_ch.sections):   # translation with other sections: use the default
                ch = base_ch
            chosen = chronicles.cut_sections(ch, chronicles.open_section_indexes(
                base_ch, open_headings.get(default, [])))
            if chosen:
                open_questions.append((ch, chosen))

        def chapter_links(active: str) -> str:
            items = [(s, chapters[lang][s].title) for s in chronicle_files]
            if open_questions:
                items.append((RESERVED_SLUG, t["open_questions_title"]))
            return "\n".join(
                f'<li><a href="{s}.html"' + (' aria-current="page"' if s == active else "") +
                f'>{_e(n)}</a></li>' for s, n in items)

        for slug in chronicle_files:
            ch = chapters[lang][slug]
            pages.page(lang, f"story/{slug}.html", ch.title, _template("story.html").substitute(
                chapters_heading=_e(t["story_chapters"]), chapters=chapter_links(slug),
                chapter=ch.html, map_panel=_e(t["map_panel"])),
                body_class="story", scripts=["common.js", "film.js", "map-draw.js", "story.js"],
                data={"slug": slug, "sections": ch.sections}, mode="story", modes=True,
                css=["map.css"])
        if open_questions:
            body = [f"<h1>{_e(t['open_questions_title'])}</h1>", f"<p>{_e(t['open_questions_intro'])}</p>"]
            for ch, chosen in open_questions:
                body.append(f'<h2><a href="{ch.slug}.html">{_e(ch.title)}</a></h2>')
                for title, h in chosen:
                    body.append(f"<h3>{_e(title)}</h3>\n{h}")
            pages.page(lang, f"story/{RESERVED_SLUG}.html", t["open_questions_title"],
                f'<div class="story open-questions"><nav class="chapters" aria-label="{_e(t["story_chapters"])}"><ul>\n'
                f'{chapter_links(RESERVED_SLUG)}\n</ul></nav>\n<article class="chronicle">\n'
                + "\n".join(body) + "\n</article></div>",
                body_class="story", scripts=[], data={}, mode="story", modes=True)
        # people (deceased only)
        for pid, p in people.items():
            if p["living"]:
                continue
            body = _person_page(pid, p, people, chapters[lang], docs, exports, lang, t,
                                "../" * (1 if lang == default else 2), base_dir, states)
            pages.page(lang, f"person/{pid}.html", p["name"], body, body_class="person",
                       scripts=[], data={"person": pid})

    # sitemap
    base_url = cfg["base_url"].rstrip("/") + "/"
    urls = "\n".join(f"<url><loc>{_e(base_url + p)}</loc></url>" for p in sorted(pages.public))
    writer.text("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n'
                '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + "\n</urlset>\n")

    # output check: always after everything is written
    problems = check_output(site, living_for_check(tree, scope), cfg.get("check_exceptions", []), allowed, privacy_ext)
    files = {f"{cfg['site_dir']}/{p.relative_to(site).as_posix()}": hashlib.sha256(p.read_bytes()).hexdigest()
             for p in sorted(site.rglob("*")) if p.is_file()}
    approval = _approval(scope, default_people, published, withheld, exports, manual_changed, default)
    (out / "approval.md").write_text(approval, encoding="utf-8")
    (out / "manifest.json").write_text(json.dumps(     # the manifest is always written last
        {"files": files, "check": "failed" if problems else "ok",
         "created": datetime.now(timezone.utc).isoformat(timespec="seconds")},
        ensure_ascii=False, indent=2), encoding="utf-8")
    if problems:
        print("Output check FAILED:", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        return 1
    print(f"Done: {len(files)} files in {site}, check ok.")
    return 0


def _approval(scope, people: dict, published: list[dict], withheld: list, exports: dict,
              changed_events: list[dict], lang: str = "en") -> str:
    r = ["# To approve before publishing", "",
         "## Living people (only name, relationship and town are published)", ""]
    for pid in sorted(scope.living, key=lambda i: (people[i]["ahnentafel"] is None,
                                                   people[i]["ahnentafel"] or 0, i)):
        p = people[pid]
        r.append(f"- {p['name']} ({pid}) — {p['relationship']}, {p['town'] or 'not given'}")
    r += ["", "## Published documents", ""]
    for d in published:
        mark = "" if d.get("verified") else " [UNVERIFIED]"
        r.append(f"- {d['id']}{mark} — {(d.get('description') or {}).get(lang, '')}"
                 f" (people: {', '.join(d.get('people') or []) or '—'})")
    r += ["", "## Full sheets with addresses (to consider)", "",
          "The whole sheet (not only a crop) is published and the document is from 1900 or later.", ""]
    sheets = [d for d in published if exports.get(d["id"], {}).get("sheet")
              and d.get("year") is not None and d["year"] >= 1900]
    for d in sheets:
        r.append(f"- {d['id']} ({d['year']}) — {(d.get('description') or {}).get(lang, '')}")
    if not sheets:
        r.append("- none")
    r += ["", "## Manual events from which a living person was removed", "",
          "A living person was removed from the event (an event only about living people was dropped entirely).", ""]
    for e in changed_events:
        r.append(f"- {e['id']} ({e['year']}) — {(e.get('description') or {}).get(lang, '')}")
    if not changed_events:
        r.append("- none")
    r += ["", "## Withheld documents", ""]
    for d, reason in withheld:
        r.append(f"- {d['id']} — {reason}")
    return "\n".join(r) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--config", type=Path, required=True, help="site.json")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output folder (default: ./out)")
    ap.add_argument("--today", type=date.fromisoformat, default=None,
                    help="date for the 100-year living rule (default: today; fix it for reproducible builds)")
    a = ap.parse_args(argv)
    return build(a.config, a.out, a.today or date.today())


if __name__ == "__main__":
    sys.exit(main())
