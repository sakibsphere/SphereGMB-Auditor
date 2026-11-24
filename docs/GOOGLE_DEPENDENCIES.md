# What SphereGMB depends on at Google

SphereGMB has no API of its own; it reads Google pages. When Google changes one of these, the feature in the right-hand column breaks. Use this list with `.agents/skills/selector-maintenance/` to find and fix the cause. Live checks: `npm run test:full`, `node tests/e2e/live-trusted-wheel.js`.

| Google surface | What SphereGMB reads | Breaks if it changes |
|---|---|---|
| `www.google.com/maps/preview/place?pb=!1m2!1s<featureId>!2s` (internal, undocumented) | Full profile JSON: categories `[6][13]`, name `[6][11]`, address `[6][39]`, phone `[6][178]`, website `[6][7]`, hours `[6][203]`, attributes `[6][100]`, IDs `[6][10] [6][78] [6][89]` | Secondary categories, Export, Dashboard, score pill. Parser: `lib/place-parser.js` (fails soft: empty fields) |
| Maps place URL `/maps/place/…!1s0x…:0x…` | Feature ID of the open place | Place widget data |
| Maps place panel `div[role="main"] h1.DUwDvf`, `.tAiQdd`, `button[data-item-id="address"]`, `a[data-item-id="authority"]` | Name, NAP, mount point | Place widget |
| Maps results feed `div[role="feed"] div.Nv2PK`, `a.hfpxzc` | Result cards and their links | Card widgets, Export list |
| Search knowledge panel `[data-attrid="title"]`, `[data-attrid="kc:/location/location:address"]`, `[data-fid]` | Business detection, NAP, feature ID | Knowledge-panel widget |
| Search local pack `div.VkpGBb`, `.rllt__details`, Directions link `/maps/dir//…!1s0x…` | Rows, category line, feature ID | Local-pack widgets, SERP Checker rank |
| Reviews link `a[data-fid][role="button"]` ("N Google reviews") | Opens the reviews dialog | Review export from the panel |
| Reviews dialog `div.xOR97e[role=dialog]`, list `.RVCQse`, card `div.bwb7ce` (`.rhtdWc`, `.m6Mr5d`, `.gbdaZe .d83Iyc`, `.zMjRQd`, `.ME0dBc`, `img.SeRB9d`, `.KmCjbd`) | Every review field | Review export |
| Reviews pagination | Next page loads only on a trusted wheel near the end | Review export beyond the first 10 (needs `debugger` permission) |
| Photo viewer `[role=dialog][aria-label*="photos"]`, tabs `[aria-label^="Change collection to"]`, thumbnail URLs `…=w…-h…` (→ `=s0`), video URLs `…=m18` | Counts per category, media files | Photo audit, downloads |
| Posts `[data-attrid="kc:/local:posts"]` → Updates view: `.aYexud` (date), `.Qj68Ed` (card), `.A5yTVb` (text), `.qTVDcf` ("More") | Every post | Post audit |
| People also ask `.related-question-pair[data-q]`, `[aria-expanded][role="button"]` | Questions and answers | People also ask collector |
| Google PageSpeed Insights API v5 (official, documented) | Mobile performance | Website speed check (optional) |

Google rate-limits automated traffic (HTTP 429 / CAPTCHA). SphereGMB caches profiles for 24 h, runs at most 3 lookups at once, retries network/429/5xx errors twice with backoff, and only automates pages when the user clicks a button.
