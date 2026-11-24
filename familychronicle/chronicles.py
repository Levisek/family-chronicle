"""Chronicles (Markdown) -> HTML for the website.

The source is the same Markdown as for the book; web markers are HTML comments
on a line of their own, placed before a paragraph:
  <!-- place: Vienna; Linz -->        -> <div class="anchor" data-places="...">
  <!-- person: I12 -->  (or @I12@)    -> <div class="anchor" data-people="...">
  <!-- web:hide -->...<!-- /web:hide -->  -> removed (handled by `privacy.redact`)
  <!-- web:text: Replacement text -->     -> plain text on the web; the book treats
                                             it as a comment (replacement for hidden
                                             text); the text is escaped and one
                                             leading space is kept (`:  text`)
  <!-- img: snippet -->                   -> lets a translation anchor a book image
                                             (the snippet may sit in a comment)
All other comments are removed from the web output.

A chapter is a Markdown file `chronicles/<key>.md` in the default language; its
translation to language `<lang>` is `chronicles/<key>.<lang>.md` next to it.
When the translation is missing, the default-language file is used."""
from __future__ import annotations

import html
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import markdown

from familychronicle.documents import document_for_image, is_verified, unverified_label
from familychronicle.gedcom import GDate
from familychronicle.privacy import redact

_MARKER = re.compile(r"^[ \t]*<!--[ \t]*(place|person)[ \t]*:(.*?)-->[ \t]*$", re.M | re.S)
_TEXT = re.compile(r"<!--[ \t]*web:text[ \t]*: ?(.*?) ?-->", re.S)
_COMMENT = re.compile(r"<!--.*?-->", re.S)
_REST = re.compile(r"<!--[^\n]*")
_TOKEN = re.compile(
    r'<h2>(?P<h>.*?)</h2>'
    r'|<div class="anchor" data-(?P<kind>places|people)="(?P<value>[^"]*)"></div>', re.S)
_PERSON_ANCHOR = re.compile(
    r'<div class="anchor" data-people="([^"]*)"></div>\s*(<p[^>]*>.*?</p>)', re.S)
_NOTE = re.compile(r'(<li id="fn:[^"-]*-(?P<n>[^"]+)">.*?)(<a class="footnote-backref")', re.S)


@dataclass
class Chapter:
    slug: str
    title: str
    html: str
    content_language: str
    sections: list[dict] = field(default_factory=list)          # {id, title, places, people}
    person_paragraphs: dict[str, str] = field(default_factory=dict)


def chapter_slug(md_file: str | Path) -> str:
    """`chronicles/huber.md` and `chronicles/huber.cs.md` -> `huber`."""
    name = Path(md_file).name
    base = name.split(".", 1)[0]
    return _slug(base) or "chapter"


def _slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def _text(h: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", h)).strip()


def _values(s: str) -> list[str]:
    """`I12; @I3@` -> ["I12", "I3"] (authors may write IDs with or without @)."""
    return [v for v in (x.strip().strip("@").strip() for x in s.split(";")) if v]


def _markers(md: str) -> str:
    def replace(m):
        values = _values(m.group(2)) if m.group(1) == "person" else \
            [v.strip() for v in m.group(2).split(";") if v.strip()]
        if not values:
            return ""
        attr = "places" if m.group(1) == "place" else "people"
        return f'\n<div class="anchor" data-{attr}="{html.escape(";".join(values), quote=True)}"></div>\n'
    return _MARKER.sub(replace, md)


def _insert_images(md: str, slug: str, lang: str, published: list[dict], exports: dict[str, dict],
                   strings: dict, root_url: str, images: Iterable[tuple], base_dir: Path) -> str:
    pub = {d["id"]: d for d in published}
    for chapter, snippet, source, crop, caption in images:
        if chapter != slug:
            continue
        d = document_for_image(published, source, crop)
        if d is None or d["id"] not in pub or d["id"] not in exports:
            continue
        pos = md.find(snippet)
        if pos < 0:
            continue
        end = md.find("\n\n", pos)
        end = len(md) if end < 0 else end
        ex = exports[d["id"]]
        cap = (d.get("description") or {}).get(lang) or caption
        img = (f'<img src="{root_url}{ex["crop"]}" width="{ex["width"]}" '
               f'height="{ex["height"]}" alt="{html.escape(cap, quote=True)}" loading="lazy">')
        if ex.get("sheet"):
            img = f'<a href="{root_url}{ex["sheet"]}">{img}</a>'
        verified = is_verified(d, base_dir)
        note = "" if verified else \
            f' <span class="unverified-caption">{html.escape(unverified_label(d, strings))}</span>'
        cls = "document" + ("" if verified else " unverified")
        fig = (f'\n\n<figure class="{cls}">{img}'
               f"<figcaption>{html.escape(cap)}{note}</figcaption></figure>")
        md = md[:end] + fig + md[end:]
    return md


def _note_links(h: str, slug: str, published: list[dict], exports: dict[str, dict],
                strings: dict, root_url: str) -> str:
    def replace(m):
        key = f"{slug}#{m.group('n')}"
        links = []
        for d in published:
            ex = exports.get(d["id"])
            if ex and key in (d.get("notes") or []):
                links.append(f'<a href="{root_url}{ex["crop"]}">{html.escape(strings.get("crop", "crop"))}</a>')
                if ex.get("sheet"):
                    links.append(f'<a href="{root_url}{ex["sheet"]}">'
                                 f'{html.escape(strings.get("full_sheet", "full sheet"))}</a>')
        if not links:
            return m.group(0)
        return f'{m.group(1)}<span class="note-documents">[{" | ".join(links)}]</span> {m.group(3)}'
    return _NOTE.sub(replace, h)


def _uncertain(h: str) -> str:
    return re.sub(r"<p>((?:(?!</p>).)*?(?:nejspíš|\b(?:probably|most likely|likely)\b)(?:(?!</p>).)*)</p>",
                  r'<p class="uncertain">\1</p>', h, flags=re.S | re.I)


def _sections(h: str) -> tuple[str, list[dict]]:
    sections: list[dict] = []
    used: set[str] = set()

    def replace(m):
        if m.group("h") is not None:
            base = _slug(_text(m.group("h"))) or "section"
            sid, i = base, 2
            while sid in used:
                sid, i = f"{base}-{i}", i + 1
            used.add(sid)
            sections.append({"id": sid, "title": _text(m.group("h")), "places": [], "people": []})
            return f'<h2 id="{sid}">{m.group("h")}</h2>'
        if sections:
            target = sections[-1]["places" if m.group("kind") == "places" else "people"]
            for v in _values(html.unescape(m.group("value"))):
                if v not in target:
                    target.append(v)
        return m.group(0)
    return _TOKEN.sub(replace, h), sections


def _person_paragraphs(h: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for m in _PERSON_ANCHOR.finditer(h):
        p = re.sub(r'<sup id="fnref[^"]*">.*?</sup>', "", m.group(2), flags=re.S)
        for person in _values(html.unescape(m.group(1))):
            out[person] = f"{out[person]}\n{p}" if person in out else p   # all paragraphs about the person
    return out


def _source_file(md_file: Path, lang: str, default_language: str) -> tuple[Path, str]:
    """The file to read and the language of its content."""
    if lang != default_language:
        translation = md_file.with_name(f"{chapter_slug(md_file)}.{lang}.md")
        if translation.is_file():
            return translation, lang
    return md_file, default_language


def render(md_file: str | Path, lang: str, sensitive: list[GDate], published: list[dict],
           exports: dict[str, dict], strings: dict, root_url: str = "../",
           default_language: str = "en", images: Iterable[tuple] = (),
           base_dir: str | Path | None = None, ext: dict | None = None) -> Chapter:
    """Render one chapter. `md_file` is the default-language file; for another `lang`
    its `<key>.<lang>.md` translation is used when present. `images` are book
    images `(chapter slug, snippet, source, crop, caption)`; they appear only
    for published documents. `base_dir` is where `crops/colors.json` lives
    (default: the folder above `md_file`). `ext` = `privacy.extensions(...)`."""
    md_file = Path(md_file)
    slug = chapter_slug(md_file)
    base = Path(base_dir) if base_dir is not None else md_file.resolve().parent.parent
    path, content_language = _source_file(md_file, lang, default_language)
    if not path.is_file():
        raise FileNotFoundError(path)
    text = path.read_text(encoding="utf-8")
    text = _TEXT.sub(lambda m: html.escape(m.group(1).strip("\n"), quote=False), text)
    text = redact(text, sensitive, ext)   # redaction also covers the replacement text
    text = _markers(text)
    text = _insert_images(text, slug, lang, published, exports, strings, root_url, images, base)
    text = _REST.sub("", _COMMENT.sub("", text))
    h = markdown.markdown(text, extensions=["tables", "footnotes", "sane_lists"],
                          extension_configs={"footnotes": {"UNIQUE_IDS": True, "BACKLINK_TEXT": ""}})
    h = _note_links(h, slug, published, exports, strings, root_url)
    h = _uncertain(h)
    h, sections = _sections(h)
    paragraphs = _person_paragraphs(h)
    if lang != content_language:
        h = f'<p class="untranslated">{html.escape(strings.get("untranslated", ""))}</p>' + h
    m = re.search(r"<h1[^>]*>(.*?)</h1>", h, re.S)
    title = _text(m.group(1)) if m else slug
    return Chapter(slug, title, h, content_language, sections, paragraphs)


def open_section_indexes(ch: Chapter, headings: Iterable[str]) -> list[int]:
    """Positions of the open-question sections ("What we don't know", "Where to
    look next"; the heading texts come from config `open_questions_headings`
    for the chapter's content language)."""
    wanted = set(headings)
    return [i for i, s in enumerate(ch.sections) if s["title"] in wanted]


def cut_sections(ch: Chapter, idx: list[int]) -> list[tuple[str, str]]:
    """(title, html) of the chosen sections, for another page: footnote links point
    into the chapter, map anchors are dropped. A section ends at the next h2 or at
    the footnotes; sections left empty are skipped."""
    out = []
    for i in idx:
        if i >= len(ch.sections):
            continue
        s = ch.sections[i]
        m = re.search(rf'<h2 id="{re.escape(s["id"])}">.*?</h2>', ch.html, re.S)
        if not m:
            continue
        end = re.compile(r'<h2[ >]|<div class="footnote"').search(ch.html, m.end())
        body = ch.html[m.end():end.start() if end else len(ch.html)]
        body = re.sub(r'<div class="anchor"[^>]*></div>', "", body)
        body = re.sub(r'<sup id="fnref[^"]*">', "<sup>", body)
        body = body.replace('href="#', f'href="{ch.slug}.html#')
        if re.sub(r"<[^>]+>|\s", "", body):
            out.append((s["title"], body.strip()))
    return out
