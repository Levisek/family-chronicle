import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';

const M = createRequire(import.meta.url)('../../engine/markdown.js');
const DIR = new URL('../golden/markdown/', import.meta.url);

for (const name of readdirSync(DIR).filter((f) => f.endsWith('.md')).sort()) {
  test(`golden_${name}`, () => {
    const md = readFileSync(new URL(name, DIR), 'utf8');
    const html = readFileSync(new URL(name.replace(/\.md$/, '.html'), DIR), 'utf8');
    assert.equal(M.render(md).trimEnd(), html.trimEnd());
  });
}

test('footnote_backref', () => {
  const h = M.render('A[^1] and again[^1].\n\n[^1]: The note.\n');
  assert.ok(h.includes('<sup id="fnref:2-1"><a class="footnote-ref" href="#fn:2-1">1</a></sup>'));
  assert.ok(h.includes('<sup id="fnref2:2-1"><a class="footnote-ref" href="#fn:2-1">1</a></sup>'));
  assert.equal((h.match(/<li id="fn:2-1">/g) || []).length, 1);
  assert.ok(h.includes('<p>The note.&#160;<a class="footnote-backref" href="#fnref:2-1" title="Jump back to footnote 1 in the text"></a>'
    + '<a class="footnote-backref" href="#fnref2:2-1" title="Jump back to footnote 1 in the text"></a></p>'));
});

// The plan allows no raw HTML except comments and the blocks the build itself inserts (div, figure).
test('unknown_html_is_escaped', () => {
  assert.equal(M.render('a <b> & <script>x</script>'), '<p>a &lt;b&gt; &amp; &lt;script&gt;x&lt;/script&gt;</p>');
  assert.equal(M.render('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(M.render('<div class="anchor" data-people="I1"></div>'), '<div class="anchor" data-people="I1"></div>');
});
