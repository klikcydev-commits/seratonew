'use strict';

/**
 * Turns a file a client sent (or your own spreadsheet) into pasteable list text.
 * Supported: .txt .md .csv .tsv .m3u .m3u8 .docx
 */

const { clean, primaryArtist, songLine } = require('./songText');

const MAX_BYTES = 10 * 1024 * 1024;
const SUPPORTED = ['.txt', '.md', '.csv', '.tsv', '.m3u', '.m3u8', '.docx'];

function decodeText(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const b = Buffer.from(buf.subarray(2));
    b.swap16();
    return b.toString('utf16le');
  }
  return buf.toString('utf8').replace(/^﻿/, '');
}

function parseCsv(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [',', ';', '\t']
    .map((d) => [d, first.split(d).length])
    .sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => clean(c)));
}

const COL = {
  title: /^(track|song|title)( name)?$|^name$/i,
  artist: /^artists?( name\(?s?\)?)?$/i,
  section: /^(playlist( name)?|section|moment|category|event|part)$/i,
  note: /^(notes?|comments?|remarks?)$/i,
};

function csvToList(text) {
  const rows = parseCsv(text);
  if (!rows.length) return '';
  const head = rows[0].map((c) => clean(c));
  const find = (re) => head.findIndex((h) => re.test(h));
  const tc = find(COL.title);
  const ac = find(COL.artist);
  const sc = find(COL.section);
  const nc = find(COL.note);

  const groups = new Map();
  const add = (section, line) => {
    if (!line) return;
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section).push(line);
  };

  if (tc >= 0) {
    for (const r of rows.slice(1)) {
      const title = clean(r[tc]);
      if (!title) continue;
      const artist = ac >= 0 ? primaryArtist(String(r[ac] || '').replace(/;/g, ',')) : '';
      const note = nc >= 0 ? clean(r[nc]) : '';
      add(sc >= 0 ? clean(r[sc]) : '', songLine({ artist, title }) + (note ? ` | ${note}` : ''));
    }
  } else {
    for (const r of rows) {
      const cells = r.map(clean).filter(Boolean);
      add('', cells.length >= 2 ? `${cells[0]} - ${cells[1]}` : cells[0]);
    }
  }
  const parts = [];
  for (const [name, lines] of groups) parts.push((name ? `${name}:\n` : '') + lines.join('\n'));
  return parts.join('\n\n');
}

function m3uToList(text, stem) {
  const lines = text.split(/\r?\n/);
  const songs = [];
  let pending = '';
  for (const l of lines) {
    const line = l.trim();
    if (!line) continue;
    if (/^#EXTINF:/i.test(line)) {
      pending = clean(line.slice(line.indexOf(',') + 1));
    } else if (!line.startsWith('#')) {
      const file = line.split(/[\\/]/).pop().replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/^\d{1,3}\s*[-._)]\s*/, '');
      songs.push(pending || clean(file));
      pending = '';
    }
  }
  return songs.length ? `${stem}:\n${songs.join('\n')}` : '';
}

async function fileToListText(name, buffer) {
  if (buffer.length > MAX_BYTES) throw new Error('That file is too large (10 MB max).');
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  const stem = dot >= 0 ? name.slice(0, dot) : name;

  if (ext === '.txt' || ext === '.md') return { text: decodeText(buffer) };
  if (ext === '.csv' || ext === '.tsv') return { text: csvToList(decodeText(buffer)) };
  if (ext === '.m3u' || ext === '.m3u8') return { text: m3uToList(decodeText(buffer), clean(stem) || 'Playlist') };
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const { value } = await mammoth.extractRawText({ buffer });
    return { text: value };
  }
  const hint = ['.xlsx', '.xls', '.numbers'].includes(ext) ? ' In Excel, use Save As → CSV.'
    : ['.pdf', '.png', '.jpg', '.jpeg', '.heic'].includes(ext) ? ' PDFs and screenshots are not supported yet; type or paste the names.'
      : '';
  throw new Error(`Can't read ${ext || 'that'} files. Supported: ${SUPPORTED.join(' ')}.${hint}`);
}

module.exports = { fileToListText, csvToList, m3uToList, parseCsv, decodeText, SUPPORTED, MAX_BYTES };
