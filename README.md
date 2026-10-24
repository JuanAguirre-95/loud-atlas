# Loud Atlas

An interactive, pannable and zoomable timeline of rock and metal: bands and solo artists, their key
releases, how they group into genres and subgenres, who influenced whom, and who played in what.

Open `index.html` in a browser. No build step or server needed.

## Using it
- **Drag** to pan, **scroll** to zoom, **Shift+scroll** to zoom time only.
- **Click** a band for a summary, releases, influences, shared members and lineup.
- **Ruler:** the top row toggles a decade, the bottom row picks a year for the *On this year* tab.
- **Time brush** (bottom strip): drag the window to pan, its edges to zoom time, empty space to select a range.
- **Search** by band, album or member. Filter by genre, type, era, country.
- Links like `index.html#band=metallica&year=1986` open a specific state.

## Data
| File | What | How it's made |
|---|---|---|
| `data.js` | bands, genres, subgenres, influences, shared members | hand-curated |
| `data.extra.js` | bands you add | `node tools/mb.js add "Band Name"` |
| `data.mb.js` | lineups and shared-member links | `node tools/mb.js enrich` (MusicBrainz) |
| `data.wiki.js` | short summaries | `node tools/wiki.js` (Wikipedia) |

Dates and album years in `data.js` were written from memory: spot-check before relying on them.
`tools/report.txt` lists where MusicBrainz disagrees.

## Credits and licences
- Lineups come from [MusicBrainz](https://musicbrainz.org) (core data is CC0).
- Summaries come from Wikipedia and are CC BY-SA 4.0. The app shows attribution and a link with each one.
- Fonts: Metal Mania, Cinzel, Barlow Condensed (Google Fonts, OFL).
