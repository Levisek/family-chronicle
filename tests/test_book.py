import contextlib
import io
import json
import re
import shutil
import tempfile
import unittest
from datetime import date
from pathlib import Path

from familychronicle import book, config as config_module

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE = ROOT / "example"
TODAY = date(2026, 11, 23)


def example_book() -> dict:
    return json.loads((EXAMPLE / "book.json").read_text(encoding="utf-8"))


class BuildMixin:
    def build(self, spec=None, language=None):
        cfg = config_module.load(EXAMPLE / "site.json")
        spec = dict(spec or example_book())
        if language:
            spec["language"] = language
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        return book.build_html(cfg, spec, Path(self.tmp.name), ROOT / "fonts", today=TODAY)



class BookHtmlTest(BuildMixin, unittest.TestCase):
    def test_chapter_for_each_branch_with_a_chronicle(self):
        h = self.build()
        self.assertIn('class="chapter"', h)
        self.assertEqual(h.count('<section class="chapter"'), 2)
        self.assertIn(">Huber<", h)
        self.assertIn(">Černý<", h)
        self.assertIn("The Hubers of Vienna and Linz", h)
        self.assertIn("The Černýs of Prague and Brno", h)

    def test_no_chapter_for_branch_without_chronicle(self):
        h = self.build()
        self.assertNotIn("Kowalski", h)

    def test_title_page_and_contents(self):
        spec = example_book()
        h = self.build()
        self.assertIn(spec["title"], h)
        self.assertIn(spec["subtitle"], h)
        self.assertIn('href="#c0"', h)
        self.assertIn('href="#c1"', h)

    def test_image_follows_the_given_paragraph(self):
        h = self.build()
        spec = example_book()
        img = spec["images"][0]
        self.assertIn(img["caption"], h)
        i_text = h.index(img["after_text"].split("\n")[0])
        i_fig = h.index("<figure", i_text)
        i_next = h.index("</p>", i_text)
        self.assertGreater(i_fig, i_next)          # after the end of the paragraph
        # and before the next heading of that chapter
        self.assertLess(i_fig, h.index("<h2", i_text))
        self.assertTrue(any(Path(self.tmp.name).glob("*.jpg")))

    def test_footnotes_are_kept_in_chapters(self):
        h = self.build()
        self.assertIn('class="footnote"', h)
        self.assertIn("Parish register of marriages, Vienna, 1875", h)

    def test_hidden_passages_are_removed_by_default(self):
        h = self.build()
        self.assertNotIn("still keeps the clock collection", h)
        self.assertNotIn("born on 12 March 1990", h)
        self.assertIn("The clock collection is still kept by a member of the family.", h)
        self.assertNotIn("web:hide", h)

    def test_include_hidden_keeps_the_raw_text(self):
        h = self.build(dict(example_book(), include_hidden=True))
        visible = re.sub(r"<!--.*?-->", "", h, flags=re.S)   # comments are invisible in the PDF
        self.assertIn("still keeps the clock collection", visible)
        self.assertNotIn("The clock collection is still kept by a member", visible)

    def test_living_dates_redacted_unless_include_hidden(self):
        with tempfile.TemporaryDirectory() as d:
            site = Path(d) / "site"
            shutil.copytree(EXAMPLE, site)
            md = site / "chronicles" / "huber.md"
            md.write_text(md.read_text(encoding="utf-8").replace(
                "## What we don't know", "Daniel Huber, born on 12 March 1990, lives in Linz.\n\n## What we don't know", 1),
                encoding="utf-8")
            cfg = config_module.load(site / "site.json")
            spec = dict(example_book(), images=[])
            with tempfile.TemporaryDirectory() as w:
                safe = book.build_html(cfg, spec, Path(w), ROOT / "fonts", today=TODAY)
                raw = book.build_html(cfg, dict(spec, include_hidden=True), Path(w), ROOT / "fonts", today=TODAY)
            self.assertNotIn("12 March 1990", safe)
            self.assertIn("Daniel Huber", safe)
            self.assertIn("lives in Linz", safe)
            self.assertIn("12 March 1990", raw)

    def test_translation_used_when_language_differs(self):
        spec = dict(example_book(), images=[])    # snippets are English; or give after_text per language
        h = self.build(spec, language="cs")
        self.assertIn('lang="cs"', h)
        self.assertIn("Obsah", h)
        self.assertIn("Prameny", h)

    def test_missing_snippet_is_an_error(self):
        spec = example_book()
        spec["images"] = [dict(spec["images"][0], after_text="no such passage anywhere")]
        with self.assertRaisesRegex(ValueError, "no such passage"):
            self.build(spec)

    def test_image_for_unknown_chronicle_is_an_error(self):
        spec = example_book()
        spec["images"] = [dict(spec["images"][0], chronicle="chronicles/nope.md")]
        with self.assertRaisesRegex(ValueError, "nope"):
            self.build(spec)

    def test_fonts_are_referenced(self):
        self.assertIn("EBGaramond.ttf", self.build())


class SafeImagesTest(BuildMixin, unittest.TestCase):
    """In the default mode only published documents may be typeset."""

    def images(self, **change):
        spec = example_book()
        spec["images"] = [dict(spec["images"][0], **change)]
        return spec

    def test_example_images_are_all_published_documents(self):
        self.assertEqual(self.build().count("<figure"), 3)    # includes a crop of a fully published sheet

    def test_unlisted_image_is_refused_and_named(self):
        spec = self.images(source="documents/not-a-document.png")
        with self.assertRaisesRegex(ValueError, "not-a-document.png"):
            self.build(spec)

    def test_other_crop_of_a_crop_only_document_is_refused(self):
        # death-2015 mentions a living person; only its documented crop is published
        ok = self.images(source="documents/death-2015.png", crop=[40, 20, 960, 280])
        self.build(ok)
        with self.assertRaisesRegex(ValueError, "death-2015.png"):
            self.build(self.images(source="documents/death-2015.png", crop=[0, 0, 1000, 600]))
        with self.assertRaisesRegex(ValueError, "death-2015.png"):
            self.build(self.images(source="documents/death-2015.png", crop=None))

    def test_include_hidden_keeps_the_raw_behaviour(self):
        spec = dict(self.images(source="documents/death-2015.png", crop=None), include_hidden=True)
        self.assertIn("<figure", self.build(spec))

    def test_include_hidden_must_be_a_real_boolean(self):
        for bad in ("false", "true", 0, 1, None):
            with self.assertRaisesRegex(ValueError, "include_hidden"):
                self.build(dict(example_book(), include_hidden=bad))


class BookCheckTest(unittest.TestCase):
    def project(self, sentence):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        site = Path(d.name) / "site"
        shutil.copytree(EXAMPLE, site)
        md = site / "chronicles" / "huber.md"
        md.write_text(md.read_text(encoding="utf-8").replace(
            "## What we don't know", sentence + "\n\n## What we don't know", 1), encoding="utf-8")
        return site

    def test_example_book_passes_the_check(self):
        cfg = config_module.load(EXAMPLE / "site.json")
        with tempfile.TemporaryDirectory() as w:
            page = book.build_html(cfg, example_book(), Path(w), ROOT / "fonts", today=TODAY)
        self.assertEqual(book.check_html(cfg, page, TODAY), [])

    def test_a_year_next_to_a_living_name_stops_the_book(self):
        site = self.project("Daniel Huber (1990) lives in Linz.")
        cfg = config_module.load(site / "site.json")
        with tempfile.TemporaryDirectory() as w:
            page = book.build_html(cfg, dict(example_book(), images=[]), Path(w), ROOT / "fonts", today=TODAY)
        problems = book.check_html(cfg, page, TODAY)
        self.assertTrue(any("1990" in p for p in problems), problems)

    def test_main_exits_1_and_prints_nothing_when_the_check_fails(self):
        site = self.project("Daniel Huber (1990) lives in Linz.")
        spec = dict(example_book(), images=[])
        (site / "book.json").write_text(json.dumps(spec), encoding="utf-8")
        fake = site / "fake-chrome"
        fake.write_text("#!/bin/sh\ntouch \"$0.called\"\n")
        fake.chmod(0o755)
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            code = book.main(["--config", str(site / "book.json"), "--chrome", str(fake),
                              "--today", "2026-11-23", "--out", str(site / "out.pdf")])
        self.assertEqual(code, 1)
        self.assertIn("Book check FAILED", err.getvalue())
        self.assertIn("1990", err.getvalue())
        self.assertFalse((site / "fake-chrome.called").exists())      # the browser never ran


class ChromeCommandTest(unittest.TestCase):
    def test_no_sandbox_only_for_root(self):
        out, page = Path("/tmp/x.pdf"), Path("/tmp/b.html")
        self.assertIn("--no-sandbox", book.chrome_command("c", out, page, geteuid=lambda: 0))
        self.assertNotIn("--no-sandbox", book.chrome_command("c", out, page, geteuid=lambda: 1000))
        self.assertNotIn("--no-sandbox", book.chrome_command("c", out, page, geteuid=None))
        self.assertIn("--no-sandbox", book.chrome_command("c", out, page, geteuid=lambda: 1000, no_sandbox=True))


class ChromeTest(unittest.TestCase):
    def test_more_names_and_macos_bundles(self):
        for name in ("chromium-browser", "google-chrome-stable"):
            self.assertEqual(book.find_chrome(None, env={}, which=lambda n, w=name: "/p/" + n if n == w else None,
                                              home=Path("/nonexistent-home"), apps=()), "/p/" + name)
        with tempfile.TemporaryDirectory() as d:
            app = Path(d) / "Google Chrome.app/Contents/MacOS/Google Chrome"
            app.parent.mkdir(parents=True)
            app.write_text("")
            app.chmod(0o755)
            self.assertEqual(book.find_chrome(None, env={}, which=lambda n: None, home=Path("/nonexistent-home"),
                                              apps=(str(app),)), str(app))

    def test_missing_chrome_message(self):
        with self.assertRaises(book.ChromeNotFound) as cm:
            book.find_chrome(None, env={}, which=lambda n: None, home=Path("/nonexistent-home"))
        msg = str(cm.exception)
        self.assertIn("--chrome", msg)
        self.assertIn("CHROME", msg)

    def test_explicit_wins_then_env_then_path(self):
        with tempfile.TemporaryDirectory() as d:
            exe = Path(d) / "my chrome"
            exe.write_text("#!/bin/sh\n")
            exe.chmod(0o755)
            found = book.find_chrome(str(exe), env={"CHROME": "/x"}, which=lambda n: "/usr/bin/" + n,
                                     home=Path("/nonexistent-home"))
            self.assertEqual(found, str(exe))
            self.assertEqual(book.find_chrome(None, env={"CHROME": str(exe)}, which=lambda n: "/p/" + n,
                                              home=Path("/nonexistent-home")), str(exe))
            self.assertEqual(book.find_chrome(None, env={}, which=lambda n: "/p/" + n if n == "chromium" else None,
                                              home=Path("/nonexistent-home")), "/p/chromium")

    def test_playwright_glob(self):
        with tempfile.TemporaryDirectory() as d:
            exe = Path(d) / ".cache/ms-playwright/chromium_headless_shell-1/chrome-headless-shell-linux64/chrome-headless-shell"
            exe.parent.mkdir(parents=True)
            exe.write_text("")
            exe.chmod(0o755)
            self.assertEqual(book.find_chrome(None, env={}, which=lambda n: None, home=Path(d)), str(exe))

    def test_explicit_missing_file_is_an_error(self):
        with self.assertRaises(book.ChromeNotFound):
            book.find_chrome("/nonexistent/chrome", env={}, which=lambda n: "/p/" + n, home=Path("/x"))


if __name__ == "__main__":
    unittest.main()
