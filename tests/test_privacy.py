import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from familychronicle.gedcom import GDate, load
from familychronicle.privacy import (check_output, date_forms, extensions, living_for_check,
                                     locale_extensions, redact, sensitive_dates)
from familychronicle.scope import determine_scope

DATA = Path(__file__).parent / "data"
D = GDate(1995, 1, 5, False, "5 JAN 1995")
DM = GDate(1995, 1, None, False, "JAN 1995")
LIVING = [(["John", "Smith"], [D])]


class DateForms(unittest.TestCase):
    def test_full_date(self):
        f = date_forms(D)
        for x in ["5. 1. 1995", "5.1.1995", "05.01.1995", "5. ledna 1995",
                  "5. leden 1995", "1995-01-05", "5 JAN 1995", "5 January 1995",
                  "January 5, 1995", "Jan 5, 1995"]:
            self.assertIn(x, f)

    def test_month_year(self):
        f = date_forms(DM)
        for x in ["ledna 1995", "leden 1995", "January 1995", "1/1995"]:
            self.assertIn(x, f)


class Redaction(unittest.TestCase):
    def test_bold_survives(self):
        d = GDate(1995, 1, 5, False, "")
        self.assertEqual(redact("**text**, dál", [d]), "**text**, dál")
        self.assertEqual(redact("Koncem roku **1955** si", [d]), "Koncem roku **1955** si")
        r = redact("Dne **5. 1. 1995** se narodil.", [d])
        self.assertNotIn("1995", r)
        self.assertEqual(r.count("*"), 0)
        d2 = GDate(1949, 11, None, False, "")
        self.assertEqual(redact("z Hillside **27. listopadu 1949** a", [d2]), "z Hillside **27.** a")
        self.assertNotIn("*", redact("Jonas * 1995, žije.", [d]))
        self.assertEqual(redact("Jonas * 1995, žije.", [d]), "Jonas žije.")

    def test_redaction(self):
        d = GDate(1995, 1, 5, False, "")
        self.assertEqual(redact("John (nar. 5. 1. 1995) žije v Springfieldu.", [d]),
                         "John žije v Springfieldu.")
        self.assertEqual(redact("Narodil se 5. ledna 1995 v Springfieldu.", [d]),
                         "Narodil se v Springfieldu.")
        self.assertEqual(redact("A<!-- web:hide -->, Main Street 12<!-- /web:hide --> B", []),
                         "A B")
        self.assertNotIn("1995", redact("He was born on January 5, 1995.", [d]))

    def test_multiline_and_unclosed_hide(self):
        self.assertEqual(redact("A\n<!-- web:hide -->\nx\ny\n<!-- /web:hide -->\nB", []),
                         "A\n\nB")
        self.assertNotIn("secret", redact("A <!-- web:hide --> secret", []))

    def test_cleanup(self):
        d = GDate(1995, 1, 5, False, "")
        self.assertEqual(redact("Jonas (nar. 5. 1. 1995, Springfield) a Eva.", [d]),
                         "Jonas (Springfield) a Eva.")
        self.assertEqual(redact("Jonas, nar. 05.01.1995, žije.", [d]), "Jonas, žije.")
        self.assertEqual(redact("Jonas *5.1.1995, žije.", [d]), "Jonas žije.")
        self.assertEqual(redact("X 5 JAN 1995 a 5.1.1995 y", [d]), "X a y")

    def test_czech_and_english_forms(self):
        d = GDate(1990, 1, 5, False, "")
        year_only = GDate(1990, None, None, False, "")
        for text in ["John (5. ledna 1990) lives.", "John (born 5 January 1990) lives.",
                     "John (born on January 5, 1990) lives.", "John (nar. 5. 1. 1990) lives."]:
            with self.subTest(text):
                self.assertNotIn("1990", redact(text, [d]))
        for text in ["John (nar. 1990) lives.", "John (b. 1990) lives.", "John (born 1990) lives.",
                     "John * 1990, lives."]:
            with self.subTest(text):
                self.assertNotIn("1990", redact(text, [year_only]))
        self.assertEqual(redact("John (b. 1990) lives.", [year_only]), "John lives.")
        self.assertEqual(redact("John (born 5 January 1990) lives.", [d]), "John lives.")

    def test_month_and_year(self):
        dm = GDate(1995, 1, None, False, "")
        self.assertNotIn("1995", redact("V ledna 1995 a v January 1995 a 1/1995.", [dm]))
        dr = GDate(1995, None, None, False, "")
        self.assertEqual(redact("John (nar. 1995) žije.", [dr]), "John žije.")
        full = GDate(1972, 1, 29, False, "")
        self.assertEqual(redact("Peter (nar. 1972) žije.", [full]), "Peter žije.")
        # a year without a "born" context is not deleted
        self.assertIn("1995", redact("Chronicle 1945–1995", [dr]))


class CheckHelper(unittest.TestCase):
    def run_check(self, files, living=LIVING, exceptions=(), allowed=frozenset()):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            for name, content in files.items():
                p = t / name
                p.parent.mkdir(parents=True, exist_ok=True)
                if isinstance(content, bytes):
                    p.write_bytes(content)
                else:
                    p.write_text(content, encoding="utf-8")
            return check_output(t, living, list(exceptions), allowed)


class Check(CheckHelper):
    def test_check_catches(self):
        cases = {
            "a.html": "<p>John Smith, 1995</p>",
            "b.json": '{"x":"5.1.1995"}',
            "c.txt": "kontakt john@example.org",
            "d.txt": "tel 603 123 456",
            "e.html": "<p>born January 1995</p>",
            "documents/neznamy.webp": b"x",
        }
        for name, content in cases.items():
            with self.subTest(name):
                self.assertGreaterEqual(len(self.run_check({name: content})), 1)

    def test_more_ways(self):
        for name, content in {
            "a.html": "<b>John</b> <i>Smith</i> <span>(nar.</span> <em>1995</em>)",
            "b.html": "<p>John&nbsp;Smith &#40;1995&#41;</p>",
            "c.html": "<p>5.&nbsp;ledna 1995</p>",
            "d.json": '{"name":"Johanna Smithová","year":1995}',
            "e.json": '{"a":["Johnovi", 1995]}',
            "f.txt": "Narozen 05. 01. 1995 v Springfieldu",
            "g.html": '<img alt="John Smith 1995" src="x.png">',
            "h.txt": "+420 603 123 456",
            "i.txt": "narozen 5/1/1995",
        }.items():
            with self.subTest(name):
                self.assertGreaterEqual(len(self.run_check({name: content})), 1)

    def test_check_clean(self):
        self.assertEqual(self.run_check({"a.html": "<p>Chronicle 1945–1995</p>"}), [])
        self.assertEqual(self.run_check({"a.html": "<p>John Smith</p><p>" + "x" * 200 + " 1995</p>"}), [])
        self.assertEqual(self.run_check({"a.html": "<p>John Smith 1994</p>"}), [])
        self.assertEqual(self.run_check({"a.txt": "1945–1995 a 5. 1. 1996 a 12.5.2001"}), [])
        self.assertEqual(self.run_check({"a.css": "img@2x.png{margin:0}", "a.js": "x=1234567890123;"}), [])
        v = "John Smith 1995"
        self.assertEqual(self.run_check({"a.txt": v}, exceptions=[v]), [])
        self.assertEqual(self.run_check({"documents/ok.webp": b"x"},
                                   allowed={"ok.webp"}), [])

    def test_exception_only_removes_itself(self):
        # an exception must not hide another occurrence
        self.assertGreaterEqual(
            len(self.run_check({"a.txt": "John Smith 1995 ... John Smith 1995"},
                          exceptions=["John Smith 1995 ..."])), 1)

    def test_month_year_of_living(self):
        self.assertGreaterEqual(len(self.run_check({"a.txt": "leden 1995"}, [(["X"], [DM])])), 1)

    def test_marriage(self):
        sv = GDate(2020, 6, 12, False, "")
        z = [(["John", "Smith"], [D, sv])]
        self.assertGreaterEqual(len(self.run_check({"a.txt": "12. června 2020"}, z)), 1)


class CheckTolerance(CheckHelper):
    def test_wrapped_date(self):
        self.assertEqual(redact("Narodil se 5. ledna\n1995 v", [D]), "Narodil se v")
        self.assertEqual(redact("Narodil se 5.\r\n1. 1995 v", [D]), "Narodil se v")
        # more than one wrapped line is not joined
        self.assertIn("1995", redact("5. ledna\n\n1995", [D]))
        for txt in ["5. ledna\n1995", "5.\n1.\n1995", "5.\u20091.\u202f1995",
                    "1995-01-\n05", "5.&nbsp;ledna 1995"]:
            with self.subTest(txt):
                self.assertGreaterEqual(len(self.run_check({"a.txt": txt})), 1)

    def test_nbsp_in_redaction(self):
        self.assertEqual(redact("Narodil se 5.&nbsp;ledna&nbsp;1995 v", [D]),
                         "Narodil se v")
        self.assertEqual(redact("John (nar.&nbsp;5.&nbsp;1.&nbsp;1995) žije", [D]),
                         "John žije")

    def test_more_date_forms(self):
        for txt in ["1995/01/05", "1995.01.05", "5.1.95", "5-1-1995", "5–1–1995",
                    "5. lednu 1995", "5. ledna roku 1995", "5. ledna r. 1995",
                    "v lednu 1995", "s lednem 1995", "5.1.1995", "5/1/1995"]:
            with self.subTest(txt):
                self.assertGreaterEqual(len(self.run_check({"a.txt": txt})), 1)
        for txt in ["5.1.96", "1996/01/05", "5. února 1995"]:
            with self.subTest(txt):
                self.assertEqual(self.run_check({"a.txt": txt}), [])

    def test_month_cases(self):
        for i, nm in enumerate(["lednu", "únoru", "březnu", "dubnu", "květnu", "červnu",
                                "červenci", "srpnu", "září", "říjnu", "listopadu",
                                "prosinci"], 1):
            dm_i = GDate(1995, i, 5, False, "")
            with self.subTest(nm):
                self.assertGreaterEqual(
                    len(self.run_check({"a.txt": f"5. {nm} 1995"}, [(["X"], [dm_i])])), 1)

    def test_short_names(self):
        z = [(["Eva", "Dvořáková"], [GDate(1995, None, None, False, "")])]
        for txt in ["Evy 1995", "Evě 1995", "Evou 1995", "Eva 1995", "1995 Evo",
                    "Dvořák 1995", "Dvořáková 1995", "Dvořákovi 1995"]:
            with self.subTest(txt):
                self.assertGreaterEqual(len(self.run_check({"a.txt": txt}, z)), 1)
        for txt in ["Evropa 1995", "Evidence 1995", "Eva 1996"]:
            with self.subTest(txt):
                self.assertEqual(self.run_check({"a.txt": txt}, z), [])
        zy = [(["Nový"], [GDate(1995, None, None, False, "")])]
        self.assertGreaterEqual(len(self.run_check({"a.txt": "Nová 1995"}, zy)), 1)

    def test_invisible_characters(self):
        for txt in ["Jo\u00adhn Smith 19\u00ad95", "John Smith 19\u200b95",
                    "John Smith 1\u2060995", "John Sm\ufeffith 1995",
                    "5. led\u00adna 1995"]:
            with self.subTest(repr(txt)):
                self.assertGreaterEqual(len(self.run_check({"a.txt": txt})), 1)


class Sensitive(unittest.TestCase):
    def test_mini(self):
        tree = load(DATA / "mini.ged")
        scope = determine_scope(tree, {"root": "I1"}, date(2026, 11, 8))
        c = sensitive_dates(tree, scope)
        self.assertEqual(set(c), scope.living)
        self.assertTrue(any(d.year == 1995 for d in c["I1"]))
        for pid, dates in c.items():
            self.assertIsInstance(dates, list)
        z = living_for_check(tree, scope)
        self.assertIn((["John", "Smith"], c["I1"]), z)


GERMAN = {"privacy": {
    "months": [["Januar", "Jänner"], ["Februar"], ["März", "Maerz"], ["April"], ["Mai"], ["Juni"], ["Juli"],
               ["August"], ["September"], ["Oktober"], ["November"], ["Dezember"]],
    "birth_prefixes": ["geb."]}}
MARCH = GDate(1990, 3, 5, False, "5 MAR 1990")


class LocaleExtension(unittest.TestCase):
    def locales(self, **langs) -> Path:
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        for lang, data in langs.items():
            (Path(d.name) / f"{lang}.json").write_text(json.dumps(data), encoding="utf-8")
        return Path(d.name)

    def test_german_birth_date_is_redacted_with_a_locale_file(self):
        ext = locale_extensions(["de"], self.locales(de=GERMAN))
        self.assertEqual(redact("Hans (geb. 5. März 1990) lebt.", [MARCH], ext), "Hans lebt.")
        self.assertEqual(redact("Hans, geb. 1990, lebt.", [MARCH], ext), "Hans, lebt.")
        self.assertNotIn("1990", redact("Am 5. Maerz 1990 kam er.", [MARCH], ext))

    def test_without_the_extension_the_german_date_is_not_recognised(self):
        self.assertIn("1990", redact("Hans (geb. 5. März 1990) lebt.", [MARCH]))

    def test_check_output_uses_the_extension(self):
        ext = locale_extensions(["de"], self.locales(de=GERMAN))
        living = [(["Hans", "Weber"], [MARCH])]
        with tempfile.TemporaryDirectory() as t:
            (Path(t) / "a.html").write_text("<p>Am 5. März 1990 war es.</p>", encoding="utf-8")
            self.assertEqual(check_output(Path(t), living, [], ext=None), [])
            self.assertTrue(check_output(Path(t), living, [], ext=ext))

    def test_languages_are_merged_and_none_is_fine(self):
        d = self.locales(de=GERMAN, en={"site_title": "x"})
        ext = locale_extensions(["en", "de"], d)
        self.assertEqual(ext["birth_prefixes"], ["geb."])
        self.assertEqual(ext["months"][2], ["März", "Maerz"])
        self.assertEqual(extensions([None, {}])["birth_prefixes"], [])

    def test_malformed_blocks_are_errors(self):
        for bad in ({"months": [["a"]]}, {"months": "x"}, {"birth_prefixes": "geb."}, {"birth_prefixes": [1]}, "x"):
            with self.assertRaises(ValueError, msg=bad):
                extensions([bad])


if __name__ == "__main__":
    unittest.main()
