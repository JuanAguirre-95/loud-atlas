#!/bin/sh
# Refresh every generated data file in order: MusicBrainz lineups -> Wikipedia summaries -> album lists -> dist build.
# Slow on the first run (rate limited, about an hour for ~600 acts); later runs reuse tools/.cache.
cd "$(dirname "$0")/.."
node tools/mb.js enrich
node tools/wiki.js
node tools/albums.js
node tools/build.js
