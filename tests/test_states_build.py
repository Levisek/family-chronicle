"""Historical states, colour modes, themes and the settings panel in the built site."""
import json
import re

from tests.test_build import Base, mini_project

STATES = {
    "flags": {"red": {"stripes": ["#aa0000", "#ffffff"], "color": "#aa5555"},
              "blue": {"stripes": ["#0000aa"], "direction": "vertical"}},
    "states": {"kingdom": {"name": {"en": "Kingdom of Mill", "cs": "Království Mill"}, "flag": "red"},
               "republic": {"name": {"en": "Mill Republic", "cs": "Republika Mill"}, "flag": "blue"}},
    "regions": {"Slovakia": [[0, "kingdom"], [1918.9, "republic"]]},
}


def project_with_states(tmp, states=STATES, config_value="states.json"):
    path = mini_project(tmp)
    config = json.loads(path.read_text(encoding="utf-8"))
    if config_value is not None:
        config["states"] = config_value
    path.write_text(json.dumps(config), encoding="utf-8")
    if states is not None:
        (path.parent / "states.json").write_text(json.dumps(states), encoding="utf-8")
    return path


def page_data(html):
    return json.loads(re.search(r'id="data">(.*?)</script>', html, re.S).group(1))


class TestStatesInThePeopleFile(Base):
    def test_deceased_get_states_and_the_living_never(self):
        self.build(project_with_states(self.tmp))
        people = self.people()
        self.assertEqual(people["I4"]["states"], [["kingdom", 1890, 1890]])     # born in Millbrook, Slovakia
        for living in ("I1", "I2", "I3"):
            self.assertNotIn("states", people[living])
        self.assertNotIn("states", people["I5"])                                # no place: no region, no state

    def test_without_a_states_file_nothing_changes(self):
        self.build()
        self.assertNotIn("states", self.people()["I4"])
        data = page_data(self.read("tree.html"))
        self.assertNotIn("states", data)
        self.assertNotIn("flags", data)
        self.assertEqual(data["color_modes"], ["branch", "era", "documented"])

    def test_the_page_data_carries_states_flags_and_modes(self):
        self.build(project_with_states(self.tmp))
        for rel in ("tree.html", "fan.html", "cs/tree.html", "index.html"):
            data = page_data(self.read(rel))
            self.assertEqual(data["color_modes"], ["branch", "state", "era", "documented"], rel)
            self.assertEqual(set(data["states"]), {"kingdom", "republic"})
            self.assertEqual(data["states"]["kingdom"]["flag"], "red")
            self.assertTrue(data["flags"]["red"]["src"].startswith("data:image/svg+xml,"))
            self.assertEqual(data["flags"]["red"]["color"], "#aa5555")
            self.assertTrue(data["flags"]["blue"]["color"].startswith("hsl("))   # a default colour is filled in
        self.assertEqual(page_data(self.read("cs/tree.html"))["states"]["kingdom"]["name"]["cs"], "Království Mill")

    def test_person_page_shows_the_states_without_years(self):
        self.build(project_with_states(self.tmp))
        h = self.read("person/I4.html")
        row = re.search(r"<dt>Historical states</dt><dd>(.*?)</dd>", h, re.S).group(1)
        self.assertIn("Kingdom of Mill", row)
        self.assertIn('src="data:image/svg+xml,', row)
        self.assertNotRegex(re.sub(r"<[^>]+>", "", row), r"\d{4}")          # the text of the row has no years
        cs = self.read("cs/person/I4.html")
        self.assertIn("<dt>Dobové státy</dt>", cs)
        self.assertIn("Království Mill", cs)

    def test_person_page_without_states_has_no_row(self):
        self.build(project_with_states(self.tmp))
        self.assertNotIn("<dt>Historical states</dt>", self.read("person/I5.html"))

    def test_manifest_is_ok_with_the_flags_in_the_output(self):
        self.build(project_with_states(self.tmp))
        self.assertEqual(self.manifest()["check"], "ok")


class TestStatesConfigErrors(Base):
    def stops(self, path, fragment):
        self.build(path, code=1)
        self.assertIn(fragment, self.stderr)

    def test_missing_file(self):
        self.stops(project_with_states(self.tmp, states=None), "states file")

    def test_not_a_name(self):
        self.stops(project_with_states(self.tmp, config_value=5), "states must be")

    def test_unknown_flag(self):
        bad = {**STATES, "states": {"x": {"name": {"en": "X", "cs": "X"}, "flag": "nope"}}, "regions": {}}
        self.stops(project_with_states(self.tmp, states=bad), "flag 'nope'")

    def test_name_missing_in_a_language(self):
        bad = {**STATES, "states": {"x": {"name": {"en": "X"}, "flag": "red"}}, "regions": {}}
        self.stops(project_with_states(self.tmp, states=bad), "missing for cs")

    def test_region_with_an_unknown_state(self):
        bad = {**STATES, "regions": {"Slovakia": [[0, "ghost"]]}}
        self.stops(project_with_states(self.tmp, states=bad), "unknown state")


class TestThemesAndSettings(Base):
    PAGES = ("index.html", "tree.html", "fan.html", "map.html", "story/overview.html", "person/I4.html",
             "cs/index.html", "cs/tree.html")

    def test_theme_in_head_without_defer_and_themes_css_last(self):
        self.build()
        for rel in self.PAGES:
            h = self.read(rel)
            head = h.split("</head>")[0]
            self.assertRegex(head, r'<script src="[^"]*static/theme\.[0-9a-f]{8}\.js"></script>\n$', rel)
            sheets = re.findall(r'<link rel="stylesheet" href="[^"]*static/([a-z-]+)\.[0-9a-f]{8}\.css">', head)
            self.assertEqual(sheets[-1], "themes", rel)                      # overrides the styles of the page
            self.assertEqual(sheets[:2], ["branches", "style"], rel)

    def test_settings_panel_script_is_last_and_on_every_page(self):
        self.build()
        for rel in self.PAGES:
            h = self.read(rel)
            scripts = re.findall(r'<script src="[^"]*static/([a-z-]+)\.[0-9a-f]{8}\.js"( defer)?></script>', h)
            self.assertEqual(scripts[0], ("theme", ""), rel)
            self.assertEqual(scripts[-1], ("settings", " defer"), rel)

    def test_tree_and_fan_load_coloring_before_common(self):
        self.build()
        for rel in ("tree.html", "fan.html"):
            names = [n for n, _ in re.findall(r'static/([a-z-]+)\.[0-9a-f]{8}\.js"( defer)?>', self.read(rel))]
            self.assertLess(names.index("coloring"), names.index("common"), rel)
        names = re.findall(r'static/([a-z-]+)\.[0-9a-f]{8}\.js', self.read("map.html"))
        self.assertNotIn("coloring", names)

    def test_strings_for_the_panel_exist_in_both_languages(self):
        self.build()
        for rel in ("tree.html", "cs/tree.html"):
            t = page_data(self.read(rel))["strings"]
            for key in ("settings_label", "settings_appearance", "settings_colors", "settings_note", "theme_chronicle",
                        "theme_night", "theme_atlas", "colors_label", "color_mode_branch", "color_mode_state",
                        "color_mode_era", "color_mode_documented", "color_documented_yes", "color_documented_no",
                        "color_living", "color_state_unknown", "color_era_unknown", "person_states"):
                self.assertTrue(t.get(key), f"{key} in {rel}")

    def test_no_inline_script_or_style_was_added(self):
        self.build()
        for rel in self.PAGES:
            h = self.read(rel)
            self.assertNotRegex(h, r"<style", rel)
            self.assertNotRegex(h, r"\sstyle=", rel)
            self.assertEqual(len(re.findall(r"<script(?![^>]*\bsrc=)(?![^>]*application/json)", h)), 0, rel)


class TestMapChapter(Base):
    """`map_chapter`: a branch whose stops join the map chapter of another branch."""

    def with_branches(self, *extra):
        path = mini_project(self.tmp)
        config = json.loads(path.read_text(encoding="utf-8"))
        config["branches"] += list(extra)
        path.write_text(json.dumps(config), encoding="utf-8")
        return path

    def branch(self, key, **more):
        return {"key": key, "name": {"en": key, "cs": key}, "color": "#445566", "roots": ["I9"], **more}

    def test_passed_to_the_page_data(self):
        self.build(self.with_branches(self.branch("kin", map_chapter="smith")))
        branches = {b["key"]: b for b in page_data(self.read("map.html"))["branches"]}
        self.assertEqual(branches["kin"]["map_chapter"], "smith")
        self.assertIsNone(branches["smith"]["map_chapter"])

    def test_unknown_or_own_key(self):
        self.build(self.with_branches(self.branch("kin", map_chapter="ghost")), code=1)
        self.assertIn("map_chapter must be the key of another branch", self.stderr)
        self.build(self.with_branches(self.branch("kin", map_chapter="kin")), code=1)
        self.assertIn("map_chapter must be the key of another branch", self.stderr)

    def test_no_chains(self):
        self.build(self.with_branches(self.branch("kin", map_chapter="smith"), self.branch("far", map_chapter="kin")), code=1)
        self.assertIn("no chains", self.stderr)
