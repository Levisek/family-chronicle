"""Scope of the site: the root's ancestors, their siblings and the siblings'
descendants, spouses, branches and the rule for living people. Ancestors of a
married-in person only count when they have children with a blood relative (for
those children it is a direct line). The root's own descendants stay out."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from familychronicle.gedcom import Person, Tree

COMMON = "common"
OTHER = "other"        # ancestor from ahnentafel 8 up who belongs to no branch
BRANCH_BOUNDARY = 8    # ahnentafel < 8 (root, parents, grandparents) = common
LIVING_YEARS = 100     # default for config `living_years`


def check_living_years(years: object) -> int:
    """`living_years` must be an int >= 100: a lower value would publish living people."""
    if isinstance(years, bool) or not isinstance(years, int) or years < LIVING_YEARS:
        raise ValueError(
            f"living_years must be an integer >= {LIVING_YEARS} (got {years!r}); "
            "a lower value would weaken the protection of living people")
    return years


def is_living(p: Person, today: date, years: int = LIVING_YEARS) -> bool:
    """No DEAT/BURI and (born less than `years` ago, or the birth year is unknown)."""
    check_living_years(years)
    if p.has_death:
        return False
    birth = p.birth
    if birth is None or birth.date is None or birth.date.year is None:
        return True
    # by year only, on purpose cautious: even the year exactly `years` ago still counts as living
    return today.year - birth.date.year <= years


@dataclass
class Scope:
    root: str
    ahnentafel: dict[str, int]                 # ancestor -> ahnentafel number (root = 1)
    siblings: set[str]
    people: set[str]                           # everyone on the site
    living: set[str]
    branch_of: dict[str, str]                  # person -> branch key / COMMON / OTHER
    sex: dict[str, str] = field(default_factory=dict)
    sibling_of: dict[str, str] = field(default_factory=dict)       # sibling -> ancestor
    descendant_of: dict[str, tuple[str, int]] = field(default_factory=dict)  # descendant of a sibling -> (sibling, depth)
    parent_in_line: dict[str, str] = field(default_factory=dict)   # descendant of a sibling -> blood parent
    spouse_of: dict[str, str] = field(default_factory=dict)        # married-in -> their partner in scope
    spouse_families: dict[str, dict] = field(default_factory=dict)  # married-in -> {"divorce": bool, "marriage": bool}
    map_people: set[str] = field(default_factory=set)             # who may appear on the map (ancestors and siblings)
    half_siblings: set[str] = field(default_factory=set)          # half-siblings of ancestors
    partner_ancestor: dict[str, tuple[str, int]] = field(default_factory=dict)  # ancestor -> (married-in, ahnentafel from them)
    excluded: set[str] = field(default_factory=set)               # removed by config `exclude`

    def __post_init__(self) -> None:
        if not self.map_people:
            self.map_people = set(self.people)


def _ahnentafel(tree: Tree, root: str) -> dict[str, int]:
    numbers = {root: 1}
    queue = [root]
    while queue:
        x = queue.pop(0)
        n = numbers[x]
        pf = tree.people[x].parents_family
        f = tree.families.get(pf) if pf else None
        if not f:
            continue
        for pid, k in ((f.husband, 2 * n), (f.wife, 2 * n + 1)):
            if pid and pid in tree.people and (pid not in numbers or k < numbers[pid]):
                numbers[pid] = k           # on pedigree collapse the lowest number wins
                queue.append(pid)
    return numbers


def determine_scope(tree: Tree, config: dict, today: date) -> Scope:
    root = config["root"]
    years = check_living_years(config.get("living_years", LIVING_YEARS))
    ahnentafel = _ahnentafel(tree, root)

    sibling_of: dict[str, str] = {}
    for p in sorted(ahnentafel, key=ahnentafel.get):
        for s in tree.siblings(p):
            if s not in ahnentafel and s not in sibling_of:
                sibling_of[s] = p
    # half-siblings: children of an ancestor from another union (siblings of their child in the line)
    half_siblings: set[str] = set()
    by_number = {n: i for i, n in ahnentafel.items()}
    for p in sorted(ahnentafel, key=ahnentafel.get):
        n = ahnentafel[p]
        child = by_number.get(n // 2)
        if n < 2 or not child:
            continue
        for fid in tree.people[p].families:
            if fid == tree.people[child].parents_family or fid not in tree.families:
                continue
            for s in tree.families[fid].children:
                if s in tree.people and s not in ahnentafel and s not in sibling_of:
                    sibling_of[s] = child
                    half_siblings.add(s)
    siblings = set(sibling_of)

    # branches: branch roots and their ancestors; the order in the config decides
    # on pedigree collapse (an ancestor belongs to the first branch that includes them)
    branch_of: dict[str, str] = {}
    for p, n in ahnentafel.items():
        branch_of[p] = COMMON if n < BRANCH_BOUNDARY else OTHER
    assigned: set[str] = set()
    for b in config.get("branches", []):
        stack = [r for r in b.get("roots", []) if r in ahnentafel]
        seen: set[str] = set()
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            if x not in assigned and ahnentafel[x] >= BRANCH_BOUNDARY:
                branch_of[x] = b["key"]
                assigned.add(x)
            stack += [r for r in tree.parents(x) if r in ahnentafel]
    for s, p in sibling_of.items():
        branch_of[s] = branch_of[p]

    excluded = set(config.get("exclude", []))
    map_people = (set(ahnentafel) | siblings) - half_siblings - excluded

    # descendants of siblings (cousins, nephews...) in all generations; the root's children are not included
    descendant_of: dict[str, tuple[str, int]] = {}
    parent_in_line: dict[str, str] = {}
    queue = [(d, s, 1, s) for s in sorted(siblings) for d in tree.children(s)]
    while queue:
        x, s, depth, parent = queue.pop(0)
        if x in ahnentafel or x in siblings or x in descendant_of:
            continue
        descendant_of[x] = (s, depth)
        parent_in_line[x] = parent
        queue += [(d, s, depth + 1, x) for d in tree.children(x)]
    for x, (s, _) in descendant_of.items():
        branch_of[x] = branch_of[sibling_of[s]]

    # spouses and partners of the root, ancestors (further marriages), siblings and their descendants
    blood = set(ahnentafel) | siblings | set(descendant_of)
    spouse_of: dict[str, str] = {}
    spouse_families: dict[str, dict] = {}
    for a in sorted(blood, key=lambda i: (ahnentafel.get(i, 10**9), i)):
        for fid in tree.people[a].families:
            f = tree.families.get(fid)
            if not f:
                continue
            for m in (f.husband, f.wife):
                if m and m != a and m in tree.people and m not in blood and m not in spouse_of:
                    spouse_of[m] = a
                    types = {e.type for e in f.events}
                    spouse_families[m] = {"divorce": "DIV" in types, "marriage": "MARR" in types}

    # ancestors of a co-parent: a married-in person with children among the blood
    # relatives (e.g. the father of an ancestor's half-siblings); for those children it is their own line
    partner_ancestor: dict[str, tuple[str, int]] = {}
    for m, a in sorted(spouse_of.items()):
        shared_children = any(
            d in blood
            for fid in tree.people[m].families if fid in tree.families
            and a in (tree.families[fid].husband, tree.families[fid].wife)
            for d in tree.families[fid].children)
        if not shared_children:
            continue
        for x, n in _ahnentafel(tree, m).items():
            if n > 1 and x not in blood and x not in spouse_of and x not in partner_ancestor:
                partner_ancestor[x] = (m, n)
                branch_of[x] = branch_of.get(a, "")

    people = (blood | set(spouse_of) | set(partner_ancestor)) - excluded
    living = {i for i in people if is_living(tree.people[i], today, years)}
    living |= set(config.get("living_extra", [])) & people
    living -= set(config.get("deceased_extra", []))

    return Scope(
        root=root, ahnentafel=ahnentafel, siblings=siblings, people=people, living=living,
        branch_of=branch_of,
        sex={i: tree.people[i].sex for i in people},
        sibling_of=sibling_of,
        descendant_of={k: v for k, v in descendant_of.items() if k in people},
        parent_in_line=parent_in_line,
        spouse_of={k: v for k, v in spouse_of.items() if k in people and v in people},
        spouse_families=spouse_families,
        map_people=map_people,
        half_siblings=half_siblings & people,
        partner_ancestor={k: v for k, v in partner_ancestor.items() if k in people},
        excluded=excluded)
