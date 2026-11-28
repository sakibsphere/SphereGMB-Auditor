# GBP Sphere: Audit, Fixes & Roadmap

Status as of **2026-11-19 (v1.2.0)**. This document records what was broken, what was fixed, what is still open, and where the extension should go next, with a bias toward free and open-source building blocks so anyone can clone the repo, load it unpacked, and use it without paying for anything.

---

## 1. Why it "didn't work" (root causes)

The extension had working pieces (the category endpoint was fine), but a handful of bugs made it look broken in daily use:

1. **Review export crashed and then locked itself.** `startExport()` declared `const businessName` and later reassigned it. Any profile where the name had to be re-detected threw a `TypeError`; because there was no `finally`, `isScraping` stayed `true` and every later click silently did nothing until the tab was reloaded.
2. **It ran on every Google property.** Content scripts matched `https://*.google.com/*`, Gmail, Docs, Drive, Calendar, accounts, each with a whole-document `MutationObserver`.
3. **A full-DOM scan every 350 ms.** The reviews-dialog detector ran `document.querySelectorAll('*')` plus a regex over every leaf node on each mutation burst. On Maps (which mutates constantly) that is a continuous CPU drain.
4. **Maps widget chaos.** Live check on the Empire State Building page showed **6 widgets** on one page: one appended to `<body>` (mounted before Maps rendered `role="main"`), several on "People also search for" cards, one stuck on "Loading categories…".
5. **Automated tabs repeated themselves.** The `?sphereGmbAudit=review` flag stayed in the URL, so any later URL change (closing the dialog, sorting) re-ran the scraper and downloaded the CSV again.
6. **Every Post/Photo Audit click opened a modal *and* a new Google tab.**
7. **Test data shipped in production code**: a hardcoded test-business fallback name (and a regex that stripped that business's owner replies), a hardcoded `57` review count, and a default score of `85` (`score || 85` also turned a real `0` into `85`).
8. **After reloading the extension, every open Google tab threw "Extension context invalidated".** Orphaned content scripts kept calling `chrome.*` APIs. Common during development; now detected and the old script shuts itself down.

## 2. Issue register

Severity: **C** critical · **H** high · **M** medium. Status: Fixed / Open.

| # | Sev | Area | Issue | Status |
|---|---|---|---|---|
| 1 | C | Reviews | `const` reassignment crash + lock never released | Fixed |
| 2 | C | Manifest | Content scripts on all `*.google.com` pages | Fixed, limited to `/search*` and `/maps*` on 40 country domains |
| 3 | C | Perf | `querySelectorAll('*')` scan on every mutation | Fixed, dialog check gated, debounced scans |
| 4 | C | Maps | Widget in `<body>`, on nearby cards, on the "Results" `<h1>` | Fixed, verified live: 1 widget on place pages, 0 strays on result lists |
| 5 | C | Maps | Stale data after navigating place → place | Fixed, widget rebuilds when feature ID/name changes |
| 6 | C | Workflow | Automated review tab re-runs + re-downloads | Fixed, one-shot, flag removed from URL, payload expires after 2 min |
| 7 | C | UX | Post/Photo Audit opened modal + new tab | Fixed, in-page; "Open in dedicated tab" is an explicit button |
| 8 | C | Data | Hardcoded test business / 57 / 85 values | Fixed + regression test |
| 9 | H | Data | Export & Dashboard only had DOM-scraped NAP; no hours, description, attributes, Place ID | Fixed, full profile parsed from the place endpoint; CSV now 26 columns |
| 10 | H | Photo audit | Counted "Add photos" buttons; quoted unverifiable stats ("520% more calls", "BrightLocal 2024 benchmark") | Fixed, honest on-page counts, Google's own guidelines |
| 11 | H | Search | Widget injected into non-business panels (people, films) | Fixed, requires a local-business signal |
| 12 | H | Search | Feature ID missed `data-fid`, `#lrd=` links, `ludocid=` | Fixed (not live-verified, see §4) |
| 13 | H | Search | Two widgets per local-pack row (nested selectors) | Fixed |
| 14 | H | Maps | Card categories included price: "$$$American restaurant" | Fixed |
| 15 | H | Runtime | "Extension context invalidated" spam after reload | Fixed |
| 16 | H | Quality | No lint/type-check; tests copied logic instead of importing it, and asserted buggy behaviour | Fixed, ESLint, syntax/manifest check, 25 tests against real modules |
| 17 | M | Security | Website URL and IDs injected into modal HTML unescaped | Fixed, escaped, http(s)-only hrefs |
| 18 | M | Design | Emoji used as icons (⚡, ✓) | Fixed, inline SVG |
| 19 | M | Reviews | "More" expander clicked any button containing "more" (e.g. "More options") | Fixed |
| 20 | M | Reviews | Maps review cards double-counted (nested `data-review-id`) | Fixed |
| 21 | M | Runtime | Duplicate intervals each time the toggle was switched on | Fixed |
| 22 | M | Cache | Cache-duration setting ignored; v1 cache entries never invalidated | Fixed |
| 23 | M | Repo | MIT claimed but no LICENSE; README described an old design | Fixed |
| 24 | H | Search | Not live-verified this session (Google served CAPTCHA/HTTP 429 to this network) | **Open** |
| 29 | C | Reviews | Export stopped at the first page (11 of 57): Google's 2026 dialog loads more reviews only on a trusted wheel event; `scrollTop`, `scrollBy` and synthetic `WheelEvent`s are ignored (A/B-tested live) | Fixed in 1.2.1, trusted wheel via `chrome.debugger`, assisted fallback; mechanism verified live (Maps list 10→20 via the extension, Search dialog 10→40 via trusted wheel) |
| 30 | H | Reviews | 2026 card layout (`div.bwb7ce`) parsed poorly: stars have no label, full text sits in a hidden copy, owner reply nested; new `a[data-fid][role=button]` reviews link not clicked | Fixed, dedicated parser + jsdom test on real anonymised markup |
| 25 | M | Reviews | Relative-date parsing is English-only (`2 weeks ago`) | **Open**, automated tabs force `hl=en`; in-place scraping on other locales may miss dates |
| 26 | M | Photos | Google doesn't publish photo totals publicly | **Open**, needs Places API (BYOK) or Business Profile API (owner) |
| 27 | M | Posts | Post detection selectors are heuristic, unverified live | **Open** |
| 28 | M | Policy | Relies on Google's internal `maps/preview/place` endpoint | **Open**, see risks (§7) |

## 3. How the data flow works now

```
Search / Maps page ─► content script reads visible NAP + feature ID (0x…:0x…)
                                   │
                                   ▼
             service worker ─► www.google.com/maps/preview/place?pb=!1m2!1s<featureId>!2s
                                   │   (cached 24 h in chrome.storage, max 3 concurrent lookups)
                                   ▼
             lib/place-parser.js ─► name, all categories, address parts, phone, website,
                                    hours, description, attributes, rating, review count,
                                    lat/lng, plus code, Place ID, CID, KGMID
                                   │
                                   ▼
             widget chips · Dashboard audit (11 weighted checks) · 26-column CSV
```

The parser is dependency-free and shared by the service worker (`importScripts`) and the Node tests (`require`), with a trimmed real response in `test/fixtures/`.

## 4. Verification done

| Check | Result |
|---|---|
| `npm run lint` (ESLint 9) | 0 problems |
| `npm run check` (syntax + manifest/popup references) | 18 scripts OK |
| `npm test` | 9 unit + 16 DOM integration tests pass |
| Live Maps, desktop 1366 px (`tests/e2e/live-interactions.js`) | 1 widget, 4/4 categories, Export → 26-col CSV with phone/hours, Dashboard 100/100 with real checks, Photo Audit opens no tab, results list: 7 cards enriched, 0 stray widgets, 0 page errors |
| Live Maps, mobile 390 px | Same results; toolbar wraps, no horizontal overflow, dialog fits viewport |
| Live Google Search | **Blocked**, CAPTCHA/429 for automated and in-app browsers on this network |

**To do on your machine:** load the unpacked extension in your everyday Chrome profile and check a business search (knowledge panel), a "plumber near me" search (local pack), and Review Audit end-to-end. Report selector misses as issues with a screenshot.

---

## 5. Roadmap

### Phase 1, Stabilise Search and reviews (next 1–2 weeks)
- Live-verify the Search adapter on a real profile; adjust KP / local-pack selectors from findings.
- Review analytics in the Dashboard: rating distribution (Maps exposes `tr[aria-label="5 stars, 106,179 reviews"]`), owner response rate, review velocity (reviews per month from relative dates), share of reviews with photos.
- Locale-aware relative dates (start with es, fr, de, pt, bn, hi).
- **Bulk export from a Maps results list**, every card already has a resolved profile; one button can export all of them (competitor research, lead lists).
- **Competitor category gap**, from the same results list, show categories that top competitors use and this profile doesn't. Pure local computation, no API.
- GitHub Actions CI on every PR: `npm run verify` (free for public repos).

### Phase 2, Free integrations (no paid keys)
| Feature | Source | Cost / key |
|---|---|---|
| Website speed & mobile audit of the GBP website | Google PageSpeed Insights API v5 | Free; key optional (recommended for quota) |
| NAP consistency: GBP vs website | Fetch the site, read `LocalBusiness` JSON-LD + visible phone/address | Free; needs optional host permission requested at click time |
| Knowledge-graph cross-links | Wikidata SPARQL (`P2671` = Google Knowledge Graph ID) using the KGMID we already parse | Free, no key |
| Independent NAP check | OpenStreetMap Nominatim / Overpass | Free; respect 1 req/s and send an app identifier |
| Open POI cross-check | Overture Maps Places, Foursquare OS Places (open datasets) | Free downloads; better as an optional offline/CLI tool |
| On-device AI: review summary, reply drafts, description & post rewrites | Chrome built-in AI (Gemini Nano: Prompt, Summarizer, Writer/Rewriter APIs) | Free, runs locally; feature-detect and hide when unavailable |
| Offline sentiment fallback | Transformers.js (Apache-2.0) with a small sentiment model | Free, open source |
| PDF / XLSX audit reports | jsPDF (MIT), SheetJS Community Edition (Apache-2.0) | Free, bundle locally (no CDN) |
| Charts in Dashboard | Chart.js (MIT) or hand-rolled SVG | Free |

### Phase 3, Official "bring your own key" modes (optional, still free tier)
- **Places API (New)**: user pastes their own key in Settings (stored only in `chrome.storage.local`). Google replaced the $200 credit on 1 Mar 2025 with free monthly calls **per SKU: 10k Essentials / 5k Pro / 1k Enterprise**. Gives photo references (up to 10), up to 5 reviews, editorial summary, a policy-safe fallback if the internal endpoint changes.
- **Business Profile API (owner mode)**: OAuth for profiles the user manages. Access is free but requires Google's manual approval (reviewed in ~14 days). Unlocks *all* reviews + replies, posts, media counts, and performance insights, the only official way to get exact photo totals and post history.
- Geo-grid rank checks: technically possible via Search with location parameters, but repeated SERP requests trigger CAPTCHAs (seen during this audit). Ship only with strict rate limits and user-initiated runs.

### Phase 4, Release & community
- Chrome Web Store listing: single-purpose description, privacy policy page (what is read, that nothing leaves the browser except requests to Google), screenshots.
- `npm run package` → versioned zip; GitHub Releases with changelog.
- Issue templates ("Selector broke on…" with URL + screenshot), Dependabot for dev dependencies.
- Nightly scheduled `test:smoke` on GitHub Actions to catch Google DOM changes early (Maps loads reliably from CI; Search may CAPTCHA).

---

## 5a. Built since v1.2.1 (Unreleased)

| Item | Status | Verified |
|---|---|---|
| Maps results **Export list** (bulk CSV, full profile per row) | Done | Live: 7 businesses, 26 columns, desktop + mobile |
| Review export summary (average, distribution, reply rate, unanswered low ratings) | Done | Unit test |
| PageSpeed Insights website check (BYOK free key in Settings) | Done | Live: quota-exhausted path shown correctly; success path covered by a parser test only, needs a real key to see live |
| Maintenance guides (`.agents/skills/`), `AGENTS.md`, Playwright live tests | Done | |
| GitHub Actions CI, issue templates, `npm run package`, CHANGELOG | Done | Zip built and opened locally; CI runs once pushed |

Still open from Phase 1–2: competitor category gap, locale-aware review dates, Wikidata/OSM cross-checks, on-device AI review insights, PDF/XLSX reports.

## 5b. Live analysis, 2026-11-24 (what Google exposes and how)

| Area | What was found on live pages | Status |
|---|---|---|
| Long reviews | Full text is already in a hidden copy (`.gbdaZe .d83Iyc`, e.g. 206 visible → 2,802 chars); no "More" click needed. Paragraphs are `<br>`s | Parsed with line breaks |
| Review details | Sub-ratings and Q&A sit **inside** the full text (`.zMjRQd`); visit info in `.ME0dBc`; photos `img.SeRB9d` (+ captions); reviewer meta "Local Guide·67 reviews·8 photos" | Separate CSV columns |
| Owner replies | Complete in `.KmCjbd` (no truncation), date in the second `.YE6B9b` | Parsed |
| Photos & videos | "See photos" viewer; categories are `[aria-label^="Change collection to"]`; thumbnails `…=w200-h200` → `=s0` gives the original; videos are `…=m18` MP4. Grid loads with normal scrolling | Counts + downloads (test profile: identical counts on two runs) |
| Posts | `[data-attrid="kc:/local:posts"]` → "View all" opens the Updates view; **all** posts load with normal scrolling (test profile: 180 posts back to 2023); "More" expands instantly | Full post audit |
| People also ask | `.related-question-pair[data-q]` + `[aria-expanded][role=button]`; opening a question adds ~2–3 more (4 → 6 → 9 → 12) | Collector |
| Review pages | Next 10 reviews load only on a trusted wheel near the end of the list | Trusted wheel via `chrome.debugger` (v1.2.2) |

**Other things that can be decoded the same way (free, no API):**
- Review topic chips in the dialog header ("knowledgeable staff 19", "affordable plans 4") → what customers praise most.
- Products/services (`kc:/local:products_overview_for_desktop`) and social profiles (`kc:/common/topic:social media presence`) shown in the knowledge panel.
- "People also search for" competitors in the Maps place panel → competitor list and category gap.
- Owner reply rate and reply delay, from the review export (reply date vs review date).
- Photo freshness: each photo's age is shown in the viewer ("a year ago").
- Popular times on Maps (hourly busyness histogram).

**About the installed "People Also Ask" extension:** its own code has no open-source license (only bundled flag-icons and Lucide are licensed), so it was read only to understand the technique. GBP Sphere's collector is an original implementation. Note that, despite describing itself as "100% local", that extension fetches data from its own server (`people-also-ask.vercel.app`); GBP Sphere's collector makes no network calls.

**"Install everything automatically":** a Chrome extension cannot install software on the computer, and it doesn't need to. Everything runs inside the browser in JavaScript; there is nothing else to install. On-device AI uses the model built into Chrome (Gemini Nano via the Prompt API), which Chrome downloads and manages itself.

## 6. Skills and agents worth adding

**Repository guides** (in `.agents/skills/`, readable by people and by any coding assistant):
- `gbp-audit-rules`, scoring weights, Google's published guidelines (photo sizes, description length, name rules) and the source for each, so audit copy never drifts back to invented numbers.
- `selector-maintenance`, step-by-step: run `npm run test:smoke`, dump the DOM with the Maps debug pattern from `tests/e2e/`, update selectors, add a DOM test.
- `release-checklist`, version bump in `manifest.json` + `package.json` + popup label, verify, package, changelog.

**In-extension agents (free, on-device)** built on Chrome built-in AI:
- *Review insights agent*, themes, sentiment split, unanswered negative reviews, response drafts.
- *Profile copy agent*, rewrites the description within 750 characters, drafts weekly posts around the primary category and city.
- *Category advisor*, combines the competitor category gap (Phase 1) with the business description to suggest categories to review.

**Developer automation (free for public repos)**: GitHub Actions CI, Dependabot, a scheduled smoke run, and the `selector-maintenance` guide for "Google changed the DOM, find and fix the selector".

## 7. Risks to keep in view
- **Google Terms of Service.** Reading Google's internal `maps/preview/place` endpoint and automating Search pages is not an official API. It is what most free GBP tools do, but it can break without notice and isn't covered by Google's API terms. The BYOK Places API mode (Phase 3) is the compliant fallback; say this plainly in the README.
- **Rate limiting.** Search returned HTTP 429/CAPTCHA during testing. Keep lookups cached, concurrent requests low (currently 3), and every automation user-initiated.
- **DOM churn.** Google renames classes often; the adapters lean on `data-attrid`, `data-fid`, `role`, and URL patterns first, with class names as fallbacks. The smoke tests are the early-warning system.
- **Chrome Web Store review.** Keep permissions minimal (currently `storage` + `https://www.google.com/*`) and request any website-fetch permission optionally, at the moment it's needed.

### Sources
- Google Maps Platform, [March 2025 billing changes](https://developers.google.com/maps/billing-and-pricing/march-2025) and [pricing overview](https://developers.google.com/maps/billing/overview/)
- Google Maps Platform blog, [per-SKU free calls (10k/5k/1k)](https://mapsplatform.google.com/resources/blog/mapping-the-next-generation-of-geospatial-experiences)
- Google Business Profile APIs, [FAQ (access review, default quota)](https://developers.google.com/my-business/content/faq)
