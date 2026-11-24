"""Privacy: forms of living people's dates, text redaction and a check of the
finished output.

The output check is the last safety net: it looks for what must not reach the
site (dates of living people, a birth year next to their name, e-mails, phone
numbers, documents that are not allowed). Exceptions are configured only in
`site.json` (`check_exceptions`), never by editing the output."""
from __future__ import annotations

import html
import json
import re
import unicodedata
from pathlib import Path

from familychronicle.dates import month_names
from familychronicle.gedcom import GDate, Tree
from familychronicle.scope import Scope

# --- locale extensions -----------------------------------------------------------
# Czech and English month names and birth words are built in. Another language adds
# `"privacy": {"months": [[forms of January], ... 12 lists], "birth_prefixes": ["geb.", ...]}`
# to its `locales/<lang>.json`; `extensions` merges the files of all configured languages.

def extensions(blocks) -> dict:
    """Merge the `privacy` objects of the configured languages (None and {} are fine) into
    {"months": [12 lists], "birth_prefixes": [...]}. Raises ValueError on a malformed block."""
    months: list[list[str]] = [[] for _ in range(12)]
    prefixes: list[str] = []
    for block in blocks:
        if not block:
            continue
        if not isinstance(block, dict):
            raise ValueError("privacy must be an object")
        given = block.get("months")
        if given is not None:
            if (not isinstance(given, list) or len(given) != 12
                    or not all(isinstance(m, list) and all(isinstance(x, str) and x for x in m) for m in given)):
                raise ValueError("privacy.months must be 12 lists of month spellings")
            for i, forms in enumerate(given):
                months[i] += [x for x in forms if x not in months[i]]
        words = block.get("birth_prefixes", [])
        if not isinstance(words, list) or not all(isinstance(x, str) and x for x in words):
            raise ValueError("privacy.birth_prefixes must be a list of words")
        prefixes += [x for x in words if x not in prefixes]
    return {"months": months, "birth_prefixes": prefixes}


def locale_extensions(languages, locales_dir: Path, overrides: dict | None = None) -> dict:
    """`extensions` for the configured languages, read from `locales/<lang>.json`
    (config `strings.<lang>.privacy` is merged in as well)."""
    blocks = []
    for lang in languages:
        data = json.loads((Path(locales_dir) / f"{lang}.json").read_text(encoding="utf-8"))
        blocks += [data.get("privacy"), ((overrides or {}).get(lang) or {}).get("privacy")]
    return extensions(blocks)


# --- date forms ---------------------------------------------------------------


def date_forms(d: GDate) -> list[str]:
    """Text forms of a date (for documentation and tests; the check uses `_patterns`)."""
    if d.year is None:
        return []
    y = d.year
    out: list[str] = []
    if d.month and d.day:
        n, m = d.day, d.month
        out += [f"{n}. {m}. {y}", f"{n}.{m}.{y}", f"{n:02d}.{m:02d}.{y}",
                f"{n:02d}. {m:02d}. {y}", f"{y}-{m:02d}-{n:02d}"]
        for name in month_names(m):
            out += [f"{n}. {name} {y}", f"{n} {name} {y}", f"{name} {n}, {y}"]
        out += [f"{n}/{m}/{y}", f"{m}/{n}/{y}"]
    if d.month:
        m = d.month
        out += [f"{m}/{y}", f"{m:02d}/{y}", f"{y}-{m:02d}"]
        out += [f"{name} {y}" for name in month_names(m)]
    return list(dict.fromkeys(out))


_BSP = r"[ \t   ]"                 # space without a newline
_HSP = rf"(?:{_BSP}|&nbsp;|&#160;)"                # + HTML entity (redaction reads the source)
_SP_CHECK = r"\s*"                                 # check: any whitespace incl. \n
_SP_REDACT = rf"{_HSP}*(?:\r?\n{_HSP}*)?"           # redaction: at most one line break
_DASH = "[-‐‑‒–]"
_SEP = r"[./\-‐‑‒–]"


def _patterns(d: GDate, sp: str = _SP_CHECK, ext: dict | None = None) -> list[re.Pattern]:
    """Tolerant regexes for a full date and for month+year. A bare year is not
    searched here (that is the "year next to a name" rule). `sp` = what may stand
    between the parts of the date; `ext` = `extensions(...)` of other languages."""
    if d.year is None or not d.month:
        return []
    y, m = d.year, d.month
    month = "(?:" + "|".join(re.escape(j) for j in month_names(m, ext["months"] if ext else None)) + ")"
    m0 = f"0?{m}"
    nd, od = r"(?<![\d])", r"(?![\d])"
    year_word = rf"(?:(?:roku|r\.){sp})?"          # Czech "roku" / "r." before the year
    yy = f"{y % 100:02d}"
    out: list[str] = []
    if d.day:
        n0 = f"0?{d.day}"
        out += [
            rf"{nd}{n0}{sp}{_SEP}{sp}{m0}{sp}{_SEP}{sp}(?:{y}{od}|{yy}{od})",
            rf"{nd}{m0}{sp}[/]{sp}{n0}{sp}[/]{sp}{y}{od}",
            rf"{nd}{y}{sp}{_SEP}{sp}{m0}{sp}{_SEP}{sp}{n0}{od}",
            rf"{nd}{n0}{sp}(?:\.{sp})?{month}\.?{sp}(?:,{sp})?{year_word}{y}{od}",
            rf"\b{month}\.?{sp}{n0}(?:st|nd|rd|th)?{sp}(?:,{sp})?{year_word}{y}{od}",
        ]
    out += [
        rf"\b{month}\.?{sp}(?:,{sp})?{year_word}{y}{od}",
        rf"{nd}{m0}{sp}[/.]{sp}{y}{od}",
        rf"{nd}{y}{sp}{_DASH}{sp}{m:02d}{od}",
    ]
    return [re.compile(x, re.IGNORECASE) for x in out]


# --- sensitive dates -------------------------------------------------------------

def _person_dates(tree: Tree, id: str) -> list[GDate]:
    p = tree.people[id]
    out: list[GDate] = []
    if p.birth and p.birth.date and p.birth.date.year is not None:
        out.append(p.birth.date)
    for fid in p.families:
        f = tree.families.get(fid)
        for e in (f.events if f else []):
            if e.type == "MARR" and e.date and e.date.year is not None:
                out.append(e.date)
    return list(dict.fromkeys(out))


def sensitive_dates(tree: Tree, scope: Scope) -> dict[str, list[GDate]]:
    """For every living person (key = id): the birth date and the marriage dates of their families."""
    return {i: _person_dates(tree, i) for i in sorted(scope.living) if i in tree.people}


def living_for_check(tree: Tree, scope: Scope) -> list[tuple[list[str], list[GDate]]]:
    """Input for `check_output`: ([given, surname], [dates]) of every living person."""
    out = []
    for i, dates in sensitive_dates(tree, scope).items():
        p = tree.people[i]
        names = [x for x in (p.given, p.surname) if x.strip()]
        out.append((names, dates))
    return out


# --- redaction -------------------------------------------------------------------

_HIDE = re.compile(r"<!--\s*web:hide\s*-->.*?<!--\s*/web:hide\s*-->", re.S)
_HIDE_OPEN = re.compile(r"<!--\s*web:hide\s*-->.*", re.S)
# "nar."/"narozen" = Czech "born"; "*" = genealogical birth sign
def _extra_words(ext: dict | None) -> str:
    words = sorted((ext or {}).get("birth_prefixes", []), key=len, reverse=True)
    return "".join(f"|{re.escape(w)}" for w in words)


def _prefix(ext: dict | None) -> str:
    return rf"(?:(?:nar\.|narozen[aoy]?|born(?:{_HSP}+on)?|b\.|(?<!\*)\*(?!\*){_extra_words(ext)}){_HSP}*)"


def _dangling(ext: dict | None) -> str:
    return (rf"(?:nar\.|narozen[aoy]?|born(?:{_HSP}+on)?{_extra_words(ext)})"
            rf"(?={_HSP}*(?:[,;:)]|\.(?:\s|$)|$))")


def redact(md: str, sensitive: list[GDate], ext: dict | None = None) -> str:
    """Remove hidden blocks and all sensitive dates, then tidy up the leftovers.
    `ext` = `extensions(...)`: month names and birth words of further languages."""
    md = _HIDE.sub("", md)
    md = _HIDE_OPEN.sub("", md)   # unclosed block: better to lose the rest
    for d in sensitive:
        for p in _patterns(d, _SP_REDACT, ext):
            md = _delete(md, p.pattern, ext=ext)
        if d.year is not None:   # "b. 1972" even when the date has a month too
            md = _delete(md, rf"(?<!\d){d.year}(?!\d)", only_with_prefix=True, ext=ext)
    md = re.sub(_dangling(ext), "", md, flags=re.I)
    md = re.sub(r"(?<!\*)\*(?!\*)[ \t]*(?=[,;)])", "", md)   # lone asterisk only, not "**"
    md = re.sub(r"\*\*[ \t]*\*\*", "", md)                  # bold span left after a deleted date
    md = re.sub(r"(?<=\S)[ \t]+(\*\*)(?=[\s,.;:)]|$)", r"\1", md)   # "**27. **" -> "**27.**"
    md = re.sub(r"[ \t]*\([ \t]*[,;]?[ \t]*\)", "", md)       # empty parentheses
    md = re.sub(r"\([ \t]*[,;][ \t]*", "(", md)
    md = re.sub(r"\([ \t]+(?=\S)", "(", md)
    md = re.sub(r",[ \t]*(?:,[ \t]*)+", ", ", md)
    md = re.sub(r"(?<=\S)[ \t]+(?=[,;)])", "", md)
    md = re.sub(r"(?<=\S)[ \t]+\.(?=\s|$)", ".", md)
    return re.sub(r"(?<=\S)[ \t]{2,}(?=\S)", " ", md)


def _delete(md: str, pattern: str, only_with_prefix: bool = False, ext: dict | None = None) -> str:
    """Delete the date with its leading "b."/"*"; keep the comma after it only when no prefix vanished."""
    pat = re.compile(rf"(?P<p>{_prefix(ext)}){'' if only_with_prefix else '?'}(?:{pattern})"
                     rf"(?P<c>[ \t]*,(?=\s))?", re.I)

    def replace(m: re.Match) -> str:
        return "" if m.group("p") else (m.group("c") or "")
    return pat.sub(replace, md)


# --- output check ------------------------------------------------------------------

DATA_TWIN = re.compile(r'\(self\.FC_DATA=self\.FC_DATA\|\|\{\}\)\["[^"\\]*"\]=')
EXTENSIONS = {".html", ".json", ".xml", ".txt", ".js", ".css"}
_EMAIL = re.compile(r"(?<![\w.%+-])[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.([A-Za-z]{2,})(?![\w-])")
_EMAIL_FILE_SUFFIXES = {"png", "jpg", "jpeg", "webp", "svg", "gif", "css", "js",
                        "json", "woff", "woff2", "avif", "ico", "map", "html"}
_PHONE = re.compile(r"(?<![\w.,/+-])(?:\+?\d{3}[  -]?)?\d{3}[  -]?\d{3}[  -]?\d{3}"
                    r"(?![\w]|[.,]\d)")
DISTANCE = 80


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if not unicodedata.combining(c)).casefold()


_INVISIBLE = re.compile("[­​‌‍⁠﻿]")


def _stems(names: list[str]) -> list[tuple[str, int | None]]:
    """(stem, longest suffix | None). Short stems (<=3 chars) take only a short
    suffix, so that "ev" does not match "europe". Note: `*95` next to a name is not handled.
    The suffix rules model Czech declension (Daniel -> Daniela, Dvořáková -> Dvořák)."""
    out: dict[str, int | None] = {}

    def add(k: str) -> None:
        if len(k) >= 2:
            out.setdefault(k, 3 if len(k) <= 3 else None)

    for name in names:
        for orig in re.split(r"[\s\-]+", name.casefold()):
            t = _strip_accents(orig)
            if len(t) < 3:
                continue
            add(t[:max(4, len(t) - 2)])
            if len(t) >= 5 and t.endswith(("el", "ek", "ec")):
                add(t[:-2] + t[-1])                  # Tomek -> Tomka, Michael -> Michala
            if len(t) <= 4 and t[-1] in "aeiouy":
                add(t[:-1])                          # Eva -> Evy, Evě, Evou
            if t.endswith("ova") and len(t) > 5:
                add(t[:-3])                          # Dvořáková -> Dvořák
            if orig.endswith(("ý", "á")) and len(t) >= 4:
                add(t[:-1])                          # Nový/Nová -> Nov
    return sorted(out.items())


def _year_near_name(text: str, names: list[str], years: set[int]) -> str | None:
    """Return a sample when a year from `years` is within 80 characters of a name."""
    t = _strip_accents(text)
    spans = []
    for stem, suffix in _stems(names):
        tail = r"\w*" if suffix is None else rf"\w{{0,{suffix}}}(?!\w)"
        spans += [(m.start(), m.end())
                  for m in re.finditer(rf"(?<!\w){re.escape(stem)}{tail}", t)]
    if not spans:
        return None
    for year in years:
        for r in re.finditer(rf"(?<!\d){year}(?!\d)", t):
            for a, b in spans:
                if (a - r.end() <= DISTANCE and r.start() - b <= DISTANCE
                        and (a >= r.end() or r.start() >= b)):
                    lo = max(0, min(a, r.start()) - 20)
                    return t[lo:max(b, r.end()) + 20].replace("\n", " ")
    return None


def _json_strings(obj, lines: list[str], strings: list[str]) -> None:
    flat: list[str] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            strings.append(str(k))
            flat.append(str(k))
            if isinstance(v, (dict, list)):
                _json_strings(v, lines, strings)
            else:
                flat.append(str(v))
                if isinstance(v, str):
                    strings.append(v)
    elif isinstance(obj, list):
        for v in obj:
            if isinstance(v, (dict, list)):
                _json_strings(v, lines, strings)
            else:
                flat.append(str(v))
                if isinstance(v, str):
                    strings.append(v)
    if flat:
        lines.append(" | ".join(flat))


def _file_texts(path: Path) -> tuple[list[str], list[str]]:
    """(texts for rules a-d, texts for the year-near-name rule: "lines" with context)."""
    raw = path.read_text(encoding="utf-8", errors="replace")
    suffix = path.suffix.lower()
    twin = DATA_TWIN.match(raw) if suffix == ".js" else None
    if twin:        # data/*.js = a JSON wrapped for opening from disk -> checked as JSON
        raw, suffix = raw[twin.end():].rstrip().removesuffix(";"), ".json"
    if suffix == ".json":
        try:
            lines: list[str] = []
            strings: list[str] = []
            _json_strings(json.loads(raw), lines, strings)
            return strings + lines, lines + strings
        except ValueError:
            pass
    if suffix in (".html", ".xml"):
        plain = html.unescape(re.sub(r"<[^>]*>", " ", raw))
        attributes = " ".join(html.unescape(a) for a in
                              re.findall(r"=\s*[\"']([^\"']*)[\"']", raw))
        return [html.unescape(raw), plain, attributes], [plain, attributes]
    t = html.unescape(raw) if suffix == ".txt" else raw
    return [t], [t]


def _remove_exceptions(text: str, exceptions: list[str]) -> str:
    for v in exceptions:
        if v:
            text = text.replace(v, " ")
    return text


def check_output(folder: Path,
                 living: list[tuple[list[str], list[GDate]]],
                 exceptions: list[str],
                 allowed_documents: set[str] | frozenset[str] = frozenset(),
                 ext: dict | None = None) -> list[str]:
    """Walk the `.html .json .xml .txt .js .css` files in `folder` and return descriptions of problems.

    living             [(names, dates)]: given name(s) and surname of a living person,
                       their birth date and marriage dates (see `living_for_check`).
    exceptions         strings removed from the text before the check.
    allowed_documents  paths relative to `documents/` (e.g. "a/x.webp") that may be in the output.
    ext                `extensions(...)`: month names of further languages.

    Rules: (a) a form of a birth/marriage date, (b) a year of `living` within 80
    characters of the name (text without HTML tags, JSON by values), (c) an e-mail,
    (d) a phone number, (e) a file in `documents/` that is not allowed."""
    folder = Path(folder)
    problems: list[str] = []
    patterns = [(d, v) for _, dates in living for d in dates for v in _patterns(d, ext=ext)]
    allowed = {p.replace("\\", "/").removeprefix("documents/") for p in allowed_documents}
    for path in sorted(folder.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(folder).as_posix()
        if rel.startswith("documents/"):
            if rel.removeprefix("documents/") not in allowed:
                problems.append(f"{rel}: document not allowed")
            continue
        if path.suffix.lower() not in EXTENSIONS:
            continue
        texts, lines = _file_texts(path)
        texts = [_INVISIBLE.sub("", _remove_exceptions(t, exceptions)) for t in texts]
        lines = [_INVISIBLE.sub("", _remove_exceptions(t, exceptions)) for t in lines]
        seen: set[str] = set()

        def report(message: str) -> None:
            if message not in seen:
                seen.add(message)
                problems.append(f"{rel}: {message}")

        for t in texts:
            for d, v in patterns:
                m = v.search(t)
                if m:
                    report(f"date of a living person \"{m.group(0)}\"")
            for m in _EMAIL.finditer(t):
                if m.group(1).lower() not in _EMAIL_FILE_SUFFIXES:
                    report(f"e-mail \"{m.group(0)}\"")
            for m in _PHONE.finditer(t):
                report(f"phone number \"{m.group(0)}\"")
        for names, dates in living:
            years = {d.year for d in dates if d.year is not None}
            if not years or not names:
                continue
            for t in lines:
                sample = _year_near_name(t, names, years)
                if sample:
                    report(f"year of a living person next to the name \"{sample}\"")
                    break
    return problems
