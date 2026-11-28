# GBP Sphere: Free Google Business Profile Audit Tool

GBP Sphere is a free, open-source Google Business Profile audit tool (the profile Google used to call Google My Business). It runs as a Chrome extension right on Google Search and Google Maps. No account, no API key, no server. A tool by [Sakib's Sphere](https://sakibsphere.com), made by [Nazrul Huda Sakib](https://linkedin.com/in/sakibsphere). Formerly called SphereGMB.

## What it does

- **All categories**, the primary category plus the secondary categories Google doesn't show publicly, on Maps place pages, Maps result lists, Search knowledge panels and the local pack.
- **Full profile report** (Dashboard), a clean page with every public field: address, phone, website (with a UTM check), claimed or unclaimed, coordinates, hours, attributes, description, booking links, and every ID (Business Profile ID, Place ID, CID, KGMID, feature ID) with copy buttons. Copy, CSV and print/PDF.
- **Audit reports**, run the Initial GBP Audit, the GBP and Competitor Audit (against the top 3 Google Maps results for the primary category searched from the business's own address, the top 3 in the search you opened it from, or up to 3 competitors you choose by pasting their Google Maps links) and a Service List, then download one Excel workbook in the agency template layout or CSV files.
- **Free speed test**, measures the website in your own browser (LCP, layout shift, server response, page weight) with no API key; Google's PageSpeed lab test is optional.
- **Competitor benchmark**, open Dashboard from a Maps results list, the Local Finder or the local pack and the report compares the business with the rest of that search (up to 20): reviews, rating, categories, attributes and description against the typical competitor and the top 3, its position in the list, and the categories competitors use that it does not.
- **Fix list**, every failed check and competitor gap in one list, marked High, Medium or Low, with one-click copy for Google Sheets.
- **Website check**, does the linked website back up the profile? Name, phone and address on the page, category and city in the title, H1 and URL, LocalBusiness schema that agrees with the profile, hours, map, reviews, plus on-page basics (title, meta description, headings, canonical, noindex, viewport, alt text, Open Graph, HTTPS, robots.txt, sitemap).
- **Research links**, 40+ links built from the profile: review list and review request link, knowledge panel, Maps by Place ID and CID, other profiles at the same address or website, competitors; Apple Maps, Bing Maps, HERE, OpenStreetMap, Waze, Yelp, Facebook, Foursquare; Ads Transparency, Meta Ad Library, Google Trends, `site:` index counts (all, week, month, 6 months), PageSpeed, Rich Results, schema validator, robots.txt, sitemap.xml, Open Graph, WHOIS, BuiltWith, Wayback, backlinks, SSL and Safe Browsing.
- **Categories that are real**, each category is checked against Google's current list (about 4,050). "Find more" next to the categories shows real related categories, categories that competitors you viewed also use, Google's predefined services, and a search over the whole list.
- **Keyword finder**, Google's own search suggestions for the categories and services (plus your seeds), with the city and optional A to Z expansion; copy, CSV, or send them to the rank check.
- **Completeness audit**, 16 weighted checks (claimed status, categories, name, address, phone, website and UTM tracking, hours and holiday hours, description, photos, posts, reviews, rating, attributes) with a 0–100 score that counts only what can be verified.
- **Exports**, profile CSV (26 columns), review CSV (reviewer, rating, date, full text, owner reply and date, review ID), and **Export list** on Maps results (one row per business). All UTF-8 with BOM so Excel opens them correctly.
- **Review summary**, when an export finishes: average rating, star distribution, owner-reply rate, unanswered 1–2 star reviews.
- **Website speed**, optional mobile PageSpeed Insights check from the Dashboard (free; add your own free API key in Settings if Google's shared quota is used up).
- **Media audit** (photos and videos), Google's own total plus every photo and video found, per category (All, By owner, Videos, Exterior…), owner vs customer uploads; download photos at original size and videos as MP4.
- **Post audit**, every post since the first one: cadence, gaps, length, reading ease, buttons, images, keyword use, near-duplicates and policy issues; posts CSV; optional on-device AI suggestions (Chrome built-in AI, no server).
- **People also ask**, on Google Search results only: choose the depth (1 to 4 levels), country and language, and whether to also collect organic results, ads, related searches and autocomplete (optionally A to Z). Questions are grouped by type with level, answer and source; one CSV.
- **Bulk rank check** (SERP Checker button, or the popup's Rank check tab), every category as a keyword plus your own, with the location added to each one. One Google search at a time in a background tab, with a pause between searches; shows the Local Finder position (top 20), optional website position, the top competitor and the change since the last run. Stops and tells you if Google shows its "verify you're human" page; it never tries to get around it.
- **CID decoder** in the popup for any Maps URL, feature ID (`0x…:0x…`) or `ludocid` link.
- **AI assistant tools (MCP)**, a local server that lets Claude, ChatGPT (Codex), Cursor and other assistants search, audit and compare profiles and build the Excel audit by themselves. See [below](#use-it-from-claude-chatgpt-or-any-ai-assistant-mcp).

## Install

Works in Chrome, Edge, Brave and other Chromium browsers on a computer. GBP Sphere is not in the Chrome Web Store yet, so it is installed as an "unpacked" extension: download a folder, then point the browser at it once.

### Option 1: one command (easiest)

**Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/sakibsphere/GBP-Sphere/main/install.ps1 | iex
```

**macOS / Linux** (Terminal):

```sh
curl -fsSL https://raw.githubusercontent.com/sakibsphere/GBP-Sphere/main/install.sh | sh
```

It downloads the latest release into `GBP-Sphere-Extension` in your Downloads folder and tells you the last step. Run it again to update (installs from before v1.6.1 in `SphereGMB` in your home folder keep updating there). Read the script first if you like: [install.ps1](install.ps1), [install.sh](install.sh).

### Option 2: download the zip

1. Download [sphere-gmb.zip](https://github.com/sakibsphere/GBP-Sphere/releases/latest/download/sphere-gmb.zip) (always the latest release) and unzip it.
2. Continue with "Load it in the browser" below.

### Option 3: clone with git (for developers)

```sh
git clone https://github.com/sakibsphere/GBP-Sphere.git
```

### Load it in the browser (once)

1. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the folder that contains `manifest.json`.
4. Open any business on [Google Maps](https://www.google.com/maps): the Categories line and toolbar appear under the business name.

**Updating:** run the same command again (or unzip the new version over the same folder), then click the reload arrow on the GBP Sphere card in `chrome://extensions`. Keeping the same folder keeps your saved data.

More detail: [user guide](docs/INSTALL_AND_USER_GUIDE.md).

## Use it from Claude, ChatGPT or any AI assistant (MCP)

GBP Sphere also runs as a local [MCP](https://modelcontextprotocol.io) server, so an assistant can look up, audit and compare profiles on its own: "audit Peter Luger Steak House in Brooklyn, compare it with the local competitors and build the Excel audit". It runs on your computer with Node.js 18+, needs no API key, and reuses the extension's own audit code.

```sh
claude mcp add gbp-sphere --scope user -- npx -y -p github:sakibsphere/GBP-Sphere gbp-sphere-mcp
```

No `claude` command in your terminal (common if you use the Claude desktop app)? Put `npx -y @anthropic-ai/claude-code` in place of `claude`, nothing to install. Then start a new Claude session.

Tools: search Google Maps, full profile, 16-check audit with fix list and competitor benchmark, local competitors, Google Maps rank check from the business address, category research, the Excel agency audit, research links and the CID decoder. Setup for Claude Desktop, ChatGPT (Codex), Cursor, VS Code and others, plus a local HTTP API: **[docs/MCP.md](docs/MCP.md)**.

## How it gets the data

Visible values are read from the page. The full profile comes from the same place-preview request Google Maps itself makes (`/maps/preview/place`), sent from the extension's service worker, parsed by [`lib/place-parser.js`](lib/place-parser.js) and cached for 24 hours in your browser.

That endpoint is not an official, documented Google API: it can change without notice and isn't covered by Google's API terms. Use the extension for your own research and audits. An optional official mode (your own Places API key) is on the [roadmap](docs/ROADMAP.md).

## Privacy and permissions

| Permission | Why |
|---|---|
| `storage` | On/off switch, the profile cache (refreshed after 24 hours, capped at 800 places, oldest removed first), saved reports and rank history |
| `scripting` | Free website speed check only: reads Chrome's own timing data (load time, LCP, layout shift, page weight) inside the business website, in a small window you see, after you click **Measure speed** and allow that one site |
| `downloads` | Media audit: saves photos and videos into `Downloads/GBP-Sphere/<business>/` when you click Download |
| `https://www.google.com/*` | Profile lookups from the service worker, and Google's search suggestions for the keyword finder |
| Optional: the business's own website | Website check only. Not granted at install: when you click **Check the website**, Chrome asks for that one site (`optional_host_permissions`), and you can remove it later in the extension's settings. The page is read as plain HTML; none of its scripts run. |
| Optional: `maps.app.goo.gl` | Only when you add a competitor by its Maps Share link: Chrome asks once, and GBP Sphere follows that one link to the place it points to. Full Google Maps links and CIDs need no extra permission. |
| `debugger` | Review export only. Google's reviews dialog loads the next page only on a real mouse-wheel event, which a normal extension script can't produce. During an export the extension attaches to that one tab, sends wheel events over the review list, and detaches when the CSV is saved. Chrome shows a "started debugging this browser" bar meanwhile; pressing **Cancel** switches to assisted mode (you scroll, it keeps collecting). |

Content scripts run only on Google Search and Google Maps pages (and on Google's "unusual traffic" page, only to stop a rank check). There are no analytics. Network requests besides Google happen only when you click: the category tools download the public category list once a month from GitHub (no host permission needed), and the research links open the sites you click.

### Category data

GBP Sphere does not ship a copy of Google's category list. The first time you open the category tools, your browser downloads two community-maintained lists from GitHub: [lobstrio/google-business-categories](https://github.com/lobstrio/google-business-categories) (categories, industry groups, usage counts) and [jepto/google-business-profile-categories](https://github.com/jepto/google-business-profile-categories) (Google's predefined services per category). Neither repository states a license, so they are fetched at runtime rather than bundled. Google publishes the list only through the Business Profile API, which needs approved OAuth access.

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

GBP Sphere is an independent project and is not affiliated with or endorsed by Google.
