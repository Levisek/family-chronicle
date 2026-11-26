// A hand-made gazetteer in the format of app/data/gazetteer.js (see tools/gazetteer.mjs).
window.FC_GAZ = {
  names: [
    ["Vienna", 48.2085, 16.3721, "AT", "09"],
    ["Linz", 48.3064, 14.2861, "AT", "04"],
    ["Lhota", 50.1012, 14.6233, "CZ", "88"],
    ["Lhota", 49.7111, 17.6011, "CZ", "85"],
    ["Kraków", 50.0614, 19.9366, "PL", "77"],
    ["Brno", 49.1952, 16.608, "CZ", "78"]
  ],
  index: {"wien": [0], "vienne": [0], "krakau": [4], "brunn": [5]},
  admin1: {
    "AT.09": ["Vienna", "wien"], "AT.04": ["Upper Austria", "oberosterreich"],
    "CZ.88": ["Central Bohemia", "stredocesky kraj"], "CZ.85": ["Olomoucký kraj", "olomoucky kraj", "olomouc region"],
    "PL.77": ["Lesser Poland", "malopolskie"], "CZ.78": ["South Moravian", "jihomoravsky kraj"]
  },
  countries: {"austria": "AT", "rakousko": "AT", "osterreich": "AT", "czech republic": "CZ", "czechia": "CZ", "cesko": "CZ", "ceska republika": "CZ", "poland": "PL", "polsko": "PL"},
  countryNames: {"AT": {"en": "Austria", "cs": "Rakousko"}, "CZ": {"en": "Czechia", "cs": "Česko"}, "PL": {"en": "Poland", "cs": "Polsko"}}
};
