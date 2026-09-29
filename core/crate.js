'use strict';

/**
 * Serato .crate binary format (as documented by the community):
 *   a flat sequence of tags: 4 ASCII bytes name, 4 bytes big-endian length, data
 *   vrsn  -> UTF-16BE version string
 *   otrk  -> container holding one ptrk
 *   ptrk  -> UTF-16BE track path (relative to the drive root, no leading slash)
 */

const VERSION = '81.0/Serato ScratchLive Crate';

function utf16be(str) {
  const b = Buffer.from(String(str), 'utf16le');
  b.swap16();
  return b;
}

function fromUtf16be(buf) {
  const copy = Buffer.from(buf);
  copy.swap16();
  return copy.toString('utf16le');
}

function tag(name, data) {
  const head = Buffer.alloc(8);
  head.write(name, 0, 4, 'ascii');
  head.writeUInt32BE(data.length, 4);
  return Buffer.concat([head, data]);
}

function buildCrate(trackPaths) {
  const parts = [tag('vrsn', utf16be(VERSION))];
  for (const p of trackPaths) parts.push(tag('otrk', tag('ptrk', utf16be(p))));
  return Buffer.concat(parts);
}

function readTags(buf) {
  const tags = [];
  let off = 0;
  while (off + 8 <= buf.length) {
    const name = buf.toString('ascii', off, off + 4);
    const len = buf.readUInt32BE(off + 4);
    const end = off + 8 + len;
    if (end > buf.length) throw new Error(`Corrupt crate: tag ${name} overruns file`);
    tags.push({ name, data: buf.subarray(off + 8, end) });
    off = end;
  }
  return tags;
}

function parseCrate(buf) {
  let version = '';
  const tracks = [];
  for (const t of readTags(buf)) {
    if (t.name === 'vrsn') version = fromUtf16be(t.data);
    else if (t.name === 'otrk') {
      for (const inner of readTags(t.data)) {
        if (inner.name === 'ptrk') tracks.push(fromUtf16be(inner.data));
      }
    }
  }
  return { version, tracks };
}

module.exports = { buildCrate, parseCrate, VERSION };
