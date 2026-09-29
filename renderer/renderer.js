'use strict';

const $ = (id) => document.getElementById(id);
const state = { folders: [], seratoDir: '', outputDir: '', results: null, scanned: false };

let audio = null;
let playingPath = null;

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  kids.flat().forEach((c) => c && n.append(c));
  return n;
}

function say(text, kind = '') {
  const m = $('message');
  m.hidden = false;
  m.className = `message ${kind}`;
  m.textContent = text;
}

function fileUrl(p) {
  const norm = p.replace(/\\/g, '/');
  return encodeURI(norm.startsWith('/') ? `file://${norm}` : `file:///${norm}`).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

function persist() {
  return window.api.saveSettings({ folders: state.folders, seratoDir: state.seratoDir, outputDir: state.outputDir });
}

function renderSetup() {
  const ul = $('folders');
  ul.replaceChildren(...state.folders.map((f, i) => el('li', {}, el('span', { text: f }),
    el('button', { title: 'Remove', 'aria-label': `Remove ${f}`, text: '×', onclick: () => {
      state.folders.splice(i, 1); state.scanned = false; persist(); renderSetup();
    } }))));
  $('seratoDir').textContent = state.seratoDir;
  $('outputDir').textContent = state.outputDir;
}

async function doScan() {
  if (!state.folders.length) return say('Add at least one music folder first.', 'error');
  $('scan').disabled = true;
  $('scanStatus').textContent = 'Scanning…';
  try {
    const { count } = await window.api.scan(state.folders);
    state.scanned = true;
    $('scanStatus').textContent = `${count.toLocaleString()} tracks indexed`;
  } catch (e) {
    $('scanStatus').textContent = '';
    say(cleanError(e), 'error');
  } finally {
    $('scan').disabled = false;
  }
}

function cleanError(e) {
  return String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function chosenOf(item) {
  return item.chosen >= 0 ? item.candidates[item.chosen] : null;
}

function label(c) {
  const name = [c.artist, c.title].filter(Boolean).join(' — ') || c.path.split(/[\\/]/).pop();
  const file = c.path.split(/[\\/]/).pop();
  const dup = c.duplicates ? ` (+${c.duplicates} copy)` : '';
  return `${name}${dup}  ·  ${file}  ·  ${Math.round(c.score * 100)}%`;
}

function statusOf(item) {
  return chosenOf(item) ? item.status : 'missing';
}

function renderSummary() {
  const counts = { matched: 0, review: 0, missing: 0 };
  let selected = 0;
  state.results.forEach((s) => s.items.forEach((it) => {
    counts[it.status] += 1;
    if (chosenOf(it)) selected += 1;
  }));
  $('summary').replaceChildren(
    el('span', { class: 'pill matched', text: `${counts.matched} matched` }),
    el('span', { class: 'pill review', text: `${counts.review} to check` }),
    el('span', { class: 'pill missing', text: `${counts.missing} not found` }),
    el('span', { class: 'muted', text: `${selected} tracks selected` }),
  );
}

function stopAudio() {
  if (audio) { audio.pause(); audio = null; }
  playingPath = null;
}

function togglePlay(c, btn) {
  const wasPlaying = playingPath === c.path;
  document.querySelectorAll('.play').forEach((b) => (b.textContent = '▶'));
  stopAudio();
  if (wasPlaying) return;
  audio = new Audio(fileUrl(c.path));
  playingPath = c.path;
  btn.textContent = '■';
  audio.addEventListener('ended', () => { btn.textContent = '▶'; playingPath = null; });
  audio.addEventListener('error', () => { btn.textContent = '▶'; playingPath = null; say('Could not play that file here (format not supported by the preview).', 'error'); });
  audio.play().catch(() => {});
}

function renderItem(item) {
  const row = el('div', { class: 'item' });
  const dot = el('span', { class: `dot ${statusOf(item)}` });
  const req = el('div', { class: 'req' }, el('div', { text: item.requested }), item.note ? el('div', { class: 'note', text: item.note }) : null);

  const select = el('select', { 'aria-label': `Track for ${item.requested}` });
  const build = () => {
    select.replaceChildren(
      el('option', { value: '-1', text: item.candidates.length ? '— skip this song —' : '— not found —' }),
      ...item.candidates.map((c, i) => el('option', { value: String(i), text: label(c) })),
    );
    select.value = String(item.chosen);
  };
  build();
  select.addEventListener('change', () => {
    item.chosen = Number(select.value);
    dot.className = `dot ${statusOf(item)}`;
    renderSummary();
  });

  const play = el('button', { class: 'secondary play', title: 'Preview', 'aria-label': 'Preview track', text: '▶',
    onclick: () => { const c = chosenOf(item); if (c) togglePlay(c, play); } });
  const search = el('input', { type: 'text', placeholder: 'Search library…', 'aria-label': 'Search library' });
  search.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !search.value.trim()) return;
    try {
      const found = await window.api.search(search.value.trim());
      if (!found.length) return say(`Nothing in your library matches "${search.value.trim()}".`, 'error');
      item.candidates = found;
      item.chosen = 0;
      item.status = 'review';
      build();
      dot.className = `dot ${statusOf(item)}`;
      renderSummary();
    } catch (err) { say(cleanError(err), 'error'); }
  });

  row.append(dot, req, select, el('div', { class: 'tools' }, play, search));
  return row;
}

function renderResults() {
  $('results').hidden = false;
  $('sections').replaceChildren(...state.results.map((s) => el('div', { class: 'section' },
    el('h3', {}, s.name, ' ', el('small', { text: `${s.items.length} songs` })),
    ...s.items.map(renderItem))));
  renderSummary();
}

function payload() {
  const eventName = $('eventName').value.trim();
  if (!eventName) throw new Error('Give the event a name first.');
  return {
    eventName,
    seratoDir: state.seratoDir,
    outputDir: state.outputDir,
    sections: state.results.map((s) => ({
      name: s.name,
      items: s.items.map((it) => ({ requested: it.requested, note: it.note, status: it.status, chosen: chosenOf(it) })),
    })),
  };
}

async function guarded(fn) {
  try { await fn(); } catch (e) { say(cleanError(e), 'error'); }
}

$('addFolder').addEventListener('click', () => guarded(async () => {
  const f = await window.api.pickFolder();
  if (f && !state.folders.includes(f)) { state.folders.push(f); state.scanned = false; await persist(); renderSetup(); }
}));
$('pickSerato').addEventListener('click', () => guarded(async () => {
  const f = await window.api.pickFolder();
  if (f) { state.seratoDir = f; await persist(); renderSetup(); }
}));
$('pickOutput').addEventListener('click', () => guarded(async () => {
  const f = await window.api.pickFolder();
  if (f) { state.outputDir = f; await persist(); renderSetup(); }
}));
$('scan').addEventListener('click', doScan);

$('find').addEventListener('click', () => guarded(async () => {
  if (!state.scanned) await doScan();
  if (!state.scanned) return;
  const text = $('listInput').value;
  if (!text.trim()) throw new Error('Paste the client list first.');
  stopAudio();
  $('find').disabled = true;
  const offStatus = window.api.onLinkStatus((s) => say(s));
  try {
    const { sections, notes } = await window.api.match(text);
    if (!sections.length) {
      $('results').hidden = true;
      throw new Error(['No songs found in that text.', ...notes.map((n) => n.text)].join('\n'));
    }
    state.results = sections;
    renderResults();
    if (notes.length) say(notes.map((n) => `${n.level === 'warn' ? '⚠ ' : '✓ '}${n.text}`).join('\n'), notes.some((n) => n.level === 'warn') ? 'error' : 'ok');
    else $('message').hidden = true;
  } finally {
    offStatus();
    $('find').disabled = false;
  }
}));

function appendToList(text) {
  const box = $('listInput');
  const cur = box.value.trimEnd();
  box.value = (cur ? `${cur}\n\n` : '') + text.trim() + '\n';
}

$('importFile').addEventListener('click', () => guarded(async () => {
  const r = await window.api.importFile();
  if (!r) return;
  if (!r.text.trim()) throw new Error(`No songs found in ${r.name}.`);
  appendToList(r.text);
  say(`Added ${r.name}. Check the list, then press Find songs.`, 'ok');
}));

const dropBox = $('listInput');
['dragover', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault()));
dropBox.addEventListener('drop', (e) => guarded(async () => {
  const files = [...(e.dataTransfer ? e.dataTransfer.files : [])];
  for (const f of files) {
    const r = await window.api.importDropped(f.name, new Uint8Array(await f.arrayBuffer()));
    if (!r.text.trim()) throw new Error(`No songs found in ${f.name}.`);
    appendToList(r.text);
  }
  if (files.length) say(`Added ${files.map((f) => f.name).join(', ')}. Check the list, then press Find songs.`, 'ok');
}));

$('makeCrates').addEventListener('click', () => guarded(async () => {
  const r = await window.api.writeCrates(payload());
  const lines = r.written.map((w) => `✓ ${r.parent} › ${w.crate} — ${w.tracks} tracks`);
  if (r.warnings.length) lines.push('', ...r.warnings.map((w) => `⚠ ${w}`));
  lines.push('', 'Reopen Serato DJ to see the crates.');
  say(lines.join('\n'), r.written.length ? 'ok' : 'error');
}));

$('exportReport').addEventListener('click', () => guarded(async () => {
  const r = await window.api.exportReport(payload());
  say(`Report saved:\n${r.html}\n${r.csv}\n${r.playlists.length} playlist file(s) in ${r.dir}`, 'ok');
  window.api.reveal(r.html);
}));

$('collect').addEventListener('click', () => guarded(async () => {
  say('Copying…');
  const off = window.api.onCopyProgress((p) => say(`Copying… ${p.copied} done${p.failed ? `, ${p.failed} failed` : ''}`));
  try {
    const r = await window.api.collectFiles(payload());
    const fails = r.failed.map((f) => `⚠ ${f.file}: ${f.error}`);
    say([`Copied ${r.copied} track(s) into ${r.root}`, ...fails].join('\n'), r.failed.length ? 'error' : 'ok');
    window.api.reveal(r.root);
  } finally { off(); }
}));

window.api.onScanProgress((p) => {
  $('scanStatus').textContent = p.phase === 'walk'
    ? `Finding files… ${p.found.toLocaleString()}`
    : `Reading tags… ${p.done.toLocaleString()} / ${p.total.toLocaleString()}`;
});

(async function init() {
  const s = await window.api.getSettings();
  Object.assign(state, { folders: s.folders, seratoDir: s.seratoDir, outputDir: s.outputDir });
  renderSetup();
  if (state.folders.length) doScan();
})();
