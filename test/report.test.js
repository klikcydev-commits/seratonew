'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { toCsv, toM3u8, toHtml, writeReports, collectFiles } = require('../core/report');
const { isInside, assertTracksInLibrary } = require('../core/safety');
const { scanLibrary } = require('../core/scanLibrary');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'setbuilder-'));

const sections = [
  {
    name: 'Slow dance',
    items: [
      { requested: 'Perfect, Ed "Sheeran"', note: 'lights <down>', status: 'matched',
        chosen: { path: '/m/perfect.mp3', artist: 'Ed Sheeran', title: 'Perfect', score: 1 } },
      { requested: 'Ghost song', note: '', status: 'missing', chosen: null },
    ],
  },
];

test('CSV quotes commas/quotes and marks unselected rows missing', () => {
  const csv = toCsv('Event', sections);
  assert.match(csv, /"Perfect, Ed ""Sheeran"""/);
  assert.match(csv, /Ghost song,,missing/);
});

test('HTML escapes user text and lists missing tracks', () => {
  const html = toHtml('<b>Event</b>', sections);
  assert.ok(!html.includes('<b>Event</b>'));
  assert.match(html, /lights &lt;down&gt;/);
  assert.match(html, /Not found \(1\)/);
});

test('M3U8 skips unselected items', () => {
  const m = toM3u8(sections[0].items);
  assert.strictEqual(m, '#EXTM3U\n#EXTINF:-1,Ed Sheeran - Perfect\n/m/perfect.mp3\n');
});

test('writeReports + collectFiles produce the expected files', async () => {
  const out = tmp();
  const src = path.join(tmp(), 'perfect.mp3');
  fs.writeFileSync(src, 'x');
  const secs = [{ name: 'Slow dance', items: [{ requested: 'p', note: '', status: 'matched',
    chosen: { path: src, artist: 'A', title: 'P', score: 1 } }] }];
  const r = writeReports(out, 'My Event', secs);
  assert.ok(fs.existsSync(r.csv) && fs.existsSync(r.html));
  assert.strictEqual(r.playlists.length, 1);
  const c = await collectFiles(out, 'My Event', secs);
  assert.strictEqual(c.copied, 1);
  assert.ok(fs.existsSync(path.join(c.root, '01 Slow dance', '01 - perfect.mp3')));
});

test('safety: only files inside scanned folders are accepted', () => {
  const lib = tmp();
  const file = path.join(lib, 'a.mp3');
  fs.writeFileSync(file, 'x');
  assert.ok(isInside(lib, file));
  assert.ok(!isInside(lib, path.join(lib, '..', 'evil.mp3')));
  assert.doesNotThrow(() => assertTracksInLibrary([file], [lib]));
  assert.throws(() => assertTracksInLibrary(['/etc/passwd'], [lib]), /outside/);
  assert.throws(() => assertTracksInLibrary([path.join(lib, 'gone.mp3')], [lib]), /no longer exists/);
});

test('scanLibrary walks audio files, skips hidden/_Serato_, caches results', async () => {
  const lib = tmp();
  fs.mkdirSync(path.join(lib, 'sub'));
  fs.mkdirSync(path.join(lib, '_Serato_'));
  fs.mkdirSync(path.join(lib, '.hidden'));
  for (const f of ['a.mp3', 'sub/Artist - Song.flac', 'notes.txt', '_Serato_/x.mp3', '.hidden/y.mp3']) {
    fs.writeFileSync(path.join(lib, f), 'not real audio');
  }
  const cachePath = path.join(tmp(), 'cache.json');
  const first = await scanLibrary([lib], { cachePath });
  assert.deepStrictEqual(first.map((e) => path.basename(e.path)).sort(), ['Artist - Song.flac', 'a.mp3']);
  assert.ok(fs.existsSync(cachePath));
  const second = await scanLibrary([lib], { cachePath });
  assert.strictEqual(second.length, 2);
});
