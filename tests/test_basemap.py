import json
import tempfile
import unittest
from pathlib import Path

from familychronicle import basemap

DATA = Path(__file__).parent / "data"
SQUARE = {"type": "FeatureCollection", "features": [
    {"type": "Feature", "properties": {"name": "x"}, "geometry": {
        "type": "Polygon", "coordinates": [[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]]}}]}
LINE = {"type": "FeatureCollection", "features": [
    {"type": "Feature", "properties": {}, "geometry": {
        "type": "LineString", "coordinates": [[-5, 5], [15, 5]]}}]}


class TestBbox(unittest.TestCase):
    def test_bbox_from_places(self):
        f = Path(tempfile.mkdtemp()) / "p.json"
        f.write_text(json.dumps({
            "A": {"coords": [48.0, 10.0]}, "B": {"coords": [50.0, 14.0]},
            "C": {"coords": [45.5, 12.0]}}), encoding="utf-8")
        self.assertEqual(basemap.bbox_from_places(f, 3), (7.0, 17.0, 42.5, 53.0))

    def test_bbox_clamped_to_globe(self):
        f = Path(tempfile.mkdtemp()) / "p.json"
        f.write_text(json.dumps({"A": {"coords": [89.0, 179.0]}}), encoding="utf-8")
        self.assertEqual(basemap.bbox_from_places(f, 5), (174.0, 180.0, 84.0, 90.0))

    def test_bbox_needs_places(self):
        f = Path(tempfile.mkdtemp()) / "p.json"
        f.write_text("{}", encoding="utf-8")
        with self.assertRaises(ValueError):
            basemap.bbox_from_places(f, 3)

    def test_parse_bbox(self):
        self.assertEqual(basemap.parse_bbox("5,36,38,55"), (5.0, 36.0, 38.0, 55.0))
        for bad in ("1,2,3", "a,b,c,d", "10,5,1,2", "1,2,9,3"):
            with self.assertRaises(ValueError):
                basemap.parse_bbox(bad)


class TestClip(unittest.TestCase):
    BOX = (5.0, 15.0, 5.0, 15.0)

    def test_ring_is_clipped(self):
        ring = basemap.clip_ring([[0, 0], [20, 0], [20, 20], [0, 20]], self.BOX)
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        self.assertEqual((min(xs), max(xs), min(ys), max(ys)), (5, 15, 5, 15))

    def test_ring_outside_vanishes(self):
        self.assertEqual(basemap.clip_ring([[30, 30], [40, 30], [40, 40]], self.BOX), [])

    def test_line_is_clipped(self):
        parts = basemap.clip_line([[-5, 10], [25, 10]], self.BOX)
        self.assertEqual(parts, [[[5.0, 10.0], [15.0, 10.0]]])

    def test_process_drops_properties_and_rounds(self):
        feats = basemap.process_layer("land", True, SQUARE, self.BOX)
        self.assertEqual(feats[0]["properties"], {"layer": "land"})
        self.assertEqual(feats[0]["geometry"]["type"], "MultiPolygon")
        feats = basemap.process_layer("rivers", False, LINE, self.BOX)
        self.assertEqual(feats[0]["geometry"]["coordinates"], [[[5.0, 5.0], [15.0, 5.0]]])

    def test_main_with_local_dir(self):
        src = Path(tempfile.mkdtemp())
        for name in basemap.LAYERS:
            (src / f"{name}.geojson").write_text(
                json.dumps(SQUARE if basemap.LAYERS[name][1] else LINE), encoding="utf-8")
        out = Path(tempfile.mkdtemp()) / "b.geojson"
        self.assertEqual(basemap.main(["--bbox", "5,15,5,15", "--source-dir", str(src),
                                       "--output", str(out)]), 0)
        data = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual({f["properties"]["layer"] for f in data["features"]},
                         {"land", "lakes", "borders", "rivers"})

    def test_main_default_output_next_to_places(self):
        src = Path(tempfile.mkdtemp())
        for name in basemap.LAYERS:
            (src / f"{name}.geojson").write_text(
                json.dumps(SQUARE if basemap.LAYERS[name][1] else LINE), encoding="utf-8")
        work = Path(tempfile.mkdtemp())
        (work / "places.json").write_text(json.dumps({"A": {"coords": [10, 10]}}), encoding="utf-8")
        basemap.main(["--places", str(work / "places.json"), "--margin", "3",
                      "--source-dir", str(src)])
        self.assertTrue((work / "basemap.geojson").exists())


if __name__ == "__main__":
    unittest.main()
