'use strict';

const path = require('path');
const fs = require('fs');

/** True when `child` is the same as, or lives inside, `parent`. */
function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * The renderer is not trusted with arbitrary paths: every track path sent back
 * to the main process must be a real file inside a scanned library folder.
 */
function assertTracksInLibrary(paths, roots) {
  for (const p of paths) {
    if (typeof p !== 'string' || !p) throw new Error('Invalid track path');
    if (!roots.some((r) => isInside(r, p))) throw new Error(`Track is outside your library folders: ${p}`);
    if (!fs.existsSync(p)) throw new Error(`Track no longer exists: ${p}`);
  }
}

module.exports = { isInside, assertTracksInLibrary };
