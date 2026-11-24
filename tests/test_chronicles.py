import re
import tempfile
import unittest
from pathlib import Path

from familychronicle import chronicles, config as config_module
from familychronicle.chronicles import chapter_slug, render
from familychronicle.gedcom import GDate

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE = ROOT / "example"
STRINGS = {"crop": "crop", "full_sheet": "full sheet", "untranslated": "English only.",
           "unverified": "unverified", "unverified_source": "unverified source"}
MD = """# Title

## Vienna

<!-- place: Vienna; Linz -->
Intro[^1] probably so.

  <!--  person: I14  -->
Person card[^2].

<!-- place: -->
<!-- just an author note -->
<!-- web:hide -->Secret<!-- /web:hide -->

## Vienna

Second.

[^1]: Note one.
[^2]: Note two.
"""
IMAGES = [("sample", "First paragraph.", "documents/a.png", None, "Fallback caption")]
EX = {"d1": {"crop": "documents/d1-abcd.webp", "sheet": "documents/d1-sheet-ef.webp",
             "width": 100, "height": 50}}
DOC = {"id": "d1", "source": "documents/a.png", "crop": None, "people": [],
       "year": 1930, "description": {"en": "Caption en", "cs": "Popis cs"}, "verified": True,
       "notes": ["sample#1"]}


class ChronicleTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())

    def write(self, text=MD, name="sample.md"):
        p = self.dir / name
        p.write_text(text, encoding="utf-8")
        return p

    def render(self, text=MD, lang="en", sensitive=(), published=(), exports=None, **kw):
        return render(self.write(text), lang, list(sensitive), list(published), exports or {},
                      STRINGS, base_dir=self.dir, **kw)

    def test_anchors(self):
        ch = self.render()
        self.assertIn('data-places="Vienna;Linz"', ch.html)
        self.assertIn('data-people="I14"', ch.html)
        self.assertEqual(ch.sections[0]["places"], ["Vienna", "Linz"])
        self.assertEqual(ch.sections[0]["people"], ["I14"])
        self.assertEqual([s["id"] for s in ch.sections], ["vienna", "vienna-2"])
        self.assertIn('<h2 id="vienna">', ch.html)

    def test_person_marker_with_at_signs(self):
        ch = self.render("# T\n\n## A\n\n<!-- person: @I12@; @I3@ -->\nText.\n")
        self.assertEqual(ch.sections[0]["people"], ["I12", "I3"])
        self.assertIn('data-people="I12;I3"', ch.html)
        self.assertIn("Text.", ch.person_paragraphs["I12"])

    def test_comments_and_hidden_blocks(self):
        ch = self.render()
        self.assertNotIn("<!--", ch.html)
        self.assertNotIn("Secret", ch.html)

    def test_web_text_replaces_hidden(self):
        md = ("# N\n\n## A\n\nText[^1] and (from <!-- web:hide -->1949<!-- /web:hide -->"
              "<!-- web:text: 1945 -->).\n\n"
              "[^1]: <!-- web:hide -->Secret scan.jpg<!-- /web:hide -->"
              "<!-- web:text: Document of a living person, not published. -->\n")
        ch = self.render(md)
        self.assertIn("Document of a living person, not published.", ch.html)
        self.assertIn("(from 1945)", ch.html)
        self.assertNotIn("Secret", ch.html)
        self.assertNotIn("1949", ch.html)
        self.assertNotIn("<!--", ch.html)

    def test_web_text_is_escaped_and_keeps_one_space(self):
        ch = self.render("# N\n\n## A\n\nsee<!-- web:text:  <b onclick=x>a</b> & b -->.\n")
        self.assertNotIn("<b onclick", ch.html)
        self.assertIn("see &lt;b onclick=x&gt;a&lt;/b&gt; &amp; b.", ch.html)

    def test_uncertain_paragraphs(self):
        for t in ["He was probably born", "Most likely a cousin", "It is likely so"]:
            self.assertIn('<p class="uncertain">', self.render(f"# N\n\n{t}.\n").html, t)
        self.assertNotIn("uncertain", self.render("# N\n\nUnlikelyhood and likelyhood.\n").html)

    def test_uncertain_and_person_paragraph(self):
        ch = self.render()
        self.assertIn('<p class="uncertain">Intro', ch.html)
        self.assertIn("Person card", ch.person_paragraphs["I14"])
        self.assertNotIn("footnote-ref", ch.person_paragraphs["I14"])

    def test_redaction(self):
        ch = self.render("# N\n\nBorn 5 Jan 1995 in Linz.\n",
                         sensitive=[GDate(1995, 1, 5, False, "5 JAN 1995")])
        self.assertNotIn("1995", ch.html)

    def test_withheld_image_is_missing(self):
        ch = self.render("# N\n\nFirst paragraph.\n", images=IMAGES)
        self.assertNotIn("<figure", ch.html)

    def test_published_image_and_note_links(self):
        ch = self.render("# N\n\nFirst paragraph.[^1]\n\nSecond.\n\n[^1]: Note.\n",
                         published=[DOC], exports=EX, images=IMAGES)
        self.assertEqual(ch.html.count("<figure"), 1)
        self.assertIn('src="../documents/d1-abcd.webp"', ch.html)
        self.assertIn("<figcaption>Caption en", ch.html)
        self.assertNotIn("unverified", ch.html)
        self.assertIn('href="../documents/d1-abcd.webp">crop</a>', ch.html)
        self.assertIn("full sheet", ch.html)
        self.assertRegex(ch.html, r"</p>\s*<figure")

    def test_image_caption_language(self):
        (self.dir / "sample.cs.md").write_text("# T\n\nFirst paragraph.\n", encoding="utf-8")
        ch = self.render("# T\n\nFirst paragraph.\n", lang="cs", published=[DOC],
                         exports=EX, images=IMAGES)
        self.assertIn("Popis cs", ch.html)

    def test_image_via_comment_in_translation(self):
        (self.dir / "sample.cs.md").write_text(
            "# Titulek\n\nFirst paragraph.<!-- img: First paragraph. -->\n\nSecond.\n", encoding="utf-8")
        ch = self.render("# T\n\nFirst paragraph.\n", lang="cs", published=[DOC],
                         exports=EX, images=[("sample", "Ahoj", "documents/a.png", None, "x")])
        self.assertEqual(ch.html.count("<figure"), 0)   # snippet "Ahoj" is absent
        ch = self.render("# T\n\nFirst paragraph.\n", lang="cs", published=[DOC],
                         exports=EX, images=[("sample", "First paragraph.", "documents/a.png", None, "x")])
        self.assertRegex(ch.html, r"First paragraph\.</p>\s*<figure")

    def test_unverified_and_foreign_work(self):
        ch = self.render("# N\n\nFirst paragraph.\n", published=[dict(DOC, verified=False)],
                         exports=EX, images=IMAGES)
        self.assertIn('class="document unverified"', ch.html)
        self.assertIn("unverified<", ch.html)
        ch = self.render("# N\n\nFirst paragraph.\n",
                         published=[dict(DOC, verified=False, foreign_work=True)],
                         exports=EX, images=IMAGES)
        self.assertIn("unverified source", ch.html)
        self.assertNotIn("unverified<", ch.html)

    def test_translation_missing_falls_back(self):
        ch = self.render("# Title\n\nText.\n", lang="cs")
        self.assertEqual(ch.content_language, "en")
        self.assertIn("English only.", ch.html)

    def test_translation_used(self):
        (self.dir / "sample.cs.md").write_text("# Přehled\n\nText.\n", encoding="utf-8")
        ch = self.render("# Overview\n\nText.\n", lang="cs")
        self.assertEqual(ch.content_language, "cs")
        self.assertEqual(ch.title, "Přehled")
        self.assertNotIn("English only.", ch.html)

    def test_default_language_never_looks_for_translation(self):
        (self.dir / "sample.en.md").write_text("# Wrong\n", encoding="utf-8")
        self.assertEqual(self.render("# Right\n").title, "Right")

    def test_chapter_slug(self):
        self.assertEqual(chapter_slug("chronicles/huber.md"), "huber")
        self.assertEqual(chapter_slug(Path("/x y/chronicles/huber.cs.md")), "huber")
        self.assertEqual(chapter_slug("My Branch.md"), "my-branch")
        self.assertEqual(chapter_slug(".md"), "chapter")

    def test_missing_file(self):
        with self.assertRaises(FileNotFoundError):
            render(self.dir / "nope.md", "en", [], [], {}, STRINGS)

    def test_open_sections_cut(self):
        text = ("# K\n\n## Intro\n\nText.\n\n## What we don't know\n\n<!-- person: I1 -->\n"
                "- Who was the father.[^1]\n\n## Where to look next\n\n"
                "<!-- web:hide -->Internal.<!-- /web:hide -->\n\n[^1]: Note.\n")
        ch = self.render(text)
        heads = ["What we don't know", "Where to look next"]
        ix = chronicles.open_section_indexes(ch, heads)
        self.assertEqual(ix, [1, 2])
        picked = chronicles.cut_sections(ch, ix)
        self.assertEqual([n for n, _ in picked], ["What we don't know"])   # empty section drops out
        h = picked[0][1]
        self.assertIn("Who was the father.", h)
        self.assertNotIn("anchor", h)
        self.assertNotIn("Note.", h)
        self.assertNotIn('id="fnref', h)
        self.assertIn(f'href="{ch.slug}.html#fn', h)

    def test_cut_sections_ignores_out_of_range(self):
        ch = self.render()
        self.assertEqual(chronicles.cut_sections(ch, [99]), [])

    # --- the shipped example chronicles ---------------------------------------

    def example_config(self):
        return config_module.load(EXAMPLE / "site.json")

    def test_example_chronicles_render(self):
        cfg = self.example_config()
        headings = cfg["open_questions_headings"]
        for branch in cfg["branches"]:
            if "chronicle" not in branch:
                continue
            path = EXAMPLE / branch["chronicle"]
            self.assertEqual(chapter_slug(path), branch["key"])
            for lang in cfg["languages"]:
                with self.subTest(branch=branch["key"], lang=lang):
                    ch = render(path, lang, [], [], {}, STRINGS,
                                default_language=cfg["default_language"], base_dir=EXAMPLE)
                    self.assertNotIn("<!--", ch.html)
                    self.assertTrue(ch.html)
                    ix = chronicles.open_section_indexes(ch, headings[ch.content_language])
                    self.assertEqual(len(ix), 2)

    def test_example_hidden_block_and_replacement(self):
        path = EXAMPLE / "chronicles" / "huber.md"
        raw = path.read_text(encoding="utf-8")
        self.assertIn("<!-- web:hide -->", raw)
        self.assertIn("<!-- web:text:", raw)
        ch = render(path, "en", [], [], {}, STRINGS, base_dir=EXAMPLE)
        self.assertNotIn("Daniel", ch.html)   # living person only in the hidden block

    def test_example_anchors_use_example_data(self):
        import json
        from familychronicle import gedcom
        tree = gedcom.load(EXAMPLE / "family.ged")
        places = json.loads((EXAMPLE / "places.json").read_text(encoding="utf-8"))
        for md in sorted((EXAMPLE / "chronicles").glob("*.md")):
            text = md.read_text(encoding="utf-8")
            with self.subTest(md=md.name):
                for m in re.finditer(r"<!--\s*person\s*:(.*?)-->", text, re.S):
                    for v in m.group(1).split(";"):
                        self.assertIn(v.strip().strip("@"), tree.people)
                for m in re.finditer(r"<!--\s*place\s*:(.*?)-->", text, re.S):
                    for v in m.group(1).split(";"):
                        self.assertIn(v.strip(), places)

    def test_translations_keep_markers(self):
        """A translation must have the same anchors and footnotes as the original."""
        def markers(t):
            return {
                "anchors": sorted(re.sub(r"\s+", "", a) for a in
                                  re.findall(r"<!--\s*(?:place|person)\s*:.*?-->", t, re.S)),
                "notes": sorted(set(re.findall(r"\[\^([^\]]+)\]", t))),
                "hide_open": t.count("<!-- web:hide -->"),
                "hide_close": t.count("<!-- /web:hide -->"),
            }
        for tr in sorted((EXAMPLE / "chronicles").glob("*.cs.md")):
            orig = tr.with_name(tr.name.replace(".cs.md", ".md"))
            with self.subTest(translation=tr.name):
                a = markers(orig.read_text(encoding="utf-8"))
                b = markers(tr.read_text(encoding="utf-8"))
                self.assertEqual(a["anchors"], b["anchors"])
                self.assertEqual(a["notes"], b["notes"])
                self.assertEqual(b["hide_open"], b["hide_close"])


if __name__ == "__main__":
    unittest.main()
