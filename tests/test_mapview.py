import json
import unittest

from familychronicle import mapview

from tests.test_build import Base, mini_project


class TestBounds(unittest.TestCase):
    def test_bounds_cover_the_places_with_a_margin(self):
        b = mapview.bounds({"A": {"coords": [10.0, 20.0]}, "B": {"coords": [14.0, 30.0]}})
        self.assertEqual(b, [9.0, 17.5, 15.0, 32.5])      # margin: max(1 degree, 25% of the span)

    def test_single_place_gets_the_minimum_margin(self):
        self.assertEqual(mapview.bounds({"A": {"coords": [10.0, 20.0]}}), [9.0, 19.0, 11.0, 21.0])

    def test_southern_hemisphere_and_no_places(self):
        b = mapview.bounds({"A": {"coords": [-34.0, 151.0]}})
        self.assertEqual(b, [-35.0, 150.0, -33.0, 152.0])
        self.assertIsNone(mapview.bounds({}))

    def test_poles_and_date_line_are_clamped(self):
        b = mapview.bounds({"A": {"coords": [89.5, 179.9]}})
        self.assertEqual((b[2], b[3]), (80.0, 180.0))


class TestLabels(unittest.TestCase):
    GOOD = {"text": {"en": "X"}, "lat": 1, "lon": 2, "kind": "town"}

    def test_valid_labels_pass_through(self):
        self.assertEqual(mapview.labels({"map_labels": [self.GOOD]}), [self.GOOD])
        self.assertEqual(mapview.labels({}), [])

    def test_invalid_labels_are_errors(self):
        for bad in ({**self.GOOD, "kind": "lake"}, {**self.GOOD, "lat": "1"}, {**self.GOOD, "lat": 91},
                    {**self.GOOD, "text": "X"}, {**self.GOOD, "text": {}}, "x"):
            with self.assertRaises(ValueError, msg=bad):
                mapview.labels({"map_labels": [bad]})
        with self.assertRaises(ValueError):
            mapview.labels({"map_labels": {}})


class TestBuildWritesMapData(Base):
    def map_file(self):
        f = next((self.site / "data").glob("map.*.json"))
        return json.loads(f.read_text(encoding="utf-8"))

    def test_bounds_and_labels_are_in_the_map_file_and_every_page(self):
        path = self.edit_config(map_labels=[{"text": {"en": "Heartland"}, "lat": 50.0, "lon": 10.0, "kind": "region"}])
        self.build(path)
        m = self.map_file()
        self.assertEqual(len(m["bounds"]), 4)
        self.assertLess(m["bounds"][0], m["bounds"][2])
        self.assertEqual(m["labels"][0]["text"], {"en": "Heartland"})
        page = self.read("map.html")
        self.assertRegex(page, r"data/map\.[0-9a-f]{8}\.json")

    def test_no_labels_by_default(self):
        self.build()
        self.assertEqual(self.map_file()["labels"], [])

    def test_bad_label_stops_the_build_before_touching_the_output(self):
        path = self.edit_config(map_labels=[{"text": {"en": "X"}, "lat": 0, "lon": 0, "kind": "lake"}])
        self.build(path, code=1)
        self.assertIn("map_labels[0]", self.stderr)
        self.assertFalse(self.site.exists())
