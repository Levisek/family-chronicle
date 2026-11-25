import json
import tempfile
import unittest
from pathlib import Path

from familychronicle import states as states_module
from familychronicle.gedcom import GDate, load as load_tree, parse_date
from familychronicle.places import Places
from familychronicle.states import States, StatesError, load, moment

LANGS = ["en", "cs"]

DATA = {
    "flags": {
        "stripes": {"stripes": ["#111111", "#eeeeee"]},
        "vertical": {"stripes": ["#002b7f", "#fcd116", "#ce1126"], "direction": "vertical", "color": "#aa5500"},
        "triangle": {"stripes": ["#ffffff", "#d7141a"], "hoist_triangle": "#11457e"},
    },
    "states": {
        "old": {"name": {"en": "Old Realm", "cs": "Stará říše"}, "flag": "stripes"},
        "union": {"name": {"en": "Union", "cs": "Unie"}, "flag": "stripes"},
        "republic": {"name": {"en": "Republic", "cs": "Republika"}, "flag": "triangle"},
        "annexed": {"name": {"en": "Annexed", "cs": "Zabrané"}, "flag": "vertical"},
    },
    "regions": {
        "Northland": [[0, "old"], [1867.45, "union"], [1918.82, "republic"]],
        "Northland (border)": [[0, "old"], [1918.82, "republic"], [1938.76, "annexed"], [1945.35, "republic"]],
    },
}

PLACES = {
    "Alpha": {"coords": [1, 1], "country": {"en": "Northland", "cs": "Sever"}},
    "Beta": {"coords": [2, 2], "country": {"en": "Northland", "cs": "Sever"}, "region": "Northland (border)"},
    "Gamma": {"coords": [3, 3], "country": {"en": "Elsewhere", "cs": "Jinde"}},
}


def make(**changes) -> States:
    data = json.loads(json.dumps(DATA))
    data.update(changes)
    return States(data, LANGS)


class TestValidation(unittest.TestCase):
    def fails(self, fragment, **changes):
        with self.assertRaises(StatesError) as cm:
            make(**changes)
        self.assertIn(fragment, str(cm.exception))

    def test_valid(self):
        s = make()
        self.assertEqual(set(s.states), {"old", "union", "republic", "annexed"})

    def test_flag_needs_colours(self):
        self.fails("stripes", flags={"f": {"stripes": ["red"]}, **DATA["flags"]})
        self.fails("stripes", flags={"f": {"stripes": []}, **DATA["flags"]})
        self.fails("stripes", flags={"f": {"stripes": ["#111111"] * 7}, **DATA["flags"]})
        self.fails("direction", flags={"f": {"stripes": ["#111111"], "direction": "diagonal"}, **DATA["flags"]})
        self.fails("hoist_triangle", flags={"f": {"stripes": ["#111111"], "hoist_triangle": "blue"}, **DATA["flags"]})
        self.fails("color", flags={"f": {"stripes": ["#111111"], "color": 5}, **DATA["flags"]})

    def test_state_needs_a_name_in_every_language_and_a_known_flag(self):
        self.fails("missing for cs", states={"x": {"name": {"en": "X"}, "flag": "stripes"}})
        self.fails("missing for en", states={"x": {"name": {"en": " ", "cs": "X"}, "flag": "stripes"}})
        self.fails("name must map", states={"x": {"name": "X", "flag": "stripes"}})
        self.fails("flag 'nope'", states={"x": {"name": {"en": "X", "cs": "X"}, "flag": "nope"}})

    def test_region_rules(self):
        self.fails("unknown state", regions={"R": [[0, "nowhere"]]})
        self.fails("non-empty", regions={"R": []})
        self.fails("strictly increasing", regions={"R": [[1900, "old"], [1800, "union"]]})
        self.fails("strictly increasing", regions={"R": [[1900, "old"], [1900, "union"]]})
        self.fails("[from_year, state]", regions={"R": [["1900", "old"]]})
        self.fails("[from_year, state]", regions={"R": [[True, "old"]]})
        self.fails("[from_year, state]", regions={"R": [[1900]]})

    def test_wrong_shape(self):
        with self.assertRaises(StatesError):
            States([], LANGS)
        with self.assertRaises(StatesError):
            States({"flags": []}, LANGS)

    def test_load_reports_a_missing_or_broken_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(StatesError):
                load(Path(tmp) / "none.json", LANGS)
            bad = Path(tmp) / "bad.json"
            bad.write_text("{", encoding="utf-8")
            with self.assertRaises(StatesError):
                load(bad, LANGS)
            good = Path(tmp) / "good.json"
            good.write_text(json.dumps(DATA), encoding="utf-8")
            self.assertIn("old", load(good, LANGS).states)


class TestFlags(unittest.TestCase):
    def test_svg_stripes_and_triangle(self):
        s = make()
        horizontal = s.flag_svg("stripes")
        self.assertEqual(horizontal.count("<rect"), 3)        # two stripes and the outline
        self.assertIn('fill="#111111"', horizontal)
        self.assertIn('y="10.000"', horizontal)               # the second stripe starts at half height
        vertical = s.flag_svg("vertical")
        self.assertIn('x="10.000"', vertical)
        self.assertNotIn("<path", vertical)
        self.assertIn('<path d="M0 0L15 10L0 20Z" fill="#11457e"/>', s.flag_svg("triangle"))

    def test_uri_is_a_self_contained_image(self):
        uri = make().flag_uri("stripes")
        self.assertTrue(uri.startswith("data:image/svg+xml,"))
        self.assertNotIn("<", uri)
        self.assertNotIn('"', uri)

    def test_colour_given_or_a_distinct_default(self):
        s = make()
        self.assertEqual(s.flags["vertical"]["color"], "#aa5500")
        a, b = s.flags["stripes"]["color"], s.flags["triangle"]["color"]
        self.assertTrue(a.startswith("hsl(") and b.startswith("hsl("))
        self.assertNotEqual(a, b)

    def test_page_data(self):
        d = make().page_data()
        self.assertEqual(set(d), {"states", "flags"})
        self.assertEqual(d["states"]["old"], {"name": {"en": "Old Realm", "cs": "Stará říše"}, "flag": "stripes"})
        self.assertTrue(d["flags"]["vertical"]["src"].startswith("data:image/svg+xml,"))
        self.assertEqual(d["flags"]["vertical"]["color"], "#aa5500")
        json.dumps(d)                                          # serialisable for the page


class TestTimeline(unittest.TestCase):
    def test_state_at(self):
        s = make()
        self.assertEqual(s.state_at("Northland", 1850), "old")
        self.assertEqual(s.state_at("Northland", 1900), "union")
        self.assertEqual(s.state_at("Northland (border)", 1941), "annexed")
        self.assertIsNone(s.state_at("Atlantis", 1900))

    def test_one_place(self):
        z = make().lifetime([(1900.5, "Northland"), (1980.5, "Northland")])
        self.assertEqual([x[0] for x in z], ["union", "republic"])
        self.assertEqual((z[0][1], z[-1][2]), (1900, 1980))

    def test_moves_and_a_point_without_a_place(self):
        z = make().lifetime([(1890.5, "Northland (border)"), (1912.5, "Northland"), (1930.5, None)])
        self.assertEqual([x[0] for x in z], ["old", "union", "republic"])

    def test_a_region_change_in_the_middle(self):
        z = make().lifetime([(1930.5, "Northland (border)"), (1946.5, "Northland (border)")])
        self.assertEqual([x[0] for x in z], ["republic", "annexed", "republic"])

    def test_single_point_and_nothing_known(self):
        s = make()
        self.assertEqual(s.lifetime([(1850.0, "Northland")]), [["old", 1850, 1850]])
        self.assertEqual(s.lifetime([(1850.0, None)]), [])
        self.assertEqual(s.lifetime([]), [])

    def test_unknown_region_is_skipped(self):
        self.assertEqual(make().lifetime([(1850.0, "Atlantis"), (1900.0, "Atlantis")]), [])

    def test_moment(self):
        self.assertEqual(moment(parse_date("1900")), 1900.5)
        self.assertAlmostEqual(moment(parse_date("MAR 1900")), 1900 + 2 / 12)
        self.assertAlmostEqual(moment(parse_date("1 JAN 1900")), 1900.0)
        self.assertIsNone(moment(None))
        self.assertIsNone(moment(GDate(None, None, None, False, "unknown")))


class TestPeople(unittest.TestCase):
    GED = """0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Ann /Test/
1 BIRT
2 DATE 1900
2 PLAC Alpha
1 DEAT
2 DATE 1960
2 PLAC Alpha
1 FAMS @F1@
0 @I2@ INDI
1 NAME Bob /Test/
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I1@
1 MARR
2 DATE 1938
2 PLAC Beta
"""

    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.addCleanup(self._t.cleanup)
        tmp = Path(self._t.name)
        (tmp / "t.ged").write_text(self.GED, encoding="utf-8")
        (tmp / "places.json").write_text(json.dumps(PLACES), encoding="utf-8")
        self.tree = load_tree(tmp / "t.ged")
        self.places = Places(tmp / "places.json", [])
        self.states = make()

    def test_region_of_prefers_the_place_region_then_the_country(self):
        s, p = self.states, self.places
        self.assertEqual(s.region_of(p, "Alpha", "en"), "Northland")
        self.assertEqual(s.region_of(p, "Beta", "en"), "Northland (border)")
        self.assertIsNone(s.region_of(p, "Gamma", "en"))        # a country without a timeline
        self.assertIsNone(s.region_of(p, "Nowhere", "en"))
        self.assertIsNone(s.region_of(p, None, "en"))
        self.assertIsNone(s.region_of(p, "Alpha", "cs"))        # the country is read in the default language

    def test_marriage_with_a_deceased_partner_counts(self):
        z = self.states.person_states(self.tree, self.places, "I1", "en", set())
        self.assertEqual([x[0] for x in z], ["union", "republic", "annexed", "republic"])   # the marriage place is in the border region
        self.assertEqual(z[-1][1:], [1945, 1960])

    def test_marriage_with_a_living_partner_is_left_out(self):
        z = self.states.person_states(self.tree, self.places, "I1", "en", {"I2"})
        self.assertEqual([x[0] for x in z], ["union", "republic"])
        self.assertEqual(z[-1][2], 1960)
        self.assertNotIn(1938, [y for x in z for y in x[1:]])


if __name__ == "__main__":
    unittest.main()
