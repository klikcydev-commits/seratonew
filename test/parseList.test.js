'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseList } = require('../core/parseList');

test('splits sections by header styles and strips bullets/numbers', () => {
  const s = parseList(`
Melodies:
1. Ed Sheeran - Perfect
- Adele - Make You Feel My Love

# Slow dance
Kiss Me by Sixpence None The Richer

[Cake cutting]
Sugar | play as knife goes in
`);
  assert.deepStrictEqual(s.map((x) => x.name), ['Melodies', 'Slow dance', 'Cake cutting']);
  assert.strictEqual(s[0].songs.length, 2);
  assert.deepStrictEqual([s[0].songs[0].artist, s[0].songs[0].title], ['Ed Sheeran', 'Perfect']);
  assert.deepStrictEqual([s[1].songs[0].artist, s[1].songs[0].title], ['Sixpence None The Richer', 'Kiss Me']);
  assert.strictEqual(s[2].songs[0].note, 'play as knife goes in');
  assert.strictEqual(s[2].songs[0].title, 'Sugar');
});

test('songs before any header go to Unsorted; repeated headers merge', () => {
  const s = parseList('Song A\nFormality:\nSong B\nformality:\nSong C');
  assert.deepStrictEqual(s.map((x) => [x.name, x.songs.length]), [['Unsorted', 1], ['Formality', 2]]);
});

test('ignores blank input and empty sections', () => {
  assert.deepStrictEqual(parseList(''), []);
  assert.deepStrictEqual(parseList('Empty:\n\nAlso empty:'), []);
});
