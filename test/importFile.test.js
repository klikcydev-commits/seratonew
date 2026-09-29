'use strict';
const test = require('node:test');
const assert = require('node:assert');
const JSZip = require('jszip');
const { fileToListText, csvToList, m3uToList, parseCsv } = require('../core/importFile');
const { parseList } = require('../core/parseList');

const buf = (s) => Buffer.from(s, 'utf8');

test('Exportify-style CSV (Track Name / Artist Name(s))', async () => {
  const csv = 'Track URI,Track Name,Artist Name(s),Album Name\nspotify:track:1,"Perfect, Live",Ed Sheeran;Beyoncé,÷\nspotify:track:2,Sugar,Maroon 5,V\n';
  const { text } = await fileToListText('export.csv', buf(csv));
  assert.strictEqual(text, 'Ed Sheeran - Perfect, Live\nMaroon 5 - Sugar');
});

test('TuneMyMusic-style CSV groups songs by playlist name', () => {
  const csv = 'Track name,Artist name,Album,Playlist name,Type,ISRC\nPerfect,Ed Sheeran,÷,Slow dance,Playlist,X\nSugar,Maroon 5,V,Cake,Playlist,Y\nKiss Me,Sixpence,,Slow dance,Playlist,Z\n';
  const sections = parseList(csvToList(csv));
  assert.deepStrictEqual(sections.map((s) => [s.name, s.songs.length]), [['Slow dance', 2], ['Cake', 1]]);
});

test('your own spreadsheet: Moment / Artist / Title / Notes, semicolon-delimited', () => {
  const csv = 'Moment;Artist;Title;Notes\nSlow dance;Ed Sheeran;Perfect;lights down\nCake cutting;Maroon 5;Sugar;\n';
  const sections = parseList(csvToList(csv));
  assert.strictEqual(sections[0].name, 'Slow dance');
  assert.strictEqual(sections[0].songs[0].note, 'lights down');
  assert.strictEqual(sections[1].songs[0].title, 'Sugar');
});

test('headerless CSV uses first two columns as Artist - Title', () => {
  assert.strictEqual(csvToList('Adele,Hello\nColdplay,Yellow\n'), 'Adele - Hello\nColdplay - Yellow');
});

test('parseCsv handles quotes, escaped quotes and CRLF', () => {
  assert.deepStrictEqual(parseCsv('a,"b ""q"" c"\r\nd,e\r\n'), [['a', 'b "q" c'], ['d', 'e']]);
});

test('m3u/m3u8 uses EXTINF text, else the file name', () => {
  const m3u = '#EXTM3U\n#EXTINF:200,Ed Sheeran - Perfect\n/music/01 - x.mp3\nC:\\Music\\03 - Adele - Hello.mp3\n';
  assert.strictEqual(m3uToList(m3u, 'Slow dance'), 'Slow dance:\nEd Sheeran - Perfect\nAdele - Hello');
});

test('txt: UTF-8 BOM and UTF-16 LE are decoded', async () => {
  assert.strictEqual((await fileToListText('a.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buf('Hello')]))).text, 'Hello');
  assert.strictEqual((await fileToListText('a.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('فيروز', 'utf16le')]))).text, 'فيروز');
});

test('docx text is extracted', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Slow dance:</w:t></w:r></w:p><w:p><w:r><w:t>Ed Sheeran - Perfect</w:t></w:r></w:p></w:body></w:document>');
  const { text } = await fileToListText('list.docx', await zip.generateAsync({ type: 'nodebuffer' }));
  const sections = parseList(text);
  assert.deepStrictEqual([sections[0].name, sections[0].songs[0].title], ['Slow dance', 'Perfect']);
});

test('unsupported and oversized files give clear errors', async () => {
  await assert.rejects(fileToListText('list.xlsx', buf('x')), /Save As → CSV/);
  await assert.rejects(fileToListText('shot.png', buf('x')), /screenshots are not supported/);
  await assert.rejects(fileToListText('big.txt', Buffer.alloc(11 * 1024 * 1024)), /too large/);
});
