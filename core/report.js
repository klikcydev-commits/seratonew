'use strict';

const fs = require('fs');
const path = require('path');
const { safeName } = require('./serato');

/**
 * sections: [{ name, items: [{ requested, note, status, chosen: {path, artist, title, score} | null }] }]
 */

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(eventName, sections) {
  const rows = [['Event', 'Moment', '#', 'Requested', 'Note', 'Status', 'Artist', 'Title', 'Score', 'File']];
  for (const s of sections) {
    s.items.forEach((it, i) => {
      const c = it.chosen;
      rows.push([
        eventName, s.name, i + 1, it.requested, it.note,
        c ? it.status : 'missing',
        c ? c.artist : '', c ? c.title : '', c ? c.score : '', c ? c.path : '',
      ]);
    });
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function toM3u8(items) {
  const lines = ['#EXTM3U'];
  for (const it of items) {
    if (!it.chosen) continue;
    const label = [it.chosen.artist, it.chosen.title].filter(Boolean).join(' - ');
    lines.push(`#EXTINF:-1,${label}`, it.chosen.path);
  }
  return lines.join('\n') + '\n';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toHtml(eventName, sections) {
  const missing = [];
  const body = sections.map((s) => {
    const rows = s.items.map((it, i) => {
      const c = it.chosen;
      const status = c ? it.status : 'missing';
      if (!c) missing.push(`${s.name}: ${it.requested}`);
      return `<tr class="${esc(status)}"><td>${i + 1}</td><td>${esc(it.requested)}${it.note ? `<div class="note">${esc(it.note)}</div>` : ''}</td>` +
        `<td>${c ? esc([c.artist, c.title].filter(Boolean).join(' - ')) : '<em>not in library</em>'}</td><td>${esc(status)}</td></tr>`;
    }).join('');
    return `<h2>${esc(s.name)} <small>${s.items.length}</small></h2><table><thead><tr><th>#</th><th>Requested</th><th>Track</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join('');
  const miss = missing.length
    ? `<div class="missing"><strong>Not found (${missing.length})</strong><ul>${missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(eventName)}</title><style>
body{font:15px/1.4 system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 16px;color:#111}
h1{margin-bottom:4px}h2{margin:28px 0 8px}h2 small{color:#888;font-weight:400}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e5e5e5}
.note{color:#666;font-size:13px}tr.review td:last-child{color:#b45309}tr.missing td{color:#b91c1c}
.missing{background:#fef2f2;border:1px solid #fecaca;padding:10px 14px;border-radius:8px;margin:16px 0}
</style></head><body><h1>${esc(eventName)}</h1><div>${new Date().toISOString().slice(0, 10)}</div>${miss}${body}</body></html>`;
}

function writeReports(outDir, eventName, sections) {
  const base = safeName(eventName);
  const dir = path.join(outDir, base);
  const playlists = path.join(dir, 'playlists');
  fs.mkdirSync(playlists, { recursive: true });

  const csv = path.join(dir, `${base}.csv`);
  const html = path.join(dir, `${base}.html`);
  fs.writeFileSync(csv, toCsv(eventName, sections));
  fs.writeFileSync(html, toHtml(eventName, sections));

  const m3u = [];
  sections.forEach((s, i) => {
    if (!s.items.some((it) => it.chosen)) return;
    const f = path.join(playlists, `${String(i + 1).padStart(2, '0')} ${safeName(s.name)}.m3u8`);
    fs.writeFileSync(f, toM3u8(s.items));
    m3u.push(f);
  });
  return { dir, csv, html, playlists: m3u };
}

async function collectFiles(outDir, eventName, sections, onProgress) {
  const root = path.join(outDir, safeName(eventName), 'Tracks');
  let copied = 0;
  const failed = [];
  for (let si = 0; si < sections.length; si++) {
    const s = sections[si];
    const folder = path.join(root, `${String(si + 1).padStart(2, '0')} ${safeName(s.name)}`);
    fs.mkdirSync(folder, { recursive: true });
    let n = 0;
    for (const it of s.items) {
      if (!it.chosen) continue;
      n += 1;
      const dest = path.join(folder, `${String(n).padStart(2, '0')} - ${path.basename(it.chosen.path)}`);
      try {
        await fs.promises.copyFile(it.chosen.path, dest);
        copied += 1;
      } catch (e) {
        failed.push({ file: it.chosen.path, error: e.message });
      }
      if (onProgress) onProgress({ copied, failed: failed.length });
    }
  }
  return { root, copied, failed };
}

module.exports = { toCsv, toM3u8, toHtml, writeReports, collectFiles };
