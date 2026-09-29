'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildIndex, matchSong, tokenize } = require('../core/matcher');

const lib = buildIndex([
  { path: '/m/Ed Sheeran - Perfect.mp3', artist: 'Ed Sheeran', title: 'Perfect' },
  { path: '/m/Beyonce - Perfect Duet.mp3', artist: 'Beyoncé', title: 'Perfect Duet' },
  { path: '/m/01 - Adele - Make You Feel My Love.mp3' },
  { path: '/m/Bruno Mars - 24K Magic (Extended).mp3', artist: 'Bruno Mars', title: '24K Magic (Extended)' },
  { path: '/m/Fairuz - Kifak Inta.mp3', artist: 'فيروز', title: 'كيفك إنت' },
  { path: '/m/Ed Sheeran - Perfect (flac).flac', artist: 'Ed Sheeran', title: 'Perfect' },
  { path: '/m/Coldplay - Yellow.mp3', artist: 'Coldplay', title: 'Yellow' },
]);

const song = (artist, title) => ({ raw: `${artist} ${title}`, artist, title });

test('exact artist + title matches confidently', () => {
  const r = matchSong(lib, song('Ed Sheeran', 'Perfect'));
  assert.strictEqual(r.status, 'matched');
  assert.match(r.candidates[0].path, /Ed Sheeran - Perfect/);
});

test('accents, feat and typos are tolerated', () => {
  assert.strictEqual(matchSong(lib, song('Beyonce', 'Perfect Duet (feat. Ed Sheeran)')).status, 'matched');
  assert.strictEqual(matchSong(lib, song('Coldplay', 'Yelow')).candidates[0].title, 'Yellow');
});

test('tags-less files are matched from the filename (track number stripped)', () => {
  const r = matchSong(lib, song('Adele', 'Make You Feel My Love'));
  assert.strictEqual(r.status, 'matched');
  assert.match(r.candidates[0].path, /Adele/);
});

test('title only that fits two songs is flagged for review, not auto-matched', () => {
  const r = matchSong(lib, { raw: 'Perfect', artist: '', title: 'Perfect' });
  assert.notStrictEqual(r.status, 'missing');
  assert.strictEqual(r.status, 'review');
});

test('duplicate copies of the same song collapse into one candidate', () => {
  const r = matchSong(lib, song('Ed Sheeran', 'Perfect'));
  const perfect = r.candidates.filter((c) => c.title === 'Perfect');
  assert.strictEqual(perfect.length, 1);
  assert.strictEqual(perfect[0].duplicates, 1);
});

test('Arabic script matches across hamza/alef variants', () => {
  const r = matchSong(lib, { raw: 'فيروز كيفك انت', artist: 'فيروز', title: 'كيفك انت' });
  assert.strictEqual(r.status, 'matched');
});

test('unknown songs are missing with nothing pre-selected', () => {
  const r = matchSong(lib, song('Nobody', 'Not A Real Song'));
  assert.strictEqual(r.status, 'missing');
  assert.strictEqual(r.chosen, -1);
});

test('tokenize drops parentheticals and stopwords', () => {
  assert.deepStrictEqual(tokenize('The Weeknd - Blinding Lights (Official Audio)'), ['weeknd', 'blinding', 'lights']);
});
