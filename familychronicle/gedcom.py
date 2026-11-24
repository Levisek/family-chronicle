"""GEDCOM parser -> Tree. Only what the site needs enters the model (names,
sex, links, BIRT/DEAT/BURI/MARR/DIV events with date and place, cause of death
CAUS, age AGE, occupation OCCU). Addresses, e-mails, notes, sources and
objects are deliberately not read; for sources only the fact that a person
has one is kept (count of documented people on the site)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

MONTHS = {m: i for i, m in enumerate(
    "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(), 1)}
APPROXIMATE = {"ABT", "EST", "CAL", "BEF", "AFT", "BET", "FROM", "TO"}
EVENT_TAGS = {"BIRT", "DEAT", "BURI", "MARR", "DIV"}


@dataclass(frozen=True)
class GDate:
    year: int | None
    month: int | None
    day: int | None
    approximate: bool
    text: str


def parse_date(s: str) -> GDate:
    text = s.strip()
    words = text.upper().split()
    approximate = bool(words) and words[0] in APPROXIMATE
    # first sensible [day] [month] year combination; for ranges (FROM..TO) the first wins
    m = re.search(r"(?:(\d{1,2})\s+)?(?:([A-Za-z]{3})\s+)?(\d{3,4})\b", text)
    if not m:
        return GDate(None, None, None, approximate, text)
    month = MONTHS.get((m.group(2) or "").upper())
    day = int(m.group(1)) if m.group(1) and month else None
    return GDate(int(m.group(3)), month, day, approximate, text)


def age_at_death(birth: GDate | None, death: GDate | None, age: str = "") -> tuple[int, bool] | None:
    """Age at death as (years, approximate). Precedence: calculation from exact
    dates, then the age recorded with the death (AGE), finally the difference
    of years (+-1 year, hence "approximate")."""
    estimate = None
    if birth and death and birth.year and death.year and not birth.approximate and not death.approximate:
        n = death.year - birth.year
        if birth.month and death.month and (birth.month != death.month or (birth.day and death.day)):
            if (death.month, death.day or 0) < (birth.month, birth.day or 0):
                n -= 1
            if 0 <= n <= 120:
                return n, False
        elif 0 <= n <= 120:
            estimate = (n, True)
    m = re.search(r"(\d+)(\s*-\s*\d+)?", age or "")
    if m and int(m.group(1)) <= 120:
        return int(m.group(1)), bool(m.group(2)) or "ABT" in age.upper() or "ABOUT" in age.upper()
    return estimate


@dataclass
class Event:
    type: str
    date: GDate | None = None
    place: str | None = None
    value: str = ""      # text of OCCU
    cause: str = ""      # CAUS of a death
    age: str = ""        # AGE of a death (as written)


@dataclass
class Person:
    id: str
    given: str = ""
    surname: str = ""
    sex: str = ""
    events: list[Event] = field(default_factory=list)
    occupations: list[Event] = field(default_factory=list)
    parents_family: str | None = None
    families: list[str] = field(default_factory=list)
    has_source: bool = False     # the person or their event cites a source (content is not read)

    @property
    def birth(self) -> Event | None:
        return next((e for e in self.events if e.type == "BIRT"), None)

    @property
    def has_death(self) -> bool:
        return any(e.type in ("DEAT", "BURI") for e in self.events)


@dataclass
class Family:
    id: str
    husband: str | None = None
    wife: str | None = None
    children: list[str] = field(default_factory=list)
    events: list[Event] = field(default_factory=list)


@dataclass
class Tree:
    people: dict[str, Person]
    families: dict[str, Family]

    def _parents_family(self, id: str) -> Family | None:
        pf = self.people[id].parents_family
        return self.families.get(pf) if pf else None

    def parents(self, id: str) -> list[str]:
        f = self._parents_family(id)
        if not f:
            return []
        return [x for x in (f.husband, f.wife) if x and x in self.people]

    def siblings(self, id: str) -> list[str]:
        f = self._parents_family(id)
        return [c for c in f.children if c != id and c in self.people] if f else []

    def children(self, id: str) -> list[str]:
        out: list[str] = []
        for fid in self.people[id].families:
            f = self.families.get(fid)
            if f:
                out += [c for c in f.children if c in self.people and c not in out]
        return out

    def spouses(self, id: str) -> list[str]:
        out: list[str] = []
        for fid in self.people[id].families:
            f = self.families.get(fid)
            if f:
                out += [x for x in (f.husband, f.wife)
                        if x and x != id and x in self.people and x not in out]
        return out


def _ref(h: str) -> str:
    return h.strip().strip("@")


def _logical_lines(text: str) -> list[tuple[int, str, str]]:
    """(level, tag, value) triples; CONC/CONT lines are merged into the previous line."""
    out: list[list] = []
    for raw in text.splitlines():
        parts = raw.lstrip().split(" ", 2)
        if len(parts) < 2 or not parts[0].isdigit():
            continue
        level, tag = int(parts[0]), parts[1]
        value = parts[2] if len(parts) > 2 else ""
        if tag in ("CONC", "CONT") and out:
            out[-1][2] += ("\n" if tag == "CONT" else "") + value
        else:
            out.append([level, tag, value])
    return [(lv, tg, val.strip()) for lv, tg, val in out]


class GedcomEncodingError(ValueError):
    """The file's character set cannot be read."""


def read_text(path: Path) -> str:
    """Decode a GEDCOM file: a BOM wins (UTF-8, UTF-16), else the `1 CHAR` header
    (UTF-8/UNICODE, ASCII/ANSI as Windows-1252); ANSEL is refused with a clear message."""
    raw = Path(path).read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        return _decode(raw, "utf-8-sig", path)
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return _decode(raw, "utf-16", path)
    m = re.search(rb"^[ \t]*1[ \t]+CHAR[ \t]+([^\r\n]*)", raw[:4096], re.M | re.I)
    charset = m.group(1).strip().upper().decode("ascii", "replace") if m else "UTF-8"
    if charset == "ANSEL":
        raise GedcomEncodingError(
            f"{path}: the character set ANSEL is not supported; convert the file to UTF-8 first")
    if charset in ("ASCII", "ANSI", "WINDOWS-1252", "CP1252"):
        return _decode(raw, "cp1252", path)
    return _decode(raw, "utf-8", path)


def _decode(raw: bytes, codec: str, path: Path) -> str:
    try:
        return raw.decode(codec)
    except UnicodeError as error:
        raise GedcomEncodingError(
            f"{path}: cannot decode the file as {codec} ({error}); convert it to UTF-8 first") from None


def load(path: Path) -> Tree:
    people: dict[str, Person] = {}
    families: dict[str, Family] = {}
    record = None          # Person | Family | None
    event: Event | None = None
    name_done = reading_name = False
    for level, tag, value in _logical_lines(read_text(path)):
        if level == 0:
            record, event, name_done, reading_name = None, None, False, False
            # "0 @I1@ INDI": the tag column holds the ID, the value column the type
            if value == "INDI":
                record = people.setdefault(_ref(tag), Person(_ref(tag)))
            elif value == "FAM":
                record = families.setdefault(_ref(tag), Family(_ref(tag)))
            continue
        if record is None:
            continue
        if tag == "SOUR" and isinstance(record, Person):
            record.has_source = True
        if level == 1:
            event = None
            if tag in EVENT_TAGS:
                event = Event(tag)
                record.events.append(event)
            elif tag == "OCCU" and isinstance(record, Person):
                if value:
                    event = Event(tag, value=value)
                    record.occupations.append(event)
            elif isinstance(record, Person):
                reading_name = False
                if tag == "NAME" and not name_done:
                    name_done = reading_name = True
                    m = re.match(r"\s*(.*?)\s*/([^/]*)/?", value)
                    record.given, record.surname = (
                        (m.group(1), m.group(2).strip()) if m else (value, ""))
                elif tag == "SEX":
                    record.sex = value
                elif tag == "FAMC" and record.parents_family is None:
                    record.parents_family = _ref(value)
                elif tag == "FAMS":
                    record.families.append(_ref(value))
            elif isinstance(record, Family):
                if tag == "HUSB":
                    record.husband = _ref(value)
                elif tag == "WIFE":
                    record.wife = _ref(value)
                elif tag == "CHIL":
                    record.children.append(_ref(value))
        elif level == 2:
            if event is not None:
                if tag == "DATE":
                    event.date = parse_date(value)
                elif tag == "PLAC":
                    event.place = value or None
                elif tag == "CAUS":
                    event.cause = value
                elif tag == "AGE":
                    event.age = value
            elif isinstance(record, Person) and reading_name and tag in ("GIVN", "SURN"):
                # GIVN/SURN override the slash split, for the first NAME only
                if tag == "GIVN":
                    record.given = value
                else:
                    record.surname = value
    return Tree(people, families)
