'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { parseList } = require('./core/parseList');
const { scanLibrary } = require('./core/scanLibrary');
const { buildIndex, matchAll, rankCandidates } = require('./core/matcher');
const { writeCrates, defaultSeratoDir } = require('./core/serato');
const { writeReports, collectFiles } = require('./core/report');
const { assertTracksInLibrary } = require('./core/safety');
const { expandLinks } = require('./core/links');
const { fileToListText, SUPPORTED, MAX_BYTES } = require('./core/importFile');

let win = null;
let index = null; // in-memory library index
let libraryRoots = [];

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const cacheFile = () => path.join(app.getPath('userData'), 'library-cache.json');

function defaults() {
  return {
    folders: [],
    seratoDir: defaultSeratoDir(),
    outputDir: path.join(app.getPath('documents'), 'Set Builder'),
  };
}

function loadSettings() {
  try {
    return { ...defaults(), ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    return defaults();
  }
}

function saveSettings(s) {
  const clean = {
    folders: Array.isArray(s.folders) ? s.folders.filter((f) => typeof f === 'string') : [],
    seratoDir: typeof s.seratoDir === 'string' ? s.seratoDir : defaults().seratoDir,
    outputDir: typeof s.outputDir === 'string' ? s.outputDir : defaults().outputDir,
  };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(clean, null, 2));
  return clean;
}

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

/** Validates the renderer's payload and returns sections with only trusted, in-library picks. */
function trustedSections(sections) {
  if (!Array.isArray(sections)) throw new Error('Invalid sections');
  const out = sections.map((s) => {
    if (!isStr(s.name) || !Array.isArray(s.items)) throw new Error('Invalid section');
    return {
      name: String(s.name),
      items: s.items.map((it) => ({
        requested: String(it.requested || ''),
        note: String(it.note || ''),
        status: ['matched', 'review', 'missing'].includes(it.status) ? it.status : 'review',
        chosen: it.chosen && isStr(it.chosen.path)
          ? {
              path: it.chosen.path,
              artist: String(it.chosen.artist || ''),
              title: String(it.chosen.title || ''),
              score: Number(it.chosen.score) || 0,
            }
          : null,
      })),
    };
  });
  const paths = out.flatMap((s) => s.items.filter((i) => i.chosen).map((i) => i.chosen.path));
  assertTracksInLibrary(paths, libraryRoots);
  return out;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 860,
    minHeight: 600,
    backgroundColor: '#0f1115',
    title: 'Set Builder',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function registerIpc() {
  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:save', (_e, s) => saveSettings(s || {}));

  ipcMain.handle('dialog:folder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('library:scan', async (e, folders) => {
    if (!Array.isArray(folders) || !folders.length) throw new Error('Add at least one music folder first.');
    const valid = folders.filter((f) => isStr(f) && fs.existsSync(f) && fs.statSync(f).isDirectory());
    if (!valid.length) throw new Error('None of the selected folders exist.');
    const entries = await scanLibrary(valid, {
      cachePath: cacheFile(),
      onProgress: (p) => e.sender.send('library:progress', p),
    });
    index = buildIndex(entries);
    libraryRoots = valid;
    return { count: entries.length };
  });

  ipcMain.handle('library:match', async (e, text) => {
    if (!index) throw new Error('Scan your library first.');
    // Spotify / YouTube / Apple Music links are replaced by the songs they contain.
    const { text: expanded, notes } = await expandLinks(String(text || ''), {
      onStatus: (s) => e.sender.send('links:status', s),
    });
    return { sections: matchAll(index, parseList(expanded)), notes };
  });

  ipcMain.handle('import:dialog', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Song lists', extensions: SUPPORTED.map((x) => x.slice(1)) }],
    });
    if (r.canceled) return null;
    const file = r.filePaths[0];
    if (fs.statSync(file).size > MAX_BYTES) throw new Error('That file is too large (10 MB max).');
    const name = path.basename(file);
    return { name, ...(await fileToListText(name, fs.readFileSync(file))) };
  });

  ipcMain.handle('import:bytes', async (_e, name, bytes) => {
    if (!isStr(name) || !(bytes instanceof Uint8Array)) throw new Error('Invalid file.');
    return { name, ...(await fileToListText(path.basename(name), Buffer.from(bytes))) };
  });

  ipcMain.handle('library:search', (_e, query) => {
    if (!index) throw new Error('Scan your library first.');
    return rankCandidates(index, String(query || ''), 8);
  });

  ipcMain.handle('crates:write', (_e, payload) => {
    if (!payload || !isStr(payload.eventName)) throw new Error('Give the event a name first.');
    const sections = trustedSections(payload.sections);
    const settings = loadSettings();
    const seratoDir = isStr(payload.seratoDir) ? payload.seratoDir : settings.seratoDir;
    const crates = sections
      .map((s) => ({ name: s.name, tracks: s.items.filter((i) => i.chosen).map((i) => i.chosen.path) }))
      .filter((c) => c.tracks.length);
    if (!crates.length) throw new Error('No tracks selected.');
    return writeCrates({ eventName: payload.eventName, crates, defaultDir: seratoDir });
  });

  ipcMain.handle('report:export', (_e, payload) => {
    if (!payload || !isStr(payload.eventName)) throw new Error('Give the event a name first.');
    const sections = trustedSections(payload.sections);
    const outDir = isStr(payload.outputDir) ? payload.outputDir : loadSettings().outputDir;
    return writeReports(outDir, payload.eventName, sections);
  });

  ipcMain.handle('files:collect', async (e, payload) => {
    if (!payload || !isStr(payload.eventName)) throw new Error('Give the event a name first.');
    const sections = trustedSections(payload.sections);
    const outDir = isStr(payload.outputDir) ? payload.outputDir : loadSettings().outputDir;
    return collectFiles(outDir, payload.eventName, sections, (p) => e.sender.send('files:progress', p));
  });

  ipcMain.handle('shell:reveal', (_e, target) => {
    if (isStr(target) && fs.existsSync(target)) shell.showItemInFolder(target);
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
