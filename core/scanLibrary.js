'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const AUDIO_EXT = new Set([
  '.mp3', '.m4a', '.aac', '.flac', '.wav', '.aif', '.aiff', '.ogg', '.alac', '.mp4',
]);
const SKIP_DIRS = new Set(['_serato_', 'node_modules', '$recycle.bin', 'system volume information']);

async function walk(roots, onFound) {
  const files = [];
  const stack = [...roots];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name.toLowerCase())) stack.push(full);
      } else if (ent.isFile() && AUDIO_EXT.has(path.extname(ent.name).toLowerCase())) {
        files.push(full);
        if (onFound && files.length % 250 === 0) onFound(files.length);
      }
    }
  }
  return files;
}

function loadCache(cachePath) {
  if (!cachePath) return {};
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    return {};
  }
}

async function readTags(file) {
  try {
    const mm = await import('music-metadata');
    const meta = await mm.parseFile(file, { duration: false, skipCovers: true });
    return {
      artist: (meta.common.artist || '').trim(),
      title: (meta.common.title || '').trim(),
    };
  } catch {
    return { artist: '', title: '' };
  }
}

/**
 * Scans folders for audio files and returns [{ path, artist, title }].
 * Tag reads are cached by path + mtime + size so re-scans are fast.
 */
async function scanLibrary(folders, { cachePath, onProgress, useTags = true, concurrency = 8 } = {}) {
  const report = (p) => onProgress && onProgress(p);
  const files = await walk(folders, (n) => report({ phase: 'walk', found: n }));
  report({ phase: 'walk', found: files.length });

  const cache = loadCache(cachePath);
  const next = {};
  const out = new Array(files.length);
  let done = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < files.length) {
      const i = cursor++;
      const file = files[i];
      let st;
      try {
        st = await fsp.stat(file);
      } catch {
        done++;
        continue;
      }
      const hit = cache[file];
      let tags;
      if (hit && hit.m === st.mtimeMs && hit.s === st.size) {
        tags = { artist: hit.a, title: hit.t };
      } else if (useTags) {
        tags = await readTags(file);
      } else {
        tags = { artist: '', title: '' };
      }
      next[file] = { m: st.mtimeMs, s: st.size, a: tags.artist, t: tags.title };
      out[i] = { path: file, artist: tags.artist, title: tags.title };
      done++;
      if (done % 50 === 0 || done === files.length) report({ phase: 'tags', done, total: files.length });
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  if (cachePath) {
    try {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(next));
    } catch {
      /* cache is best-effort */
    }
  }
  return out.filter(Boolean);
}

module.exports = { scanLibrary, AUDIO_EXT };
