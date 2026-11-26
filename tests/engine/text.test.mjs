import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sha256Hex, hash8 } = require('../../engine/sha256.js');
const text = require('../../engine/text.js');
const dates = require('../../engine/dates.js');

test('sha256_known', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('a'.repeat(1000000)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  assert.equal(sha256Hex(new Uint8Array([0x61, 0x62, 0x63])), sha256Hex('abc'));
  assert.equal(hash8('abc'), 'ba7816bf');
});

test('sha256_multibyte_string_is_utf8', () => {
  // "č" is c4 8d in UTF-8
  assert.equal(sha256Hex('č'), sha256Hex(new Uint8Array([0xc4, 0x8d])));
});

test('escape_like_python', () => {
  assert.equal(text.escapeHtml(`a&b<c>"d'e`), 'a&amp;b&lt;c&gt;&quot;d&#x27;e');
});

test('json_in_html', () => {
  assert.equal(text.jsonInHtml({ a: '</script><!--<b>', b: [1, 2], c: 'ž' }),
    '{"a":"\\u003c/script>\\u003c!--<b>","b":[1,2],"c":"ž"}');
});

test('utf8_round_trip', () => {
  assert.equal(text.fromUtf8(text.utf8('Žluťoučký kůň')), 'Žluťoučký kůň');
});

test('strip_accents', () => {
  assert.equal(text.stripAccents('Černý Šíma'), 'Cerny Sima');
});

test('month_names', () => {
  assert.deepEqual(dates.monthNames(1), ['ledna', 'leden', 'lednu', 'lednem', 'January', 'Jan', 'JAN']);
  assert.ok(dates.monthNames(9).includes('Sept'));
  assert.equal(dates.monthNames(9).filter((x) => x === 'září').length, 1);
});
