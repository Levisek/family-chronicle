import unittest
from datetime import date
from pathlib import Path

from familychronicle import config as config_module
from familychronicle.gedcom import Event, Family, GDate, Person, Tree, load
from familychronicle.relationship import relationship
from familychronicle.scope import (BRANCH_BOUNDARY, COMMON, OTHER, determine_scope,
                                   is_living)

DATA = Path(__file__).parent / "data"
MINI = DATA / "mini.ged"
EXAMPLE_DIR = Path(__file__).resolve().parents[1] / "example"
TODAY = date(2026, 11, 8)

# I9 (ahnentafel 8) is the root of branch "a"; their sibling I13 inherits the branch.
# I6 is a sibling of I4 (ahnentafel 4), so they belong to "common".
CONFIG = {"root": "I1", "branches": [{"key": "a", "roots": ["I9"]}],
          "living_extra": [], "deceased_extra": [], "exclude": []}


def person(year=None, died=False, no_date=False):
    p = Person("X")
    if no_date:
        p.events.append(Event("BIRT", None))
    else:
        p.events.append(Event("BIRT", GDate(year, None, None, False, str(year))))
    if died:
        p.events.append(Event("DEAT"))
    return p


class TestScope(unittest.TestCase):
    def setUp(self):
        self.tree = load(MINI)
        self.scope = determine_scope(self.tree, CONFIG, TODAY)

    def test_living(self):
        t = self.tree
        self.assertTrue(is_living(t.people["I1"], TODAY))      # 1995, no death
        self.assertFalse(is_living(t.people["I4"], TODAY))     # DEAT without a date
        self.assertTrue(is_living(Person("N"), TODAY))         # no BIRT
        self.assertTrue(is_living(person(no_date=True), TODAY))
        self.assertFalse(is_living(person(1925), TODAY))       # 101 years
        self.assertFalse(is_living(person(1990, died=True), TODAY))

    def test_living_years_parameter(self):
        self.assertTrue(is_living(person(1925), TODAY, years=120))

    def test_living_years_below_100_rejected(self):
        for bad in (10, 99, 0, -5, 100.0, "100", True, None):
            with self.subTest(bad):
                with self.assertRaises(ValueError) as cm:
                    determine_scope(self.tree, dict(CONFIG, living_years=bad), TODAY)
                self.assertIn("living_years", str(cm.exception))
        with self.assertRaises(ValueError):
            is_living(person(1990), TODAY, years=10)
        determine_scope(self.tree, dict(CONFIG, living_years=100), TODAY)   # boundary is fine

    def test_scope_ends_at_root(self):
        s = self.scope
        self.assertIn("I7", s.people)          # the root's spouse is in
        self.assertNotIn("I7", s.map_people)   # but not on the map
        self.assertNotIn("I8", s.people)       # the root's child is not
        self.assertEqual(s.ahnentafel["I1"], 1)
        self.assertEqual(s.ahnentafel["I2"], 2)
        self.assertEqual(s.ahnentafel["I9"], 8)
        self.assertIn("I6", s.siblings)
        self.assertNotIn("I6", s.ahnentafel)

    def test_branch_inherited_by_sibling(self):
        b = self.scope.branch_of
        self.assertEqual(BRANCH_BOUNDARY, 8)
        self.assertEqual(b["I1"], COMMON)
        self.assertEqual(b["I4"], COMMON)
        self.assertEqual(b["I6"], COMMON)   # sibling of an ancestor with ahnentafel < 8
        self.assertEqual(b["I9"], "a")
        self.assertEqual(b["I11"], "a")     # ancestor of the branch root
        self.assertEqual(b["I13"], "a")     # sibling of an ancestor from the branch

    def test_other_branch_for_unassigned_ancestor(self):
        s = determine_scope(self.tree, dict(CONFIG, branches=[]), TODAY)
        self.assertEqual(s.branch_of["I9"], OTHER)
        self.assertEqual(s.branch_of["I4"], COMMON)

    def test_exceptions(self):
        c = dict(CONFIG, living_extra=["I4"], deceased_extra=["I1"], exclude=["I6"])
        s = determine_scope(self.tree, c, TODAY)
        self.assertIn("I4", s.living)
        self.assertNotIn("I1", s.living)
        self.assertNotIn("I6", s.people)
        self.assertIn("I6", s.excluded)

    def test_living_in_scope(self):
        self.assertIn("I1", self.scope.living)
        self.assertIn("I2", self.scope.living)
        self.assertNotIn("I4", self.scope.living)

    def test_living_years_from_config(self):
        s = determine_scope(self.tree, dict(CONFIG, living_years=200), TODAY)
        self.assertIn("I9", s.people)
        self.assertEqual(s.living, {i for i in s.people if not self.tree.people[i].has_death})

    def test_relationship_mini(self):
        s = self.scope
        self.assertEqual(relationship(s, "I2", "cs"), "otec")
        self.assertEqual(relationship(s, "I3", "cs"), "matka")
        self.assertEqual(relationship(s, "I2", "en"), "father")
        self.assertEqual(relationship(s, "I4", "cs"), "dědeček")
        self.assertEqual(relationship(s, "I6", "cs"), "bratr dědečka")
        self.assertEqual(relationship(s, "I13", "cs"), "bratr pradědečka")
        self.assertEqual(relationship(s, "I13", "en"), "brother of great-grandfather")
        self.assertEqual(relationship(s, "I11", "cs"), "prapradědeček")
        self.assertEqual(relationship(s, "I12", "cs"), "praprababička")
        self.assertEqual(relationship(s, "I1", "cs"), "sám autor")
        self.assertEqual(relationship(s, "I1", "en"), "the author")


class TestExample(unittest.TestCase):
    """The whole example family (example/family.ged + example/site.json)."""

    @classmethod
    def setUpClass(cls):
        cls.config = config_module.load(EXAMPLE_DIR / "site.json")
        cls.tree = load(cls.config.path("gedcom"))
        cls.scope = determine_scope(cls.tree, cls.config, TODAY)

    def test_example(self):
        s = self.scope
        self.assertEqual(len(s.ahnentafel), 29)   # the root + 28 ancestors
        self.assertIn("I1", s.living)
        self.assertEqual(s.branch_of["I14"], "huber")
        self.assertEqual(s.branch_of["I19"], "cerny")
        self.assertEqual(s.branch_of["I24"], "kowalski")
        self.assertEqual(s.branch_of["I1"], COMMON)
        self.assertEqual(s.ahnentafel["I2"], 2)

    def test_root_has_siblings_but_not_children(self):
        s, t = self.scope, self.tree
        for i in t.children(s.root):
            self.assertNotIn(i, s.people)
        for i in t.siblings(s.root):
            self.assertIn(i, s.people)
            self.assertIn(i, s.living)
        self.assertEqual(relationship(s, "I4", "cs"), "sestra")
        self.assertEqual(relationship(s, "I4", "en"), "sister")

    def test_spouses_and_descendants_of_siblings(self):
        s = self.scope
        self.assertEqual(relationship(s, "I9", "cs"), "manželka bratra otce")
        self.assertEqual(relationship(s, "I9", "en"), "wife of brother of father")
        self.assertEqual(relationship(s, "I17", "cs"), "bývalý manžel sestry dědečka")  # DIV in F17
        self.assertEqual(relationship(s, "I17", "en"), "former husband of sister of grandfather")
        self.assertEqual(relationship(s, "I8", "cs"), "sestřenice")
        self.assertEqual(relationship(s, "I8", "en"), "first cousin")
        self.assertEqual(relationship(s, "I18", "cs"), "bratranec otce")
        self.assertEqual(relationship(s, "I33", "cs"), "bratranec pradědečka")
        for i in ("I9", "I17", "I8", "I18"):
            self.assertIn(i, s.people)
        self.assertNotIn("I9", s.map_people)
        self.assertEqual(s.spouse_families["I17"], {"divorce": True, "marriage": True})

    def test_person_without_dates_is_deceased_by_exception(self):
        # I34 has no dates at all, so by the rule she would be living; site.json overrides it
        self.assertTrue(is_living(self.tree.people["I34"], TODAY))
        self.assertNotIn("I34", self.scope.living)

    def test_no_unassigned_ancestor(self):
        unassigned = [i for i, v in self.scope.branch_of.items() if v == OTHER]
        self.assertEqual(unassigned, [], unassigned)

    def test_relationships_for_everyone(self):
        r = self.scope
        self.assertEqual(relationship(r, "I2", "cs"), "otec")
        for i in r.people:
            for lang in ("cs", "en"):
                self.assertTrue(relationship(r, i, lang), i)

    def test_living_have_no_death(self):
        for i in self.scope.living:
            self.assertFalse(self.tree.people[i].has_death)


# --- a synthetic tree for the cases the example does not cover -------------------

def build(people, families):
    t = Tree({}, {})
    for pid, sex, year, famc, fams in people:
        p = Person(pid, given=pid, sex=sex, parents_family=famc, families=list(fams))
        if year:
            p.events.append(Event("BIRT", GDate(year, None, None, False, str(year))))
        if year and year < 1960:
            p.events.append(Event("DEAT"))
        t.people[pid] = p
    for fid, h, w, children, events in families:
        t.families[fid] = Family(fid, h, w, list(children), [Event(e) for e in events])
    return t


class TestSynthetic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        people = [
            ("R", "M", 1990, "F1", []),
            ("FA", "M", 1960, "F2", ["F1", "F9"]), ("MO", "F", 1962, None, ["F1"]),
            ("G1", "M", 1930, "F3", ["F2", "F8"]), ("G2", "F", 1932, None, ["F2"]),
            ("U0", "F", 1958, "F2", ["F5"]), ("C0", "M", 1985, "F5", ["F6"]),
            ("GC0", "M", 2015, "F6", []),
            ("U", "M", 1928, "F3", ["F4"]), ("C", "F", 1955, "F4", ["F7"]),
            ("GC", "F", 1980, "F7", []), ("GGC", "M", 2010, "F7", []),
            ("H", "M", 1958, "F8", []), ("HW", "F", 1936, None, ["F8"]),
            ("H2", "F", 1996, "F9", []), ("W2", "F", 1970, "F10", ["F9"]),
            ("WP1", "M", 1940, None, ["F10"]), ("WP2", "F", 1942, None, ["F10"]),
            ("X", "M", 1980, None, ["F5"]), ("Y", "F", 1990, None, ["F6"]),
        ]
        families = [
            ("F1", "FA", "MO", ["R"], ["MARR"]), ("F2", "G1", "G2", ["FA", "U0"], []),
            ("F3", None, None, ["G1", "U"], []), ("F4", "U", None, ["C"], []),
            ("F5", "X", "U0", ["C0"], []), ("F6", "C0", "Y", ["GC0"], []),
            ("F7", None, "C", ["GC", "GGC"], []), ("F8", "G1", "HW", ["H"], []),
            ("F9", "FA", "W2", ["H2"], ["MARR", "DIV"]), ("F10", "WP1", "WP2", ["W2"], []),
        ]
        cls.tree = build(people, families)
        cls.scope = determine_scope(cls.tree, {"root": "R"}, TODAY)

    def rel(self, i, lang="cs"):
        return relationship(self.scope, i, lang)

    def test_cousins_and_their_descendants(self):
        self.assertEqual(self.rel("C0"), "bratranec")
        self.assertEqual(self.rel("C"), "sestřenice otce")
        self.assertEqual(self.rel("GC"), "druhá sestřenice")
        self.assertEqual(self.rel("GGC"), "druhý bratranec")
        self.assertEqual(self.rel("GC0"), "syn bratrance")
        self.assertEqual(self.rel("GC0", "en"), "son of first cousin")
        self.assertEqual(self.rel("GC", "en"), "second cousin")

    def test_half_siblings(self):
        self.assertEqual(self.scope.half_siblings, {"H", "H2"})
        self.assertEqual(self.rel("H"), "nevlastní bratr otce")
        self.assertEqual(self.rel("H", "en"), "half-brother of father")
        self.assertEqual(self.rel("H2"), "nevlastní sestra")
        self.assertEqual(self.rel("H2", "en"), "half-sister")
        self.assertNotIn("H", self.scope.map_people)

    def test_partners_and_co_parent_ancestors(self):
        self.assertEqual(self.rel("W2"), "bývalá manželka otce")
        self.assertEqual(self.rel("X"), "přítel sestry otce")      # no MARR/DIV event: partner
        self.assertEqual(self.rel("X", "en"), "partner of sister of father")
        self.assertEqual(self.rel("WP1"), "otec bývalé manželky otce")
        self.assertEqual(self.rel("WP1", "en"), "father of the former wife of father")
        self.assertEqual(self.scope.partner_ancestor["WP1"], ("W2", 2))

    def test_root_sibling_descendants_cs(self):
        # the root's sibling S has descendants D1..D4; the Czech "pra-" prefix is data
        people = [("R", "M", 1990, "F1", []), ("FA", "M", 1960, None, ["F1"]),
                  ("MO", "F", 1962, None, ["F1"]), ("S", "F", 1992, "F1", ["F2"]),
                  ("D1", "M", 2015, "F2", ["F3"]), ("D2", "F", 2040, "F3", ["F4"]),
                  ("D3", "M", 2060, "F4", ["F5"]), ("D4", "F", 2080, "F5", [])]
        families = [("F1", "FA", "MO", ["R", "S"], []), ("F2", None, "S", ["D1"], []),
                    ("F3", "D1", None, ["D2"], []), ("F4", None, "D2", ["D3"], []),
                    ("F5", "D3", None, ["D4"], [])]
        s = determine_scope(build(people, families), {"root": "R"}, date(2090, 1, 1))
        self.assertEqual(relationship(s, "D1", "cs"), "synovec")
        self.assertEqual(relationship(s, "D2", "cs"), "praneteř")
        self.assertEqual(relationship(s, "D3", "cs"), "praprasynovec")
        self.assertEqual(relationship(s, "D4", "cs"), "3× praneteř")
        self.assertEqual(relationship(s, "D2", "en"), "grandniece")
        self.assertEqual(relationship(s, "D3", "en"), "great-grandnephew")

    def test_person_without_dates_is_living(self):
        t = Tree({"X": Person("X")}, {})
        self.assertTrue(is_living(t.people["X"], TODAY))
        s = determine_scope(t, {"root": "X"}, TODAY)
        self.assertIn("X", s.people)
        self.assertIn("X", s.living)

    def test_root_without_parents(self):
        t = Tree({"X": Person("X", given="Solo")}, {})
        s = determine_scope(t, {"root": "X"}, TODAY)
        self.assertEqual(s.root, "X")
        self.assertEqual(s.ahnentafel, {"X": 1})
        self.assertIn("X", s.people)
        self.assertIn("X", s.living)
        self.assertEqual(s.branch_of["X"], COMMON)
        self.assertEqual(relationship(s, "X", "en"), "the author")
        self.assertEqual(relationship(s, "X", "cs"), "sám autor")


if __name__ == "__main__":
    unittest.main()
