'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildCrate } = require('./crate');

function defaultSeratoDir() {
  return path.join(os.homedir(), 'Music', '_Serato_');
}

function safeName(name) {
  const cleaned = String(name || '')
    .replace(/%%/g, ' ')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Untitled';
}

/**
 * Serato keeps a separate _Serato_ folder on every drive. Tracks on an external
 * drive belong in that drive's _Serato_ folder; everything else goes in the
 * default one. Paths inside a crate are relative to the drive root.
 */
function volumeInfo(absPath, defaultDir, platform = process.platform) {
  const P = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'darwin') {
    const m = absPath.match(/^(\/Volumes\/[^/]+)(?=\/)/);
    if (m) return { root: m[1], seratoDir: P.join(m[1], '_Serato_'), external: true };
    return { root: '/', seratoDir: defaultDir, external: false };
  }
  if (platform === 'win32') {
    const root = P.parse(absPath).root;
    const defRoot = P.parse(defaultDir).root;
    if (root.toLowerCase() === defRoot.toLowerCase()) return { root, seratoDir: defaultDir, external: false };
    return { root, seratoDir: P.join(root, '_Serato_'), external: true };
  }
  return { root: '/', seratoDir: defaultDir, external: false };
}

function cratePath(absPath, root, platform = process.platform) {
  const P = platform === 'win32' ? path.win32 : path.posix;
  const rel = P.relative(root, absPath);
  if (!rel || rel.startsWith('..') || P.isAbsolute(rel)) return null;
  return rel;
}

function writeAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/**
 * crates: [{ name, tracks: [absolutePath] }]
 * Creates "<eventName>" as a parent crate with one child crate per entry
 * ("<eventName>%%<name>.crate"), so Serato shows them nested.
 */
function writeCrates({ eventName, crates, defaultDir = defaultSeratoDir(), platform = process.platform }) {
  const parent = safeName(eventName);
  const groups = new Map(); // seratoDir -> { root, perCrate: Map(name -> [paths]) }
  const warnings = [];

  for (const crate of crates) {
    for (const track of crate.tracks) {
      const vol = volumeInfo(track, defaultDir, platform);
      const rel = cratePath(track, vol.root, platform);
      if (!rel) {
        warnings.push(`Skipped (cannot express path relative to its drive): ${track}`);
        continue;
      }
      let g = groups.get(vol.seratoDir);
      if (!g) groups.set(vol.seratoDir, (g = { root: vol.root, perCrate: new Map() }));
      const list = g.perCrate.get(crate.name) || [];
      if (!list.includes(rel)) list.push(rel);
      g.perCrate.set(crate.name, list);
    }
  }

  const written = [];
  for (const [seratoDir, g] of groups) {
    if (!fs.existsSync(seratoDir)) {
      const n = [...g.perCrate.values()].reduce((a, l) => a + l.length, 0);
      warnings.push(
        `No _Serato_ folder at ${seratoDir}. Open Serato DJ once with that drive connected, then run again (${n} track(s) not added).`
      );
      continue;
    }
    const dir = path.join(seratoDir, 'Subcrates');
    fs.mkdirSync(dir, { recursive: true });

    const parentFile = path.join(dir, `${parent}.crate`);
    if (!fs.existsSync(parentFile)) writeAtomic(parentFile, buildCrate([]));

    for (const [name, paths] of g.perCrate) {
      const file = path.join(dir, `${parent}%%${safeName(name)}.crate`);
      if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
      writeAtomic(file, buildCrate(paths));
      written.push({ file, crate: name, tracks: paths.length, seratoDir });
    }
  }
  return { parent, written, warnings };
}

module.exports = { writeCrates, defaultSeratoDir, safeName, volumeInfo, cratePath };
