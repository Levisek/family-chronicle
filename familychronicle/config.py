"""Site configuration (site.json): a dict plus path resolution."""
from __future__ import annotations

import json
from pathlib import Path


def _ref(value):
    """A GEDCOM id with or without the `@` signs ("@I1@" -> "I1")."""
    return value.strip().strip("@") if isinstance(value, str) else value


class Config(dict):
    """Contents of site.json. Relative paths resolve against the config's directory.
    GEDCOM ids may be written as `I1` or `@I1@`; they are stored without the `@`."""

    def __init__(self, data: dict, base_dir: Path):
        super().__init__(data)
        self.base_dir = Path(base_dir)
        if "root" in self:
            self["root"] = _ref(self["root"])
        for key in ("living_extra", "deceased_extra", "exclude"):
            if isinstance(self.get(key), list):
                self[key] = [_ref(x) for x in self[key]]
        if isinstance(self.get("living_town"), dict):
            self["living_town"] = {_ref(k): v for k, v in self["living_town"].items()}
        if isinstance(self.get("branches"), list):
            self["branches"] = [
                {**b, "roots": [_ref(x) for x in b["roots"]]} if isinstance(b, dict) and isinstance(b.get("roots"), list) else b
                for b in self["branches"]]

    def path(self, key: str) -> Path:
        return (self.base_dir / self[key]).resolve()


def load(path: Path) -> Config:
    path = Path(path).resolve()
    return Config(json.loads(path.read_text(encoding="utf-8")), path.parent)
