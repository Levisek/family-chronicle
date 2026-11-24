"""Month-name tables shared by privacy (redaction patterns) and event formatting.

The Czech tables are data, not identifiers: they are needed to recognise and
redact dates written in Czech text, and to format dates in the `cs` locale."""
from __future__ import annotations

# Czech: nominative ("leden"), genitive ("5. ledna 1995")
CS_NOM = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec",
          "srpen", "září", "říjen", "listopad", "prosinec"]
CS_GEN = ["ledna", "února", "března", "dubna", "května", "června", "července",
          "srpna", "září", "října", "listopadu", "prosince"]
# Czech locative and instrumental ("v lednu", "s lednem"); September has one form
CS_OTHER = [["lednu", "lednem"], ["únoru", "únorem"], ["březnu", "březnem"],
            ["dubnu", "dubnem"], ["květnu", "květnem"], ["červnu", "červnem"],
            ["červenci", "červencem"], ["srpnu", "srpnem"], ["září"],
            ["říjnu", "říjnem"], ["listopadu", "listopadem"],
            ["prosinci", "prosincem"]]

EN_FULL = ["January", "February", "March", "April", "May", "June", "July",
           "August", "September", "October", "November", "December"]
EN_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct",
            "Nov", "Dec"]


def month_names(month: int, extra: list[list[str]] | None = None) -> list[str]:
    """Every spelling of a month (1-12) that redaction must recognise: the built-in Czech and
    English forms plus `extra` (12 lists of forms, from the `privacy.months` of other locales)."""
    i = month - 1
    out = [CS_GEN[i], CS_NOM[i], *CS_OTHER[i], EN_FULL[i], EN_SHORT[i], EN_SHORT[i].upper()]
    if extra:
        out += extra[i]
    if month == 9:
        out.append("Sept")
    return list(dict.fromkeys(out))
