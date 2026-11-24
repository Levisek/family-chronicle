"""Typesets the chronicles into one PDF book.

The text is the same Markdown as on the website (one chapter per branch that has
a `chronicle` in site.json, in config order; branches without one get no chapter).
Footnotes go to the end of each chapter as "Sources". Images from documents are
inserted after the paragraph that contains a given snippet (`images` in book.json).

By default the book is safe to publish like the website: `<!-- web:hide -->...<!-- /web:hide -->`
passages are removed and `<!-- web:text: ... -->` replacements are shown (the same code
as the web, `privacy.redact` and `chronicles._TEXT`). Set `include_hidden: true` in
book.json for a private family print: then the Markdown is typeset as written, hidden
passages are kept, web:text replacements are not shown and the dates of living people
are not redacted. In the default mode those dates (birth, marriages; decided by the
100-year rule as of `--today`, default today) are redacted exactly like on the website.

In that safe mode the book is also gated like the website: an image is typeset only when it
matches a published document (the same whitelist as the build: no living or excluded person, a
foreign work or `crop_only` sheet only as the documented crop), otherwise the book stops with an
error naming the image; and the generated HTML goes through `privacy.check_output` (with the
`check_exceptions` of site.json) before it is printed, a finding exits with 1.

book.json keys: site (path to site.json), title, subtitle, tagline, colophon
(optional), output, language, include_hidden (a JSON boolean, default false; anything else is an
error), images[{chronicle, after_text, source, crop, caption}]. Relative paths in book.json resolve against its folder; image
sources and chronicles resolve against the folder of site.json. `chronicle` is
the value from site.json, `caption` and `after_text` may be a string or a
{language: text} object.

Usage: python -I book.py --config example/book.json [--out FILE] [--chrome PATH] [--no-sandbox]
Needs: markdown, Pillow, PyMuPDF (PDF sources only) and a headless Chromium."""
from __future__ import annotations

import argparse
from datetime import date
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import markdown

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))   # `python -I` adds no path

from familychronicle import config as config_module
from familychronicle.chronicles import _TEXT, _source_file
from familychronicle import documents
from familychronicle.documents import load_image
from familychronicle.gedcom import load as load_tree
from familychronicle.privacy import check_output, living_for_check, locale_extensions, redact, sensitive_dates
from familychronicle.scope import determine_scope

FONTS = Path(__file__).resolve().parent.parent / "fonts"
LOCALES = Path(__file__).resolve().parent.parent / "locales"
LABELS = {
    "en": {"contents": "Contents", "sources": "Sources"},
    "cs": {"contents": "Obsah", "sources": "Prameny"},
}
CHROME_NAMES = ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable",
                "chrome-headless-shell", "chrome")
CHROME_APPS = ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
               "/Applications/Chromium.app/Contents/MacOS/Chromium")

CSS = """
@font-face { font-family: Garamond; src: url('FONTS/EBGaramond.ttf'); font-style: normal; font-weight: 400 800; }
@font-face { font-family: Garamond; src: url('FONTS/EBGaramond-Italic.ttf'); font-style: italic; font-weight: 400 800; }
@page { size: A4; margin: 22mm 24mm 24mm 24mm;
  @bottom-center { content: counter(page); font-family: Garamond; font-size: 10pt; color: #8a7a62; } }
@page :first { @bottom-center { content: none; } }
html { font-family: Garamond, serif; font-size: 12.2pt; line-height: 1.45; color: #2b2520;
  hyphens: auto; font-variant-numeric: oldstyle-nums proportional-nums; }
body { margin: 0; }
p { margin: 0 0 .55em; text-align: justify; orphans: 3; widows: 3; }
h1 { font-weight: 500; font-size: 26pt; letter-spacing: .02em; color: #5a2e1c; margin: 0 0 .2em;
  text-align: center; }
.chapter { break-before: page; }
.chapter > .label { text-align: center; text-transform: uppercase; letter-spacing: .25em;
  font-size: 9.5pt; color: #8a7a62; margin-top: 18mm; }
.chapter > h1 + p, .chapter > h1 + p + p { font-size: 10.5pt; color: #6b5d4d; text-align: center; }
.ornament { text-align: center; color: #b39a73; font-size: 14pt; margin: .3em 0 1.2em; }
h2 { font-weight: 600; font-size: 15.5pt; color: #5a2e1c; margin: 1.3em 0 .45em; break-after: avoid; }
h3 { font-weight: 600; font-style: italic; font-size: 13pt; color: #5a2e1c; margin: 1em 0 .35em; break-after: avoid; }
strong { font-weight: 600; }
code { font-family: Garamond, serif; font-style: italic; font-size: 1em; color: #6b5d4d; }
ul { margin: 0 0 .7em 1.1em; padding: 0; } li { margin: 0 0 .25em; }
blockquote { margin: .8em 0; padding: .6em .9em; background: #f6efe3; border-left: 3px solid #b39a73;
  break-inside: avoid; } blockquote p { margin: 0; }
table { border-collapse: collapse; width: 100%; font-size: 9.6pt; line-height: 1.3; margin: .6em 0 1em;
  font-variant-numeric: lining-nums tabular-nums; }
th { text-align: left; font-weight: 600; color: #5a2e1c; border-bottom: 1.2px solid #b39a73; padding: 3px 5px; }
td { border-bottom: .5px solid #e2d6c2; padding: 3px 5px; vertical-align: top; }
tr { break-inside: avoid; }
figure { margin: 1em 0 1.2em; break-inside: avoid; text-align: center; }
figure img { max-width: 100%; max-height: 120mm; border: .5px solid #d8cbb5; }
figure.tall img { max-height: 150mm; }
figcaption { font-size: 9.6pt; font-style: italic; color: #6b5d4d; margin-top: .35em; }
sup { line-height: 0; font-size: .7em; } sup a { color: #8a5a2e; text-decoration: none; }
.footnote { margin-top: 1.6em; font-size: 9.3pt; line-height: 1.35; color: #4d443b; break-inside: auto; }
.footnote::before { content: "SOURCES"; display: block; font-weight: 600; font-size: 11pt;
  color: #5a2e1c; margin-bottom: .3em; }
.footnote hr { border: none; border-top: .5px solid #b39a73; width: 30%; margin: 0 0 .6em; }
.footnote ol { padding-left: 1.4em; } .footnote p { text-align: left; margin: 0; }
.footnote-backref { display: none; }
.title-page { height: 245mm; display: flex; flex-direction: column; justify-content: center; text-align: center; }
.title-page .big { font-size: 40pt; font-weight: 500; color: #5a2e1c; letter-spacing: .03em; }
.title-page .subtitle { font-size: 15pt; font-style: italic; color: #6b5d4d; margin-top: .4em; }
.title-page .tagline { margin-top: 2.2em; font-size: 12pt; letter-spacing: .18em; text-transform: uppercase; color: #8a7a62; }
.title-page .colophon { margin-top: 4em; font-size: 11pt; color: #8a7a62; }
.contents { break-before: page; } .contents h2 { text-align: center; margin-top: 30mm; }
.contents ol { list-style: none; padding: 0; width: 70%; margin: 2em auto; font-size: 13pt; }
.contents li { display: flex; margin: .5em 0; }
.contents li span.dots { flex: 1; border-bottom: 1px dotted #b39a73; margin: 0 .4em .3em; }
"""


class ChromeNotFound(RuntimeError):
    pass


def find_chrome(explicit: str | None = None, env=None, which=shutil.which, home: Path | None = None,
                apps=CHROME_APPS) -> str:
    """Chromium: --chrome, env CHROME, a name on PATH, a macOS app bundle, then Playwright's
    download in ~/.cache."""
    env = os.environ if env is None else env
    home = Path.home() if home is None else home

    def usable(p) -> bool:
        return bool(p) and Path(p).is_file() and os.access(p, os.X_OK)

    if explicit:
        if usable(explicit):
            return str(explicit)
        raise ChromeNotFound(f"The browser given by --chrome does not exist or is not executable: {explicit}")
    if env.get("CHROME"):
        if usable(env["CHROME"]):
            return env["CHROME"]
        raise ChromeNotFound(f"The browser in the CHROME environment variable is not executable: {env['CHROME']}")
    for name in CHROME_NAMES:
        found = which(name)
        if found:
            return found
    for app in apps:
        if usable(app):
            return str(app)
    cands = [p for p in (home / ".cache/ms-playwright").glob("*/chrome*/chrome*") if p.is_file() and os.access(p, os.X_OK)]
    cands.sort(key=lambda p: ("headless_shell" not in str(p), str(p)))   # the headless shell first
    if cands:
        return str(cands[0])
    raise ChromeNotFound(
        "No Chromium found. Install chromium or google-chrome, or pass --chrome PATH, "
        "or set the CHROME environment variable (a Playwright download in ~/.cache/ms-playwright also works).")


def _pick(value, lang: str) -> str:
    """A string, or a {language: text} object."""
    if isinstance(value, dict):
        return value.get(lang) or next(iter(value.values()))
    return value


def _label(branch: dict, lang: str) -> str:
    name = branch.get("name") or branch["key"]
    return _pick(name, lang) if isinstance(name, dict) else name


def _chapter_text(md: Path, images: list, lang: str, work_dir: Path, base_dir: Path, n: int, start: int, include_hidden: bool = False,
                  sensitive=(), ext: dict | None = None) -> str:
    """Markdown of a chapter with the images inserted after the paragraphs they belong to."""
    text = md.read_text(encoding="utf-8")
    if not include_hidden:   # as on the web: replacements in, hidden passages out
        text = _TEXT.sub(lambda m: html.escape(m.group(1).strip("\n"), quote=False), text)
        text = redact(text, list(sensitive), ext)
    for k, img in enumerate(images):
        snippet = _pick(img["after_text"], lang)
        pos = text.find(snippet)
        if pos < 0:
            raise ValueError(f"Snippet not found in {md.name}: {snippet!r}")
        end = text.find("\n\n", pos)
        end = len(text) if end < 0 else end
        im = load_image(img["source"], img.get("crop"), base_dir)
        im.thumbnail((1800, 1800))
        target = work_dir / f"img{n}_{start + k}.jpg"
        im.save(target, quality=85)
        cls = ' class="tall"' if im.height > im.width else ""
        fig = (f'\n\n<figure{cls}><img src="{target.as_uri()}" alt="">'
               f"<figcaption>{html.escape(_pick(img['caption'], lang))}</figcaption></figure>")
        text = text[:end] + fig + text[end:]
    return text


def _safe_scope(cfg, today: date | None):
    tree = load_tree(cfg.path("gedcom"))
    return tree, determine_scope(tree, cfg, today or date.today())


def _check_images(cfg, scope, images: list) -> None:
    """Safe mode: every image must match a document the website would publish."""
    all_documents = (documents.load_documents(cfg.path("documents"), cfg.base_dir)
                     if cfg.get("documents") else [])
    published, _ = documents.decide(all_documents, scope, cfg.base_dir,
                                    cfg.get("documents_cutoff_year", documents.DEFAULT_CUTOFF_YEAR))
    for img in images:
        if documents.image_document(published, img["source"], img.get("crop")) is None:
            raise ValueError(
                f"Image {img['source']!r} (crop {img.get('crop')}) is not a published document, so a "
                "book that is safe to hand out cannot contain it. Add it to documents.json with "
                "only people who may appear, or set include_hidden to true for a private print.")


def check_html(cfg, html_text: str, today: date | None = None) -> list[str]:
    """Final gate of a safe book: `privacy.check_output` over the generated HTML (the dates of the
    living people, e-mails, phone numbers), with the `check_exceptions` of site.json."""
    tree, scope = _safe_scope(cfg, today)
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / "book.html").write_text(html_text, encoding="utf-8")
        ext = locale_extensions(cfg["languages"], LOCALES, cfg.get("strings"))
        return check_output(Path(d), living_for_check(tree, scope), cfg.get("check_exceptions", []),
                            ext=ext)


def build_html(cfg, book: dict, work_dir: Path, fonts_dir: Path = FONTS, today: date | None = None) -> str:
    """The whole book as one HTML document; images are written (as JPEG) into `work_dir`."""
    lang = book.get("language") or cfg.get("default_language", "en")
    labels = LABELS.get(lang, LABELS["en"])
    default = cfg.get("default_language", "en")
    work_dir = Path(work_dir)
    images = list(book.get("images", []))
    branches = [b for b in cfg["branches"] if b.get("chronicle")]
    known = {b["chronicle"] for b in branches}
    for img in images:
        if img["chronicle"] not in known:
            raise ValueError(f"Image refers to a chronicle that no branch has: {img['chronicle']}")

    include_hidden = book.get("include_hidden", False)
    if not isinstance(include_hidden, bool):
        raise ValueError(f"include_hidden must be true or false (a JSON boolean), not {include_hidden!r}")
    sensitive: list = []
    ext = None
    if not include_hidden:   # the same dates the website redacts, and the website's document whitelist
        tree, scope = _safe_scope(cfg, today)
        sensitive = [d for ds in sensitive_dates(tree, scope).values() for d in ds]
        ext = locale_extensions(cfg["languages"], LOCALES, cfg.get("strings"))
        _check_images(cfg, scope, images)

    chapters, toc = [], []
    for n, b in enumerate(branches):
        md_file, _ = _source_file((cfg.base_dir / b["chronicle"]).resolve(), lang, default)
        mine = [i for i in images if i["chronicle"] == b["chronicle"]]
        text = _chapter_text(md_file, mine, lang, work_dir, cfg.base_dir, n, 0,
                             include_hidden, sensitive, ext)
        body = markdown.markdown(text, extensions=["tables", "footnotes", "sane_lists"],
                                 extension_configs={"footnotes": {"UNIQUE_IDS": True, "BACKLINK_TEXT": ""}})
        body = re.sub(r"(</h1>)", r'\1<div class="ornament">❦</div>', body, count=1)
        label = html.escape(_label(b, lang))
        chapters.append(f'<section class="chapter" id="c{n}"><div class="label">{label}</div>{body}</section>')
        toc.append(f'<li><a href="#c{n}" style="color:inherit;text-decoration:none">{label}</a>'
                   f'<span class="dots"></span></li>')

    title = ('<div class="title-page">'
             f'<div class="big">{html.escape(book.get("title", ""))}</div>'
             f'<div class="subtitle">{html.escape(book.get("subtitle", ""))}</div>')
    if book.get("tagline"):
        title += f'<div class="tagline">{html.escape(book["tagline"])}</div>'
    if book.get("colophon"):
        title += f'<div class="colophon">{html.escape(book["colophon"])}</div>'
    title += "</div>"
    css = CSS.replace("FONTS/", Path(fonts_dir).resolve().as_uri() + "/").replace("SOURCES", labels["sources"])
    return (f'<!doctype html><html lang="{html.escape(lang)}"><head><meta charset="utf-8">'
            f'<title>{html.escape(book.get("title", ""))}</title><style>{css}</style></head><body>'
            f'{title}<div class="contents"><h2>{labels["contents"]}</h2><ol>{"".join(toc)}</ol></div>'
            f'{"".join(chapters)}</body></html>')


def chrome_command(chrome: str, output: Path, page: Path, geteuid=getattr(os, "geteuid", None),
                   no_sandbox: bool = False) -> list[str]:
    """The headless print command. `--no-sandbox` only for root (Chromium refuses to start
    without it there) or when asked for with the `--no-sandbox` option of book.py."""
    args = [chrome, "--headless", "--disable-gpu", "--allow-file-access-from-files",
            "--no-pdf-header-footer", f"--print-to-pdf={output}", page.as_uri()]
    if no_sandbox or (geteuid is not None and geteuid() == 0):
        args.insert(2, "--no-sandbox")
    return args


def make_pdf(html_text: str, output: Path, chrome: str, work_dir: Path, no_sandbox: bool = False) -> None:
    page = Path(work_dir) / "book.html"
    page.write_text(html_text, encoding="utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(chrome_command(chrome, output, page, no_sandbox=no_sandbox), capture_output=True, text=True)
    if r.returncode != 0 or not output.is_file():
        raise RuntimeError(f"The browser failed to write the PDF (exit {r.returncode}): {r.stderr[-400:]}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Typeset the chronicles into a PDF book.")
    ap.add_argument("--config", type=Path, required=True, help="book.json")
    ap.add_argument("--out", type=Path, default=None, help="output PDF (default: `output` from book.json)")
    ap.add_argument("--today", type=date.fromisoformat, default=None,
                    help="date for the 100-year living rule (default: today)")
    ap.add_argument("--chrome", default=None, help="path to a Chromium / Chrome executable")
    ap.add_argument("--no-sandbox", action="store_true",
                    help="start the browser without its sandbox (only when it cannot start otherwise, "
                         "e.g. restricted user namespaces; root gets it automatically)")
    a = ap.parse_args(argv)
    spec_path = a.config.resolve()
    book = json.loads(spec_path.read_text(encoding="utf-8"))
    cfg = config_module.load(spec_path.parent / book["site"])
    output = a.out.resolve() if a.out else (spec_path.parent / book.get("output", "book.pdf")).resolve()
    try:
        chrome = find_chrome(a.chrome)
        with tempfile.TemporaryDirectory() as d:
            page = build_html(cfg, book, Path(d), today=a.today)
            if not book.get("include_hidden", False):
                problems = check_html(cfg, page, a.today)
                if problems:
                    print("Book check FAILED (nothing was printed):", file=sys.stderr)
                    for p in problems:
                        print(f"  {p}", file=sys.stderr)
                    return 1
            make_pdf(page, output, chrome, Path(d), a.no_sandbox)
    except (ChromeNotFound, ValueError, RuntimeError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    try:
        import pymupdf
        print(f"-> {output}  ({len(pymupdf.open(output))} pages)")
    except ImportError:
        print(f"-> {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
