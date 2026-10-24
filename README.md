# Loud Atlas

**[Live site: loud-atlas.pages.dev](https://loud-atlas.pages.dev)**

**An interactive map of rock and metal history.** Pan and zoom across a timeline from the 1930s blues to today,
and see how bands and solo artists, their key releases, genres and subgenres, influences and shared members
connect.

![Loud Atlas overview](docs/overview.png)

- **342 bands and solo artists** in 19 genre lanes and 70 subgenres, from Delta blues and rock 'n' roll through
  punk, post-punk, thrash, death, black and doom metal to post-rock and modern metalcore, with scenes from 26 countries
- **Influence lines** showing who shaped whom, and **shared-member lines** (dashed) for musicians who moved between bands
- **944 key releases** plotted at their original release year, with an option to show every studio and live album
- No build step, no framework, no server: it is a static page drawn on an HTML canvas

![Band details](docs/band-details.png)

## Features

| | |
|---|---|
| **Open canvas** | Drag to pan, scroll to zoom, Shift+scroll to zoom time only. Pinch works on touch screens. |
| **Band details** | Click a band for a Wikipedia summary, an at-a-glance fact grid, key releases, influences, shared members and lineup. |
| **Releases** | Show the curated **key releases**, or switch to **all albums** (full studio discography from MusicBrainz), and optionally add **live albums**. The marker shows the type: a solid bone diamond is a key release, a hollow diamond another studio album, an amber circle a live album. |
| **Click-to-filter details** | In a band's details, click its genre or subgenre tag to show only that genre or subgenre. Each of "Influenced by", "Influenced" and "Shared members" has a **filter** button that shows only that lineage (roots, offspring or member-sharing bands), and clicking a musician's name shows every band they played in. Active filters appear as removable pills at the top of the map. |
| **On this year** | A tab that lists every key release, formation and breakup in a chosen year. The year is highlighted as a column on the timeline, and a switch hides every act without a release that year. |
| **Era filter** | Click a decade on the ruler, or use the decade chips, to filter to that era. |
| **Time brush** | A strip along the bottom shows how many acts were active each year. Drag its window to pan, drag the edges to zoom time, or drag empty space to pick a range. "Filter to range" turns the selection into a year filter. |
| **Search** | Search by band name, album or **member**. Typing a musician's name lists the bands they played in. |
| **Filters** | Genre (Alt+click a genre to show only that one), bands vs solo artists, country, year range. |
| **Subgenre lanes** | Each genre lane splits into subgenre groups (for example Bay Area, Teutonic and Brazilian thrash). |
| **Minimap** | Click or drag to jump around the whole map. |

![On this year](docs/on-this-year.png)

### Controls

| Action | Input |
|---|---|
| Pan | Drag, or arrow keys |
| Zoom | Scroll, `+` / `-`, or the on-screen buttons |
| Zoom time only | Shift+scroll, or the time brush |
| Fit everything | `0`, "Fit view", or double-click the time brush |
| Select a band | Click it. `Esc` clears the selection. |
| Pick a year | Click the lower row of the ruler, or click a release diamond |
| Filter to a decade | Click the upper row of the ruler |

### Shareable links

The page reads its state from the URL hash, so you can link to a view:

```
index.html#band=metallica&year=1986&zoom=1.6
index.html#q=hammett&scope=member
index.html#tab=year&year=1991
index.html#era=5,6
```

| Parameter | Meaning |
|---|---|
| `band` | Band id to select (see `data.js`) |
| `year` | Year to highlight |
| `tab` | `filters` or `year` |
| `q`, `scope` | Search text, and `all`, `name`, `album` or `member` |
| `era` | Decade indices, comma-separated (`0` = 1930s, `9` = 2020s) |
| `focus`, `sub` | With `band`: `focus=roots`, `offspring` or `shared`, or `sub=Bay Area` |
| `releases`, `live` | `releases=all` shows all albums, and `live=1` adds live albums |
| `zoom` | Zoom level when used with `band` |

## Run it

Open `index.html` in a browser. Nothing else is needed.

Fonts are bundled in `fonts/`, so the page makes no third-party requests and works offline.

## The data

The data lives in plain JavaScript files that the page loads directly:

| File | What it holds | How it is made |
|---|---|---|
| `data.js` | Bands, genres, subgenres, influences and shared-member notes | Hand-curated |
| `data.extra.js` | Bands you add on top | `node tools/mb.js add "Band Name"` |
| `data.mb.js` | Lineups and extra shared-member links | `node tools/mb.js enrich` (MusicBrainz) |
| `data.wiki.js` | Short summaries | `node tools/wiki.js` (Wikipedia) |
| `data.albums.js` | Full album lists for the "All albums" mode, loaded only when you switch to it | `node tools/albums.js` (from MusicBrainz) |

### Accuracy

The dates, release years and influence links in `data.js` were **written from memory and have not been fully verified**.
Influence lines are editorial judgement calls, not facts. `tools/report.txt` lists the places where MusicBrainz
disagrees (mostly reunions, where the map shows the original run). The "All albums" mode comes straight from MusicBrainz after simple cleaning (it drops demos, compilations, remasters and
unofficial recordings), so it can still include regional editions for 1960s acts such as The Rolling Stones, whose UK and
US albums differ. Live albums are limited to releases with an official release on MusicBrainz. Corrections are very welcome. See
[Contributing](#contributing).

### Adding or editing a band

Each band is one row in `data.js`:

```js
['metallica', 'Metallica', 'thrash', 'USA', 1981, null,
  '1983|Kill \'Em All;1984|Ride the Lightning;1986|Master of Puppets',
  ['diamondhead', 'motorhead', 'iron']],
//  id        name       genre    country formed ended  releases ("year|title;…")   influenced by (ids)
```

- `ended` is `null` for active acts.
- Add `, 'artist'` as a ninth element for a solo artist, which is drawn with rounded ends.
- Add the id to a subgenre in the `SUBS` table further down, so it lands in the right group.
- Shared members go in `window.LINKS` as `['bandA', 'bandB', 'Person Name']`.
- Releases are the **original** release year only: reissues and remasters are not listed.

To add a band from MusicBrainz instead, run `node tools/mb.js add "Band Name"`. It looks the band up, guesses a genre from its
tags and appends it to `data.extra.js`, where you should fix the genre and fill in `from`.

### Refreshing generated data

Requires Node 18 or newer (for the built-in `fetch`).

```
node tools/mb.js enrich    # MusicBrainz: lineups and shared members -> data.mb.js
node tools/wiki.js         # Wikipedia summaries -> data.wiki.js
node tools/albums.js       # cleaned album lists -> data.albums.js (run after enrich)
```

Both scripts are throttled to respect MusicBrainz and Wikimedia rate limits, cache every response in `tools/.cache`, and
resume where they stopped if interrupted. A full run takes several minutes. Wikipedia pages are resolved through the exact
MusicBrainz id, which avoids picking the wrong article for names like "Death", "Venom" or "Sleep". `tools/mb.js` and
`tools/wiki.js` each have a small override table for the few acts that need a manual fix.

## Performance

`node tools/perf.js [dist | URL]` opens the page in headless Edge or Chrome and reports load time, bytes over the wire and
per-frame draw time at overview and zoomed-in views. A few things keep the page light: bars are drawn flat when they are only
a few pixels tall, gradients and the vignette are cached, the Wikipedia summaries and the "All albums" data load only when needed,
and the fonts are subsetted and self-hosted.

## Build and deploy

```
node tools/build.js
```

This writes a clean `dist/` folder (about 500 KB) containing only what the site needs, with the unused MusicBrainz album lists
stripped out. Upload or serve the contents of `dist/`.

**Cloudflare Pages:** connect the repository with build command `node tools/build.js` and output directory `dist`, or drag the
`dist` folder into the dashboard to upload it directly. **GitHub Pages, Netlify and others** work the same way.

## Project layout

```
index.html        page shell
style.css         styling
app.js            canvas renderer, pan/zoom, filters, search, panels, time brush
data.js           curated dataset
data.extra.js     your additions
data.mb.js        generated from MusicBrainz
data.wiki.js      generated from Wikipedia
data.albums.js    generated album lists (lazy-loaded)
tools/mb.js       MusicBrainz sync and "add a band"
tools/wiki.js     Wikipedia summaries
tools/albums.js   cleans MusicBrainz album lists into data.albums.js
tools/build.js    builds dist/
tools/perf.js     load time and frame time measurements (headless Edge/Chrome)
fonts/, fonts.css self-hosted font subsets
docs/             README screenshots
```

## Contributing

Open an issue or a pull request for any correction: a wrong date, a missing release, an influence link you disagree with, or a band
that should be on the map. For data changes, edit `data.js` (or `data.extra.js`) and keep the existing row format.

## Credits and data licences

- **Lineups and shared-member links** come from [MusicBrainz](https://musicbrainz.org), whose core data is released under CC0.
- **Summaries** in `data.wiki.js` are from [Wikipedia](https://www.wikipedia.org) and are licensed
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The app shows a link and attribution next to each summary.
  Wikipedia pages are located with [Wikidata](https://www.wikidata.org) (CC0).
- **Fonts:** Metal Mania, Cinzel and Barlow Condensed (SIL Open Font License), self-hosted in `fonts/` as subsets. See `fonts/README.md`.
- Band names, album titles and the music itself belong to their respective owners. This project only maps their history.
