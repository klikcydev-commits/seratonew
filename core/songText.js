'use strict';

/** Helpers that turn messy titles/artist strings from links and files into clean song text. */

function clean(s) {
  return String(s == null ? '' : s).replace(/[ ​]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "Artist A, Artist B" -> "Artist A" (extra artists would only lower the match score). */
function primaryArtist(s) {
  return clean(s).split(/\s*[;,]\s*/)[0] || '';
}

function stripFeat(s) {
  return clean(s.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, ''));
}

/** Drops streaming-service suffixes like " - Remastered 2011" or " - Radio Edit". */
function cleanTitle(t) {
  return clean(
    clean(t).replace(/\s+-\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|radio edit|single version|album version|mono|stereo|live\b|deluxe|bonus track|from\b).*$/i, '')
  );
}

/** Converts a YouTube video title + channel name into { artist, title }. */
function videoToSong({ title, channel }) {
  let t = clean(title);
  t = t.replace(/[([{][^)\]}]*(?:official|lyric|audio|video|visuali[sz]er|\bhd\b|\bhq\b|4k|8k|remaster|m\/v|clip|karaoke)[^)\]}]*[)\]}]/gi, ' ');
  t = t.replace(/\s*[|｜]\s*(?:official|lyrics?|audio|video|hd|hq).*$/i, ' ');
  t = clean(t);

  let artist = '';
  let song = t;
  const parts = t.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    artist = stripFeat(parts[0]);
    song = stripFeat(parts.slice(1).join(' - '));
  } else {
    song = stripFeat(t);
    const ch = clean(channel);
    const topic = ch.match(/^(.*?)\s*-\s*Topic$/i);
    const vevo = ch.match(/^(.*?)\s*VEVO$/i);
    if (topic) artist = topic[1];
    else if (vevo) artist = vevo[1].replace(/([a-z])([A-Z])/g, '$1 $2');
  }
  return { artist: clean(artist), title: clean(song) };
}

function songLine({ artist, title }) {
  return artist && title ? `${artist} - ${title}` : title || artist || '';
}

module.exports = { clean, primaryArtist, cleanTitle, videoToSong, songLine, stripFeat };
