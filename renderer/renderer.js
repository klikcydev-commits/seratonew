'use strict';

const $ = (id) => document.getElementById(id);
const state = { folders: [], seratoDir: '', outputDir: '', results: null, scanned: false, filter: 'all' };

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

function cleanError(e) {
  return String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

async function guarded(fn) {
  try { await fn(); } catch (e) { say(cleanError(e), 'error'); }
}

function fileUrl(p) {
  const norm = p.replace(/\\/g, '/');
  return encodeURI(norm.startsWith('/') ? `file://${norm}` : `file:///${norm}`).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

const fileName = (p) => p.split(/[\\/]/).pop();

function persist() {
  return window.api.saveSettings({ folders: state.folders, seratoDir: state.seratoDir, outputDir: state.outputDir });
}

/* ---------------- setup ---------------- */

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

/* ---------------- audio preview ---------------- */

function stopAudio() {
  if (audio) { audio.pause(); audio = null; }
  playingPath = null;
  document.querySelectorAll('.play').forEach((b) => (b.textContent = '▶'));
}

function togglePlay(c, btn) {
  const wasPlaying = playingPath === c.path;
  stopAudio();
  if (wasPlaying) return;
  audio = new Audio(fileUrl(c.path));
  playingPath = c.path;
  btn.textContent = '■';
  audio.addEventListener('ended', stopAudio);
  audio.addEventListener('error', () => { stopAudio(); say('Could not play that file here (format not supported by the preview).', 'error'); });
  audio.play().catch(() => {});
}

/* ---------------- review ---------------- */

const STATUS_LABEL = { matched: 'Found', review: 'Check', missing: 'Not found' };
const FILTER_TITLE = { matched: 'Found', review: 'To check', missing: 'Not found' };

const chosenOf = (item) => (item.chosen >= 0 ? item.candidates[item.chosen] || null : null);
// A song the user picked by hand counts as found; skipped / empty counts as not found.
const statusOf = (item) => (!chosenOf(item) ? 'missing' : item.userPicked ? 'matched' : item.status);

function label(c) {
  const name = [c.artist, c.title].filter(Boolean).join(' — ') || fileName(c.path);
  const dup = c.duplicates ? ` (+${c.duplicates} copy)` : '';
  return c.manual ? `${name}${dup}` : `${name}${dup}  ·  ${Math.round(c.score * 100)}%`;
}

function renderSummary() {
  const c = { matched: 0, review: 0, missing: 0 };
  let selected = 0;
  state.results.forEach((s) => s.items.forEach((it) => {
    c[statusOf(it)] += 1;
    if (chosenOf(it)) selected += 1;
  }));
  const total = c.matched + c.review + c.missing;
  const pill = (key, text) => el('button', {
    class: `pill ${key}${state.filter === key ? ' active' : ''}`,
    'aria-pressed': String(state.filter === key),
    text,
    onclick: () => { state.filter = key; renderResults(); },
  });
  $('summary').replaceChildren(
    pill('all', `All ${total}`),
    pill('matched', `${c.matched} found`),
    pill('review', `${c.review} to check`),
    pill('missing', `${c.missing} not found`),
    el('span', { class: 'muted', text: `${selected} songs selected` }),
  );
}

function renderItem(item, section, showSection) {
  const row = el('div', { class: 'item' });
  const chip = el('span', { class: 'chip' });
  const paint = () => {
    const s = statusOf(item);
    chip.className = `chip ${s}`;
    chip.textContent = STATUS_LABEL[s];
  };
  paint();

  const req = el('div', { class: 'req' },
    el('div', { class: 'reqname' }, el('span', { class: 'reqtext', text: item.requested }), chip),
    item.note ? el('div', { class: 'note', text: item.note }) : null,
    showSection ? el('div', { class: 'note', text: `in: ${section.name}` }) : null);

  // The dropdown lists either the song's own candidates or the results of a library search.
  let shown = item.candidates;
  const select = el('select', { 'aria-label': `Track for ${item.requested}` });
  const build = (placeholder) => {
    select.replaceChildren(
      el('option', { value: '-1', text: placeholder || (item.candidates.length ? '— skip this song —' : '— not found —') }),
      ...shown.map((c, i) => el('option', { value: String(i), title: c.path, text: label(c) })),
    );
    select.value = shown === item.candidates ? String(item.chosen) : '-1';
  };
  build();

  const afterChange = () => { paint(); renderSummary(); };
  select.addEventListener('change', () => {
    const v = Number(select.value);
    if (shown !== item.candidates) {
      if (v < 0) return;
      item.candidates = shown;
      item.chosen = v;
      item.userPicked = true;
      search.value = '';
      build();
    } else {
      item.chosen = v;
      item.userPicked = v >= 0;
    }
    afterChange();
  });

  const play = el('button', { class: 'secondary play', title: 'Preview', 'aria-label': 'Preview track', text: '▶',
    onclick: () => { const c = chosenOf(item); if (c) togglePlay(c, play); } });

  // Live search inside the scanned library; Enter picks the top hit.
  const search = el('input', { type: 'text', placeholder: 'Search your library…', 'aria-label': `Search library for ${item.requested}` });
  let timer;
  let seq = 0;
  const run = async (pickFirst) => {
    const q = search.value.trim();
    const mine = ++seq;
    if (!q) { shown = item.candidates; build(); return; }
    try {
      const found = await window.api.search(q);
      if (mine !== seq) return;
      if (pickFirst && found.length) {
        item.candidates = found;
        item.chosen = 0;
        item.userPicked = true;
        shown = item.candidates;
        build();
        afterChange();
        return;
      }
      shown = found;
      build(found.length ? `— ${found.length} in your library: choose one —` : `— nothing in your library matches “${q}” —`);
    } catch (err) { say(cleanError(err), 'error'); }
  };
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => run(false), 200); });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); run(true); } });

  const remove = el('button', { class: 'secondary', title: 'Remove this line from the list', 'aria-label': 'Remove line', text: '×',
    onclick: () => {
      if (!state.results || !state.results.includes(section)) return;
      section.items.splice(section.items.indexOf(item), 1);
      if (!section.items.length) state.results.splice(state.results.indexOf(section), 1);
      if (!state.results.length) {
        state.results = null;
        $('sections').replaceChildren();
        $('results').hidden = true;
        refreshAddTargets();
        return;
      }
      renderResults();
    } });

  row.append(req, select, el('div', { class: 'tools' }, play, search, remove));
  return row;
}

function renderResults() {
  if (!state.results) return;
  $('results').hidden = false;
  renderSummary();
  const list = $('sections');
  if (state.filter === 'all') {
    list.replaceChildren(...state.results.map((s) => el('div', { class: 'section' },
      el('h3', {}, s.name, ' ', el('small', { text: `${s.items.length} songs` })),
      ...s.items.map((it) => renderItem(it, s, false)))));
  } else {
    // One combined list across every playlist / moment.
    const rows = [];
    state.results.forEach((s) => s.items.forEach((it) => { if (statusOf(it) === state.filter) rows.push(renderItem(it, s, true)); }));
    list.replaceChildren(el('div', { class: 'section' },
      el('h3', {}, FILTER_TITLE[state.filter], ' ', el('small', { text: `${rows.length} songs` })),
      ...(rows.length ? rows : [el('div', { class: 'muted', text: 'Nothing here.' })])));
  }
  refreshAddTargets();
}

function payload() {
  const eventName = $('eventName').value.trim();
  if (!eventName) throw new Error('Give the event a name first.');
  if (!state.results) throw new Error('Find songs first.');
  return {
    eventName,
    seratoDir: state.seratoDir,
    outputDir: state.outputDir,
    sections: state.results.map((s) => ({
      name: s.name,
      items: s.items.map((it) => ({ requested: it.requested, note: it.note, status: statusOf(it), chosen: chosenOf(it) })),
    })),
  };
}

/* ---------------- library search card ---------------- */

function refreshAddTargets() {
  const sel = $('addTarget');
  const keep = sel.value;
  if (state.results && state.results.length) {
    sel.replaceChildren(...state.results.map((s, i) => el('option', { value: String(i), text: s.name })));
    if (keep && Number(keep) < state.results.length) sel.value = keep;
  } else {
    sel.replaceChildren(el('option', { value: '', text: 'Find songs first' }));
  }
  sel.disabled = !state.results;
  document.querySelectorAll('#libResults .add').forEach((b) => { b.disabled = !state.results; });
}

function addToSection(c) {
  const s = state.results && state.results[Number($('addTarget').value)];
  if (!s) return say('Press “Find songs” first, then add songs to a section.', 'error');
  s.items.push({
    requested: [c.artist, c.title].filter(Boolean).join(' - ') || fileName(c.path),
    note: '', status: 'matched', candidates: [c], chosen: 0, userPicked: true,
  });
  say(`Added to “${s.name}”.`, 'ok');
  renderResults();
}

let libTimer;
let libSeq = 0;
async function runLibSearch() {
  const q = $('libSearch').value.trim();
  const mine = ++libSeq;
  const box = $('libResults');
  if (!q) { box.replaceChildren(); $('libCount').textContent = ''; return; }
  if (!state.scanned) { $('libCount').textContent = 'Scan your library first.'; return; }
  try {
    const found = await window.api.search(q);
    if (mine !== libSeq) return;
    $('libCount').textContent = found.length ? `${found.length} found${found.length >= 40 ? ' (showing the first 40)' : ''}` : 'Nothing in your library matches that.';
    box.replaceChildren(...found.map((c) => {
      const play = el('button', { class: 'secondary play', title: 'Preview', 'aria-label': 'Preview', text: '▶', onclick: () => togglePlay(c, play) });
      const add = el('button', { class: 'secondary add', text: 'Add', title: 'Add to the selected section', onclick: () => addToSection(c) });
      if (!state.results) add.disabled = true;
      return el('div', { class: 'res' }, play,
        el('div', {}, el('div', { text: label(c) }), el('div', { class: 'path', text: c.path })), add);
    }));
  } catch (err) { say(cleanError(err), 'error'); }
}

$('libSearch').addEventListener('input', () => { clearTimeout(libTimer); libTimer = setTimeout(runLibSearch, 200); });

/* ---------------- list input: paste / import / drop ---------------- */

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

['dragover', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault()));
$('listInput').addEventListener('drop', (e) => guarded(async () => {
  const files = [...(e.dataTransfer ? e.dataTransfer.files : [])];
  for (const f of files) {
    const r = await window.api.importDropped(f.name, new Uint8Array(await f.arrayBuffer()));
    if (!r.text.trim()) throw new Error(`No songs found in ${f.name}.`);
    appendToList(r.text);
  }
  if (files.length) say(`Added ${files.map((f) => f.name).join(', ')}. Check the list, then press Find songs.`, 'ok');
}));

/* ---------------- buttons ---------------- */

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
      state.results = null;
      refreshAddTargets();
      throw new Error(['No songs found in that text.', ...notes.map((n) => n.text)].join('\n'));
    }
    state.results = sections;
    state.filter = 'all';
    renderResults();
    if (notes.length) say(notes.map((n) => `${n.level === 'warn' ? '⚠ ' : '✓ '}${n.text}`).join('\n'), notes.some((n) => n.level === 'warn') ? 'error' : 'ok');
    else $('message').hidden = true;
  } finally {
    offStatus();
    $('find').disabled = false;
  }
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
  say(`Report saved in:\n${r.dir}\n(${r.playlists.length} playlist file(s) included)`, 'ok');
  window.api.reveal(r.html);
}));

$('collect').addEventListener('click', () => guarded(async () => {
  const body = payload();
  say('Copying…');
  const off = window.api.onCopyProgress((p) => say(`Copying… ${p.copied} done${p.failed ? `, ${p.failed} failed` : ''}`));
  try {
    const r = await window.api.collectFiles(body);
    const lines = [`Copied ${r.copied} song(s) into:`, r.root, '', ...r.folders.map((f) => `• ${f.name} — ${f.count} song${f.count === 1 ? '' : 's'}`)];
    if (r.failed.length) lines.push('', ...r.failed.map((f) => `⚠ ${f.file}: ${f.error}`));
    say(lines.join('\n'), r.failed.length ? 'error' : 'ok');
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
  refreshAddTargets();
  if (state.folders.length) doScan();
})();
