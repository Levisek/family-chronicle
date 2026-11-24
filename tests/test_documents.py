import hashlib
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from PIL import Image

from familychronicle import config as config_module
from familychronicle import documents as module
from familychronicle.documents import (decide, document_for_image, export,
                                       is_verified, load_documents)
from familychronicle.documents_draft import draft
from familychronicle.gedcom import load
from familychronicle.scope import determine_scope

DATA = Path(__file__).parent / "data"
MINI = DATA / "mini.ged"
EXAMPLE_DIR = Path(__file__).resolve().parents[1] / "example"
CONFIG = {"root": "I1", "branches": [{"key": "a", "roots": ["I9"]}],
          "living_extra": [], "deceased_extra": [], "exclude": ["I13"]}


def doc(**kw):
    d = {"id": "t", "source": "x.jpg", "crop": None, "marked": None, "people": ["I4"],
         "year": 1900, "description": {"cs": "a", "en": "b"}, "citation": "c", "notes": [],
         "foreign_work": False, "verified": None}
    d.update(kw)
    return d


class TestDecide(unittest.TestCase):
    def setUp(self):
        self.scope = determine_scope(load(MINI), CONFIG, date(2026, 11, 8))
        self.base = Path("/nonexistent-base")

    def decide(self, docs):
        return decide(docs, self.scope, self.base)

    def test_deceased_person_is_published(self):
        self.assertIn("I4", self.scope.people)
        self.assertNotIn("I4", self.scope.living)
        self.assertEqual(len(self.decide([doc(people=["I4"])])[0]), 1)

    def test_withheld_when_one_person_is_living(self):
        self.assertIn("I2", self.scope.living)
        pub, held = self.decide([doc(people=["I4", "I2"], year=1947)])
        self.assertEqual(pub, [])
        self.assertIn("I2", held[0][1])

    def test_excluded_and_unknown_person(self):
        for p in ("I13", "I999"):
            pub, held = self.decide([doc(people=["I4", p])])
            self.assertEqual(pub, [])
            self.assertIn(p, held[0][1])

    def test_no_people_only_before_cutoff_year(self):
        self.assertEqual(len(self.decide([doc(people=[], year=1930)])[0]), 1)
        self.assertEqual(len(self.decide([doc(people=[], year=1960)])[0]), 0)
        self.assertEqual(len(self.decide([doc(people=[], year=None)])[0]), 0)

    def test_cutoff_year_is_a_parameter(self):
        d = [doc(people=[], year=1960)]
        self.assertEqual(len(decide(d, self.scope, self.base, cutoff_year=1970)[0]), 1)
        self.assertEqual(len(decide(d, self.scope, self.base, cutoff_year=1950)[0]), 0)

    def test_foreign_work_only_as_crop(self):
        pub, held = self.decide([doc(foreign_work=True, crop=None)])
        self.assertEqual(pub, [])
        self.assertEqual(len(self.decide([doc(foreign_work=True, crop=[0, 0, 5, 5])])[0]), 1)

    def test_foreign_work_crop_in_crops_folder(self):
        ok = self.decide([doc(foreign_work=True, source="V/crops/01 a.png")])[0]
        self.assertEqual(len(ok), 1)
        self.assertEqual(self.decide([doc(foreign_work=True, source="V/crops.png")])[0], [])
        self.assertEqual(self.decide([doc(foreign_work=True, source="V/a.pdf#0")])[0], [])

    def test_gray_colour_excludes(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t).resolve()
            Image.new("RGB", (10, 10)).save(t / "09 a.png")
            (t / "colors.json").write_text('{"09": "gray"}')
            pub, held = decide([doc(source="09 a.png")], self.scope, t)
            self.assertEqual(pub, [])
            self.assertIn("excluded", held[0][1])

    def test_withheld_reasons_are_english(self):
        _, held = self.decide([doc(people=["I2"]), doc(people=[], year=2000)])
        for _, reason in held:
            self.assertTrue(reason.isascii(), reason)


class TestExport(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.t = Path(self._t.name).resolve()
        self.addCleanup(self._t.cleanup)

    def jpeg_with_exif(self):
        im = Image.new("RGB", (3000, 2000), (200, 30, 30))
        ex = Image.Exif()
        ex[0x010F] = "Camera"
        ex[0x8825] = {1: "N", 2: (50.0, 5.0, 3.0), 3: "E", 4: (17.0, 1.0, 1.0)}
        p = self.t / "source.jpg"
        im.save(p, exif=ex, icc_profile=b"x" * 10)
        return p

    def export(self, d, dest=None, base=None):
        return export(d, dest or self.t / "out", base or self.t)

    def test_no_exif(self):
        p = self.jpeg_with_exif()
        self.assertTrue(Image.open(p).getexif().get_ifd(0x8825))
        out = self.t / "out"
        v = self.export(doc(id="a", source=str(p)))
        for k in ("crop", "sheet"):
            im = Image.open(out / v[k])
            self.assertEqual(len(im.getexif()), 0)
            for key in ("exif", "icc_profile", "xmp"):
                self.assertNotIn(key, im.info)
            self.assertEqual(im.format, "WEBP")
            data = (out / v[k]).read_bytes()
            self.assertNotIn(b"EXIF", data)
            self.assertNotIn(b"Camera", data)
            self.assertIn(hashlib.sha256(data).hexdigest()[:8], v[k])
        self.assertEqual(max(Image.open(out / v["crop"]).size), 1400)
        self.assertEqual((v["width"], v["height"]), Image.open(out / v["crop"]).size)
        self.assertTrue(v["crop"].startswith("documents/a-"))
        self.assertTrue(v["sheet"].startswith("documents/a-sheet-"))

    def test_crop_and_marked_copy(self):
        p = self.jpeg_with_exif()
        Image.new("RGB", (500, 300)).save(self.t / "marked.jpg")
        v = self.export(doc(id="b", source=str(p), crop=[0, 0, 600, 400],
                            marked=str(self.t / "marked.jpg")))
        self.assertEqual((v["width"], v["height"]), (600, 400))
        self.assertEqual(Image.open(self.t / "out" / v["sheet"]).size, (500, 300))

    def test_foreign_work_has_no_sheet(self):
        p = self.jpeg_with_exif()
        v = self.export(doc(source=str(p), crop=[0, 0, 600, 400], foreign_work=True))
        self.assertIsNone(v["sheet"])

    def test_crop_only_has_no_sheet(self):
        """A sheet that also mentions a living person: only the crop is published."""
        p = self.jpeg_with_exif()
        v = self.export(doc(source=str(p), crop=[0, 0, 600, 400], crop_only=True))
        self.assertIsNone(v["sheet"])
        self.assertEqual((v["width"], v["height"]), (600, 400))

    def test_load_validation(self):
        p = self.jpeg_with_exif()
        f = self.t / "d.json"
        f.write_text(json.dumps([doc(source=str(p))]))
        self.assertEqual(len(load_documents(f, self.t)), 1)
        f.write_text(json.dumps([doc(source=str(p)), doc(source=str(p))]))
        with self.assertRaises(ValueError):
            load_documents(f, self.t)
        f.write_text(json.dumps([doc(source=str(self.t / "missing.jpg"))]))
        with self.assertRaises(ValueError):
            load_documents(f, self.t)
        f.write_text(json.dumps([doc(source=str(p), marked=str(self.t / "missing.jpg"))]))
        with self.assertRaises(ValueError):
            load_documents(f, self.t)
        # main people must be among the linked people
        f.write_text(json.dumps([doc(source=str(p), people=["I4"], main=["I9"])]))
        with self.assertRaises(ValueError):
            load_documents(f, self.t)
        f.write_text(json.dumps([doc(source=str(p), people=["I4", "I9"], main=["I9"])]))
        self.assertEqual(load_documents(f, self.t)[0]["main"], ["I9"])

    def test_draft_description_has_the_configured_languages(self):
        Image.new("RGB", (10, 10)).save(self.t / "z.png")
        d = draft(self.t, [], languages=("en", "de"))
        self.assertEqual(d[0]["description"], {"en": "", "de": ""})

    def test_load_resolves_relative_to_the_base_dir(self):
        """Paths are relative to the base directory (the config's), not to documents.json."""
        sub = self.t / "dir with spaces ž"
        sub.mkdir()
        Image.new("RGB", (10, 10)).save(sub / "a.png")
        f = sub / "documents.json"
        f.write_text(json.dumps([doc(source="dir with spaces ž/a.png")]))
        self.assertEqual(len(load_documents(f, self.t)), 1)
        f.write_text(json.dumps([doc(source="a.png")]))      # relative to the file: no longer valid
        with self.assertRaises(ValueError):
            load_documents(f, self.t)

    def test_verified_from_colours(self):
        Image.new("RGB", (10, 10)).save(self.t / "01 a.png")
        (self.t / "colors.json").write_text('{"01": "blue"}')
        self.assertFalse(is_verified(doc(source="01 a.png"), self.t))
        self.assertTrue(is_verified(doc(source="02 a.png"), self.t))
        self.assertTrue(is_verified(doc(source="01 a.png", verified=True), self.t))

    def test_foreign_work_without_crop_raises(self):
        p = self.jpeg_with_exif()
        with self.assertRaises(ValueError):
            self.export(doc(source=str(p), crop=None, foreign_work=True))
        self.assertFalse((self.t / "out").exists())

    def test_path_outside_base_dir(self):
        (self.t / "repo").mkdir()
        for s in (str(self.jpeg_with_exif()), "../source.jpg"):
            with self.assertRaises(ValueError):
                self.export(doc(source=s), base=self.t / "repo")

    def test_transparent_png_on_white(self):
        Image.new("RGBA", (50, 50), (255, 0, 0, 0)).save(self.t / "p.png")
        v = self.export(doc(id="p", source=str(self.t / "p.png")))
        px = Image.open(self.t / "out" / v["crop"]).getpixel((10, 10))
        self.assertTrue(all(c > 245 for c in px), px)

    def test_pdf_source(self):
        import pymupdf
        d = pymupdf.open()
        d.new_page(width=200, height=300)
        d.save(self.t / "a.pdf")
        v = self.export(doc(source="a.pdf#90"))
        self.assertEqual((v["width"], v["height"]), (660, 440))


class TestPairing(unittest.TestCase):
    def test_pairing(self):
        a = doc(id="a", source="s.jpg", crop=[1, 2, 3, 4])
        b = doc(id="b", source="s.jpg", crop=None)
        self.assertIs(document_for_image([a, b], "s.jpg", (1, 2, 3, 4)), a)
        self.assertIs(document_for_image([a, b], "s.jpg", None), b)
        self.assertIsNone(document_for_image([a, b], "other.jpg", None))


class TestExample(unittest.TestCase):
    def test_example_documents_load_and_decide(self):
        cfg = config_module.load(EXAMPLE_DIR / "site.json")
        docs = load_documents(cfg.path("documents"), cfg.base_dir)
        self.assertGreaterEqual(len(docs), 3)
        scope = determine_scope(load(cfg.path("gedcom")), cfg, date(2026, 11, 8))
        pub, held = decide(docs, scope, cfg.base_dir, cutoff_year=cfg["documents_cutoff_year"])
        self.assertTrue(pub)
        # the sheet that mentions a living person is published only as a crop
        crop_only = [d for d in pub if d.get("crop_only")]
        self.assertTrue(crop_only)
        for d in crop_only:
            self.assertTrue(d["crop"])
            self.assertFalse(set(d["people"]) & scope.living)
        for d in docs:
            self.assertTrue(set(d["main"] if "main" in d else d["people"]) <= set(d["people"]))

    def test_example_export_is_small_webp(self):
        cfg = config_module.load(EXAMPLE_DIR / "site.json")
        with tempfile.TemporaryDirectory() as t:
            for d in load_documents(cfg.path("documents"), cfg.base_dir):
                v = export(d, Path(t), cfg.base_dir)
                self.assertEqual(Image.open(Path(t) / v["crop"]).format, "WEBP")


class TestDraft(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.t = Path(self._t.name).resolve()
        self.addCleanup(self._t.cleanup)
        for rel in ("branch/a.png", "branch/b.jpg", "branch/note.md", "branch/marked/a.png",
                    "branch/x_files/c.png", "branch/scan.pdf"):
            (self.t / rel).parent.mkdir(parents=True, exist_ok=True)
            (self.t / rel).write_bytes(b"x")

    def test_skeleton(self):
        d = draft(self.t, [], skip_dirs={"marked"})
        sources = sorted(x["source"] for x in d)
        self.assertEqual(sources, ["branch/a.png", "branch/b.jpg", "branch/scan.pdf#0"])
        self.assertTrue(all(x["people"] == [] for x in d))
        self.assertEqual(len({x["id"] for x in d}), len(d))
        self.assertEqual(len(draft(self.t, d, skip_dirs={"marked"})), 0)

    def test_skip_dirs_default_is_empty(self):
        d = draft(self.t, [])
        self.assertIn("branch/marked/a.png", [x["source"] for x in d])

    def test_year_and_marked_copy(self):
        (self.t / "branch" / "Baptism 1890.png").write_bytes(b"x")
        (self.t / "branch" / "marked" / "Baptism 1890.png").write_bytes(b"x")
        d = {x["source"]: x for x in draft(self.t, [], skip_dirs={"marked"}, marked_dir="marked")}
        e = d["branch/Baptism 1890.png"]
        self.assertEqual(e["year"], 1890)
        self.assertEqual(e["marked"], "branch/marked/Baptism 1890.png")
        self.assertEqual(e["id"], "baptism-1890")


if __name__ == "__main__":
    unittest.main()
