"""Write the golden outputs of the Python build that the JS port must match.

Run: .venv/bin/python -I tests/golden/make_golden.py
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import markdown

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
TEXT = {".html", ".json", ".md", ".txt", ".xml"}


def render(text: str) -> str:
    # The same parameters as familychronicle/chronicles.py uses.
    return markdown.markdown(text, extensions=["tables", "footnotes", "sane_lists"],
                             extension_configs={"footnotes": {"UNIQUE_IDS": True, "BACKLINK_TEXT": ""}})


def main() -> int:
    for md in sorted((HERE / "markdown").glob("*.md")):
        md.with_suffix(".html").write_text(render(md.read_text(encoding="utf-8")), encoding="utf-8")
    target = HERE / "example"
    if target.exists():
        shutil.rmtree(target)
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out"
        subprocess.run([sys.executable, "-I", str(REPO / "build.py"), "--config", str(REPO / "example" / "site.json"),
                        "--out", str(out), "--today", "2026-11-23"], check=True)
        for f in sorted(out.rglob("*")):
            if f.is_file() and f.suffix in TEXT:
                dest = target / f.relative_to(out)
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(f, dest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
