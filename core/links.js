'use strict';

/**
 * Reads song names from Spotify, YouTube and Apple Music links (no API keys needed).
 *
 * It reads the public pages those services serve. That is not an official API, so a
 * site redesign can break a parser; every failure is reported clearly and the user can
 * fall back to importing an export file instead.
 */

const { matchHeader } = require('./parseList');
const { clean, primaryArtist, cleanTitle, videoToSong, songLine } = require('./songText');

const ALLOWED = new Set([
  'open.spotify.com', 'play.spotify.com', 'spotify.link', 'spotify.app.link',
  'www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be',
  'music.apple.com', 'itunes.apple.com', 'embed.music.apple.com',
]);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const URL_RE = /(?:https?:\/\/|spotify:(?:playlist|track|album):)[^\s<>"')\]]+/gi;
const MAX_TRACKS = 2000;
const TRUNCATION_HINT = 100;

/* ---------- link detection ---------- */

function extractUrls(line) {
  return (String(line).match(URL_RE) || []).map((u) => u.replace(/[.,;:!?]+$/, ''));
}

function classify(raw) {
  const uri = raw.match(/^spotify:(playlist|track|album):([A-Za-z0-9]{22})$/i);
  if (uri) {
    const kind = uri[1].toLowerCase();
    return { service: 'spotify', kind, id: uri[2], url: `https://open.spotify.com/${kind}/${uri[2]}` };
  }
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  if (!ALLOWED.has(host)) return { service: 'unsupported', host, url: raw };

  if (host === 'open.spotify.com' || host === 'play.spotify.com') {
    const m = u.pathname.match(/\/(playlist|track|album)\/([A-Za-z0-9]{22})/);
    if (!m) return { service: 'unsupported', host, url: raw };
    return { service: 'spotify', kind: m[1], id: m[2], url: `https://open.spotify.com/${m[1]}/${m[2]}` };
  }
  if (host === 'spotify.link' || host === 'spotify.app.link') return { service: 'spotify', kind: 'short', url: raw };

  if (host === 'youtu.be' || host.endsWith('youtube.com')) {
    const idOk = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(s);
    let video = null;
    if (host === 'youtu.be') video = u.pathname.slice(1).split('/')[0];
    else if (u.pathname === '/watch') video = u.searchParams.get('v');
    else if (u.pathname.startsWith('/shorts/')) video = u.pathname.split('/')[2];
    const list = u.searchParams.get('list');
    const realList = idOk(list) && !/^(RD|UL|LL|WL)/.test(list) ? list : null; // mixes and personal lists aren't readable
    if (realList) return { service: 'youtube', kind: 'playlist', list: realList, url: raw };
    if (idOk(video)) return { service: 'youtube', kind: 'video', id: video, url: raw };
    return { service: 'unsupported', host, url: raw };
  }

  if (host.endsWith('apple.com')) {
    const seg = u.pathname.split('/').filter(Boolean);
    const kind = seg.find((s) => ['playlist', 'album', 'song'].includes(s));
    if (!kind) return { service: 'unsupported', host, url: raw };
    const i = u.searchParams.get('i');
    if (kind === 'album' && i && /^\d+$/.test(i)) {
      return { service: 'apple', kind: 'song', trackId: i, path: u.pathname, url: raw };
    }
    return { service: 'apple', kind, path: u.pathname, url: raw };
  }
  return { service: 'unsupported', host, url: raw };
}

/* ---------- safe network access ---------- */

async function readCapped(res, max) {
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > max) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new Error('Page too large');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const t = await res.text();
  if (t.length > max) throw new Error('Page too large');
  return t;
}

/** Fetches only allow-listed hosts, re-checking every redirect hop. */
async function safeFetch(url, { fetchImpl = globalThis.fetch, maxBytes = 8e6, timeoutMs = 15000, headers = {} } = {}) {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    const parsed = new URL(current);
    if (!ALLOWED.has(parsed.hostname.toLowerCase())) throw new Error(`Blocked redirect to ${parsed.hostname}`);
    if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    current = parsed.toString();
    const res = await fetchImpl(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...headers },
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('Redirect without location');
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { url: current, text: await readCapped(res, maxBytes) };
  }
  throw new Error('Too many redirects');
}

/* ---------- page parsers (pure, unit-tested) ---------- */

function findAll(node, pred, out = [], depth = 0) {
  if (node == null || typeof node !== 'object' || depth > 60) return out;
  if (!Array.isArray(node) && pred(node)) out.push(node);
  for (const k of Object.keys(node)) findAll(node[k], pred, out, depth + 1);
  return out;
}

function parseSpotify(html) {
  const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) throw new Error('unrecognised page');
  const data = JSON.parse(m[1]);

  const holder = findAll(data, (n) => Array.isArray(n.trackList))[0];
  if (holder) {
    const tracks = holder.trackList
      .map((t) => ({ artist: primaryArtist(t.subtitle), title: cleanTitle(t.title) }))
      .filter((t) => t.title);
    return { title: clean(holder.name || holder.title), tracks };
  }
  const single = findAll(data, (n) =>
    (typeof n.name === 'string' || typeof n.title === 'string') &&
    (Array.isArray(n.artists) || typeof n.subtitle === 'string') &&
    (n.type === 'track' || (typeof n.uri === 'string' && n.uri.startsWith('spotify:track:'))))[0];
  if (single) {
    const artist = Array.isArray(single.artists) ? clean(single.artists[0] && single.artists[0].name) : primaryArtist(single.subtitle);
    return { title: '', tracks: [{ artist, title: cleanTitle(single.name || single.title) }] };
  }
  throw new Error('no tracks found');
}

const txt = (x) => (x ? (x.simpleText != null ? x.simpleText : (x.runs || []).map((r) => r.text).join('')) : '');

function parseYouTubePlaylist(html) {
  const m = html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!m) throw new Error('unrecognised page');
  const data = JSON.parse(m[1]);
  const renderers = findAll(data, (n) => n.playlistVideoRenderer).map((n) => n.playlistVideoRenderer);
  const tracks = [];
  let unavailable = 0;
  for (const v of renderers) {
    const title = clean(txt(v.title));
    if (!title || /^\[(private|deleted) video\]$/i.test(title)) { unavailable += 1; continue; }
    const song = videoToSong({ title, channel: txt(v.shortBylineText) });
    if (song.title) tracks.push(song);
  }
  if (!tracks.length) throw new Error('no tracks found');
  const meta = findAll(data, (n) => n.playlistMetadataRenderer)[0];
  const title = clean(meta ? meta.playlistMetadataRenderer.title : '');
  return { title, tracks, unavailable };
}

function nameOf(x) {
  if (!x) return '';
  if (typeof x === 'string') return x;
  if (Array.isArray(x)) return x.map(nameOf).find(Boolean) || '';
  return x.name || '';
}

function parseApple(html, { trackId } = {}) {
  let title = '';
  const ld = [];
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j;
    try { j = JSON.parse(m[1]); } catch { continue; }
    for (const node of Array.isArray(j) ? j : [j]) {
      const type = node && node['@type'];
      if (type === 'MusicPlaylist' || type === 'MusicAlbum') {
        title = title || clean(node.name);
        const albumArtist = nameOf(node.byArtist);
        for (const t of node.track || []) {
          ld.push({ title: cleanTitle(t.name), artist: primaryArtist(nameOf(t.byArtist) || albumArtist), url: t.url || '', id: '' });
        }
      } else if (type === 'MusicRecording' && !ld.length) {
        ld.push({ title: cleanTitle(node.name), artist: primaryArtist(nameOf(node.byArtist)), url: node.url || '', id: '' });
      }
    }
  }

  let srv = [];
  const sm = html.match(/<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/i);
  if (sm) {
    try {
      const data = JSON.parse(sm[1]);
      const seen = new Set();
      for (const n of findAll(data, (x) => x.contentDescriptor && x.contentDescriptor.kind === 'song' && typeof x.title === 'string')) {
        const t = { title: cleanTitle(n.title), artist: primaryArtist(n.artistName || ''), id: String((n.contentDescriptor.identifiers || {}).storeAdamID || ''), url: '' };
        const key = `${t.id}|${t.title}|${t.artist}`;
        if (t.title && !seen.has(key)) { seen.add(key); srv.push(t); }
      }
    } catch { /* fall back to JSON-LD */ }
  }

  let selectedOnly = false;
  if (trackId) {
    const a = ld.filter((t) => t.url.includes(`i=${trackId}`));
    const b = srv.filter((t) => t.id === trackId);
    if (a.length || b.length) { selectedOnly = true; ld.splice(0, ld.length, ...a); srv = b; }
  }
  const ldRich = ld.length && ld.filter((t) => t.artist).length >= ld.length * 0.5;
  const tracks = (ldRich ? ld : srv.length ? srv : ld).filter((t) => t.title);
  if (!tracks.length) throw new Error('no tracks found');
  return { title: selectedOnly ? '' : title, tracks: tracks.map(({ artist, title: t }) => ({ artist, title: t })), selectedOnly };
}

/* ---------- per-service loaders ---------- */

async function loadSpotify(cls, o) {
  let c = cls;
  if (c.kind === 'short') {
    const r = await safeFetch(c.url, { ...o, maxBytes: 3e6 });
    c = classify(r.url);
    if (!c || c.service !== 'spotify' || c.kind === 'short') throw new Error('could not resolve this short link; paste the full open.spotify.com link');
  }
  const { text } = await safeFetch(`https://open.spotify.com/embed/${c.kind}/${c.id}`, o);
  return { source: 'Spotify', ...parseSpotify(text), single: c.kind === 'track' };
}

async function loadYouTube(cls, o) {
  if (cls.kind === 'playlist') {
    const { text } = await safeFetch(`https://www.youtube.com/playlist?list=${encodeURIComponent(cls.list)}`,
      { ...o, headers: { Cookie: 'SOCS=CAI; CONSENT=YES+1' } });
    return { source: 'YouTube', ...parseYouTubePlaylist(text) };
  }
  const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(cls.id)}`;
  const { text } = await safeFetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`, o);
  const j = JSON.parse(text);
  const song = videoToSong({ title: j.title, channel: j.author_name });
  if (!song.title) throw new Error('no title found');
  return { source: 'YouTube', title: '', tracks: [song], single: true };
}

async function loadApple(cls, o) {
  const { text } = await safeFetch(`https://music.apple.com${cls.path}`, o);
  const r = parseApple(text, { trackId: cls.trackId });
  return { source: 'Apple Music', ...r, single: cls.kind === 'song' && r.selectedOnly === true };
}

async function loadLink(cls, o) {
  const r = cls.service === 'spotify' ? await loadSpotify(cls, o)
    : cls.service === 'youtube' ? await loadYouTube(cls, o)
      : await loadApple(cls, o);
  r.tracks = r.tracks.slice(0, MAX_TRACKS);
  return r;
}

/* ---------- expand links inside pasted text ---------- */

/**
 * Replaces every supported link in `text` with the songs it points to.
 *  - A link under a header ("Slow dance:") adds its songs to that section.
 *  - "First dance - <link>" makes a section called "First dance".
 *  - A bare link gets its own section named after the playlist.
 * Returns { text, notes: [{ level: 'info' | 'warn', text }] }.
 */
async function expandLinks(text, { fetchImpl = globalThis.fetch, onStatus } = {}) {
  const lines = String(text || '').split(/\r?\n/);
  const total = lines.reduce((n, l) => n + extractUrls(l).length, 0);
  const out = [];
  const notes = [];
  const cache = new Map();
  const singles = new Map(); // source -> number of songs that came from single-song links
  let mode = 'none'; // 'header': next link joins that header's section; 'singles': running group of single-song links
  let done = 0;

  for (const raw of lines) {
    const urls = extractUrls(raw);
    if (!urls.length) {
      out.push(raw);
      if (raw.trim()) mode = matchHeader(raw) ? 'header' : 'none';
      continue;
    }
    let rest = raw.replace(URL_RE, ' ').replace(/^\s*(?:[-*•·▪►]|\d{1,3}[.)])\s+/, '');
    rest = clean(rest.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
    if (/^\d{1,4}$/.test(rest)) rest = ''; // "48 https://..." is a list number, not a section name
    let first = true;

    for (const url of urls) {
      done += 1;
      const cls = classify(url);
      if (!cls || cls.service === 'unsupported') {
        notes.push({ level: 'warn', text: `Skipped a link I can't read (${cls && cls.host ? cls.host : 'unknown'}). Supported: Spotify, YouTube, Apple Music.` });
        continue;
      }
      if (onStatus) onStatus(`Reading link ${done} of ${total}…`);
      let result;
      try {
        if (!cache.has(url)) cache.set(url, await loadLink(cls, { fetchImpl }));
        result = cache.get(url);
      } catch (e) {
        notes.push({ level: 'warn', text: `Couldn't read ${cls.service === 'apple' ? 'Apple Music' : cls.service === 'youtube' ? 'YouTube' : 'Spotify'} link (${e.message}). The link may be private, or the site changed. You can upload an export (CSV) instead.` });
        continue;
      }

      const single = Boolean(result.single);
      if (first && rest) {
        out.push(`${rest}:`);
        mode = 'header';
      } else if (single) {
        // Single-song links all land in ONE section instead of one section per song.
        if (mode === 'none') {
          out.push('Unsorted:');
          mode = 'singles';
        }
      } else if (mode !== 'header') {
        out.push(`${result.title || 'Unsorted'}:`);
        mode = 'none';
      }
      first = false;

      for (const t of result.tracks) out.push(songLine(t));
      if (single) singles.set(result.source, (singles.get(result.source) || 0) + result.tracks.length);
      else notes.push({ level: 'info', text: `${result.source}: ${result.tracks.length} song${result.tracks.length === 1 ? '' : 's'}${result.title ? ` from "${result.title}"` : ''}` });
      if (result.tracks.length >= TRUNCATION_HINT && result.source !== 'Apple Music') {
        notes.push({ level: 'warn', text: `${result.source} only shares the first ${TRUNCATION_HINT} songs of a playlist through a link. If the playlist is longer, upload an export (CSV) to get the rest.` });
      }
      if (result.unavailable) {
        notes.push({ level: 'warn', text: `${result.unavailable} video(s) in that YouTube playlist are private or deleted and were skipped.` });
      }
      if (result.selectedOnly === false && cls.kind === 'song') {
        notes.push({ level: 'warn', text: 'That Apple Music link pointed to one song but I could only read the whole album; delete the ones you do not need.' });
      }
    }
    // "Name - link" is self-contained: a later bare link starts its own section.
    if (rest && !first) mode = 'none';
  }
  for (const [source, n] of singles) notes.unshift({ level: 'info', text: `${source}: ${n} single song${n === 1 ? '' : 's'}` });
  return { text: out.join('\n'), notes };
}

module.exports = {
  extractUrls, classify, safeFetch, parseSpotify, parseYouTubePlaylist, parseApple, expandLinks, ALLOWED,
};
