import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from familychronicle.gedcom import Event, GDate, load
from familychronicle.places import Places, _to_town
from familychronicle.scope import determine_scope
from familychronicle.events import format_date, from_gedcom, manual, migration_lines

DATA = Path(__file__).parent / "data"
CONFIG = {"root": "I1", "branches": [{"key": "a", "roots": ["I9"]}],
          "living_extra": [], "deceased_extra": [], "exclude": []}
SPRINGFIELD = [39.7817, -89.6501]


def d(year, **kw):
    return GDate(year, None, None, kw.get("approximate", False), str(year))


class Base(unittest.TestCase):
    def setUp(self):
        self.places = Places(DATA / "places.json", ["Elsewhere"])
        self.tree = load(DATA / "mini.ged")
        p = self.tree.people
        p["I4"].events[0].place = "Millbrook č. p. 45"      # BIRT ABT 1890
        p["I4"].events[1].place = "Oldtown, Banat"          # DEAT
        p["I4"].events[1].date = d(1950)
        p["I2"].events[0].place = "Springfield-North, Elm Road 12"
        p["I1"].events[0].place = "Springfield"
        p["I5"].events[0].place = "Elsewhere"               # ignored
        self.tree.families["F2"].events.append(Event("MARR", d(1920), "Oldtown"))
        self.scope = determine_scope(self.tree, CONFIG, date(2026, 11, 8))
        self.events = from_gedcom(self.tree, self.scope, self.places)


class TestPlaces(Base):
    def test_address_to_town(self):
        t = self.places.town
        self.assertEqual(t("Springfield-North, Elm Road 12"), "Springfield")
        self.assertEqual(t("Millbrook č. p. 45"), "Millbrook")
        self.assertEqual(t("Millbrook No. 21 (?)"), "Millbrook")
        self.assertEqual(t("Oldtown, Serbia"), "Oldtown")
        self.assertIsNone(t("Nowhere"))
        self.assertIsNone(t(""))

    def test_house_numbers(self):
        for place in ("Upper Willow č. p. 9", "Upper Willow č.p. 57",
                      "Upper Willow čp. 61", "Upper Willow čp.9",
                      "Upper Willow č. 61.", "Upper Willow č.5",
                      "Upper Willow 137", "Upper Willow No. 12",
                      "Upper Willow no.5", "Upper Willow No 7"):
            self.assertEqual(_to_town(place), "Upper Willow", place)
        self.assertEqual(_to_town("Lhota"), "Lhota")

    def test_czech_and_english_addresses(self):
        self.assertEqual(_to_town("Brno, č. p. 12"), "Brno")
        self.assertEqual(_to_town("12 High Street, York"), "York")
        self.assertEqual(_to_town("221b Baker Street, London, England"), "London")
        self.assertEqual(self.places.town("12 High Street, York"), "York")
        self.assertEqual(self.places.town("Brno, č. p. 12"), "Brno")

    def test_coords(self):
        self.assertEqual(self.places.coords("Springfield"), tuple(SPRINGFIELD))
        self.assertIsNone(self.places.coords("Nowhere"))

    def test_missing_place_is_reported_not_fatal(self):
        places = Places(DATA / "places.json", [])
        self.tree.people["I4"].events[0].place = "Atlantis, Harbour Road 3"
        events = from_gedcom(self.tree, self.scope, places)      # must not raise
        self.assertFalse(any(e["id"] == "birth-I4" for e in events))
        self.assertIn("Atlantis", places.missing)
        self.assertIn("Elsewhere", places.missing)               # not ignored here
        self.assertNotIn("Harbour Road 3", places.missing)

    def test_all_missing_with_empty_table(self):
        f = Path(tempfile.mkdtemp()) / "p.json"
        f.write_text("{}", encoding="utf-8")
        places = Places(f, [])
        self.assertEqual(from_gedcom(self.tree, self.scope, places), [])
        self.assertTrue({"Millbrook", "Oldtown"} <= places.missing)
        self.assertNotIn("Elm Road 12", places.missing)

    def test_ignored_is_not_missing(self):
        self.assertFalse(any("I5" in e["people"] and e["type"] == "birth" for e in self.events))
        self.assertNotIn("Elsewhere", self.places.missing)


class TestEvents(Base):
    def test_living_have_no_events(self):
        self.assertFalse(any("I1" in e["people"] or "I2" in e["people"] for e in self.events))

    def test_shape_and_date(self):
        e = next(e for e in self.events if e["id"] == "birth-I4")
        self.assertEqual(e["date"], "about 1890")
        self.assertEqual(e["certainty"], "tree")
        self.assertEqual(e["documents"], [])
        self.assertEqual(e["place"], "Millbrook")
        self.assertEqual(e["year"], 1890)
        self.assertEqual(sorted(e), sorted(
            ["id", "type", "year", "date", "place", "branch", "people", "description",
             "documents", "certainty"]))
        self.assertIn("cs", e["description"])
        self.assertIn("en", e["description"])

    def test_marriage(self):
        self.assertTrue(any(e["id"] == "marriage-F2" for e in self.events))
        self.assertFalse(any(e["id"] == "marriage-F1" for e in self.events))

    def test_format_date(self):
        self.assertEqual(format_date(GDate(1890, 3, 5, False, ""), "en"), "5 Mar 1890")
        self.assertEqual(format_date(GDate(1890, 3, None, False, ""), "en"), "March 1890")
        self.assertEqual(format_date(GDate(1890, None, None, True, ""), "cs"), "kolem 1890")
        self.assertEqual(format_date(GDate(1890, 3, None, False, ""), "cs"), "březen 1890")
        self.assertEqual(format_date(GDate(1890, 3, 5, False, ""), "cs"), "5. 3. 1890")
        self.assertEqual(format_date(GDate(None, None, None, False, "before Easter"), "en"), "before Easter")
        self.assertEqual(format_date(None), "")

    def test_manual(self):
        f = Path(tempfile.mkdtemp()) / "e.json"
        base = {"id": "x", "type": "war", "year": 1942, "date": "1942", "place": "Oldtown, Serbia",
                "branch": "a", "people": ["I4"], "description": {"cs": "a", "en": "b"},
                "documents": [], "certainty": "uncertain"}
        f.write_text(json.dumps([base]), encoding="utf-8")
        self.assertEqual(manual(f, self.places)[0]["place"], "Oldtown")
        del base["certainty"]
        f.write_text(json.dumps([base]), encoding="utf-8")
        with self.assertRaises(ValueError):
            manual(f, self.places)

    def test_manual_rejects_bad_type_and_certainty(self):
        f = Path(tempfile.mkdtemp()) / "e.json"
        base = {"id": "x", "type": "party", "year": 1, "date": "1", "place": "Oldtown",
                "branch": "a", "people": [], "description": {"cs": "a", "en": "b"},
                "documents": [], "certainty": "maybe"}
        f.write_text(json.dumps([base]), encoding="utf-8")
        with self.assertRaises(ValueError) as e:
            manual(f, self.places)
        self.assertIn("party", str(e.exception))
        self.assertIn("maybe", str(e.exception))


class TestMigrationLines(Base):
    def test_line_to_living_child_without_year(self):
        last = [l for l in migration_lines(self.tree, self.scope, self.events, self.places,
                                           {"I2": "Springfield"}) if l["to"] == "I2"][0]["points"][-1]
        self.assertIsNone(last[2])
        self.assertEqual(last[:2], SPRINGFIELD)

    def test_line_to_living_child_without_town_ends_at_parent(self):
        line = [l for l in migration_lines(self.tree, self.scope, self.events, self.places)
                if l["to"] == "I2"][0]
        self.assertEqual([p[2] for p in line["points"]], [1890, 1920])
        self.assertNotIn(SPRINGFIELD, [p[:2] for p in line["points"]])

    def test_point_has_certainty(self):
        for line in migration_lines(self.tree, self.scope, self.events, self.places):
            for p in line["points"]:
                self.assertIn(p[3], ("document", "tree", "chronicle", "uncertain"))

    def test_point_order(self):
        line = [l for l in migration_lines(self.tree, self.scope, self.events, self.places,
                                           {"I2": "Springfield"}) if l["to"] == "I2"][0]
        # death in 1950 at Oldtown merges with the marriage point
        self.assertEqual([p[2] for p in line["points"]], [1890, 1920, None])
        self.assertEqual(line["from"], "I4")

    def test_output_has_no_street_addresses(self):
        out = json.dumps(self.events + migration_lines(self.tree, self.scope, self.events, self.places),
                         ensure_ascii=False)
        self.assertNotIn("Elm Road", out)


if __name__ == "__main__":
    unittest.main()
