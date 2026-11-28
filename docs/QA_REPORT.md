# QA Report, full feature test (2026-11-24, v1.2.1 + unreleased)

How to reproduce:

```bash
npm run verify             # lint + syntax/manifest + unit, DOM and review-dialog tests
npm run test:full          # 26 live checks, Chromium with the extension, desktop 1366 px
npm run test:full:mobile   # same at 390 px
```

Live runs write screenshots, downloaded CSVs and `full-feature-report*.json` to `test-results/screenshots/`.

## v1.6.1 release checks (2026-11-28)

| Check | Result |
| --- | --- |
| `npm run verify` (lint, syntax/manifest, unit, DOM, review dialog, rank runner, website check, MCP server) | PASS |
| `npm run package` | PASS, 46 files |
| `npm run test:smoke`, Google Maps place (desktop) | PASS: one widget, 4 categories, all 6 toolbar buttons, no page errors |
| `npm run test:smoke:mobile`, Google Maps place | PASS |
| `node tests/e2e/live-interactions.js` | PASS: Media Audit opens its tab, 7 result cards with widgets, no orphan widgets, no page errors |
| `node tests/e2e/live-trusted-wheel.js` | PASS: review list scrolled and loaded 10 more reviews |
| MCP server, all 9 tools live over stdio and HTTP | PASS |
| Google Search (knowledge panel) | Not verified: Google showed its CAPTCHA to the automated browser; not bypassed. Check manually. |

## 1. Automated gates

| Gate | Result |
|---|---|
| ESLint | 0 problems |
| Syntax + manifest/popup references | 19 scripts OK |
| Unit tests (real modules, real-response fixtures) | 10/10 |
| DOM integration (Search KP, local pack, Maps panel, results feed, reviews dialog) | 18/18 |
| Review dialog on real anonymised 2026 markup (jsdom) | 8/8 |

## 2. Live feature matrix, Google Maps, popup, service worker

Desktop 1366 px: **26/26 PASS**. Mobile 390 px: **26/26 PASS**.

| ID | Feature | Result |
|---|---|---|
| A1 | Place widget mounts once, row 2 under the header | PASS |
| A2 | All categories (primary + secondary) | PASS, 4/4 |
| A3 | Toolbar: Export, Post Audit, Photo Audit, Review Audit, Dashboard, SERP Checker | PASS |
| A4 | Export → profile CSV (26 columns, phone, hours, feature ID) | PASS |
| A5 | Dashboard: score + 11 checks, none "not checked" | PASS, 100/100 |
| A6 | Dashboard tabs: Categories (4 rows), Profile data (phone, hours, Place ID) | PASS |
| A7 | Copy report → clipboard | PASS, 22 lines |
| A8 | Dashboard "Profile CSV" download | PASS |
| A9 | Website speed check | PASS (message path), shared keyless quota exhausted; clear instruction shown |
| A10 | Escape closes Dashboard | PASS |
| A11 | Photo Audit in-page, no extra tab | PASS |
| A12 | Photo Audit "Open in dedicated tab" → Search audit URL | PASS, Google showed its CAPTCHA page to the automated tab; URL correct |
| A13 | Post Audit in-page | PASS |
| A14 | Review Audit on Maps → Search tab with `#lrd=<featureId>` | PASS, URL correct; CAPTCHA page in automation |
| A15 | Automated-tab payload stored once, expires after 2 min | PASS |
| A16 | SERP Checker → "Mexican restaurant New York" with rank CID | PASS |
| B1 | Result cards get widgets, no stray/price-prefixed categories | PASS, 7 cards |
| B2 | Export list = one row per card | PASS, 7/7 |
| B3 | Card toolbar buttons clickable (Dashboard on a card) | PASS (after fix, see §4) |
| B4 | Click card → place widget for that place; Back removes it; next card rebuilds | PASS |
| C1 | Popup renders, version, active state | PASS |
| C2 | CID decoder: feature ID, `ludocid` link, invalid input | PASS |
| C3 | Cache count and Clear | PASS, 7→0, 12→0 |
| C4 | On/off switch removes and restores widgets in open tabs | PASS |
| D1 | Not injected on non-Google pages (example.com) | PASS |
| D2 | No extension errors on any page | PASS |

## 3. Google Search, live selector validation

Automated Chromium gets a CAPTCHA on Google Search, so the extension could not run end to end there. Instead, the adapter's exact selectors were run against live Search pages in a normal browser session:

| Check | Page | Result |
|---|---|---|
| Business knowledge panel detected | "Empire State Building New York" | PASS |
| Name, feature ID, primary category ("Health insurance agency"), mount point | same | PASS |
| Reviews link (`a[data-fid][role=button]`, "59 Google reviews") | same | PASS |
| Review dialog: scroll container `.RVCQse`, card `div.bwb7ce`, parser fields | same | PASS (real markup, 8 jsdom tests) |
| Next review page loads only on trusted wheel | same | Confirmed: programmatic scroll 10→10, real wheel 10→20→30→40 |
| Extension's `chrome.debugger` wheel scrolls and lazy-loads | Maps results feed | PASS, 0→2812 px, 10→20 results |
| Local pack rows detected, one widget per row | "insurance agency Dallas TX" | PASS, 3 rows |
| Local pack feature ID + category per row | same | PASS after fix (see §4), 3/3 |

## 4. Bugs found by this test pass (all fixed)

| Bug | Impact | Fix |
|---|---|---|
| Maps result-card buttons unclickable: Google's full-card link (`a.hfpxzc`, absolute) covered the toolbar | Clicking Export/Dashboard/etc. on a result card opened the place instead | Card and local-pack widgets stacked above the link (`position: relative; z-index: 2`) |
| Local pack rows had no feature ID (2026 rows carry it only in the Directions link) | No secondary categories, no full profile, SERP Checker rank match by name only | `findIdentifiersIn` reads `/maps/dir/…!1s0x…` links |
| Local pack category read from run-together text ("Insurance agentDallas, TX") | Category often missing | Parse the details block line by line |
| KP review count not read from the new "59 Google reviews" link | Only an issue if the profile lookup failed | DOM fallback added |
| Popup `<title>` double-encoded ("â€”") | Cosmetic | Fixed |

## 5. Not verified end to end

- **Search with the extension running**: knowledge-panel widget, local-pack widgets, full 57-review export with trusted scrolling, SERP Checker rank banner. All building blocks are verified (§3); the combined run needs a normal Chrome profile because automation gets a CAPTCHA.
- **PageSpeed success path**: needs a PageSpeed API key; parser covered by a unit test.
