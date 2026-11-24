# SphereGMB: Google Business Profile Auditor

Free, open-source Chrome extension (Manifest V3) for auditing Google Business Profiles right on Google Search and Google Maps. No account, no API key, no server.

## What it does

- **All categories**, the primary category plus the secondary categories Google doesn't show publicly, on Maps place pages, Maps result lists, Search knowledge panels and the local pack.
- **Full profile report** (Dashboard), a clean page with every public field: address, phone, website (with a UTM check), claimed or unclaimed, coordinates, hours, attributes, description, booking links, and every ID (Business Profile ID, Place ID, CID, KGMID, feature ID) with copy buttons. Copy, CSV and print/PDF.
- **Competitor benchmark**, open Dashboard from a Maps results list, the Local Finder or the local pack and the report compares the business with the rest of that search (up to 20): reviews, rating, categories, attributes and description against the typical competitor and the top 3, its position in the list, and the categories competitors use that it does not.
- **Fix list**, every failed check and competitor gap in one list, marked High, Medium or Low, with one-click copy for Google Sheets.
- **Website check**, does the linked website back up the profile? Name, phone and address on the page, category and city in the title, H1 and URL, LocalBusiness schema that agrees with the profile, hours, map, reviews, plus on-page basics (title, meta description, headings, canonical, noindex, viewport, alt text, Open Graph, HTTPS, robots.txt, sitemap).
- **Research links**, 40+ links built from the profile: review list and review request link, knowledge panel, Maps by Place ID and CID, other profiles at the same address or website, competitors; Apple Maps, Bing Maps, HERE, OpenStreetMap, Waze, Yelp, Facebook, Foursquare; Ads Transparency, Meta Ad Library, Google Trends, `site:` index counts (all, week, month, 6 months), PageSpeed, Rich Results, schema validator, robots.txt, sitemap.xml, Open Graph, WHOIS, BuiltWith, Wayback, backlinks, SSL and Safe Browsing.
- **Categories that are real**, each category is checked against Google's current list (about 4,050). "Find more" next to the categories shows real related categories, categories that competitors you viewed also use, Google's predefined services, and a search over the whole list.
- **Keyword finder**, Google's own search suggestions for the categories and services (plus your seeds), with the city and optional A to Z expansion; copy, CSV, or send them to the rank check.
- **Completeness audit**, 11 weighted checks (categories, NAP, hours, description, reviews, rating, attributes, name keyword-stuffing) with a 0–100 score.
- **Exports**, profile CSV (26 columns), review CSV (reviewer, rating, date, full text, owner reply and date, review ID), and **Export list** on Maps results (one row per business). All UTF-8 with BOM so Excel opens them correctly.
- **Review summary**, when an export finishes: average rating, star distribution, owner-reply rate, unanswered 1–2 star reviews.
- **Website speed**, optional mobile PageSpeed Insights check from the Dashboard (free; add your own free API key in Settings if Google's shared quota is used up).
- **Photo audit**, photos and videos per category (All, By owner, Videos, Exterior…), owner vs customer uploads; download photos at original size and videos as MP4.
- **Post audit**, every post since the first one: cadence, gaps, length, reading ease, buttons, images, keyword use, near-duplicates and policy issues; posts CSV; optional on-device AI suggestions (Chrome built-in AI, no server).
- **People also ask**, on Google Search results only: choose the depth (1 to 4 levels), country and language, and whether to also collect organic results, ads, related searches and autocomplete (optionally A to Z). Questions are grouped by type with level, answer and source; one CSV.
- **Bulk rank check** (SERP Checker button, or the popup's Rank check tab), every category as a keyword plus your own, with the location added to each one. One Google search at a time in a background tab, with a pause between searches; shows the Local Finder position (top 20), optional website position, the top competitor and the change since the last run. Stops and tells you if Google shows its "verify you're human" page; it never tries to get around it.
- **CID decoder** in the popup for any Maps URL, feature ID (`0x…:0x…`) or `ludocid` link.

## Install

Works in Chrome, Edge, Brave and other Chromium browsers on a computer. SphereGMB is not in the Chrome Web Store yet, so it is installed as an "unpacked" extension: download a folder, then point the browser at it once.

### Option 1: one command (easiest)

**Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/sakibsphere/SphereGMB-Auditor/main/install.ps1 | iex
```

**macOS / Linux** (Terminal):

```sh
curl -fsSL https://raw.githubusercontent.com/sakibsphere/SphereGMB-Auditor/main/install.sh | sh
```

It downloads the latest release into a `SphereGMB` folder in your home folder and tells you the last step. Read the script first if you like: [install.ps1](install.ps1), [install.sh](install.sh).

### Option 2: download the zip

1. Download [sphere-gmb.zip](https://github.com/sakibsphere/SphereGMB-Auditor/releases/latest/download/sphere-gmb.zip) (always the latest release) and unzip it.
2. Continue with "Load it in the browser" below.

### Option 3: clone with git (for developers)

```sh
git clone https://github.com/sakibsphere/SphereGMB-Auditor.git
```

### Load it in the browser (once)

1. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the folder that contains `manifest.json`.
4. Open any business on [Google Maps](https://www.google.com/maps): the Categories line and toolbar appear under the business name.

**Updating:** run the same command again (or unzip the new version over the same folder), then click the reload arrow on the SphereGMB card in `chrome://extensions`. Keeping the same folder keeps your saved data.

More detail: [user guide](docs/INSTALL_AND_USER_GUIDE.md).

## How it gets the data

Visible values are read from the page. The full profile comes from the same place-preview request Google Maps itself makes (`/maps/preview/place`), sent from the extension's service worker, parsed by [`lib/place-parser.js`](lib/place-parser.js) and cached for 24 hours in your browser.

That endpoint is not an official, documented Google API: it can change without notice and isn't covered by Google's API terms. Use the extension for your own research and audits. An optional official mode (your own Places API key) is on the [roadmap](docs/ROADMAP.md).

## Privacy and permissions

| Permission | Why |
|---|---|
| `storage` | On/off switch, the profile cache (refreshed after 24 hours, capped at 800 places, oldest removed first), saved reports and rank history |
| `downloads` | Photo audit: saves photos and videos into `Downloads/SphereGMB/<business>/` when you click Download |
| `https://www.google.com/*` | Profile lookups from the service worker, and Google's search suggestions for the keyword finder |
| Optional: the business's own website | Website check only. Not granted at install: when you click **Check the website**, Chrome asks for that one site (`optional_host_permissions`), and you can remove it later in the extension's settings. The page is read as plain HTML; none of its scripts run. |
| `debugger` | Review export only. Google's reviews dialog loads the next page only on a real mouse-wheel event, which a normal extension script can't produce. During an export the extension attaches to that one tab, sends wheel events over the review list, and detaches when the CSV is saved. Chrome shows a "started debugging this browser" bar meanwhile; pressing **Cancel** switches to assisted mode (you scroll, it keeps collecting). |

Content scripts run only on Google Search and Google Maps pages (and on Google's "unusual traffic" page, only to stop a rank check). There are no analytics. Network requests besides Google happen only when you click: the category tools download the public category list once a month from GitHub (no host permission needed), and the research links open the sites you click.

### Category data

SphereGMB does not ship a copy of Google's category list. The first time you open the category tools, your browser downloads two community-maintained lists from GitHub: [lobstrio/google-business-categories](https://github.com/lobstrio/google-business-categories) (categories, industry groups, usage counts) and [jepto/google-business-profile-categories](https://github.com/jepto/google-business-profile-categories) (Google's predefined services per category). Neither repository states a license, so they are fetched at runtime rather than bundled. Google publishes the list only through the Business Profile API, which needs approved OAuth access.

## Development

```bash
npm install
npm run verify            # lint + syntax/manifest check + 25 unit/DOM tests
npm run test:smoke        # live Google Maps check in Chromium (desktop)
npm run test:smoke:mobile # same at 390 px
node tests/e2e/live-interactions.js   # clicks every toolbar button on a live place
```

Project layout:

```
manifest.json
background/service-worker.js   profile lookups, cache, audit-tab routing
lib/place-parser.js            preview/place JSON → profile (shared with tests)
content/content.js             scan loop, SPA navigation, automated audit tabs
content/modules/               Search + Maps adapters, toolbar, audits, exporters
popup/                         on/off switch, CID decoder, cache settings
test/                          unit + DOM integration tests, real-response fixture
tests/e2e/                     Playwright live checks
docs/                          roadmap, user guide, QA report
```

## For contributors and coding agents

- `AGENTS.md`, project rules for contributors and coding assistants.
- `.agents/skills/`, step-by-step guides: `selector-maintenance` (Google changed markup), `gbp-audit-rules` (scoring and sourcing), `release-checklist`.
- `.github/workflows/ci.yml`, runs `npm run verify` and builds the zip on every push and pull request.
- `npm run package`, writes `dist/sphere-gmb-vX.Y.Z.zip` for releases.

## Status and roadmap

v1.2.0 fixed the issues that made earlier builds unreliable (review export crash, stray widgets on Maps, repeated automated downloads, running on Gmail/Docs). Google Maps is verified live on desktop and mobile; Google Search needs a manual check because Google served CAPTCHAs during automated testing. Full issue register, free API options, and planned features: **[docs/ROADMAP.md](docs/ROADMAP.md)**.

Contributions welcome, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE), copyright Sakib's Sphere. Some icons come from Lucide (ISC) and Feather (MIT); their notices and the data sources are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

SphereGMB is an independent project and is not affiliated with or endorsed by Google.
