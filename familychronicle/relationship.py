"""Relationship of a person to the root, in words (`cs` and `en`).

The Czech grammar (genitive forms, the "pra-" prefix of great-nephews and
great-grandparents, cousin ordinals) is kept as data in the word tables and
inline forms below; English is the simple case."""
from __future__ import annotations

from familychronicle.scope import Scope

_CS = {
    "M": ["otec", "dědeček", "pradědeček", "prapradědeček"],
    "F": ["matka", "babička", "prababička", "praprababička"],
}
_CS_GEN = {
    "M": ["otce", "dědečka", "pradědečka", "prapradědečka"],
    "F": ["matky", "babičky", "prababičky", "praprababičky"],
}
_EN = {
    "M": ["father", "grandfather", "great-grandfather"],
    "F": ["mother", "grandmother", "great-grandmother"],
}


def _generation(n: int) -> int:
    return n.bit_length() - 1


def _ancestor(g: int, male: bool, lang: str, gen: bool = False) -> str:
    k = "M" if male else "F"
    if lang == "cs":
        forms = (_CS_GEN if gen else _CS)[k]
        if g <= 4:
            return forms[g - 1]
        base = ("pradědečka" if male else "prababičky") if gen else (
            "pradědeček" if male else "prababička")
        return f"{g - 2}× {base}"
    if g <= 3:
        return _EN[k][g - 1]
    return f"{g - 2}× {_EN[k][2]}"


def _blood(scope: Scope, id: str, lang: str, gen: bool = False) -> str:
    """Blood relationship to the root (ancestor, ancestor's sibling, sibling's descendant)."""
    cs = lang == "cs"
    p = scope.sex.get(id, "")
    male, female = p == "M", p == "F"

    def sl(m: str, f: str, n: str) -> str:
        return m if male else f if female else n

    if id == scope.root:
        return ("autora" if gen else "sám autor") if cs else "the author"
    if id in scope.ahnentafel:
        n = scope.ahnentafel[id]
        return _ancestor(_generation(n), n % 2 == 0, lang, gen)
    if id in scope.sibling_of:
        a = scope.sibling_of[id]
        if a == scope.root:  # own sibling of the root
            if id in scope.half_siblings:
                return ("nevlastní " if cs else "half-") + _blood_sibling(sl, cs, gen)
            if cs:
                return sl("bratra", "sestry", "sourozence") if gen else sl("bratr", "sestra", "sourozenec")
            return sl("brother", "sister", "sibling")
        n = scope.ahnentafel[a]
        half = id in scope.half_siblings
        if cs:
            s = sl("bratra", "sestry", "sourozence") if gen else sl("bratr", "sestra", "sourozenec")
            if half:
                s = sl("nevlastního " if gen else "nevlastní ", "nevlastní ", "nevlastního " if gen else "nevlastní ") + s
            return f"{s} {_ancestor(_generation(n), n % 2 == 0, 'cs', True)}"
        s = sl('brother', 'sister', 'sibling')
        return f"{'half-' if half else ''}{s} of {_ancestor(_generation(n), n % 2 == 0, 'en')}"
    if id not in scope.descendant_of:
        return ""
    s, d = scope.descendant_of[id]
    a = scope.sibling_of[s]
    n = scope.ahnentafel[a]
    g = _generation(n)            # generation of the ancestor whose sibling s is (root = 0)
    if g == 0:                  # descendants of the root's sibling
        if cs:
            base = (sl("synovce", "neteře", "potomka sourozence") if gen else
                    sl("synovec", "neteř", "potomek sourozence"))
            if d == 1:
                return base
            prefix = "pra" * (d - 1) if d <= 3 else f"{d - 1}× pra"
            return prefix + base if (male or female) else base
        base = sl("nephew", "niece", "sibling's descendant")
        return base if d == 1 else ("great-" * (d - 2) + "grand" + base if (male or female) else base)
    k = min(g, d)               # degree of cousinship
    r = g - d                   # >0 older generation, <0 younger
    if cs:
        ordinal = ["", "", "druh", "třet", "čtvrt"]
        if k == 1:
            male_form, female_form = ("bratrance", "sestřenice") if gen else ("bratranec", "sestřenice")
        else:
            ordinal_cs = ordinal[k] if k < len(ordinal) else f"{k}."
            if k < len(ordinal):
                male_form = f"{ordinal_cs}ého bratrance" if gen else f"{ordinal_cs}ý bratranec"
                female_form = f"{ordinal_cs}é sestřenice" if gen else f"{ordinal_cs}á sestřenice"
            else:
                male_form, female_form = (f"{ordinal_cs} bratrance", f"{ordinal_cs} sestřenice") if gen else (f"{ordinal_cs} bratranec", f"{ordinal_cs} sestřenice")
        if r >= 0:
            base = sl(male_form, female_form, male_form)
            if r == 0:
                return base
            # cousin of the ancestor of generation r on the way to the root
            m = n >> (g - r)
            return f"{base} {_ancestor(r, m % 2 == 0, 'cs', True)}"
        # younger: son/daughter of a cousin, grandson/granddaughter of a cousin...
        parent = id
        for _ in range(-r):
            parent = scope.parent_in_line.get(parent, parent)
        parent_female = scope.sex.get(parent, "") == "F"
        kin = {1: ("syna", "dcery", "dítěte") if gen else ("syn", "dcera", "dítě"),
                2: ("vnuka", "vnučky", "vnoučete") if gen else ("vnuk", "vnučka", "vnouče")}
        triple = kin.get(-r, ("potomka",) * 3 if gen else ("potomek",) * 3)
        if k == 1:
            cousin_gen = "sestřenice" if parent_female else "bratrance"
        elif k < len(ordinal):
            cousin_gen = f"{ordinal[k]}é sestřenice" if parent_female else f"{ordinal[k]}ého bratrance"
        else:
            cousin_gen = f"{k}. sestřenice" if parent_female else f"{k}. bratrance"
        return f"{sl(*triple)} {cousin_gen}"
    ordinal_en = {1: "first", 2: "second", 3: "third"}.get(k, f"{k}th")
    base = f"{ordinal_en} cousin"
    if r == 0:
        return base
    if r > 0:
        m = n >> (g - r)
        return f"{base} of {_ancestor(r, m % 2 == 0, 'en')}"
    parent = id
    for _ in range(-r):
        parent = scope.parent_in_line.get(parent, parent)
    kdo = {1: ("son", "daughter", "child"), 2: ("grandson", "granddaughter", "grandchild")}.get(-r, ("descendant",) * 3)
    return f"{sl(*kdo)} of {base}"


def _blood_sibling(sl, cs: bool, gen: bool) -> str:
    if cs:
        return sl("bratra", "sestry", "sourozence") if gen else sl("bratr", "sestra", "sourozenec")
    return sl("brother", "sister", "sibling")


def _spouse_of_ancestor(scope: Scope, id: str, lang: str, gen: bool) -> str:
    """Genitive form ("husband of grandmother" in Czech) for the ancestors of a married-in person."""
    base = relationship(scope, id, lang)
    if lang != "cs" or not gen:
        return base
    for nominative, genitive in (
            ("bývalý manžel", "bývalého manžela"), ("bývalá manželka", "bývalé manželky"),
            ("manželka", "manželky"), ("manžel", "manžela"), ("přítelkyně", "přítelkyně"),
            ("přítel", "přítele")):
        if base.startswith(nominative):
            return genitive + base[len(nominative):]
    return base


def relationship(scope: Scope, id: str, lang: str) -> str:
    """Relationship of a person to the root of the tree."""
    cs = lang == "cs"
    if id in scope.partner_ancestor:
        m, n = scope.partner_ancestor[id]
        return f"{_ancestor(_generation(n), n % 2 == 0, lang)} {'' if cs else 'of the '}{_spouse_of_ancestor(scope, m, lang, cs)}"
    if id in scope.spouse_of:
        a = scope.spouse_of[id]
        f = scope.sex.get(id, "") == "F"
        fam_info = scope.spouse_families.get(id, {})
        if cs:
            if not fam_info.get("marriage") and not fam_info.get("divorce"):
                word = "přítelkyně" if f else "přítel"
            else:
                word = "manželka" if f else "manžel"
                if fam_info.get("divorce"):
                    word = ("bývalá " if f else "bývalý ") + word
            if a == scope.root:
                return word
            return f"{word} {_blood(scope, a, 'cs', True)}"
        if not fam_info.get("marriage") and not fam_info.get("divorce"):
            word = "partner"
        else:
            word = ("wife" if f else "husband")
            if fam_info.get("divorce"):
                word = "former " + word
        if a == scope.root:
            return word
        return f"{word} of {_blood(scope, a, 'en')}"
    return _blood(scope, id, lang)
