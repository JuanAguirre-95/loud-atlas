# Fonts

Self-hosted so the site makes no third-party requests and works offline.

| Font | Used for | Source |
|---|---|---|
| Barlow Condensed 400 / 600 / 700 | UI and band names | Google Fonts, SIL Open Font License 1.1 |
| Cinzel 700 (also used for 600) | Ruler, lane labels, headings | Google Fonts, SIL Open Font License 1.1 |
| Metal Mania | Title and band names in the details panel | Google Fonts, SIL Open Font License 1.1 |

Only the `latin` and `latin-ext` subsets are included. Metal Mania was further subset to printable ASCII plus the accented
letters that occur in act names (with `pyftsubset --no-hinting`), which cut it from 76 KB to 47 KB.
The `unicode-range` rules in `../fonts.css` come from Google Fonts, so the accented-letter files only download when needed.

The SIL Open Font License 1.1 permits bundling, redistribution and subsetting: https://openfontlicense.org
