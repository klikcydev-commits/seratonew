'use strict';

/**
 * Parses a pasted client list into sections of songs.
 *
 * Accepted section headers (any of these):
 *   Slow dance:          (line ending in a colon)
 *   # Slow dance         (markdown style)
 *   [Slow dance]
 *   --- Slow dance ---
 *
 * Song lines (leading bullets / numbers are stripped):
 *   Artist - Title
 *   Title by Artist
 *   Title
 *   Artist - Title | play softly, lights down     (text after | or // is a per-song note)
 *
 * Songs that appear before any header go into a section called "Unsorted".
 */

const HEADER_PATTERNS = [
  /^\s*#{1,6}\s*(.+?)\s*#*\s*$/,
  /^\s*\[(.+?)\]\s*$/,
  /^\s*[-=*_~]{2,}\s*(.+?)\s*[-=*_~]{2,}\s*$/,
  /^\s*(.+?)\s*[:：]\s*$/,
];

const BULLET = /^\s*(?:[-*•·▪►]|\d{1,3}[.)])\s+/;
const NOTE_SPLIT = /\s*(?:\||\/\/)\s*/;
const ARTIST_TITLE_SPLIT = /\s+[-–—]\s+/;
const TITLE_BY_ARTIST = /^(.+?)\s+by\s+(.+)$/i;

function matchHeader(line) {
  for (const re of HEADER_PATTERNS) {
    const m = line.match(re);
    if (m && m[1] && m[1].trim()) return m[1].trim();
  }
  return null;
}

function parseSong(line) {
  let text = line.replace(BULLET, '').trim();
  let note = '';
  const parts = text.split(NOTE_SPLIT);
  if (parts.length > 1) {
    text = parts[0].trim();
    note = parts.slice(1).join(' ').trim();
  }
  if (!text) return null;

  let artist = '';
  let title = text;
  const dash = text.split(ARTIST_TITLE_SPLIT);
  if (dash.length >= 2) {
    artist = dash[0].trim();
    title = dash.slice(1).join(' - ').trim();
  } else {
    const by = text.match(TITLE_BY_ARTIST);
    if (by) {
      title = by[1].trim();
      artist = by[2].trim();
    }
  }
  return { raw: text, artist, title, note };
}

function parseList(input) {
  const lines = String(input || '').split(/\r?\n/);
  const sections = [];
  let current = null;

  const ensure = (name) => {
    const existing = sections.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const s = { name, songs: [] };
    sections.push(s);
    return s;
  };

  for (const line of lines) {
    if (!line.trim()) continue;
    const header = matchHeader(line);
    if (header) {
      current = ensure(header);
      continue;
    }
    const song = parseSong(line);
    if (!song) continue;
    if (!current) current = ensure('Unsorted');
    current.songs.push(song);
  }
  return sections.filter((s) => s.songs.length > 0);
}

module.exports = { parseList, parseSong, matchHeader };
