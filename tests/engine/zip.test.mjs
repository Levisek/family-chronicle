import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const Z = require('../../engine/zip.js');
const { utf8 } = require('../../engine/text.js');

test('crc32_known', () => {
  assert.equal(Z.crc32(utf8('123456789')), 0xCBF43926);
  assert.equal(Z.crc32(new Uint8Array(0)), 0);
});

test('zip_readable', () => {
  const files = new Map([
    ['family/index.html', utf8('<p>hi</p>')],
    ['chronicles/Černý.md', utf8('# Černý\n')],
    ['empty.txt', new Uint8Array(0)],
    ['bin.dat', Uint8Array.from({ length: 300 }, (_, i) => i % 256)],
  ]);
  const zip = Z.create(files, new Date(2026, 10, 26, 14, 30, 10));
  const dir = mkdtempSync(join(tmpdir(), 'fc-zip-'));
  const path = join(dir, 'a.zip');
  writeFileSync(path, zip);
  execFileSync('unzip', ['-tq', path]);
  const names = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(names, [...files.keys()]);
  assert.equal(execFileSync('unzip', ['-p', path, 'chronicles/Černý.md'], { encoding: 'utf8' }), '# Černý\n');
  assert.match(execFileSync('unzip', ['-l', path], { encoding: 'utf8' }), /(2026-11-26|11-26-2026) 14:30/);
});
