# Set Builder

Paste a client's song list → the app finds each track in your library → creates Serato crates per moment (Melodies, Formality, Slow dance, Cake cutting…), plus a report you can send or print.

## Run

```bash
npm install
npm start          # launch the app
npm test           # 46 tests for the core logic
npm run dist       # build a .dmg (macOS) / installer (Windows)
```

## How to use

1. **Setup** – name the event, add your music folder(s), click *Scan library* (first scan reads tags; later scans are cached and fast). Confirm the Serato folder (default `~/Music/_Serato_`).
2. **Paste the list.** Each moment is a header ending in `:`; songs are one per line.

   ```
   Melodies:
   Ed Sheeran - Perfect
   Formality:
   Clair de Lune - Debussy
   Slow dance:
   Kiss Me by Sixpence None The Richer
   Cake cutting:
   Sugar | play when the knife goes in
   ```
   `Artist - Title`, `Title by Artist`, or just `Title` all work. Text after `|` is a per-song note (shown in the report).
   **Links and files.** You can also paste Spotify, YouTube or Apple Music links (a single song or a whole playlist) into the box, and the app reads the song names for you:

   ```
   Slow dance:
   https://open.spotify.com/playlist/...      ← songs go into "Slow dance"
   First dance - https://youtu.be/...          ← makes a "First dance" section
   https://music.apple.com/us/playlist/...     ← its own section, named after the playlist
   ```
   **Import file…** (or drag a file onto the box) accepts `.csv` (Exportify, TuneMyMusic, Soundiiz, or your own sheet with Moment / Artist / Title / Notes columns), `.txt`, `.m3u/.m3u8` and `.docx`. Excel: Save As → CSV. PDFs and screenshots are not supported yet.
   Single-song links (one song each) all go into one **Unsorted** section instead of one section per song; put a header above them to name it. A number in front of a link (`48 https://…`) is ignored.
3. **Review.** Every line shows the song the client asked for plus a label: **Found**, **Check** (several candidates or a partial match) or **Not found**. Click **All / found / to check / not found** at the top to see only those songs in one combined list. Use the dropdown to pick another version, ▶ to preview, × to drop a line, or type in the row's search box: it searches inside the folders you scanned as you type (Enter picks the top hit). The **Search your library** card does the same for any title or artist and can add the song to a section.
4. **Create Serato crates** – **close Serato DJ first**, then reopen it. You get a parent crate named after the event with one sub-crate per moment. Re-running backs up the previous crate as `.crate.bak`.
   - **Export report** – CSV, HTML, and one `.m3u8` playlist per moment.
   - **Copy songs into folders** – `<output folder>/<Event>/<Playlist or moment>/<songs>`: one plain folder per playlist/moment, songs directly inside with their original file names. Drag a folder onto Serato's crate list to make a crate yourself. Reports go in a separate `<Event> - Report` folder.

## Notes

- Links are read from each service's public pages (no accounts or API keys). Spotify and YouTube only share the first 100 songs of a link; for longer playlists export a CSV (e.g. Exportify, TuneMyMusic) and import it. Private playlists can't be read. These pages aren't an official API, so if a site changes, the app tells you and you can import an export instead.
- Only Spotify, YouTube and Apple Music addresses are ever contacted, including redirects.

- Matching handles accents, `feat.`, typos, tag-less files (uses the filename), duplicate copies of a song, and Arabic script (hamza/alef variants).
- Tracks on an external drive are written to that drive's `_Serato_` folder (Serato requires this); the drive needs to have been opened in Serato once.
- A crate can't hold per-track notes, so notes live in the crate name (the moment) and in the report/CSV.
- The renderer is sandboxed (context isolation, CSP), and the main process only accepts track paths that are inside your scanned folders.

## Branding

The look follows the JDean by Afrah Events logo (gold `#f6da97 → #e5b563 → #d19b4a` on black). To change the logo, replace `renderer/logo.png` (header) and `build/icon.png` (app icon, square, 1024 px); colors are the variables at the top of `renderer/styles.css`.

## Verify once on your machine

The crate file is written to the community-documented Serato format and round-trips in the tests, but I could not open Serato from here. Before a real event, create a test crate and confirm it appears with the right tracks. If Windows paths look wrong in Serato, the fix is in `core/serato.js` (`cratePath`).

## Building the installers (no compiler needed)

Users install nothing else: the `.dmg` / `.exe` bundles the runtime and all libraries.

**Easiest, no local setup:** put this folder in a GitHub repo → *Actions* tab → *Build installers* → *Run workflow*. After a few minutes, download `Set-Builder-x.y.z-mac.dmg` and `Set-Builder-x.y.z-win.exe` from the run's artifacts.

**Locally:** install Node.js 22 once, then `npm install && npm run dist` (a Mac builds the `.dmg`, Windows builds the `.exe`).

**First launch on a client's machine** (the app is unsigned):
- Mac: right-click the app → Open → Open (needed once).
- Windows: SmartScreen → More info → Run anyway.
Removing these warnings needs an Apple Developer account (~$99/yr) and a Windows code-signing certificate.
