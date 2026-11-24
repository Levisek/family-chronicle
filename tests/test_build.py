import contextlib
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

from PIL import Image

from familychronicle import build as module
from familychronicle.build import build

DATA = Path(__file__).parent / "data"
ROOT = Path(__file__).resolve().parent.parent
EXAMPLE = ROOT / "example"
TODAY = date(2026, 11, 23)

CONFIG = {
    "root": "I1", "gedcom": "tree.ged", "base_url": "https://example.org/tree/",
    "languages": ["en", "cs"], "default_language": "en", "site_dir": "site",
    "branches": [{"key": "smith", "name": {"en": "Smith", "cs": "Smithovi"}, "color": "#123456",
                  "roots": ["I9"], "chronicle": "chronicles/overview.md"}],
    "places": "places.json", "events": "events.json", "documents": "documents.json",
    "ignore_places": ["Czechia"], "living_town": {"I1": "Springfield"}, "check_exceptions": [],
    "open_questions_headings": {"en": ["What we don't know"], "cs": ["Co nevíme"]},
}

CHRONICLE = """# Overview

## Beginnings

<!-- place: Millbrook -->
<!-- person: I4 -->
Joseph Smith came from Millbrook[^1].

Charles Smith was born as the first of the family.

[^1]: Note.
"""


def mini_project(tmp: Path, chronicle: str = CHRONICLE, documents=None, config=None,
                 folder: str = "project") -> Path:
    """A small project in `tmp/folder`; returns the config path."""
    base = tmp / folder
    (base / "chronicles").mkdir(parents=True, exist_ok=True)
    ged = (DATA / "mini.ged").read_text(encoding="utf-8")
    ged = ged.replace("2 DATE ABT 1890\n", "2 DATE ABT 1890\n2 PLAC Millbrook, Slovakia\n", 1)   # Joseph (I4)
    (base / "tree.ged").write_text(ged, encoding="utf-8")
    (base / "chronicles" / "overview.md").write_text(chronicle, encoding="utf-8")
    (base / "places.json").write_text((DATA / "places.json").read_text(encoding="utf-8"), encoding="utf-8")
    (base / "events.json").write_text("[]", encoding="utf-8")
    (base / "documents.json").write_text(json.dumps(documents or []), encoding="utf-8")
    path = base / "site.json"
    path.write_text(json.dumps(config or CONFIG), encoding="utf-8")
    return path


def event_json(**kw) -> dict:
    base = {"type": "move", "year": 1930, "date": "1930", "place": "Millbrook", "branch": "smith",
            "people": ["I4"], "documents": [], "certainty": "tree"}
    return {**base, **kw}


class Base(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.tmp = Path(self._t.name)
        self.addCleanup(self._t.cleanup)
        self.out = self.tmp / "out"
        self.stderr = ""

    def build(self, config=None, code=0):
        config = config or mini_project(self.tmp)
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            result = build(config, self.out, TODAY)
        self.stderr = err.getvalue()
        self.assertEqual(result, code, self.stderr)
        return config

    def edit_config(self, **changes) -> Path:
        path = mini_project(self.tmp)
        data = json.loads(path.read_text(encoding="utf-8"))
        data.update(changes)
        path.write_text(json.dumps(data), encoding="utf-8")
        return path

    @property
    def site(self):
        return self.out / "site"

    def people(self, lang="en"):
        f = next((self.site / "data").glob(f"people-{lang}.*.json"))
        return json.loads(f.read_text(encoding="utf-8"))

    def events(self, lang="en"):
        f = next((self.site / "data").glob(f"events-{lang}.*.json"))
        return json.loads(f.read_text(encoding="utf-8"))

    def manifest(self):
        return json.loads((self.out / "manifest.json").read_text(encoding="utf-8"))

    def read(self, rel):
        return (self.site / rel).read_text(encoding="utf-8")


class TestBuild(Base):
    def test_output_passes_check(self):
        self.build()
        self.assertEqual(self.manifest()["check"], "ok")
        self.assertTrue((self.out / "approval.md").is_file())
        for p in ("index.html", "tree.html", "fan.html", "map.html", "story/overview.html", "sitemap.xml",
                  "cs/index.html", "cs/tree.html", "cs/fan.html", "cs/map.html", "cs/story/overview.html",
                  "person/I4.html", "cs/person/I4.html", "static/fonts/OFL.txt"):
            self.assertTrue((self.site / p).is_file(), p)

    def test_living_have_no_page_or_data(self):
        self.build()
        for i in ("I1", "I2", "I3"):
            self.assertFalse((self.site / f"person/{i}.html").exists())
            self.assertFalse((self.site / f"cs/person/{i}.html").exists())
        p = self.people()
        self.assertEqual(set(p["I1"]), {"name", "relationship", "branch", "living", "ahnentafel",
                                        "parents", "sex", "partners", "town"})
        self.assertEqual(p["I1"]["town"], "Springfield")
        self.assertTrue(p["I2"]["living"])
        self.assertIsNone(p["I2"]["town"])               # not in living_town
        self.assertEqual(p["I4"]["birth"]["place"], "Millbrook")
        self.assertEqual(p["I4"]["page"], "person/I4.html")
        self.assertNotIn("I8", p)                        # the root's child is out of scope
        approval = (self.out / "approval.md").read_text(encoding="utf-8")
        self.assertIn("John Smith", approval)
        self.assertNotIn("1995", approval)
        self.assertRegex(approval, r"John Smith \(I1\)[^\n]*Springfield")
        self.assertRegex(approval, r"\(I2\)[^\n]*not given")

    def test_data_files_are_per_language(self):
        self.build()
        self.assertEqual(self.people("en")["I4"]["relationship"], "grandfather")
        self.assertEqual(self.people("cs")["I4"]["relationship"], "dědeček")
        h = self.read("cs/map.html")
        data = json.loads(re.search(r'id="data">(.*?)</script>', h, re.S).group(1))
        self.assertEqual(data["language"], "cs")
        self.assertIn("people-cs.", data["data"]["people"])
        self.assertTrue((self.site / data["data"]["people"]).is_file())
        self.assertEqual(data["root"], "I1")
        self.assertEqual(data["final_town"], "Springfield")
        self.assertEqual(data["root_name"], "John Smith")

    def test_living_town_must_be_canonical(self):
        self.build(self.edit_config(living_town={"I1": "Atlantis"}), code=1)
        self.assertIn("living_town", self.stderr)

    def test_manifest_matches(self):
        self.build()
        files = self.manifest()["files"]
        actual = {f"site/{p.relative_to(self.site).as_posix()}": hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in self.site.rglob("*") if p.is_file()}
        self.assertEqual(files, actual)
        self.assertFalse(any(k.startswith(("manifest", "approval")) for k in files))

    def test_reproducible(self):
        config = self.build()
        first = self.manifest()["files"]
        self.build(config)
        self.assertEqual(self.manifest()["files"], first)

    def test_no_inline_code(self):
        self.build()
        csp = ("default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
               "connect-src 'self'; object-src 'none'; base-uri 'self'")
        pages = list(self.site.rglob("*.html"))
        self.assertGreater(len(pages), 10)
        for p in pages:
            h = p.read_text(encoding="utf-8")
            self.assertIn(f'<meta http-equiv="Content-Security-Policy" content="{csp}">', h, p)
            self.assertRegex(h, r'<html lang="(cs|en)">')
            self.assertIn('hreflang="cs"', h)
            self.assertIn('hreflang="en"', h)
            self.assertNotIn(" style=", h, p)
            for m in re.finditer(r"<script([^>]*)>", h):
                self.assertTrue("src=" in m.group(1) or 'type="application/json"' in m.group(1), (p, m.group(0)))
            self.assertEqual(h.count('id="data"'), 1)
            json.loads(re.search(r'id="data">(.*?)</script>', h, re.S).group(1))

    def test_no_leaflet(self):
        self.build()
        files = [p for p in self.site.rglob("*") if p.is_file()]
        self.assertFalse([p for p in files if "leaflet" in p.name.lower()])
        for p in self.site.rglob("*.html"):
            self.assertNotIn("leaflet", p.read_text(encoding="utf-8").lower(), p)

    def test_scripts_and_css_per_page(self):
        self.build()
        for rel, js, css in (("map.html", ["common", "film", "map-draw", "map-film"], "map"),
                             ("tree.html", ["common", "view", "tree"], "tree"),
                             ("fan.html", ["common", "view", "fan"], "fan"),
                             ("story/overview.html", ["common", "film", "map-draw", "story"], "map")):
            h = self.read(rel)
            self.assertEqual(re.findall(r'static/([a-z-]+)\.[0-9a-f]{8}\.js', h), js, rel)
            self.assertRegex(h, rf'static/{css}\.[0-9a-f]{{8}}\.css', rel)
        for rel in ("map.html", "tree.html", "cs/map.html", "cs/tree.html"):
            h = self.read(rel)
            self.assertIn("full", re.search(r'<body class="([^"]*)"', h).group(1), rel)
            self.assertNotIn("<footer", h, rel)
        self.assertIn("<footer", self.read("index.html"))

    def test_map_hooks_for_the_film(self):
        self.build()
        for rel in ("map.html", "cs/map.html"):
            h = self.read(rel)
            for i in ("canvas", "card", "timeline", "b-play", "b-prev", "b-next", "b-end", "film-intro"):
                self.assertIn(f'id="{i}"', h, f"{rel}: #{i}")
            self.assertRegex(h, r'id="timeline" role="slider"')
            self.assertIn('class="modes"', h, rel)
            self.assertRegex(h, r'href="[^"]*map\.html#full-map"', rel)
            self.assertNotRegex(h, r'<[a-z]+[^>]*\sstyle=', rel)

    def test_data_files_have_script_twins_for_file_urls(self):
        # opened from disk (file://) the browser refuses fetch(), so every data file also ships as a script
        self.build()
        data = json.loads(re.search(r'id="data">(.*?)</script>', self.read("map.html"), re.S).group(1))
        self.assertTrue(data["data"])
        for rel in data["data"].values():
            twin = self.site / (rel[:-len(".json")] + ".js")
            text = twin.read_text(encoding="utf-8")
            prefix = f'(self.FC_DATA=self.FC_DATA||{{}})["{rel}"]='
            self.assertTrue(text.startswith(prefix), twin)
            self.assertEqual(json.loads(text[len(prefix):].rstrip().removesuffix(";")),
                             json.loads((self.site / rel).read_text(encoding="utf-8")), twin)

    def test_hashed_names(self):
        self.build()
        for p in list((self.site / "data").iterdir()) + list((self.site / "static").glob("*.*")):
            if p.is_file():
                self.assertRegex(p.name, r"\.[0-9a-f]{8}\.(json|css|js)$", p)

    def test_links_are_relative(self):
        self.build()
        for p in self.site.rglob("*.html"):
            h = p.read_text(encoding="utf-8")
            self.assertNotRegex(h, r'(?:href|src)="/', p)
            for u in re.findall(r'(?:href|src)="([^"#]+)"', h):
                if u.startswith(("http", "mailto")):
                    continue
                self.assertTrue((p.parent / u).resolve().exists(), (p, u))

    def test_other_language_mirrors_default(self):
        self.build()
        default = {p.relative_to(self.site).as_posix() for p in self.site.rglob("*.html")
                   if p.relative_to(self.site).parts[0] != "cs"}
        other = {p.relative_to(self.site / "cs").as_posix() for p in (self.site / "cs").rglob("*.html")}
        self.assertEqual(default, other)

    def test_branch_colors_and_cards(self):
        self.build()
        css = next((self.site / "static").glob("branches.*.css")).read_text(encoding="utf-8")
        self.assertIn(".branch-smith { --branch: #123456; }", css)
        for p in ("index.html", "cs/index.html"):
            h = self.read(p)
            self.assertIn('<li class="branch-smith"><a href="story/overview.html">', h)
            self.assertRegex(h, r'<link rel="stylesheet" href="(\.\./)?static/branches\.[0-9a-f]{8}\.css">')
        self.assertIn('class="person branch-', self.read("person/I4.html"))
        self.assertIn("Smithovi", self.read("cs/index.html"))

    def test_single_language(self):
        self.build(self.edit_config(languages=["cs"], default_language="cs"))
        self.assertFalse((self.site / "en").exists())
        self.assertIn("Vztah k autorovi", self.read("person/I4.html"))
        self.assertNotIn('class="language"', self.read("index.html"))

    def test_table_has_wrapper(self):
        h = module._clean_html("<p>x</p><table><tr><td>1</td></tr></table>", "Table")
        self.assertIn('<div class="table-wrap" role="region" tabindex="0" aria-label="Table"><table>', h)
        self.assertTrue(h.endswith("</table></div>"))


class TestPeople(Base):
    def test_occupations_only_for_deceased(self):
        self.build()
        p = self.people()
        self.assertEqual(p["I4"]["occupations"], ["weaver, Mill Lane 5 (1921)", "sexton"])
        self.assertNotIn("occupations", p["I1"])
        self.assertIn("<dt>Occupation</dt><dd>weaver, Mill Lane 5 (1921); sexton</dd>", self.read("person/I4.html"))
        self.assertIn("<dt>Povolání</dt>", self.read("cs/person/I4.html"))
        for f in self.site.rglob("*"):
            if f.is_file() and f.suffix in (".html", ".json"):
                self.assertNotIn("agent", f.read_text(encoding="utf-8"), f)

    def test_cause_of_death_only_for_deceased(self):
        self.build()
        p = self.people()
        self.assertEqual(p["I4"]["death_cause"], "tuberculosis")
        self.assertNotIn("death_cause", p["I1"])
        self.assertIn("<dt>Cause of death</dt><dd>tuberculosis</dd>", self.read("person/I4.html"))
        self.assertIn("<dt>Příčina smrti</dt>", self.read("cs/person/I4.html"))

    def test_age_at_death(self):
        path = mini_project(self.tmp)
        g = path.parent / "tree.ged"
        g.write_text(g.read_text(encoding="utf-8").replace(
            "2 CAUS tuberculosis\n", "2 CAUS tuberculosis\n2 AGE 32\n", 1), encoding="utf-8")
        self.build(path)
        p = self.people()
        self.assertEqual(p["I4"]["death_age"], "32 years")
        self.assertEqual(self.people("cs")["I4"]["death_age"], "32 let")
        self.assertNotIn("death_age", p["I1"])
        self.assertIn("<dt>Age at death</dt><dd>32 years</dd>", self.read("person/I4.html"))
        self.assertIn("<dt>Věk při úmrtí</dt><dd>32 let</dd>", self.read("cs/person/I4.html"))

    def test_age_text_inflection(self):
        t = {l: json.loads((ROOT / "locales" / f"{l}.json").read_text(encoding="utf-8")) for l in ("en", "cs")}
        self.assertEqual([module._age_text(n, False, t["cs"]) for n in (0, 1, 3, 5)],
                         ["méně než rok", "1 rok", "3 roky", "5 let"])
        self.assertEqual(module._age_text(39, True, t["cs"]), "asi 39 let")
        self.assertEqual(module._age_text(1, True, t["en"]), "about 1 year")
        self.assertEqual(module._age_text(0, False, t["en"]), "under a year")

    def test_marriage_of_deceased(self):
        path = mini_project(self.tmp)
        g = path.parent / "tree.ged"
        g.write_text(g.read_text(encoding="utf-8").replace(
            "1 CHIL @I2@\n", "1 CHIL @I2@\n1 MARR\n2 DATE 12 FEB 1920\n2 PLAC Millbrook, Slovakia\n", 1), encoding="utf-8")
        self.build(path)
        p = self.people()
        self.assertEqual(p["I4"]["marriages"], [{"spouse": "I5", "date": "12 Feb 1920", "place": "Millbrook"}])
        self.assertEqual(self.people("cs")["I5"]["marriages"],
                         [{"spouse": "I4", "date": "12. 2. 1920", "place": "Millbrook"}])
        for i in ("I1", "I2", "I3"):     # the living and their parents' marriage (1994) appear nowhere
            self.assertNotIn("marriages", p[i])
        self.assertIn('<dt>Marriage</dt><dd><a href="I5.html">Mary Smithson</a>, 12 Feb 1920, Millbrook</dd>',
                      self.read("person/I4.html"))
        self.assertIn("<dt>Sňatek</dt>", self.read("cs/person/I4.html"))

    def test_event_and_chronicle_paragraph(self):
        self.build()
        self.assertTrue(any(e["id"] == "birth-I4" for e in self.events()))
        self.assertIn("came from Millbrook", self.read("person/I4.html"))

    def test_person_without_any_data(self):
        # I3 (no dates, no deceased marker) is living by the rule: a name, a relation, nothing else
        self.build()
        self.assertEqual(set(self.people()["I3"]), set(self.people()["I1"]))


class TestStrings(Base):
    def test_same_keys_in_all_locales(self):
        def keys(value, prefix=""):
            if isinstance(value, dict):
                return {k2 for k, v in value.items() for k2 in keys(v, f"{prefix}{k}.")} | {prefix}
            return {prefix}
        en = json.loads((ROOT / "locales/en.json").read_text(encoding="utf-8"))
        cs = json.loads((ROOT / "locales/cs.json").read_text(encoding="utf-8"))
        self.assertEqual(keys(en), keys(cs))

    def test_dynamic_keys_exist(self):
        for lang in ("en", "cs"):
            t = json.loads((ROOT / "locales" / f"{lang}.json").read_text(encoding="utf-8"))
            for c in ("document", "tree", "chronicle", "uncertain"):
                self.assertIn("certainty_" + c, t, lang)
            for e in ("birth", "death", "burial", "marriage", "move", "war", "transport", "other"):
                self.assertTrue(t["event_types"].get(e), (lang, e))
            for slug, chapter in t["chapters"].items():
                self.assertTrue(chapter.get("title"), (lang, slug))
                if slug != "epilogue":
                    self.assertTrue(chapter.get("short"), (lang, slug))
                    self.assertFalse(chapter["short"].startswith("The "), (lang, slug))

    def test_placeholders_are_english(self):
        for lang in ("en", "cs"):
            text = (ROOT / "locales" / f"{lang}.json").read_text(encoding="utf-8")
            for old in ("{jmeno}", "{seznam}", "{vztah}", "{co}"):
                self.assertNotIn(old, text)

    def test_root_name_is_filled_in(self):
        self.build()
        h = self.read("tree.html")
        self.assertNotIn("{root", h)
        self.assertIn("ancestors and relatives of John Smith", h)
        data = json.loads(re.search(r'id="data">(.*?)</script>', self.read("cs/map.html"), re.S).group(1))
        self.assertNotIn("{root", json.dumps(data["strings"], ensure_ascii=False))
        self.assertEqual(data["strings"]["generations_up"][0], "John")

    def test_chapter_names_fall_back_to_the_branch(self):
        self.build()
        for rel, short in (("story/overview.html", "Smith"), ("cs/story/overview.html", "Smithovi")):
            data = json.loads(re.search(r'id="data">(.*?)</script>', self.read(rel), re.S).group(1))
            self.assertEqual(data["strings"]["chapters"]["overview"]["short"], short)
        self.assertNotIn("huber", data["strings"]["chapters"])    # the generic locale knows no example branch
        self.assertIn("epilogue", data["strings"]["chapters"])

    def test_config_overrides_strings(self):
        self.build(self.edit_config(strings={"en": {"intro": ["Our own family."]}}))
        self.assertIn("<p>Our own family.</p>", self.read("index.html"))
        self.assertNotIn("Our own family.", self.read("cs/index.html"))


    def test_example_texts_come_from_the_config_and_merge_over_the_locale(self):
        path = self.edit_config(strings={"en": {
            "branch_descriptions": {"smith": "A family from Springfield."},
            "chapters": {"overview": {"title": "Our overview", "short": "Ours", "subtitle": "Sub"}}}})
        self.build(path)
        self.assertIn("A family from Springfield.", self.read("index.html"))
        data = json.loads(re.search(r'id="data">(.*?)</script>', self.read("story/overview.html"), re.S).group(1))
        chapters = data["strings"]["chapters"]
        self.assertEqual(chapters["overview"]["title"], "Our overview")
        self.assertIn("epilogue", chapters)             # merged key by key, not replaced
        cs = json.loads(re.search(r'id="data">(.*?)</script>', self.read("cs/story/overview.html"), re.S).group(1))
        self.assertNotIn("A family from Springfield.", json.dumps(cs, ensure_ascii=False))

    def test_generic_locales_name_no_example_branch(self):
        for lang in ("en", "cs"):
            t = json.loads((ROOT / "locales" / f"{lang}.json").read_text(encoding="utf-8"))
            self.assertEqual(t["branch_descriptions"], {})
            self.assertEqual(set(t["chapters"]), {"epilogue"})
            self.assertNotIn("Europe", t["film_intro_sub"])
            self.assertNotIn("Czech", t["untranslated"])


class TestLocalePrivacy(Base):
    def test_german_locale_redacts_and_checks_german_dates(self):
        locales = self.tmp / "locales"
        locales.mkdir()
        en = json.loads((ROOT / "locales" / "en.json").read_text(encoding="utf-8"))
        de = {**en, "language_name": "Deutsch", "privacy": {
            "months": [["Januar"], ["Februar"], ["M\u00e4rz"], ["April"], ["Mai"], ["Juni"], ["Juli"], ["August"],
                       ["September"], ["Oktober"], ["November"], ["Dezember"]],
            "birth_prefixes": ["geb."]}}
        (locales / "de.json").write_text(json.dumps(de), encoding="utf-8")
        (locales / "en.json").write_text(json.dumps(en), encoding="utf-8")
        path = mini_project(self.tmp, chronicle=CHRONICLE.replace(
            "Charles Smith was born", "John Smith (geb. 5. Januar 1995) lives here. Charles Smith was born"))
        data = json.loads(path.read_text(encoding="utf-8"))
        data["languages"] = ["en", "de"]
        data["branches"][0]["name"] = {"en": "Smith", "de": "Schmid"}
        path.write_text(json.dumps(data), encoding="utf-8")
        old = module.LOCALES
        module.LOCALES = locales
        self.addCleanup(setattr, module, "LOCALES", old)
        self.build(path)
        self.assertNotIn("1995", self.read("story/overview.html"))
        self.assertNotIn("privacy", json.dumps(json.loads(
            re.search(r'id="data">(.*?)</script>', self.read("de/map.html"), re.S).group(1))["strings"]))


class TestPrivacy(Base):
    def test_forged_date_inside_hide_passes(self):
        text = CHRONICLE + "\n<!-- web:hide -->John was born on 5 January 1995.<!-- /web:hide -->\n"
        self.build(mini_project(self.tmp, text))

    def test_redaction_removes_date_without_hide(self):
        text = CHRONICLE + "\nJohn Smith (born 5 January 1995) studied.\n"
        self.build(mini_project(self.tmp, text))
        self.assertNotIn("1995", self.read("story/overview.html"))

    def test_date_in_strings_fails_the_check(self):
        cfg = self.edit_config(strings={"en": {"intro": ["John was born on 5 January 1995."]}})
        self.build(cfg, code=1)
        self.assertEqual(self.manifest()["check"], "failed")
        self.assertIn("Output check FAILED", self.stderr)

    def test_unknown_manual_place_leaves_no_manifest(self):
        path = mini_project(self.tmp)
        (path.parent / "events.json").write_text(json.dumps([
            event_json(id="r1", place="Atlantis", description={"cs": "a", "en": "a"})]), encoding="utf-8")
        self.out.mkdir()
        (self.out / "manifest.json").write_text('{"check": "ok"}', encoding="utf-8")
        self.build(path, code=1)
        self.assertFalse((self.out / "manifest.json").exists())

    def test_failed_build_does_not_block_the_next(self):
        path = mini_project(self.tmp)
        self.build(path)                                   # first good build
        good = path.read_text(encoding="utf-8")
        cfg = json.loads(good)
        cfg["root"] = "I999"                               # breaks before the old site is removed
        path.write_text(json.dumps(cfg), encoding="utf-8")
        self.build(path, code=1)
        self.assertFalse((self.out / "manifest.json").exists())
        path.write_text(good, encoding="utf-8")            # user fixes the config
        self.build(path)
        self.assertEqual(self.manifest()["check"], "ok")

    def test_unsafe_output_refused(self):
        path = mini_project(self.tmp)
        base = path.parent
        for out in (Path("/"), Path.home(), base, base / "out", self.tmp):
            self.assertEqual(build(path, out, TODAY), 2, out)

    def test_only_the_site_folder_is_deleted(self):
        self.out.mkdir()
        (self.out / "other.txt").write_text("x")
        self.build()
        (self.out / "site" / "stale.html").write_text("x")
        self.build()
        self.assertTrue((self.out / "other.txt").exists())
        self.assertFalse((self.site / "stale.html").exists())


    def test_foreign_site_folder_is_not_deleted(self):
        (self.out / "site").mkdir(parents=True)
        (self.out / "site" / "precious.txt").write_text("x")
        self.build(code=2)
        self.assertIn("not the output of a previous build", self.stderr)
        self.assertTrue((self.out / "site" / "precious.txt").exists())


class TestConfig(Base):
    def test_missing_key(self):
        path = mini_project(self.tmp)
        data = json.loads(path.read_text(encoding="utf-8"))
        del data["site_dir"]
        path.write_text(json.dumps(data), encoding="utf-8")
        self.build(path, code=1)
        self.assertIn("site_dir", self.stderr)

    def test_bad_site_dir_and_language(self):
        self.build(self.edit_config(site_dir=".."), code=1)
        self.build(self.edit_config(languages=["en", "xx"]), code=1)
        self.assertIn("locales/xx.json", self.stderr)
        self.build(self.edit_config(default_language="fr"), code=1)
        self.assertIn("default_language", self.stderr)

    def test_unreadable_config(self):
        self.build(self.tmp / "nope.json", code=1)

    def test_missing_chronicle_file_is_an_error(self):
        path = self.edit_config()
        (path.parent / "chronicles" / "overview.md").unlink()
        self.build(path, code=1)
        self.assertIn("chronicle file not found", self.stderr)


class TestIdsAndEncoding(Base):
    def test_ids_written_with_at_signs(self):
        path = self.edit_config(root="@I1@", living_town={"@I1@": "Springfield"},
                                living_extra=["@I2@"], deceased_extra=[], exclude=[],
                                branches=[{**CONFIG["branches"][0], "roots": ["@I9@"]}])
        self.build(path)
        p = self.people()
        self.assertEqual(p["I1"]["town"], "Springfield")
        self.assertTrue(p["I2"]["living"])
        self.assertEqual(p["I9"]["branch"], "smith")

    def test_undecodable_gedcom_is_a_clean_error(self):
        path = mini_project(self.tmp)
        (path.parent / "tree.ged").write_bytes("0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Zo\u00eb /M/\n".encode("cp1252"))
        self.build(path, code=1)
        self.assertIn("convert it to UTF-8", self.stderr)
        self.assertNotIn("Traceback", self.stderr)

    def test_ansel_gedcom_is_a_clean_error(self):
        path = mini_project(self.tmp)
        (path.parent / "tree.ged").write_bytes(b"0 HEAD\n1 CHAR ANSEL\n0 TRLR\n")
        self.build(path, code=1)
        self.assertIn("ANSEL", self.stderr)


class TestLanguages(Base):
    def test_english_only_config_needs_no_czech_texts(self):
        path = mini_project(self.tmp)
        (path.parent / "events.json").write_text(json.dumps([
            event_json(id="r1", description={"en": "Moved"})]), encoding="utf-8")
        data = json.loads(path.read_text(encoding="utf-8"))
        data["languages"] = ["en"]
        data["branches"][0]["name"] = {"en": "Smith"}
        path.write_text(json.dumps(data), encoding="utf-8")
        self.build(path)
        for e in self.events():
            self.assertEqual(set(e["description"]), {"en"})
        self.assertFalse((self.site / "cs").exists())

    def test_event_without_a_configured_language_is_an_error(self):
        path = mini_project(self.tmp)
        (path.parent / "events.json").write_text(json.dumps([
            event_json(id="r1", description={"en": "Moved"})]), encoding="utf-8")
        self.build(path, code=1)       # languages are en and cs
        self.assertIn("description needs en, cs", self.stderr)


class TestFocus(Base):
    def test_branch_without_chronicle(self):
        """Review focus 4: no `chronicle` -> the site builds, the branch has no story page."""
        cfg = json.loads(json.dumps(CONFIG))
        del cfg["branches"][0]["chronicle"]
        cfg["branches"].append({"key": "other", "name": {"en": "Other", "cs": "Jiní"}, "roots": ["I11"]})
        self.build(mini_project(self.tmp, config=cfg))
        self.assertFalse((self.site / "story").exists())
        self.assertFalse((self.site / "cs" / "story").exists())
        self.assertNotIn("story/", self.read("index.html"))
        self.assertIn('href="tree.html"', self.read("index.html"))
        modes = re.search(r'<nav class="modes"[^>]*>(.*?)</nav>', self.read("map.html"), re.S).group(1)
        self.assertNotIn("story/", modes)
        self.assertEqual(self.manifest()["check"], "ok")

    def test_example_without_chronicle_branch(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(build(EXAMPLE / "site.json", self.out, TODAY), 0, err.getvalue())
        site = self.out / "family"
        self.assertTrue((site / "story/huber.html").is_file())
        self.assertTrue((site / "story/cerny.html").is_file())
        self.assertFalse((site / "story/kowalski.html").exists())
        self.assertIn("Salzburg", err.getvalue())                  # review focus 3: a warning, not a crash
        self.assertEqual(self.manifest()["check"], "ok")
        events = json.loads(next((site / "data").glob("events-en.*.json")).read_text(encoding="utf-8"))
        self.assertNotIn("Salzburg", json.dumps(events))
        page = (site / "person/I14.html").read_text(encoding="utf-8")
        self.assertIn("Died</dt><dd>1971, Vienna", page)         # the death record agrees with the GEDCOM
        self.assertIn("Death record of Franz Huber, Vienna", page)

    def test_config_path_with_spaces_and_diacritics(self):
        """Review focus 5: a config in `x y/síte.json`, run from another folder."""
        path = mini_project(self.tmp, folder="x y")
        renamed = path.with_name("síte.json")
        path.rename(renamed)
        other = self.tmp / "elsewhere"
        other.mkdir()
        for argument in (str(renamed), os.path.relpath(renamed, other)):
            out = self.tmp / "out2"
            run = subprocess.run(
                [sys.executable, "-I", str(ROOT / "build.py"), "--config", argument,
                 "--out", str(out), "--today", "2026-11-23"],
                cwd=other, capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertIn("check ok", run.stdout)
            self.assertTrue((out / "site" / "story" / "overview.html").is_file())
            self.assertTrue((out / "manifest.json").is_file())
        self.assertEqual(list(other.iterdir()), [])      # nothing written next to the cwd


class TestEvents(Base):
    def test_manual_event_without_document_is_per_chronicle(self):
        path = mini_project(self.tmp)
        (path.parent / "events.json").write_text(json.dumps([
            event_json(id="r1", description={"cs": "a", "en": "a"}, certainty="tree"),
            event_json(id="r2", description={"cs": "b", "en": "b"}, certainty="document", documents=["nothing"]),
            event_json(id="r3", description={"cs": "c", "en": "c"}, certainty="uncertain")]), encoding="utf-8")
        self.build(path)
        events = {e["id"]: e for e in self.events()}
        self.assertEqual([events[i]["certainty"] for i in ("r1", "r2", "r3")],
                         ["chronicle", "chronicle", "uncertain"])
        self.assertEqual(events["birth-I4"]["certainty"], "tree")       # only from the tree: stays

    def test_approval_lists_events_that_lost_a_living_person(self):
        path = mini_project(self.tmp)
        base = event_json(certainty="chronicle")
        (path.parent / "events.json").write_text(json.dumps([
            {**base, "id": "r-mixed", "people": ["I4", "I2"], "description": {"cs": "Mixed", "en": "Mixed event"}},
            {**base, "id": "r-clean", "people": ["I4"], "description": {"cs": "Clean", "en": "Clean event"}},
            {**base, "id": "r-living", "people": ["I2"], "description": {"cs": "Living", "en": "Living only"}}]),
            encoding="utf-8")
        self.build(path)
        approval = (self.out / "approval.md").read_text(encoding="utf-8")
        title = "## Manual events from which a living person was removed"
        section = approval.split(title)[1].split("\n## ")[0]
        self.assertIn("r-mixed", section)
        self.assertIn("1930", section)
        self.assertIn("Mixed event", section)
        self.assertNotIn("r-clean", section)
        self.assertIn("r-living", section)          # dropped entirely, the owner should know
        self.assertNotIn("r-living", json.dumps(self.events()))

    def test_approval_without_such_events_says_none(self):
        self.build()
        approval = (self.out / "approval.md").read_text(encoding="utf-8")
        section = approval.split("## Manual events from which a living person was removed")[1].split("\n## ")[0]
        self.assertIn("none", section)

    def test_missing_place_is_a_warning(self):
        """Review focus 3: a GEDCOM place absent from places.json is left off the map."""
        path = mini_project(self.tmp)
        (path.parent / "places.json").write_text(json.dumps({"Springfield": json.loads(
            (DATA / "places.json").read_text(encoding="utf-8"))["Springfield"]}), encoding="utf-8")
        self.build(path)
        self.assertIn("Millbrook", self.stderr)
        self.assertFalse(any(e["id"] == "birth-I4" for e in self.events()))


class TestDocuments(Base):
    def project(self, docs):
        path = mini_project(self.tmp, documents=docs)
        Image.new("RGB", (200, 100), "white").save(path.parent / "scan.png")
        return path

    def test_document_exported_and_linked(self):
        path = self.project([
            {"id": "d1", "source": "scan.png", "crop": None, "marked": None, "people": ["I4"], "year": 1890,
             "description": {"cs": "Křestní list", "en": "Baptism record"}, "citation": "", "notes": [],
             "foreign_work": False, "verified": True},
            {"id": "d2", "source": "scan.png", "crop": None, "marked": None, "people": ["I1"], "year": 1995,
             "description": {"cs": "Žijící", "en": "Living"}, "citation": "", "notes": [],
             "foreign_work": False, "verified": True}])
        self.build(path)
        p = self.people()
        self.assertEqual(p["I4"]["documents"], ["d1"])
        self.assertNotIn("documents", p["I1"])
        self.assertEqual(len(list((self.site / "documents").glob("*.webp"))), 2)     # crop + sheet, d1 only
        e = next(x for x in self.events() if x["id"] == "birth-I4")
        self.assertEqual(e["documents"], ["d1"])
        self.assertEqual(e["certainty"], "document")
        self.assertIn("Baptism record", self.read("person/I4.html"))
        self.assertIn("Křestní list", self.read("cs/person/I4.html"))
        approval = (self.out / "approval.md").read_text(encoding="utf-8")
        self.assertIn("d2", approval.split("## Withheld documents")[1])

    def test_main_person_has_the_document_others_a_mention(self):
        path = self.project([
            {"id": "d1", "source": "scan.png", "crop": None, "marked": None, "people": ["I4", "I9"],
             "main": ["I4"], "year": 1890, "description": {"cs": "Křest", "en": "Baptism of Joseph"},
             "citation": "", "notes": [], "foreign_work": False, "verified": True}])
        self.build(path)
        p = self.people()
        self.assertEqual(p["I4"]["documents"], ["d1"])
        docs = json.loads(next((self.site / "data").glob("documents.*.json")).read_text(encoding="utf-8"))
        self.assertEqual(set(docs["d1"]), {"description", "crop", "sheet", "verified"})   # what the scripts read
        self.assertEqual(p["I4"]["mentions"], [])
        self.assertEqual(p["I9"]["documents"], [])
        self.assertEqual(p["I9"]["mentions"], ["d1"])
        h9 = self.read("person/I9.html")
        self.assertIn('class="mentions"', h9)
        self.assertIn("Baptism of Joseph", h9)
        self.assertNotIn('class="tree-only"', h9)       # a mention is a document, though not their own
        self.assertNotIn('class="mentions"', self.read("person/I4.html"))

    def test_documents_file_in_a_subfolder_uses_the_config_folder(self):
        path = self.project([
            {"id": "d1", "source": "scan.png", "crop": None, "marked": None, "people": ["I4"],
             "year": 1890, "description": {"en": "Baptism"}, "citation": "", "notes": [],
             "foreign_work": False, "verified": True}])
        (path.parent / "meta").mkdir()
        (path.parent / "documents.json").rename(path.parent / "meta" / "documents.json")
        data = json.loads(path.read_text(encoding="utf-8"))
        data["documents"] = "meta/documents.json"
        path.write_text(json.dumps(data), encoding="utf-8")
        self.build(path)
        self.assertEqual(self.people()["I4"]["documents"], ["d1"])

    def test_without_main_everyone_gets_the_document(self):
        path = self.project([
            {"id": "d1", "source": "scan.png", "crop": None, "marked": None, "people": ["I4", "I9"],
             "year": 1890, "description": {"cs": "Sčítání", "en": "Census"}, "citation": "", "notes": [],
             "foreign_work": False, "verified": True}])
        self.build(path)
        p = self.people()
        self.assertEqual(p["I4"]["documents"], ["d1"])
        self.assertEqual(p["I9"]["documents"], ["d1"])


if __name__ == "__main__":
    unittest.main()
