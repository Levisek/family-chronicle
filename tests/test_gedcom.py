import tempfile
import unittest
from pathlib import Path

from familychronicle.gedcom import GDate, age_at_death, load, parse_date

DATA = Path(__file__).parent / "data"
MINI = DATA / "mini.ged"
EXAMPLE = Path(__file__).resolve().parents[1] / "example" / "family.ged"


class TestGedcom(unittest.TestCase):
    def test_date_forms(self):
        self.assertEqual(parse_date("5 JAN 1995"), GDate(1995, 1, 5, False, "5 JAN 1995"))
        d = parse_date("SEP 1921")
        self.assertEqual((d.year, d.month, d.day), (1921, 9, None))
        self.assertTrue(parse_date("ABT 1890").approximate)
        self.assertEqual(parse_date("FROM 1900 TO 1910").year, 1900)
        self.assertIsNone(parse_date("unknown").year)
        self.assertEqual(parse_date("1972").year, 1972)

    def test_load(self):
        t = load(MINI)
        self.assertEqual(t.parents("I1"), ["I2", "I3"])
        self.assertIn("I6", t.siblings("I4"))
        self.assertTrue(t.people["I4"].has_death)  # DEAT without a date is still a death
        self.assertFalse(t.people["I2"].has_death)
        self.assertEqual(t.people["I1"].given, "John")
        self.assertEqual(t.people["I1"].surname, "Smith")
        self.assertEqual(t.people["I2"].given, "Peter")  # no GIVN, split on slashes
        self.assertEqual(t.children("I1"), ["I8"])
        self.assertEqual(t.people["I1"].birth.date.year, 1995)

    def test_spouses(self):
        t = load(MINI)
        self.assertEqual(t.spouses("I1"), ["I7"])
        self.assertEqual(t.spouses("I2"), ["I3"])
        self.assertEqual(t.spouses("I8"), [])

    def test_occupations(self):
        t = load(MINI)
        o = t.people["I4"].occupations
        self.assertEqual([x.value for x in o], ["weaver, Mill Lane 5", "sexton"])
        self.assertEqual(o[0].date.year, 1921)
        self.assertIsNone(o[1].date)
        self.assertEqual(t.people["I2"].occupations, [])

    def test_cause_of_death(self):
        t = load(MINI)
        e = next(x for x in t.people["I4"].events if x.type == "DEAT")
        self.assertEqual(e.cause, "tuberculosis")

    def test_age_at_death(self):
        d = parse_date
        self.assertEqual(age_at_death(d("12 AUG 1875"), d("3 FEB 1929")), (53, False))
        self.assertEqual(age_at_death(d("12 AUG 1875"), d("12 AUG 1929")), (54, False))
        self.assertEqual(age_at_death(d("MAR 1850"), d("SEP 1889")), (39, False))
        self.assertEqual(age_at_death(d("1850"), d("1889")), (39, True))  # years only: approximate
        self.assertEqual(age_at_death(d("ABT 1824"), d("3 FEB 1877"), "53"), (53, False))
        self.assertEqual(age_at_death(None, d("1913"), "87-88"), (87, True))
        self.assertEqual(age_at_death(None, None, "About 21-22"), (21, True))
        self.assertEqual(age_at_death(d("5 JAN 1900"), d("1 MAR 1900")), (0, False))
        self.assertIsNone(age_at_death(d("ABT 1890"), None))
        self.assertIsNone(age_at_death(d("1950"), d("1890")))  # nonsense

    def test_marriage_place(self):
        t = load(MINI)
        self.assertEqual(t.families["F1"].events[0].place, "Springfield, 12 Main Street")

    def test_source_is_only_a_flag(self):
        t = load(MINI)
        self.assertTrue(t.people["I1"].has_source)
        self.assertFalse(t.people["I2"].has_source)
        self.assertNotIn("@S1@", repr(t))

    def test_email_is_not_read(self):
        r = repr(load(MINI))
        self.assertNotIn("x@y.example", r)
        self.assertNotIn("x@@y.example", r)
        self.assertNotIn("secret", r)

    def test_example_family(self):
        t = load(EXAMPLE)
        self.assertEqual(len(t.people), 45)
        self.assertEqual(t.parents("I1"), ["I2", "I3"])
        self.assertEqual(t.people["I1"].given, "Daniel")
        self.assertEqual(t.people["I1"].birth.date.year, 1990)
        self.assertFalse(t.people["I1"].has_death)
        self.assertEqual(t.children("I2"), ["I1", "I4"])
        self.assertEqual(t.siblings("I5"), ["I16"])
        self.assertTrue(any(e.type == "DIV" for e in t.families["F17"].events))
        self.assertIsNone(t.people["I34"].birth)  # person without any dates

    def test_foreign_exports(self):
        # BOM + CRLF + CONC/CONT + unknown tags + name without slashes + non-numeric IDs
        lines = [
            "0 HEAD", "1 CHAR UTF-8", "1 _TOOL SomeProgram",
            "0 @P7@ INDI", "1 _UID ABC123", "1 NAME John Smith", "1 SEX M",
            "1 NOTE A long note that is split",
            "2 CONC  over two lines", "2 CONT and continues here",
            "1 BIRT", "2 DATE 1 JAN 1980", "2 PLAC Spring",
            "3 CONC field", "2 _CUSTOM whatever",
            "1 FAMC @P1@",
            "0 @P8@ INDI", "1 NAME Ann /Smith/", "1 FAMS @P1@",
            "0 @P9@ INDI", "1 NAME Bob /Smith/", "1 FAMS @P1@",
            "0 @P1@ FAM", "1 HUSB @P9@", "1 WIFE @P8@", "1 CHIL @P7@",
            "0 TRLR",
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "foreign.ged"
            path.write_bytes(("\r\n".join(lines) + "\r\n").encode("utf-8-sig"))
            t = load(path)
        p = t.people["P7"]
        self.assertEqual(p.given, "John Smith")
        self.assertEqual(t.parents("P7"), ["P9", "P8"])
        self.assertEqual(p.birth.date.year, 1980)
        self.assertEqual(p.birth.place, "Springfield")  # CONC joined without a space
        self.assertNotIn("long note", repr(t))



class TestEncodings(unittest.TestCase):
    BODY = "0 HEAD\n{head}0 @I1@ INDI\n1 NAME Zoë /Müller/\n0 TRLR\n"

    def write(self, data: bytes) -> Path:
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        p = Path(d.name) / "t.ged"
        p.write_bytes(data)
        return p

    def test_utf8_bom(self):
        p = self.write(b"\xef\xbb\xbf" + self.BODY.format(head="").encode("utf-8"))
        self.assertEqual(load(p).people["I1"].surname, "Müller")

    def test_utf16_bom(self):
        p = self.write(self.BODY.format(head="").encode("utf-16"))
        self.assertEqual(load(p).people["I1"].given, "Zoë")

    def test_header_ansi_is_windows_1252(self):
        p = self.write(self.BODY.format(head="1 CHAR ANSI\n").encode("cp1252"))
        self.assertEqual(load(p).people["I1"].surname, "Müller")

    def test_header_unicode_is_utf8(self):
        p = self.write(self.BODY.format(head="1 CHAR UNICODE\n").encode("utf-8"))
        self.assertEqual(load(p).people["I1"].surname, "Müller")

    def test_ansel_is_refused_with_a_clear_message(self):
        p = self.write(self.BODY.format(head="1 CHAR ANSEL\n").encode("latin-1", "replace"))
        with self.assertRaisesRegex(ValueError, "convert the file to UTF-8"):
            load(p)

    def test_undecodable_utf8_is_a_clean_error(self):
        p = self.write(self.BODY.format(head="1 CHAR UTF-8\n").encode("cp1252"))
        with self.assertRaisesRegex(ValueError, "convert it to UTF-8"):
            load(p)


if __name__ == "__main__":
    unittest.main()
