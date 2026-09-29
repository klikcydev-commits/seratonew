'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  extractUrls, classify, safeFetch, parseSpotify, parseYouTubePlaylist, parseApple, expandLinks,
} = require('../core/links');
const { videoToSong, primaryArtist, cleanTitle } = require('../core/songText');
const { parseList } = require('../core/parseList');

/* ---- fixtures shaped like the public pages ---- */
const spotifyHtml = (entity) =>
  `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })}</script></html>`;

const SPOTIFY_PLAYLIST = spotifyHtml({
  name: 'Wedding Slow Dances',
  trackList: [
    { title: 'Perfect', subtitle: 'Ed Sheeran' },
    { title: 'Make You Feel My Love - Remastered 2011', subtitle: 'Adele, Someone Else' },
    { title: 'Kiss Me', subtitle: 'Sixpence None The Richer' },
  ],
});
const SPOTIFY_TRACK = spotifyHtml({ type: 'track', name: 'Sugar', artists: [{ name: 'Maroon 5' }] });

const ytData = {
  metadata: { playlistMetadataRenderer: { title: 'Party Mix' } },
  contents: [
    { playlistVideoRenderer: { title: { runs: [{ text: 'Ed Sheeran - Perfect (Official Music Video)' }] }, shortBylineText: { runs: [{ text: 'Ed Sheeran' }] } } },
    { playlistVideoRenderer: { title: { runs: [{ text: 'Sugar' }] }, shortBylineText: { runs: [{ text: 'Maroon 5 - Topic' }] } } },
    { playlistVideoRenderer: { title: { simpleText: '[Private video]' } } },
    { playlistVideoRenderer: { title: { runs: [{ text: 'Random Fan Cover of Something' }] }, shortBylineText: { runs: [{ text: 'xX_uploader_Xx' }] } } },
  ],
};
const YT_HTML = `<html><script>var ytInitialData = ${JSON.stringify(ytData)};</script></html>`;

const APPLE_LD = {
  '@type': 'MusicPlaylist', name: 'Cake Songs',
  track: [
    { '@type': 'MusicRecording', name: 'Sugar', url: 'https://music.apple.com/us/album/sugar/1?i=111', byArtist: [{ name: 'Maroon 5' }] },
    { '@type': 'MusicRecording', name: 'Perfect', url: 'https://music.apple.com/us/album/perfect/2?i=222', byArtist: [{ name: 'Ed Sheeran' }] },
  ],
};
const APPLE_HTML = `<html><script type="application/ld+json" id="schema-org-playlist">${JSON.stringify(APPLE_LD)}</script></html>`;
const APPLE_SERVER_ONLY = `<html><script type="application/json" id="serialized-server-data">${JSON.stringify({
  data: [{ sections: [{ items: [
    { title: 'Kiss Me', artistName: 'Sixpence None The Richer', contentDescriptor: { kind: 'song', identifiers: { storeAdamID: '333' } } },
    { title: 'Not a song', contentDescriptor: { kind: 'playlist' } },
  ] }] }],
})}</script></html>`;

/* ---- classification ---- */
test('classify recognises services, ids and unsupported hosts', () => {
  assert.deepStrictEqual(
    [classify('https://open.spotify.com/intl-fr/playlist/37i9dQZF1DXcBWIGoYBM5M?si=x').kind, classify('spotify:track:4uLU6hMCjMI75M1A2tKUQC').kind],
    ['playlist', 'track']);
  assert.strictEqual(classify('https://youtu.be/dQw4w9WgXcQ?t=5').id, 'dQw4w9WgXcQ');
  assert.strictEqual(classify('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123').kind, 'playlist');
  assert.strictEqual(classify('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ').kind, 'video');
  assert.strictEqual(classify('https://music.youtube.com/playlist?list=PLabc123').list, 'PLabc123');
  const song = classify('https://music.apple.com/us/album/perfect/2?i=222');
  assert.deepStrictEqual([song.kind, song.trackId], ['song', '222']);
  assert.strictEqual(classify('https://tidal.com/browse/playlist/x').service, 'unsupported');
  assert.strictEqual(classify('https://open.spotify.com/artist/abc').service, 'unsupported');
});

test('extractUrls trims trailing punctuation', () => {
  assert.deepStrictEqual(extractUrls('see https://youtu.be/dQw4w9WgXcQ, thanks!'), ['https://youtu.be/dQw4w9WgXcQ']);
});

/* ---- parsers ---- */
test('parseSpotify reads playlists (primary artist, cleaned titles) and single tracks', () => {
  const p = parseSpotify(SPOTIFY_PLAYLIST);
  assert.strictEqual(p.title, 'Wedding Slow Dances');
  assert.deepStrictEqual(p.tracks, [
    { artist: 'Ed Sheeran', title: 'Perfect' },
    { artist: 'Adele', title: 'Make You Feel My Love' },
    { artist: 'Sixpence None The Richer', title: 'Kiss Me' },
  ]);
  assert.deepStrictEqual(parseSpotify(SPOTIFY_TRACK).tracks, [{ artist: 'Maroon 5', title: 'Sugar' }]);
  assert.throws(() => parseSpotify('<html>nope</html>'), /unrecognised/);
});

test('parseYouTubePlaylist cleans titles, uses Topic channels, skips private videos', () => {
  const p = parseYouTubePlaylist(YT_HTML);
  assert.strictEqual(p.title, 'Party Mix');
  assert.strictEqual(p.unavailable, 1);
  assert.deepStrictEqual(p.tracks, [
    { artist: 'Ed Sheeran', title: 'Perfect' },
    { artist: 'Maroon 5', title: 'Sugar' },
    { artist: '', title: 'Random Fan Cover of Something' }, // uploader name is not treated as the artist
  ]);
});

test('parseApple reads JSON-LD, falls back to serialized data, and picks a single song by ?i=', () => {
  const p = parseApple(APPLE_HTML);
  assert.strictEqual(p.title, 'Cake Songs');
  assert.deepStrictEqual(p.tracks, [{ artist: 'Maroon 5', title: 'Sugar' }, { artist: 'Ed Sheeran', title: 'Perfect' }]);
  assert.deepStrictEqual(parseApple(APPLE_HTML, { trackId: '222' }).tracks, [{ artist: 'Ed Sheeran', title: 'Perfect' }]);
  assert.deepStrictEqual(parseApple(APPLE_SERVER_ONLY).tracks, [{ artist: 'Sixpence None The Richer', title: 'Kiss Me' }]);
  assert.throws(() => parseApple('<html></html>'), /no tracks/);
});

test('song text helpers', () => {
  assert.deepStrictEqual(videoToSong({ title: 'Adele - Hello (Official Video) | HD', channel: 'AdeleVEVO' }), { artist: 'Adele', title: 'Hello' });
  assert.deepStrictEqual(videoToSong({ title: 'Hello', channel: 'AdeleVEVO' }), { artist: 'Adele', title: 'Hello' });
  assert.strictEqual(primaryArtist('A; B, C'), 'A');
  assert.strictEqual(cleanTitle('Song - Radio Edit'), 'Song');
});

/* ---- network safety ---- */
const fakeRes = (status, body = '', headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[k.toLowerCase()] || null },
  text: async () => body,
});

test('safeFetch follows allow-listed redirects but blocks other hosts', async () => {
  const calls = [];
  const good = async (url) => {
    calls.push(url);
    return url.includes('spotify.link') ? fakeRes(302, '', { location: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M' }) : fakeRes(200, 'ok');
  };
  const r = await safeFetch('https://spotify.link/abc', { fetchImpl: good });
  assert.strictEqual(r.text, 'ok');
  assert.strictEqual(calls.length, 2);

  const evil = async () => fakeRes(302, '', { location: 'http://169.254.169.254/latest/meta-data' });
  await assert.rejects(safeFetch('https://spotify.link/abc', { fetchImpl: evil }), /Blocked redirect/);
  await assert.rejects(safeFetch('https://example.com/x', { fetchImpl: good }), /Blocked redirect/);
  await assert.rejects(safeFetch('https://open.spotify.com/x', { fetchImpl: async () => fakeRes(404) }), /HTTP 404/);
});

/* ---- expandLinks ---- */
test('expandLinks: inline under headers, own headers, "Name - link", failures and unsupported hosts', async () => {
  const pages = {
    'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M': SPOTIFY_PLAYLIST,
    'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC': SPOTIFY_TRACK,
    'https://www.youtube.com/playlist?list=PLabc123': YT_HTML,
  };
  const fetchImpl = async (url) => (pages[url] ? fakeRes(200, pages[url]) : fakeRes(404));

  const input = [
    'Slow dance:',
    'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc',
    'Cake cutting 🎂 - https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
    '',
    'https://www.youtube.com/playlist?list=PLabc123',
    'https://tidal.com/browse/playlist/x',
    'https://open.spotify.com/track/ZZZZZZZZZZZZZZZZZZZZZZ',
  ].join('\n');

  const { text, notes } = await expandLinks(input, { fetchImpl });
  const sections = parseList(text);
  assert.deepStrictEqual(sections.map((s) => [s.name, s.songs.length]), [['Slow dance', 3], ['Cake cutting', 1], ['Party Mix', 3]]);
  assert.strictEqual(sections[0].songs[0].title, 'Perfect');
  assert.strictEqual(sections[1].songs[0].artist, 'Maroon 5');
  assert.ok(notes.some((n) => /Skipped a link I can't read \(tidal\.com\)/.test(n.text)));
  assert.ok(notes.some((n) => /Couldn't read Spotify link \(HTTP 404\)/.test(n.text)));
  assert.ok(notes.some((n) => /private or deleted/.test(n.text)));
  assert.ok(!text.includes('http')); // no raw URLs leak into the song list
});

test('expandLinks leaves plain text untouched', async () => {
  const { text, notes } = await expandLinks('Melodies:\nAdele - Hello', { fetchImpl: async () => { throw new Error('should not fetch'); } });
  assert.strictEqual(text, 'Melodies:\nAdele - Hello');
  assert.deepStrictEqual(notes, []);
});
