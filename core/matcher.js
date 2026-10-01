'use strict';

const path = require('path');

const STOP = new Set([
  'the', 'a', 'an', 'and', 'of', 'with', 'by', 'feat', 'ft', 'featuring', 'prod',
  'official', 'audio', 'video', 'lyrics', 'lyric', 'hd', 'hq', 'remastered', 'remaster', 'version',
]);

function fold(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ً-ٰٟـ]/g, '') // Arabic harakat + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase();
}

function tokenize(s, { dropParens = true } = {}) {
  let t = fold(s);
  if (dropParens) t = t.replace(/[([{][^)\]}]*[)\]}]/g, ' ');
  t = t.replace(/&/g, ' and ').replace(/['’`]/g, '');
  return t.split(/[^\p{L}\p{N}]+/u).filter((x) => x && !STOP.has(x));
}

function levenshtein(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function tokenCredit(q, arr, set) {
  if (set.has(q)) return 1;
  if (q.length < 5) return 0;
  const max = q.length >= 9 ? 2 : 1;
  for (const h of arr) {
    if (Math.abs(h.length - q.length) <= max && levenshtein(q, h, max) <= max) return 0.85;
  }
  return 0;
}

function stripTrackNumber(name) {
  return name.replace(/^\d{1,3}\s*[-._)]\s*/, '').replace(/^\d{1,3}\s+(?=\D)/, '');
}

function makeEntry({ path: p, artist = '', title = '' }) {
  const base = stripTrackNumber(path.basename(p, path.extname(p)));
  let a = String(artist || '').trim();
  let t = String(title || '').trim();
  if (!t) {
    const parts = base.split(/\s+[-–—]\s+/);
    if (parts.length >= 2 && !a) {
      a = parts[0].trim();
      t = parts.slice(1).join(' - ').trim();
    } else {
      t = base;
    }
  }
  const core = tokenize(`${a} ${t}`);
  const all = new Set([
    ...tokenize(`${a} ${t}`, { dropParens: false }),
    ...tokenize(base, { dropParens: false }),
  ]);
  return {
    path: p,
    artist: a,
    title: t,
    core: core.length ? core : tokenize(base, { dropParens: false }),
    all,
    allArr: [...all],
    fingerprint: [...new Set(core)].sort().join(' '),
    hay: fold(`${a} ${t} ${base}`),
  };
}

function buildIndex(rawEntries) {
  const entries = rawEntries.map(makeEntry);
  const byToken = new Map();
  entries.forEach((e, i) => {
    for (const tok of e.all) {
      let list = byToken.get(tok);
      if (!list) byToken.set(tok, (list = []));
      list.push(i);
    }
  });
  return { entries, byToken };
}

function scoreEntry(qTokens, qSet, entry) {
  if (!qTokens.length) return 0;
  let recall = 0;
  for (const q of qTokens) recall += tokenCredit(q, entry.allArr, entry.all);
  recall /= qTokens.length;
  let precision = recall;
  if (entry.core.length) {
    precision = 0;
    for (const c of entry.core) precision += tokenCredit(c, qTokens, qSet);
    precision /= entry.core.length;
  }
  return 0.7 * recall + 0.3 * precision;
}

function rankCandidates(index, query, limit = 5) {
  const qTokens = tokenize(query);
  if (!qTokens.length) return [];
  const qSet = new Set(qTokens);

  const ids = new Set();
  for (const q of qTokens) for (const i of index.byToken.get(q) || []) ids.add(i);
  const pool = ids.size ? [...ids] : index.entries.map((_, i) => i);

  const scored = [];
  for (const i of pool) {
    const e = index.entries[i];
    const score = scoreEntry(qTokens, qSet, e);
    if (score >= 0.35) scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score || a.e.path.localeCompare(b.e.path));

  const seen = new Map();
  const out = [];
  for (const s of scored) {
    const hit = seen.get(s.e.fingerprint);
    if (hit) {
      hit.duplicates += 1;
      continue;
    }
    const c = {
      path: s.e.path,
      artist: s.e.artist,
      title: s.e.title,
      score: Math.round(s.score * 100) / 100,
      duplicates: 0,
    };
    seen.set(s.e.fingerprint, c);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

/** Plain "contains" search over title, artist and file name, for looking a song up by hand. */
function searchLibrary(index, query, limit = 40) {
  const q = fold(query).trim();
  const words = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const e of index.entries) {
    if (!words.every((w) => e.hay.includes(w))) continue;
    const t = fold(e.title).trim();
    hits.push({ e, rank: t === q ? 0 : t.startsWith(q) ? 1 : 2 });
  }
  if (!hits.length) return rankCandidates(index, query, limit).map((c) => ({ ...c, manual: true })); // typo-tolerant fallback
  hits.sort((a, b) => a.rank - b.rank || a.e.hay.length - b.e.hay.length || a.e.path.localeCompare(b.e.path));
  const seen = new Map();
  const out = [];
  for (const h of hits) {
    const key = h.e.fingerprint || h.e.path;
    const dup = seen.get(key);
    if (dup) { dup.duplicates += 1; continue; }
    if (out.length >= limit) continue;
    const c = { path: h.e.path, artist: h.e.artist, title: h.e.title, score: 1, duplicates: 0, manual: true };
    seen.set(key, c);
    out.push(c);
  }
  return out;
}

const MATCH_MIN = 0.8;
const MATCH_GAP = 0.08;
const REVIEW_MIN = 0.5;

function matchSong(index, song) {
  const query = [song.artist, song.title].filter(Boolean).join(' ');
  const candidates = rankCandidates(index, query);
  const top = candidates[0];
  const second = candidates[1];
  let status = 'missing';
  if (top) {
    if (top.score >= MATCH_MIN && (!second || top.score - second.score >= MATCH_GAP)) status = 'matched';
    else if (top.score >= REVIEW_MIN) status = 'review';
  }
  return {
    requested: song.raw,
    note: song.note || '',
    status,
    candidates,
    chosen: status === 'missing' ? -1 : 0,
  };
}

function matchAll(index, sections) {
  return sections.map((s) => ({
    name: s.name,
    items: s.songs.map((song) => matchSong(index, song)),
  }));
}

module.exports = { tokenize, buildIndex, makeEntry, rankCandidates, searchLibrary, matchSong, matchAll, levenshtein };
