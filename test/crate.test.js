'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildCrate, parseCrate, VERSION } = require('../core/crate');
const { writeCrates, safeName, volumeInfo, cratePath } = require('../core/serato');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'setbuilder-'));

test('crate binary round-trips, including non-ASCII paths', () => {
  const paths = ['Users/me/Music/Ed Sheeran - Perfect.mp3', 'Users/me/Music/فيروز - كيفك.mp3', 'Music/😀.mp3'];
  const buf = buildCrate(paths);
  const parsed = parseCrate(buf);
  assert.strictEqual(parsed.version, VERSION);
  assert.deepStrictEqual(parsed.tracks, paths);
});

test('crate starts with a vrsn tag and big-endian length', () => {
  const buf = buildCrate(['a.mp3']);
  assert.strictEqual(buf.toString('ascii', 0, 4), 'vrsn');
  assert.strictEqual(buf.readUInt32BE(4), VERSION.length * 2);
  assert.strictEqual(buf.readUInt16BE(8), VERSION.charCodeAt(0)); // UTF-16BE
});

test('parseCrate rejects truncated files', () => {
  const buf = buildCrate(['a.mp3']);
  assert.throws(() => parseCrate(buf.subarray(0, buf.length - 3)), /Corrupt/);
});

test('safeName strips separators and the %% nesting token', () => {
  assert.strictEqual(safeName('Jalal & Lara: 12/10 %% x'), 'Jalal & Lara 12 10 x');
  assert.strictEqual(safeName('  '), 'Untitled');
});

test('path helpers (posix + win32)', () => {
  assert.strictEqual(cratePath('/Users/me/Music/a.mp3', '/', 'darwin'), 'Users/me/Music/a.mp3');
  assert.strictEqual(cratePath('/Volumes/DJ/Music/a.mp3', '/Volumes/DJ', 'darwin'), 'Music/a.mp3');
  assert.strictEqual(cratePath('C:\\Users\\me\\a.mp3', 'C:\\', 'win32'), 'Users\\me\\a.mp3');
  assert.deepStrictEqual(volumeInfo('/Volumes/DJ/Music/a.mp3', '/Users/me/Music/_Serato_', 'darwin'),
    { root: '/Volumes/DJ', seratoDir: '/Volumes/DJ/_Serato_', external: true });
  assert.strictEqual(volumeInfo('/Users/me/a.mp3', '/Users/me/Music/_Serato_', 'darwin').external, false);
  assert.strictEqual(volumeInfo('D:\\Music\\a.mp3', 'C:\\Users\\me\\Music\\_Serato_', 'win32').seratoDir, 'D:\\_Serato_');
});

test('writeCrates creates nested crates named Parent%%Child and backs up on rewrite', () => {
  const dir = tmp();
  const serato = path.join(dir, '_Serato_');
  fs.mkdirSync(serato);
  const args = {
    eventName: 'Jalal & Lara',
    defaultDir: serato,
    platform: 'linux',
    crates: [
      { name: 'Slow dance', tracks: ['/music/kiss-me.mp3', '/music/kiss-me.mp3'] },
      { name: 'Cake cutting', tracks: ['/music/sugar.mp3'] },
    ],
  };
  const res = writeCrates(args);
  const files = fs.readdirSync(path.join(serato, 'Subcrates')).sort();
  assert.deepStrictEqual(files, [
    'Jalal & Lara%%Cake cutting.crate',
    'Jalal & Lara%%Slow dance.crate',
    'Jalal & Lara.crate',
  ]);
  const slow = parseCrate(fs.readFileSync(path.join(serato, 'Subcrates', 'Jalal & Lara%%Slow dance.crate')));
  assert.deepStrictEqual(slow.tracks, ['music/kiss-me.mp3']); // de-duplicated, root-relative
  assert.strictEqual(res.warnings.length, 0);

  writeCrates(args);
  assert.ok(fs.existsSync(path.join(serato, 'Subcrates', 'Jalal & Lara%%Slow dance.crate.bak')));
});

test('writeCrates warns instead of creating a stray _Serato_ folder', () => {
  const dir = tmp();
  const res = writeCrates({
    eventName: 'X', defaultDir: path.join(dir, 'missing', '_Serato_'), platform: 'linux',
    crates: [{ name: 'A', tracks: ['/music/a.mp3'] }],
  });
  assert.strictEqual(res.written.length, 0);
  assert.match(res.warnings[0], /No _Serato_ folder/);
  assert.ok(!fs.existsSync(path.join(dir, 'missing')));
});
